const assert = require('node:assert/strict'),
  express = require('express'),
  { Pool } = require('pg');
const { crearRouterPanelMl } = require('../services/panelMlService');
const database = process.env.SCCA_TEST_DATABASE,
  port = Number(process.env.SCCA_TEST_PORT);
if (!database?.startsWith('scca_test_') || !Number.isInteger(port) || port < 1024)
  throw Error('Base temporal local requerida.');
const pool = new Pool({ host: '127.0.0.1', port, database, user: 'scca_test' });
let server;
(async () => {
  try {
    await pool.query(`INSERT INTO ml_demo_version(version,sensor_id,nodo_id,perfil,proposito,variable_id,horizonte_h,metadatos) VALUES(repeat('b',32),1,1,'contaminantes_simulados','pronostico',1,1,'{}');
 INSERT INTO ml_demo_resultado(version,periodo_inicio,periodo_fin,entrada,entrada_sha256,resultado)
 SELECT repeat('b',32),h,h+interval '1 hour','{}',repeat('c',64),jsonb_build_object('modelo_version',repeat('b',32),'estado','evaluado_demo','ambito','demostracion','calibracion_fisica_validada',false,'valor',12,'objetivo_inicio',h+interval '1 hour','objetivo_fin',h+interval '2 hours')
 FROM (SELECT date_trunc('hour',now())-make_interval(hours=>n) h FROM generate_series(1,140) n) d`);
    const app = express();
    app.use(express.json());
    app.use(
      '/api/admin/ml',
      crearRouterPanelMl(
        pool,
        (req, res, next) => {
          const id = Number(req.headers['x-test-user']);
          if (!id) return res.sendStatus(401);
          req.user = { id, rol: id === 1 ? 'Administrador' : 'Visualizador' };
          next();
        },
        (req, res, next) => (req.user.rol === 'Administrador' ? next() : res.sendStatus(403)),
      ),
    );
    server = app.listen(15061, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    const query = new URLSearchParams({
      sensorId: '1',
      desde: new Date(Date.now() - 8 * 86400000).toISOString(),
      hasta: new Date().toISOString(),
    });
    const options = { headers: { 'X-Test-User': '1' } };
    assert.equal(
      (await (await fetch('http://127.0.0.1:15061/api/admin/ml/reportes?' + query, options)).json())
        .items.length,
      100,
    );
    const csv = await (
      await fetch('http://127.0.0.1:15061/api/admin/ml/reportes.csv?' + query, options)
    ).text();
    assert.equal(csv.split('\r\n').length, 141);
    assert.equal(
      (await fetch('http://127.0.0.1:15061/api/admin/ml/reportes.csv?' + query)).status,
      401,
    );
    assert.equal(
      (
        await fetch('http://127.0.0.1:15061/api/admin/ml/reportes.csv?' + query, {
          headers: { 'X-Test-User': '2' },
        })
      ).status,
      403,
    );
    const { vigente, crearPolitica } = require('../services/politicasService'),
      { comprobarAmbientales } = require('../services/alertasAmbientalesService');
    const p = await vigente(pool),
      body = {
        ...p,
        version_anterior: p.version,
        motivo: 'Umbral predictivo de prueba local',
        completitud_min_pct: Number(p.completitud_min_pct),
        test_pct: Number(p.test_pct),
        mejora_rmse_min_pct: Number(p.mejora_rmse_min_pct),
        configuracion: {
          ...p.configuracion,
          alertas_predictivas: [{ horizonte_h: 1, umbral: 10 }],
        },
      };
    await crearPolitica(pool, 1, body);
    assert.equal((await comprobarAmbientales(pool, async () => [])).creadas, 0);
    assert.equal((await comprobarAmbientales(pool, async () => ['b'.repeat(32)])).creadas, 1);
    const siguiente = await vigente(pool);
    await crearPolitica(pool, 1, {
      ...body,
      version_anterior: siguiente.version,
      configuracion: {
        ...body.configuracion,
        alertas_predictivas: [{ horizonte_h: 1, umbral: 20 }],
      },
    });
    assert.equal((await comprobarAmbientales(pool, async () => ['b'.repeat(32)])).resueltas, 1);
    console.log(
      'OK: consulta de 100, exportación de 140 resultados, permisos y alertas predictivas solo con modelo activo.',
    );
  } finally {
    if (server) {
      server.closeAllConnections();
      server.close();
    }
    await pool.end();
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
