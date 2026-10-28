-- Base de datos de SCCA
CREATE DATABASE sistema_calidad_aire;
\c sistema_calidad_aire

-- PARTE 1: ROLES, USUARIOS Y CATÁLOGOS

CREATE TABLE rol (
  id SMALLINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre VARCHAR(20) NOT NULL UNIQUE CHECK (nombre IN ('Administrador','Visualizador'))
);
CREATE TABLE usuario (
  id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rol_id SMALLINT NOT NULL REFERENCES rol(id),
  username VARCHAR(50) NOT NULL UNIQUE,
  nombre_completo VARCHAR(120) NOT NULL,
  email VARCHAR(120) UNIQUE,
  password_hash TEXT NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE unidad (
  id SMALLINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  simbolo VARCHAR(10) NOT NULL UNIQUE
);
CREATE TABLE variable (
  id SMALLINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  codigo VARCHAR(20) NOT NULL UNIQUE,
  nombre VARCHAR(60) NOT NULL,
  unidad_id SMALLINT NOT NULL REFERENCES unidad(id),
  UNIQUE (id, unidad_id)
);

-- PASO 2: SITIOS, NODOS, SENSORES, MANTENIMIENTOS Y REFERENCIAS

CREATE TABLE sitio (
  id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  codigo VARCHAR(20) NOT NULL UNIQUE,
  nombre VARCHAR(100) NOT NULL,
  latitud NUMERIC(9,6) NOT NULL CHECK (latitud BETWEEN -90 AND 90),
  longitud NUMERIC(9,6) NOT NULL CHECK (longitud BETWEEN -180 AND 180)
);
CREATE TABLE nodo (
  id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  codigo VARCHAR(20) NOT NULL UNIQUE,
  sitio_id INT NOT NULL REFERENCES sitio(id),
  estado VARCHAR(15) NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo','inactivo','mantenimiento','sin_datos')),
  intervalo_muestreo_s INT NOT NULL DEFAULT 60 CHECK (intervalo_muestreo_s > 0),
  credencial_hash TEXT,
  instalado_en DATE,
  ultima_recepcion TIMESTAMPTZ
);
CREATE TABLE sensor (
  id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nodo_id INT NOT NULL REFERENCES nodo(id),
  codigo VARCHAR(30) NOT NULL UNIQUE,
  modelo VARCHAR(30) NOT NULL,
  numero_serie VARCHAR(50) NOT NULL,
  origen VARCHAR(10) NOT NULL CHECK (origen IN ('real','simulado')),
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  alta_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  baja_en TIMESTAMPTZ,
  reemplaza_a INT REFERENCES sensor(id),
  UNIQUE (modelo, numero_serie)
);
CREATE TABLE sensor_variable (
  sensor_id INT REFERENCES sensor(id),
  variable_id SMALLINT REFERENCES variable(id),
  PRIMARY KEY (sensor_id, variable_id)
);
CREATE TABLE mantenimiento (
  id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nodo_id INT NOT NULL REFERENCES nodo(id),
  sensor_id INT REFERENCES sensor(id),
  tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('instalacion','limpieza','calibracion','reemplazo','reparacion')),
  descripcion TEXT,
  realizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  registrado_por INT NOT NULL REFERENCES usuario(id)
);
CREATE TABLE referencia_fuente (
  id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL UNIQUE,
  sitio_id INT REFERENCES sitio(id),
  calibracion_ref TEXT
);
CREATE TABLE referencia_lectura (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fuente_id INT NOT NULL REFERENCES referencia_fuente(id),
  variable_id SMALLINT NOT NULL,
  unidad_id SMALLINT NOT NULL,
  medido_en TIMESTAMPTZ NOT NULL,
  valor NUMERIC(12,4) NOT NULL,
  FOREIGN KEY (variable_id, unidad_id) REFERENCES variable(id, unidad_id),
  UNIQUE (fuente_id, variable_id, medido_en)
);

-- PASO 3: LECTURAS (ORIGINALES Y CUARENTENA)

