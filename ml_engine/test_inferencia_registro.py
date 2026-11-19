import asyncio
import json
from pathlib import Path
import tempfile
import unittest

from fastapi import FastAPI

from evaluacion import evaluar_dataset
from gobernanza import Registro
from inferencia_registro import crear_router_registro
from test_gobernanza import dataset_prueba


async def solicitar(app, ruta, datos, clave='clave-solo-prueba', metodo='POST'):
    """Ejecuta el contrato ASGI real sin abrir puertos ni requerir httpx."""
    mensajes = []
    cuerpo = json.dumps(datos).encode()
    headers = [(b'content-type', b'application/json')]
    if clave is not None:
        headers.append((b'x-api-key', clave.encode()))
    scope = {'type': 'http', 'asgi': {'version': '3.0'}, 'http_version': '1.1',
             'method': metodo, 'scheme': 'http', 'path': ruta, 'raw_path': ruta.encode(),
             'query_string': b'', 'root_path': '', 'headers': headers,
             'server': ('test', 80), 'client': ('127.0.0.1', 1)}

    async def receive():
        return {'type': 'http.request', 'body': cuerpo, 'more_body': False}

    async def send(mensaje):
        mensajes.append(mensaje)

    await app(scope, receive, send)
    codigo = next(m['status'] for m in mensajes if m['type'] == 'http.response.start')
    respuesta = b''.join(m.get('body', b'') for m in mensajes if m['type'] == 'http.response.body')
    return codigo, json.loads(respuesta)


class InferenciaTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.raiz = Path(self.temp.name)
        self.registro = self.raiz / 'registro'
        self.modelo = evaluar_dataset(dataset_prueba(self.raiz / 'datos'), self.registro)
        self.app = FastAPI()
        self.app.include_router(crear_router_registro(self.registro, lambda: 'clave-solo-prueba'))
        self.seleccion = {'nodo_id': 1, 'sensor_id': 1, 'perfil': 'contaminantes_simulados',
                          'proposito': 'calibracion', 'variable': 'PM25', 'horizonte_h': 0}
        self.entrada = {**self.seleccion, 'valores': {'PM25': 10},
                        'periodo_inicio': '2026-02-01T00:00:00Z', 'periodo_fin': '2026-02-01T01:00:00Z',
                        'modelo_version': self.modelo['version']}

    def tearDown(self):
        self.temp.cleanup()

    def pedir(self, accion, datos, clave='clave-solo-prueba'):
        return asyncio.run(solicitar(self.app, '/api/v2/modelos/' + accion, datos, clave))

    def test_estado_e_inferencia_versionada(self):
        codigo, info = self.pedir('estado', self.seleccion)
        self.assertEqual(codigo, 200)
        self.assertEqual(info['modelo_version'], self.modelo['version'])
        codigo, salida = self.pedir('inferir', self.entrada)
        self.assertEqual(codigo, 200)
        self.assertAlmostEqual(salida['valor'], 25)
        self.assertEqual(salida['estado'], 'evaluado_demo')
        self.assertFalse(salida['calibracion_fisica_validada'])
        self.assertIsNone(salida['es_anomalia'])

    def test_listado_incluye_activos_sin_rutas_privadas(self):
        codigo,datos=asyncio.run(solicitar(self.app,'/api/v2/modelos/registro',{},metodo='GET'))
        self.assertEqual(codigo,200)
        self.assertTrue(datos['items'][0]['activo'])
        self.assertNotIn('artefacto',datos['items'][0])

    def test_reversion_por_api_requiere_credencial_y_motivo(self):
        body={'clave':self.modelo['clave'],'motivo':'Revisión administrativa de prueba'}
        self.assertEqual(self.pedir('revertir',body,None)[0],401)
        self.assertEqual(self.pedir('revertir',{**body,'motivo':'x'})[0],422)
        self.assertEqual(self.pedir('revertir',body)[0],200)
        self.assertEqual(self.pedir('estado',self.seleccion)[1]['estado'],'sin_modelo')

    def test_sensor_ajeno_no_recibe_otro_modelo(self):
        codigo, salida = self.pedir('estado', {**self.seleccion, 'sensor_id': 2})
        self.assertEqual(codigo, 200)
        self.assertEqual(salida['estado'], 'sin_modelo')
        self.assertIsNone(salida['valor'])

    def test_anomalias_usa_identidad_del_perfil_completo(self):
        from inferencia_registro import SeleccionModelo
        from pydantic import ValidationError
        for perfil, variable, incorrecta in [('contaminantes_simulados', 'PM25', 'CO'), ('dht11', 'TEMP', 'HUM'), ('bme680', 'TEMP', 'PRES')]:
            seleccion = {**self.seleccion, 'perfil': perfil, 'proposito': 'anomalias', 'variable': variable}
            self.assertEqual(SeleccionModelo(**seleccion).variable, variable)
            with self.assertRaises(ValidationError):
                SeleccionModelo(**{**seleccion, 'variable': incorrecta})

    def test_autenticacion_obligatoria(self):
        self.assertEqual(self.pedir('estado', self.seleccion, None)[0], 401)
        self.assertEqual(self.pedir('inferir', self.entrada, 'incorrecta')[0], 401)

    def test_falta_configuracion_no_permite_acceso(self):
        app = FastAPI()
        app.include_router(crear_router_registro(self.registro, lambda: None))
        self.assertEqual(asyncio.run(solicitar(app, '/api/v2/modelos/estado', self.seleccion))[0], 503)

    def test_fuera_de_dominio_no_inventa_correccion(self):
        codigo, salida = self.pedir('inferir', {**self.entrada, 'valores': {'PM25': 999}})
        self.assertEqual(codigo, 200)
        self.assertEqual(salida['estado'], 'fuera_dominio')
        self.assertIsNone(salida['valor'])

    def test_artefacto_alterado_no_se_ejecuta(self):
        (self.registro / self.modelo['artefacto']).write_bytes(b'alterado')
        codigo, salida = self.pedir('inferir', self.entrada)
        self.assertEqual(codigo, 503)
        self.assertNotIn(str(self.raiz), json.dumps(salida))

    def test_reversion_se_observa_sin_reiniciar(self):
        Registro(self.registro).revertir(self.modelo['clave'], 'prueba')
        self.assertEqual(self.pedir('estado', self.seleccion)[1]['estado'], 'sin_modelo')
        self.assertEqual(self.pedir('inferir', self.entrada)[0], 409)

    def test_version_anticuada_rechazada(self):
        self.assertEqual(self.pedir('inferir', {**self.entrada, 'modelo_version': 'a' * 32})[0], 409)

    def test_periodo_instantaneo_rechazado(self):
        self.assertEqual(self.pedir('inferir', {**self.entrada, 'periodo_fin': self.entrada['periodo_inicio']})[0], 422)

    def test_variables_ajenas_rechazadas(self):
        self.assertEqual(self.pedir('inferir', {**self.entrada, 'valores': {'TEMP': 25}})[0], 422)
        self.assertEqual(self.pedir('estado', {**self.seleccion, 'perfil': 'dht11'})[0], 422)

    def test_modelo_incompatible_no_hace_fallback_legacy(self):
        estado = Registro(self.registro).leer()
        del estado['modelos'][self.modelo['version']]['entrada_agregado_s']
        Registro(self.registro).guardar(estado)
        self.assertEqual(self.pedir('estado', self.seleccion)[0], 503)


if __name__ == '__main__':
    unittest.main()
