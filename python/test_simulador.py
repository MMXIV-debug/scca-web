import copy
from datetime import datetime, timezone
from decimal import Decimal
import unittest

from simulador import verificar_guardado


class VerificacionIngestaTests(unittest.TestCase):
    def setUp(self):
        self.muestra = {'sensorId': 1, 'idMuestra': 123456, 'medidoEn': '2026-11-24T15:00:00+00:00',
                        'lecturas': [{'variableCodigo': 'PM25', 'unidadId': 1, 'valor': 0}]}
        self.filas = [{'sensor_id': 1, 'id_muestra': 123456, 'codigo': 'PM25', 'unidad_id': 1,
                       'valor': Decimal('0.0000'), 'medido_en': datetime(2026, 11, 24, 15, tzinfo=timezone.utc)}]

    def test_comprueba_valor_cero_sin_modificar_datos(self):
        anterior = copy.deepcopy(self.filas)
        verificar_guardado(self.muestra, self.filas)
        self.assertEqual(self.filas, anterior)

    def test_no_declara_exito_si_cambia_identidad_valor_unidad_o_fecha(self):
        cambios = {'sensor_id': 2, 'id_muestra': 999, 'unidad_id': 2, 'valor': Decimal('1'),
                   'medido_en': datetime(2026, 11, 24, 16, tzinfo=timezone.utc)}
        for campo, valor in cambios.items():
            with self.subTest(campo=campo), self.assertRaises(RuntimeError):
                verificar_guardado(self.muestra, [{**self.filas[0], campo: valor}])

    def test_no_declara_exito_con_variables_ausentes_duplicadas_o_distintas(self):
        for filas in ([], self.filas * 2, [{**self.filas[0], 'codigo': 'CO'}]):
            with self.subTest(filas=filas), self.assertRaises(RuntimeError):
                verificar_guardado(self.muestra, filas)


if __name__ == '__main__':
    unittest.main()
