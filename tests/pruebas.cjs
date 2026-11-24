const { spawnSync } = require('node:child_process'),
  path = require('node:path');
const root = path.resolve(__dirname, '..');
for (const [comando, args] of [
  [process.execPath, ['--test', 'tests/contratos.test.cjs', 'tests/clima.test.cjs', 'tests/database.test.cjs', 'tests/strategy-observer.test.cjs']],
  [
    path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'),
    ['-m', 'unittest', 'discover', '-s', 'ml_engine', '-p', 'test_*.py', '-v'],
  ],
]) {
  const r = spawnSync(comando, args, { cwd: root, stdio: 'inherit', windowsHide: true });
  if (r.error || r.status !== 0) {
    process.exitCode = r.status || 1;
    break;
  }
}
