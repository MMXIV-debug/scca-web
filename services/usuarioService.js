const pool = require('../db/database');
const ValidadorEstados = require('./validadorEstados');

function errorUsuario(status, mensaje) {
    const error = new Error(mensaje);
    error.status = status;
    return error;
}

// La comparación se hace en PostgreSQL para conservar la precisión de las fechas.
const CONSULTA_USUARIOS = `
    SELECT u.id, u.username, u.nombre_completo, u.email, u.estado, u.activo,
           u.rol_id, u.rol_solicitado_id, u.admin_principal, u.administrador_desde,
           COALESCE(r.nombre, 'Sin asignar') AS rol,
           (a.activo AND a.estado = 'aprobado' AND ar.nombre = 'Administrador'
            AND u.id <> a.id AND NOT u.admin_principal
            AND (COALESCE(r.nombre, '') <> 'Administrador' OR a.admin_principal
                 OR a.administrador_desde < u.administrador_desde)) IS TRUE AS puede_gestionar,
           CASE WHEN u.admin_principal THEN 'Administrador principal'
                WHEN u.id = a.id THEN 'Tu cuenta'
                WHEN r.nombre = 'Administrador' AND NOT a.admin_principal
                     AND (a.administrador_desde < u.administrador_desde) IS NOT TRUE
                THEN 'Administrador de igual o mayor antigüedad'
                ELSE NULL END AS motivo_proteccion
    FROM usuario u LEFT JOIN rol r ON r.id = u.rol_id
    CROSS JOIN usuario a JOIN rol ar ON ar.id = a.rol_id
    WHERE a.id = $1`;

class UsuarioService {
    static async listar(adminId) {
        const { rows } = await pool.query(
            `${CONSULTA_USUARIOS} AND u.estado IN ('aprobado', 'inactivo') ORDER BY u.id`, [adminId]
        );
        return rows.map(u => ({
            ...u,
            puede_cambiar_rol: u.puede_gestionar && u.estado === 'aprobado' && u.activo,
            puede_inhabilitar: u.puede_gestionar && u.estado === 'aprobado' && u.activo,
            puede_reactivar: u.puede_gestionar && u.estado === 'inactivo'
        }));
    }

