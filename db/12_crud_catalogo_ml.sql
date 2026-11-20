BEGIN;

ALTER TABLE public.politica_ml ADD COLUMN IF NOT EXISTS eliminada_en timestamptz;
DROP TRIGGER IF EXISTS validacion_ml_solo_insercion ON public.validacion_ml;
CREATE OR REPLACE TRIGGER validacion_ml_solo_insercion
BEFORE TRUNCATE ON public.validacion_ml
FOR EACH STATEMENT EXECUTE FUNCTION public.bloquear_modificacion();

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_api') THEN
    GRANT DELETE ON public.modelo_ml, public.validacion_ml TO app_api;
  END IF;
END $$;
COMMIT;
