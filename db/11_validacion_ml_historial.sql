BEGIN;

-- Las evaluaciones se añaden al historial; una nueva evaluación conserva la anterior.
DROP TRIGGER IF EXISTS validacion_ml_solo_insercion ON public.validacion_ml;
CREATE TRIGGER validacion_ml_solo_insercion
BEFORE UPDATE OR DELETE OR TRUNCATE ON public.validacion_ml
FOR EACH STATEMENT EXECUTE FUNCTION public.bloquear_modificacion();

COMMIT;
