-- Endurecimiento Sprints 1 y 2:
-- 1. Inmutabilidad completa (incluyendo TRUNCATE) en originales, auditoría y políticas ML.
-- 2. Estado 'dato_invalido' en evaluacion_muestra para cuarentena de lecturas inválidas.
-- 3. Catálogo de unidades y variables del sensor BME680 (PRES hPa, GAS ohm).
-- 4. Rangos iniciales en politica_variable para la política vigente.
-- 5. Permisos de menor privilegio para la cuenta de aplicación app_api (no superusuario).
BEGIN;

-- 1. Bloquear TRUNCATE en lectura_original y auditoria_evento y asegurar retiro de modelos al dar de baja un sensor
CREATE OR REPLACE FUNCTION public.bloquear_modificacion() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Solo inserción: % no permitido en %', TG_OP, TG_TABLE_NAME;
END $$;

DROP TRIGGER IF EXISTS tg_lectura_truncate ON public.lectura_original;
CREATE TRIGGER tg_lectura_truncate
BEFORE TRUNCATE ON public.lectura_original
FOR EACH STATEMENT EXECUTE FUNCTION public.bloquear_modificacion();

DROP TRIGGER IF EXISTS tg_auditoria_truncate ON public.auditoria_evento;
CREATE TRIGGER tg_auditoria_truncate
BEFORE TRUNCATE ON public.auditoria_evento
FOR EACH STATEMENT EXECUTE FUNCTION public.bloquear_modificacion();

CREATE OR REPLACE FUNCTION public.retirar_modelos_sensor() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.activo AND NOT NEW.activo THEN
    NEW.baja_en := COALESCE(NEW.baja_en, now());
    UPDATE public.modelo_ml SET estado = 'retirado'
    WHERE sensor_id = NEW.id AND estado IN ('candidato','apto','activo');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_sensor_baja ON public.sensor;
CREATE TRIGGER tg_sensor_baja
BEFORE UPDATE OF activo ON public.sensor
FOR EACH ROW EXECUTE FUNCTION public.retirar_modelos_sensor();

-- 2. Inmutabilidad de parámetros de politica_ml y de politica_variable
-- Solo se permite actualizar vigente_hasta y eliminada_en en politica_ml.
ALTER TABLE public.politica_ml ADD COLUMN IF NOT EXISTS eliminada_en timestamptz;

CREATE OR REPLACE FUNCTION public.proteger_politica_ml() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.version IS DISTINCT FROM OLD.version
       OR NEW.referencia_fuente_id IS DISTINCT FROM OLD.referencia_fuente_id
       OR NEW.agregado_min IS DISTINCT FROM OLD.agregado_min
       OR NEW.completitud_min_pct IS DISTINCT FROM OLD.completitud_min_pct
       OR NEW.colocacion_dias IS DISTINCT FROM OLD.colocacion_dias
       OR NEW.pares_minimos IS DISTINCT FROM OLD.pares_minimos
       OR NEW.test_pct IS DISTINCT FROM OLD.test_pct
       OR NEW.mejora_rmse_min_pct IS DISTINCT FROM OLD.mejora_rmse_min_pct
       OR NEW.sin_datos_seg IS DISTINCT FROM OLD.sin_datos_seg
       OR NEW.vigente_desde IS DISTINCT FROM OLD.vigente_desde
       OR NEW.motivo IS DISTINCT FROM OLD.motivo
       OR NEW.creado_por IS DISTINCT FROM OLD.creado_por
       OR NEW.configuracion IS DISTINCT FROM OLD.configuracion THEN
      RAISE EXCEPTION 'Las políticas ML son inmutables: crea una nueva versión en lugar de editar la existente.';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Operación % no permitida en politica_ml', TG_OP;
END $$;

DROP TRIGGER IF EXISTS tg_politica_ml_inmutable ON public.politica_ml;
CREATE TRIGGER tg_politica_ml_inmutable
BEFORE UPDATE OR DELETE ON public.politica_ml
FOR EACH ROW EXECUTE FUNCTION public.proteger_politica_ml();

DROP TRIGGER IF EXISTS tg_politica_ml_truncate ON public.politica_ml;
CREATE TRIGGER tg_politica_ml_truncate
BEFORE TRUNCATE ON public.politica_ml
FOR EACH STATEMENT EXECUTE FUNCTION public.bloquear_modificacion();

DROP TRIGGER IF EXISTS tg_politica_variable_ro ON public.politica_variable;
CREATE TRIGGER tg_politica_variable_ro
BEFORE UPDATE OR DELETE OR TRUNCATE ON public.politica_variable
FOR EACH STATEMENT EXECUTE FUNCTION public.bloquear_modificacion();

