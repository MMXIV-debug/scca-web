const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const strategy = require('../services/correctorStrategy');
const { LecturaEmitter, iniciarObservadores, suscribirPanel } = require('../services/eventosLectura');
const tick = () => new Promise(resolve => setImmediate(resolve));

test('Strategy: los algoritmos registrados delegan la solicitud completa al servicio de inferencia', async () => {
  for (const algoritmo of ['regresion_lineal', 'random_forest', 'xgboost', 'persistencia', 'isolation_forest']) {
    const solicitud = { sensorId: 1, proposito: algoritmo === 'isolation_forest' ? 'anomalias' : 'pronostico',
      variable: 'PM25', horizonteH: algoritmo === 'isolation_forest' ? 0 : 3, guardarResultado: true };
    let llamadas = 0;
    const r = await strategy.evaluar(solicitud, { algoritmo }, async body => {
      llamadas++;
      assert.equal(body, solicitud);
      return { estado: 'evaluado_demo', modelo_version: 'version-real', valor: 12 };
    });
    assert.equal(llamadas, 1);
    assert.equal(r.modelo_version, 'version-real');
  }
});

test('Strategy: no calcula con algoritmos desconocidos ni usa persistencia para calibración', async () => {
  const ejecutar = () => assert.fail('No debe ejecutar una estrategia incompatible');
  await assert.rejects(strategy.evaluar({}, { algoritmo: 'inventado' }, ejecutar), e => e.status === 422);
  await assert.rejects(strategy.evaluar({ proposito: 'calibracion' }, { algoritmo: 'persistencia' }, ejecutar), e => e.status === 422);
  await assert.rejects(strategy.evaluar({ proposito: 'pronostico' }, { algoritmo: 'isolation_forest' }, ejecutar), e => e.status === 422);
});

test('Strategy: la evaluación del panel consulta el modelo activo y llama a la API .NET', async t => {
  const llamadas = [];
  t.mock.method(globalThis, 'fetch', async (url, opciones) => {
    llamadas.push({ url, opciones });
    if (String(url).includes('/registro')) return { ok: true, json: async () => ({ activos: [{
      algoritmo: 'random_forest', sensor: { sensor_id: 7 }, proposito: 'calibracion', variable: 'TEMP', horizonte_h: 0
    }] }) };
    return { ok: true, json: async () => ({ estado: 'evaluado_demo', valor: 18.2 }) };
  });
  const seleccion = t.mock.method(strategy.estrategias.random_forest, 'evaluar');
  const body = { sensorId: 7, proposito: 'calibracion', variable: 'TEMP', horizonteH: 0 };
  const r = await require('../services/panelMlService').evaluar(body);
  assert.equal(seleccion.mock.callCount(), 1);
  assert.equal(llamadas.length, 2);
  assert.equal(JSON.parse(llamadas[1].opciones.body).sensorId, 7);
  assert.equal(r.valor, 18.2);
});

test('Observer: el fallo de un suscriptor no impide ejecutar los demás', async t => {
  t.mock.method(console, 'error', () => {});
  const eventos = new LecturaEmitter();
  let notificado = 0;
  eventos.on('NuevaLecturaConfirmada', async () => { throw new Error('Observer falló'); });
  eventos.on('NuevaLecturaConfirmada', () => { notificado++; });
  await eventos.publicar('NuevaLecturaConfirmada', {});
  assert.equal(notificado, 1);
});

function clienteFalso() {
  const c = new EventEmitter();
  c.query = async sql => { c.sql = sql; };
  c.release = error => { c.liberaciones = (c.liberaciones || 0) + 1; c.error = error; };
  return c;
}

test('Observer: una notificación guardada evalúa las alertas habilitadas y publica el evento', async t => {
  const previos = ['ALERTAS_AMBIENTALES_AUTO', 'ALERTAS_TECNICAS_AUTO', 'ALERTAS_TECNICAS_HABILITADAS']
    .map(k => [k, process.env[k]]);
  for (const [k] of previos) process.env[k] = 'true';
  t.after(() => { for (const [k, v] of previos) if (v === undefined) delete process.env[k]; else process.env[k] = v; });
  const c = clienteFalso(), eventos = new LecturaEmitter();
  let ambientales = 0, tecnicas = 0, lecturas = 0;
  eventos.on('NuevaLecturaConfirmada', () => { lecturas++; });
  const detener = iniciarObservadores({ connect: async () => c }, { eventos,
    ambientales: async () => { ambientales++; }, tecnicas: async () => { tecnicas++; } });
  t.after(detener);
  await tick();
  const antes = ambientales;
  assert.equal(c.sql, 'LISTEN "scca_lecturas"');
  c.emit('notification', { channel: 'scca_lecturas', payload: JSON.stringify({ sensor_id: 1, id_muestra: '123', estado: 'guardada' }) });
  await tick();
  assert.equal(lecturas, 1);
  assert.equal(ambientales, antes + 1);
  assert.equal(tecnicas, ambientales);
  // Payload inválido no dispara efectos.
  c.emit('notification', { channel: 'scca_lecturas', payload: '{}' });
  await tick();
  assert.equal(lecturas, 1);
});

test('Observer: maneja la pérdida de la conexión dedicada y retira sus listeners', async () => {
  const c = clienteFalso(), eventos = new LecturaEmitter();
  const detener = iniciarObservadores({ connect: async () => c }, { eventos });
  await tick();
  assert.doesNotThrow(() => c.emit('error', Object.assign(new Error('Corte'), { code: 'ECONNRESET' })));
  assert.equal(c.liberaciones, 1);
  assert.equal(c.listenerCount('notification'), 0);
  detener();
  assert.equal(eventos.listenerCount('NuevaLecturaConfirmada'), 0);
});

test('Observer: el panel recibe avisos SSE y se desuscribe al cerrar', async () => {
  const eventos = new LecturaEmitter(), res = new EventEmitter();
  const enviados = [];
  res.set = () => res;
  res.flushHeaders = () => {};
  res.write = texto => { enviados.push(texto); return true; };
  res.end = () => res.emit('close');
  suscribirPanel({}, res, eventos);
  try {
    await eventos.publicar('NuevaLecturaConfirmada', { sensor_id: 1 });
    assert.equal(enviados.filter(x => x.startsWith('data:')).length, 2);
    assert.equal(enviados.some(x => x.includes('sensor_id')), false);
  } finally { res.end(); }
  assert.equal(eventos.listenerCount('NuevaLecturaConfirmada'), 0);
});

test('Observer navegador: lee avisos fragmentados y envía el token solo por cabecera', async () => {
  const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
  let actualizaciones = 0, pendiente;
  const contexto = { window: { addEventListener() {}, removeEventListener() {} }, TextDecoder, AbortController,
    setTimeout: fn => { pendiente = fn; return 1; }, clearTimeout() {},
    fetch: async (url, opciones) => {
      assert.equal(url, '/api/visualizador/eventos');
      assert.equal(opciones.headers.Authorization, 'Bearer privado');
      const encoder = new TextEncoder();
      return { ok: true, status: 200, body: new ReadableStream({ start(c) {
        c.enqueue(encoder.encode('data: {"tipo":'));
        c.enqueue(encoder.encode('"lecturas_actualizadas"}\n\n'));
        c.close();
      } }) };
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/eventos-lectura.js'), 'utf8'), contexto);
  const detener = contexto.window.observarLecturas('privado', async () => { actualizaciones++; });
  await tick();
  detener();
  assert.equal(actualizaciones, 1);
  assert.equal(typeof pendiente, 'function');
});