CREATE TABLE lectura_original (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sensor_id INT NOT NULL,
  variable_id SMALLINT NOT NULL,
  unidad_id SMALLINT NOT NULL,
  id_muestra BIGINT NOT NULL,
  valor NUMERIC(12,4) NOT NULL,
  medido_en TIMESTAMPTZ NOT NULL,
  recibido_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  calidad VARCHAR(10) NOT NULL DEFAULT 'valida' CHECK (calidad IN ('valida','dudosa','invalida')),
  FOREIGN KEY (sensor_id, variable_id) REFERENCES sensor_variable(sensor_id, variable_id),
  FOREIGN KEY (variable_id, unidad_id) REFERENCES variable(id, unidad_id),
  UNIQUE (sensor_id, variable_id, id_muestra)
);
CREATE INDEX ix_lectura_serie ON lectura_original (sensor_id, variable_id, medido_en DESC);
CREATE TABLE lectura_cuarentena (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payload JSONB NOT NULL,
  causa TEXT NOT NULL,
  recibido_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- PASO 4: POLITICAS ML, MODELOS, VALIDACION Y CORRECCIONES

CREATE TABLE politica_ml (
  id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  version INT NOT NULL UNIQUE,
  referencia_fuente_id INT NOT NULL REFERENCES referencia_fuente(id),
  agregado_min INT NOT NULL DEFAULT 60,
  completitud_min_pct NUMERIC(5,2) NOT NULL DEFAULT 75 CHECK (completitud_min_pct BETWEEN 0 AND 100),
  colocacion_dias INT NOT NULL DEFAULT 30,
  pares_minimos INT NOT NULL DEFAULT 540,
  test_pct NUMERIC(5,2) NOT NULL DEFAULT 30,
  mejora_rmse_min_pct NUMERIC(5,2) NOT NULL DEFAULT 20,
  sin_datos_seg INT NOT NULL DEFAULT 300,
  vigente_desde TIMESTAMPTZ NOT NULL DEFAULT now(),
  vigente_hasta TIMESTAMPTZ,
  motivo TEXT,
  creado_por INT NOT NULL REFERENCES usuario(id)
);
CREATE TABLE politica_variable (
  politica_id INT REFERENCES politica_ml(id),
  variable_id SMALLINT REFERENCES variable(id),
  rango_min NUMERIC(12,4) NOT NULL,
  rango_max NUMERIC(12,4) NOT NULL,
  umbral_alerta NUMERIC(12,4),
  PRIMARY KEY (politica_id, variable_id),
  CHECK (rango_min < rango_max)
);
CREATE TABLE modelo_ml (
  id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sensor_id INT NOT NULL,
  variable_id SMALLINT NOT NULL,
  politica_id INT NOT NULL REFERENCES politica_ml(id),
  version INT NOT NULL,
  algoritmo VARCHAR(20) NOT NULL CHECK (algoritmo IN ('regresion_lineal','random_forest')),
  parametros JSONB NOT NULL,
  artefacto_ruta TEXT,
  hash_artefacto CHAR(64),
  dominio_min NUMERIC(12,4),
  dominio_max NUMERIC(12,4),
  estado VARCHAR(12) NOT NULL DEFAULT 'candidato' CHECK (estado IN ('candidato','apto','activo','rechazado','suspendido','retirado')),
  entrenado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  activado_en TIMESTAMPTZ,
  FOREIGN KEY (sensor_id, variable_id) REFERENCES sensor_variable(sensor_id, variable_id),
  UNIQUE (sensor_id, variable_id, version)
);
CREATE UNIQUE INDEX ux_modelo_activo ON modelo_ml (sensor_id, variable_id) WHERE estado = 'activo';
CREATE TABLE validacion_ml (
  id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  modelo_id INT NOT NULL REFERENCES modelo_ml(id),
  politica_id INT NOT NULL REFERENCES politica_ml(id),
  pares INT NOT NULL,
  mae_orig NUMERIC(12,6), rmse_orig NUMERIC(12,6), sesgo_orig NUMERIC(12,6),
  mae_ml NUMERIC(12,6), rmse_ml NUMERIC(12,6), sesgo_ml NUMERIC(12,6),
  r2 NUMERIC(12,6),
  mejora_rmse_pct NUMERIC(7,2),
  hash_conjunto CHAR(64),
  estado VARCHAR(10) NOT NULL CHECK (estado IN ('apto','rechazado','pendiente')),
  evaluado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE lectura_corregida (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  lectura_id BIGINT NOT NULL REFERENCES lectura_original(id),
  modelo_id INT NOT NULL REFERENCES modelo_ml(id),
  valor_corregido NUMERIC(12,4),
  estado VARCHAR(15) NOT NULL CHECK (estado IN ('corregido','no_corregido','fuera_dominio')),
  calculado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (lectura_id, modelo_id)
);

-- PASO 5: ALERTAS, AUDITORIAS DE SOLO INSERCION Y TRIGGERS

CREATE TABLE alerta (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tipo VARCHAR(10) NOT NULL CHECK (tipo IN ('ambiental','tecnica')),
  nodo_id INT NOT NULL REFERENCES nodo(id),
  variable_id SMALLINT REFERENCES variable(id),
  regla VARCHAR(100) NOT NULL,
  valor NUMERIC(12,4),
  unidad_id SMALLINT REFERENCES unidad(id),
  calidad VARCHAR(10),
  periodo_ini TIMESTAMPTZ,
  periodo_fin TIMESTAMPTZ,
  modelo_id INT REFERENCES modelo_ml(id),
  generada_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  estado VARCHAR(10) NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta','atendida','resuelta')),
  atendida_por INT REFERENCES usuario(id),
  atendida_en TIMESTAMPTZ,
  observacion TEXT
);
CREATE TABLE auditoria_evento (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  usuario_id INT REFERENCES usuario(id),
  servicio VARCHAR(30) CHECK (servicio IN ('api','servicio_ml','nodo')),
  entidad VARCHAR(40) NOT NULL,
  entidad_id BIGINT,
  accion VARCHAR(20) NOT NULL,
  motivo TEXT,
  datos_antes JSONB,
  datos_despues JSONB,
  modelo_id INT REFERENCES modelo_ml(id),
  politica_id INT REFERENCES politica_ml(id),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((usuario_id IS NOT NULL) <> (servicio IS NOT NULL))
);

CREATE FUNCTION bloquear_modificacion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Solo inserción: % no permitido en %', TG_OP, TG_TABLE_NAME; END $$;
CREATE TRIGGER tg_auditoria_ro BEFORE UPDATE OR DELETE ON auditoria_evento FOR EACH ROW EXECUTE FUNCTION bloquear_modificacion();
CREATE TRIGGER tg_lectura_ro  BEFORE UPDATE OR DELETE ON lectura_original FOR EACH ROW EXECUTE FUNCTION bloquear_modificacion();

CREATE FUNCTION retirar_modelos_sensor() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.activo AND NOT NEW.activo THEN
    NEW.baja_en := COALESCE(NEW.baja_en, now());
    UPDATE modelo_ml SET estado = 'retirado'
    WHERE sensor_id = NEW.id AND estado IN ('candidato','apto','activo');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tg_sensor_baja BEFORE UPDATE OF activo ON sensor FOR EACH ROW EXECUTE FUNCTION retirar_modelos_sensor();

-- Cuenta de aplicación sin UPDATE/DELETE sobre originales y auditoría (RNF-05)
CREATE ROLE app_api LOGIN PASSWORD 'Cambiar';
GRANT USAGE ON SCHEMA public TO app_api;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO app_api;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO app_api;
REVOKE UPDATE, DELETE, TRUNCATE ON lectura_original, auditoria_evento FROM app_api;



-- Cambios para la base de datos para cuentas Deshabilitadas o inactivas
ALTER TABLE usuario DROP CONSTRAINT IF EXISTS usuario_estado_check;
ALTER TABLE usuario ADD CONSTRAINT usuario_estado_check 
  CHECK (estado IN ('pendiente', 'aprobado', 'rechazado', 'inactivo'));