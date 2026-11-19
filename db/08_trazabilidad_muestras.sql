BEGIN;
CREATE TABLE IF NOT EXISTS public.evaluacion_muestra (
    sensor_id integer NOT NULL REFERENCES public.sensor(id),
    id_muestra bigint NOT NULL CHECK(id_muestra > 0),
    nodo_id integer NOT NULL REFERENCES public.nodo(id),
    perfil text NOT NULL CHECK(perfil IN ('dht11','bme680','contaminantes_simulados')),
    origen text NOT NULL CHECK(origen IN ('real','simulado')),
    medido_en timestamptz NOT NULL,
    evaluado_en timestamptz NOT NULL DEFAULT now(),
    estado text NOT NULL CHECK(estado IN ('evaluado_legacy','sin_modelo','ml_no_disponible','respuesta_invalida')),
    es_anomalia boolean,
    modelo_version text,
    evidencia jsonb NOT NULL CHECK(jsonb_typeof(evidencia)='object'),
    PRIMARY KEY(sensor_id,id_muestra),
    CHECK((estado='evaluado_legacy' AND es_anomalia IS NOT NULL AND modelo_version IS NOT NULL)
        OR (estado<>'evaluado_legacy' AND es_anomalia IS NULL AND modelo_version IS NULL))
);
CREATE INDEX IF NOT EXISTS ix_evaluacion_muestra_fecha ON public.evaluacion_muestra(sensor_id,medido_en DESC);
CREATE INDEX IF NOT EXISTS ix_cuarentena_identidad ON public.lectura_cuarentena((payload->>'sensorId'),(payload->>'idMuestra'));
CREATE OR REPLACE FUNCTION public.evaluacion_muestra_inmutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'La evaluación original de una muestra es inmutable'; END $$;
DROP TRIGGER IF EXISTS evaluacion_muestra_ro ON public.evaluacion_muestra;
CREATE TRIGGER evaluacion_muestra_ro BEFORE UPDATE OR DELETE OR TRUNCATE ON public.evaluacion_muestra
FOR EACH STATEMENT EXECUTE FUNCTION public.evaluacion_muestra_inmutable();
DO $$ BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='app_api') THEN
  GRANT SELECT,INSERT ON public.evaluacion_muestra TO app_api;
 END IF;
END $$;
COMMIT;
