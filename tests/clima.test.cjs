const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizar, normalizarDiario, condicion, crearClimaService } = require('../services/climaService');

function respuesta() {
  const t = 1795431600;
  return { current: { time: t, temperature_2m: 0, weather_code: 0, is_day: 0 }, hourly: {
    time: Array.from({ length: 25 }, (_, i) => t + i * 3600),
    temperature_2m: Array(25).fill(0), weather_code: Array(25).fill(95),
    is_day: Array(25).fill(1), precipitation_probability: Array(25).fill(0)
  } };
}

test('clima: conserva ceros y separa condición actual de 24 horas futuras en UTC', () => {
  const datos = normalizar(respuesta());
  assert.equal(datos.length, 25);
  assert.equal(datos[0].tipo, 'actual');
  assert.equal(datos[0].temperatura_c, 0);
  assert.equal(datos[1].probabilidad_lluvia_pct, 0);
  assert.equal(Date.parse(datos[24].valido_en) - Date.parse(datos[0].valido_en), 86400000);
  assert.equal(condicion(0, false), 'Despejado');
  assert.equal(condicion(0, true), 'Soleado');
  assert.equal(condicion(95), 'Tormenta eléctrica');
  assert.equal(condicion(63), 'Lluvioso');
  assert.equal(condicion(3), 'Nublado');
});

test('clima: rechaza datos ausentes y huecos sin inventar temperaturas', () => {
  const r = respuesta();
  r.hourly.temperature_2m[1] = null;
  assert.throws(() => normalizar(r));
  const hueco = respuesta();
  hueco.hourly.time[2] += 1800;
  assert.throws(() => normalizar(hueco));
  assert.throws(() => normalizar({}));
});

test('clima: el pronóstico comienza en el futuro aunque la condición actual del proveedor sea antigua', () => {
  const r = respuesta();
  r.hourly.time = Array.from({ length: 49 }, (_, i) => r.current.time + i * 3600);
  for (const k of ['temperature_2m', 'weather_code', 'is_day', 'precipitation_probability']) {
    r.hourly[k] = Array(49).fill(r.hourly[k][0]);
  }
  const ahora = (r.current.time + 4 * 3600) * 1000;
  const d = normalizar(r, ahora);
  assert.equal(d.length, 25);
  assert.ok(Date.parse(d[1].valido_en) > ahora);
  assert.equal(Date.parse(d[0].valido_en), r.current.time * 1000);
});

test('clima diario: conserva mínimos, máximos y fechas del día en Bolivia', () => {
  const fecha = Date.parse('2026-11-23T00:00:00-04:00') / 1000;
  const dias = { time: [fecha], temperature_2m_min: [0], temperature_2m_max: [12],
    weather_code: [95], precipitation_probability_max: [0] };
  const [d] = normalizarDiario(dias);
  assert.equal(d.minima_c, 0);
  assert.equal(d.maxima_c, 12);
  assert.equal(d.probabilidad_lluvia_pct, 0);
  assert.equal(d.condicion, 'Tormenta eléctrica');
  assert.equal(d.valido_en, '2026-11-23T04:00:00.000Z');
  assert.deepEqual(normalizarDiario(null), []); // Compatibilidad con consultas antiguas.
  assert.throws(() => normalizarDiario({ ...dias, temperature_2m_min: [13] }));
  assert.throws(() => normalizarDiario({ ...dias, temperature_2m_max: [null] }));
});

function baseFalsa({ reciente = false, falloInsert = false, falloRollback = false } = {}) {
  const consultas = [];
  let liberada = false;
  let errorLiberado;
  const c = {
    async query(sql, args) {
      consultas.push({ sql, args });
      if (sql === 'ROLLBACK' && falloRollback) throw new Error('Cliente desconectado');
      if (sql.includes('pg_try_advisory')) return { rows: [{ adquirido: true }] };
      if (sql.includes('SELECT id FROM clima_consulta')) return { rowCount: reciente ? 1 : 0 };
      if (sql.includes('INSERT INTO clima_consulta')) return { rows: [{ id: '12' }] };
      if (sql.includes('INSERT INTO clima_dato') && falloInsert) throw new Error('BD no disponible');
      return { rows: [] };
    },
    release(error) { liberada = true; errorLiberado = error; }
  };
  return { consultas, get liberada() { return liberada; },
    get errorLiberado() { return errorLiberado; },
    async connect() { return c; },
    async query() { return { rows: [{ id: 1, latitud: -16.5, longitud: -68.15 }] }; }
  };
}

test('clima: guarda respuesta original y 25 datos en una transacción', async () => {
  const pool = baseFalsa();
  const r = respuesta();
  let url;
  const s = crearClimaService(pool, { ahora: () => r.current.time * 1000,
    fetchApi: async u => { url = u; return { ok: true, json: async () => r }; } });
  await s.actualizar();
  assert.equal(url.searchParams.get('latitude'), '-16.5');
  assert.equal(url.searchParams.get('timeformat'), 'unixtime');
  assert.equal(JSON.parse(pool.consultas.find(c => c.sql.includes('INSERT INTO clima_dato')).args[1]).length, 25);
  assert.equal(pool.consultas.at(-1).sql, 'COMMIT');
  assert.equal(pool.liberada, true);
});

test('clima: evita consultas repetidas dentro de los 15 minutos', async () => {
  const pool = baseFalsa({ reciente: true });
  await crearClimaService(pool, { fetchApi: async () => assert.fail('No debe consultar API') }).actualizar();
  assert.equal(pool.consultas.at(-1).sql, 'COMMIT');
});

test('clima: revierte una escritura incompleta y conserva el último registro', async () => {
  const pool = baseFalsa({ falloInsert: true });
  const r = respuesta();
  const s = crearClimaService(pool, { ahora: () => r.current.time * 1000,
    fetchApi: async () => ({ ok: true, json: async () => r }) });
  await s.actualizar();
  assert.equal(pool.consultas.at(-1).sql, 'ROLLBACK');
  assert.equal(pool.liberada, true);
});

test('clima: una falla del proveedor no persiste datos ficticios', async () => {
  const pool = baseFalsa();
  await crearClimaService(pool, { fetchApi: async () => ({ ok: false, status: 503 }) }).actualizar();
  assert.equal(pool.consultas.some(c => c.sql.includes('INSERT')), false);
  assert.equal(pool.consultas.at(-1).sql, 'ROLLBACK');
});

test('clima: si también falla ROLLBACK conserva el error original y descarta el cliente', async t => {
  const errores = t.mock.method(console, 'error', () => {});
  const pool = baseFalsa({ falloRollback: true });
  const corte = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
  await crearClimaService(pool, { fetchApi: async () => { throw corte; } }).actualizar();
  assert.equal(pool.errorLiberado, corte);
  assert.equal(pool.liberada, true);
  assert.equal(errores.mock.calls[0].arguments[1], 'ECONNRESET');
});

test('clima: marca registros antiguos y no escribe al consultar el visualizador', async () => {
  const ahora = Date.now();
  const pool = { async query(sql) {
    assert.ok(sql.startsWith('SELECT'));
    return { rows: [{ consultado_en: new Date(ahora - 31 * 60000), datos: [
      { codigo_wmo: 0, es_dia: false }
    ] }] };
  } };
  const r = await crearClimaService(pool, { ahora: () => ahora }).listar();
  assert.equal(r.items[0].desactualizado, true);
  assert.equal(r.items[0].datos[0].condicion, 'Despejado');
});
