from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict, Field
import joblib
import logging
from pathlib import Path
from integracion_iot import crear_router, evaluar

import os
import io
import hashlib
from dotenv import load_dotenv
from inferencia_registro import crear_router_registro

app = FastAPI(title="SCCA - ML Inference Service")
load_dotenv(Path(__file__).resolve().parent.parent / '.env')
app.include_router(crear_router_registro(
    os.getenv('ML_REGISTRO_DIR', str(Path(__file__).resolve().parent / 'registro_modelos_demo')),
    lambda: os.getenv('Iot__ApiKey') or os.getenv('IOT_API_KEY'),lambda:detector,lambda:versiones_legacy.get('detector')))

detector = None
forecaster = None
versiones_legacy = {}
carpeta_modelos = Path(__file__).resolve().parent / "modelos_guardados"

# Cargar los modelos pre-entrenados al arrancar el servidor
for nombre, archivo in (("detector", "detector_anomalias.joblib"), ("forecaster", "forecaster.joblib")):
    try:
        contenido = (carpeta_modelos / archivo).read_bytes()
        globals()[nombre] = joblib.load(io.BytesIO(contenido))
        versiones_legacy[nombre] = hashlib.sha256(contenido).hexdigest()
    except Exception:
        logging.exception("No se pudo cargar el modelo %s", nombre)

app.include_router(crear_router(lambda: detector, lambda: versiones_legacy.get('detector')))

# Estructura de datos esperada
class LecturaSensor(BaseModel):
    model_config=ConfigDict(allow_inf_nan=False,extra='forbid')
    valor_pm25: float=Field(ge=0)

@app.post("/api/predict/anomaly",deprecated=True)
def detectar_anomalia(lectura: LecturaSensor):
    """Ruta univariante retirada; usar la ingesta completa con perfil y trazabilidad."""
    raise HTTPException(410,"Usa /api/lecturas para ingresar una muestra completa por perfil. El detector actual exige CO, PM1, PM10 y PM25; no se rellenan variables ausentes.")

@app.post("/api/predict/forecast",deprecated=True)
def predecir_futuro(lectura: LecturaSensor):
    """Contrato legado retirado: una lectura instantánea no es una hora agregada."""
    raise HTTPException(410, "Usa POST /api/modelo/evaluar con sensorId, horaInicio, variable PM25 y horizonteH 1, 3 o 6. El resultado identifica modelo, cobertura y validación.")

# Para ejecutar el servidor:
# uvicorn inferencia:app --reload --port 8000
