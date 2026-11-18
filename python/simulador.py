import argparse
import math
import os
import time
from datetime import datetime, timezone

import psycopg2
import requests
from dotenv import load_dotenv
from adaptadores import OpenMeteoAdapter

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".env"))
CODIGOS = {"PM1": "PM1", "PM25": "PM2.5", "PM10": "PM10", "CO": "CO"}


def insertar_lecturas():
    with psycopg2.connect(os.environ["DATABASE_URL"], connect_timeout=5) as conexion:
        with conexion.cursor() as cursor:
            cursor.execute("""
                SELECT s.id FROM sensor s
                WHERE s.activo AND s.origen = 'simulado'
                  AND (SELECT count(DISTINCT v.codigo)
                       FROM sensor_variable sv JOIN variable v ON v.id = sv.variable_id
                       WHERE sv.sensor_id = s.id AND v.codigo IN ('PM1','PM25','PM10','CO')) = 4
                ORDER BY s.id
            """)
            candidatos = [fila[0] for fila in cursor.fetchall()]
            elegido = os.getenv("SIMULADOR_SENSOR_ID")
            if elegido:
                sensor_id = int(elegido)
                if sensor_id not in candidatos:
                    raise ValueError("SIMULADOR_SENSOR_ID debe ser un sensor simulado activo con las cuatro variables.")
            elif len(candidatos) == 1:
                sensor_id = candidatos[0]
            else:
                raise ValueError("Configura SIMULADOR_SENSOR_ID: debe existir un sensor simulado con PM1, PM25, PM10 y CO.")

            cursor.execute("""
                SELECT v.codigo, v.id, v.unidad_id, u.simbolo
                FROM sensor_variable sv JOIN variable v ON v.id = sv.variable_id
                JOIN unidad u ON u.id = v.unidad_id
                WHERE sv.sensor_id = %s AND v.codigo IN ('PM1','PM25','PM10','CO')
            """, (sensor_id,))
            variables = cursor.fetchall()
            for _, _, _, simbolo in variables:
                if simbolo.replace("μ", "µ").replace("³", "3") != "µg/m3":
                    raise ValueError("Las variables del simulador deben usar unidades de microgramos por metro cúbico.")

            lecturas = OpenMeteoAdapter().obtener_lecturas(
                float(os.getenv("SIMULADOR_LATITUD", "-17.7833")),
                float(os.getenv("SIMULADOR_LONGITUD", "-63.1821")),
            )
            if lecturas is None:
                raise RuntimeError("Open-Meteo no respondió. Comprueba la conexión a Internet.")
            medido_en = datetime.now(timezone.utc)
            id_muestra = time.time_ns() // 1000000
            datos = []
            for codigo, _, unidad_id, _ in variables:
                valor = float(lecturas[CODIGOS[codigo]])
                if not math.isfinite(valor) or valor < 0:
                    raise ValueError(f"Valor inválido para {codigo}.")
                datos.append({"variableCodigo": codigo, "unidadId": unidad_id, "valor": round(valor, 4)})
    clave = os.getenv("Iot__ApiKey") or os.environ["IOT_API_KEY"]
    respuesta = requests.post(
        os.getenv("SIMULADOR_API_URL", "http://127.0.0.1:5051/api/lecturas"),
        headers={"X-Api-Key": clave},
        json={"sensorId": sensor_id, "idMuestra": id_muestra,
              "medidoEn": medido_en.isoformat(), "lecturas": datos},
        timeout=25,
    )
    if respuesta.status_code != 201:
        raise RuntimeError(f"La API rechazó la muestra simulada (HTTP {respuesta.status_code}): {respuesta.text[:500]}")
    resultado = respuesta.json()
    print(f"Simulador: muestra {id_muestra}, sensor {sensor_id}, estado {resultado['estado']}. Cuatro variables de origen simulado; fuente Open-Meteo, PM1 estimado.", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--una-vez", action="store_true")
    parser.add_argument("--esperar-primera", action="store_true")
    args = parser.parse_args()
    intervalo = int(os.getenv("SIMULADOR_INTERVALO_S", "900"))
    if intervalo < 1:
        raise ValueError("SIMULADOR_INTERVALO_S debe ser positivo.")
    if args.una_vez:
        insertar_lecturas()
    else:
        try:
            if args.esperar_primera:
                time.sleep(intervalo)
            while True:
                try:
                    insertar_lecturas()
                except Exception as error:
                    print(f"Simulador: no se guardó la muestra ({type(error).__name__}). Revisa conexión, catálogos y unidades. Se reintentará en {intervalo} s.", flush=True)
                time.sleep(intervalo)
        except KeyboardInterrupt:
            print("Simulador detenido.", flush=True)
