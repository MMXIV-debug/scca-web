import os
import time
import psycopg2
from datetime import datetime, timezone
from dotenv import load_dotenv
from adaptadores import OpenMeteoAdapter # Importamos el patrón Adapter

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

def insertar_lecturas(conexion):
    SENSOR_ID = 1
    
    # Instanciamos el adaptador (Facilita el cambio a otro proveedor a futuro)
    proveedor = OpenMeteoAdapter()
    lecturas = proveedor.obtener_lecturas(LATITUD, LONGITUD)
    
    if lecturas is None: 
        return

    # Consumir el diccionario universal devuelto por el adaptador
    VARIABLES = {
        'PM1': {'id': 1, 'unidad': 1, 'valor': lecturas['PM1']},
        'PM2.5': {'id': 2, 'unidad': 1, 'valor': lecturas['PM2.5']},
        'PM10': {'id': 3, 'unidad': 1, 'valor': lecturas['PM10']},
        'CO': {'id': 4, 'unidad': 1, 'valor': lecturas['CO']}
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
        print(f"[{medido_en.strftime('%H:%M:%S')}] Datos reales guardados mediante Adapter\n")
    except Exception as e:
        print(f"Error de Inserción: {e}")
        conexion.rollback()

if __name__ == "__main__":
    print(f"Iniciando captura con Adapter en (Lat: {LATITUD}, Lon: {LONGITUD})...")
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