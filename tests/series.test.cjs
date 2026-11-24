const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resumen, horas, seriesVisualizador, semanal } = require('../services/seriesService');

function base(horasValidas, ultima = { medido_en: new Date(), valor: 0, unidad: 'µg/m³' }) {
  return {
    async query(sql) {
      if (sql.includes('FROM politica_ml')) return { rows: [{ completitud_min_pct: 75, configuracion: {} }] };
      if (sql.includes('WITH fuentes')) return { rows: Array.from({ length: 24 }, (_, i) => ({
        sensor_id: 1, nodo_id: 1, origen: 'simulado', codigo: 'PM25', intervalo: 900,
        valor: i < horasValidas ? 10 : null,
      })) };
      if (sql.includes('sitios_definidos')) return { rows: [{ sitios_definidos: 1, nodos_ubicados: 1 }] };
      if (sql.includes('ORDER BY l.medido_en')) {
        assert.match(sql, /v.codigo='PM25'/);
        return { rows: ultima ? [ultima] : [] };
      }
      throw Error('Consulta inesperada');
    },
  };
}

test('ICA: muestra la última concentración, incluso cero, sin inventar un índice con cobertura insuficiente', async () => {
  const r = await resumen(base(17), () => assert.fail('No debe calcular AQI'), {});
  assert.equal(r.ica_score, '-');
  assert.equal(r.ultima_pm25.valor, 0);
  assert.equal(r.horas_requeridas, 18);
  assert.match(r.motivo, /17 de 18/);
  assert.match(r.motivo, /3 intervalos/);
});

test('ICA: calcula con 18 horas válidas y una lectura reciente de PM2.5', async () => {
  const r = await resumen(base(18), valor => {
    assert.equal(valor, 10);
    return { score: 53, label: 'Ejemplo de prueba', color: 'warning' };
  }, {});
  assert.equal(r.ica_score, 53);
  assert.equal(r.pm25_promedio_24h, 10);
});

test('ICA: conserva la última lectura y explica si está desactualizada', async () => {
  const r = await resumen(base(24, { medido_en: new Date(Date.now() - 7200000), valor: 12, unidad: 'µg/m³' }),
    () => assert.fail('No debe calcular AQI'), {});
  assert.equal(r.ica_estado, 'Datos desactualizados');
  assert.equal(r.ultima_pm25.valor, 12);
});

test('ICA: sin lecturas no devuelve una concentración ficticia', async () => {
  const r = await resumen(base(0, null), () => assert.fail('No debe calcular AQI'), {});
  assert.equal(r.ultima_pm25, null);
  assert.equal(r.ica_score, '-');
  assert.match(r.motivo, /0 de 18/);
});

function datosDht() {
  return { async query(sql, params) {
    if (sql.includes('FROM politica_ml')) return { rows: [{ completitud_min_pct: 75, configuracion: {} }] };
    assert.match(sql, /valor_observado/);
    const filas = [
      { sensor_id: 2, codigo: 'TEMP', hora_cerrada: true, valor: null, valor_observado: 40, cobertura: .5 },
      { sensor_id: 2, codigo: 'TEMP', hora_cerrada: true, valor: 20, valor_observado: 20, cobertura: .8 },
      { sensor_id: 2, codigo: 'TEMP', hora_cerrada: true, valor: null, valor_observado: null, cobertura: 0 },
      { sensor_id: 2, codigo: 'HUM', hora_cerrada: true, valor: null, valor_observado: 0, cobertura: .5 },
    ];
    if (params[5]) filas.push({ sensor_id: 2, codigo: 'TEMP', hora_cerrada: false, valor: null, valor_observado: 30, cobertura: .1 });
    return { rows: filas };
  } };
}

test('series: muestra temperatura parcial y humedad cero, conserva huecos e incluye la hora actual', async () => {
  const filas = await seriesVisualizador(datosDht(), 24);
  assert.equal(filas[0].valor, 40);
  assert.equal(filas[0].parcial, true);
  assert.equal(filas[1].parcial, false);
  assert.equal(filas[2].valor, null);
  assert.equal(filas[3].valor, 0);
  assert.equal(filas.at(-1).hora_cerrada, false);
});

test('series: la consulta validada conserva el filtro de cobertura y excluye la hora actual', async () => {
  const filas = await horas(datosDht(), 24);
  assert.equal(filas.length, 4);
  assert.equal(filas[0].valor, null);
});

test('media semanal: incluye las horas observadas e identifica las parciales sin mezclar variables', async () => {
  const filas = await semanal(datosDht());
  const temperatura = filas.find(r => r.codigo === 'TEMP');
  assert.equal(temperatura.promedio, 30);
  assert.equal(temperatura.horas_con_datos, 3);
  assert.equal(temperatura.horas_validas, 1);
  assert.equal(temperatura.incluye_parciales, true);
  assert.equal(filas.find(r => r.codigo === 'HUM').promedio, 0);
});
