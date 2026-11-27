require('dotenv').config();
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Dependencias de Swagger
const swaggerJsDoc = require('swagger-jsdoc');

const app = express();
const pool = require('./db/database');
const UsuarioService = require('./services/usuarioService'); // Aca se importa el facade que encapsula la lógica de negocio para usuarios

app.use(express.json());
// Compatibilidad con marcadores antiguos: toda la administración vive en dashboard.
app.get('/cuarentena.html', (req, res) => res.redirect('/dashboard.html#seccion-cuarentena'));
app.get('/alertas.html', (req, res) => res.redirect('/dashboard.html#seccion-alertas'));
app.get('/administracion-ml.html', (req, res) => {
  const secciones = { politicas: 'politicas', modelos: 'modelos', reportes: 'reportes' };
  const seccion = Object.hasOwn(secciones, req.query.tab) ? secciones[req.query.tab] : 'politicas';
  res.redirect('/dashboard.html#seccion-' + seccion);
});
app.use(express.static('public'));

// ---------- Configuración de Swagger ----------
const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'API SCCA-WEB',
      version: '1.0.0',
      description: 'Documentación de la API REST para el Sistema de Captura y Calidad del Aire'
    },
    servers: [
      { url: `http://localhost:${process.env.PORT || 3000}` }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Introduce tu token JWT aquí (sin la palabra Bearer)'
        }
      }
    }
  },
  apis: [require('node:path').join(__dirname, 'server.js')],
};

const swaggerDocs = swaggerJsDoc(swaggerOptions);
require('./services/swaggerService').registrarSwagger(app, swaggerDocs);
// ----------------------------------------------

// ---------- Middlewares ----------
async function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  let sesion;
  try {
    sesion = jwt.verify(token, process.env.JWT_SECRET);
    if (!Number.isSafeInteger(sesion.id) || sesion.id <= 0) throw new Error('Sesión inválida');
  } catch {
    return res.status(401).json({ error: 'Sesión inválida' });
  }
  try {
    // Los permisos vigentes prevalecen sobre el rol guardado en el token.
    const { rows } = await pool.query(
      `SELECT u.id, u.nombre_completo AS nombre, r.nombre AS rol, u.admin_principal,
              u.administrador_desde
       FROM usuario u JOIN rol r ON r.id = u.rol_id
       WHERE u.id = $1 AND u.activo AND u.estado = 'aprobado'`, [sesion.id]
    );
    if (!rows.length) return res.status(401).json({ error: 'La cuenta no tiene acceso activo' });
    req.user = rows[0];
    next();
  } catch {
    res.status(503).json({ error: 'No se pudo verificar la sesión. Inténtalo de nuevo' });
  }
}

function soloAdmin(req, res, next) {
  if (req.user.rol !== 'Administrador') return res.status(403).json({ error: 'Solo administradores' });
  next();
}

app.use('/api/admin/cuarentena', require('./services/cuarentenaService').crearRouterCuarentena(pool, auth, soloAdmin));

app.use('/api/admin/infraestructura', require('./services/infraestructuraService').crearRouterInfraestructura(pool, auth, soloAdmin));

app.use('/api/admin/alertas', require('./services/alertasService').crearRouterAlertas(pool, auth, soloAdmin));
require('./services/alertasService').iniciarMonitorAlertas(pool);
app.use('/api/admin/ml', require('./services/panelMlService').crearRouterPanelMl(pool, auth, soloAdmin));
require('./services/procesamientoMlService').iniciarProcesamiento(pool);
require('./services/alertasAmbientalesService').iniciarAmbientales(pool);
require('./services/entrenamientoScheduler').iniciarEntrenamientoAutomatico();
const eventosLectura = require('./services/eventosLectura');
eventosLectura.iniciarObservadores(pool);
app.get('/api/visualizador/eventos', auth, (req, res) => eventosLectura.suscribirPanel(req, res));
app.get('/api/visualizador/alertas',auth,async(req,res)=>{try{res.json({items:(await pool.query("SELECT id::text,tipo,nodo_id,regla,valor,calidad,periodo_ini,estado,observacion,evidencia FROM alerta WHERE estado IN ('abierta','atendida') ORDER BY generada_en DESC LIMIT 100")).rows});}catch{res.status(503).json({error:'Alertas no disponibles.'});}});
function calcularAQI_EPA(pm25) {
  // EPA 2024, PM2.5 24 h: https://www.epa.gov/system/files/documents/2024-02/pm-naaqs-air-quality-index-fact-sheet.pdf
  if(!Number.isFinite(pm25)||pm25<0)return {score:'-',label:'Sin datos válidos',color:'secondary'};
  const c = Math.floor(pm25 * 10) / 10;
  const breakpoints = [
    { cLow: 0.0, cHigh: 9.0, iLow: 0, iHigh: 50, label: 'Buena', color: 'success' },
    { cLow: 9.1, cHigh: 35.4, iLow: 51, iHigh: 100, label: 'Moderada', color: 'warning' },
    { cLow: 35.5, cHigh: 55.4, iLow: 101, iHigh: 150, label: 'Dañina (Grupos sensibles)', color: 'orange' },
    { cLow: 55.5, cHigh: 125.4, iLow: 151, iHigh: 200, label: 'Dañina', color: 'danger' },
    { cLow: 125.5, cHigh: 225.4, iLow: 201, iHigh: 300, label: 'Muy Dañina', color: 'purple' },
    { cLow: 225.5, cHigh: 325.4, iLow: 301, iHigh: 500, label: 'Peligrosa', color: 'dark' }
  ];
  for (let bp of breakpoints) {
    if (c >= bp.cLow && c <= bp.cHigh) {
      const aqi = Math.round(((bp.iHigh - bp.iLow) / (bp.cHigh - bp.cLow)) * (c - bp.cLow) + bp.iLow); //Calculo de AQI según la fórmula de interpolación lineal
      return { score: aqi, label: bp.label, color: bp.color };
    }
  }
  return { score: '> 500', label: 'Peligrosa (Fuera de escala)', color: 'dark' };
}

