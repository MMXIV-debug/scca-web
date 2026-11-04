import os
import time
import requests
import psycopg2
from datetime import datetime, timezone
from dotenv import load_dotenv

# 1. Cargar el .env desde la raíz del proyecto
ruta_env = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.env')
load_dotenv(ruta_env)

# 2. Ubicación: Santa Cruz de la Sierra, Bolivia
LATITUD = -17.7833
LONGITUD = -63.1821

def conectar_db():
    try:
        database_url = os.getenv("DATABASE_URL")
        return psycopg2.connect(database_url)
    except Exception as e:
        print(f"Error BD: {e}")
        return None

def obtener_datos_reales():
    # Agregamos 'carbon_monoxide' a la consulta de la API
    url = f"https://air-quality-api.open-meteo.com/v1/air-quality?latitude={LATITUD}&longitude={LONGITUD}&current=pm10,pm2_5,carbon_monoxide"
    
    try:
        respuesta = requests.get(url, timeout=10)
        respuesta.raise_for_status()
        datos = respuesta.json()
        
        # Extraemos los datos reales
        pm2_5 = datos['current']['pm2_5']
        pm10 = datos['current']['pm10']
        co = datos['current']['carbon_monoxide']
        
        # El PM1 suele ser ~70% del PM2.5 real
        pm1 = round(pm2_5 * 0.70, 2)
        
        return pm1, pm2_5, pm10, co
    except requests.exceptions.RequestException as e:
        print(f"Error API: {e}")
        return None, None, None, None

def insertar_lecturas(conexion):
    SENSOR_ID = 1
    pm1, pm2_5, pm10, co = obtener_datos_reales()
    
    if pm1 is None: return

    # Ahora el ID 4 corresponde a Monóxido de Carbono (CO) usando µg/m3 (unidad 1)
    VARIABLES = {
        'PM1': {'id': 1, 'unidad': 1, 'valor': pm1},
        'PM2.5': {'id': 2, 'unidad': 1, 'valor': pm2_5},
        'PM10': {'id': 3, 'unidad': 1, 'valor': pm10},
        'CO': {'id': 4, 'unidad': 1, 'valor': co}
    }
    
    medido_en = datetime.now(timezone.utc)
    id_muestra = int(time.time() * 1000)

    try: 
        cursor = conexion.cursor()
        query = """
            INSERT INTO public.lectura_original
            (sensor_id, variable_id, unidad_id, id_muestra, valor, medido_en, calidad)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
        """

        for nombre, data in VARIABLES.items():
            cursor.execute(query, (
                SENSOR_ID, data['id'], data['unidad'], id_muestra, data['valor'], medido_en, 'valida'
            ))
            print(f"Guardado {nombre}: {data['valor']} µg/m3")

        conexion.commit()
        cursor.close()
        print(f"[{medido_en.strftime('%H:%M:%S')}] Datos reales guardados\n")
    except Exception as e:
        print(f"Error de Inserción: {e}")
        conexion.rollback()

if __name__ == "__main__":
    print(f"Iniciando captura en Santa Cruz (Lat: {LATITUD}, Lon: {LONGITUD})...")
    conexion_db = conectar_db()
    
    if conexion_db:
        try:
            while True:
                insertar_lecturas(conexion_db)
                time.sleep(900) # Cada 15 minutos
        except KeyboardInterrupt:
            print("\nDetenido.")
        finally:
            conexion_db.close()
            print("Cerrado.")