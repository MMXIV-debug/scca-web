const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const python = path.join(__dirname, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
if (!fs.existsSync(python)) {
  console.error('Falta el entorno .venv. Prepara el proyecto con Iniciar SCCA.cmd.');
  process.exitCode = 1;
} else {
  const hijo = spawn(python, ['-u', path.join(__dirname, 'python/simulador.py'), '--demostrar'], {
    cwd: __dirname, env: { ...process.env, PYTHONIOENCODING: 'utf-8' }, stdio: 'inherit', windowsHide: true,
  });
  hijo.on('error', () => { console.error('No se pudo iniciar Python.'); process.exitCode = 1; });
  hijo.on('exit', codigo => { process.exitCode = codigo ?? 1; });
}
