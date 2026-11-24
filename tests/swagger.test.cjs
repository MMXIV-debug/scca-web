const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const swaggerJsdoc = require('swagger-jsdoc');
const { completarSwagger } = require('../services/swaggerService');

test('Swagger documenta las rutas reales del panel y sus routers con independencia del directorio de inicio', () => {
  const root = path.resolve(__dirname, '..');
  const spec = completarSwagger(swaggerJsdoc({ definition: { openapi: '3.0.0', info: { title: 'SCCA', version: '1' } },
    apis: [path.join(root, 'server.js')] }));
  const fuentes = [
    ['server.js', ''], ['services/panelMlService.js', '/api/admin/ml'],
    ['services/alertasService.js', '/api/admin/alertas'], ['services/cuarentenaService.js', '/api/admin/cuarentena'],
  ];
  for (const [archivo, prefijo] of fuentes) {
    const codigo = fs.readFileSync(path.join(root, archivo), 'utf8');
    for (const [, metodo, ruta] of codigo.matchAll(/(?:app|router)\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]/g)) {
      const url = (prefijo + ruta).replace(/\/$/, '').replace(/:([a-zA-Z]+)/g, '{$1}');
      if (!url.startsWith('/api/')) continue;
      assert.ok(spec.paths[url]?.[metodo], `${metodo.toUpperCase()} ${url} falta en Swagger`);
      for (const [, nombre] of url.matchAll(/\{([^}]+)\}/g))
        assert.ok(spec.paths[url][metodo].parameters?.some(p => p.name === nombre && p.in === 'path' && p.required));
    }
  }
  assert.ok(spec.paths['/api/login'].post);
  assert.deepEqual(spec.paths['/api/admin/ml/modelos'].get.security, [{ bearerAuth: [] }]);
  assert.equal(spec.paths['/api/admin/ml/evaluar'].post.requestBody.content['application/json'].example.guardarResultado, false);
  assert.ok(Object.keys(spec.paths).length > 30);
});
