const fallo = (status, message) => Object.assign(new Error(message), { status });
const VARIABLES = ['PM25', 'PM10', 'PM1', 'CO', 'TEMP', 'HUM', 'PRES', 'GAS'];
const PERFILES = {
  dht11: ['TEMP', 'HUM'],
  bme680: ['TEMP', 'HUM', 'PRES', 'GAS'],
  contaminantes_simulados: ['PM25', 'PM10', 'PM1', 'CO'],
};
const ANOMALIAS = {
  version: 'anomalias-demo-1',
  muestras_entrenamiento: 200,
  dias_minimos: 7,
  normales_prueba: 50,
  fallos_prueba: 20,
  precision_minima: 0.9,
  recall_minimo: 0.9,
  fpr_maxima: 0.05,
};
function validarPolitica(p) {
  const rango = (v, min, max, entero = false) =>
    typeof v === 'number' &&
    Number.isFinite(v) &&
    v >= min &&
    v <= max &&
    (!entero || Number.isInteger(v));
  if (
    !p ||
    !Number.isInteger(p.version_anterior) ||
    p.version_anterior < 1 ||
    typeof p.motivo !== 'string' ||
    p.motivo.trim().length < 10 ||
    p.motivo.length > 1000
  )
    throw fallo(400, 'Indica versión anterior y motivo de 10–1000 caracteres.');
  for (const [k, min, max, entero] of [
    ['completitud_min_pct', 75, 100],
    ['colocacion_dias', p.configuracion?.arranque_demo === true ? 1 : 30, 365, true],
    ['pares_minimos', p.configuracion?.arranque_demo === true ? 24 : 540, 100000, true],
    ['test_pct', 10, 40],
    ['mejora_rmse_min_pct', 20, 100],
    ['sin_datos_seg', 60, 604800, true],
  ])
    if (!rango(p[k], min, max, entero)) throw fallo(400, 'Valor de política inválido: ' + k);
  const c = p.configuracion;
  if (c?.arranque_demo != null && typeof c.arranque_demo !== 'boolean')
    throw fallo(400, 'Modo de arranque inválido.');
  if (
    !c ||
    !rango(c.factor_sin_datos, 2, 100) ||
    !c.intervalos_sensor ||
    typeof c.intervalos_sensor !== 'object' ||
    Array.isArray(c.intervalos_sensor) ||
    Object.keys(c.intervalos_sensor).length > 1000
  )
    throw fallo(400, 'Configuración de recepción inválida.');
  for (const [id, v] of Object.entries(c.intervalos_sensor))
    if (!/^[1-9]\d{0,8}$/.test(id) || !rango(v, 1, 3600, true) || 3600 % v)
      throw fallo(400, 'Intervalo de sensor inválido: debe dividir una hora.');
  if (
    !Array.isArray(c.alertas_ambientales) ||
    c.alertas_ambientales.length > 50 ||
    !Array.isArray(c.alertas_predictivas) ||
    c.alertas_predictivas.length > 3
  )
    throw fallo(400, 'Reglas de alerta inválidas.');
  const reglas = new Set();
  for (const r of c.alertas_ambientales) {
    if (
      !r ||
      !Object.hasOwn(PERFILES, r.perfil) ||
      !PERFILES[r.perfil].includes(r.variable) ||
      !rango(r.periodo_h, 1, 168, true) ||
      !rango(r.umbral, r.variable === 'TEMP' ? -273.15 : 0, 99999999) ||
      reglas.has(r.perfil + '/' + r.variable + '/' + r.periodo_h)
    )
      throw fallo(400, 'Regla ambiental inválida o duplicada.');
    reglas.add(r.perfil + '/' + r.variable + '/' + r.periodo_h);
  }
  const horizontes = new Set();
  for (const r of c.alertas_predictivas) {
    if (
      !r ||
      ![1, 3, 6].includes(r.horizonte_h) ||
      !rango(r.umbral, 0, 99999999) ||
      horizontes.has(r.horizonte_h)
    )
      throw fallo(400, 'Regla predictiva inválida o duplicada.');
    horizontes.add(r.horizonte_h);
  }
  if (c.anomalias != null && (typeof c.anomalias !== 'object' || Array.isArray(c.anomalias)))
    throw fallo(400, 'Criterios de anomalías inválidos.');
  const anomalias = { ...ANOMALIAS, ...c.anomalias, version: ANOMALIAS.version };
  for (const [k, min, max, entero] of [
    ['muestras_entrenamiento', c.arranque_demo === true ? 8 : 50, 100000, true],
    ['dias_minimos', 1, 365, true],
    ['normales_prueba', 10, 100000, true],
    ['fallos_prueba', 10, 100000, true],
    ['precision_minima', 0.5, 1],
    ['recall_minimo', 0.5, 1],
    ['fpr_maxima', 0, 0.5],
  ])
    if (!rango(anomalias[k], min, max, entero))
      throw fallo(400, 'Criterio de anomalías inválido: ' + k);
  return {
    ...p,
    configuracion: {
      arranque_demo: c.arranque_demo === true,
      factor_sin_datos: c.factor_sin_datos,
      intervalos_sensor: c.intervalos_sensor,
      alertas_ambientales: c.alertas_ambientales,
      alertas_predictivas: c.alertas_predictivas,
      anomalias,
    },
  };
}
async function vigente(pool) {
  const { rows } = await pool.query(
    'SELECT * FROM politica_ml WHERE vigente_hasta IS NULL ORDER BY version DESC LIMIT 1',
  );
  if (!rows.length) throw fallo(503, 'No hay una política vigente.');
  return rows[0];
}
async function crearPolitica(pool, usuario, body) {
  const p = validarPolitica(body),
    c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SELECT pg_advisory_xact_lock(192840,1)');
    const admin = await c.query(
      "SELECT id FROM usuario WHERE id=$1 AND activo AND estado='aprobado' AND rol_id=(SELECT id FROM rol WHERE nombre='Administrador') FOR SHARE",
      [usuario],
    );
    if (!admin.rowCount) throw fallo(403, 'Administrador activo requerido.');
    const anterior = await vigente(c);
    if (anterior.version !== p.version_anterior)
      throw fallo(409, 'La política cambió. Actualiza antes de guardar.');
    for (const id of Object.keys(p.configuracion.intervalos_sensor)) {
      if (!(await c.query('SELECT id FROM sensor WHERE id=$1', [id])).rowCount)
        throw fallo(400, 'Sensor inexistente: ' + id);
    }
    const { rows } = await c.query(
      `INSERT INTO politica_ml(version,referencia_fuente_id,creado_por,motivo,agregado_min,completitud_min_pct,colocacion_dias,pares_minimos,test_pct,mejora_rmse_min_pct,sin_datos_seg,configuracion)
 VALUES($1,$2,$3,$4,60,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [
        anterior.version + 1,
        anterior.referencia_fuente_id,
        usuario,
        p.motivo.trim(),
        p.completitud_min_pct,
        p.colocacion_dias,
        p.pares_minimos,
        p.test_pct,
        p.mejora_rmse_min_pct,
        p.sin_datos_seg,
        p.configuracion,
      ],
    );
    await c.query('UPDATE politica_ml SET vigente_hasta=$2 WHERE id=$1', [
      anterior.id,
      rows[0].vigente_desde,
    ]);
    await c.query(
      "INSERT INTO auditoria_evento(usuario_id,entidad,entidad_id,accion,motivo,datos_despues,politica_id) VALUES($1,'politica_ml',$2::int,'crear',$3,$4,$2::int)",
      [usuario, rows[0].id, p.motivo.trim(), JSON.stringify(rows[0])],
    );
    await c.query('COMMIT');
    return rows[0];
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
module.exports = { vigente, crearPolitica, validarPolitica };
