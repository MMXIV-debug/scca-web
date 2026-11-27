const swaggerUi = require('swagger-ui-express');

function completarSwagger(documento) {
  documento.servers = [{ url: '/' }];
  const grupos = [
    ['Usuarios', '/api', [
      ['get', '/me', 'Consultar la sesión actual'],
      ['get', '/admin/solicitudes', 'Listar solicitudes de acceso'],
      ['get', '/admin/usuarios', 'Listar usuarios'],
      ['post', '/admin/solicitudes/{id}/aprobar', 'Aprobar una solicitud'],
      ['post', '/admin/solicitudes/{id}/rechazar', 'Rechazar una solicitud'],
      ['patch', '/admin/usuarios/{id}/rol', 'Cambiar el rol de un usuario'],
      ['post', '/admin/usuarios/{id}/inhabilitar', 'Inhabilitar un usuario'],
      ['post', '/admin/usuarios/{id}/reactivar', 'Reactivar un usuario'],
    ]],
    ['Monitoreo', '/api', [
      ['get', '/admin/metricas-monitoreo', 'Consultar métricas de nodos y sensores'],
      ['get', '/admin/sitios-fuentes', 'Consultar sitios y fuentes'],
      ['get', '/admin/parametros', 'Consultar las últimas mediciones'],
      ['get', '/visualizador/parametros', 'Consultar mediciones con ponderación DHT11/BME680 y respaldo por sitio'],
      ['get', '/visualizador/resumen', 'Consultar el indicador de calidad del aire'],
      ['get', '/visualizador/series', 'Consultar series horarias'],
      ['get', '/visualizador/semanal', 'Consultar la media semanal'],
      ['get', '/visualizador/clima', 'Consultar el clima y pronóstico meteorológico'],
      ['get', '/visualizador/alertas', 'Consultar alertas visibles'],
      ['get', '/visualizador/eventos', 'Suscribirse a eventos de lecturas (SSE)'],
    ]],
    ['Machine Learning', '/api/admin/ml', [
      ['get', '/politicas', 'Listar políticas ML con referencias y rangos'],
      ['post', '/politicas', 'Crear una nueva versión de política ML'],
      ['put', '/politicas/{id}', 'Crear una nueva versión inmutable a partir de la política ML vigente'],
      ['get', '/sensores', 'Listar sensores compatibles con ML'],
      ['get', '/modelos', 'Consultar modelos, historial y datos recientes'],
      ['get', '/operacion', 'Consultar el estado de entrenamiento y procesamiento'],
      ['post', '/procesar', 'Calcular y guardar resultados de la última hora'],
      ['post', '/comprobar-alertas', 'Comprobar umbrales ambientales y predictivos'],
      ['post', '/evaluar', 'Evaluar una hora con el modelo activo'],
      ['post', '/revertir', 'Revertir un modelo activo'],
      ['post', '/entrenar', 'Iniciar la evaluación de candidatos'],
      ['get', '/reportes', 'Consultar resultados ML por periodo'],
      ['get', '/reportes.csv', 'Exportar resultados ML como CSV'],
    ]],
    ['Cuarentena', '/api/admin/cuarentena', [
      ['get', '', 'Listar muestras en cuarentena'],
      ['post', '/decisiones', 'Registrar una decisión sobre muestras en cuarentena'],
    ]],
    ['Alertas', '/api/admin/alertas', [
      ['get', '', 'Listar alertas técnicas'],
      ['post', '/comprobar', 'Comprobar falta de recepción'],
      ['post', '/{id}/atender', 'Registrar la atención de una alerta'],
    ]],
    ['Infraestructura', '/api/admin/infraestructura', [
      ['get', '/resumen', 'Listar sitios, nodos, sensores, mantenimientos y fuentes de referencia'],
      ['post', '/sitios', 'Dar de alta un sitio de monitoreo'],
      ['post', '/nodos', 'Dar de alta un nodo de monitoreo'],
      ['patch', '/nodos/{id}', 'Actualizar estado o intervalo de muestreo de un nodo'],
      ['post', '/sensores', 'Dar de alta un sensor validando duplicados y unidades'],
      ['post', '/sensores/{id}/reemplazar', 'Reemplazar un sensor retirando sus modelos anteriores'],
      ['post', '/mantenimientos', 'Registrar un evento de mantenimiento de nodo o sensor'],
      ['post', '/referencias', 'Registrar una fuente de referencia calibrada'],
      ['post', '/referencias/{id}/lecturas', 'Importar lecturas emparejadas de una fuente de referencia'],
    ]],
  ];
  for (const [tag, prefijo, rutas] of grupos) for (const [metodo, ruta, summary] of rutas) {
    const direccion = prefijo + ruta;
    documento.paths[direccion] ||= {};
    documento.paths[direccion][metodo] ||= {
      tags: [tag], summary, security: [{ bearerAuth: [] }],
      description: direccion.includes('/admin/') ? 'Requiere una sesión de Administrador.' : 'Requiere una sesión autenticada.',
      parameters: [...direccion.matchAll(/\{([^}]+)\}/g)].map(m => ({ name: m[1], in: 'path', required: true, schema: { type: 'integer', minimum: 1 } })),
      responses: { 200: { description: 'Operación completada' }, 400: { description: 'Parámetros inválidos' },
        401: { description: 'Sesión requerida' }, 403: { description: 'Permisos insuficientes' }, 503: { description: 'Servicio no disponible' } },
    };
  }
  const ejemplos = {
    '/api/admin/ml/evaluar': { sensorId: 1, proposito: 'pronostico', variable: 'PM25', horizonteH: 1,
      horaInicio: new Date(Math.floor(Date.now() / 3600000) * 3600000 - 3600000).toISOString(), guardarResultado: false },
    '/api/admin/ml/revertir': { clave: 'CLAVE_DEL_MODELO_ACTIVO', motivo: 'Revisión del modelo en uso' },
    '/api/admin/usuarios/{id}/rol': { rol: 'Visualizador' },
    '/api/admin/usuarios/{id}/inhabilitar': { motivo: 'Solicitud de inhabilitación' },
    '/api/admin/alertas/{id}/atender': { motivo: 'Revisión del dispositivo realizada' },
    '/api/admin/cuarentena/decisiones': { ids: ['1'], accion: 'descartar', clasificacion: 'dato_invalido', motivo: 'Medición inválida revisada' },
  };
  for (const [ruta, ejemplo] of Object.entries(ejemplos)) {
    const operacion = documento.paths[ruta].post || documento.paths[ruta].patch;
    operacion.requestBody ||= { required: true, content: { 'application/json': { schema: { type: 'object' }, example: ejemplo } } };
  }
  const politica = { version_anterior: 1, motivo: 'Ajuste de la política de seguimiento', completitud_min_pct: 75,
    colocacion_dias: 30, pares_minimos: 540, test_pct: 30, mejora_rmse_min_pct: 20, sin_datos_seg: 300,
    configuracion: { factor_sin_datos: 2, intervalos_sensor: {}, alertas_ambientales: [], alertas_predictivas: [] } };
  for (const [ruta, metodo] of [['/api/admin/ml/politicas', 'post'], ['/api/admin/ml/politicas/{id}', 'put']]) {
    documento.paths[ruta][metodo].requestBody = { required: true, content: { 'application/json': { schema: { type: 'object' }, example: politica } } };
  }
  for (const ruta of ['/api/admin/ml/reportes', '/api/admin/ml/reportes.csv']) {
    documento.paths[ruta].get.parameters = [
      { name: 'sensorId', in: 'query', required: true, schema: { type: 'integer', minimum: 1 } },
      ...['desde', 'hasta'].map(name => ({ name, in: 'query', schema: { type: 'string', format: 'date-time' } })),
      { name: 'despuesDe', in: 'query', schema: { type: 'string', default: '0' } },
    ];
  }
  documento.paths['/api/visualizador/series'].get.parameters = [{ name: 'horas', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 168, default: 24 } }];
  return documento;
}

