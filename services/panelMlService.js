const express = require('express');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { vigente, listarPoliticas, guardarPolitica } = require('./politicasService');
let entrenamiento = null;
const fallo = (status, message) => Object.assign(new Error(message), { status });
async function ml(ruta, body) {
  const r = await fetch(
    (process.env.Ml__BaseUrl || `http://127.0.0.1:${process.env.ML_PORT || 8000}/`) + ruta,
    {
      method: body ? 'POST' : 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': process.env.Iot__ApiKey || process.env.IOT_API_KEY || '',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(20000),
    },
  );
  const d = await r.json();
  if (!r.ok) throw fallo(r.status === 409 ? 409 : 503, d.detail || 'Servicio ML no disponible.');
  return d;
}
async function ejecutarEvaluacion(body) {
  const r = await fetch(`http://127.0.0.1:${process.env.API_PORT || 5051}/api/modelo/evaluar`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': process.env.Iot__ApiKey || process.env.IOT_API_KEY || '',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(40000),
  });
  const d = await r.json();
  if (!r.ok) throw fallo(r.status, d.error || d.title || 'No se pudo evaluar.');
  return d;
}
async function evaluar(body, modeloActivo) {
  if (modeloActivo === undefined) {
    const registro = await ml('api/v2/modelos/registro');
    const activos = registro.activos || registro.items.filter(m => m.activo);
    modeloActivo = activos.find(m => m.sensor.sensor_id === Number(body.sensorId)
      && m.proposito === body.proposito && m.variable === body.variable
      && m.horizonte_h === Number(body.horizonteH || 0)) || null;
  }
  return require('./correctorStrategy').evaluar(body, modeloActivo, ejecutarEvaluacion);
}
function filtrosReportes(q) {
  const sensor = Number(q.sensorId),
    cursor = q.despuesDe || '0';
  if (!Number.isSafeInteger(sensor) || sensor <= 0 || !/^\d{1,18}$/.test(cursor))
    throw fallo(400, 'Sensor o cursor inválido.');
  const desde = q.desde ? new Date(q.desde) : new Date(Date.now() - 7 * 86400000),
    hasta = q.hasta ? new Date(q.hasta) : new Date();
  if (
    !Number.isFinite(+desde) ||
    !Number.isFinite(+hasta) ||
    desde >= hasta ||
    hasta - desde > 366 * 86400000
  )
    throw fallo(400, 'Indica un rango creciente de hasta 366 días.');
  return [sensor, cursor, desde, hasta];
}
async function reportes(pool, q, limite = 100) {
  const params = filtrosReportes(q);
  const { rows } = await pool.query(
    `SELECT r.id::text,r.periodo_inicio,r.periodo_fin,r.resultado,v.version,v.proposito,v.horizonte_h,v.perfil,v.sensor_id FROM ml_demo_resultado r JOIN ml_demo_version v ON v.version=r.version WHERE v.sensor_id=$1 AND r.id>$2 AND r.periodo_inicio>=$3 AND r.periodo_inicio<$4 ORDER BY r.id LIMIT $5`,
    [...params, limite],
  );
  return {
    items: rows,
    siguiente_despues_de: rows.at(-1)?.id || params[1],
    ambito: 'demostracion',
    desde: params[2],
    hasta: params[3],
  };
}
function crearRouterPanelMl(pool, auth, soloAdmin) {
  const router = express.Router();
  router.use(auth, soloAdmin);
  const responder = (fn) => async (req, res) => {
    try {
      res.json(await fn(req));
    } catch (e) {
      res
        .status(e.status || 503)
        .json({ error: e.status ? e.message : 'No se pudo completar la operación ML.' });
    }
  };
  router.get(
    '/politicas',
    responder(async () => ({
      items: await listarPoliticas(pool),
      referencias: (await pool.query('SELECT id, nombre, sitio_id, calibracion_ref FROM referencia_fuente ORDER BY id')).rows,
      variables: (await pool.query('SELECT v.id, v.codigo, v.nombre, u.simbolo AS unidad FROM variable v JOIN unidad u ON u.id = v.unidad_id ORDER BY v.id')).rows,
    })),
  );
  router.post(
    '/politicas',
    responder((req) => guardarPolitica(pool, req.user.id, req.body)),
  );
  router.put(
    '/politicas/:id',
    responder((req) => {
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id < 1) throw fallo(400, 'ID de política inválido.');
      // Nunca altera una política existente: crea una nueva versión a partir de la vigente.
      return guardarPolitica(pool, req.user.id, req.body, id);
    }),
  );
  router.get(
    '/sensores',
    responder(async () => ({
      items: (
        await pool.query(
          `SELECT s.id,s.nodo_id,s.modelo,s.origen,s.activo,n.intervalo_muestreo_s,array_agg(v.codigo ORDER BY v.codigo) AS variables FROM sensor s JOIN nodo n ON n.id=s.nodo_id JOIN sensor_variable sv ON sv.sensor_id=s.id JOIN variable v ON v.id=sv.variable_id GROUP BY s.id,n.intervalo_muestreo_s ORDER BY s.id`,
        )
      ).rows,
    })),
  );
  router.get(
    '/modelos',
    responder(async () => {
      const [registro, datos] = await Promise.all([
        ml('api/v2/modelos/registro'),
        pool.query(`
          SELECT s.id, s.modelo,
            (SELECT max(l.medido_en) FROM lectura_original l
             WHERE l.sensor_id=s.id AND l.calidad='valida') AS ultima_lectura,
            (SELECT count(*)::int FROM (
              SELECT l.id_muestra FROM lectura_original l
              JOIN variable v ON v.id=l.variable_id
              WHERE l.sensor_id=s.id AND l.calidad='valida'
                AND ((upper(trim(s.modelo))='DHT11' AND v.codigo IN ('TEMP','HUM'))
                  OR (upper(trim(s.modelo))='BME680' AND v.codigo IN ('TEMP','HUM','PRES','GAS')))
                AND l.medido_en>=date_trunc('hour',now())-interval '48 hours'
                AND l.medido_en<date_trunc('hour',now())
              GROUP BY l.id_muestra
              HAVING count(*)=CASE WHEN upper(trim(s.modelo))='BME680' THEN 4 ELSE 2 END
                AND count(DISTINCT v.codigo)=CASE WHEN upper(trim(s.modelo))='BME680' THEN 4 ELSE 2 END
                AND min(l.medido_en)=max(l.medido_en)
            ) completas) AS muestras_completas_48h
          FROM sensor s WHERE upper(trim(s.modelo)) IN ('DHT11','BME680') AND s.origen='real' AND s.activo
          ORDER BY s.id
        `),
      ]);
      return { ...registro, datos_sensores: datos.rows };
    }),
  );
  router.get(
    '/operacion',
    responder(async () => ({
      entrenamiento,
      politica_version: (await vigente(pool)).version,
      procesamiento: require('./procesamientoMlService').estado(),
    })),
  );
  router.post(
    '/procesar',
    responder(() => require('./procesamientoMlService').procesar(pool)),
  );
  router.post(
    '/comprobar-alertas',
    responder(() => require('./alertasAmbientalesService').comprobarAmbientales(pool)),
  );
  router.post(
    '/evaluar',
    responder((req) => evaluar(req.body)),
  );
  router.post(
    '/revertir',
    responder(async (req) => {
      if (
        typeof req.body?.clave !== 'string' ||
        req.body.clave.length > 200 ||
        typeof req.body.motivo !== 'string' ||
        req.body.motivo.trim().length < 10 ||
        req.body.motivo.length > 1000
      )
        throw fallo(400, 'Clave y motivo de 10–1000 caracteres requeridos.');
      const { rows } = await pool.query(
        "INSERT INTO auditoria_evento(usuario_id,entidad,accion,motivo,datos_despues) VALUES($1,'registro_ml','solicitar_reversion',$2,$3) RETURNING id",
        [req.user.id, req.body.motivo, JSON.stringify({ clave: req.body.clave })],
      );
      const r = await ml('api/v2/modelos/revertir', req.body);
      await pool.query(
        "INSERT INTO auditoria_evento(usuario_id,entidad,accion,motivo,datos_despues) VALUES($1,'registro_ml','revertir',$2,$3)",
        [
          req.user.id,
          req.body.motivo,
          JSON.stringify({ solicitud_id: rows[0].id, clave: req.body.clave, ...r }),
        ],
      );
      return r;
    }),
  );
  router.post(
    '/entrenar',
    responder(async (req) => {
      if (entrenamiento?.estado === 'ejecutando')
        throw fallo(409, 'Ya hay una evaluación en curso.');
      entrenamiento = { estado: 'ejecutando', inicio: new Date().toISOString() };
      try {
        await vigente(pool);
        await pool.query(
          "INSERT INTO auditoria_evento(usuario_id,entidad,accion,motivo) VALUES($1,'registro_ml','solicitar_ciclo','Evaluación de candidatos solicitada desde el panel')",
          [req.user.id],
        );
        const root = path.resolve(__dirname, '..');
        const child = spawn(
          path.join(
            root,
            '.venv',
            process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
          ),
          ['-u', path.join(root, 'ml_engine/ciclo_automatico.py')],
          { cwd: root, env: process.env, windowsHide: true, stdio: 'ignore' },
        );
        child.on('error', () => {
          entrenamiento = { ...entrenamiento, estado: 'error', fin: new Date().toISOString() };
        });
        child.on('exit', (code) => {
          entrenamiento = {
            ...entrenamiento,
            estado: code === 0 ? 'completado' : 'error',
            fin: new Date().toISOString(),
          };
        });
        return entrenamiento;
      } catch (e) {
        entrenamiento = { ...entrenamiento, estado: 'error', fin: new Date().toISOString() };
        throw e;
      }
    }),
  );
  router.get(
    '/reportes',
    responder((req) => reportes(pool, req.query)),
  );
  router.get('/reportes.csv', async (req, res) => {
    try {
      const d = await reportes(pool, { ...req.query, despuesDe: '0' }, 10001);
      if (d.items.length > 10000)
        throw fallo(413, 'El periodo supera 10000 resultados. Acorta el rango para exportar.');
      const keys = [
        'id',
        'sensor_id',
        'perfil',
        'version',
        'proposito',
        'horizonte_h',
        'periodo_inicio',
        'periodo_fin',
        'resultado',
      ];
      const cell = (v) =>
        '"' +
        String(
          v == null
            ? ''
            : typeof v === 'object'
              ? v instanceof Date
                ? v.toISOString()
                : JSON.stringify(v)
              : v,
        )
          .replace(/^[\s=+@-]/, "'$&")
          .replaceAll('"', '""') +
        '"';
      res
        .set('Content-Type', 'text/csv; charset=utf-8')
        .set('Content-Disposition', 'attachment; filename="reporte-ml.csv"')
        .send(
          '\ufeff' +
            [
              keys.map(cell).join(','),
              ...d.items.map((i) => keys.map((k) => cell(i[k])).join(',')),
            ].join('\r\n'),
        );
    } catch (e) {
      res.status(e.status || 503).json({ error: e.status ? e.message : 'No se pudo exportar.' });
    }
  });
  return router;
}
module.exports = { crearRouterPanelMl, evaluar, ml, filtrosReportes };
