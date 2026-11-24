"""Modelo controlado y=2x+1, exclusivo de la demostración local aislada."""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import uuid

import joblib
import numpy as np
import pandas as pd
from sklearn.linear_model import LinearRegression

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'ml_engine'))
from gobernanza import Registro, POLITICA, hash_archivo, ahora


def preparar(carpeta):
    raiz = Path(carpeta).resolve()
    if not raiz.parent.name.startswith('correccion-ml-') or not (raiz.parent / 'entorno-aislado.json').is_file():
        raise ValueError('Este modelo solo puede crearse dentro del entorno aislado de prueba:correccion.')
    registro = Registro(raiz)
    version = uuid.uuid4().hex
    destino = raiz / 'versiones' / version
    destino.mkdir(parents=True)
    # Coeficientes conocidos de un fixture. No se presentan como calibración aprendida.
    modelo = LinearRegression().fit(pd.DataFrame({'TEMP': [0., 10., 20.]}), [1., 21., 41.])
    modelo.coef_ = np.array([2.])
    modelo.intercept_ = 1.
    joblib.dump(modelo, destino / 'modelo.joblib')
    datos = 'TEMP,referencia_prueba\n0,1\n10,21\n20,41\n'
    (destino / 'pares_controlados.csv').write_text(datos, encoding='utf-8')
    clave = 'nodo_1/sensor_1/dht11/calibracion/TEMP'
    entrada = dict(version=version, clave=clave, ambito='demostracion', estado='apto_demo',
        creado_en=ahora(), perfil='dht11', sensor={'nodo_id': 1, 'sensor_id': 1},
        proposito='calibracion', variable='TEMP', horizonte_h=0, algoritmo='regresion_lineal',
        variables_entrada=['TEMP'], dominio={'TEMP': [0., 20.]}, entrada_agregado_s=3600,
        intervalo_s=900, politica={**POLITICA, 'version': 'fixture-y2x1'},
        parametros={'coeficiente': 2., 'intercepto': 1.},
        artefacto=f'versiones/{version}/modelo.joblib', sha256=hash_archivo(destino / 'modelo.joblib'),
        dataset_sha256=hashlib.sha256(datos.encode()).hexdigest(),
        vigente_comparado=None, calibracion_fisica_validada=False, validacion_independiente=False,
        procedencia_entrenamiento='Fixture controlado y=2x+1; no es calibración física',
        razones=['modelo_controlado_de_prueba'])
    estado = registro.leer()
    estado['modelos'][version] = entrada
    registro.guardar(estado)
    registro.promover(estado, version)
    print(json.dumps({'version': version, 'clave': clave, 'formula': 'y=2x+1'}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--registro', required=True)
    preparar(parser.parse_args().registro)
