const { test } = require('node:test');
const assert = require('node:assert/strict');
const { combinar, mediciones } = require('../services/fusionSensoresService');
const { seriesVisualizador, semanal } = require('../services/seriesService');
const ahora = Date.parse('2026-11-27T12:30:00Z');
const fila = (modelo, valor, extra = {}) => ({ modelo, valor, origen: 'real', codigo: 'TEMP', unidad: '°C',
  sensor_id: modelo === 'DHT11' ? 1 : 2, nodo_id: modelo === 'DHT11' ? 1 : 2, sitio_id: 1,
  ultima_fecha: '2026-11-27T12:25:00Z', hora: '2026-11-27T11:00:00Z',
  hora_cerrada: true, intervalo: 60, cobertura: 1, ml_utilizable: true, parcial: false, ...extra });

test('mediciones 50/50 y conservación de identidad de nodos separados', () => {
  const [r] = combinar([fila('DHT11', 20), fila('BME680', 24)], { actual: true, ahora });
  assert.equal(r.valor, 22);
  assert.equal(r.estado_fusion, 'ponderada');
  assert.deepEqual(r.componentes.map(c => c.porcentaje), [50, 50]);
  assert.deepEqual(r.componentes.map(c => c.nodo_id), [1, 2]);
});
test('respaldo 100% ante dato rechazado, antiguo, ausente, infinito o de unidad incorrecta', () => {
  for (const extra of [{ ml_utilizable: false }, { ultima_fecha: '2026-11-27T11:00:00Z' },
    { valor: null }, { valor: Infinity }, { unidad: '°F' }, { valor: 99 }]) {
    const [r] = combinar([fila('DHT11', 20, extra), fila('BME680', 24)], { actual: true, ahora });
    assert.equal(r.valor, 24);
    assert.equal(r.estado_fusion, 'respaldo');
    assert.equal(r.componentes[0].porcentaje, 100);
  }
});
test('ambos fallan: hueco, sin repetir una medición vieja ni inventar cero', () => {
  const [r] = combinar([fila('DHT11', 20, { ml_utilizable: false }), fila('BME680', null)], { actual: true, ahora });
  assert.equal(r.valor, null);
  assert.equal(r.ultima_medicion, null);
  assert.equal(r.ultima_fecha, null);
  assert.deepEqual(r.componentes, []);
});
test('humedad cero y temperatura bajo cero son lecturas utilizables del BME680', () => {
  assert.equal(combinar([fila('BME680', 0, { codigo: 'HUM', unidad: '%' })], { actual: true, ahora })[0].valor, 0);
  assert.equal(combinar([fila('BME680', -5)], { actual: true, ahora })[0].valor, -5);
});
test('no mezcla sitios, horas ni variables; no duplica el peso con varios sensores iguales', () => {
  const rows = combinar([fila('DHT11', 20), fila('DHT11', 40, { sensor_id: 3, nodo_id: 3 }),
    fila('BME680', 24), fila('BME680', 50, { sitio_id: 2 }),
    fila('BME680', 80, { codigo: 'HUM', unidad: '%' }),
    fila('BME680', 18, { hora: '2026-11-27T10:00:00Z' })]);
  assert.equal(rows.length, 4);
  assert.equal(rows[0].valor, 22);
  assert.equal(rows[0].componentes.length, 2);
  const [mismoNodo] = combinar([fila('DHT11', 20), fila('BME680', 24, { nodo_id: 1 })]);
  assert.equal(mismoNodo.componentes.length, 1);
});
test('serie horaria pondera cobertura; hora actual descarta fuente antigua', () => {
  const [r] = combinar([fila('DHT11', 20, { cobertura: .5, parcial: true }), fila('BME680', 26)]);
  assert.equal(r.valor, 24);
  assert.deepEqual(r.componentes.map(c => c.porcentaje), [66.67, 33.33]);
  assert.equal(r.parcial, true);
  const [actual] = combinar([fila('DHT11', 20, { hora_cerrada: false, ultima_fecha: '2026-11-27T11:00:00Z' }),
    fila('BME680', 26, { hora_cerrada: false })], { ahora });
  assert.equal(actual.valor, 26);
});
test('otros parámetros conservan su comportamiento', () => {
  const pm = { codigo: 'PM25', valor: 12, origen: 'simulado' };
  assert.deepEqual(combinar([pm]), [pm]);
});
test('servicios de series y media semanal consumen una sola serie combinada por sitio', async () => {
  const pool = { async query(sql, params) {
    if (sql.includes('FROM politica_ml')) return { rows: [{ completitud_min_pct: 75, configuracion: {} }] };
    assert.match(sql, /e\.sensor_id=l\.sensor_id AND e\.id_muestra=l\.id_muestra/);
    assert.match(sql, /e\.estado='evaluado_demo' AND e\.es_anomalia=false/);
    assert.equal(params[3], 1);
    return { rows: [fila('DHT11', 20), fila('BME680', 24)] };
  } };
  const rows = await seriesVisualizador(pool, 24, { sensorId: 1 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].valor, 22);
  assert.equal((await semanal(pool, { sensorId: 1 }))[0].promedio, 22);
});
test('mediciones consulta la evaluación más reciente, incluso si fue rechazada', async () => {
  const rows = await mediciones({ async query(sql) {
    assert.match(sql, /ORDER BY em.medido_en DESC,em.id_muestra DESC LIMIT 1/);
    assert.match(sql, /l.id_muestra=e.id_muestra/);
    assert.match(sql, /n.estado='activo'/);
    assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|CREATE|ALTER)\b/);
    return { rows: [fila('DHT11', 20, { ml_utilizable: false }),
      fila('BME680', 24, { ultima_fecha: new Date().toISOString() })] };
  } });
  assert.equal(rows[0].valor, 24);
});

