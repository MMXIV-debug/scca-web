-- Evita alertas repetidas para el mismo sensor durante una interrupción.
BEGIN;
CREATE UNIQUE INDEX IF NOT EXISTS ux_alerta_tecnica_sensor_abierta
ON public.alerta(nodo_id,regla)
WHERE tipo='tecnica' AND regla LIKE 'SCCA_SIN_DATOS_SENSOR_%' AND estado IN ('abierta','atendida');
COMMIT;
