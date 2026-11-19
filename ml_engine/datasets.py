"""Preparación reproducible de datos; no entrena ni escribe en PostgreSQL."""
from dataclasses import dataclass

import numpy as np
import pandas as pd
from sqlalchemy import text


@dataclass(frozen=True)
class Perfil:
    nombre: str
    unidades: dict


PERFILES = {
    'dht11': Perfil('dht11', {'TEMP': '°C', 'HUM': '%'}),
    'bme680': Perfil('bme680', {'TEMP': '°C', 'HUM': '%', 'PRES': 'hPa', 'GAS': 'ohm'}),
    'contaminantes_simulados': Perfil('contaminantes_simulados',
                                    {'CO': 'µg/m3', 'PM1': 'µg/m3', 'PM10': 'µg/m3', 'PM25': 'µg/m3'}),
}


def unidad_normalizada(unidad):
    return str(unidad).replace('μ', 'µ').replace('³', '3').replace('Ω', 'ohm').strip()


def identificar_perfil(modelo, origen):
    modelo = modelo.strip().upper()
    if origen == 'real' and modelo in ('DHT11', 'BME680'):
        return PERFILES[modelo.lower()]
    if origen == 'simulado':
        return PERFILES['contaminantes_simulados']
    raise ValueError('Hardware/origen sin perfil definido; no se infiere por las lecturas disponibles.')


def instante_utc(valor):
    instante = pd.Timestamp(valor)
    if instante.tzinfo is None:
        raise ValueError('Las fechas deben incluir zona horaria, por ejemplo 2026-11-18T00:00:00Z.')
    return instante.tz_convert('UTC')


def cargar_sensor(conexion, sensor_id, desde, hasta):
    """Selecciona un solo sensor con su ubicación; intervalo [desde, hasta)."""
    metadatos = conexion.execute(text('''
        SELECT s.id AS sensor_id, s.nodo_id, s.modelo, s.origen,
               n.intervalo_muestreo_s, si.latitud, si.longitud
        FROM sensor s JOIN nodo n ON n.id=s.nodo_id JOIN sitio si ON si.id=n.sitio_id
        WHERE s.id=:sensor_id
    '''), {'sensor_id': sensor_id}).mappings().one_or_none()
    if metadatos is None:
        raise ValueError('Sensor inexistente.')
    meta = dict(metadatos)
    perfil = identificar_perfil(meta['modelo'], meta['origen'])
    catalogo = conexion.execute(text('''
        SELECT v.codigo, u.simbolo FROM sensor_variable sv
        JOIN variable v ON v.id=sv.variable_id JOIN unidad u ON u.id=v.unidad_id
        WHERE sv.sensor_id=:sensor_id
    '''), {'sensor_id': sensor_id}).mappings().all()
    unidades = {r['codigo']: unidad_normalizada(r['simbolo']) for r in catalogo}
    if unidades != perfil.unidades:
        raise ValueError(f'Catálogo incompatible con perfil {perfil.nombre}; esperado: {perfil.unidades}.')
    df = pd.read_sql(text('''
        SELECT l.id, l.id_muestra, l.medido_en, l.valor, l.calidad, v.codigo
        FROM lectura_original l JOIN variable v ON v.id=l.variable_id
        WHERE l.sensor_id=:sensor_id AND l.medido_en>=:desde AND l.medido_en<:hasta
        ORDER BY l.medido_en,l.id
    '''), conexion, params={'sensor_id': sensor_id, 'desde': desde.to_pydatetime(),
                           'hasta': hasta.to_pydatetime()})
    return meta, perfil, df


def ventanas_horarias(filas, perfil, desde, hasta, intervalo_s, completitud=0.75):
    """Horas UTC completas. Duplicados dentro de un intervalo no inflan cobertura."""
    desde, hasta = instante_utc(desde), instante_utc(hasta)
    if desde >= hasta or desde != desde.floor('h') or hasta != hasta.floor('h'):
        raise ValueError('El rango debe ser creciente y alineado a horas completas UTC.')
    if intervalo_s <= 0 or intervalo_s > 3600 or 3600 % intervalo_s:
        raise ValueError('El intervalo debe dividir exactamente una hora (1..3600 segundos).')
    if not 0 < completitud <= 1:
        raise ValueError('Completitud debe estar en (0,1].')
    indice = pd.date_range(desde, hasta, freq='h', inclusive='left', name='medido_en')
    valores = pd.DataFrame(index=indice, columns=list(perfil.unidades), dtype=float)
    cobertura = pd.DataFrame(0.0, index=indice, columns=list(perfil.unidades))
    df = filas.copy()
    if not df.empty:
        df['medido_en'] = pd.to_datetime(df['medido_en'], utc=True)
        df['valor'] = pd.to_numeric(df['valor'], errors='coerce')
        df = df[(df.calidad == 'valida') & np.isfinite(df.valor)
                & (df.medido_en >= desde) & (df.medido_en < hasta)]
        # Un id_muestra debe identificar un instante único y una sola fila por variable.
        if df.duplicated(['id_muestra', 'codigo']).any():
            raise ValueError('Muestra/variable duplicada en el conjunto.')
        if (df.groupby('id_muestra').medido_en.nunique() > 1).any():
            raise ValueError('Una muestra contiene horas de captura diferentes.')
        df['slot'] = df.medido_en.dt.floor(f'{intervalo_s}s')
        for codigo in perfil.unidades:
            # Media por slot primero: el exceso de envíos no da mayor peso temporal.
            serie = df[df.codigo == codigo].groupby('slot').valor.mean()
            if serie.empty:
                continue
            medias = serie.resample('h').mean().reindex(indice)
            fraccion = serie.resample('h').count().reindex(indice, fill_value=0) / (3600 // intervalo_s)
            cobertura[codigo] = fraccion
            valores[codigo] = medias.where(fraccion >= completitud)
    return valores, cobertura


def objetivos_temporales(horas, variable='PM25', horizontes=(1, 3, 6)):
    """Coincidencia por hora real; nunca desplaza filas sobre huecos."""
    if variable not in horas:
        raise ValueError(f'{variable} no pertenece a este perfil.')
    resultado = horas.copy()
    for h in horizontes:
        if not isinstance(h, int) or h <= 0:
            raise ValueError('Horizonte inválido.')
        resultado[f'{variable}_objetivo_{h}h'] = horas[variable].reindex(
            horas.index + pd.Timedelta(hours=h)).to_numpy()
    return resultado
