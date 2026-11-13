const pool = require('../db/database');
const ValidadorEstados = require('./validadorEstados');

class UsuarioService {
    static async aprobar(usuarioId, rolSolicitado, adminId) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            
            // 1. Consultar estado actual del usuario
            const userRes = await client.query('SELECT estado FROM usuario WHERE id = $1', [usuarioId]);
            if (userRes.rowCount === 0) throw new Error('NOT_FOUND');
            
            // 2. Validar transición de estado (Patrón State)
            ValidadorEstados.verificarTransicion('usuario', userRes.rows[0].estado, 'aprobado');

            // 3. Ejecutar actualización
            const r = await client.query(
                `UPDATE usuario SET 
                    estado = 'aprobado',
                    activo = true,
                    rol_id = COALESCE((SELECT id FROM rol WHERE nombre = $2), rol_solicitado_id),
                    aprobado_por = $3, 
                    aprobado_en = now()
                WHERE id = $1
                RETURNING id, rol_id`,
                [usuarioId, rolSolicitado, adminId]
            );

            // 4. Registrar auditoría y confirmar
            await client.query(
                `INSERT INTO auditoria_evento (usuario_id, entidad, entidad_id, accion, datos_despues)
                VALUES ($1, 'usuario', $2, 'aprobar', $3)`,
                [adminId, usuarioId, JSON.stringify({ estado: 'aprobado', rol_id: r.rows[0].rol_id })]
            );
            
            await client.query('COMMIT');
            return r.rows[0];
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    }

    static async rechazar(usuarioId, adminId) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            
            const userRes = await client.query('SELECT estado FROM usuario WHERE id = $1', [usuarioId]);
            if (userRes.rowCount === 0) throw new Error('NOT_FOUND');
            
            ValidadorEstados.verificarTransicion('usuario', userRes.rows[0].estado, 'rechazado');

            const r = await client.query(
                `UPDATE usuario SET estado = 'rechazado', aprobado_por = $2, aprobado_en = now()
                 WHERE id = $1 RETURNING id`,
                [usuarioId, adminId]
            );

            await client.query(
                `INSERT INTO auditoria_evento (usuario_id, entidad, entidad_id, accion, datos_despues)
                 VALUES ($1, 'usuario', $2, 'rechazar', $3)`,
                [adminId, usuarioId, JSON.stringify({ estado: 'rechazado' })]
            );
            
            await client.query('COMMIT');
            return r.rows[0];
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    }

    static async inhabilitar(usuarioId, motivo, adminId) {
        if (usuarioId === adminId) throw new Error('SELF_DISABLE');
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            
            const userRes = await client.query('SELECT estado FROM usuario WHERE id = $1', [usuarioId]);
            if (userRes.rowCount === 0) throw new Error('NOT_FOUND');
            
            ValidadorEstados.verificarTransicion('usuario', userRes.rows[0].estado, 'inactivo');

            const u = await client.query(
                `UPDATE usuario SET activo = false, estado = 'inactivo' WHERE id = $1 RETURNING id`,
                [usuarioId]
            );

            await client.query(
                `INSERT INTO auditoria_evento (usuario_id, entidad, entidad_id, accion, motivo, datos_despues) 
                 VALUES ($1, 'usuario', $2, 'inhabilitar', $3, $4)`,
                [adminId, usuarioId, motivo, JSON.stringify({ estado: 'inactivo', activo: false })]
            );
            
            await client.query('COMMIT');
            return u.rows[0];
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    }

    static async reactivar(usuarioId, adminId) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            
            const userRes = await client.query('SELECT estado FROM usuario WHERE id = $1', [usuarioId]);
            if (userRes.rowCount === 0) throw new Error('NOT_FOUND');
            
            ValidadorEstados.verificarTransicion('usuario', userRes.rows[0].estado, 'aprobado');

            const u = await client.query(
                `UPDATE usuario SET activo = true, estado = 'aprobado' WHERE id = $1 RETURNING id`,
                [usuarioId]
            );

            await client.query(
                `INSERT INTO auditoria_evento (usuario_id, entidad, entidad_id, accion, motivo, datos_despues) 
                 VALUES ($1, 'usuario', $2, 'reactivar', 'Reactivación de cuenta', $3)`,
                [adminId, usuarioId, JSON.stringify({ estado: 'aprobado', activo: true })]
            );
            
            await client.query('COMMIT');
            return u.rows[0];
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    }
}

module.exports = UsuarioService;