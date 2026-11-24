// Demostración completa con PostgreSQL, API .NET y scikit-learn reales.
// No carga .env y nunca conecta a la base compartida.
const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');
const { Client } = require('pg');
const root = __dirname;

async function puertoLibre() {
  const servidor = net.createServer();
  await new Promise((resolve, reject) => { servidor.once('error', reject); servidor.listen(0, '127.0.0.1', resolve); });
  const puerto = servidor.address().port;
  await new Promise(resolve => servidor.close(resolve));
  return puerto;
}

async function binariosPostgres() {
  if (process.env.PG_BIN) return process.env.PG_BIN;
  if (process.platform === 'win32') {
    const directorio = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'PostgreSQL');
    const versiones = await fs.readdir(directorio).catch(() => []);
    for (const version of versiones.sort((a, b) => Number(b) - Number(a))) {
      const bin = path.join(directorio, version, 'bin');
      if (await fs.stat(path.join(bin, 'initdb.exe')).catch(() => null)) return bin;
    }
    throw Error('Faltan los binarios locales de PostgreSQL. Instala PostgreSQL o configura PG_BIN con su carpeta bin.');
  }
  return '';
}

function ejecutar(comando, args, env) {
  return new Promise((resolve, reject) => {
    const hijo = spawn(comando, args, { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let salida = '';
    hijo.stdout.on('data', d => { salida += d; });
    hijo.stderr.on('data', d => { salida += d; });
    hijo.on('error', reject);
    hijo.on('exit', codigo => codigo === 0 ? resolve(salida) : reject(Error(`${path.basename(comando)} terminó con código ${codigo}.\n${salida.slice(-2500)}`)));
  });
}

async function principal() {
  if (process.argv.includes('--ayuda')) {
    console.log('npm.cmd run prueba:correccion\nCrea una instalación local temporal, envía lecturas 10 a la API, aplica el modelo real de prueba y=2x+1 y verifica 21 en PostgreSQL. Comprueba también el caso sin modelo. No usa la base compartida. Requiere PostgreSQL local (binarios), .NET SDK y .venv.');
    return;
  }
  if (process.argv.length > 2) throw Error('Usa el comando sin argumentos, o --ayuda.');
  const bin = await binariosPostgres();
  const exe = nombre => bin ? path.join(bin, nombre + (process.platform === 'win32' ? '.exe' : '')) : nombre;
  const python = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  await fs.access(python);
  await fs.mkdir(path.join(root, 'tmp'), { recursive: true });
  const carpeta = await fs.mkdtemp(path.join(root, 'tmp', 'correccion-ml-'));
  const datos = path.join(carpeta, 'postgres');
  const registro = path.join(carpeta, 'registro');
  const [pgPort, apiPort, mlPort] = [await puertoLibre(), await puertoLibre(), await puertoLibre()];
  assert.equal(new Set([pgPort, apiPort, mlPort]).size, 3, 'Se necesitan tres puertos libres diferentes.');
  const database = 'scca_test_correccion';
  const clave = randomUUID();
  const entorno = { ...process.env, DATABASE_URL: `postgresql://scca_demo@127.0.0.1:${pgPort}/${database}`,
    ASPNETCORE_ENVIRONMENT: 'Development', Iot__ApiKey: clave, IOT_API_KEY: clave,
    Ml__BaseUrl: `http://127.0.0.1:${mlPort}/`, ML_REGISTRO_DIR: registro,
    Ml__PersistenciaDemoHabilitada: 'true', Ml__PoliticaVersionadaHabilitada: 'false',
    PYTHONIOENCODING: 'utf-8' };
  // Evitar que una opción de shell reemplace los servicios locales de esta prueba.
  for (const key of Object.keys(entorno)) if (/^Ml__IntervalosSensor__/i.test(key)) delete entorno[key];
  await fs.writeFile(path.join(carpeta, 'entorno-aislado.json'), JSON.stringify({ tipo: 'prueba_local', database, pgPort, apiPort, mlPort }, null, 2));
  console.log('PRUEBA AISLADA: API -> MODELO SCIKIT-LEARN -> POSTGRESQL');
  console.log('Modelo controlado y=2x+1. Datos ficticios de prueba; no acredita calibración física.');
  console.log('La base compartida y los modelos en uso no se modifican. Preparando servicios...');
  let pgIniciado = false, conexion;
  const hijos = [];
  const erroresHijos = [];
  const levantar = (comando, args) => {
    const hijo = spawn(comando, args, { cwd: root, env: entorno, stdio: 'ignore', windowsHide: true });
    hijo.on('error', e => erroresHijos.push(e));
    hijos.push(hijo);
    return hijo;
  };
  async function esperar(url) {
    const limite = Date.now() + 45000;
    while (Date.now() < limite) {
      if (erroresHijos.length) throw Error('No se pudo iniciar uno de los servicios de prueba.');
      try { if ((await fetch(url, { signal: AbortSignal.timeout(2000) })).ok) return; } catch {}
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw Error(`El servicio aislado no arrancó: ${url}`);
  }
  async function post(base, ruta, body, esperado) {
    const r = await fetch(`${base}${ruta}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Api-Key': clave },
      body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
    const resultado = await r.json();
    assert.equal(r.status, esperado, `Respuesta inesperada de ${ruta}: ${JSON.stringify(resultado)}`);
    return resultado;
  }
  try {
    await ejecutar(exe('initdb'), ['-D', datos, '-U', 'scca_demo', '-A', 'trust', '--encoding=UTF8', '--locale=C'], entorno);
    await ejecutar(exe('pg_ctl'), ['-D', datos, '-l', path.join(carpeta, 'postgres.log'), '-o', `-p ${pgPort} -h 127.0.0.1`, '-w', 'start'], entorno);
    pgIniciado = true;
    conexion = new Client({ host: '127.0.0.1', port: pgPort, database: 'postgres', user: 'scca_demo', connectionTimeoutMillis: 10000 });
    await conexion.connect();
    await conexion.query(`CREATE DATABASE ${database}`);
    await conexion.end();
    conexion = new Client({ host: '127.0.0.1', port: pgPort, database, user: 'scca_demo' });
    await conexion.connect();
    const schema = (await fs.readFile(path.join(root, 'db/scca.sql'), 'utf8')).split(/\r?\n/).slice(3).join('\n');
    await conexion.query(schema);
    for (const archivo of ['04_resultados_ml_demo.sql', '08_trazabilidad_muestras.sql'])
      await conexion.query(await fs.readFile(path.join(root, 'db', archivo), 'utf8'));
    await conexion.query(`
      INSERT INTO sitio(codigo,nombre,latitud,longitud) VALUES('DEMO','Sitio ficticio de prueba',0,0);
      INSERT INTO nodo(codigo,sitio_id,intervalo_muestreo_s) VALUES('DEMO',1,900);
      INSERT INTO sensor(nodo_id,codigo,modelo,numero_serie,origen) VALUES(1,'DEMO','DHT11','SOLO-PRUEBA','real');
      INSERT INTO unidad(simbolo) VALUES('°C'),('%');
      INSERT INTO variable(codigo,nombre,unidad_id) VALUES('TEMP','Temperatura de prueba',1),('HUM','Humedad de prueba',2);
      INSERT INTO sensor_variable VALUES(1,1),(1,2);
    `);
    const modelo = JSON.parse((await ejecutar(python, [path.join(root, 'python/preparar_correccion_demo.py'), '--registro', registro], entorno)).trim());
    const apiBuild = path.join(carpeta, 'api');
    await ejecutar('dotnet', ['build', path.join(root, 'backend/Scca.Api/Scca.Api.csproj'), '-o', apiBuild, '--nologo'], entorno);
    levantar(python, ['-m', 'uvicorn', 'inferencia:app', '--app-dir', 'ml_engine', '--host', '127.0.0.1', '--port', String(mlPort)]);
    levantar('dotnet', [path.join(apiBuild, 'Scca.Api.dll'), '--urls', `http://127.0.0.1:${apiPort}`]);
    const apiUrl = `http://127.0.0.1:${apiPort}`, mlUrl = `http://127.0.0.1:${mlPort}`;
    await Promise.all([esperar(`${apiUrl}/api/estado`), esperar(`${mlUrl}/openapi.json`)]);
    const inicio = new Date(Math.floor(Date.now() / 3600000) * 3600000 - 3600000);
    const muestras = [];
    for (let i = 0; i < 4; i++) {
      const muestra = { sensorId: 1, idMuestra: i + 1, medidoEn: new Date(+inicio + i * 900000).toISOString(),
        lecturas: [{ variableCodigo: 'TEMP', unidadId: 1, valor: 10 }, { variableCodigo: 'HUM', unidadId: 2, valor: 50 }] };
      const r = await post(apiUrl, '/api/lecturas', muestra, 201);
      assert.equal(r.estado, 'guardada');
      muestras.push(muestra);
    }
    const originales = (await conexion.query('SELECT id::text,sensor_id,id_muestra::text,variable_id,valor::float,medido_en FROM lectura_original ORDER BY id')).rows;
    assert.equal(originales.length, 8);
    assert.ok(originales.filter(r => r.variable_id === 1).every(r => r.valor === 10));
    console.log('\n1. API RECIBIÓ: cuatro muestras completas TEMP=10 °C y HUM=50 %. HTTP 201.');
    console.log(`   Hora de entrada UTC: ${inicio.toISOString()}. Original horario TEMP: 10 °C.`);
    const solicitud = { sensorId: 1, proposito: 'calibracion', variable: 'TEMP', horizonteH: 0,
      horaInicio: inicio.toISOString(), guardarResultado: true };
    const corregido = await post(apiUrl, '/api/modelo/evaluar', solicitud, 200);
    assert.equal(corregido.estado_correccion, 'corregido');
    assert.equal(corregido.valor_original, 10);
    assert.equal(corregido.valor, 21);
    assert.equal(corregido.persistido, true);
    console.log('\n2. MODELO REAL DE PRUEBA: regresión lineal y=2x+1 ejecutada en Python.');
    console.log(`   Original: ${corregido.valor_original} °C -> Corregido: ${corregido.valor} °C`);
    console.log(`   Versión: ${corregido.modelo_version} | resultado_id: ${corregido.resultado_id}`);
    const guardado = (await conexion.query(`SELECT r.id::text,r.version,r.periodo_inicio,r.entrada,
      r.resultado FROM ml_demo_resultado r WHERE id=$1`, [corregido.resultado_id])).rows[0];
    assert.equal(guardado.entrada.valores.TEMP, 10);
    assert.equal(guardado.resultado.valor_original, 10);
    assert.equal(guardado.resultado.valor, 21);
    assert.equal(guardado.version, modelo.version);
    console.log('\n3. POSTGRESQL: consultado directamente, separado de lectura_original.');
    console.table([{ tabla: 'lectura_original', original: 10, corregido: '—', registros: 4 },
      { tabla: 'ml_demo_resultado', original: guardado.resultado.valor_original, corregido: guardado.resultado.valor, registros: 1 }]);
    const repetido = await post(apiUrl, '/api/modelo/evaluar', solicitud, 200);
    assert.equal(repetido.resultado_id, corregido.resultado_id);
    await post(apiUrl, '/api/lecturas', muestras[0], 409);
    console.log('   Reenvío de muestra: HTTP 409, sin duplicados. Repetir la corrección conserva el mismo resultado_id.');
    await post(mlUrl, '/api/v2/modelos/revertir', { clave: modelo.clave, motivo: 'Comprobar el caso sin modelo en entorno aislado' }, 200);
    const sinModelo = await post(apiUrl, '/api/modelo/evaluar', solicitud, 200);
    assert.equal(sinModelo.estado, 'sin_modelo');
    assert.equal(sinModelo.estado_correccion, 'no_corregido');
    assert.equal(sinModelo.valor_original, 10);
    assert.equal(sinModelo.valor, 10);
    assert.equal(sinModelo.persistido, false);
    assert.equal(sinModelo.modelo_version, null);
    const sinDatos = await post(apiUrl, '/api/modelo/evaluar', { ...solicitud, horaInicio: new Date(+inicio - 3600000).toISOString() }, 200);
    assert.equal(sinDatos.estado, 'datos_incompletos');
    assert.equal(sinDatos.valor, null);
    const originalesDespues = (await conexion.query('SELECT id::text,sensor_id,id_muestra::text,variable_id,valor::float,medido_en FROM lectura_original ORDER BY id')).rows;
    assert.deepEqual(originalesDespues, originales);
    assert.equal((await conexion.query('SELECT count(*)::int n FROM ml_demo_resultado')).rows[0].n, 1);
    console.log('\n4. SIN MODELO: se muestra 10 °C como NO CORREGIDO. No se genera otra corrección.');
    console.log('   Sin lecturas suficientes: datos_incompletos, sin inventar un valor.');
    const informe = { estado: 'comprobado', tipo: 'fixture_controlado_no_calibracion_fisica',
      modelo, muestras, originales, corregido, guardado, sinModelo, sinDatos,
      comprobaciones: ['API recibe muestras', 'scikit-learn transforma 10 en 21', 'guardado separado',
        'originales inalterados', 'reenvíos sin duplicados', 'sin modelo muestra original no corregido', 'sin datos no inventa valor'] };
    const evidencia = path.join(carpeta, 'resultado.json');
    await fs.writeFile(evidencia, JSON.stringify(informe, null, 2));
    console.log('\nPRUEBA COMPLETA CORRECTA. Originales intactos; corrección y versión comprobadas en PostgreSQL.');
    console.log(`Evidencia: ${evidencia}`);
  } finally {
    for (const hijo of hijos) if (hijo.pid) {
      if (process.platform === 'win32') await ejecutar('taskkill', ['/PID', String(hijo.pid), '/T', '/F'], entorno).catch(() => {});
      else hijo.kill('SIGTERM');
    }
    if (conexion) await conexion.end().catch(() => {});
    if (pgIniciado) await ejecutar(exe('pg_ctl'), ['-D', datos, '-m', 'fast', '-w', 'stop'], entorno);
  }
}

if (require.main === module) principal().catch(error => { console.error(`PRUEBA NO COMPLETADA: ${error.message}`); process.exitCode = 1; });
