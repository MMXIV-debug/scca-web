BEGIN;
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='public.evaluacion_muestra'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%estado%' LOOP
  EXECUTE format('ALTER TABLE public.evaluacion_muestra DROP CONSTRAINT %I',c.conname);
 END LOOP;
END $$;
ALTER TABLE public.evaluacion_muestra ADD CONSTRAINT evaluacion_muestra_estado_check
 CHECK(estado IN ('evaluado_legacy','evaluado_demo','sin_modelo','ml_no_disponible','respuesta_invalida'));
ALTER TABLE public.evaluacion_muestra ADD CONSTRAINT evaluacion_muestra_resultado_check
 CHECK((estado IN ('evaluado_legacy','evaluado_demo') AND es_anomalia IS NOT NULL AND modelo_version IS NOT NULL)
 OR (estado NOT IN ('evaluado_legacy','evaluado_demo') AND es_anomalia IS NULL AND modelo_version IS NULL));
COMMIT;
