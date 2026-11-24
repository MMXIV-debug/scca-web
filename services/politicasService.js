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
  if (
    p.referencia_fuente_id != null &&
    (!Number.isSafeInteger(p.referencia_fuente_id) || p.referencia_fuente_id < 1)
  )
    throw fallo(400, 'referencia_fuente_id debe ser un entero positivo.');
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

  let rangosValidados = null;
  if (p.rangos_variables !== undefined) {
    if (!Array.isArray(p.rangos_variables) || p.rangos_variables.length > 50)
      throw fallo(400, 'rangos_variables debe ser un arreglo de hasta 50 elementos.');
    const vistos = new Set();
    rangosValidados = [];
    for (const item of p.rangos_variables) {
      if (!item || typeof item !== 'object') throw fallo(400, 'Rango de variable inválido.');
      const codigo = item.codigo != null ? String(item.codigo).trim().toUpperCase() : null;
      const variableId = item.variable_id != null ? Number(item.variable_id) : null;
      if (!codigo && (!Number.isSafeInteger(variableId) || variableId < 1))
        throw fallo(400, 'Cada rango debe especificar codigo o variable_id válido.');
      if (codigo && !VARIABLES.includes(codigo))
        throw fallo(400, 'Variable de rango desconocida: ' + codigo);
      const clave = codigo || `id:${variableId}`;
      if (vistos.has(clave)) throw fallo(400, 'Rango duplicado para la misma variable.');
      vistos.add(clave);
      const minV = Number(item.rango_min);
      const maxV = Number(item.rango_max);
      const umbral = item.umbral_alerta != null && item.umbral_alerta !== '' ? Number(item.umbral_alerta) : null;
      if (!Number.isFinite(minV) || !Number.isFinite(maxV) || minV >= maxV)
        throw fallo(400, `Rango inválido (${clave}): rango_min debe ser menor que rango_max.`);
      if (minV < -273.15 || maxV > 99999999.9999)
        throw fallo(400, `Rango fuera de límites numéricos (${clave}).`);
      if (umbral !== null && (!Number.isFinite(umbral) || umbral < minV || umbral > maxV))
        throw fallo(400, `umbral_alerta fuera del rango [${minV}, ${maxV}] (${clave}).`);
      rangosValidados.push({ codigo, variable_id: variableId, rango_min: minV, rango_max: maxV, umbral_alerta: umbral });
    }
  }

  return {
    ...p,
    referencia_fuente_id: p.referencia_fuente_id ?? null,
    rangos_variables: rangosValidados,
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

async function adjuntarDetalles(db, politicas) {
  if (!politicas.length) return [];
  const ids = politicas.map((p) => p.id);
  const { rows: rangos } = await db.query(
    `SELECT pv.politica_id, pv.variable_id, v.codigo, v.nombre, u.simbolo AS unidad,
            pv.rango_min::float, pv.rango_max::float, pv.umbral_alerta::float
     FROM politica_variable pv
     JOIN variable v ON v.id = pv.variable_id
     JOIN unidad u ON u.id = v.unidad_id
     WHERE pv.politica_id = ANY($1::int[])
     ORDER BY pv.politica_id, v.id`,
    [ids],
  );
  const porPolitica = new Map();
  for (const r of rangos) {
    if (!porPolitica.has(r.politica_id)) porPolitica.set(r.politica_id, []);
    porPolitica.get(r.politica_id).push({
      variable_id: r.variable_id,
      codigo: r.codigo,
      nombre: r.nombre,
      unidad: r.unidad,
      rango_min: r.rango_min,
      rango_max: r.rango_max,
      umbral_alerta: r.umbral_alerta,
    });
  }
  return politicas.map((p) => ({ ...p, rangos_variables: porPolitica.get(p.id) || [] }));
}

async function listarPoliticas(pool) {
  const { rows } = await pool.query(
    `SELECT p.*, rf.nombre AS referencia_nombre, rf.calibracion_ref
     FROM politica_ml p
     LEFT JOIN referencia_fuente rf ON rf.id = p.referencia_fuente_id
     WHERE p.eliminada_en IS NULL
     ORDER BY p.version DESC LIMIT 100`,
  );
  return adjuntarDetalles(pool, rows);
}

async function vigente(pool, { incluirDetalles = false } = {}) {
  const { rows } = await pool.query(
    `SELECT p.*, rf.nombre AS referencia_nombre, rf.calibracion_ref
     FROM politica_ml p
     LEFT JOIN referencia_fuente rf ON rf.id = p.referencia_fuente_id
     WHERE p.vigente_hasta IS NULL AND p.eliminada_en IS NULL
     ORDER BY p.version DESC LIMIT 1`,
  );
  if (!rows.length) throw fallo(503, 'No hay una política vigente.');
  if (!incluirDetalles) return rows[0];
  const [completa] = await adjuntarDetalles(pool, rows);
  return completa;
}

// Toda creación o edición (POST o PUT) crea una nueva versión inmutable en politica_ml
// y conserva intactas las versiones anteriores usadas en evaluaciones previas.
async function guardarPolitica(pool, usuario, body, idBase = null) {
  const p = validarPolitica(body);
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SELECT pg_advisory_xact_lock(192840,1)');
    const admin = await c.query(
      "SELECT id FROM usuario WHERE id=$1 AND activo AND estado='aprobado' AND rol_id=(SELECT id FROM rol WHERE nombre='Administrador') FOR SHARE",
      [usuario],
    );
    if (!admin.rowCount) throw fallo(403, 'Administrador activo requerido.');

    let anterior;
    if (idBase === null) {
      anterior = (
        await c.query(
          'SELECT * FROM politica_ml WHERE vigente_hasta IS NULL AND eliminada_en IS NULL ORDER BY version DESC LIMIT 1 FOR UPDATE',
        )
      ).rows[0];
      if (!anterior) throw fallo(503, 'No hay una política vigente.');
    } else {
      anterior = (
        await c.query('SELECT * FROM politica_ml WHERE id=$1 AND eliminada_en IS NULL FOR UPDATE', [idBase])
      ).rows[0];
      if (!anterior) throw fallo(404, 'Política inexistente.');
      if (anterior.vigente_hasta !== null) {
        throw fallo(
          409,
          'No se puede modificar una versión histórica de política. Crea una nueva versión a partir de la política vigente.',
        );
      }
    }

    if (anterior.version !== p.version_anterior)
      throw fallo(409, 'La política cambió. Actualiza antes de guardar.');

    for (const id of Object.keys(p.configuracion.intervalos_sensor)) {
      if (!(await c.query('SELECT id FROM sensor WHERE id=$1', [id])).rowCount)
        throw fallo(400, 'Sensor inexistente: ' + id);
    }

    const referenciaId = p.referencia_fuente_id ?? anterior.referencia_fuente_id;
    const refRes = await c.query('SELECT id, nombre, calibracion_ref FROM referencia_fuente WHERE id=$1 FOR SHARE', [referenciaId]);
    if (!refRes.rowCount) throw fallo(400, 'Fuente de referencia inexistente: ' + referenciaId);

    const valores = [
      p.motivo.trim(),
      p.completitud_min_pct,
      p.colocacion_dias,
      p.pares_minimos,
      p.test_pct,
      p.mejora_rmse_min_pct,
      p.sin_datos_seg,
      p.configuracion,
    ];

    const alta = await c.query(
      `INSERT INTO politica_ml(version, referencia_fuente_id, creado_por, motivo, completitud_min_pct,
          colocacion_dias, pares_minimos, test_pct, mejora_rmse_min_pct, sin_datos_seg, configuracion)
       SELECT max(version)+1, $9, $10, $1, $2, $3, $4, $5, $6, $7, $8 FROM politica_ml RETURNING *`,
      [...valores, referenciaId, usuario],
    );
    const guardada = alta.rows[0];

    // Cerrar vigencia de la versión anterior sin alterar sus parámetros ni sus rangos.
    await c.query('UPDATE politica_ml SET vigente_hasta=$2 WHERE id=$1', [
      anterior.id,
      guardada.vigente_desde,
    ]);

    if (p.rangos_variables !== null) {
      const { rows: vars } = await c.query('SELECT id, codigo FROM variable');
      const porCodigo = new Map(vars.map((v) => [v.codigo, v.id]));
      const porId = new Set(vars.map((v) => v.id));
      const idsInsertados = new Set();
      for (const r of p.rangos_variables) {
        const vid = r.variable_id != null ? r.variable_id : porCodigo.get(r.codigo);
        if (!vid || !porId.has(vid)) throw fallo(400, `Variable inexistente para rango: ${r.codigo || r.variable_id}`);
        if (idsInsertados.has(vid)) throw fallo(400, 'Rango duplicado para la misma variable.');
        idsInsertados.add(vid);
        await c.query(
          `INSERT INTO politica_variable(politica_id, variable_id, rango_min, rango_max, umbral_alerta)
           VALUES($1, $2, $3, $4, $5)`,
          [guardada.id, vid, r.rango_min, r.rango_max, r.umbral_alerta],
        );
      }
    } else {
      // Si no se enviaron rangos nuevos, heredar los de la versión anterior.
      await c.query(
        `INSERT INTO politica_variable(politica_id, variable_id, rango_min, rango_max, umbral_alerta)
         SELECT $1, variable_id, rango_min, rango_max, umbral_alerta
         FROM politica_variable WHERE politica_id = $2`,
        [guardada.id, anterior.id],
      );
    }

    const [completa] = await adjuntarDetalles(c, [{
      ...guardada,
      referencia_nombre: refRes.rows[0].nombre,
      calibracion_ref: refRes.rows[0].calibracion_ref,
    }]);

    await c.query(
      `INSERT INTO auditoria_evento(usuario_id,entidad,entidad_id,accion,motivo,datos_antes,datos_despues,politica_id)
       VALUES($1,'politica_ml',$2::int,'crear',$3,$4,$5,$2::int)`,
      [usuario, guardada.id, guardada.motivo, anterior, completa],
    );

    await c.query('COMMIT');
    return completa;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

module.exports = { vigente, listarPoliticas, crearPolitica: guardarPolitica, guardarPolitica, validarPolitica };
