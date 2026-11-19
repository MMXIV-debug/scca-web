-- Reparación para instalaciones creadas desde scca.sql + 02_auth.sql.
-- Ejecutar después de 02_auth.sql. No cambia usuarios ni sus permisos.
BEGIN;
ALTER TABLE public.usuario DROP CONSTRAINT IF EXISTS usuario_estado_check;
ALTER TABLE public.usuario ADD CONSTRAINT usuario_estado_check
    CHECK (estado IN ('pendiente','aprobado','rechazado','inactivo'));
COMMIT;
