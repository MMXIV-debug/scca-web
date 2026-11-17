require('dotenv').config();
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Dependencias de Swagger
const swaggerUi = require('swagger-ui-express');
const swaggerJsDoc = require('swagger-jsdoc');

const app = express();
const pool = require('./db/database');
const UsuarioService = require('./services/usuarioService'); // Aca se importa el facade que encapsula la lógica de negocio para usuarios

app.use(express.json());
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
  apis: ['./server.js'], // Apunta a este mismo archivo para leer los comentarios
};

const swaggerDocs = swaggerJsDoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs));
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

function calcularAQI_EPA(pm25) {
  const c = Math.floor(pm25 * 10) / 10;
  const breakpoints = [
    { cLow: 0.0, cHigh: 12.0, iLow: 0, iHigh: 50, label: 'Buena', color: 'success' },
    { cLow: 12.1, cHigh: 35.4, iLow: 51, iHigh: 100, label: 'Moderada', color: 'warning' },
    { cLow: 35.5, cHigh: 55.4, iLow: 101, iHigh: 150, label: 'Dañina (Grupos sensibles)', color: 'orange' },
    { cLow: 55.5, cHigh: 150.4, iLow: 151, iHigh: 200, label: 'Dañina', color: 'danger' },
    { cLow: 150.5, cHigh: 250.4, iLow: 201, iHigh: 300, label: 'Muy Dañina', color: 'purple' },
    { cLow: 250.5, cHigh: 500.4, iLow: 301, iHigh: 500, label: 'Peligrosa', color: 'dark' }
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

app.get('/api/admin/parametros', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT v.nombre AS parametro, u.simbolo AS unidad, s.origen, s.modelo, (SELECT valor FROM lectura_original l WHERE l.variable_id = v.id ORDER BY medido_en DESC LIMIT 1) AS ultima_medicion FROM variable v JOIN unidad u ON v.unidad_id = u.id JOIN sensor_variable sv ON sv.variable_id = v.id JOIN sensor s ON s.id = sv.sensor_id`);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Error cargando parámetros' }); }
});

app.get('/api/visualizador/resumen', auth, async (req, res) => {
  try {
    const sitiosQuery = await pool.query('SELECT COUNT(*) AS total FROM sitio');
    const nodosQuery = await pool.query("SELECT COUNT(*) AS total FROM nodo WHERE estado = 'activo'");
    const medicionesQuery = await pool.query(`SELECT v.codigo, l.valor FROM lectura_original l JOIN variable v ON l.variable_id = v.id WHERE l.medido_en = (SELECT MAX(medido_en) FROM lectura_original)`);

    let ica = 'Sin datos', color = 'secondary', aqiScore = '-';
    if (medicionesQuery.rows.length > 0) {
      const valores = {};
      medicionesQuery.rows.forEach(r => valores[r.codigo] = parseFloat(r.valor));
      if (valores['PM25'] !== undefined) {
        const resultadoAQI = calcularAQI_EPA(valores['PM25']);
        ica = resultadoAQI.label;
        color = resultadoAQI.color;
        aqiScore = resultadoAQI.score;
      }
    }
    res.json({ sitios_definidos: parseInt(sitiosQuery.rows[0].total) || 0, nodos_ubicados: parseInt(nodosQuery.rows[0].total) || 0, ica_estado: ica, ica_color: color, ica_score: aqiScore });
  } catch (e) { res.status(500).json({ error: 'Error interno' }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor iniciado en http://localhost:${PORT}`));