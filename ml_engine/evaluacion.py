"""Selección temporal interna y una prueba final por período, sin acceso a la BD."""
import json
from pathlib import Path
import platform
import uuid
import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.ensemble import RandomForestRegressor
from sklearn.linear_model import LinearRegression
from datasets import instante_utc, objetivos_temporales
from gobernanza import POLITICA, Registro, ahora, decidir, escribir_json, hash_archivo, metricas


def cargar_dataset(carpeta):
    carpeta = Path(carpeta).resolve()
    manifiesto = json.loads((carpeta / 'manifiesto.json').read_text(encoding='utf-8'))
    if manifiesto['version_formato'] != 1:
        raise ValueError('Formato de dataset no compatible.')
    for nombre, esperado in manifiesto['sha256'].items():
        ruta = (carpeta / nombre).resolve()
        if not ruta.is_relative_to(carpeta) or hash_archivo(ruta) != esperado:
            raise ValueError('Un archivo del dataset no supera la comprobación SHA-256.')
    for requerido in ('horas.csv', 'completitud.csv'):
        if requerido not in manifiesto['sha256']:
            raise ValueError(f'Falta hash de {requerido}.')
    horas = pd.read_csv(carpeta / 'horas.csv', index_col='medido_en')
    cobertura = pd.read_csv(carpeta / 'completitud.csv', index_col='medido_en')
    for tabla in (horas, cobertura):
        tabla.index = pd.DatetimeIndex([instante_utc(t) for t in tabla.index], name='medido_en')
        if tabla.index.has_duplicates or not tabla.index.is_monotonic_increasing:
            raise ValueError('Las horas deben ser únicas y estar ordenadas.')
        if not tabla.index.equals(tabla.index.floor('h')):
            raise ValueError('Datos fuera de una ventana horaria.')
    columnas = list(manifiesto['unidades'])
    if list(horas.columns) != columnas or not cobertura.columns.equals(horas.columns) or not cobertura.index.equals(horas.index):
        raise ValueError('Cobertura, perfil y datos no coinciden.')
    if manifiesto['completitud_minima'] < POLITICA['completitud_minima']:
        raise ValueError('El conjunto usa menor completitud que la política de evaluación.')
    if not np.isfinite(cobertura.to_numpy()).all() or ((cobertura < 0) | (cobertura > 1)).any().any():
        raise ValueError('Cobertura inválida.')
    horas = horas.where(cobertura >= POLITICA['completitud_minima'])
    if np.isinf(horas.to_numpy(dtype=float)).any():
        raise ValueError('El dataset contiene valores infinitos.')
    return manifiesto, horas


def construir_objetivo(carpeta, manifiesto, horas, proposito, variable, horizonte):
    if variable not in horas:
        raise ValueError('La variable objetivo no pertenece al perfil.')
    if proposito == 'calibracion':
        if 'pares_demostracion.csv' not in manifiesto['sha256']:
            return None, 'sin_referencia'
        pares = pd.read_csv(Path(carpeta) / 'pares_demostracion.csv')
        pares = pares[pares.variable == variable].copy()
        if pares.empty:
            return None, 'sin_pares_de_referencia_validos'
        pares['original'] = pd.to_numeric(pares['original'], errors='raise')
        pares['referencia'] = pd.to_numeric(pares['referencia'], errors='raise')
        pares['medido_en'] = [instante_utc(t) for t in pares.medido_en]
        if pares.medido_en.duplicated().any():
            raise ValueError('Referencia duplicada para hora y variable.')
        pares = pares.set_index('medido_en')
        datos = horas[[variable]].join(pares[['referencia', 'original']], how='inner')
        if not np.allclose(datos[variable], datos.original, equal_nan=True):
            raise ValueError('El valor original del par no coincide con la serie horaria.')
        datos = datos.drop(columns='original').rename(columns={'referencia': 'objetivo'})
        datos['hora_objetivo'] = datos.index
    else:
        if horizonte not in (1, 3, 6):
            raise ValueError('El horizonte debe ser 1, 3 o 6 horas.')
        datos = objetivos_temporales(horas, variable, (horizonte,)).rename(
            columns={f'{variable}_objetivo_{horizonte}h': 'objetivo'})
        datos['hora_objetivo'] = datos.index + pd.Timedelta(hours=horizonte)
    datos = datos.dropna()
    if not np.isfinite(datos.drop(columns='hora_objetivo').to_numpy(dtype=float)).all():
        raise ValueError('Objetivos no finitos.')
    return datos, None


def dividir_temporal(datos):
    corte = int(len(datos) * (1 - POLITICA['fraccion_prueba']))
    prueba = datos.iloc[corte:]
    entrenamiento = datos.iloc[:corte]
    entrenamiento = entrenamiento[entrenamiento.hora_objetivo < prueba.index[0]]
    corte_interno = int(len(entrenamiento) * 0.8)
    validacion = entrenamiento.iloc[corte_interno:]
    ajuste = entrenamiento.iloc[:corte_interno]
    ajuste = ajuste[ajuste.hora_objetivo < validacion.index[0]]
    if min(len(ajuste), len(validacion), len(prueba)) < 2:
        raise ValueError('Datos insuficientes tras separar ventanas temporales.')
    return entrenamiento, ajuste, validacion, prueba


def candidatos(proposito):
    if proposito == 'calibracion':
        return {'regresion_lineal': LinearRegression(),
                'random_forest': RandomForestRegressor(n_estimators=80, max_depth=8, random_state=42, n_jobs=1)}
    from xgboost import XGBRegressor
    return {'xgboost': XGBRegressor(objective='reg:squarederror', n_estimators=80,
                                    max_depth=3, learning_rate=.05, random_state=42, n_jobs=1)}


