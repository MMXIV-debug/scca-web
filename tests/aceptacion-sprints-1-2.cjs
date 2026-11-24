// Suite de aceptación integral Sprints 1 y 2 en PostgreSQL 18 aislado.
// Nunca carga .env ni modifica la base compartida.
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { Client, Pool } = require('pg');

const root = path.resolve(__dirname, '..');

async function puertoLibre() {
  const s = net.createServer();
  await new Promise((res, rej) => {
    s.once('error', rej);
    s.listen(0, '127.0.0.1', res);
  });
  const p = s.address().port;
  await new Promise((res) => s.close(res));
  return p;
}

async function binariosPostgres() {
  if (process.env.PG_BIN) return process.env.PG_BIN;
  if (process.platform === 'win32') {
    const dir = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'PostgreSQL');
    const versiones = await fs.readdir(dir).catch(() => []);
    for (const v of versiones.sort((a, b) => Number(b) - Number(a))) {
      const bin = path.join(dir, v, 'bin');
      if (await fs.stat(path.join(bin, 'initdb.exe')).catch(() => null)) return bin;
    }
    throw Error('Faltan binarios locales de PostgreSQL.');
  }
  return '';
}

function ejecutar(comando, args, env) {
  return new Promise((resolve, reject) => {
    const hijo = spawn(comando, args, {
      cwd: root,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let salida = '';
    hijo.stdout.on('data', (d) => (salida += d));
    hijo.stderr.on('data', (d) => (salida += d));
    hijo.on('error', reject);
    hijo.on('exit', (code) =>
      code === 0
        ? resolve(salida)
        : reject(Error(`${path.basename(comando)} salió con código ${code}:\n${salida.slice(-3000)}`)),
    );
  });
}

async function esperarHttp(url, timeoutMs = 45000) {
  const fin = Date.now() + timeoutMs;
  while (Date.now() < fin) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (r.status < 500) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw Error(`Servicio no respondió a tiempo: ${url}`);
}

function prng(seed) {
  let x = seed >>> 0;
  return () => {
    x = (1664525 * x + 1013904223) >>> 0;
    return x / 4294967296;
  };
}

async function main() {
  const bin = await binariosPostgres();
  const exe = (n) => (bin ? path.join(bin, n + (process.platform === 'win32' ? '.exe' : '')) : n);
  const python = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  await fs.access(python);

  await fs.mkdir(path.join(root, 'tmp'), { recursive: true });
  const carpeta = await fs.mkdtemp(path.join(root, 'tmp', 'aceptacion-s1s2-'));
  const datosPg = path.join(carpeta, 'pgdata');
  const regMl = path.join(carpeta, 'registro_ml');
  const dsDir = path.join(carpeta, 'datasets');
  const [pgPort, apiPort, mlPort, webPort] = [
    await puertoLibre(),
    await puertoLibre(),
    await puertoLibre(),
    await puertoLibre(),
  ];

  const database = 'scca_test_aceptacion';
  const iotKey = 'iot-' + randomUUID();
  const jwtSecret = 'jwt-' + randomUUID() + '-' + randomUUID();
  const appApiPass = 'AppApi_' + randomUUID().replace(/-/g, '').slice(0, 16);
  const adminPass = 'AdminAceptacion#2026!';

  const ownerUrl = `postgresql://scca_owner@127.0.0.1:${pgPort}/${database}`;
  const appApiUrl = `postgresql://app_api:${encodeURIComponent(appApiPass)}@127.0.0.1:${pgPort}/${database}`;

  const baseEnv = { ...process.env, PYTHONIOENCODING: 'utf-8' };
  for (const k of Object.keys(baseEnv)) {
    if (/^Ml__IntervalosSensor__/i.test(k)) delete baseEnv[k];
  }

  let pgIniciado = false;
  const hijos = [];
  let ownerPool, appPool;

  const evidencia = {
    fecha_utc: new Date().toISOString(),
    entorno: 'PostgreSQL 18 local aislado + API .NET + FastAPI ML + Node Express (conectados como app_api)',
    pruebas: [],
  };
  const registrar = (bloque, nombre, ok, detalle) => {
    assert.equal(ok, true, `Fallo en [${bloque}] ${nombre}: ${JSON.stringify(detalle)}`);
    evidencia.pruebas.push({ bloque, nombre, ok: true, detalle });
    console.log(`  [OK] [${bloque}] ${nombre}`);
  };

  try {
    console.log('1) Inicializando PostgreSQL 18 aislado y aplicando migraciones 01..14...');
    await ejecutar(
      exe('initdb'),
      ['-D', datosPg, '-U', 'scca_owner', '-A', 'trust', '--encoding=UTF8', '--locale=C'],
      baseEnv,
    );
    await ejecutar(
      exe('pg_ctl'),
      ['-D', datosPg, '-l', path.join(carpeta, 'pg.log'), '-o', `-p ${pgPort} -h 127.0.0.1`, '-w', 'start'],
      baseEnv,
    );
    pgIniciado = true;
    const initClient = new Client({
      host: '127.0.0.1',
      port: pgPort,
      database: 'postgres',
      user: 'scca_owner',
      connectionTimeoutMillis: 10000,
    });
    await initClient.connect();
    await initClient.query(`CREATE DATABASE ${database}`);
    await initClient.end();

    ownerPool = new Pool({ connectionString: ownerUrl });
    let schema = fsSync
      .readFileSync(path.join(root, 'db/scca.sql'), 'utf8')
      .split(/\r?\n/)
      .slice(3)
      .join('\n');
    schema = schema.replace(
      /^CREATE ROLE app_api .*;$/m,
      `CREATE ROLE app_api LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD '${appApiPass}';`,
    );
    await ownerPool.query(schema);

    const migraciones = [
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
      '14_sprint1_sprint2_hardening.sql', // Verifica idempotencia
    ];
    for (const m of migraciones) {
      await ownerPool.query(fsSync.readFileSync(path.join(root, 'db', m), 'utf8'));
    }

    // Crear catálogo base mínimo y un usuario administrador aprobado
    await ownerPool.query(`
      INSERT INTO unidad(simbolo) VALUES ('µg/m3'),('ppm'),('°C'),('%'),('hPa'),('ohm')
      ON CONFLICT (simbolo) DO NOTHING;
      INSERT INTO variable(codigo, nombre, unidad_id)
      SELECT v.c, v.n, u.id FROM (VALUES
        ('PM1','Material particulado PM1','µg/m3'),
        ('PM25','Material particulado PM2.5','µg/m3'),
        ('PM10','Material particulado PM10','µg/m3'),
        ('CO','Monóxido de carbono','µg/m3'),
        ('TEMP','Temperatura','°C'),
        ('HUM','Humedad relativa','%'),
        ('PRES','Presión atmosférica','hPa'),
        ('GAS','Resistencia de gas (VOC)','ohm')
      ) AS v(c,n,u_s)
      JOIN unidad u ON u.simbolo = v.u_s
      ON CONFLICT (codigo) DO NOTHING;
    `);
    const hashAdmin = bcrypt.hashSync(adminPass, 10);
    await ownerPool.query(
      `INSERT INTO usuario(rol_id, username, nombre_completo, password_hash, estado, activo)
       VALUES ((SELECT id FROM rol WHERE nombre='Administrador'), 'admin_test', 'Admin Aceptacion', $1, 'aprobado', true)`,
      [hashAdmin],
    );
    // Re-aplicar migración 14 para asegurar política_variable sembrada y grants completos
    await ownerPool.query(fsSync.readFileSync(path.join(root, 'db/14_sprint1_sprint2_hardening.sql'), 'utf8'));

    registrar('Setup', 'Migraciones 01..14 (incluida idempotencia de 14)', true, { migraciones: migraciones.length });

    console.log('2) Levantando API .NET, FastAPI ML y Node Express conectados como app_api...');
    const dllPath = path.join(root, 'backend/Scca.Api/bin/Debug/net10.0/Scca.Api.dll');
    if (!fsSync.existsSync(dllPath)) {
      await ejecutar('dotnet', ['build', 'backend/Scca.Api/Scca.Api.csproj', '--nologo'], baseEnv);
    }

    const mlProc = spawn(
      python,
      ['-m', 'uvicorn', 'inferencia:app', '--app-dir', 'ml_engine', '--host', '127.0.0.1', '--port', String(mlPort)],
      {
        cwd: root,
        env: { ...baseEnv, IOT_API_KEY: iotKey, Iot__ApiKey: iotKey, ML_REGISTRO_DIR: regMl },
        stdio: 'ignore',
        windowsHide: true,
      },
    );
    hijos.push(mlProc);

    const apiProc = spawn('dotnet', [dllPath], {
      cwd: root,
      env: {
        ...baseEnv,
        ASPNETCORE_URLS: `http://127.0.0.1:${apiPort}`,
        ASPNETCORE_ENVIRONMENT: 'Development',
        DATABASE_URL: appApiUrl,
        PORT: String(webPort),
        JWT_SECRET: jwtSecret,
        Iot__ApiKey: iotKey,
        Ml__BaseUrl: `http://127.0.0.1:${mlPort}/`,
        Ml__PersistenciaDemoHabilitada: 'true',
        Ml__PoliticaVersionadaHabilitada: 'true',
      },
      stdio: 'ignore',
      windowsHide: true,
    });
    hijos.push(apiProc);

    const webProc = spawn(process.execPath, ['server.js'], {
      cwd: root,
      env: {
        ...baseEnv,
        PORT: String(webPort),
        API_PORT: String(apiPort),
        ML_PORT: String(mlPort),
        DATABASE_URL: appApiUrl,
        JWT_SECRET: jwtSecret,
        IOT_API_KEY: iotKey,
        Iot__ApiKey: iotKey,
        Ml__BaseUrl: `http://127.0.0.1:${mlPort}/`,
        ML_REGISTRO_DIR: regMl,
        CLIMA_DESHABILITADO: 'true',
        CUARENTENA_REVISION_HABILITADA: 'true',
      },
      stdio: 'ignore',
      windowsHide: true,
    });
    hijos.push(webProc);

    await Promise.all([
      esperarHttp(`http://127.0.0.1:${mlPort}/openapi.json`),
      esperarHttp(`http://127.0.0.1:${apiPort}/api/estado`),
      esperarHttp(`http://127.0.0.1:${webPort}/api/estado`),
    ]);

    const apiBase = `http://127.0.0.1:${apiPort}`;
    const webBase = `http://127.0.0.1:${webPort}`;

    // Login como admin en Node Express
    const loginRes = await fetch(`${webBase}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin_test', password: adminPass }),
    });
    assert.equal(loginRes.status, 200, await loginRes.clone().text());
    const { token } = await loginRes.json();

    const webReq = async (method, ruta, body, expectedStatus) => {
      const r = await fetch(`${webBase}${ruta}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(20000),
      });
      const text = await r.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {}
      if (expectedStatus !== undefined) {
        assert.equal(r.status, expectedStatus, `${method} ${ruta} esperaba ${expectedStatus}, obtuvo ${r.status}: ${text}`);
      }
      return { status: r.status, body: json, text };
    };

    const iotReq = async (method, ruta, body, expectedStatus, customKey = iotKey) => {
      const r = await fetch(`${apiBase}${ruta}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(customKey !== null ? { 'X-Api-Key': customKey } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(20000),
      });
      const text = await r.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {}
      if (expectedStatus !== undefined) {
        assert.equal(r.status, expectedStatus, `${method} ${ruta} esperaba ${expectedStatus}, obtuvo ${r.status}: ${text}`);
      }
      return { status: r.status, body: json, text };
    };

    // =========================================================================
    // BLOQUE A (SPRINT 1): GESTIÓN ADMIN DE SITIOS, NODOS, SENSORES, REEMPLAZOS
    // =========================================================================
    console.log('3) Verificando Sprint 1: Infraestructura, duplicados, unidades y reemplazos...');
    const sitio = (
      await webReq(
        'POST',
        '/api/admin/infraestructura/sitios',
        { codigo: 'LPZ-LAB', nombre: 'Laboratorio La Paz', latitud: -16.5, longitud: -68.15, altitud_m: 3640, descripcion: 'Sitio de pruebas Sprint 1' },
        201,
      )
    ).body;

    const nodo = (
      await webReq(
        'POST',
        '/api/admin/infraestructura/nodos',
        { codigo: 'ESP32-LAB-01', sitio_id: sitio.id, intervalo_muestreo_s: 60 },
        201,
      )
    ).body;

    const refCal = (
      await webReq(
        'POST',
        '/api/admin/infraestructura/referencias',
        { nombre: 'Estación Patrón Calibrada BAM-1020', sitio_id: sitio.id, calibracion_ref: 'CERT-NIST-2026-001' },
        201,
      )
    ).body;

    const dht11 = (
      await webReq(
        'POST',
        '/api/admin/infraestructura/sensores',
        { nodo_id: nodo.id, codigo: 'DHT11-LAB-01', modelo: 'DHT11', numero_serie: 'SN-DHT-1001', origen: 'real' },
        201,
      )
    ).body;

    const bme680 = (
      await webReq(
        'POST',
        '/api/admin/infraestructura/sensores',
        { nodo_id: nodo.id, codigo: 'BME680-LAB-01', modelo: 'BME680', numero_serie: 'SN-BME-2001', origen: 'real' },
        201,
      )
    ).body;
    assert.deepEqual(
      bme680.variables.map((v) => `${v.codigo}:${v.simbolo}`).sort(),
      ['GAS:ohm', 'HUM:%', 'PRES:hPa', 'TEMP:°C'],
    );
    registrar('Sprint 1 - Infraestructura', 'Alta de sitio, nodo, referencia calibrada, DHT11 y BME680', true, {
      sitio_id: sitio.id,
      nodo_id: nodo.id,
      referencia_id: refCal.id,
      dht11_id: dht11.id,
      bme680_id: bme680.id,
      variables_bme680: bme680.variables.map((v) => `${v.codigo}(${v.simbolo})`),
    });

    // Rechazo de duplicados (409) y unidades incompatibles (422)
    await webReq(
      'POST',
      '/api/admin/infraestructura/sensores',
      { nodo_id: nodo.id, codigo: 'DHT11-LAB-01', modelo: 'DHT11', numero_serie: 'SN-OTRA', origen: 'real' },
      409,
    );
    await webReq(
      'POST',
      '/api/admin/infraestructura/sensores',
      { nodo_id: nodo.id, codigo: 'DHT11-LAB-DUP', modelo: 'DHT11', numero_serie: 'SN-DHT-1001', origen: 'real' },
      409,
    );
    const varsCat = (await webReq('GET', '/api/admin/infraestructura/resumen', undefined, 200)).body.variables;
    const varByCode = Object.fromEntries(varsCat.map((v) => [v.codigo, v]));
    await webReq(
      'POST',
      '/api/admin/infraestructura/sensores',
      {
        nodo_id: nodo.id,
        codigo: 'DHT11-UNIT-BAD',
        modelo: 'DHT11',
        numero_serie: 'SN-BAD-U',
        origen: 'real',
        variables: [
          { codigo: 'TEMP', unidad_id: varByCode.PRES.unidad_id }, // hPa en TEMP -> incompatible
          { codigo: 'HUM', unidad_id: varByCode.HUM.unidad_id },
        ],
      },
      422,
    );
    registrar('Sprint 1 - Infraestructura', 'Rechazo de sensores duplicados (409) y unidades incompatibles (422)', true, {
      duplicado_codigo: 409,
      duplicado_modelo_serie: 409,
      unidad_incompatible: 422,
    });

    // Mantenimiento y cambio de estado de nodo
    await webReq(
      'POST',
      '/api/admin/infraestructura/mantenimientos',
      {
        nodo_id: nodo.id,
        sensor_id: dht11.id,
        tipo: 'calibracion',
        descripcion: 'Limpieza preventiva y verificación inicial',
        estado_nodo: 'mantenimiento',
      },
      201,
    );
    const estMant = (await ownerPool.query('SELECT estado FROM nodo WHERE id=$1', [nodo.id])).rows[0].estado;
    assert.equal(estMant, 'mantenimiento');
    await webReq(
      'PATCH',
      `/api/admin/infraestructura/nodos/${nodo.id}`,
      { estado: 'activo', motivo: 'Fin de mantenimiento preventivo' },
      200,
    );
    registrar('Sprint 1 - Infraestructura', 'Registro de mantenimiento y cambio de estado del nodo', true, {
      estado_durante_mantenimiento: estMant,
      estado_posterior: 'activo',
    });

    // Reemplazo de sensor conservando historial y retirando modelo ML anterior
    await iotReq(
      'POST',
      '/api/lecturas',
      {
        sensorId: dht11.id,
        idMuestra: 1,
        medidoEn: new Date(Date.now() - 60000).toISOString(),
        lecturas: [
          { variableCodigo: 'TEMP', unidadId: varByCode.TEMP.unidad_id, valor: 19.5 },
          { variableCodigo: 'HUM', unidadId: varByCode.HUM.unidad_id, valor: 52.0 },
        ],
      },
      201,
    );
    const modeloAnteriorId = (
      await ownerPool.query(
        `INSERT INTO modelo_ml(sensor_id, variable_id, politica_id, version, algoritmo, parametros, estado)
         VALUES ($1, $2, (SELECT id FROM politica_ml WHERE vigente_hasta IS NULL ORDER BY version DESC LIMIT 1), 1, 'regresion_lineal', '{"pendiente":1.1}'::jsonb, 'activo')
         RETURNING id`,
        [dht11.id, varByCode.TEMP.id],
      )
    ).rows[0].id;

    const reemplazo = (
      await webReq(
        'POST',
        `/api/admin/infraestructura/sensores/${dht11.id}/reemplazar`,
        {
          codigo: 'DHT11-LAB-02',
          modelo: 'DHT11',
          numero_serie: 'SN-DHT-1002',
          motivo: 'Deriva detectada en sensor original DHT11',
        },
        201,
      )
    ).body;

    const oldSensor = (await ownerPool.query('SELECT activo, baja_en FROM sensor WHERE id=$1', [dht11.id])).rows[0];
    const oldModel = (await ownerPool.query('SELECT estado FROM modelo_ml WHERE id=$1', [modeloAnteriorId])).rows[0];
    const oldLecturas = Number(
      (await ownerPool.query('SELECT count(*) c FROM lectura_original WHERE sensor_id=$1', [dht11.id])).rows[0].c,
    );
    assert.equal(oldSensor.activo, false);
    assert.ok(oldSensor.baja_en !== null);
    assert.equal(oldModel.estado, 'retirado');
    assert.equal(oldLecturas, 2);
    assert.equal(reemplazo.sensor_nuevo.reemplaza_a, dht11.id);
    assert.equal(reemplazo.modelos_retirados.length, 1);

    registrar('Sprint 1 - Reemplazo', 'Reemplazo conserva historial y retira modelo ML anterior automáticamente', true, {
      sensor_anterior_id: dht11.id,
      sensor_anterior_activo: oldSensor.activo,
      lecturas_historicas_conservadas: oldLecturas,
      modelo_anterior_estado: oldModel.estado,
      sensor_nuevo_id: reemplazo.sensor_nuevo.id,
      reemplaza_a: reemplazo.sensor_nuevo.reemplaza_a,
    });

    // =========================================================================
    // BLOQUE B (SPRINT 1): POLÍTICA ML (REFERENCIAS, RANGOS E INMUTABILIDAD)
    // =========================================================================
    console.log('4) Verificando Sprint 1: Política ML versionada inmutable con referencias y rangos...');
    const polLista0 = (await webReq('GET', '/api/admin/ml/politicas', undefined, 200)).body;
    const polVigente0 = polLista0.items.find((x) => !x.vigente_hasta);
    assert.ok(polVigente0);

    const payloadPol1 = {
      version_anterior: polVigente0.version,
      referencia_fuente_id: refCal.id,
      motivo: 'Configurar referencia calibrada y rangos físicos/operativos',
      completitud_min_pct: 75,
      colocacion_dias: 30,
      pares_minimos: 540,
      test_pct: 30,
      mejora_rmse_min_pct: 20,
      sin_datos_seg: 300,
      configuracion: {
        arranque_demo: false,
        factor_sin_datos: 2,
        intervalos_sensor: { [bme680.id]: 60 },
        alertas_ambientales: [],
        alertas_predictivas: [],
      },
      rangos_variables: [
        { codigo: 'TEMP', rango_min: 0, rango_max: 40, umbral_alerta: 35 },
        { codigo: 'HUM', rango_min: 0, rango_max: 100, umbral_alerta: null },
        { codigo: 'PRES', rango_min: 300, rango_max: 1100, umbral_alerta: null },
        { codigo: 'GAS', rango_min: 1, rango_max: 10000000, umbral_alerta: null },
      ],
    };
    const polV2 = (await webReq('POST', '/api/admin/ml/politicas', payloadPol1, 200)).body;
    assert.equal(polV2.version, polVigente0.version + 1);
    assert.equal(polV2.referencia_fuente_id, refCal.id);
    assert.equal(polV2.rangos_variables.length, 4);

    // PUT sobre ruta Node que antes editaba en sitio -> ahora DEBE crear nueva versión
    const polV3 = (
      await webReq(
        'PUT',
        `/api/admin/ml/politicas/${polV2.id}`,
        {
          ...payloadPol1,
          version_anterior: polV2.version,
          motivo: 'Cambio vía PUT Node debe crear nueva versión inmutable',
          pares_minimos: 600,
        },
        200,
      )
    ).body;
    assert.equal(polV3.version, polV2.version + 1);
    assert.notEqual(polV3.id, polV2.id);

    // Verificar que polV2 quedó cerrada e intacta (pares_minimos sigue en 540)
    const checkV2 = (await ownerPool.query('SELECT pares_minimos, vigente_hasta FROM politica_ml WHERE id=$1', [polV2.id])).rows[0];
    assert.equal(Number(checkV2.pares_minimos), 540);
    assert.ok(checkV2.vigente_hasta !== null);

    // PUT sobre versión histórica cerrada debe rechazarse con 409
    await webReq(
      'PUT',
      `/api/admin/ml/politicas/${polV2.id}`,
      { ...payloadPol1, version_anterior: polV2.version, motivo: 'Intento de editar versión histórica cerrada' },
      409,
    );

    // PUT sobre ruta .NET /api/ml/politicas/{id} -> también crea nueva versión (201)
    const rDotnetPol = await fetch(`${apiBase}/api/ml/politicas/${polV3.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        ...payloadPol1,
        version_anterior: polV3.version,
        motivo: 'Cambio vía PUT .NET también genera versión nueva',
        pares_minimos: 620,
      }),
      signal: AbortSignal.timeout(20000),
    });
    const textDotnetPol = await rDotnetPol.text();
    assert.equal(rDotnetPol.status, 201, `PUT .NET politica fallo: ${rDotnetPol.status} ${textDotnetPol}`);
    const polV4Dotnet = JSON.parse(textDotnetPol);
    assert.equal(polV4Dotnet.version, polV3.version + 1);

    // Verificar trigger de BD bloquea UPDATE de parámetros en politica_ml y politica_variable
    await assert.rejects(
      ownerPool.query('UPDATE politica_ml SET pares_minimos = 999 WHERE id = $1', [polV2.id]),
      /inmutables/i,
    );
    await assert.rejects(
      ownerPool.query('UPDATE politica_variable SET rango_max = 999 WHERE politica_id = $1', [polV2.id]),
      /Solo inserción/i,
    );

    registrar('Sprint 1 - Política ML', 'Referencias, rangos por variable y versionado inmutable (POST, PUT Node, PUT .NET y triggers BD)', true, {
      versiones_creadas: [polV2.version, polV3.version, polV4Dotnet.version],
      v2_pares_intactos: Number(checkV2.pares_minimos),
      put_version_historica_http: 409,
      trigger_inmutabilidad_bd: 'activo',
    });

    // =========================================================================
    // BLOQUE C (SPRINT 1): CUENTA LIMITADA app_api (NO SUPERUSUARIO)
    // =========================================================================
    console.log('5) Verificando Sprint 1: Permisos limitados de app_api (sin UPDATE/DELETE/TRUNCATE)...');
    appPool = new Pool({ connectionString: appApiUrl });
    const who = (
      await appPool.query('SELECT current_user AS usr, rolsuper FROM pg_roles WHERE rolname = current_user')
    ).rows[0];
    assert.equal(who.usr, 'app_api');
    assert.equal(who.rolsuper, false);

    const pruebasBloqueo = [
      ['UPDATE lectura_original', 'UPDATE lectura_original SET valor = 999'],
      ['DELETE lectura_original', 'DELETE FROM lectura_original'],
      ['TRUNCATE lectura_original', 'TRUNCATE TABLE lectura_original'],
      ['UPDATE auditoria_evento', "UPDATE auditoria_evento SET motivo = 'alterado'"],
      ['DELETE auditoria_evento', 'DELETE FROM auditoria_evento'],
      ['TRUNCATE auditoria_evento', 'TRUNCATE TABLE auditoria_evento'],
    ];
    const codigosError = {};
    for (const [etiqueta, sql] of pruebasBloqueo) {
      let codigo = null;
      try {
        await appPool.query(sql);
      } catch (e) {
        codigo = e.code;
      }
      assert.equal(codigo, '42501', `${etiqueta} debió fallar con 42501 (permission denied), obtuvo ${codigo}`);
      codigosError[etiqueta] = codigo;
    }
    // Incluso el superusuario queda bloqueado en TRUNCATE CASCADE por los triggers BEFORE TRUNCATE
    await assert.rejects(ownerPool.query('TRUNCATE TABLE lectura_original CASCADE'), /Solo inserción/);
    await assert.rejects(ownerPool.query('TRUNCATE TABLE auditoria_evento CASCADE'), /Solo inserción/);

    registrar('Sprint 1 - Seguridad BD', 'app_api sin superusuario y bloqueo de UPDATE/DELETE/TRUNCATE en originales y auditoría', true, {
      usuario: who.usr,
      rolsuper: who.rolsuper,
      sqlstate_bloqueos: codigosError,
      triggers_truncate_superuser: 'bloqueados',
    });

    // =========================================================================
    // BLOQUE D (SPRINT 2): BME680 + ESP32 24H SIN CONEXIÓN (1,440 MUESTRAS)
    // =========================================================================
    console.log('6) Verificando Sprint 2: Firmware ESP32, BME680 y 1.440 muestras sin conexión/duplicados...');
    const ino = fsSync.readFileSync(path.join(root, 'arduino/scca_esp32/scca_esp32.ino'), 'utf8');
    const cfg = fsSync.readFileSync(path.join(root, 'arduino/scca_esp32/config.h'), 'utf8');
    const fw = `${cfg}\n${ino}`;
    assert.match(cfg, /#define\s+MAX_MUESTRAS_BUFFER\s+1440U?\b/);
    assert.match(cfg, /#define\s+INTERVALO_CAPTURA_SEG_DEF\s+60U?\b/);
    assert.match(cfg, /#define\s+INTERVALO_ENVIO_SEG_DEF\s+900U?\b/);
    assert.match(fw, /LittleFS/);
    assert.match(fw, /Preferences/);
    assert.match(fw, /calcularCrc/);
    assert.match(fw, /\/api\/lecturas\/lote/);
    assert.match(fw, /PERFIL_BME680/);
    assert.match(fw, /PERFIL_DHT11/);

    // Recepción individual BME680 + duplicado 409
    const muestraBme1 = {
      sensorId: bme680.id,
      idMuestra: 1,
      medidoEn: new Date(Date.now() - 120000).toISOString(),
      lecturas: [
        { variableCodigo: 'TEMP', unidadId: varByCode.TEMP.unidad_id, valor: 21.4 },
        { variableCodigo: 'HUM', unidadId: varByCode.HUM.unidad_id, valor: 48.5 },
        { variableCodigo: 'PRES', unidadId: varByCode.PRES.unidad_id, valor: 1012.8 },
        { variableCodigo: 'GAS', unidadId: varByCode.GAS.unidad_id, valor: 145000 },
      ],
    };
    await iotReq('POST', '/api/lecturas', muestraBme1, 201);
    await iotReq('POST', '/api/lecturas', muestraBme1, 409);

    // Simular vaciado de buffer de 24h sin red: 1.440 muestras (1/min) en 96 lotes de 15 muestras (cada 15 min)
    const inicio24h = Date.now() - 25 * 3600 * 1000;
    let totalGuardadas = 0;
    let primerLote = null;
    for (let b = 0; b < 96; b++) {
      const muestras = [];
      for (let i = 0; i < 15; i++) {
        const idx = b * 15 + i;
        const idMuestra = 1000 + idx;
        muestras.push({
          sensorId: bme680.id,
          idMuestra,
          medidoEn: new Date(inicio24h + idx * 60000).toISOString(),
          lecturas: [
            { variableCodigo: 'TEMP', unidadId: varByCode.TEMP.unidad_id, valor: Number((18 + (idx % 10) * 0.5).toFixed(2)) },
            { variableCodigo: 'HUM', unidadId: varByCode.HUM.unidad_id, valor: Number((45 + (idx % 15)).toFixed(2)) },
            { variableCodigo: 'PRES', unidadId: varByCode.PRES.unidad_id, valor: Number((650 + (idx % 5) * 0.3).toFixed(2)) },
            { variableCodigo: 'GAS', unidadId: varByCode.GAS.unidad_id, valor: 120000 + idx * 10 },
          ],
        });
      }
      if (b === 0) primerLote = muestras;
      const respLote = (await iotReq('POST', '/api/lecturas/lote', { muestras }, 200)).body;
      assert.equal(respLote.guardadas, 15);
      assert.equal(respLote.duplicadas, 0);
      assert.equal(respLote.rechazadas, 0);
      totalGuardadas += respLote.guardadas;
    }
    assert.equal(totalGuardadas, 1440);

    // Reenvío del primer lote (15 ya recibidas) + 5 nuevas -> sin duplicados
    const muestrasNuevas5 = Array.from({ length: 5 }, (_, k) => ({
      sensorId: bme680.id,
      idMuestra: 3000 + k,
      medidoEn: new Date(inicio24h + (1440 + k) * 60000).toISOString(),
      lecturas: [
        { variableCodigo: 'TEMP', unidadId: varByCode.TEMP.unidad_id, valor: 20.5 },
        { variableCodigo: 'HUM', unidadId: varByCode.HUM.unidad_id, valor: 50.0 },
        { variableCodigo: 'PRES', unidadId: varByCode.PRES.unidad_id, valor: 651.2 },
        { variableCodigo: 'GAS', unidadId: varByCode.GAS.unidad_id, valor: 135000 },
      ],
    }));
    const reenvio = (
      await iotReq('POST', '/api/lecturas/lote', { muestras: [...primerLote, ...muestrasNuevas5] }, 200)
    ).body;
    assert.equal(reenvio.duplicadas, 15);
    assert.equal(reenvio.guardadas, 5);
    assert.equal(reenvio.rechazadas, 0);

    const conteoBme = (
      await appPool.query(
        'SELECT count(*) AS filas, count(DISTINCT id_muestra) AS muestras FROM lectura_original WHERE sensor_id=$1',
        [bme680.id],
      )
    ).rows[0];
    assert.equal(Number(conteoBme.muestras), 1446); // 1 individual + 1440 + 5 nuevas
    assert.equal(Number(conteoBme.filas), 1446 * 4);

    registrar('Sprint 2 - ESP32 y BME680', 'Firmware .ino verificado + ingesta BME680 (1.440 muestras offline en 96 lotes + reenvío sin duplicados)', true, {
      muestras_offline_guardadas: totalGuardadas,
      reenvio_duplicadas_detectadas: reenvio.duplicadas,
      reenvio_nuevas_guardadas: reenvio.guardadas,
      muestras_unicas_bd: Number(conteoBme.muestras),
      filas_variables_bd: Number(conteoBme.filas),
    });

    // =========================================================================
    // BLOQUE E (SPRINT 2): POLÍTICA DE LECTURAS INVÁLIDAS (RECHAZO VS CUARENTENA)
    // =========================================================================
    console.log('7) Verificando Sprint 2: Matriz de rechazo directo vs cuarentena de lecturas inválidas...');
    const qAntes = Number((await appPool.query('SELECT count(*) c FROM lectura_cuarentena')).rows[0].c);

    // Rechazos directos (NO escriben en cuarentena)
    await iotReq('POST', '/api/lecturas', muestraBme1, 401, 'clave-incorrecta');
    await iotReq('POST', '/api/lecturas', { ...muestraBme1, idMuestra: 5001, medidoEn: '2026-10-01T12:00:00' }, 400);
    await iotReq('POST', '/api/lecturas', { ...muestraBme1, sensorId: dht11.id, idMuestra: 5002 }, 400); // sensor dado de baja
    await iotReq(
      'POST',
      '/api/lecturas',
      {
        sensorId: bme680.id,
        idMuestra: 5003,
        medidoEn: new Date(Date.now() - 60000).toISOString(),
        lecturas: [
          { variableCodigo: 'TEMP', unidadId: varByCode.TEMP.unidad_id, valor: 20 },
          { variableCodigo: 'TEMP', unidadId: varByCode.TEMP.unidad_id, valor: 21 },
        ],
      },
      400,
    );
    await iotReq(
      'POST',
      '/api/lecturas',
      {
        sensorId: bme680.id,
        idMuestra: 5004,
        medidoEn: new Date(Date.now() - 60000).toISOString(),
        lecturas: [
          { variableCodigo: 'TEMP', unidadId: varByCode.PRES.unidad_id, valor: 20 }, // unidad incompatible
          { variableCodigo: 'HUM', unidadId: varByCode.HUM.unidad_id, valor: 50 },
          { variableCodigo: 'PRES', unidadId: varByCode.PRES.unidad_id, valor: 650 },
          { variableCodigo: 'GAS', unidadId: varByCode.GAS.unidad_id, valor: 100000 },
        ],
      },
      422,
    );
    await iotReq(
      'POST',
      '/api/lecturas',
      {
        sensorId: bme680.id,
        idMuestra: 5005,
        medidoEn: new Date(Date.now() - 60000).toISOString(),
        lecturas: [{ variableCodigo: 'PM25', unidadId: varByCode.PM25.unidad_id, valor: 10 }], // variable ajena
      },
      422,
    );
    const qTrasRechazos = Number((await appPool.query('SELECT count(*) c FROM lectura_cuarentena')).rows[0].c);
    assert.equal(qTrasRechazos, qAntes);

    // Casos conservados en cuarentena (201 + estado='cuarentena' + dato_invalido)
    const cFisico = (
      await iotReq(
        'POST',
        '/api/lecturas',
        {
          sensorId: bme680.id,
          idMuestra: 6001,
          medidoEn: new Date(Date.now() - 60000).toISOString(),
          lecturas: [
            { variableCodigo: 'TEMP', unidadId: varByCode.TEMP.unidad_id, valor: 20 },
            { variableCodigo: 'HUM', unidadId: varByCode.HUM.unidad_id, valor: 105 }, // > 100%
            { variableCodigo: 'PRES', unidadId: varByCode.PRES.unidad_id, valor: 650 },
            { variableCodigo: 'GAS', unidadId: varByCode.GAS.unidad_id, valor: 100000 },
          ],
        },
        201,
      )
    ).body;
    assert.equal(cFisico.estado, 'cuarentena');
    assert.equal(cFisico.evaluacionMl.estado, 'dato_invalido');

    const cPolitica = (
      await iotReq(
        'POST',
        '/api/lecturas',
        {
          sensorId: bme680.id,
          idMuestra: 6002,
          medidoEn: new Date(Date.now() - 60000).toISOString(),
          lecturas: [
            { variableCodigo: 'TEMP', unidadId: varByCode.TEMP.unidad_id, valor: 45 }, // físico BME680 ok (-40..85), pero fuera de política [0, 40]
            { variableCodigo: 'HUM', unidadId: varByCode.HUM.unidad_id, valor: 50 },
            { variableCodigo: 'PRES', unidadId: varByCode.PRES.unidad_id, valor: 650 },
            { variableCodigo: 'GAS', unidadId: varByCode.GAS.unidad_id, valor: 100000 },
          ],
        },
        201,
      )
    ).body;
    assert.equal(cPolitica.estado, 'cuarentena');
    assert.match(cPolitica.causa, /rango de política/i);

    const cIncompleta = (
      await iotReq(
        'POST',
        '/api/lecturas',
        {
          sensorId: bme680.id,
          idMuestra: 6003,
          medidoEn: new Date(Date.now() - 60000).toISOString(),
          lecturas: [
            { variableCodigo: 'TEMP', unidadId: varByCode.TEMP.unidad_id, valor: 20 },
            { variableCodigo: 'HUM', unidadId: varByCode.HUM.unidad_id, valor: 50 },
          ],
        },
        201,
      )
    ).body;
    assert.equal(cIncompleta.estado, 'cuarentena');

    const cFutura = (
      await iotReq(
        'POST',
        '/api/lecturas',
        {
          sensorId: bme680.id,
          idMuestra: 6004,
          medidoEn: new Date(Date.now() + 2 * 3600 * 1000).toISOString(),
          lecturas: [
            { variableCodigo: 'TEMP', unidadId: varByCode.TEMP.unidad_id, valor: 20 },
            { variableCodigo: 'HUM', unidadId: varByCode.HUM.unidad_id, valor: 50 },
            { variableCodigo: 'PRES', unidadId: varByCode.PRES.unidad_id, valor: 650 },
            { variableCodigo: 'GAS', unidadId: varByCode.GAS.unidad_id, valor: 100000 },
          ],
        },
        201,
      )
    ).body;
    assert.equal(cFutura.estado, 'cuarentena');

    // Duplicado de una muestra ya en cuarentena -> 409
    await iotReq(
      'POST',
      '/api/lecturas',
      {
        sensorId: bme680.id,
        idMuestra: 6001,
        medidoEn: new Date(Date.now() - 60000).toISOString(),
        lecturas: [
          { variableCodigo: 'TEMP', unidadId: varByCode.TEMP.unidad_id, valor: 20 },
          { variableCodigo: 'HUM', unidadId: varByCode.HUM.unidad_id, valor: 105 },
          { variableCodigo: 'PRES', unidadId: varByCode.PRES.unidad_id, valor: 650 },
          { variableCodigo: 'GAS', unidadId: varByCode.GAS.unidad_id, valor: 100000 },
        ],
      },
      409,
    );

    // Revisión administrativa de cuarentena: no permite restaurar dato_invalido (422) y sí descartar conservando registro
    const pendientesResp = (await webReq('GET', '/api/admin/cuarentena', undefined, 200)).body;
    const pendientes = pendientesResp.items;
    assert.equal(pendientes.length, 4);
    const idsCuarentena = pendientes.map((p) => String(p.id));
    await webReq(
      'POST',
      '/api/admin/cuarentena/decisiones',
      {
        ids: [idsCuarentena[0]],
        accion: 'restaurar',
        clasificacion: 'normal',
        motivo: 'Intento de restaurar dato físicamente inválido',
      },
      422,
    );
    await webReq(
      'POST',
      '/api/admin/cuarentena/decisiones',
      {
        ids: idsCuarentena,
        accion: 'descartar',
        clasificacion: 'dato_invalido',
        motivo: 'Confirmados fuera de rango, incompletos o fecha futura en revisión',
      },
      200,
    );

    registrar('Sprint 2 - Cuarentena', 'Separación rechazo directo (400/401/409/422) vs cuarentena revisable (dato_invalido)', true, {
      rechazos_sin_escritura: ['401_api_key', '400_sin_tz', '400_sensor_baja', '400_var_dup', '422_unidad', '422_var_ajena', '409_dup_cuarentena'],
      cuarentena_guardada: [cFisico.causa, cPolitica.causa, cIncompleta.causa, cFutura.causa],
      restaurar_invalido_rechazado: 422,
      descartados_con_auditoria: idsCuarentena.length,
    });

    // =========================================================================
    // BLOQUE F (SPRINT 2): CALIBRACIÓN ML EMPAREJADA CON REFERENCIA CALIBRADA
    // =========================================================================
    console.log('8) Verificando Sprint 2: Calibración ML con referencia calibrada (RMSE >= 20%, MAE y |sesgo|)...');
    const bmeCal = (
      await webReq(
        'POST',
        '/api/admin/infraestructura/sensores',
        { nodo_id: nodo.id, codigo: 'BME680-CAL-01', modelo: 'BME680', numero_serie: 'SN-BME-CAL-01', origen: 'real' },
        201,
      )
    ).body;
    const bmeSinMejora = (
      await webReq(
        'POST',
        '/api/admin/infraestructura/sensores',
        { nodo_id: nodo.id, codigo: 'BME680-NOIMP-01', modelo: 'BME680', numero_serie: 'SN-BME-NOIMP-01', origen: 'real' },
        201,
      )
    ).body;

    // Sembrar 35 días completos (840 horas) cerradas en el pasado para calibración
    const ahoraHora = new Date();
    ahoraHora.setUTCMinutes(0, 0, 0);
    const finCal = new Date(ahoraHora.getTime() - 2 * 3600 * 1000);
    const horasTotal = 35 * 24; // 840 horas
    const iniCal = new Date(finCal.getTime() - horasTotal * 3600 * 1000);
    const rand = prng(20261124);

    const lecturasRef = [];
    const filasSensorCal = [];
    const filasSensorNoImp = [];
    for (let h = 0; h < horasTotal; h++) {
      const ts = new Date(iniCal.getTime() + h * 3600 * 1000 + 15 * 60000); // :15 de cada hora
      const tempRef = Number((15 + 7 * Math.sin((2 * Math.PI * (h % 24)) / 24) + 2 * Math.cos((2 * Math.PI * h) / (24 * 7))).toFixed(3));
      const humRef = Number((55 - 12 * Math.sin((2 * Math.PI * (h % 24)) / 24)).toFixed(3));
      const ruido1 = (rand() - 0.5) * 0.4;
      const ruido2 = (rand() - 0.5) * 0.4;
      // Sensor con sesgo y ganancia sistemática (corregible por regresión lineal / RF)
      const tempSensorSesgado = Number((0.85 * tempRef + 4.2 + ruido1).toFixed(3));
      // Sensor casi sin sesgo (ruido puro, no debería superar umbral >= 20% RMSE)
      const tempSensorRuido = Number((tempRef + ruido2).toFixed(3));

      lecturasRef.push({ variable_codigo: 'TEMP', unidad_id: varByCode.TEMP.unidad_id, valor: tempRef, medido_en: ts.toISOString() });
      const idM = 10000 + h;
      for (const [vid, uid, val] of [
        [varByCode.TEMP.id, varByCode.TEMP.unidad_id, tempSensorSesgado],
        [varByCode.HUM.id, varByCode.HUM.unidad_id, humRef],
        [varByCode.PRES.id, varByCode.PRES.unidad_id, 650.5],
        [varByCode.GAS.id, varByCode.GAS.unidad_id, 130000],
      ]) {
        filasSensorCal.push([bmeCal.id, vid, uid, idM, val, ts.toISOString()]);
      }
      for (const [vid, uid, val] of [
        [varByCode.TEMP.id, varByCode.TEMP.unidad_id, tempSensorRuido],
        [varByCode.HUM.id, varByCode.HUM.unidad_id, humRef],
        [varByCode.PRES.id, varByCode.PRES.unidad_id, 650.5],
        [varByCode.GAS.id, varByCode.GAS.unidad_id, 130000],
      ]) {
        filasSensorNoImp.push([bmeSinMejora.id, vid, uid, idM, val, ts.toISOString()]);
      }
    }

    // Ingestar referencia calibrada por la API administrativa
    const refIngesta = (
      await webReq(
        'POST',
        `/api/admin/infraestructura/referencias/${refCal.id}/lecturas`,
        { lecturas: lecturasRef },
        201,
      )
    ).body;
    assert.equal(refIngesta.insertadas, horasTotal);

    // Insertar lecturas originales de ambos sensores como app_api (simulando 35 días históricos ya capturados)
    const insertarLoteOrig = async (filas) => {
      const vals = [];
      const params = [];
      let p = 1;
      for (const r of filas) {
        vals.push(`($${p++},$${p++},$${p++},$${p++},$${p++},$${p++},'valida')`);
        params.push(...r);
      }
      await appPool.query(
        `INSERT INTO lectura_original(sensor_id,variable_id,unidad_id,id_muestra,valor,medido_en,calidad) VALUES ${vals.join(',')}`,
        params,
      );
    };
    await insertarLoteOrig(filasSensorCal);
    await insertarLoteOrig(filasSensorNoImp);

    const mlEnv = { ...baseEnv, DATABASE_URL: appApiUrl };
    const dsOutOk = await ejecutar(
      python,
      [
        'ml_engine/preparar_datasets.py',
        '--sensor-id',
        String(bmeCal.id),
        '--desde',
        iniCal.toISOString(),
        '--hasta',
        finCal.toISOString(),
        '--intervalo-s',
        '3600',
        '--referencia-fuente-id',
        String(refCal.id),
        '--salida',
        dsDir,
      ],
      mlEnv,
    );
    const carpetaDsOk = dsOutOk.match(/Dataset:\s*(.+)/)[1].trim();
    const manOk = JSON.parse(fsSync.readFileSync(path.join(carpetaDsOk, 'manifiesto.json'), 'utf8'));
    assert.equal(manOk.validacion_independiente, true);
    assert.equal(manOk.referencia_calibrada.fuente_id, refCal.id);

    const evalOutOk = await ejecutar(
      python,
      [
        'ml_engine/entrenador.py',
        '--registro',
        regMl,
        'evaluar',
        '--dataset',
        carpetaDsOk,
        '--proposito',
        'calibracion',
        '--variable',
        'TEMP',
      ],
      mlEnv,
    );
    const verOk = evalOutOk.match(/Versión:\s*([a-f0-9]+)/)[1];
    const infOk = JSON.parse(fsSync.readFileSync(path.join(regMl, 'versiones', verOk, 'informe.json'), 'utf8'));
    assert.equal(infOk.estado, 'apto_demo');
    assert.ok(infOk.particiones.entrenamiento.fin < infOk.particiones.prueba_final.inicio);
    const mejoraPct = ((infOk.metricas.base.rmse - infOk.metricas.candidato.rmse) / infOk.metricas.base.rmse) * 100;
    assert.ok(mejoraPct >= 20, `Mejora RMSE insuficiente: ${mejoraPct}`);
    assert.ok(infOk.metricas.candidato.mae <= infOk.metricas.base.mae);
    assert.ok(Math.abs(infOk.metricas.candidato.sesgo) <= Math.abs(infOk.metricas.base.sesgo));

    // Caso negativo: sin mejora real -> rechazado y NO activado
    const dsOutRech = await ejecutar(
      python,
      [
        'ml_engine/preparar_datasets.py',
        '--sensor-id',
        String(bmeSinMejora.id),
        '--desde',
        iniCal.toISOString(),
        '--hasta',
        finCal.toISOString(),
        '--intervalo-s',
        '3600',
        '--referencia-fuente-id',
        String(refCal.id),
        '--salida',
        dsDir,
      ],
      mlEnv,
    );
    const carpetaDsRech = dsOutRech.match(/Dataset:\s*(.+)/)[1].trim();
    const evalOutRech = await ejecutar(
      python,
      [
        'ml_engine/entrenador.py',
        '--registro',
        regMl,
        'evaluar',
        '--dataset',
        carpetaDsRech,
        '--proposito',
        'calibracion',
        '--variable',
        'TEMP',
      ],
      mlEnv,
    );
    const verRech = evalOutRech.match(/Versión:\s*([a-f0-9]+)/)[1];
    const infRech = JSON.parse(fsSync.readFileSync(path.join(regMl, 'versiones', verRech, 'informe.json'), 'utf8'));
    assert.equal(infRech.estado, 'rechazado');
    const regJson = JSON.parse(fsSync.readFileSync(path.join(regMl, 'registro.json'), 'utf8'));
    assert.equal(regJson.activos[infOk.clave], verOk);
    assert.equal(regJson.activos[infRech.clave], undefined);

    registrar('Sprint 2 - Calibración ML', 'Emparejamiento con referencia calibrada, evaluación posterior (RMSE >= 20%, MAE y |sesgo|) y rechazo sin mejora', true, {
      pares_emparejados: infOk.pares,
      dias_cubiertos: infOk.dias_cubiertos,
      particion_entrenamiento: infOk.particiones.entrenamiento,
      particion_prueba_final: infOk.particiones.prueba_final,
      algoritmo_seleccionado: infOk.algoritmo,
      rmse_original: Number(infOk.metricas.base.rmse.toFixed(4)),
      rmse_calibrado: Number(infOk.metricas.candidato.rmse.toFixed(4)),
      mejora_rmse_pct: Number(mejoraPct.toFixed(2)),
      mae_original: Number(infOk.metricas.base.mae.toFixed(4)),
      mae_calibrado: Number(infOk.metricas.candidato.mae.toFixed(4)),
      sesgo_original: Number(infOk.metricas.base.sesgo.toFixed(4)),
      sesgo_calibrado: Number(infOk.metricas.candidato.sesgo.toFixed(4)),
      estado_aprobado: infOk.estado,
      caso_sin_mejora_estado: infRech.estado,
      caso_sin_mejora_razones: infRech.razones,
    });

    // Guardar JSON de evidencias reproducible en docs/evidencias-sprints-1-2/
    const dirEv = path.join(root, 'docs', 'evidencias-sprints-1-2');
    await fs.mkdir(dirEv, { recursive: true });
    const rutaEv = path.join(dirEv, 'resultado-aceptacion.json');
    await fs.writeFile(rutaEv, JSON.stringify(evidencia, null, 2), 'utf8');
    console.log(`\nACEPTACIÓN SPRINTS 1 Y 2 COMPLETA: ${evidencia.pruebas.length} bloques verificados al 100%.`);
    console.log(`Evidencia guardada en: ${rutaEv}`);
  } finally {
    for (const h of hijos) {
      try {
        h.kill();
      } catch {}
    }
    if (appPool) await appPool.end().catch(() => {});
    if (ownerPool) await ownerPool.end().catch(() => {});
    if (pgIniciado) {
      await ejecutar(exe('pg_ctl'), ['-D', datosPg, '-m', 'fast', 'stop'], baseEnv).catch(() => {});
    }
    await fs.rm(carpeta, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((e) => {
  console.error('ERROR EN ACEPTACIÓN SPRINTS 1 Y 2:\n', e.stack || e.message);
  process.exit(1);
});