-- 3. Permitir estado 'dato_invalido' en evaluacion_muestra (si la tabla existe)
DO $$
DECLARE c record;
BEGIN
  IF to_regclass('public.evaluacion_muestra') IS NOT NULL THEN
    FOR c IN
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'public.evaluacion_muestra'::regclass
        AND contype = 'c'
        AND (pg_get_constraintdef(oid) LIKE '%estado%' OR pg_get_constraintdef(oid) LIKE '%es_anomalia%')
    LOOP
      EXECUTE format('ALTER TABLE public.evaluacion_muestra DROP CONSTRAINT %I', c.conname);
    END LOOP;

    ALTER TABLE public.evaluacion_muestra ADD CONSTRAINT evaluacion_muestra_estado_check
      CHECK (estado IN ('evaluado_legacy','evaluado_demo','sin_modelo','ml_no_disponible','respuesta_invalida','dato_invalido'));
    ALTER TABLE public.evaluacion_muestra ADD CONSTRAINT evaluacion_muestra_resultado_check
      CHECK (
        (estado IN ('evaluado_legacy','evaluado_demo') AND es_anomalia IS NOT NULL AND modelo_version IS NOT NULL)
        OR (estado NOT IN ('evaluado_legacy','evaluado_demo') AND es_anomalia IS NULL AND modelo_version IS NULL)
      );
  END IF;
END $$;

-- 4. Catálogo de unidades y variables para BME680
INSERT INTO public.unidad(simbolo) VALUES ('hPa'), ('ohm')
ON CONFLICT (simbolo) DO NOTHING;

INSERT INTO public.variable(codigo, nombre, unidad_id)
SELECT 'PRES', 'Presión atmosférica', u.id
FROM public.unidad u WHERE u.simbolo = 'hPa'
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO public.variable(codigo, nombre, unidad_id)
SELECT 'GAS', 'Resistencia de gas (VOC)', u.id
FROM public.unidad u WHERE u.simbolo = 'ohm'
ON CONFLICT (codigo) DO NOTHING;

-- 5. Sembrar rangos iniciales en politica_variable para la política vigente si aún no tiene rangos
INSERT INTO public.politica_variable(politica_id, variable_id, rango_min, rango_max, umbral_alerta)
SELECT p.id, v.id, r.rango_min, r.rango_max, r.umbral_alerta
FROM (
  SELECT id FROM public.politica_ml
  WHERE vigente_hasta IS NULL AND eliminada_en IS NULL
  ORDER BY version DESC LIMIT 1
) p
JOIN (VALUES
  ('PM1',   0::numeric,     1000::numeric,     NULL::numeric),
  ('PM25',  0::numeric,     1000::numeric,     35.4::numeric),
  ('PM10',  0::numeric,     1000::numeric,     150::numeric),
  ('CO',    0::numeric,     50000::numeric,    10000::numeric),
  ('TEMP', -40::numeric,    85::numeric,       NULL::numeric),
  ('HUM',   0::numeric,     100::numeric,      NULL::numeric),
  ('PRES',  300::numeric,   1100::numeric,     NULL::numeric),
  ('GAS',   1::numeric,     10000000::numeric, NULL::numeric)
) AS r(codigo, rango_min, rango_max, umbral_alerta) ON TRUE
JOIN public.variable v ON v.codigo = r.codigo
WHERE NOT EXISTS (SELECT 1 FROM public.politica_variable pv WHERE pv.politica_id = p.id)
ON CONFLICT (politica_id, variable_id) DO NOTHING;

-- 6. Permisos mínimos para el rol app_api (sin privilegios de superusuario)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_api') THEN
    GRANT USAGE ON SCHEMA public TO app_api;
    GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO app_api;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_api;
    REVOKE DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM app_api;
    GRANT DELETE ON public.modelo_ml TO app_api;

    REVOKE UPDATE, DELETE, TRUNCATE ON public.lectura_original, public.auditoria_evento, public.politica_variable FROM app_api;

    IF to_regclass('public.evaluacion_muestra') IS NOT NULL THEN
      REVOKE UPDATE, DELETE, TRUNCATE ON public.evaluacion_muestra FROM app_api;
    END IF;
    IF to_regclass('public.ml_demo_version') IS NOT NULL THEN
      REVOKE UPDATE, DELETE, TRUNCATE ON public.ml_demo_version, public.ml_demo_resultado FROM app_api;
    END IF;
    IF to_regclass('public.validacion_ml') IS NOT NULL THEN
      REVOKE DELETE, TRUNCATE ON public.validacion_ml FROM app_api;
    END IF;
  END IF;
END $$;

COMMIT;
