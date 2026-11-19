from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import joblib
import logging
from pathlib import Path
from integracion_iot import crear_router, evaluar
import pandas as pd
import os
from dotenv import load_dotenv
from inferencia_registro import crear_router_registro

app = FastAPI(title="SCCA - ML Inference Service")
load_dotenv(Path(__file__).resolve().parent.parent / '.env')
app.include_router(crear_router_registro(
    os.getenv('ML_REGISTRO_DIR', str(Path(__file__).resolve().parent / 'registro_modelos_demo')),
    lambda: os.getenv('Iot__ApiKey') or os.getenv('IOT_API_KEY')))

detector = None
forecaster = None
carpeta_modelos = Path(__file__).resolve().parent / "modelos_guardados"

# Cargar los modelos pre-entrenados al arrancar el servidor
for nombre, archivo in (("detector", "detector_anomalias.joblib"), ("forecaster", "forecaster.joblib")):
    try:
        globals()[nombre] = joblib.load(carpeta_modelos / archivo)
    except Exception:
        logging.exception("No se pudo cargar el modelo %s", nombre)

app.include_router(crear_router(lambda: detector))

# Estructura de datos esperada
class LecturaSensor(BaseModel):
    valor_pm25: float

@app.post("/api/predict/anomaly")
def detectar_anomalia(lectura: LecturaSensor):
    """
    Recibe un valor en tiempo real y evalúa si es anómalo.
    Devuelve 1 (Normal) o -1 (Anomalía).
    """
    es_anomalia = evaluar(detector, {"PM25": lectura.valor_pm25})
    
    return {
        "valor_recibido": lectura.valor_pm25,
        "es_anomalia": es_anomalia,
        "accion_sugerida": "cuarentena" if es_anomalia else "guardar_original"
    }

@app.post("/api/predict/forecast")
def predecir_futuro(lectura: LecturaSensor):
    """
    En base a la lectura actual, predice cuál será el valor en la próxima hora.
    (Y lanza una alerta temprana si se prevé que cruce umbrales peligrosos).
    """
    if forecaster is None:
        raise HTTPException(503, "El modelo de pronóstico no está disponible.")
    if list(getattr(forecaster, "feature_names_in_", [])) != ["valor_anterior"]:
        raise HTTPException(422, "Este modelo requiere otras variables de entrada; el pronóstico univariante no es compatible.")
    # XGBoost espera un DataFrame con el nombre de la columna (valor_anterior)
    X_entrada = pd.DataFrame([{'valor_anterior': lectura.valor_pm25}])
    valor_predicho = float(forecaster.predict(X_entrada)[0])
    
    # Lógica de disparador de Alerta Temprana (Ej. límite EPA Dañino > 55.4)
    alerta = None
    if valor_predicho > 55.4:
         alerta = "ALERTA_TEMPRANA_CONTAMINACION"

    return {
        "pm25_actual": lectura.valor_pm25,
        "pm25_predicho_proxima_hora": round(valor_predicho, 2),
        "alerta_disparada": alerta
    }

# Para ejecutar el servidor:
# uvicorn inferencia:app --reload --port 8000
