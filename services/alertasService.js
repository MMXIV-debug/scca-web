const error = (status, mensaje) => Object.assign(new Error(mensaje), { status });
function crearAlertasService(pool) {
  async function auditar(c, usuario, id, accion, motivo, datos) {
    await c.query(`INSERT INTO auditoria_evento(usuario_id,servicio,entidad,entidad_id,accion,motivo,datos_despues)
      VALUES($1,$2,'alerta',$3,$4,$5,$6::jsonb)`, [usuario || null, usuario ? null : 'servicio_ml', id, accion, motivo, JSON.stringify(datos)]);
  }
  async function comprobar(usuario, umbral) {
    let politica=null;
    if(umbral==null){politica=await require('./politicasService').vigente(pool);umbral=politica.sin_datos_seg;}
    if (!Number.isInteger(umbral) || umbral < 60 || umbral > 604800) throw error(400, 'El umbral debe estar entre 60 y 604800 segundos.');
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SELECT pg_advisory_xact_lock(192838,1)');
      if (usuario) {
        const r = await c.query(`SELECT u.id FROM usuario u JOIN rol r ON r.id=u.rol_id WHERE u.id=$1
          AND u.activo AND u.estado='aprobado' AND r.nombre='Administrador' FOR SHARE OF u`, [usuario]);
        if (!r.rowCount) throw error(403, 'Se requiere un administrador activo.');
      }
      const sensores = await c.query(`SELECT s.id,s.nodo_id,s.activo,n.estado,${politica?'s.origen,n.intervalo_muestreo_s,':''}
        GREATEST(s.alta_en,
          (SELECT MAX(recibido_en) FROM lectura_original WHERE sensor_id=s.id),
          (SELECT MAX(recibido_en) FROM lectura_cuarentena WHERE payload->>'sensorId'=s.id::text)) AS ultima_recepcion,
        now() AS ahora
        FROM sensor s JOIN nodo n ON n.id=s.nodo_id ORDER BY s.id`);
      let abiertas = 0, resueltas = 0;
      for (const s of sensores.rows) {
        const intervalo=politica?(politica.configuracion.intervalos_sensor?.[s.id]||(s.origen==='simulado'?900:s.intervalo_muestreo_s)):0;
        const umbralSensor=politica?Math.max(umbral,intervalo*(politica.configuracion.factor_sin_datos||2)):umbral;
        const regla = `SCCA_SIN_DATOS_SENSOR_${s.id}`;
        const previas = await c.query("SELECT id FROM alerta WHERE tipo='tecnica' AND nodo_id=$1 AND regla=$2 AND estado IN ('abierta','atendida') FOR UPDATE", [s.nodo_id, regla]);
        const supervisar = s.activo && !['inactivo', 'mantenimiento'].includes(s.estado);
        const segundos = (s.ahora - s.ultima_recepcion) / 1000;
        if (supervisar && segundos > umbralSensor && !previas.rowCount) {
          const nueva = await c.query(`INSERT INTO alerta(tipo,nodo_id,regla,calidad,periodo_ini,estado,observacion)
            VALUES('tecnica',$1,$2,'sin_datos',$3,'abierta',$4) RETURNING id::text`,
          [s.nodo_id, regla, s.ultima_recepcion, `Sensor ${s.id}: sin recepción durante más de ${umbralSensor} segundos. No implica fallo físico confirmado.`]);
          await auditar(c, usuario, nueva.rows[0].id, 'crear', 'Inactividad de sensor', { sensor_id: s.id, umbral_s: umbralSensor, politica_version:politica?.version, ultima_recepcion: s.ultima_recepcion });
          abiertas++;
        } else if ((!supervisar || segundos <= umbralSensor) && previas.rowCount) {
          for (const a of previas.rows) {
            const motivo = supervisar ? 'Recepción restablecida' : 'Sensor o nodo fuera de supervisión';
            await c.query("UPDATE alerta SET estado='resuelta',periodo_fin=now(),observacion=$2 WHERE id=$1", [a.id, motivo]);
            await auditar(c, usuario, a.id, 'resolver', motivo, { sensor_id: s.id, umbral_s: umbral });
            resueltas++;
          }
        }
      }
      await c.query('COMMIT'); return { abiertas, resueltas, sensores_comprobados: sensores.rowCount, umbral_s: umbral };
    } catch (e) { await c.query('ROLLBACK'); throw e; }
    finally { c.release(); }
  }
  async function listar(estado = 'abierta', despuesDe = '0', limite = 50) {
    if (!['abierta','atendida','resuelta','todas'].includes(estado) || !/^\d{1,18}$/.test(despuesDe)
        || !Number.isInteger(limite) || limite < 1 || limite > 100) throw error(400, 'Filtros inválidos.');
    const { rows } = await pool.query(`SELECT id::text,tipo,nodo_id,regla,valor,calidad,estado,
      periodo_ini,periodo_fin,generada_en,atendida_por,atendida_en,observacion FROM alerta
      WHERE id>$1 AND ($2='todas' OR estado=$2) ORDER BY id LIMIT $3`, [despuesDe, estado, limite]);
    return { items: rows, siguiente_despues_de: rows.at(-1)?.id || despuesDe };
  }
  async function atender(usuario, id, motivo) {
    if (!/^[1-9]\d{0,17}$/.test(id) || typeof motivo !== 'string' || motivo.trim().length < 10 || motivo.length > 1000)
      throw error(400, 'ID y motivo de 10–1000 caracteres requeridos.');
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const admin = await c.query(`SELECT u.id FROM usuario u JOIN rol r ON r.id=u.rol_id
        WHERE u.id=$1 AND u.activo AND u.estado='aprobado' AND r.nombre='Administrador' FOR SHARE OF u`, [usuario]);
      if (!admin.rowCount) throw error(403, 'Administrador activo requerido.');
      const a = await c.query('SELECT estado,atendida_por,observacion FROM alerta WHERE id=$1 FOR UPDATE', [id]);
      if (!a.rowCount) throw error(404, 'Alerta inexistente.');
      if (a.rows[0].estado === 'atendida' && a.rows[0].atendida_por === usuario && a.rows[0].observacion === motivo.trim()) {
        await c.query('COMMIT'); return { id, estado: 'atendida', repetida: true };
      }
      if (a.rows[0].estado !== 'abierta') throw error(409, 'La alerta ya no está abierta.');
      await c.query("UPDATE alerta SET estado='atendida',atendida_por=$2,atendida_en=now(),observacion=$3 WHERE id=$1", [id, usuario, motivo.trim()]);
      await auditar(c, usuario, id, 'atender', motivo.trim(), { estado: 'atendida' });
      await c.query('COMMIT'); return { id, estado: 'atendida', repetida: false };
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  }
  return { comprobar, listar, atender };
}