/**
 * @swagger
 * /api/register:
 *   post:
 *     summary: Registra un nuevo usuario en estado pendiente
 *     tags: [Autenticación]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               username: { type: string, example: "nuevo_admin" }
 *               nombre_completo: { type: string, example: "Juan Pérez" }
 *               email: { type: string, example: "juan@scca.local" }
 *               password: { type: string, example: "secreta123" }
 *               rol_solicitado: { type: string, example: "Administrador" }
 *     responses:
 *       200:
 *         description: Solicitud enviada correctamente
 *       400:
 *         description: Datos incompletos o rol inválido
 *       409:
 *         description: El usuario o email ya existe
 */

// ---------- Autenticación y Perfil ----------
app.post('/api/register', async (req, res) => {
  const { username, nombre_completo, email, password, rol_solicitado } = req.body;
  if (!username || !nombre_completo || !password || password.length < 8) return res.status(400).json({ error: 'Datos incompletos' });
  if (!['Administrador', 'Visualizador'].includes(rol_solicitado)) return res.status(400).json({ error: 'Rol inválido' });

  try {
    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      `INSERT INTO usuario (username, nombre_completo, email, password_hash, rol_solicitado_id, estado)
       VALUES ($1, $2, $3, $4, (SELECT id FROM rol WHERE nombre = $5), 'pendiente')`,
      [username.trim(), nombre_completo.trim(), email ? email.trim() : null, hash, rol_solicitado]
    );
    res.json({ ok: true, mensaje: 'Solicitud enviada.' });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Usuario o email ya existe' });
    res.status(500).json({ error: 'Error del servidor' });
  }
});


/**
 * @swagger
 * /api/login:
 *   post:
 *     summary: Inicia sesión y devuelve un token JWT
 *     tags: [Autenticación]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               username: { type: string, example: "admin" }
 *               password: { type: string, example: "Cambiar" }
 *     responses:
 *       200:
 *         description: Autenticación exitosa
 *       401:
 *         description: Credenciales incorrectas
 *       403:
 *         description: Cuenta pendiente, rechazada o inhabilitada
 */


