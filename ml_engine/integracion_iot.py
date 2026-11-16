"""Validación de lecturas con el detector de anomalías."""
import math

import pandas as pd
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field


class MuestraModelo(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    valores: dict[str, float] = Field(min_length=1, max_length=32)


def variables_del_modelo(detector):
    if detector is None:
        raise HTTPException(503, "No se pudo cargar el detector de anomalías.")
    nombres = getattr(detector, "feature_names_in_", None)
    if nombres is not None:
        return [str(nombre) for nombre in nombres]
    # Compatibilidad con modelos antiguos de una sola variable.
    if getattr(detector, "n_features_in_", None) == 1:
        return ["PM25"]
    raise HTTPException(503, "El modelo no contiene nombres de variables; debe exportarse con sus metadatos.")


def evaluar(detector, valores):
    nombres = variables_del_modelo(detector)
    if set(valores) != set(nombres):
        raise HTTPException(422, {"variables_requeridas": nombres})
    if any(not math.isfinite(v) or v < 0 for v in valores.values()):
        raise HTTPException(422, "Las concentraciones deben ser finitas y no negativas.")
    entrada = pd.DataFrame([[valores[n] for n in nombres]], columns=nombres)
    if getattr(detector, "feature_names_in_", None) is None:
        entrada = entrada.to_numpy()
    try:
        prediccion = detector.predict(entrada)
        if len(prediccion) != 1 or prediccion[0] not in (-1, 1):
            raise ValueError("Salida no válida del detector")
    except Exception as error:
        raise HTTPException(503, "No se pudo ejecutar el detector de anomalías.") from error
    return bool(prediccion[0] == -1)


def crear_router(obtener_detector):
    router = APIRouter()

    @router.get("/api/modelo")
    def informacion_modelo():
        return {"disponible": True, "variables": variables_del_modelo(obtener_detector())}

    @router.post("/api/predict/muestra")
    def evaluar_muestra(muestra: MuestraModelo):
        es_anomalia = evaluar(obtener_detector(), muestra.valores)
        return {
            "es_anomalia": es_anomalia,
            "accion_sugerida": "cuarentena" if es_anomalia else "guardar_original",
        }

    return router
