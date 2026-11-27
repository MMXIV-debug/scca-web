"""CLI de preparación. Escribe artefactos locales, nunca tablas ni modelos activos."""
import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
import uuid

import pandas as pd
from sqlalchemy import text

from datasets import cargar_sensor, instante_utc, ventanas_horarias, objetivos_temporales, unidad_normalizada
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
            unidades_id={r.codigo:r.unidad_id for r in conexion.execute(text('SELECT v.codigo,v.unidad_id FROM sensor_variable sv JOIN variable v ON v.id=sv.variable_id WHERE sv.sensor_id=:sensor'),{'sensor':args.sensor_id})}
            revisadas=conexion.execute(text("""
                SELECT q.id::text AS cuarentena_id,q.payload,a.id::text AS decision_id,
                       a.datos_despues->>'clasificacion' AS clasificacion
                FROM lectura_cuarentena q JOIN auditoria_evento a ON a.entidad='lectura_cuarentena'
                  AND a.entidad_id=q.id AND a.accion IN ('restaurar','descartar')
                WHERE q.payload->>'sensorId'=:sensor AND a.datos_despues->>'clasificacion'
                  IN ('normal','episodio_ambiental','fallo_sensor')
                ORDER BY a.id
            """),{'sensor':str(args.sensor_id)}).mappings().all()
            ref_fuente_id = getattr(args, 'referencia_fuente_id', None)
            ref_bd_meta = None
            ref_bd_filas = []
            if ref_fuente_id is not None:
                ref_bd_meta = conexion.execute(
                    text('SELECT id, nombre, sitio_id, calibracion_ref FROM referencia_fuente WHERE id=:fid'),
                    {'fid': int(ref_fuente_id)},
                ).mappings().one_or_none()
                if not ref_bd_meta:
                    raise ValueError(f'Fuente de referencia inexistente: {ref_fuente_id}')
                ref_bd_filas = conexion.execute(text("""
                    SELECT v.codigo, u.simbolo, rl.medido_en, rl.valor::float AS valor
                    FROM referencia_lectura rl
                    JOIN variable v ON v.id = rl.variable_id
                    JOIN unidad u ON u.id = rl.unidad_id
                    WHERE rl.fuente_id = :fid AND rl.medido_en >= :desde AND rl.medido_en < :hasta
                    ORDER BY rl.medido_en
                """), {'fid': int(ref_fuente_id), 'desde': desde, 'hasta': hasta}).mappings().all()
    # El simulador no siempre comparte la frecuencia de captura configurada para el nodo.
    if meta['origen'] == 'simulado' and args.intervalo_s is None:
        raise ValueError('Para datos simulados especifica --intervalo-s según la frecuencia histórica real.')
    intervalo = args.intervalo_s if args.intervalo_s is not None else meta['intervalo_muestreo_s']
    horas, cobertura = ventanas_horarias(filas, perfil, desde, hasta, intervalo, args.completitud)
    referencia = None
    ref_calibrada = None
    pares = pd.DataFrame(columns=['medido_en', 'variable', 'original', 'referencia'])
    normalizada = None
    if ref_bd_meta is not None:
        filas_ref = []
        for r in ref_bd_filas:
            if r['codigo'] not in perfil.unidades:
                continue
            if unidad_normalizada(r['simbolo']) != perfil.unidades[r['codigo']]:
                raise ValueError(f"Unidad incompatible en referencia_lectura para {r['codigo']}: {r['simbolo']}")
            filas_ref.append({'medido_en': instante_utc(r['medido_en']).floor('h'), 'codigo': r['codigo'], 'valor': float(r['valor'])})
        if filas_ref:
            df_ref = pd.DataFrame(filas_ref).groupby(['medido_en', 'codigo'], as_index=False)['valor'].mean()
            normalizada = df_ref.pivot(index='medido_en', columns='codigo', values='valor').sort_index()
            normalizada.index = pd.DatetimeIndex(normalizada.index, name='medido_en', tz='UTC')
            pares = emparejar_referencia(horas, normalizada)
        else:
            normalizada = pd.DataFrame(index=pd.DatetimeIndex([], name='medido_en', tz='UTC'))
        ref_calibrada = {
            'tipo': 'referencia_calibrada_bd',
            'fuente_id': int(ref_bd_meta['id']),
            'nombre': ref_bd_meta['nombre'],
            'calibracion_ref': ref_bd_meta['calibracion_ref'],
            'filas_extraidas': len(filas_ref),
        }
    elif args.referencia_open_meteo:
        if perfil.nombre not in ('contaminantes_simulados', 'bme680'):
            raise ValueError('Referencia Open-Meteo no configurada para este perfil.')
        try:
            referencia = descargar_referencia(float(meta['latitud']), float(meta['longitud']), desde, hasta, perfil=perfil.nombre)
            normalizada = normalizar_referencia(referencia[0], desde, hasta, perfil=perfil.nombre)
            pares = emparejar_referencia(horas, normalizada)
        except Exception:
            if not getattr(args, 'referencia_opcional', False):
                raise
            referencia = None  # pronóstico puede prepararse aunque falle la referencia de calibración
    raiz = Path(args.salida).resolve()
    carpeta = raiz / f'nodo_{meta["nodo_id"]}' / f'sensor_{meta["sensor_id"]}' / perfil.nombre / (
        datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '_' + uuid.uuid4().hex[:8])
    carpeta.mkdir(parents=True, exist_ok=False)
    filas.to_csv(carpeta / 'originales.csv', index=False)
    etiquetas=[]
    for r in revisadas:
        try:
            p=r['payload'];fecha=instante_utc(p['medidoEn'])
            valores={l['variableCodigo']:float(l['valor']) for l in p['lecturas']}
            if len(p['lecturas'])!=len(valores) or any(l.get('unidadId')!=unidades_id.get(l.get('variableCodigo')) for l in p['lecturas']):
                continue
            if not desde<=fecha<hasta or set(valores)!=set(perfil.unidades):
                continue
            import math
            if not all(math.isfinite(v) for v in valores.values()):
                continue
            if any((c!='TEMP' and v<0) or c=='HUM' and v>100 or c in ('PRES','GAS') and v<=0 or c=='TEMP' and (v< -273.15 or perfil.nombre=='dht11' and not 0<=v<=50) for c,v in valores.items()):
                continue
            etiquetas.append({'medido_en':fecha,'es_fallo':int(r['clasificacion']=='fallo_sensor'),
                'cuarentena_id':r['cuarentena_id'],'decision_id':r['decision_id'],**valores})
        except (KeyError,TypeError,ValueError):
            continue
    pd.DataFrame(etiquetas,columns=['medido_en','es_fallo','cuarentena_id','decision_id',*perfil.unidades]).to_csv(carpeta/'anomalias_revisadas.csv',index=False)
    horas.to_csv(carpeta / 'horas.csv')
    cobertura.to_csv(carpeta / 'completitud.csv')
    if 'PM25' in horas:
        objetivos_temporales(horas).to_csv(carpeta / 'objetivos_pm25.csv')
    historial_fuente = bool(getattr(args, 'historial_fuente', False) and referencia and perfil.nombre == 'contaminantes_simulados')
    if historial_fuente:
        # Historial del proveedor, separado de originales del nodo y sin insertarlo en BD.
        fuente = normalizada.copy()
        fuente['PM1'] = (fuente.PM25 * .70).round(2)
        fuente = fuente.reindex(columns=list(perfil.unidades))
        fuente.to_csv(carpeta/'historial_fuente.csv')
        guardar_json(carpeta/'historial_fuente_procedencia.json', referencia[1])
    if referencia:
        guardar_json(carpeta / 'referencia_respuesta.json', referencia[0])
        guardar_json(carpeta / 'referencia_procedencia.json', referencia[1])
        normalizada.to_csv(carpeta / 'referencia_horaria.csv')
        pares.to_csv(carpeta / 'pares_demostracion.csv', index=False)
    elif ref_calibrada:
        guardar_json(carpeta / 'referencia_procedencia.json', ref_calibrada)
        normalizada.to_csv(carpeta / 'referencia_horaria.csv')
        pares.to_csv(carpeta / 'pares_demostracion.csv', index=False)
    tiene_ref = bool(referencia or ref_calibrada)
    manifiesto = {
        'version_formato': 1, 'creado_en': datetime.now(timezone.utc).isoformat(),
        'sensor': meta, 'perfil': perfil.nombre, 'unidades': perfil.unidades,
        'desde_inclusivo': desde, 'hasta_exclusivo': hasta, 'zona_horaria': 'UTC',
        'intervalo_s': intervalo, 'intervalo_s_explicito': args.intervalo_s is not None,
        'completitud_minima': args.completitud, 'agregacion': 'media por intervalo y después por hora',
        'filas_extraidas': len(filas), 'horas_completas_multivariantes': int(horas.dropna().shape[0]),
        'etiquetas_humanas_compatibles':len(etiquetas),
        'horas_validas_por_variable': {c: int(horas[c].count()) for c in horas},
        'referencia_modelada': bool(referencia), 'referencia_calibrada': ref_calibrada,
        'validacion_independiente': bool(ref_calibrada and meta['origen'] == 'real'),
        'calibracion_fisica_validada': False,
        'historial_fuente': historial_fuente,
        'procedencia_variables': ({'PM25':'Open-Meteo/CAMS','PM10':'Open-Meteo/CAMS','CO':'Open-Meteo/CAMS','PM1':'estimado: 0.70 × PM25'} if perfil.nombre=='contaminantes_simulados' else {c:'sensor físico' for c in perfil.unidades}),
        'procedencia_original': ('simulado; procedencia histórica no persistida; simulador actual usa Open-Meteo'
                               if meta['origen'] == 'simulado' else 'sensor físico; exactitud no validada'),
        'advertencias': ['No constituye un modelo apto ni una validación científica.',
                        'El intervalo debe corresponder al período histórico; no se infiere de huecos.',
                        'Datos simulados y referencia Open-Meteo pueden compartir fuente; no son independientes.'],
        'pares_por_variable': (pares.groupby('variable').size().to_dict() if tiene_ref and not pares.empty else {}),
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
    parser.add_argument('--referencia-fuente-id', type=int)
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
