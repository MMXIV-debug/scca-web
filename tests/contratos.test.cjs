const { test } = require('node:test'),
  assert = require('node:assert/strict');
const { validarPolitica } = require('../services/politicasService');
const { filtrosReportes } = require('../services/panelMlService');

test('consola ML distingue un pronóstico por persistencia de una corrección y conserva el cero', () => {
  const { resumir } = require('../ml-consola');
  const texto = resumir({ sensor_id: 1, variable: 'PM25', proposito: 'pronostico',
    estado: 'evaluado_demo', modelo_version: 'version-prueba', valor: 0, unidad: 'µg/m³',
    modelo_metadatos: { algoritmo: 'persistencia' } }, { valores: { PM25: 0 } }, '632');
  assert.match(texto, /Valor de entrada: 0/);
  assert.match(texto, /Valor pronosticado: 0/);
  assert.match(texto, /no demuestra mejora predictiva/);
  assert.match(texto, /resultado_id: 632/);
  assert.doesNotMatch(texto, /Valor corregido/);
});

test('consola ML no inventa un resultado cuando faltan datos', () => {
  const { resumir } = require('../ml-consola');
  const texto = resumir({ sensor_id: 2, variable: 'TEMP', proposito: 'calibracion', estado: 'sin_modelo', valor: null });
  assert.match(texto, /Sin resultado numérico/);
  assert.match(texto, /no se solicitó guardar/);
  assert.doesNotMatch(texto, /Valor corregido:/);
});

test('consola ML muestra el original como no corregido cuando falta un modelo', () => {
  const { resumir } = require('../ml-consola');
  const texto = resumir({ sensor_id: 1, variable: 'TEMP', proposito: 'calibracion',
    estado: 'sin_modelo', estado_correccion: 'no_corregido', valor_original: 10, valor: 10, unidad: '°C' });
  assert.match(texto, /Valor original \(no corregido\): 10 °C/);
  assert.doesNotMatch(texto, /Valor corregido:/);
});

test('consola ML distingue el original 10 del resultado corregido 21', () => {
  const { resumir } = require('../ml-consola');
  const texto = resumir({ sensor_id: 1, variable: 'TEMP', proposito: 'calibracion',
    estado: 'evaluado_demo', estado_correccion: 'corregido', valor_original: 10, valor: 21, unidad: '°C',
    modelo_version: 'fixture', modelo_metadatos: { algoritmo: 'regresion_lineal' } }, {}, '1');
  assert.match(texto, /Valor de entrada: 10 °C/);
  assert.match(texto, /Valor corregido: 21 °C/);
  assert.match(texto, /resultado_id: 1/);
});
test('una política no rebaja los mínimos acordados ni mezcla variables de perfiles', () => {
  const p = {
    version_anterior: 1,
    motivo: 'Revisión justificada de política',
    completitud_min_pct: 75,
    colocacion_dias: 30,
    pares_minimos: 540,
    test_pct: 30,
    mejora_rmse_min_pct: 20,
    sin_datos_seg: 300,
    configuracion: {
      factor_sin_datos: 2,
      intervalos_sensor: { 1: 900 },
      alertas_ambientales: [],
      alertas_predictivas: [],
    },
  };
  assert.equal(validarPolitica(p).pares_minimos, 540);
  assert.throws(() => validarPolitica({ ...p, pares_minimos: 5 }));
  assert.equal(validarPolitica({...p,colocacion_dias:1,pares_minimos:24,configuracion:{...p.configuracion,arranque_demo:true,anomalias:{muestras_entrenamiento:8,dias_minimos:1}}}).pares_minimos,24);
  assert.throws(()=>validarPolitica({...p,colocacion_dias:1,pares_minimos:24}));
  assert.throws(() =>
    validarPolitica({ ...p, configuracion: { ...p.configuracion, intervalos_sensor: { 1: 901 } } }),
  );
  assert.throws(() =>
    validarPolitica({
      ...p,
      configuracion: {
        ...p.configuracion,
        alertas_ambientales: [{ perfil: 'bme680', variable: 'PM25', periodo_h: 24, umbral: 10 }],
      },
    }),
  );
  const conRangos = validarPolitica({
    ...p,
    referencia_fuente_id: 2,
    rangos_variables: [
      { codigo: 'TEMP', rango_min: -40, rango_max: 85, umbral_alerta: 40 },
      { codigo: 'PRES', rango_min: 300, rango_max: 1100, umbral_alerta: null },
    ],
  });
  assert.equal(conRangos.referencia_fuente_id, 2);
  assert.equal(conRangos.rangos_variables.length, 2);
  assert.throws(() =>
    validarPolitica({ ...p, rangos_variables: [{ codigo: 'TEMP', rango_min: 50, rango_max: 10 }] }),
  );
  assert.throws(() =>
    validarPolitica({
      ...p,
      rangos_variables: [
        { codigo: 'TEMP', rango_min: 0, rango_max: 50 },
        { codigo: 'TEMP', rango_min: 5, rango_max: 40 },
      ],
    }),
  );
  assert.throws(() =>
    validarPolitica({
      ...p,
      rangos_variables: [{ codigo: 'TEMP', rango_min: 0, rango_max: 50, umbral_alerta: 60 }],
    }),
  );
});
test('infraestructura identifica perfiles DHT11/BME680 y normaliza unidades', () => {
  const { identificarPerfil, normUnidad } = require('../services/infraestructuraService');
  assert.equal(identificarPerfil('BME680', 'real'), 'bme680');
  assert.equal(identificarPerfil('DHT11', 'real'), 'dht11');
  assert.equal(identificarPerfil('Python Script', 'simulado'), 'contaminantes_simulados');
  assert.equal(normUnidad('µg/m³'), 'µg/m3');
  assert.equal(normUnidad('hPa'), 'hPa');
  assert.equal(normUnidad('Ω'), 'ohm');
});
test('el reporte acota el periodo y exige identidad del sensor', () => {
  assert.equal(filtrosReportes({ sensorId: '1' })[0], 1);
  assert.throws(() => filtrosReportes({ sensorId: 'abc' }));
  assert.throws(() => filtrosReportes({ sensorId: '1', desde: '2026-02-01', hasta: '2026-01-01' }));
});
test('una pendiente cero se conserva y no se simula un modelo complejo', () => {
  const corregir = require('../services/correctorStrategy');
  assert.equal(
    corregir.aplicar(12, {
      algoritmo: 'regresion_lineal',
      parametros: { pendiente: 0, intersepto: 3 },
    }),
    3,
  );
  assert.throws(()=>corregir.aplicar(12, { algoritmo: 'random_forest', parametros: { factor_ajuste: 0 } }));
});
test('el ciclo semanal usa lunes 10:00 de La Paz y recupera una ejecución perdida', () => {
  const { semanaVigente } = require('../services/entrenamientoScheduler');
  assert.equal(
    new Date(semanaVigente(new Date('2026-11-23T13:59:59Z'))).toISOString(),
    '2026-11-16T14:00:00.000Z',
  );
  assert.equal(
    new Date(semanaVigente(new Date('2026-11-23T14:00:00Z'))).toISOString(),
    '2026-11-23T14:00:00.000Z',
  );
  assert.equal(
    new Date(semanaVigente(new Date('2026-11-25T02:00:00Z'))).toISOString(),
    '2026-11-23T14:00:00.000Z',
  );
});
