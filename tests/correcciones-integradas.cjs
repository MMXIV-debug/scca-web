// Solo PostgreSQL local vacío. No carga ni usa el .env de la aplicación.
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  http = require('node:http');
const { spawn } = require('node:child_process'),
  { Pool } = require('pg');
const database = process.env.SCCA_TEST_DATABASE,
  port = Number(process.env.SCCA_TEST_PORT);
if (!database?.startsWith('scca_test_') || !Number.isInteger(port) || port < 1024)
  throw Error('Base temporal requerida.');
const pool = new Pool({ host: '127.0.0.1', port, database, user: 'scca_test' }),
  root = path.resolve(__dirname, '..');
let api,
  mock,
  anomalia = false,
  mlDisponible = true,
  sinRespuesta = false,
  detectorFisico = false,
  llamadas = 0,
  checks = 0;
const secret = 'clave-exclusivamente-pruebas';
const { crearPolitica, vigente } = require('../services/politicasService');
const { comprobarAmbientales } = require('../services/alertasAmbientalesService');
async function post(body, status = 201) {
  const r = await fetch('http://127.0.0.1:15060/api/lecturas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': secret },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  assert.equal(r.status, status, await r.clone().text());
  checks++;
  return r.json();
}
(async () => {
  try {
    assert.equal(
      (
        await pool.query(
          "SELECT count(*) n FROM information_schema.tables WHERE table_schema='public'",
        )
      ).rows[0].n,
      '0',
    );
    let schema = fs
      .readFileSync(path.join(root, 'db/scca.sql'), 'utf8')
      .split(/\r?\n/)
      .slice(3)
      .join('\n');
    if ((await pool.query("SELECT 1 FROM pg_roles WHERE rolname='app_api'")).rowCount)
      schema = schema.replace(/^CREATE ROLE app_api .*;$/m, '');
    await pool.query(schema);
    for (const file of [
      '02_auth.sql',
      '03_jerarquia_admin.sql',
      '04_resultados_ml_demo.sql',
      '05_revision_cuarentena.sql',
      '06_alertas_tecnicas.sql',
      '07_estado_usuarios.sql',
      '08_trazabilidad_muestras.sql',
      '09_politica_operativa.sql',
      '10_detectores_versionados.sql',
      '11_validacion_ml_historial.sql',
      '12_crud_catalogo_ml.sql',
      '13_pronostico_clima.sql',
      '14_sprint1_sprint2_hardening.sql',
    ])
      await pool.query(fs.readFileSync(path.join(root, 'db', file), 'utf8'));
    for (const file of [
      '07_estado_usuarios.sql',
      '08_trazabilidad_muestras.sql',
      '09_politica_operativa.sql',
      '10_detectores_versionados.sql',
      '11_validacion_ml_historial.sql',
      '12_crud_catalogo_ml.sql',
      '13_pronostico_clima.sql',
      '14_sprint1_sprint2_hardening.sql',
    ])
      await pool.query(fs.readFileSync(path.join(root, 'db', file), 'utf8'));
    checks++;
    await pool.query(`INSERT INTO sitio(codigo,nombre,latitud,longitud) VALUES('TEST','Sitio de prueba',0,0);INSERT INTO nodo(codigo,sitio_id) VALUES('TEST',1);
 INSERT INTO sensor(nodo_id,codigo,modelo,numero_serie,origen) VALUES(1,'SIM','Python Script','1','simulado'),(1,'DHT','DHT11','2','real'),(1,'BME','BME680','3','real');
 INSERT INTO unidad(simbolo) VALUES('µg/m3'),('°C'),('%'),('hPa'),('ohm');
 INSERT INTO variable(codigo,nombre,unidad_id) VALUES('PM25','PM2.5',1),('PM1','PM1',1),('PM10','PM10',1),('CO','CO',1),('TEMP','Temperatura',2),('HUM','Humedad',3),('PRES','Presión',4),('GAS','Resistencia',5);
 INSERT INTO sensor_variable SELECT s.id,v.id FROM sensor s CROSS JOIN variable v WHERE (s.id=1 AND v.id<=4) OR (s.id=2 AND v.id IN (5,6)) OR (s.id=3 AND v.id>=5);
 INSERT INTO usuario(rol_id,username,nombre_completo,password_hash,estado) VALUES(2,'visualizador','Prueba','sin-login','aprobado');UPDATE usuario SET estado='inactivo' WHERE username='visualizador';`);
    checks++;
    mock = http.createServer(async (req, res) => {
      const chunks = [];
      for await (const x of req) chunks.push(x);
      const input = JSON.parse(Buffer.concat(chunks));
      const identity = { perfil: input.perfil, nodo_id: input.nodo_id, sensor_id: input.sensor_id };
      res.setHeader('Content-Type', 'application/json');
      if (detectorFisico && input.perfil === 'bme680')
        return res.end(
          JSON.stringify({
            ...identity,
            estado: 'evaluado_demo',
            es_anomalia: false,
            modelo_version: 'b'.repeat(32),
          }),
        );
      if (input.perfil !== 'contaminantes_simulados')
        return res.end(
          JSON.stringify({
            ...identity,
            estado: 'sin_modelo',
            es_anomalia: null,
            modelo_version: null,
          }),
        );
      llamadas++;
      if (sinRespuesta) return;
      res.statusCode = mlDisponible ? 200 : 503;
      res.end(
        JSON.stringify({
          ...identity,
          estado: 'evaluado_legacy',
          es_anomalia: anomalia,
          modelo_version: 'a'.repeat(64),
        }),
      );
    });
    await new Promise((r) => mock.listen(18060, '127.0.0.1', r));
    api = spawn(
      'dotnet',
      [path.join(root, 'backend/Scca.Api/bin/comprobacion-persistencia/Scca.Api.dll')],
      {
        windowsHide: true,
        stdio: 'ignore',
        env: {
          ...process.env,
          ASPNETCORE_URLS: 'http://127.0.0.1:15060',
          ASPNETCORE_ENVIRONMENT: 'Development',
          DATABASE_URL: `postgresql://scca_test@127.0.0.1:${port}/${database}`,
          Iot__ApiKey: secret,
          Ml__BaseUrl: 'http://127.0.0.1:18060/',
        },
      },
    );
    for (let n = 0; n < 50; n++) {
      try {
        await fetch('http://127.0.0.1:15060/swagger/index.html');
        break;
      } catch {}
      await new Promise((r) => setTimeout(r, 200));
    }
    const sensor = (sensorId, idMuestra, lecturas) => ({
      sensorId,
      idMuestra,
      medidoEn: new Date(Date.now() - 10000).toISOString(),
      lecturas,
    });
    const l = (variableCodigo, unidadId, valor) => ({ variableCodigo, unidadId, valor });
    const dht = sensor(2, 1, [l('TEMP', 2, 20), l('HUM', 3, 50)]);
    const d = await post(dht);
    assert.equal(d.esAnomalia, null);
    assert.equal(d.evaluacionMl.estado, 'sin_modelo');
    assert.equal(llamadas, 0);
    await post(dht, 409);
    const incompleta = await post(sensor(2, 2, [l('TEMP', 2, 20)]), 201);
    assert.equal(incompleta.estado, 'cuarentena');
    assert.equal(incompleta.evaluacionMl.estado, 'dato_invalido');
    await post(sensor(2, 99, [l('TEMP', 1, 20), l('HUM', 3, 50)]), 422);
    await post({ ...dht, idMuestra: 3, medidoEn: '2026-01-01T01:00:00' }, 400);
    await post(
      sensor(3, 1, [l('TEMP', 2, -5), l('HUM', 3, 50), l('PRES', 4, 1010), l('GAS', 5, 1000)]),
    );
    assert.equal(llamadas, 0);
    const fueraRango = await post(
      sensor(3, 2, [l('TEMP', 2, 20), l('HUM', 3, 101), l('PRES', 4, 1010), l('GAS', 5, 1000)]),
      201,
    );
    assert.equal(fueraRango.estado, 'cuarentena');
    assert.equal(fueraRango.evaluacionMl.estado, 'dato_invalido');
    detectorFisico = true;
    assert.equal(
      (
        await post(
          sensor(3, 3, [l('TEMP', 2, 20), l('HUM', 3, 50), l('PRES', 4, 1010), l('GAS', 5, 1000)]),
        )
      ).evaluacionMl.estado,
      'evaluado_demo',
    );
    detectorFisico = false;
    const sim = (n) =>
      sensor(1, n, [l('PM25', 1, 12), l('PM1', 1, 8), l('PM10', 1, 20), l('CO', 1, 100)]);
    assert.equal((await post(sim(1))).evaluacionMl.modeloVersion, 'a'.repeat(64));
    anomalia = true;
    const revisable = sim(2);
    revisable.medidoEn = new Date(
      Math.floor(Date.now() / 3600000) * 3600000 - 2 * 3600000 + 300000,
    ).toISOString();
    assert.equal((await post(revisable)).estado, 'cuarentena');
    const q = (await pool.query('SELECT payload FROM lectura_cuarentena WHERE sensor_id = 1')).rows[0].payload;
    assert.equal(q.evaluacionMl.modeloVersion, 'a'.repeat(64));
    mlDisponible = false;
    assert.equal((await post(sim(3))).evaluacionMl.estado, 'ml_no_disponible');
    sinRespuesta = true;
    mlDisponible = true;
    const inicioEspera = Date.now();
    assert.equal((await post(sim(4))).evaluacionMl.estado, 'ml_no_disponible');
    assert.ok(Date.now() - inicioEspera < 8000);
    sinRespuesta = false;
    const revision = require('../services/cuarentenaService').crearCuarentenaService(pool),
      idsRevision = [(await pool.query('SELECT id::text FROM lectura_cuarentena WHERE sensor_id = 1')).rows[0].id];
    await assert.rejects(
      revision.decidir(1, {
        ids: idsRevision,
        accion: 'descartar',
        clasificacion: 'episodio_ambiental',
        motivo: 'Contraste manual de prueba con referencia',
      }),
      (e) => e.status === 400,
    );
    await revision.decidir(1, {
      ids: idsRevision,
      accion: 'restaurar',
      clasificacion: 'episodio_ambiental',
      motivo: 'Contraste manual de prueba con referencia',
    });
    checks++;
    await assert.rejects(pool.query("UPDATE evaluacion_muestra SET estado='sin_modelo'"));
    checks++;
    const original = await vigente(pool);
    const body = {
      ...original,
      version_anterior: original.version,
      motivo: 'Configuración de prueba aislada',
      completitud_min_pct: 75,
      colocacion_dias: 30,
      pares_minimos: 540,
      test_pct: 30,
      mejora_rmse_min_pct: 20,
      sin_datos_seg: 300,
      configuracion: {
        factor_sin_datos: 2,
        intervalos_sensor: { 1: 900, 2: 60, 3: 60 },
        alertas_ambientales: [
          { perfil: 'contaminantes_simulados', variable: 'PM25', periodo_h: 1, umbral: 10 },
        ],
        alertas_predictivas: [],
      },
    };
    const p = await crearPolitica(pool, 1, body);
    assert.equal(p.version, 2);
    await assert.rejects(crearPolitica(pool, 1, body), (e) => e.status === 409);
    checks++;
    // Cuatro slots en una hora cerrada; los reintentos no deben inflar cobertura.
    await pool.query(`INSERT INTO lectura_original(sensor_id,variable_id,unidad_id,id_muestra,valor,medido_en,calidad)
 SELECT 1,1,1,100+n,20,date_trunc('hour',now())-interval '1 hour'+make_interval(mins=>n*15),'valida' FROM generate_series(0,3) n`);
    const serie = await require('../services/seriesService').horas(pool, 24);
    assert.equal(
      serie.filter((r) => r.sensor_id === 1 && r.codigo === 'PM25' && r.valor != null).at(-1).valor,
      20,
    );
    checks++;
    const abiertas = await comprobarAmbientales(pool);
    assert.equal(abiertas.creadas, 1);
    assert.equal((await comprobarAmbientales(pool)).creadas, 0);
    checks++;
    const body3 = {
      ...body,
      version_anterior: 2,
      configuracion: { ...body.configuracion, alertas_ambientales: [] },
    };
    await crearPolitica(pool, 1, body3);
    assert.equal((await comprobarAmbientales(pool)).resueltas, 1);
    checks++;
    console.log(
      `OK: ${checks} verificaciones; instalación real, migraciones repetibles, perfiles, cuarentena, ML caído, trazabilidad, política y periodos ambientales.`,
    );
  } finally {
    if (api) api.kill();
    if (mock) {
      mock.closeAllConnections();
      mock.close();
    }
    await pool.end();
  }
})().catch((e) => {
  console.error(e.stack);
  process.exitCode = 1;
});
