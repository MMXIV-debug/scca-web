"""Referencia modelada Open-Meteo/CAMS, exclusivamente para demostración."""
from datetime import datetime, timezone
import math

import pandas as pd
import requests

URL = 'https://air-quality-api.open-meteo.com/v1/air-quality'
VARIABLES = {'PM25': 'pm2_5', 'PM10': 'pm10', 'CO': 'carbon_monoxide'}


def descargar_referencia(latitud, longitud, desde, hasta):
    if not -90 <= latitud <= 90 or not -180 <= longitud <= 180:
        raise ValueError('Coordenadas inválidas.')
    parametros = {'latitude': latitud, 'longitude': longitud,
                  'hourly': ','.join(VARIABLES.values()), 'timezone': 'GMT',
                  'domains': 'cams_global', 'timeformat': 'unixtime',
                  'start_date': desde.date().isoformat(),
                  'end_date': (hasta - pd.Timedelta(seconds=1)).date().isoformat()}
    respuesta = requests.get(URL, params=parametros, timeout=30)
    respuesta.raise_for_status()
    datos = respuesta.json()
    meta = {'fuente': 'Open-Meteo/CAMS', 'url': URL, 'parametros': parametros,
            'consultado_en': datetime.now(timezone.utc).isoformat(),
            'tipo': 'referencia_modelada_demostracion', 'calibracion_fisica_validada': False,
            'latitud_solicitada': latitud, 'longitud_solicitada': longitud,
            'latitud_grilla': datos.get('latitude'), 'longitud_grilla': datos.get('longitude'),
            'atribucion': 'Open-Meteo y Copernicus Atmosphere Monitoring Service (CAMS)',
            'unidades': datos.get('hourly_units', {})}
    return datos, meta


def normalizar_referencia(datos, desde, hasta):
    hourly = datos['hourly']
    tiempos = pd.to_datetime(hourly['time'], unit='s', utc=True)
    if tiempos.has_duplicates:
        raise ValueError('La referencia contiene horas duplicadas.')
    resultado = pd.DataFrame(index=pd.DatetimeIndex(tiempos, name='medido_en'))
    for codigo, externo in VARIABLES.items():
        unidad = datos['hourly_units'][externo].replace('μ', 'µ').replace('³', '3')
        if unidad != 'µg/m3':
            raise ValueError(f'Unidad inesperada en referencia {codigo}.')
        valores = hourly[externo]
        if len(valores) != len(tiempos):
            raise ValueError('Longitud inconsistente en referencia.')
        resultado[codigo] = [float(v) if v is not None and math.isfinite(float(v))
                             and float(v) >= 0 else float('nan') for v in valores]
    return resultado[(resultado.index >= desde) & (resultado.index < hasta)]


def emparejar_referencia(horas, referencia):
    # No interpolar ni rellenar: cada par requiere la misma hora y variable.
    variables = [c for c in horas if c in referencia]
    pares = []
    for codigo in variables:
        par = pd.concat([horas[codigo].rename('original'),
                         referencia[codigo].rename('referencia')], axis=1).dropna()
        par['variable'] = codigo
        pares.append(par.reset_index())
    return pd.concat(pares, ignore_index=True) if pares else pd.DataFrame(
        columns=['medido_en', 'original', 'referencia', 'variable'])