app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const { rows } = await pool.query(
      `SELECT u.*, r.nombre AS rol FROM usuario u LEFT JOIN rol r ON r.id = u.rol_id WHERE u.username = $1`, 
      [username ? username.trim() : '']
    );
    const u = rows[0];
    if (!u || !(await bcrypt.compare(password || '', u.password_hash))) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    if (u.estado === 'pendiente') return res.status(403).json({ error: 'Cuenta pendiente de aprobación' });
    if (u.estado === 'inactivo' || !u.activo) return res.status(403).json({ error: 'Cuenta inhabilitada' });
    if (u.estado === 'rechazado') return res.status(403).json({ error: 'Solicitud rechazada' });

    const token = jwt.sign({ id: u.id, rol: u.rol, nombre: u.nombre_completo }, process.env.JWT_SECRET, { expiresIn: '8h' });
    res.json({ token, rol: u.rol, nombre: u.nombre_completo });
  } catch (e) {
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

app.get('/api/me', auth, (req, res) => res.json(req.user));

// ---------- Gestión de Usuarios (Usando el Facade) ----------
app.get('/api/admin/solicitudes', auth, soloAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.username, u.nombre_completo, u.email, u.creado_en, r.nombre AS rol_solicitado
       FROM usuario u JOIN rol r ON r.id = u.rol_solicitado_id WHERE u.estado = 'pendiente' ORDER BY u.creado_en ASC`
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Error al obtener solicitudes' });
  }
});

/**
 * @swagger
 * /api/admin/usuarios:
 *   get:
 *     summary: Obtiene la lista de usuarios activos e inactivos (Solo Administradores)
 *     tags: [Administración]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de usuarios obtenida exitosamente
 *       401:
 *         description: Sesión inválida o token faltante
 *       403:
 *         description: Acceso denegado (No es administrador)
 */

app.get('/api/admin/usuarios', auth, soloAdmin, async (req, res) => {
  try {
    res.json(await UsuarioService.listar(req.user.id));
  } catch (e) {
    res.status(500).json({ error: 'Error al obtener usuarios' });
  }
});

function responderErrorUsuario(res, error) {
  if (error.status) return res.status(error.status).json({ error: error.message });
  res.status(500).json({ error: 'No se pudo actualizar la cuenta' });
}

app.post('/api/admin/solicitudes/:id/aprobar', auth, soloAdmin, async (req, res) => {
  try {
    await UsuarioService.aprobar(Number(req.params.id), req.body?.rol ?? null, req.user.id);
    res.json({ ok: true });
  } catch (e) { responderErrorUsuario(res, e); }
});

app.post('/api/admin/solicitudes/:id/rechazar', auth, soloAdmin, async (req, res) => {
  try {
    await UsuarioService.rechazar(Number(req.params.id), req.user.id);
    res.json({ ok: true });
  } catch (e) { responderErrorUsuario(res, e); }
});

/**
 * @swagger
 * /api/admin/usuarios/{id}/rol:
 *   patch:
 *     summary: Cambia el rol respetando la antigüedad de los administradores
 *     tags: [Administración]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [rol]
 *             properties:
 *               rol:
 *                 type: string
 *                 enum: [Administrador, Visualizador]
 *     responses:
 *       200:
 *         description: Rol actualizado
 *       400:
 *         description: Rol o identificador inválido
 *       401:
 *         description: Sesión inválida
 *       403:
 *         description: Cuenta protegida o permisos insuficientes
 *       404:
 *         description: Usuario no encontrado
 *       409:
 *         description: Estado de cuenta incompatible o rol sin cambios
 */
app.patch('/api/admin/usuarios/:id/rol', auth, soloAdmin, async (req, res) => {
  try {
    await UsuarioService.cambiarRol(Number(req.params.id), req.body?.rol, req.user.id);
    res.json({ ok: true, mensaje: 'Rol actualizado' });
  } catch (e) { responderErrorUsuario(res, e); }
});

app.post('/api/admin/usuarios/:id/inhabilitar', auth, soloAdmin, async (req, res) => {
  try {
    await UsuarioService.inhabilitar(Number(req.params.id), req.body?.motivo ?? 'Inhabilitado por administrador', req.user.id);
    res.json({ ok: true, mensaje: 'Usuario inhabilitado' });
  } catch (e) { responderErrorUsuario(res, e); }
});

app.post('/api/admin/usuarios/:id/reactivar', auth, soloAdmin, async (req, res) => {
  try {
    await UsuarioService.reactivar(Number(req.params.id), req.user.id);
    res.json({ ok: true, mensaje: 'Usuario reactivado' });
  } catch (e) { responderErrorUsuario(res, e); }
});

// ---------- Métricas y Dashboard ----------
app.get('/api/admin/metricas-monitoreo', auth, soloAdmin, async (req, res) => {
  try {
    const nodosQuery = await pool.query(`SELECT COUNT(DISTINCT n.id)::int AS nodos_activos, COUNT(DISTINCT s.id)::int AS sensores_reales FROM nodo n LEFT JOIN sensor s ON s.nodo_id = n.id AND s.origen = 'real' AND s.activo = true WHERE n.estado = 'activo'`);
    const simulacionesQuery = await pool.query(`SELECT COUNT(DISTINCT s.id)::int AS sensores_simulados, COUNT(l.id)::int AS lecturas_recientes_simuladas FROM sensor s LEFT JOIN lectura_original l ON l.sensor_id = s.id AND l.recibido_en >= now() - INTERVAL '1 hour' WHERE s.origen = 'simulado' AND s.activo = true`);
    res.json({ nodos_activos: nodosQuery.rows[0].nodos_activos || 0, sensores_reales: nodosQuery.rows[0].sensores_reales || 0, sensores_simulados: simulacionesQuery.rows[0].sensores_simulados || 0, lecturas_simuladas: simulacionesQuery.rows[0].lecturas_recientes_simuladas || 0 });
  } catch (e) { res.status(500).json({ error: 'Error interno' }); }
});

app.get('/api/admin/sitios-fuentes', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT si.nombre AS sitio, si.latitud, si.longitud, n.codigo AS nodo, n.estado, s.origen, s.modelo FROM sitio si LEFT JOIN nodo n ON n.sitio_id = si.id LEFT JOIN sensor s ON s.nodo_id = n.id`);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Error cargando sitios' }); }
});

