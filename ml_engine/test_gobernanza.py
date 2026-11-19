import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
import pandas as pd
from sklearn.dummy import DummyRegressor

from evaluacion import cargar_dataset, dividir_temporal, evaluar_dataset
from gobernanza import Registro, decidir, escribir_json, hash_archivo, metricas


def dataset_prueba(raiz, n=744, sensor=1, inicio='2026-01-01T00:00:00Z'):
    """Datos sintéticos SOLO en pruebas temporales; nunca en la BD ni dashboard."""
    raiz.mkdir(parents=True)
    indice = pd.date_range(inicio, periods=n, freq='h', name='medido_en')
    x = 10 + np.sin(np.arange(n) / 4) * 3
    horas = pd.DataFrame({'PM25': x}, index=indice)
    horas.to_csv(raiz / 'horas.csv')
    pd.DataFrame({'PM25': np.ones(n)}, index=indice).to_csv(raiz / 'completitud.csv')
    pd.DataFrame({'medido_en': indice, 'original': x, 'referencia': 2 * x + 5,
                  'variable': 'PM25'}).to_csv(raiz / 'pares_demostracion.csv', index=False)
    meta = {'version_formato': 1, 'sensor': {'sensor_id': sensor, 'nodo_id': 1},
            'perfil': 'contaminantes_simulados', 'unidades': {'PM25': 'µg/m3'}, 'completitud_minima': .75,
            'intervalo_s': 900,
            'sha256': {p.name: hash_archivo(p) for p in raiz.iterdir()}}
    escribir_json(raiz / 'manifiesto.json', meta)
    return raiz


class MetricasTests(unittest.TestCase):
    def test_constante_r2_indefinido(self):
        self.assertIsNone(metricas([2, 2], [2, 2])['r2'])

    def test_rechaza_no_finitos(self):
        with self.assertRaises(ValueError):
            metricas([1, 2], [1, np.nan])

    def test_no_permite_regresion_vigente(self):
        base = {'rmse': 10, 'mae': 10, 'sesgo': 10}
        candidato = {'rmse': 2, 'mae': 2, 'sesgo': 2}
        vigente = {'rmse': 1, 'mae': 1, 'sesgo': 1}
        self.assertEqual(decidir(base, candidato, vigente)['estado'], 'rechazado')

    def test_mae_y_sesgo_importan(self):
        base = {'rmse': 10, 'mae': 4, 'sesgo': -1}
        candidato = {'rmse': 5, 'mae': 5, 'sesgo': 2}
        self.assertEqual(decidir(base, candidato)['razones'], ['mae_empeora', 'sesgo_absoluto_empeora'])

    def test_original_perfecto_no_se_degrada(self):
        base = metricas([1, 2], [1, 2])
        self.assertEqual(decidir(base, base)['estado'], 'apto_demo')
        self.assertEqual(decidir(base, metricas([1, 2], [2, 3]))['estado'], 'rechazado')


class CicloTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.raiz = Path(self.temp.name)
        self.datos = dataset_prueba(self.raiz / 'datos')
        self.registro = self.raiz / 'registro'

    def tearDown(self):
        self.temp.cleanup()

    def test_activacion_y_bloqueo_de_reuso(self):
        resultado = evaluar_dataset(self.datos, self.registro)
        self.assertEqual(resultado['estado'], 'apto_demo')
        estado = Registro(self.registro).leer()
        self.assertEqual(estado['activos'][resultado['clave']], resultado['version'])
        repetir = evaluar_dataset(self.datos, self.registro)
        self.assertEqual(repetir['estado'], 'pendiente')
        self.assertIn('prueba_final_consumida', repetir['razones'][0])
        self.assertEqual(Registro(self.registro).leer()['activos'], estado['activos'])

    def test_pares_dispersos_no_sustituyen_cobertura_del_periodo(self):
        datos=dataset_prueba(self.raiz/'dispersos',n=1440)
        horas=pd.read_csv(datos/'horas.csv',index_col='medido_en')
        mantener=np.linspace(0,1439,540,dtype=int)
        horas.iloc[np.setdiff1d(np.arange(1440),mantener),:]=np.nan
        horas.to_csv(datos/'horas.csv')
        cobertura=pd.read_csv(datos/'completitud.csv',index_col='medido_en');cobertura.iloc[np.setdiff1d(np.arange(1440),mantener),:]=0;cobertura.to_csv(datos/'completitud.csv')
        pares=pd.read_csv(datos/'pares_demostracion.csv').iloc[mantener];pares.to_csv(datos/'pares_demostracion.csv',index=False)
        meta=json.loads((datos/'manifiesto.json').read_text())
        for nombre in ['horas.csv','completitud.csv','pares_demostracion.csv']:meta['sha256'][nombre]=hash_archivo(datos/nombre)
        escribir_json(datos/'manifiesto.json',meta)
        r=evaluar_dataset(datos,self.registro)
        self.assertEqual(r['estado'],'pendiente');self.assertIn('cobertura_temporal_insuficiente',r['razones'])

    def test_no_mezcla_sensores_en_registro(self):
        a = evaluar_dataset(self.datos, self.registro)
        b = evaluar_dataset(dataset_prueba(self.raiz / 'sensor2', sensor=2), self.registro)
        self.assertNotEqual(a['clave'], b['clave'])
        self.assertEqual(len(Registro(self.registro).leer()['activos']), 2)

    def test_datos_insuficientes_no_entrenan(self):
        pocos = dataset_prueba(self.raiz / 'pocos', n=20)
        with patch('evaluacion.candidatos', side_effect=AssertionError('No debe entrenar')):
            resultado = evaluar_dataset(pocos, self.registro)
        self.assertEqual(resultado['estado'], 'pendiente')
        self.assertEqual(Registro(self.registro).leer()['activos'], {})

    def test_anomalias_no_usa_rmse_para_aprobar(self):
        resultado = evaluar_dataset(self.datos, self.registro, 'anomalias')
        self.assertEqual(resultado['estado'], 'pendiente')

    def test_referencia_vacia_queda_pendiente(self):
        ruta = self.datos / 'pares_demostracion.csv'
        ruta.write_text('medido_en,original,referencia,variable\n', encoding='utf-8')
        meta = json.loads((self.datos / 'manifiesto.json').read_text(encoding='utf-8'))
        meta['sha256'][ruta.name] = hash_archivo(ruta)
        escribir_json(self.datos / 'manifiesto.json', meta)
        resultado = evaluar_dataset(self.datos, self.registro)
        self.assertEqual(resultado['razones'], ['sin_pares_de_referencia_validos'])

    def test_reversion_restaura_version_anterior_integra(self):
        primero = evaluar_dataset(self.datos, self.registro)
        # Un segundo período genuinamente posterior, idéntica ley sintética.
        posterior = dataset_prueba(self.raiz / 'posterior', inicio='2026-03-01T00:00:00Z')
        segundo = evaluar_dataset(posterior, self.registro)
        self.assertEqual(segundo['estado'], 'apto_demo')
        registro = Registro(self.registro)
        self.assertEqual(registro.revertir(segundo['clave'], 'incidente'), primero['version'])
        self.assertEqual(registro.leer()['activos'][primero['clave']], primero['version'])

    def test_candidato_malo_conserva_vigente(self):
        primero = evaluar_dataset(self.datos, self.registro)
        posterior = dataset_prueba(self.raiz / 'posterior', inicio='2026-03-01T00:00:00Z')
        with patch('evaluacion.candidatos', return_value={'malo': DummyRegressor(strategy='constant', constant=100)}):
            segundo = evaluar_dataset(posterior, self.registro)
        self.assertEqual(segundo['estado'], 'rechazado')
        self.assertEqual(segundo['vigente_comparado'], primero['version'])
        self.assertEqual(Registro(self.registro).leer()['activos'][primero['clave']], primero['version'])

    def test_reversion_rechaza_artefacto_anterior_corrupto(self):
        primero = evaluar_dataset(self.datos, self.registro)
        segundo = evaluar_dataset(dataset_prueba(self.raiz / 'posterior', inicio='2026-03-01T00:00:00Z'), self.registro)
        (self.registro / primero['artefacto']).write_bytes(b'corrupto')
        registro = Registro(self.registro)
        with self.assertRaises(ValueError):
            registro.revertir(segundo['clave'], 'incidente')
        self.assertEqual(registro.leer()['activos'][segundo['clave']], segundo['version'])

    def test_dataset_modificado_se_rechaza(self):
        with (self.datos / 'horas.csv').open('a') as f:
            f.write('alterado')
        with self.assertRaises(ValueError):
            cargar_dataset(self.datos)

    def test_reversion_suspende_y_deja_sin_activo_si_no_hay_anterior(self):
        resultado = evaluar_dataset(self.datos, self.registro)
        registro = Registro(self.registro)
        self.assertIsNone(registro.revertir(resultado['clave'], 'degradación observada'))
        estado = registro.leer()
        self.assertEqual(estado['activos'], {})
        self.assertEqual(estado['modelos'][resultado['version']]['estado'], 'suspendido')

    def test_bloqueo_excluye_dos_escritores(self):
        registro = Registro(self.registro)
        with registro.bloquear():
            with self.assertRaises(ValueError):
                with registro.bloquear():
                    pass

    def test_fallo_reemplazo_conserva_registro(self):
        registro = Registro(self.registro)
        estado = registro.leer()
        registro.guardar(estado)
        nuevo = registro.leer()
        nuevo['activos']['prueba'] = 'inexistente'
        with patch('gobernanza.os.replace', side_effect=OSError('prueba')):
            with self.assertRaises(OSError):
                registro.guardar(nuevo)
        self.assertEqual(registro.leer(), estado)

    def test_fallo_en_test_consume_periodo_y_no_activa(self):
        with patch('evaluacion.decidir', side_effect=RuntimeError('fallo')):
            with self.assertRaises(RuntimeError):
                evaluar_dataset(self.datos, self.registro)
        estado = Registro(self.registro).leer()
        self.assertTrue(estado['pruebas_consumidas'])
        self.assertFalse(estado['activos'])
        self.assertEqual(evaluar_dataset(self.datos, self.registro)['estado'], 'pendiente')

    def test_pronostico_purga_fronteras_temporales(self):
        indice = pd.date_range('2026-01-01', periods=744, freq='h', tz='UTC')
        datos = pd.DataFrame({'PM25': range(744), 'objetivo': range(744),
                             'hora_objetivo': indice + pd.Timedelta(hours=6)}, index=indice)
        entrenamiento, ajuste, validacion, prueba = dividir_temporal(datos)
        self.assertLess(entrenamiento.hora_objetivo.max(), prueba.index.min())
        self.assertLess(ajuste.hora_objetivo.max(), validacion.index.min())

    def test_pronostico_xgboost_ejecuta_ciclo(self):
        resultado = evaluar_dataset(self.datos, self.registro, 'pronostico', 'PM25', 1)
        self.assertIn(resultado['estado'], ('apto_demo', 'rechazado'))
        self.assertEqual(resultado['algoritmo'], 'xgboost')


if __name__ == '__main__':
    unittest.main()