def evaluar_dataset(carpeta, raiz_registro, proposito='calibracion', variable='PM25', horizonte=1):
    if proposito not in ('calibracion', 'pronostico', 'anomalias'):
        raise ValueError('Propósito no compatible.')
    manifiesto, horas = cargar_dataset(carpeta)
    sensor = manifiesto['sensor']
    clave = f'nodo_{sensor["nodo_id"]}/sensor_{sensor["sensor_id"]}/{manifiesto["perfil"]}/{proposito}/{variable}'
    if proposito == 'pronostico':
        clave += f'/{horizonte}h'
    registro = Registro(raiz_registro)
    version = uuid.uuid4().hex
    informe = {'version': version, 'clave': clave, 'ambito': 'demostracion', 'estado': 'pendiente',
               'creado_en': ahora(), 'politica': dict(POLITICA), 'proposito': proposito,
               'variable': variable, 'horizonte_h': horizonte if proposito == 'pronostico' else 0,
               'dataset_sha256': hash_archivo(Path(carpeta) / 'manifiesto.json'),
               'perfil': manifiesto['perfil'], 'sensor': {'sensor_id': sensor['sensor_id'], 'nodo_id': sensor['nodo_id']},
               'calibracion_fisica_validada': False, 'validacion_independiente': False,
               'razones': [], 'runtime': {'python': platform.python_version(), 'sklearn': sklearn.__version__}}
    with registro.bloquear():
        estado = registro.leer()
        carpeta_version = registro.raiz / 'versiones' / version
        carpeta_version.mkdir(parents=True)

        def terminar():
            escribir_json(carpeta_version / 'informe.json', informe)
            estado['modelos'][version] = informe
            estado['eventos'].append({'fecha': ahora(), 'accion': 'evaluar', 'version': version, 'estado': informe['estado']})
            registro.guardar(estado)
            if informe['estado'] == 'apto_demo':
                registro.promover(estado, version)
            return informe

        if proposito == 'anomalias':
            informe['razones'] = ['sin_etiquetas_y_politica_especifica_para_anomalias']
            return terminar()
        datos, motivo = construir_objetivo(carpeta, manifiesto, horas, proposito, variable, horizonte)
        if motivo:
            informe['razones'] = [motivo]
            return terminar()
        informe['pares'] = len(datos)
        duracion = 0 if datos.empty else (datos.index[-1] - datos.index[0] + pd.Timedelta(hours=1)).total_seconds() / 86400
        informe['dias_cubiertos'] = duracion
        if len(datos) < POLITICA['pares_minimos'] or duracion < POLITICA['dias_minimos']:
            informe['razones'] = ['pares_o_periodo_insuficientes']
            return terminar()
        entrenamiento, ajuste, validacion, prueba = dividir_temporal(datos)
        columnas = [c for c in datos if c not in ('objetivo', 'hora_objetivo')]
        informe['variables_entrada'] = columnas
        informe['dominio'] = {c: [float(entrenamiento[c].min()), float(entrenamiento[c].max())] for c in columnas}
        informe['particiones'] = {nombre: {'n': len(df), 'inicio': df.index[0].isoformat(), 'fin': df.index[-1].isoformat()}
                                  for nombre, df in [('entrenamiento', entrenamiento), ('ajuste_interno', ajuste),
                                                   ('validacion_interna', validacion), ('prueba_final', prueba)]}
        inicio, fin = prueba.index[0].isoformat(), prueba.hora_objetivo.max().isoformat()
        limite = estado['pruebas_consumidas'].get(clave)
        if limite and inicio <= limite:
            informe['razones'] = ['prueba_final_consumida_se_requiere_periodo_posterior']
            return terminar()
        modelos = candidatos(proposito)
        resultados = {}
        for nombre, modelo in modelos.items():
            modelo.fit(ajuste[columnas], ajuste.objetivo)
            resultados[nombre] = metricas(validacion.objetivo, modelo.predict(validacion[columnas]))
        elegido = min(resultados, key=lambda n: (resultados[n]['rmse'], resultados[n]['mae'], n))
        modelo = modelos[elegido]
        modelo.fit(entrenamiento[columnas], entrenamiento.objetivo)
        informe.update({'algoritmo': elegido, 'validacion_interna': resultados,
                        'parametros': modelo.get_params(), 'vigente_comparado': estado['activos'].get(clave)})
        informe['parametros'] = {k: (None if isinstance(v, float) and not np.isfinite(v) else v)
                                 for k, v in informe['parametros'].items()}
        registro.reservar_prueba(estado, clave, inicio, fin, version)
        try:
            base = metricas(prueba.objetivo, prueba[variable])
            nueva = metricas(prueba.objetivo, modelo.predict(prueba[columnas]))
            vigente = None
            if informe['vigente_comparado']:
                entrada = estado['modelos'][informe['vigente_comparado']]
                anterior = joblib.load(registro.artefacto(entrada))
                if list(anterior.feature_names_in_) != columnas:
                    raise ValueError('Contrato del modelo vigente incompatible con el dataset.')
                vigente = metricas(prueba.objetivo, anterior.predict(prueba[columnas]))
            informe.update(decidir(base, nueva, vigente))
            informe['metricas'] = {'base': base, 'candidato': nueva, 'vigente': vigente}
            artefacto = carpeta_version / 'modelo.joblib'
            joblib.dump(modelo, artefacto)
            informe['artefacto'] = artefacto.relative_to(registro.raiz).as_posix()
            informe['sha256'] = hash_archivo(artefacto)
        except Exception as error:
            informe.update({'estado': 'error', 'razones': [type(error).__name__], 'prueba_consumida': True})
            terminar()
            raise
        return terminar()