test('visualizador muestra una medición y una curva por variable/sitio con porcentajes y respaldo', async () => {
  const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
  const datos = combinar([fila('DHT11', 20), fila('BME680', 24)]);
  const elementos = new Map(), charts = new Map(), errores = [];
  const elemento = id => {
    if (!elementos.has(id)) elementos.set(id, { id, innerHTML: '', addEventListener() {} });
    return elementos.get(id);
  };
  let iniciar, refrescar;
  const contexto = {
    document: { addEventListener: (_, fn) => { iniciar = fn; }, getElementById: elemento,
      querySelector: () => ({ contains: () => false }), querySelectorAll: () => [],
      documentElement: { getAttribute: () => 'light' }, hidden: false },
    localStorage: { getItem: () => 'token-prueba', removeItem() {} },
    window: { location: {}, addEventListener() {}, observarLecturas: (_, fn) => { refrescar = fn; } },
    location: { hash: '' }, MutationObserver: class { observe() {} }, setInterval() {},
    console: { error: e => errores.push(e) },
    Chart: class {
      constructor(canvas, config) { Object.assign(this, config); charts.set(canvas.id, this); }
      update() {}
    },
    fetch: async url => ({ ok: ['/api/me', '/api/visualizador/parametros'].includes(url) || url.startsWith('/api/visualizador/series'),
      json: async () => url === '/api/me' ? { rol: 'Visualizador', nombre: 'Prueba' } : datos }),
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/graficos-monitoreo.js'), 'utf8'), contexto);
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/visualizador.js'), 'utf8'), contexto);
  await iniciar(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(errores.length, 0);
  assert.equal((elemento('filas-parametros').innerHTML.match(/<tr>/g) || []).length, 1);
  assert.match(elemento('filas-parametros').innerHTML, /22\.00/);
  assert.match(elemento('filas-parametros').innerHTML, /50 %/);
  const grafico = charts.get('grafico-clima');
  assert.equal(grafico.data.datasets.length, 1);
  assert.equal(grafico.data.datasets[0].data[0], 22);
  datos.splice(0, datos.length, ...combinar([fila('BME680', 24)]));
  await refrescar();
  assert.equal(grafico.data.datasets[0].data[0], 24);
  assert.match(elemento('filas-parametros').innerHTML, /100 %.*respaldo/);
  datos.splice(0, datos.length, ...combinar([fila('BME680', null)]));
  await refrescar();
  assert.equal(grafico.data.datasets[0].data[0], null);
  assert.match(elemento('filas-parametros').innerHTML, /Sin datos/);
  assert.equal(errores.length, 0);
});

test('elige dos perfiles de nodos distintos aunque la fuente prioritaria impida formar el par', () => {
  const [r] = combinar([fila('DHT11', 20, { sensor_id: 1, nodo_id: 1 }),
    fila('BME680', 24, { sensor_id: 2, nodo_id: 1 }),
    fila('DHT11', 22, { sensor_id: 3, nodo_id: 2 })]);
  assert.equal(r.estado_fusion, 'ponderada');
  assert.equal(r.valor, 23);
});

test('gráficas BME680 separan presión, gas y altitud y conservan el cero', async () => {
  const fs = require('node:fs'), vm = require('node:vm');
  const charts = new Map();
  const filas = [['PRES',969.35], ['GAS',68140], ['ALT',0]].map(([codigo,valor]) =>
    fila('BME680', valor, { codigo }));
  const ctx = { document: { getElementById: id => ({ id }), documentElement: { getAttribute: () => 'light' } },
    MutationObserver: class { observe() {} }, console,
    fetch: async () => ({ ok: true, json: async () => filas }),
    Chart: class { constructor(el, cfg) { charts.set(el.id, cfg); } } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/js/graficos-monitoreo.js'), 'utf8'), ctx);
  await ctx.crearGraficosMonitoreo({}).cargar();
  for (const f of filas) assert.equal(charts.get('grafico-'+f.codigo.toLowerCase()).data.datasets[0].data[0], f.valor);
});
