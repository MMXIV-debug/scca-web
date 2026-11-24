import argparse
import math
import os
import time
from datetime import datetime, timezone
from decimal import Decimal

import psycopg2
from psycopg2.extras import RealDictCursor
import requests
from dotenv import load_dotenv
from adaptadores import OpenMeteoAdapter

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".env"))
CODIGOS = {"PM1": "PM1", "PM25": "PM2.5", "PM10": "PM10", "CO": "CO"}


def verificar_guardado(muestra, filas):
    esperadas = {l['variableCodigo']: l for l in muestra['lecturas']}
    if len(filas) != len(esperadas) or {f['codigo'] for f in filas} != set(esperadas):
        raise RuntimeError('La base no contiene todas y solo las variables enviadas.')
    for fila in filas:
        enviada = esperadas[fila['codigo']]
        if (fila['sensor_id'] != muestra['sensorId'] or fila['id_muestra'] != muestra['idMuestra']
                or fila['unidad_id'] != enviada['unidadId']
                or Decimal(str(fila['valor'])) != Decimal(str(enviada['valor']))
                or fila['medido_en'] != datetime.fromisoformat(muestra['medidoEn'])):
            raise RuntimeError('El registro guardado no coincide con la muestra enviada.')


def comprobar_en_base(muestra, estado):
    with psycopg2.connect(os.environ['DATABASE_URL'], connect_timeout=10) as conexion:
        conexion.set_session(readonly=True)
        with conexion.cursor(cursor_factory=RealDictCursor) as cursor:
            if estado == 'guardada':
                cursor.execute('''
                    SELECT l.id,l.sensor_id,l.id_muestra,v.codigo,l.unidad_id,l.valor,
                           u.simbolo,l.medido_en,l.recibido_en,l.calidad
                    FROM lectura_original l JOIN variable v ON v.id=l.variable_id
                    JOIN unidad u ON u.id=l.unidad_id
                    WHERE l.sensor_id=%s AND l.id_muestra=%s ORDER BY v.codigo
                ''', (muestra['sensorId'], muestra['idMuestra']))
                filas = cursor.fetchall()
                verificar_guardado(muestra, filas)
                print('\n3. POSTGRESQL: registros leídos directamente de lectura_original', flush=True)
                for fila in filas:
                    fecha = fila['recibido_en'].astimezone(timezone.utc).isoformat()
                    print(f"   Fila {fila['id']} | {fila['codigo']}: {fila['valor']} {fila['simbolo']} | calidad: {fila['calidad']} | recibido: {fecha}", flush=True)
                print(f"\nCOMPROBADO: las {len(filas)} variables enviadas a la API están guardadas con el mismo sensor, muestra, unidad, fecha y valor.", flush=True)
            elif estado == 'cuarentena':
                cursor.execute('''SELECT id,payload,causa FROM lectura_cuarentena
                    WHERE payload->>'sensorId'=%s AND payload->>'idMuestra'=%s''',
                    (str(muestra['sensorId']), str(muestra['idMuestra'])))
                registros = cursor.fetchall()
                if len(registros) != 1:
                    raise RuntimeError('No se encontró una única muestra en cuarentena.')
                fila = registros[0]
                p = fila['payload']
                verificar_guardado(muestra, [dict(sensor_id=p['sensorId'], id_muestra=int(p['idMuestra']),
                    codigo=l['variableCodigo'], unidad_id=l['unidadId'], valor=l['valor'],
                    medido_en=datetime.fromisoformat(p['medidoEn'].replace('Z', '+00:00'))) for l in p['lecturas']])
                print(f"\n3. POSTGRESQL: muestra guardada en lectura_cuarentena, ID {fila['id']}. Causa: {fila['causa']}", flush=True)
                print('COMPROBADO: la API recibió la muestra y PostgreSQL la conserva en cuarentena; no ingresó como lectura válida.', flush=True)
            else:
                raise RuntimeError('La API devolvió un estado de guardado desconocido.')


def insertar_lecturas(demostrar=False):
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

            cursor.execute("SELECT si.latitud,si.longitud FROM sensor s JOIN nodo n ON n.id=s.nodo_id JOIN sitio si ON si.id=n.sitio_id WHERE s.id=%s", (sensor_id,))
            sitio=cursor.fetchone()
            latitud,longitud=float(sitio[0]),float(sitio[1])
            if abs(float(os.getenv('SIMULADOR_LATITUD',str(latitud)))-latitud)>.0001 or abs(float(os.getenv('SIMULADOR_LONGITUD',str(longitud)))-longitud)>.0001:
                raise ValueError('Las coordenadas del simulador deben coincidir con el sitio del sensor.')
            lecturas = OpenMeteoAdapter().obtener_lecturas(latitud,longitud)
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
    muestra = {"sensorId": sensor_id, "idMuestra": id_muestra,
               "medidoEn": medido_en.isoformat(), "lecturas": datos}
    url = os.getenv("SIMULADOR_API_URL", f"http://127.0.0.1:{os.getenv('API_PORT', '5051')}/api/lecturas")
    if demostrar:
        print('\nDEMOSTRACIÓN: SIMULADOR -> API -> POSTGRESQL', flush=True)
        print('Fuente Open-Meteo; sensor de origen simulado. No son mediciones físicas.', flush=True)
        print(f'\n1. ENVÍO: POST {url}\n   Sensor: {sensor_id} | Muestra: {id_muestra}\n   Medido en UTC: {muestra["medidoEn"]}', flush=True)
        for lectura in datos:
            print(f"   {lectura['variableCodigo']}: {lectura['valor']} µg/m³ | unidad ID: {lectura['unidadId']}", flush=True)
    respuesta = requests.post(
        url,
        headers={"X-Api-Key": clave},
        json=muestra,
        timeout=25,
    )
    if respuesta.status_code != 201:
        raise RuntimeError(f"La API rechazó la muestra simulada (HTTP {respuesta.status_code}): {respuesta.text[:500]}")
    resultado = respuesta.json()
    if demostrar:
        if resultado.get('sensorId') != sensor_id or resultado.get('idMuestra') != id_muestra:
            raise RuntimeError('La identidad de la respuesta no coincide con el envío.')
        print(f"\n2. RESPUESTA API: HTTP {respuesta.status_code} | estado: {resultado['estado']}\n   Sensor: {resultado['sensorId']} | Muestra: {resultado['idMuestra']} | IDs: {resultado.get('ids', [])}", flush=True)
        comprobar_en_base(muestra, resultado['estado'])
    print(f"Simulador: muestra {id_muestra}, sensor {sensor_id}, estado {resultado['estado']}. Cuatro variables de origen simulado; fuente Open-Meteo, PM1 estimado.", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--una-vez", action="store_true")
    parser.add_argument("--esperar-primera", action="store_true")
    parser.add_argument("--demostrar", action="store_true", help="Un envío a la API y comprobación directa en PostgreSQL.")
    args = parser.parse_args()
    intervalo = int(os.getenv("SIMULADOR_INTERVALO_S", "900"))
    if intervalo < 1:
        raise ValueError("SIMULADOR_INTERVALO_S debe ser positivo.")
    if args.una_vez or args.demostrar:
        try:
            insertar_lecturas(demostrar=args.demostrar)
        except Exception as error:
            if not args.demostrar:
                raise
            print(f'\nNO COMPROBADO ({type(error).__name__}). Revisa que node iniciar.js esté abierto y que API, PostgreSQL y Open-Meteo estén disponibles. Si la API respondió, la muestra puede estar guardada; conserva el ID mostrado.', flush=True)
            raise SystemExit(1)
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
