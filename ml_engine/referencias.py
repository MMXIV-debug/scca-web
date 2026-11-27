"""Referencias modeladas Open-Meteo (aire y meteorología), para demostración."""
from datetime import datetime, timezone
import math

import pandas as pd
import requests

URL = 'https://air-quality-api.open-meteo.com/v1/air-quality'
VARIABLES = {'PM25': 'pm2_5', 'PM10': 'pm10', 'CO': 'carbon_monoxide'}
URL_METEO = 'https://archive-api.open-meteo.com/v1/archive'
VARIABLES_METEO = {'TEMP': 'temperature_2m', 'HUM': 'relative_humidity_2m', 'PRES': 'surface_pressure'}
UNIDADES_METEO = {'TEMP': '°C', 'HUM': '%', 'PRES': 'hPa'}


def descargar_referencia(latitud, longitud, desde, hasta, timeout=30, perfil='contaminantes_simulados'):
    if perfil not in ('contaminantes_simulados', 'bme680'):
        raise ValueError('Perfil sin referencia definida.')
    meteorologico = perfil != 'contaminantes_simulados'
    variables = VARIABLES_METEO if meteorologico else VARIABLES
    url = URL_METEO if meteorologico else URL
    if not -90 <= latitud <= 90 or not -180 <= longitud <= 180:
        raise ValueError('Coordenadas inválidas.')
    parametros = {'latitude': latitud, 'longitude': longitud,
                  'hourly': ','.join(variables.values()), 'timezone': 'GMT',
                  'timeformat': 'unixtime',
                  'start_date': desde.date().isoformat(),
                  'end_date': (hasta - pd.Timedelta(seconds=1)).date().isoformat()}
    if not meteorologico:
        parametros['domains'] = 'cams_global'
    respuesta = requests.get(url, params=parametros, timeout=timeout)
    respuesta.raise_for_status()
    datos = respuesta.json()
    meta = {'fuente': 'Open-Meteo/Weather' if meteorologico else 'Open-Meteo/CAMS', 'url': url, 'parametros': parametros,
            'consultado_en': datetime.now(timezone.utc).isoformat(),
            'tipo': 'referencia_modelada_demostracion', 'calibracion_fisica_validada': False,
            'latitud_solicitada': latitud, 'longitud_solicitada': longitud,
            'latitud_grilla': datos.get('latitude'), 'longitud_grilla': datos.get('longitude'),
            'atribucion': 'Open-Meteo' if meteorologico else 'Open-Meteo y Copernicus Atmosphere Monitoring Service (CAMS)',
            'variables_sin_referencia': ['GAS', 'ALT'] if perfil == 'bme680' else [],
            'unidades': datos.get('hourly_units', {})}
    return datos, meta


def normalizar_referencia(datos, desde, hasta, perfil='contaminantes_simulados'):
    if perfil not in ('contaminantes_simulados', 'bme680'):
        raise ValueError('Perfil sin referencia definida.')
    variables = VARIABLES if perfil == 'contaminantes_simulados' else VARIABLES_METEO
    hourly = datos['hourly']
    tiempos = pd.to_datetime(hourly['time'], unit='s', utc=True)
    if tiempos.has_duplicates:
        raise ValueError('La referencia contiene horas duplicadas.')
    resultado = pd.DataFrame(index=pd.DatetimeIndex(tiempos, name='medido_en'))
    for codigo, externo in variables.items():
        unidad = datos['hourly_units'][externo].replace('μ', 'µ').replace('³', '3')
        if unidad != UNIDADES_METEO.get(codigo, 'µg/m3'):
            raise ValueError(f'Unidad inesperada en referencia {codigo}.')
        valores = hourly[externo]
        if len(valores) != len(tiempos):
            raise ValueError('Longitud inconsistente en referencia.')
        resultado[codigo] = [float(v) if v is not None and math.isfinite(float(v))
                             and (codigo == 'TEMP' or float(v) >= 0)
                             and (codigo != 'HUM' or float(v) <= 100)
                             and (codigo != 'PRES' or float(v) > 0)
                             else float('nan') for v in valores]
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
