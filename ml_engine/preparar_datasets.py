"""CLI de preparación. Escribe artefactos locales, nunca tablas ni modelos activos."""
import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
import uuid

import pandas as pd
from sqlalchemy import text

from datasets import cargar_sensor, instante_utc, ventanas_horarias, objetivos_temporales
from referencias import descargar_referencia, normalizar_referencia, emparejar_referencia


def guardar_json(ruta, valor):
    ruta.write_text(json.dumps(valor, ensure_ascii=False, indent=2, default=str), encoding='utf-8')


def preparar(args):
    desde, hasta = instante_utc(args.desde), instante_utc(args.hasta)
    if desde >= hasta or desde != desde.floor('h') or hasta != hasta.floor('h'):
        raise ValueError('Usa un rango creciente de horas completas con zona horaria.')
    if hasta > pd.Timestamp.now(tz='UTC').floor('h'):
        raise ValueError('No se preparan horas actuales incompletas ni futuras.')
    if (hasta - desde) > pd.Timedelta(days=366):
        raise ValueError('Prepara como máximo 366 días por ejecución.')
    from base_datos import engine
    with engine.connect() as conexion:
        with conexion.begin():
            conexion.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY'))
            conexion.execute(text("SET LOCAL statement_timeout = '30s'"))
            meta, perfil, filas = cargar_sensor(conexion, args.sensor_id, desde, hasta)
    # El simulador no siempre comparte la frecuencia de captura configurada para el nodo.
    if meta['origen'] == 'simulado' and args.intervalo_s is None:
        raise ValueError('Para datos simulados especifica --intervalo-s según la frecuencia histórica real.')
    intervalo = args.intervalo_s if args.intervalo_s is not None else meta['intervalo_muestreo_s']
    horas, cobertura = ventanas_horarias(filas, perfil, desde, hasta, intervalo, args.completitud)
    referencia = None
    if args.referencia_open_meteo:
        if perfil.nombre != 'contaminantes_simulados':
            raise ValueError('Esta referencia de aire solo cubre contaminantes, no DHT11/BME680.')
        referencia = descargar_referencia(float(meta['latitud']), float(meta['longitud']), desde, hasta)
        normalizada = normalizar_referencia(referencia[0], desde, hasta)
        pares = emparejar_referencia(horas, normalizada)
    raiz = Path(args.salida).resolve()
    carpeta = raiz / f'nodo_{meta["nodo_id"]}' / f'sensor_{meta["sensor_id"]}' / perfil.nombre / (
        datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '_' + uuid.uuid4().hex[:8])
    carpeta.mkdir(parents=True, exist_ok=False)
    filas.to_csv(carpeta / 'originales.csv', index=False)
    horas.to_csv(carpeta / 'horas.csv')
    cobertura.to_csv(carpeta / 'completitud.csv')
    if 'PM25' in horas:
        objetivos_temporales(horas).to_csv(carpeta / 'objetivos_pm25.csv')
    if referencia:
        guardar_json(carpeta / 'referencia_respuesta.json', referencia[0])
        guardar_json(carpeta / 'referencia_procedencia.json', referencia[1])
        normalizada.to_csv(carpeta / 'referencia_horaria.csv')
        pares.to_csv(carpeta / 'pares_demostracion.csv', index=False)
    manifiesto = {
        'version_formato': 1, 'creado_en': datetime.now(timezone.utc).isoformat(),
        'sensor': meta, 'perfil': perfil.nombre, 'unidades': perfil.unidades,
        'desde_inclusivo': desde, 'hasta_exclusivo': hasta, 'zona_horaria': 'UTC',
        'intervalo_s': intervalo, 'intervalo_s_explicito': args.intervalo_s is not None,
        'completitud_minima': args.completitud, 'agregacion': 'media por intervalo y después por hora',
        'filas_extraidas': len(filas), 'horas_completas_multivariantes': int(horas.dropna().shape[0]),
        'horas_validas_por_variable': {c: int(horas[c].count()) for c in horas},
        'referencia_modelada': bool(referencia), 'validacion_independiente': False,
        'calibracion_fisica_validada': False,
        'procedencia_original': ('simulado; procedencia histórica no persistida; simulador actual usa Open-Meteo'
                               if meta['origen'] == 'simulado' else 'sensor físico; exactitud no validada'),
        'advertencias': ['No constituye un modelo apto ni una validación científica.',
                        'El intervalo debe corresponder al período histórico; no se infiere de huecos.',
                        'Datos simulados y referencia Open-Meteo pueden compartir fuente; no son independientes.'],
        'pares_por_variable': (pares.groupby('variable').size().to_dict() if referencia else {}),
    }
    manifiesto['sha256'] = {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                            for p in sorted(carpeta.iterdir()) if p.is_file()}
    guardar_json(carpeta / 'manifiesto.json', manifiesto)
    return carpeta, manifiesto


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sensor-id', type=int, required=True)
    parser.add_argument('--desde', required=True)
    parser.add_argument('--hasta', required=True)
    parser.add_argument('--intervalo-s', type=int)
    parser.add_argument('--completitud', type=float, default=0.75)
    parser.add_argument('--referencia-open-meteo', action='store_true')
    parser.add_argument('--salida', default=str(Path(__file__).resolve().parent / 'datasets_generados'))
    args = parser.parse_args()
    try:
        carpeta, meta = preparar(args)
    except (ValueError, KeyError) as error:
        parser.exit(2, f'Preparación rechazada: {error}\n')
    except Exception as error:
        # No imprimir URLs de conexión, credenciales ni el contenido de respuestas remotas.
        parser.exit(1, f'No se pudo preparar el conjunto ({type(error).__name__}). Revisa conectividad y configuración.\n')
    print(f'Dataset: {carpeta}')
    print(f'Horas completas: {meta["horas_completas_multivariantes"]}; filas: {meta["filas_extraidas"]}')


if __name__ == '__main__':
    main()
