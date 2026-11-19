"""Inferencia versionada de demostración; no persiste lecturas ni resultados."""
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import io
import json
import math
from pathlib import Path
from typing import Literal

import joblib
import pandas as pd
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator

from datasets import PERFILES


class SeleccionModelo(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    nodo_id: int = Field(gt=0, strict=True)
    sensor_id: int = Field(gt=0, strict=True)
    perfil: Literal['dht11', 'bme680', 'contaminantes_simulados']
    proposito: Literal['calibracion', 'pronostico', 'anomalias']
    variable: str = Field(min_length=1, max_length=20)
    horizonte_h: Literal[0, 1, 3, 6] = 0

    @model_validator(mode='after')
    def comprobar(self):
        if self.variable not in PERFILES[self.perfil].unidades:
            raise ValueError('Variable ajena al perfil.')
        if (self.proposito == 'pronostico') != (self.horizonte_h > 0):
            raise ValueError('Pronóstico exige horizonte 1/3/6; los otros propósitos exigen 0.')
        return self

    def clave(self):
        clave = f'nodo_{self.nodo_id}/sensor_{self.sensor_id}/{self.perfil}/{self.proposito}/{self.variable}'
        return clave + (f'/{self.horizonte_h}h' if self.proposito == 'pronostico' else '')


class EntradaModelo(SeleccionModelo):
    valores: dict[str, float] = Field(min_length=1, max_length=4)
    periodo_inicio: datetime
    periodo_fin: datetime
    # Precondición contra activación/reversión concurrente entre estado e inferencia.
    modelo_version: str = Field(pattern=r'^[a-f0-9]{32}$')

    @model_validator(mode='after')
    def comprobar_periodo(self):
        if self.periodo_inicio.tzinfo is None or self.periodo_fin.tzinfo is None:
            raise ValueError('Las fechas requieren zona horaria.')
        inicio = self.periodo_inicio.astimezone(timezone.utc)
        fin = self.periodo_fin.astimezone(timezone.utc)
        if inicio.minute or inicio.second or inicio.microsecond or fin - inicio != timedelta(hours=1):
            raise ValueError('Se requiere una hora UTC completa, no una lectura instantánea.')
        if fin > datetime.now(timezone.utc):
            raise ValueError('El período no puede estar abierto ni en el futuro.')
        if not set(self.valores).issubset(PERFILES[self.perfil].unidades):
            raise ValueError('Variables ajenas al perfil.')
        return self


class ServicioRegistro:
    def __init__(self, raiz):
        self.raiz = Path(raiz).resolve()

    def resolver(self, seleccion):
        ruta = self.raiz / 'registro.json'
        if not ruta.exists():
            return None
        try:
            estado = json.loads(ruta.read_text(encoding='utf-8'))
            if estado['version'] != 1 or estado['ambito'] != 'demostracion':
                raise ValueError('Registro incompatible')
            version = estado['activos'].get(seleccion.clave())
            if not version:
                return None
            entrada = estado['modelos'][version]
            if (entrada['version'] != version or entrada['clave'] != seleccion.clave()
                    or entrada['estado'] != 'apto_demo' or entrada['ambito'] != 'demostracion'
                    or entrada['sensor'] != {'nodo_id': seleccion.nodo_id, 'sensor_id': seleccion.sensor_id}
                    or entrada['perfil'] != seleccion.perfil or entrada['proposito'] != seleccion.proposito
                    or entrada['variable'] != seleccion.variable or entrada['horizonte_h'] != seleccion.horizonte_h):
                raise ValueError('Identidad/estado incompatible')
            if entrada['entrada_agregado_s'] != 3600 or entrada['intervalo_s'] <= 0 or 3600 % entrada['intervalo_s']:
                raise ValueError('Contrato temporal incompatible')
            cobertura = entrada['politica']['completitud_minima']
            if not math.isfinite(cobertura) or not .75 <= cobertura <= 1:
                raise ValueError('Política de cobertura incompatible')
            columnas = entrada['variables_entrada']
            if not columnas or len(set(columnas)) != len(columnas) or not set(columnas).issubset(PERFILES[seleccion.perfil].unidades):
                raise ValueError('Contrato de variables incompatible')
            for c in columnas:
                minimo, maximo = entrada['dominio'][c]
                if not math.isfinite(minimo) or not math.isfinite(maximo) or minimo > maximo:
                    raise ValueError('Dominio inválido')
            return entrada
        except (OSError, ValueError, KeyError, TypeError) as exc:
            raise HTTPException(503, 'Registro de modelos incompatible o no disponible.') from exc

    def respuesta(self, seleccion, entrada):
        return {'estado': 'disponible_demo' if entrada else 'sin_modelo',
                'ambito': 'demostracion', 'calibracion_fisica_validada': False,
                'nodo_id': seleccion.nodo_id, 'sensor_id': seleccion.sensor_id,
                'perfil': seleccion.perfil, 'proposito': seleccion.proposito,
                'variable': seleccion.variable, 'horizonte_h': seleccion.horizonte_h,
                'modelo_version': entrada['version'] if entrada else None,
                'variables_entrada': entrada['variables_entrada'] if entrada else [],
                'entrada_agregado_s': entrada['entrada_agregado_s'] if entrada else None,
                'intervalo_s': entrada['intervalo_s'] if entrada else None,
                'completitud_minima': entrada['politica']['completitud_minima'] if entrada else None,
                # Copia de evaluación sin rutas locales, secretos ni objeto serializado.
                'modelo_metadatos': {k: entrada[k] for k in (
                    'version', 'perfil', 'proposito', 'variable', 'horizonte_h',
                    'algoritmo', 'sha256', 'dataset_sha256', 'politica',
                    'variables_entrada', 'dominio', 'entrada_agregado_s', 'intervalo_s',
                    'metricas', 'particiones', 'creado_en') if k in entrada} if entrada else None,
                'valor': None, 'es_anomalia': None}

    def estado(self, seleccion):
        entrada = self.resolver(seleccion)
        return self.respuesta(seleccion, entrada)

    def inferir(self, solicitud):
        entrada = self.resolver(solicitud)
        respuesta = self.respuesta(solicitud, entrada)
        if not entrada or entrada['version'] != solicitud.modelo_version:
            raise HTTPException(409, 'Cambió el modelo activo; consulta su estado y recalcula la entrada.')
        if solicitud.proposito == 'anomalias':
            raise HTTPException(503, 'La evaluación de anomalías por perfiles aún no está habilitada.')
        columnas = entrada['variables_entrada']
        if set(solicitud.valores) != set(columnas):
            raise HTTPException(422, {'variables_requeridas': columnas})
        if any(not entrada['dominio'][c][0] <= solicitud.valores[c] <= entrada['dominio'][c][1] for c in columnas):
            respuesta['estado'] = 'fuera_dominio'
            return respuesta
        try:
            ruta = (self.raiz / entrada['artefacto']).resolve()
            if not ruta.is_relative_to(self.raiz):
                raise ValueError('Ruta fuera del registro')
            contenido = ruta.read_bytes()
            if hashlib.sha256(contenido).hexdigest() != entrada['sha256']:
                raise ValueError('Hash incorrecto')
            modelo = joblib.load(io.BytesIO(contenido))
            if list(modelo.feature_names_in_) != columnas:
                raise ValueError('Columnas de artefacto incompatibles')
            salida = modelo.predict(pd.DataFrame([[solicitud.valores[c] for c in columnas]], columns=columnas))
            if len(salida) != 1 or not math.isfinite(float(salida[0])):
                raise ValueError('Salida no finita')
            valor = float(salida[0])
            if solicitud.variable != 'TEMP' and valor < 0:
                raise ValueError('Salida física negativa')
            if solicitud.variable == 'HUM' and not 0 <= valor <= 100:
                raise ValueError('Humedad fuera de rango')
        except Exception as exc:
            raise HTTPException(503, 'No se pudo verificar o ejecutar el artefacto activo.') from exc
        respuesta.update({'estado': 'evaluado_demo', 'valor': valor,
                          'unidad': PERFILES[solicitud.perfil].unidades[solicitud.variable],
                          'periodo_inicio': solicitud.periodo_inicio, 'periodo_fin': solicitud.periodo_fin,
                          'objetivo_inicio': solicitud.periodo_inicio + timedelta(hours=solicitud.horizonte_h),
                          'objetivo_fin': solicitud.periodo_fin + timedelta(hours=solicitud.horizonte_h)})
        return respuesta


def crear_router_registro(raiz, obtener_clave):
    servicio = ServicioRegistro(raiz)

    def autenticar(x_api_key: str | None = Header(default=None)):
        esperada = obtener_clave()
        if not esperada:
            raise HTTPException(503, 'Falta configurar la credencial del servicio ML.')
        if not x_api_key or not hmac.compare_digest(x_api_key.encode(), esperada.encode()):
            raise HTTPException(401, 'Credencial inválida.')

    router = APIRouter(prefix='/api/v2/modelos', dependencies=[Depends(autenticar)])

    @router.post('/estado')
    def estado(solicitud: SeleccionModelo):
        return servicio.estado(solicitud)

    @router.post('/inferir')
    def inferir(solicitud: EntradaModelo):
        return servicio.inferir(solicitud)

    return router