    static async gestionar(usuarioId, adminId, operacion) {
        if (!Number.isSafeInteger(usuarioId) || usuarioId <= 0) {
            throw errorUsuario(400, 'Identificador de usuario inválido');
        }
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            // Serializar cambios de permisos y volver a comprobar al actor dentro de la transacción.
            await client.query('SELECT pg_advisory_xact_lock(18273, 1)');
            const actor = await client.query(
                `SELECT u.id FROM usuario u JOIN rol r ON r.id = u.rol_id
                 WHERE u.id = $1 AND u.activo AND u.estado = 'aprobado'
                   AND r.nombre = 'Administrador' FOR UPDATE OF u`, [adminId]
            );
            if (!actor.rowCount) throw errorUsuario(403, 'Tu cuenta ya no tiene permisos de administrador');
            const { rows } = await client.query(
                `${CONSULTA_USUARIOS} AND u.id = $2 FOR UPDATE OF u`, [adminId, usuarioId]
            );
            const usuario = rows[0];
            if (!usuario) throw errorUsuario(404, 'Usuario no encontrado');
            if (!usuario.puede_gestionar) {
                throw errorUsuario(403, usuario.id === adminId
                    ? 'No puedes modificar el rol ni el acceso de tu propia cuenta'
                    : usuario.admin_principal
                        ? 'El administrador principal está protegido'
                        : 'No puedes modificar a un administrador de igual o mayor antigüedad');
            }
            const resultado = await operacion(client, usuario);
            await client.query('COMMIT');
            return resultado;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    static validarEstado(usuario, destino) {
        try {
            ValidadorEstados.verificarTransicion('usuario', usuario.estado, destino);
        } catch {
            throw errorUsuario(409, 'El estado de la cuenta cambió. Actualiza la lista e inténtalo de nuevo');
        }
    }

    static async auditar(client, adminId, usuario, accion, resultado, motivo = null) {
        await client.query(
            `INSERT INTO auditoria_evento
                (usuario_id, entidad, entidad_id, accion, motivo, datos_antes, datos_despues)
             VALUES ($1, 'usuario', $2, $3, $4, $5, $6)`,
            [adminId, usuario.id, accion, motivo,
                JSON.stringify({ rol_id: usuario.rol_id, estado: usuario.estado,
                    activo: usuario.activo, administrador_desde: usuario.administrador_desde }),
                JSON.stringify(resultado)]
        );
    }

    static async aprobar(usuarioId, rolSolicitado, adminId) {
        if (rolSolicitado !== null && !['Administrador', 'Visualizador'].includes(rolSolicitado)) {
            throw errorUsuario(400, 'Rol inválido');
        }
        return this.gestionar(usuarioId, adminId, async (client, usuario) => {
            this.validarEstado(usuario, 'aprobado');
            if (usuario.estado !== 'pendiente') throw errorUsuario(409, 'La solicitud ya fue resuelta');
            const roles = await client.query(
                `SELECT id FROM rol WHERE nombre IN ('Administrador', 'Visualizador')
                 AND (($1::text IS NOT NULL AND nombre = $1) OR ($1::text IS NULL AND id = $2))`,
                [rolSolicitado, usuario.rol_solicitado_id]
            );
            if (!roles.rowCount) throw errorUsuario(400, 'Rol inválido');
            const { rows } = await client.query(
                `UPDATE usuario SET estado = 'aprobado', activo = true, rol_id = $2,
                    aprobado_por = $3, aprobado_en = clock_timestamp()
                 WHERE id = $1 RETURNING id, rol_id, estado, activo, administrador_desde`,
                [usuarioId, roles.rows[0].id, adminId]
            );
            await this.auditar(client, adminId, usuario, 'aprobar', rows[0]);
            return rows[0];
        });
    }

    static async cambiarRol(usuarioId, nuevoRol, adminId) {
        if (!['Administrador', 'Visualizador'].includes(nuevoRol)) throw errorUsuario(400, 'Rol inválido');
        return this.gestionar(usuarioId, adminId, async (client, usuario) => {
            if (usuario.estado !== 'aprobado' || !usuario.activo) {
                throw errorUsuario(409, 'Solo se puede cambiar el rol de una cuenta activa y aprobada');
            }
            if (usuario.rol === nuevoRol) throw errorUsuario(409, 'El usuario ya tiene ese rol');
            const { rows } = await client.query(
                `UPDATE usuario SET rol_id = (SELECT id FROM rol WHERE nombre = $2)
                 WHERE id = $1 RETURNING id, rol_id, estado, activo, administrador_desde`, [usuarioId, nuevoRol]
            );
            await this.auditar(client, adminId, usuario, 'cambiar_rol', { ...rows[0], rol: nuevoRol });
            return rows[0];
        });
    }

    static async rechazar(usuarioId, adminId) {
        return this.gestionar(usuarioId, adminId, async (client, usuario) => {
            this.validarEstado(usuario, 'rechazado');
            const { rows } = await client.query(
                `UPDATE usuario SET estado = 'rechazado', aprobado_por = $2, aprobado_en = clock_timestamp()
                 WHERE id = $1 RETURNING id, estado, activo, rol_id, administrador_desde`, [usuarioId, adminId]
            );
            await this.auditar(client, adminId, usuario, 'rechazar', rows[0]);
            return rows[0];
        });
    }

    static async inhabilitar(usuarioId, motivo, adminId) {
        if (typeof motivo !== 'string' || motivo.length > 1000) throw errorUsuario(400, 'Motivo inválido');
        return this.gestionar(usuarioId, adminId, async (client, usuario) => {
            this.validarEstado(usuario, 'inactivo');
            const { rows } = await client.query(
                `UPDATE usuario SET activo = false, estado = 'inactivo' WHERE id = $1
                 RETURNING id, estado, activo, rol_id, administrador_desde`, [usuarioId]
            );
            await this.auditar(client, adminId, usuario, 'inhabilitar', rows[0], motivo);
            return rows[0];
        });
    }

    static async reactivar(usuarioId, adminId) {
        return this.gestionar(usuarioId, adminId, async (client, usuario) => {
<<<<<<< HEAD
            this.validarEstado(usuario, 'aprobado');
=======
>>>>>>> 207eda1 (Comentarios y cambio a base de datos en linea, por ahora en privado hasta poder cargar a la nube)
            if (usuario.estado !== 'inactivo') throw errorUsuario(409, 'La cuenta no está inhabilitada');
            const { rows } = await client.query(
                `UPDATE usuario SET activo = true, estado = 'aprobado' WHERE id = $1
                 RETURNING id, estado, activo, rol_id, administrador_desde`, [usuarioId]
            );
<<<<<<< HEAD
            await this.auditar(client, adminId, usuario, 'reactivar', rows[0], 'Reactivación de cuenta');
=======
            await this.auditar(client, adminId, usuario, 'reactivar', rows[0]);
>>>>>>> 207eda1 (Comentarios y cambio a base de datos en linea, por ahora en privado hasta poder cargar a la nube)
            return rows[0];
        });
    }
}

module.exports = UsuarioService;
