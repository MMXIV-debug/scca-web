from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import joblib
import pandas as pd

app = FastAPI(title="SCCA - ML Inference Service")

# Cargar los modelos pre-entrenados al arrancar el servidor
try:
    detector = joblib.load('modelos_guardados/detector_anomalias.joblib')
    forecaster = joblib.load('modelos_guardados/forecaster.joblib')
except FileNotFoundError:
    print("Advertencia: No se encontraron modelos. Ejecuta entrenador.py primero.")

# Estructura de datos esperada
class LecturaSensor(BaseModel):
    valor_pm25: float

@app.post("/api/predict/anomaly")
def detectar_anomalia(lectura: LecturaSensor):
    """
    Recibe un valor en tiempo real y evalúa si es anómalo.
    Devuelve 1 (Normal) o -1 (Anomalía).
    """
    prediccion = detector.predict([[lectura.valor_pm25]])
    es_anomalia = bool(prediccion[0] == -1)
    
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