-- No añade tablas; una sola decisión definitiva por muestra, con auditoría existente.
-- Si existen decisiones duplicadas, el índice falla: revisar sin borrar historial.
BEGIN;
CREATE UNIQUE INDEX IF NOT EXISTS ux_cuarentena_decision
ON public.auditoria_evento(entidad_id)
WHERE entidad='lectura_cuarentena' AND accion IN ('restaurar','descartar');
COMMIT;
