"""Preparar/evaluar modelos de demostración sin reemplazar los artefactos legados.

La tarea semanal llama a este archivo, no al entrenador sin argumentos.
Los datos se leen en modo READ ONLY. Los candidatos y el historial son locales.
"""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
from types import SimpleNamespace
import uuid

import pandas as pd
from sqlalchemy import text

from datasets import identificar_perfil
from evaluacion import evaluar_dataset
from gobernanza import POLITICA, Registro, escribir_json, ahora
from preparar_datasets import preparar


def ejecutar(raiz=None):
    from base_datos import engine
    raiz = Path(raiz or os.getenv('ML_REGISTRO_DIR', Path(__file__).resolve().parent / 'registro_modelos_demo'))
    historial = Registro(raiz / 'ciclos')
    resumen = {'id': uuid.uuid4().hex, 'inicio': ahora(), 'estado': 'ejecutando', 'resultados': [], 'errores': []}
    with historial.bloquear():
        with engine.connect() as c, c.begin():
            c.execute(text('SET TRANSACTION READ ONLY'))
            c.execute(text("SET LOCAL statement_timeout='30s'"))
            p = c.execute(text('SELECT * FROM politica_ml WHERE vigente_hasta IS NULL ORDER BY version DESC LIMIT 1')).mappings().one_or_none()
            if not p:
                raise ValueError('No hay política vigente; aplicar migración 09 y configurar el panel.')
            sensores = c.execute(text("SELECT s.id,s.modelo,s.origen,n.intervalo_muestreo_s FROM sensor s JOIN nodo n ON n.id=s.nodo_id WHERE s.activo AND n.estado NOT IN ('inactivo','mantenimiento') ORDER BY s.id")).mappings().all()
        politica = {**POLITICA, 'version': p['version'], 'politica_id': p['id'],
                    'pares_minimos': p['pares_minimos'], 'dias_minimos': p['colocacion_dias'],
                    'fraccion_prueba': float(p['test_pct'])/100,
                    'completitud_minima': float(p['completitud_min_pct'])/100,
                    'mejora_rmse_minima': float(p['mejora_rmse_min_pct'])/100,
                    'anomalias':p['configuracion'].get('anomalias',{}),
                    'arranque_demo':p['configuracion'].get('arranque_demo',False)}
        resumen['politica_version'] = p['version']
        hasta = pd.Timestamp.now(tz='UTC').floor('h')
        dias=max(politica['dias_minimos'],politica['anomalias'].get('dias_minimos',7))
        desde = hasta - pd.Timedelta(days=7 if politica['arranque_demo'] else min(366, max(60, dias + 7)))
        for sensor in sensores:
            try:
                perfil = identificar_perfil(sensor['modelo'], sensor['origen'])
                intervalo = p['configuracion'].get('intervalos_sensor', {}).get(str(sensor['id']))
                if intervalo is None and sensor['origen'] == 'simulado':
                    raise ValueError('Configurar la frecuencia histórica del simulador en Políticas.')
                intervalo = intervalo or sensor['intervalo_muestreo_s']
                carpeta, _ = preparar(SimpleNamespace(sensor_id=sensor['id'], desde=desde.isoformat(), hasta=hasta.isoformat(),
                    intervalo_s=intervalo, completitud=politica['completitud_minima'],
                    referencia_open_meteo=perfil.nombre=='contaminantes_simulados', referencia_opcional=True,
                    historial_fuente=politica['arranque_demo'] and perfil.nombre=='contaminantes_simulados',
                    salida=str(raiz / 'datasets')))
                tareas = [('calibracion', v, 0) for v in perfil.unidades]
                tareas.append(('anomalias', 'PM25' if 'PM25' in perfil.unidades else 'TEMP', 0))
                if 'PM25' in perfil.unidades:
                    tareas.extend(('pronostico', 'PM25', h) for h in (1,3,6))
                for proposito, variable, horizonte in tareas:
                    try:
                        r = evaluar_dataset(carpeta, raiz, proposito, variable, horizonte, politica)
                        resumen['resultados'].append({k:r.get(k) for k in ('version','estado','razones','perfil','sensor','proposito','variable','horizonte_h','pares','dias_cubiertos')})
                    except Exception as e:
                        resumen['errores'].append({'sensor_id':sensor['id'],'proposito':proposito,'variable':variable,'horizonte_h':horizonte,'tipo':type(e).__name__})
            except Exception as e:
                resumen['errores'].append({'sensor_id':sensor['id'],'tipo':type(e).__name__})
        resumen['estado'] = 'completado_con_errores' if resumen['errores'] else 'completado'
        resumen['fin'] = ahora()
        escribir_json(historial.raiz / (resumen['id']+'.json'), resumen)
    return resumen


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--registro')
    args=parser.parse_args()
    try:
        r=ejecutar(args.registro)
        print(json.dumps(r,ensure_ascii=False))
        raise SystemExit(1 if r['errores'] else 0)
    except (ValueError, OSError) as e:
        parser.exit(2, f'Ciclo no ejecutado ({type(e).__name__}). Revisa política, conexión y bloqueo local.\n')
    except Exception as e:
        parser.exit(1, f'Ciclo fallido ({type(e).__name__}). El modelo vigente se conserva.\n')
