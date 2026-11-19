const fallo = (status, mensaje) => Object.assign(new Error(mensaje), { status });
const idValido = x => typeof x === 'string' && /^[1-9][0-9]{0,18}$/.test(x) && BigInt(x) <= 9223372036854775807n;
const terminal = "entidad='lectura_cuarentena' AND accion IN ('restaurar','descartar')";

function crearCuarentenaService(pool) {
  async function listar({ despuesDe = '0', limite = 50, estado = 'pendiente' } = {}) {
    if (!(despuesDe === '0' || idValido(despuesDe)) || !Number.isInteger(limite) || limite < 1 || limite > 100
        || !['pendiente', 'restaurada', 'descartada', 'todas'].includes(estado)) throw fallo(400, 'Filtros inválidos.');
    const { rows } = await pool.query(`
      SELECT q.id::text, q.payload, q.causa, q.recibido_en,
        CASE a.accion WHEN 'restaurar' THEN 'restaurada' WHEN 'descartar' THEN 'descartada' ELSE 'pendiente' END AS estado,
        a.usuario_id, a.motivo, a.creado_en AS decidido_en
      FROM lectura_cuarentena q LEFT JOIN LATERAL (
        SELECT usuario_id,accion,motivo,creado_en FROM auditoria_evento
        WHERE ${terminal} AND entidad_id=q.id ORDER BY id DESC LIMIT 1
      ) a ON true
      WHERE q.id>$1 AND ($3='todas' OR ($3='pendiente' AND a.accion IS NULL)
        OR ($3='restaurada' AND a.accion='restaurar') OR ($3='descartada' AND a.accion='descartar'))
      ORDER BY q.id LIMIT $2`, [despuesDe, limite, estado]);
    return { items: rows, siguiente_despues_de: rows.at(-1)?.id || despuesDe };
  }

  async function decidir(usuarioId, { ids, accion, motivo } = {}) {
    if (!Array.isArray(ids) || !ids.length || ids.length > 50 || !ids.every(idValido)
        || new Set(ids).size !== ids.length || !['restaurar', 'descartar'].includes(accion)
        || typeof motivo !== 'string' || motivo.trim().length < 10 || motivo.trim().length > 1000)
      throw fallo(400, 'Usa 1–50 IDs distintos como texto, acción restaurar/descartar y motivo de 10–1000 caracteres.');
    ids = [...ids].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Revalidar privilegios dentro de la misma transacción de decisión.
      const admin = await client.query(`SELECT u.id FROM usuario u JOIN rol r ON r.id=u.rol_id
        WHERE u.id=$1 AND u.activo AND u.estado='aprobado' AND r.nombre='Administrador' FOR SHARE OF u`, [usuarioId]);
      if (!admin.rowCount) throw fallo(403, 'Se requiere un administrador activo.');
      const filas = await client.query('SELECT id::text,payload FROM lectura_cuarentena WHERE id=ANY($1::bigint[]) ORDER BY id FOR UPDATE', [ids]);
      if (filas.rowCount !== ids.length) throw fallo(404, 'Alguna muestra no existe. No se aplicó el lote.');
      if (accion === 'restaurar') {
        const sensores = [...new Set(filas.rows.map(f => f.payload?.sensorId))];
        if (!sensores.every(s => Number.isSafeInteger(s) && s > 0 && s <= 2147483647)) throw fallo(422, 'La muestra no tiene un sensor válido.');
        for (const s of sensores.sort((a, b) => a - b)) await client.query('SELECT pg_advisory_xact_lock(192837,$1)', [s]);
      }
      const resultados = [];
      for (const fila of filas.rows) {
        const previo = await client.query(`SELECT accion,motivo,datos_despues FROM auditoria_evento
          WHERE ${terminal} AND entidad_id=$1`, [fila.id]);
        if (previo.rowCount) {
          if (previo.rows[0].accion !== accion || previo.rows[0].motivo !== motivo.trim()) throw fallo(409, 'La muestra ya tiene una decisión diferente.');
          resultados.push({ id: fila.id, accion, repetida: true });
          continue;
        }
        const lecturasIds = [];
        if (accion === 'restaurar') {
          const p = fila.payload;
          if (!Number.isSafeInteger(p.idMuestra) || p.idMuestra <= 0 || !Array.isArray(p.lecturas)
              || p.lecturas.length < 1 || p.lecturas.length > 32 || typeof p.medidoEn !== 'string'
              || !/(Z|[+-]\d\d:\d\d)$/.test(p.medidoEn) || !Number.isFinite(Date.parse(p.medidoEn))
              || Date.parse(p.medidoEn) > Date.now() + 300000) throw fallo(422, 'Payload inválido; no se puede restaurar.');
          const sensor = await client.query('SELECT modelo,origen FROM sensor WHERE id=$1 AND activo FOR SHARE', [p.sensorId]);
          if (!sensor.rowCount) throw fallo(422, 'Sensor inexistente o inactivo.');
          const catalogo = await client.query(`SELECT v.id,v.codigo,v.unidad_id FROM sensor_variable sv
            JOIN variable v ON v.id=sv.variable_id WHERE sv.sensor_id=$1`, [p.sensorId]);
          const codigos = new Set(p.lecturas.map(l => l?.variableCodigo));
          if (codigos.size !== p.lecturas.length || catalogo.rowCount !== p.lecturas.length)
            throw fallo(422, 'La muestra debe contener el catálogo completo sin variables repetidas.');
          const existentes = await client.query('SELECT id FROM lectura_original WHERE sensor_id=$1 AND id_muestra=$2 LIMIT 1', [p.sensorId, p.idMuestra]);
          if (existentes.rowCount) throw fallo(409, 'Ya hay lecturas originales para esta muestra; no se sobrescriben.');
          for (const l of p.lecturas) {
            const v = catalogo.rows.find(v => v.codigo === l.variableCodigo && v.unidad_id === l.unidadId);
            if (!v || typeof l.valor !== 'number' || !Number.isFinite(l.valor) || l.valor < 0 || l.valor > 99999999.9999
                || Math.abs(l.valor * 10000 - Math.round(l.valor * 10000)) > 0.0001)
              throw fallo(422, 'Variable, unidad o valor incompatible con la ingesta actual.');
            if (sensor.rows[0].origen === 'real' && sensor.rows[0].modelo.toUpperCase() === 'DHT11'
                && !(l.variableCodigo === 'TEMP' && l.valor <= 50 || l.variableCodigo === 'HUM' && l.valor <= 100))
              throw fallo(422, 'Lectura DHT11 fuera de rango.');
            const insertada = await client.query(`INSERT INTO lectura_original(sensor_id,variable_id,unidad_id,id_muestra,valor,medido_en,calidad)
              VALUES($1,$2,$3,$4,$5,$6,'valida') RETURNING id::text`, [p.sensorId, v.id, l.unidadId, p.idMuestra, l.valor, p.medidoEn]);
            lecturasIds.push(insertada.rows[0].id);
          }
        }
        await client.query(`INSERT INTO auditoria_evento(usuario_id,entidad,entidad_id,accion,motivo,datos_despues)
          VALUES($1,'lectura_cuarentena',$2,$3,$4,$5::jsonb)`, [usuarioId, fila.id, accion, motivo.trim(),
          JSON.stringify({ decision: accion, lecturas_ids: lecturasIds, origen: 'revision_manual', payload_conservado: true })]);
        resultados.push({ id: fila.id, accion, repetida: false, lecturas_ids: lecturasIds });
      }
      await client.query('COMMIT');
      return { resultados };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }
  return { listar, decidir };
}

function crearRouterCuarentena(pool, auth, soloAdmin) {
  const router = require('express').Router();
  const service = crearCuarentenaService(pool);
  router.use(auth, soloAdmin);
  router.get('/', async (req, res) => {
    try { res.json(await service.listar({ despuesDe: req.query.despuesDe || '0', limite: Number(req.query.limite || 50), estado: req.query.estado || 'pendiente' })); }
    catch (e) { res.status(e.status || 503).json({ error: e.status ? e.message : 'No se pudo consultar cuarentena.' }); }
  });
  router.post('/decisiones', async (req, res) => {
    if (process.env.CUARENTENA_REVISION_HABILITADA !== 'true') return res.status(503).json({ error: 'Revisión no habilitada; requiere migración y configuración local.' });
    try { res.json(await service.decidir(req.user.id, req.body)); }
    catch (e) { res.status(e.status || 503).json({ error: e.status ? e.message : 'No se aplicó la decisión. Revisa conexión y migración.' }); }
  });
  return router;
}
module.exports = { crearCuarentenaService, crearRouterCuarentena };
