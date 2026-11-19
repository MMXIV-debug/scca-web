import unittest

import pandas as pd

from datasets import PERFILES, identificar_perfil, instante_utc, ventanas_horarias, objetivos_temporales
from referencias import normalizar_referencia, emparejar_referencia


class PreparacionTests(unittest.TestCase):
    def setUp(self):
        self.desde = pd.Timestamp('2026-11-17T00:00:00Z')
        self.hasta = self.desde + pd.Timedelta(hours=3)

    def filas(self, minutos=(0, 15, 30), humedad=True):
        return pd.DataFrame([
            {'id': i * 2 + j, 'id_muestra': i, 'medido_en': self.desde + pd.Timedelta(minutes=m),
             'valor': 20 if c == 'TEMP' else 50, 'calidad': 'valida', 'codigo': c}
            for i, m in enumerate(minutos) for j, c in enumerate(['TEMP', 'HUM'] if humedad else ['TEMP'])])

    def test_completitud_y_huecos(self):
        horas, cobertura = ventanas_horarias(self.filas(), PERFILES['dht11'], self.desde, self.hasta, 900)
        self.assertEqual(horas.iloc[0].TEMP, 20)
        self.assertEqual(cobertura.iloc[0].TEMP, .75)
        self.assertTrue(horas.iloc[1:].isna().all().all())

    def test_datos_insuficientes_no_se_rellenan(self):
        horas, _ = ventanas_horarias(self.filas((0, 15)), PERFILES['dht11'], self.desde, self.hasta, 900)
        self.assertTrue(horas.isna().all().all())

    def test_reintentos_no_inflan_cobertura(self):
        horas, cobertura = ventanas_horarias(self.filas((0, 1, 2, 3)), PERFILES['dht11'], self.desde, self.hasta, 900)
        self.assertEqual(cobertura.iloc[0].TEMP, .25)
        self.assertTrue(horas.isna().all().all())

    def test_variable_ausente_no_se_simula(self):
        horas, _ = ventanas_horarias(self.filas(humedad=False), PERFILES['dht11'], self.desde, self.hasta, 900)
        self.assertTrue(horas.HUM.isna().all())
        self.assertEqual(horas.iloc[0].TEMP, 20)

    def test_invalida_no_cuenta(self):
        filas = self.filas()
        filas.loc[0, 'calidad'] = 'invalida'
        horas, _ = ventanas_horarias(filas, PERFILES['dht11'], self.desde, self.hasta, 900)
        self.assertTrue(pd.isna(horas.iloc[0].TEMP))
        self.assertEqual(horas.iloc[0].HUM, 50)

    def test_objetivo_usa_hora_y_no_fila(self):
        horas = pd.DataFrame({'PM25': [10., 30.]}, index=pd.DatetimeIndex([self.desde, self.hasta]))
        objetivos = objetivos_temporales(horas)
        self.assertTrue(pd.isna(objetivos.iloc[0]['PM25_objetivo_1h']))
        self.assertEqual(objetivos.iloc[0]['PM25_objetivo_3h'], 30.)

    def test_referencia_sin_pm1_y_sin_nulos_artificiales(self):
        raw = {'hourly': {'time': [int(self.desde.timestamp())], 'pm2_5': [None],
                          'pm10': [20], 'carbon_monoxide': [100]},
               'hourly_units': dict.fromkeys(['pm2_5', 'pm10', 'carbon_monoxide'], 'μg/m³')}
        ref = normalizar_referencia(raw, self.desde, self.hasta)
        self.assertNotIn('PM1', ref)
        self.assertTrue(pd.isna(ref.iloc[0].PM25))
        originales = pd.DataFrame({'PM25': [10], 'PM10': [25]}, index=ref.index)
        pares = emparejar_referencia(originales, ref)
        self.assertEqual(pares.variable.tolist(), ['PM10'])
        raw['hourly_units']['pm10'] = 'ppm'
        with self.assertRaises(ValueError):
            normalizar_referencia(raw, self.desde, self.hasta)

    def test_perfiles_no_confunden_origen(self):
        self.assertEqual(identificar_perfil('DHT11', 'real').nombre, 'dht11')
        self.assertEqual(identificar_perfil('BME680', 'real').unidades['GAS'], 'ohm')
        with self.assertRaises(ValueError):
            identificar_perfil('desconocido', 'real')

    def test_fecha_sin_zona_rechazada(self):
        with self.assertRaises(ValueError):
            instante_utc('2026-11-17')

    def test_muestras_duplicadas_rechazadas(self):
        filas = self.filas()
        with self.assertRaises(ValueError):
            ventanas_horarias(pd.concat([filas, filas.iloc[:1]]), PERFILES['dht11'], self.desde, self.hasta, 900)


if __name__ == '__main__':
    unittest.main()