function crearRouterAlertas(pool, auth, soloAdmin) {
  const router = require('express').Router(), servicio = crearAlertasService(pool);
  router.use(auth, soloAdmin);
  const responder = fn => async (req, res) => {
    try { res.json(await fn(req)); } catch (e) { res.status(e.status || 503).json({ error: e.status ? e.message : 'No se pudo completar la operación de alertas.' }); }
  };
  const habilitada = (req, res, next) => process.env.ALERTAS_TECNICAS_HABILITADAS === 'true'
    ? next() : res.status(503).json({ error: 'Escritura de alertas no habilitada.' });
  router.get('/', responder(req => servicio.listar(req.query.estado || 'abierta', req.query.despuesDe || '0', Number(req.query.limite || 50))));
  router.post('/comprobar', habilitada, responder(req => servicio.comprobar(req.user.id, process.env.ML_POLITICA_VERSIONADA==='true'?null:Number(process.env.ALERTAS_SIN_DATOS_S || 300))));
  router.post('/:id/atender', habilitada, responder(req => servicio.atender(req.user.id, req.params.id, req.body?.motivo)));
  return router;
}

function iniciarMonitorAlertas(pool) {
  if (process.env.ALERTAS_TECNICAS_HABILITADAS !== 'true' || process.env.ALERTAS_TECNICAS_AUTO !== 'true') return null;
  const servicio = crearAlertasService(pool);
  let ejecutando = false;
  const timer = setInterval(async () => {
    if (ejecutando) return;
    ejecutando = true;
    try { await servicio.comprobar(null, process.env.ML_POLITICA_VERSIONADA==='true'?null:Number(process.env.ALERTAS_SIN_DATOS_S || 300)); }
    catch { console.error('No se pudo comprobar inactividad de sensores.'); }
    finally { ejecutando = false; }
  }, 60000);
  timer.unref(); return timer;
}
module.exports = { crearAlertasService, crearRouterAlertas, iniciarMonitorAlertas };
