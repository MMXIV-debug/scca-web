require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

app.use(express.json());
// Servir archivos estáticos del frontend
app.use(express.static('public'));

// ---------- Middlewares ----------
function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Sesión inválida' });
  }
}

function soloAdmin(req, res, next) {
  if (req.user.rol !== 'Administrador') {
    return res.status(403).json({ error: 'Solo administradores' });
  }
  next();
}

// ---------- Autenticación y Perfil ----------
app.post('/api/register', async (req, res) => {
  const { username, nombre_completo, email, password, rol_solicitado } = req.body;
  
  if (!username || !nombre_completo || !password || password.length < 8) {
    return res.status(400).json({ error: 'Datos incompletos (contraseña mínimo 8 caracteres)' });
  }
  
  if (!['Administrador', 'Visualizador'].includes(rol_solicitado)) {
    return res.status(400).json({ error: 'Rol inválido' });
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      `INSERT INTO usuario (username, nombre_completo, email, password_hash, rol_solicitado_id, estado)
       VALUES ($1, $2, $3, $4, (SELECT id FROM rol WHERE nombre = $5), 'pendiente')`,
      [username.trim(), nombre_completo.trim(), email ? email.trim() : null, hash, rol_solicitado]
    );
    res.json({ ok: true, mensaje: 'Solicitud enviada. Espera la aprobación del administrador.' });
  } catch (e) {
    if (e.code === '23505') {
      return res.status(409).json({ error: 'Usuario o email ya existe' });
    }
    console.error(e);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const { rows } = await pool.query(
      `SELECT u.*, r.nombre AS rol 
       FROM usuario u
       LEFT JOIN rol r ON r.id = u.rol_id 
       WHERE u.username = $1`, 
      [username ? username.trim() : '']
    );

    const u = rows[0];
    if (!u || !(await bcrypt.compare(password || '', u.password_hash))) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }
    if (u.estado === 'pendiente') {
      return res.status(403).json({ error: 'Tu cuenta aún está pendiente de aprobación' });
    }
    if (u.estado === 'rechazado' || !u.activo) {
      return res.status(403).json({ error: 'Tu solicitud fue rechazada o la cuenta está desactivada' });
    }

    const token = jwt.sign(
      { id: u.id, rol: u.rol, nombre: u.nombre_completo },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({ token, rol: u.rol, nombre: u.nombre_completo });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

app.get('/api/me', auth, (req, res) => res.json(req.user));

// ---------- Métricas del Dashboard ----------
app.get('/api/admin/metricas-monitoreo', auth, soloAdmin, async (req, res) => {
  try {
    const nodosQuery = await pool.query(`
      SELECT 
        COUNT(DISTINCT n.id)::int AS nodos_activos,
        COUNT(DISTINCT s.id)::int AS sensores_reales
      FROM nodo n
      LEFT JOIN sensor s ON s.nodo_id = n.id AND s.origen = 'real' AND s.activo = true
      WHERE n.estado = 'activo'
    `);

    const simulacionesQuery = await pool.query(`
      SELECT 
        COUNT(DISTINCT s.id)::int AS sensores_simulados,
        COUNT(l.id)::int AS lecturas_recientes_simuladas
      FROM sensor s
      LEFT JOIN lectura_original l ON l.sensor_id = s.id 
           AND l.recibido_en >= now() - INTERVAL '1 hour'
      WHERE s.origen = 'simulado' AND s.activo = true
    `);

    const fuentes = nodosQuery.rows[0];
    const simulaciones = simulacionesQuery.rows[0];

    res.json({
      nodos_activos: fuentes.nodos_activos || 0,
      sensores_reales: fuentes.sensores_reales || 0,
      sensores_simulados: simulaciones.sensores_simulados || 0,
      lecturas_simuladas: simulaciones.lecturas_recientes_simuladas || 0
    });
  } catch (e) {
    console.error('Error al obtener métricas de monitoreo:', e);
    res.status(500).json({ error: 'Error interno al consultar métricas' });
  }
});

// ---------- Gestión de Usuarios y Solicitudes ----------
app.get('/api/admin/solicitudes', auth, soloAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.username, u.nombre_completo, u.email, u.creado_en,
              r.nombre AS rol_solicitado
       FROM usuario u 
       JOIN rol r ON r.id = u.rol_id_solicitado_alias:
       WHERE u.estado = 'pendiente' 
       ORDER BY u.creado_en`
      .replace('rol_id_solicitado_alias:', 'r.id = u.rol_solicitado_id')
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al obtener solicitudes' });
  }
});

app.get('/api/admin/usuarios', auth, soloAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.username, u.nombre_completo, u.email, u.estado, u.activo,
              COALESCE(r.nombre, 'Sin asignar') AS rol
       FROM usuario u
       LEFT JOIN rol r ON r.id = u.rol_id
       WHERE u.estado = 'aprobado'
       ORDER BY u.id ASC`
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al obtener usuarios actuales' });
  }
});

async function resolver(req, res, nuevoEstado) {
  const id = +req.params.id;
  const rolFinal = req.body.rol || null;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const r = await client.query(
      `UPDATE usuario SET 
          estado = $1,
          rol_id = CASE 
                     WHEN $1 = 'aprobado' THEN COALESCE((SELECT id FROM rol WHERE nombre = $2), rol_solicitado_id)
                     ELSE NULL 
                   END,
          aprobado_por = $3, 
          aprobado_en = now()
       WHERE id = $4 AND estado = 'pendiente' 
       RETURNING id, rol_id`,
      [nuevoEstado, rolFinal, req.user.id, id]
    );

    if (!r.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Solicitud no encontrada' });
    }

    await client.query(
      `INSERT INTO auditoria_evento (usuario_id, entidad, entidad_id, accion, datos_despues)
       VALUES ($1, 'usuario', $2, $3, $4)`,
      [
        req.user.id, 
        id, 
        nuevoEstado === 'aprobado' ? 'aprobar' : 'rechazar',
        JSON.stringify({ estado: nuevoEstado, rol_id: r.rows[0].rol_id })
      ]
    );

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ error: 'Error del servidor al procesar solicitud' });
  } finally {
    client.release();
  }
}

app.post('/api/admin/solicitudes/:id/aprobar', auth, soloAdmin, (req, res) => resolver(req, res, 'aprobado'));
app.post('/api/admin/solicitudes/:id/rechazar', auth, soloAdmin, (req, res) => resolver(req, res, 'rechazado'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor iniciado en http://localhost:${PORT}`));