BEGIN;
ALTER TABLE public.politica_ml ADD COLUMN IF NOT EXISTS configuracion jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.alerta ADD COLUMN IF NOT EXISTS evidencia jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS ix_politica_vigente ON public.politica_ml(version DESC) WHERE vigente_hasta IS NULL;
INSERT INTO public.referencia_fuente(nombre,calibracion_ref)
VALUES('Open-Meteo/CAMS — demostración','Referencia modelada. No constituye referencia física independiente.')
ON CONFLICT(nombre) DO NOTHING;
INSERT INTO public.politica_ml(version,referencia_fuente_id,creado_por,motivo,sin_datos_seg,configuracion)
SELECT 1,r.id,u.id,'Configuración inicial: criterios de demostración existentes; sin umbrales ambientales aprobados.',300,
 jsonb_build_object('factor_sin_datos',2,'intervalos_sensor',COALESCE((SELECT jsonb_object_agg(s.id::text,900) FROM sensor s WHERE s.origen='simulado' AND s.activo),'{}'::jsonb),
 'alertas_ambientales','[]'::jsonb,'alertas_predictivas','[]'::jsonb)
FROM public.referencia_fuente r CROSS JOIN LATERAL
 (SELECT id FROM public.usuario WHERE admin_principal AND activo AND estado='aprobado' LIMIT 1) u
WHERE r.nombre='Open-Meteo/CAMS — demostración' AND NOT EXISTS(SELECT FROM public.politica_ml);
CREATE UNIQUE INDEX IF NOT EXISTS ux_alerta_regla_abierta ON public.alerta(nodo_id,regla)
WHERE estado IN ('abierta','atendida');
COMMIT;
