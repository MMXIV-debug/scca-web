const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const net = require('node:net');
const { once } = require('node:events');
const { Client } = require('pg');

process.chdir(__dirname);
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });

const procesos = new Set();
let cerrando = false;
const pausa = ms => new Promise(resolve => setTimeout(resolve, ms));

function detener(codigo = 0) {
  if (cerrando) return;
  cerrando = true;
  process.exitCode = codigo;
  for (const hijo of procesos) {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(hijo.pid), '/T', '/F'], {
        windowsHide: true, stdio: 'ignore'
      }).on('error', () => hijo.kill());
    } else {
      hijo.kill('SIGTERM');
    }
  }
}

function ejecutar(nombre, comando, argumentos, entorno, persistente = true, critico = true) {
  if (cerrando) throw new Error('Inicio cancelado.');
  console.log(`Iniciando ${nombre}...`);
  const hijo = spawn(comando, argumentos, {
    cwd: __dirname, env: entorno, stdio: 'inherit', windowsHide: true
  });
  if (hijo.pid) procesos.add(hijo);
  hijo.on('error', () => {
    console.error(`No se pudo ejecutar ${nombre}. Comprueba su instalación.`);
    if (critico) detener(1);
  });
  hijo.on('exit', codigo => {
    procesos.delete(hijo);
    if (!cerrando && persistente) {
      console.error(`${nombre} terminó inesperadamente (${codigo}).`);
      if (critico) detener(1);
    }
  });
  return hijo;
}

async function esperar(url, validar) {
  const limite = Date.now() + 60000;
  while (!cerrando && Date.now() < limite) {
    try {
      const respuesta = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (respuesta.ok && await validar(respuesta)) return;
    } catch { /* El servicio todavía puede estar arrancando. */ }
    await pausa(500);
  }
  throw new Error(`El servicio no quedó listo: ${url}. Revisa los mensajes anteriores.`);
}

async function puertoLibre(puerto) {
  await new Promise((resolve, reject) => {
    const servidor = net.createServer();
    servidor.once('error', () => reject(new Error(`Puerto ${puerto} ocupado. Cierra la ejecución anterior antes de iniciar todo.`)));
    servidor.listen(puerto, '0.0.0.0', () => servidor.close(resolve));
  });
}

async function iniciar() {
  const puertos = ['PORT', 'API_PORT', 'ML_PORT'].map((nombre, indice) => {
    const valor = Number(process.env[nombre] || [3000, 5051, 8000][indice]);
    if (!Number.isInteger(valor) || valor < 1 || valor > 65535) throw new Error(`Puerto inválido en ${nombre}.`);
    return valor;
  });
  if (new Set(puertos).size !== 3) throw new Error('Los tres servicios necesitan puertos diferentes.');
  const [web, api, ml] = puertos;
  const python = path.join(__dirname, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  if (!fs.existsSync(python)) throw new Error('Falta .venv. Ejecuta python -m venv .venv e instala requirements.txt en ese entorno.');
  if (!process.env.DATABASE_URL) throw new Error('Falta DATABASE_URL en .env.');
  const clave = process.env.Iot__ApiKey || process.env.IOT_API_KEY;
  if (!clave) throw new Error('Configura IOT_API_KEY en .env con la misma API_KEY del ESP32.');
  if (!process.env.JWT_SECRET) throw new Error('Falta JWT_SECRET en .env.');
  await Promise.all(puertos.map(puertoLibre));
  const cliente = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
  try {
    await cliente.connect();
    await cliente.query('SELECT 1');
  } catch {
    throw new Error('PostgreSQL no responde. Comprueba que esté iniciado y revisa DATABASE_URL.');
  } finally { await cliente.end(); }

  const esquema = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
  try {
    await esquema.connect();
    await esquema.query('SELECT admin_principal, administrador_desde FROM usuario LIMIT 0');
  } catch {
    throw new Error('Falta preparar el esquema de usuarios. Revisa la conexión y aplica db/03_jerarquia_admin.sql con el propietario de las tablas.');
  } finally { await esquema.end(); }

  const entorno = {
    ...process.env, PORT: String(web), ASPNETCORE_ENVIRONMENT: 'Development',
    SIMULADOR_API_URL: `http://127.0.0.1:${api}/api/lecturas`,
    Iot__ApiKey: clave, Ml__BaseUrl: `http://127.0.0.1:${ml}/`
  };
  const salida = path.join(__dirname, 'backend/Scca.Api/bin/iniciador');
  const compilacion = ejecutar('compilación de la API', 'dotnet', ['build', 'backend/Scca.Api/Scca.Api.csproj', '-o', salida, '--nologo'], entorno, false);
  const [codigo] = await once(compilacion, 'exit');
  if (codigo !== 0) throw new Error('Falló la compilación de la API.');
  ejecutar('Python/ML', python, ['-m', 'uvicorn', 'inferencia:app', '--app-dir', 'ml_engine', '--host', '127.0.0.1', '--port', String(ml)], entorno, true, false);
  ejecutar('API', 'dotnet', [path.join(salida, 'Scca.Api.dll'), '--urls', `http://0.0.0.0:${api}`], entorno);
  await esperar(`http://127.0.0.1:${api}/api/estado`, async r => (await r.json()).postgresql === 'conectado');
  ejecutar('página web', process.execPath, ['server.js'], entorno);
  await esperar(`http://127.0.0.1:${web}/`, async r => (await r.text()).toLowerCase().includes('<html'));
  const url = `http://localhost:${web}/`;
  console.log(`SCCA listo: ${url}\nSwagger: http://localhost:${api}/swagger\nMantén esta ventana abierta. Ctrl+C detiene los servicios iniciados aquí.`);
  // El proveedor de demostración no determina la disponibilidad del sistema.
  // Su bucle maneja fallos y reintenta; no se exige una inserción para abrir la web.
  if (!process.argv.includes('--sin-simulador') && process.env.SIMULADOR_HABILITADO !== 'false') {
    ejecutar('simulador continuo', python, ['-u', 'python/simulador.py'], entorno, true, false);
  }
  if (!process.argv.includes('--sin-navegador')) {
    const comando = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    spawn(comando, [url], { windowsHide: true, stdio: 'ignore' }).on('error', () => console.log(`Abre ${url} en tu navegador.`));
  }
}

process.on('SIGINT', () => detener());
process.on('SIGTERM', () => detener());
iniciar().catch(error => {
  console.error(error.message);
  detener(1);
});
