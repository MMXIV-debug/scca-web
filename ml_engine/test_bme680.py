"""Contratos BME680 y referencia meteorológica; sin conectar a PostgreSQL."""
import asyncio
import tempfile
import unittest
from unittest.mock import Mock, patch

import pandas as pd
from fastapi import FastAPI

from inferencia_registro import crear_router_registro
from referencias import descargar_referencia, normalizar_referencia, emparejar_referencia, URL_METEO
from test_inferencia_registro import solicitar


class Bme680Tests(unittest.TestCase):
    def setUp(self):
        self.desde = pd.Timestamp('2026-11-20T00:00:00Z')
        self.hasta = self.desde + pd.Timedelta(hours=1)
        self.raw = {
            'hourly': {'time': [int(self.desde.timestamp())], 'temperature_2m': [-5.0],
                       'relative_humidity_2m': [68.98], 'surface_pressure': [969.35]},
            'hourly_units': {'temperature_2m': '°C', 'relative_humidity_2m': '%',
                             'surface_pressure': 'hPa'},
        }

    def test_referencia_usa_presion_superficial_y_no_inventa_gas_altitud(self):
        response = Mock()
        response.json.return_value = self.raw
        with patch('referencias.requests.get', return_value=response) as get:
            raw, meta = descargar_referencia(-17.4, -66.1, self.desde, self.hasta, perfil='bme680')
        self.assertEqual(get.call_args.args[0], URL_METEO)
        self.assertEqual(get.call_args.kwargs['params']['hourly'],
                         'temperature_2m,relative_humidity_2m,surface_pressure')
        self.assertNotIn('domains', get.call_args.kwargs['params'])
        self.assertEqual(meta['variables_sin_referencia'], ['GAS', 'ALT'])
        ref = normalizar_referencia(raw, self.desde, self.hasta, perfil='bme680')
        self.assertEqual(ref.iloc[0].TEMP, -5.0)
        self.assertEqual(ref.iloc[0].PRES, 969.35)
        originales = ref.assign(GAS=68140)
        pares = emparejar_referencia(originales, ref)
        self.assertEqual(set(pares.variable), {'TEMP', 'HUM', 'PRES'})

    def test_referencia_rechaza_unidad_erronea_y_no_rellena_ausencias(self):
        self.raw['hourly']['surface_pressure'] = [None]
        ref = normalizar_referencia(self.raw, self.desde, self.hasta, perfil='bme680')
        self.assertTrue(pd.isna(ref.iloc[0].PRES))
        self.raw['hourly_units']['surface_pressure'] = 'Pa'
        with self.assertRaises(ValueError):
            normalizar_referencia(self.raw, self.desde, self.hasta, perfil='bme680')

    def test_muestra_ejemplo_altitud_opcional_y_compatibilidad(self):
        with tempfile.TemporaryDirectory() as root:
            app = FastAPI()
            app.include_router(crear_router_registro(root, lambda: 'clave-solo-prueba'))
            body = {'nodo_id': 1, 'sensor_id': 2, 'perfil': 'bme680',
                    'valores': {'TEMP': 26.47, 'HUM': 68.98, 'PRES': 969.35, 'GAS': 68140},
                    'altitud_aproximada_m': 372.0}
            def enviar(payload):
                return asyncio.run(solicitar(app, '/api/v2/modelos/muestra', payload))
            status, result = enviar(body)
            self.assertEqual(status, 200, result)
            self.assertEqual(result['altitud_aproximada_m'], 372.0)
            self.assertEqual(result['altitud_estado'], 'derivada_no_evaluada_por_detector')
            self.assertEqual(result['estado'], 'sin_modelo')
            self.assertIsNone(result['es_anomalia'])
            legacy = {k: v for k, v in body.items() if k != 'altitud_aproximada_m'}
            self.assertEqual(enviar(legacy)[0], 200)
            dht = {**legacy, 'perfil': 'dht11', 'valores': {'TEMP': 26.47, 'HUM': 68.98}}
            self.assertEqual(enviar(dht)[0], 200)
            self.assertEqual(enviar({**dht, 'altitud_aproximada_m': 372})[0], 422)
            for codigo, valor in [('TEMP', -41), ('TEMP', 86), ('PRES', 299), ('PRES', 1101), ('GAS', 0)]:
                with self.subTest(codigo=codigo, valor=valor):
                    self.assertEqual(enviar({**body, 'valores': {**body['valores'], codigo: valor}})[0], 422)
            self.assertEqual(enviar({**body, 'altitud_aproximada_m': 20001})[0], 422)


if __name__ == '__main__':
    unittest.main()