function registrarSwagger(app, documento) {
  app.get('/api-docs/panel.json', (_req, res) => res.json(completarSwagger(documento)));
  const servicios = [
    ['dotnet', () => `http://127.0.0.1:${process.env.API_PORT || 5051}/`, 'swagger/v1/swagger.json'],
    ['python', () => process.env.Ml__BaseUrl || `http://127.0.0.1:${process.env.ML_PORT || 8000}/`, 'openapi.json'],
  ];
  for (const [nombre, base, ruta] of servicios) app.get(`/api-docs/${nombre}.json`, async (req, res) => {
    try {
      const respuesta = await fetch(new URL(ruta, base()), { signal: AbortSignal.timeout(10000) });
      if (!respuesta.ok) throw Error('Documento no disponible');
      const spec = await respuesta.json();
      if (!spec.openapi || !spec.paths) throw Error('Documento inválido');
      // La documentación se carga desde el panel, pero Try it out llama al servicio original.
      const destino = new URL(base());
      if (['localhost', '127.0.0.1', '[::1]'].includes(destino.hostname)) {
        const origen = new URL(`${req.protocol}://${req.get('host')}`);
        origen.port = destino.port;
        spec.servers = [{ url: origen.origin + destino.pathname.replace(/\/$/, '') }];
      } else spec.servers = [{ url: destino.href.replace(/\/$/, '') }];
      res.json(spec);
    } catch {
      res.status(503).json({ error: `No se pudo cargar Swagger de ${nombre}. Inicia los servicios con node iniciar.js.` });
    }
  });
  const opciones = { explorer: true, customSiteTitle: 'SCCA | APIs', swaggerOptions: {
    validatorUrl: null,
    urls: [
      { name: 'Panel web · Node.js', url: '/api-docs/panel.json' },
      { name: 'Recepción y evaluación · .NET', url: '/api-docs/dotnet.json' },
      { name: 'Modelos ML · Python', url: '/api-docs/python.json' },
    ],
  } };
  app.use('/api-docs', swaggerUi.serveFiles(null, opciones), swaggerUi.setup(null, opciones));
}

module.exports = { completarSwagger, registrarSwagger };
