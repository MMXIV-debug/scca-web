const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

// America/La_Paz, UTC-4: lunes a las 10:00 = 14:00 UTC.
function semanaVigente(fecha = new Date()) {
  const local = new Date(+fecha - 4 * 3600000),
    dias = (local.getUTCDay() + 6) % 7;
  let lunes = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - dias, 14);
  if (lunes > +fecha) lunes -= 7 * 86400000;
  return lunes;
}
function iniciarEntrenamientoAutomatico() {
  if (process.env.ML_ENTRENAMIENTO_AUTO !== 'true') return;
  const root = path.resolve(__dirname, '..'),
    registro = path.resolve(
      process.env.ML_REGISTRO_DIR || path.join(root, 'ml_engine/registro_modelos_demo'),
    );
  const ciclos = path.join(registro, 'ciclos');
  let ocupado = false,
    ultimoIntento = 0;
  function revisar() {
    if (ocupado || Date.now() - ultimoIntento < 3600000) return;
    try {
      if (fs.existsSync(path.join(ciclos, '.lock'))) return;
      const limite = process.env.ML_ARRANQUE_DEMO === 'true' ? Date.now()-3600000 : semanaVigente();
      if (
        fs.existsSync(ciclos) &&
        fs
          .readdirSync(ciclos)
          .filter((n) => n.endsWith('.json'))
          .some((n) => {
            const r = JSON.parse(fs.readFileSync(path.join(ciclos, n), 'utf8'));
            return new Date(r.inicio) >= limite && r.estado === 'completado';
          })
      )
        return;
      ocupado = true;
      ultimoIntento = Date.now();
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
        ocupado = false;
        console.error('No se pudo iniciar la evaluación semanal. Se reintentará.');
      });
      child.on('exit', () => {
        ocupado = false;
      });
    } catch {
      ocupado = false;
      console.error('No se pudo revisar el historial semanal de ML.');
    }
  }
  const timer = setInterval(revisar, 300000);
  timer.unref();
  revisar();
  return timer;
}
module.exports = { semanaVigente, iniciarEntrenamientoAutomatico };