async function cargarParametros(req, res, combinar = false) {
  try {
    const { rows } = await pool.query(`SELECT v.codigo,v.nombre AS parametro,u.simbolo AS unidad,
      s.id AS sensor_id,s.nodo_id,s.origen,s.modelo,l.valor AS ultima_medicion,l.medido_en AS ultima_fecha,
      e.evidencia->>'altitudAproximadaM' AS altitud
      FROM sensor s JOIN sensor_variable sv ON sv.sensor_id=s.id JOIN variable v ON sv.variable_id=v.id
      JOIN unidad u ON u.id=v.unidad_id
      LEFT JOIN LATERAL (SELECT valor,medido_en,id_muestra FROM lectura_original
        WHERE sensor_id=s.id AND variable_id=v.id AND calidad='valida' ORDER BY medido_en DESC,id DESC LIMIT 1) l ON true
      LEFT JOIN evaluacion_muestra e ON v.codigo='PRES' AND e.sensor_id=s.id AND e.id_muestra=l.id_muestra
      WHERE s.activo ORDER BY s.id,v.id`);
    for (const fila of rows.filter(r => r.codigo === 'PRES' && r.modelo.trim().toUpperCase() === 'BME680')) {
      rows.push({ ...fila, codigo: 'ALT', parametro: 'Altitud aproximada', unidad: 'm',
        ultima_medicion: fila.altitud, ultima_fecha: fila.altitud == null ? null : fila.ultima_fecha });
    }
    for (const [codigo, parametro, unidad] of [['PRES','Presión atmosférica','hPa'],['GAS','Resistencia de gas','Ω'],['ALT','Altitud aproximada','m']]) {
      if (!rows.some(r => r.codigo === codigo)) rows.push({ codigo, parametro, unidad, modelo: 'BME680',
        origen: 'real', ultima_medicion: null, ultima_fecha: null });
    }
    if (combinar) {
      const fusion = require('./services/fusionSensoresService');
      return res.json([...rows.filter(r => !fusion.fisico(r)), ...await fusion.mediciones(pool)]);
    }
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Error cargando parámetros' }); }
}
app.get('/api/admin/parametros', auth, (req, res) => cargarParametros(req, res));
app.get('/api/visualizador/parametros', auth, (req, res) => cargarParametros(req, res, true));

app.get('/api/visualizador/resumen', auth, async (req, res) => {
  try{return res.json(await require('./services/seriesService').resumen(pool,calcularAQI_EPA,req.query));}
  catch(e){return res.status(e.status||503).json({error:e.status?e.message:'No se pudo calcular el indicador horario.'});}
});

// ------------Grafico y media semanal------------------


// Promedio por hora de cada variable en las ultimas N horas 
app.get('/api/visualizador/series', auth, async (req, res) => {
  const horas = Math.min(Math.max(parseInt(req.query.horas) || 24, 1), 168);
  try{return res.json(await require('./services/seriesService').seriesVisualizador(pool,horas,req.query));}
  catch(e){return res.status(e.status||503).json({error:e.status?e.message:'No se pudo consultar la serie horaria.'});}
});

// Promedio, mínimo y máximo de los últimos 7 días por variable
app.get('/api/visualizador/semanal', auth, async (req, res) => {
  try{return res.json(await require('./services/seriesService').semanal(pool,req.query));}
  catch(e){return res.status(e.status||503).json({error:e.status?e.message:'No se pudo consultar el promedio semanal.'});}
});

const PORT = process.env.PORT || 3000;
const { crearClimaService, iniciarClima } = require('./services/climaService');
const clima = crearClimaService(pool);
iniciarClima(clima);
/**
 * @swagger
 * /api/visualizador/clima:
 *   get:
 *     summary: Condiciones actuales y pronóstico horario y diario persistido por sitio
 *     tags: [Visualizador]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Última consulta guardada, vigencia, procedencia, 24 horas y 7 días de pronóstico por sitio.
 *       503:
 *         description: No se pudo consultar el registro meteorológico.
 */
app.get('/api/visualizador/clima', auth, async (req, res) => {
  try { res.set('Cache-Control', 'no-store').json(await clima.listar()); }
  catch { res.status(503).json({ error: 'No se pudo consultar el clima guardado. Se reintentará automáticamente.' }); }
});
app.listen(PORT, () => console.log(`Servidor iniciado en http://localhost:${PORT}`));
