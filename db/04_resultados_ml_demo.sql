-- Persistencia aditiva de resultados HORARIOS de demostración.
-- Ejecutar con el propietario del esquema; no modifica tablas operacionales.
BEGIN;
CREATE TABLE IF NOT EXISTS public.ml_demo_version (
    version TEXT PRIMARY KEY CHECK (version ~ '^[a-f0-9]{32}$'),
    sensor_id INT NOT NULL REFERENCES public.sensor(id),
    nodo_id INT NOT NULL REFERENCES public.nodo(id),
    perfil TEXT NOT NULL CHECK (perfil IN ('dht11','bme680','contaminantes_simulados')),
    proposito TEXT NOT NULL CHECK (proposito IN ('calibracion','pronostico')),
    variable_id SMALLINT NOT NULL,
    horizonte_h INT NOT NULL,
    metadatos JSONB NOT NULL CHECK (jsonb_typeof(metadatos)='object'),
    registrado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY(sensor_id,variable_id) REFERENCES public.sensor_variable(sensor_id,variable_id),
    CHECK ((proposito='calibracion' AND horizonte_h=0) OR
           (proposito='pronostico' AND horizonte_h IN (1,3,6)))
);
CREATE TABLE IF NOT EXISTS public.ml_demo_resultado (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    version TEXT NOT NULL REFERENCES public.ml_demo_version(version),
    periodo_inicio TIMESTAMPTZ NOT NULL,
    periodo_fin TIMESTAMPTZ NOT NULL,
    entrada JSONB NOT NULL CHECK (jsonb_typeof(entrada)='object'),
    entrada_sha256 TEXT NOT NULL CHECK (entrada_sha256 ~ '^[a-f0-9]{64}$'),
    resultado JSONB NOT NULL CHECK (COALESCE((
        resultado->>'estado' IN ('evaluado_demo','fuera_dominio') AND
        resultado->>'ambito'='demostracion' AND
        resultado->>'calibracion_fisica_validada'='false' AND
        resultado->>'modelo_version'=version AND
        ((resultado->>'estado'='evaluado_demo' AND jsonb_typeof(resultado->'valor')='number') OR
         (resultado->>'estado'='fuera_dominio' AND resultado->'valor'='null'::jsonb))
        ),false)),
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (periodo_fin=periodo_inicio + interval '1 hour'),
    UNIQUE(version,periodo_inicio,entrada_sha256)
);
CREATE INDEX IF NOT EXISTS ix_ml_demo_sensor ON public.ml_demo_version(sensor_id,proposito,variable_id);
CREATE INDEX IF NOT EXISTS ix_ml_demo_periodo ON public.ml_demo_resultado(periodo_inicio DESC);
CREATE OR REPLACE FUNCTION public.ml_demo_bloquear_cambio() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Registro ML demo inmutable: % no permitido', TG_OP;
END $$;
DROP TRIGGER IF EXISTS ml_demo_version_ro ON public.ml_demo_version;
CREATE TRIGGER ml_demo_version_ro BEFORE UPDATE OR DELETE OR TRUNCATE ON public.ml_demo_version
FOR EACH STATEMENT EXECUTE FUNCTION public.ml_demo_bloquear_cambio();
DROP TRIGGER IF EXISTS ml_demo_resultado_ro ON public.ml_demo_resultado;
CREATE TRIGGER ml_demo_resultado_ro BEFORE UPDATE OR DELETE OR TRUNCATE ON public.ml_demo_resultado
FOR EACH STATEMENT EXECUTE FUNCTION public.ml_demo_bloquear_cambio();
-- Permisos mínimos cuando existe el rol usado por este proyecto.
DO $$ BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname='app_api') THEN
        GRANT SELECT, INSERT ON public.ml_demo_version, public.ml_demo_resultado TO app_api;
        GRANT USAGE, SELECT ON SEQUENCE public.ml_demo_resultado_id_seq TO app_api;
    END IF;
END $$;
COMMIT;
