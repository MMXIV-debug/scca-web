--
-- PostgreSQL database dump
--

\restrict DeHq8T9GqyznKeExcC4TSdxbqf1laNXZc3bA4Nn15bR1wzxGIue7pKrfvoop3va

-- Dumped from database version 18.6
-- Dumped by pg_dump version 18.6

-- Started on 2026-10-28 20:02:38

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- TOC entry 2 (class 3079 OID 16881)
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- TOC entry 5337 (class 0 OID 0)
-- Dependencies: 2
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- TOC entry 258 (class 1255 OID 16875)
-- Name: bloquear_modificacion(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.bloquear_modificacion() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN RAISE EXCEPTION 'Solo inserci¢n: % no permitido en %', TG_OP, TG_TABLE_NAME; END $$;


ALTER FUNCTION public.bloquear_modificacion() OWNER TO postgres;

--
-- TOC entry 259 (class 1255 OID 16878)
-- Name: retirar_modelos_sensor(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.retirar_modelos_sensor() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF OLD.activo AND NOT NEW.activo THEN
    NEW.baja_en := COALESCE(NEW.baja_en, now());
    UPDATE modelo_ml SET estado = 'retirado'
    WHERE sensor_id = NEW.id AND estado IN ('candidato','apto','activo');
  END IF;
  RETURN NEW;
END $$;


ALTER FUNCTION public.retirar_modelos_sensor() OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- TOC entry 255 (class 1259 OID 16802)
-- Name: alerta; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.alerta (
    id bigint NOT NULL,
    tipo character varying(10) NOT NULL,
    nodo_id integer NOT NULL,
    variable_id smallint,
    regla character varying(100) NOT NULL,
    valor numeric(12,4),
    unidad_id smallint,
    calidad character varying(10),
    periodo_ini timestamp with time zone,
    periodo_fin timestamp with time zone,
    modelo_id integer,
    generada_en timestamp with time zone DEFAULT now() NOT NULL,
    estado character varying(10) DEFAULT 'abierta'::character varying NOT NULL,
    atendida_por integer,
    atendida_en timestamp with time zone,
    observacion text,
    CONSTRAINT alerta_estado_check CHECK (((estado)::text = ANY ((ARRAY['abierta'::character varying, 'atendida'::character varying, 'resuelta'::character varying])::text[]))),
    CONSTRAINT alerta_tipo_check CHECK (((tipo)::text = ANY ((ARRAY['ambiental'::character varying, 'tecnica'::character varying])::text[])))
);


ALTER TABLE public.alerta OWNER TO postgres;

--
-- TOC entry 254 (class 1259 OID 16801)
-- Name: alerta_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.alerta ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.alerta_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 257 (class 1259 OID 16846)
-- Name: auditoria_evento; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.auditoria_evento (
    id bigint NOT NULL,
    usuario_id integer,
    servicio character varying(30),
    entidad character varying(40) NOT NULL,
    entidad_id bigint,
    accion character varying(20) NOT NULL,
    motivo text,
    datos_antes jsonb,
    datos_despues jsonb,
    modelo_id integer,
    politica_id integer,
    creado_en timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT auditoria_evento_check CHECK (((usuario_id IS NOT NULL) <> (servicio IS NOT NULL))),
    CONSTRAINT auditoria_evento_servicio_check CHECK (((servicio)::text = ANY ((ARRAY['api'::character varying, 'servicio_ml'::character varying, 'nodo'::character varying])::text[])))
);


ALTER TABLE public.auditoria_evento OWNER TO postgres;

--
-- TOC entry 256 (class 1259 OID 16845)
-- Name: auditoria_evento_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.auditoria_evento ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.auditoria_evento_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 253 (class 1259 OID 16777)
-- Name: lectura_corregida; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.lectura_corregida (
    id bigint NOT NULL,
    lectura_id bigint NOT NULL,
    modelo_id integer NOT NULL,
    valor_corregido numeric(12,4),
    estado character varying(15) NOT NULL,
    calculado_en timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT lectura_corregida_estado_check CHECK (((estado)::text = ANY ((ARRAY['corregido'::character varying, 'no_corregido'::character varying, 'fuera_dominio'::character varying])::text[])))
);


ALTER TABLE public.lectura_corregida OWNER TO postgres;

--
-- TOC entry 252 (class 1259 OID 16776)
-- Name: lectura_corregida_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.lectura_corregida ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.lectura_corregida_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 244 (class 1259 OID 16645)
-- Name: lectura_cuarentena; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.lectura_cuarentena (
    id bigint NOT NULL,
    payload jsonb NOT NULL,
    causa text NOT NULL,
    recibido_en timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.lectura_cuarentena OWNER TO postgres;

--
-- TOC entry 243 (class 1259 OID 16644)
-- Name: lectura_cuarentena_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.lectura_cuarentena ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.lectura_cuarentena_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 242 (class 1259 OID 16614)
-- Name: lectura_original; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.lectura_original (
    id bigint NOT NULL,
    sensor_id integer NOT NULL,
    variable_id smallint NOT NULL,
    unidad_id smallint NOT NULL,
    id_muestra bigint NOT NULL,
    valor numeric(12,4) NOT NULL,
    medido_en timestamp with time zone NOT NULL,
    recibido_en timestamp with time zone DEFAULT now() NOT NULL,
    calidad character varying(10) DEFAULT 'valida'::character varying NOT NULL,
    CONSTRAINT lectura_original_calidad_check CHECK (((calidad)::text = ANY ((ARRAY['valida'::character varying, 'dudosa'::character varying, 'invalida'::character varying])::text[])))
);


ALTER TABLE public.lectura_original OWNER TO postgres;

--
-- TOC entry 241 (class 1259 OID 16613)
-- Name: lectura_original_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.lectura_original ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.lectura_original_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 236 (class 1259 OID 16543)
-- Name: mantenimiento; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.mantenimiento (
    id integer NOT NULL,
    nodo_id integer NOT NULL,
    sensor_id integer,
    tipo character varying(20) NOT NULL,
    descripcion text,
    realizado_en timestamp with time zone DEFAULT now() NOT NULL,
    registrado_por integer NOT NULL,
    CONSTRAINT mantenimiento_tipo_check CHECK (((tipo)::text = ANY ((ARRAY['instalacion'::character varying, 'limpieza'::character varying, 'calibracion'::character varying, 'reemplazo'::character varying, 'reparacion'::character varying])::text[])))
);


ALTER TABLE public.mantenimiento OWNER TO postgres;

--
-- TOC entry 235 (class 1259 OID 16542)
-- Name: mantenimiento_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.mantenimiento ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.mantenimiento_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 249 (class 1259 OID 16719)
-- Name: modelo_ml; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.modelo_ml (
    id integer NOT NULL,
    sensor_id integer NOT NULL,
    variable_id smallint NOT NULL,
    politica_id integer NOT NULL,
    version integer NOT NULL,
    algoritmo character varying(20) NOT NULL,
    parametros jsonb NOT NULL,
    artefacto_ruta text,
    hash_artefacto character(64),
    dominio_min numeric(12,4),
    dominio_max numeric(12,4),
    estado character varying(12) DEFAULT 'candidato'::character varying NOT NULL,
    entrenado_en timestamp with time zone DEFAULT now() NOT NULL,
    activado_en timestamp with time zone,
    CONSTRAINT modelo_ml_algoritmo_check CHECK (((algoritmo)::text = ANY ((ARRAY['regresion_lineal'::character varying, 'random_forest'::character varying])::text[]))),
    CONSTRAINT modelo_ml_estado_check CHECK (((estado)::text = ANY ((ARRAY['candidato'::character varying, 'apto'::character varying, 'activo'::character varying, 'rechazado'::character varying, 'suspendido'::character varying, 'retirado'::character varying])::text[])))
);


ALTER TABLE public.modelo_ml OWNER TO postgres;

--
-- TOC entry 248 (class 1259 OID 16718)
-- Name: modelo_ml_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.modelo_ml ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.modelo_ml_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 231 (class 1259 OID 16471)
-- Name: nodo; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.nodo (
    id integer NOT NULL,
    codigo character varying(20) NOT NULL,
    sitio_id integer NOT NULL,
    estado character varying(15) DEFAULT 'activo'::character varying NOT NULL,
    intervalo_muestreo_s integer DEFAULT 60 NOT NULL,
    credencial_hash text,
    instalado_en date,
    ultima_recepcion timestamp with time zone,
    CONSTRAINT nodo_estado_check CHECK (((estado)::text = ANY ((ARRAY['activo'::character varying, 'inactivo'::character varying, 'mantenimiento'::character varying, 'sin_datos'::character varying])::text[]))),
    CONSTRAINT nodo_intervalo_muestreo_s_check CHECK ((intervalo_muestreo_s > 0))
);


ALTER TABLE public.nodo OWNER TO postgres;

--
-- TOC entry 230 (class 1259 OID 16470)
-- Name: nodo_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.nodo ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.nodo_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 246 (class 1259 OID 16658)
-- Name: politica_ml; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.politica_ml (
    id integer NOT NULL,
    version integer NOT NULL,
    referencia_fuente_id integer NOT NULL,
    agregado_min integer DEFAULT 60 NOT NULL,
    completitud_min_pct numeric(5,2) DEFAULT 75 NOT NULL,
    colocacion_dias integer DEFAULT 30 NOT NULL,
    pares_minimos integer DEFAULT 540 NOT NULL,
    test_pct numeric(5,2) DEFAULT 30 NOT NULL,
    mejora_rmse_min_pct numeric(5,2) DEFAULT 20 NOT NULL,
    sin_datos_seg integer DEFAULT 300 NOT NULL,
    vigente_desde timestamp with time zone DEFAULT now() NOT NULL,
    vigente_hasta timestamp with time zone,
    motivo text,
    creado_por integer NOT NULL,
    CONSTRAINT politica_ml_completitud_min_pct_check CHECK (((completitud_min_pct >= (0)::numeric) AND (completitud_min_pct <= (100)::numeric)))
);


ALTER TABLE public.politica_ml OWNER TO postgres;

--
-- TOC entry 245 (class 1259 OID 16657)
-- Name: politica_ml_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.politica_ml ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.politica_ml_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 247 (class 1259 OID 16698)
-- Name: politica_variable; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.politica_variable (
    politica_id integer NOT NULL,
    variable_id smallint NOT NULL,
    rango_min numeric(12,4) NOT NULL,
    rango_max numeric(12,4) NOT NULL,
    umbral_alerta numeric(12,4),
    CONSTRAINT politica_variable_check CHECK ((rango_min < rango_max))
);


ALTER TABLE public.politica_variable OWNER TO postgres;

--
-- TOC entry 238 (class 1259 OID 16573)
-- Name: referencia_fuente; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.referencia_fuente (
    id integer NOT NULL,
    nombre character varying(100) NOT NULL,
    sitio_id integer,
    calibracion_ref text
);


ALTER TABLE public.referencia_fuente OWNER TO postgres;

--
-- TOC entry 237 (class 1259 OID 16572)
-- Name: referencia_fuente_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.referencia_fuente ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.referencia_fuente_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 240 (class 1259 OID 16590)
-- Name: referencia_lectura; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.referencia_lectura (
    id bigint NOT NULL,
    fuente_id integer NOT NULL,
    variable_id smallint NOT NULL,
    unidad_id smallint NOT NULL,
    medido_en timestamp with time zone NOT NULL,
    valor numeric(12,4) NOT NULL
);


ALTER TABLE public.referencia_lectura OWNER TO postgres;

--
-- TOC entry 239 (class 1259 OID 16589)
-- Name: referencia_lectura_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.referencia_lectura ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.referencia_lectura_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 221 (class 1259 OID 16390)
-- Name: rol; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.rol (
    id smallint NOT NULL,
    nombre character varying(20) NOT NULL,
    CONSTRAINT rol_nombre_check CHECK (((nombre)::text = ANY ((ARRAY['Administrador'::character varying, 'Visualizador'::character varying])::text[])))
);


ALTER TABLE public.rol OWNER TO postgres;

--
-- TOC entry 220 (class 1259 OID 16389)
-- Name: rol_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.rol ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.rol_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 233 (class 1259 OID 16495)
-- Name: sensor; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.sensor (
    id integer NOT NULL,
    nodo_id integer NOT NULL,
    codigo character varying(30) NOT NULL,
    modelo character varying(30) NOT NULL,
    numero_serie character varying(50) NOT NULL,
    origen character varying(10) NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    alta_en timestamp with time zone DEFAULT now() NOT NULL,
    baja_en timestamp with time zone,
    reemplaza_a integer,
    CONSTRAINT sensor_origen_check CHECK (((origen)::text = ANY ((ARRAY['real'::character varying, 'simulado'::character varying])::text[])))
);


ALTER TABLE public.sensor OWNER TO postgres;

--
-- TOC entry 232 (class 1259 OID 16494)
-- Name: sensor_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.sensor ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.sensor_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 234 (class 1259 OID 16525)
-- Name: sensor_variable; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.sensor_variable (
    sensor_id integer NOT NULL,
    variable_id smallint NOT NULL
);


ALTER TABLE public.sensor_variable OWNER TO postgres;

--
-- TOC entry 229 (class 1259 OID 16456)
-- Name: sitio; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.sitio (
    id integer NOT NULL,
    codigo character varying(20) NOT NULL,
    nombre character varying(100) NOT NULL,
    latitud numeric(9,6) NOT NULL,
    longitud numeric(9,6) NOT NULL,
    CONSTRAINT sitio_latitud_check CHECK (((latitud >= ('-90'::integer)::numeric) AND (latitud <= (90)::numeric))),
    CONSTRAINT sitio_longitud_check CHECK (((longitud >= ('-180'::integer)::numeric) AND (longitud <= (180)::numeric)))
);


ALTER TABLE public.sitio OWNER TO postgres;

--
-- TOC entry 228 (class 1259 OID 16455)
-- Name: sitio_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.sitio ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.sitio_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 225 (class 1259 OID 16427)
-- Name: unidad; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.unidad (
    id smallint NOT NULL,
    simbolo character varying(10) NOT NULL
);


ALTER TABLE public.unidad OWNER TO postgres;

--
-- TOC entry 224 (class 1259 OID 16426)
-- Name: unidad_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.unidad ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.unidad_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 223 (class 1259 OID 16401)
-- Name: usuario; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.usuario (
    id integer NOT NULL,
    rol_id smallint,
    username character varying(50) NOT NULL,
    nombre_completo character varying(120) NOT NULL,
    email character varying(120),
    password_hash text NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    creado_en timestamp with time zone DEFAULT now() NOT NULL,
    rol_solicitado_id smallint,
    estado character varying(10) DEFAULT 'pendiente'::character varying NOT NULL,
    aprobado_por integer,
    aprobado_en timestamp with time zone,
    CONSTRAINT usuario_estado_check CHECK (((estado)::text = ANY ((ARRAY['pendiente'::character varying, 'aprobado'::character varying, 'rechazado'::character varying, 'inactivo'::character varying])::text[])))
);


ALTER TABLE public.usuario OWNER TO postgres;

--
-- TOC entry 222 (class 1259 OID 16400)
-- Name: usuario_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.usuario ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.usuario_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 251 (class 1259 OID 16753)
-- Name: validacion_ml; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.validacion_ml (
    id integer NOT NULL,
    modelo_id integer NOT NULL,
    politica_id integer NOT NULL,
    pares integer NOT NULL,
    mae_orig numeric(12,6),
    rmse_orig numeric(12,6),
    sesgo_orig numeric(12,6),
    mae_ml numeric(12,6),
    rmse_ml numeric(12,6),
    sesgo_ml numeric(12,6),
    r2 numeric(12,6),
    mejora_rmse_pct numeric(7,2),
    hash_conjunto character(64),
    estado character varying(10) NOT NULL,
    evaluado_en timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT validacion_ml_estado_check CHECK (((estado)::text = ANY ((ARRAY['apto'::character varying, 'rechazado'::character varying, 'pendiente'::character varying])::text[])))
);


ALTER TABLE public.validacion_ml OWNER TO postgres;

--
-- TOC entry 250 (class 1259 OID 16752)
-- Name: validacion_ml_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.validacion_ml ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.validacion_ml_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 227 (class 1259 OID 16437)
-- Name: variable; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.variable (
    id smallint NOT NULL,
    codigo character varying(20) NOT NULL,
    nombre character varying(60) NOT NULL,
    unidad_id smallint NOT NULL
);


ALTER TABLE public.variable OWNER TO postgres;

--
-- TOC entry 226 (class 1259 OID 16436)
-- Name: variable_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.variable ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.variable_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 5328 (class 0 OID 16802)
-- Dependencies: 255
-- Data for Name: alerta; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.alerta (id, tipo, nodo_id, variable_id, regla, valor, unidad_id, calidad, periodo_ini, periodo_fin, modelo_id, generada_en, estado, atendida_por, atendida_en, observacion) FROM stdin;
\.


--
-- TOC entry 5330 (class 0 OID 16846)
-- Dependencies: 257
-- Data for Name: auditoria_evento; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.auditoria_evento (id, usuario_id, servicio, entidad, entidad_id, accion, motivo, datos_antes, datos_despues, modelo_id, politica_id, creado_en) FROM stdin;
\.


--
-- TOC entry 5326 (class 0 OID 16777)
-- Dependencies: 253
-- Data for Name: lectura_corregida; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.lectura_corregida (id, lectura_id, modelo_id, valor_corregido, estado, calculado_en) FROM stdin;
\.


--
-- TOC entry 5317 (class 0 OID 16645)
-- Dependencies: 244
-- Data for Name: lectura_cuarentena; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.lectura_cuarentena (id, payload, causa, recibido_en) FROM stdin;
\.


--
-- TOC entry 5315 (class 0 OID 16614)
-- Dependencies: 242
-- Data for Name: lectura_original; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.lectura_original (id, sensor_id, variable_id, unidad_id, id_muestra, valor, medido_en, recibido_en, calidad) FROM stdin;
\.


--
-- TOC entry 5309 (class 0 OID 16543)
-- Dependencies: 236
-- Data for Name: mantenimiento; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.mantenimiento (id, nodo_id, sensor_id, tipo, descripcion, realizado_en, registrado_por) FROM stdin;
\.


--
-- TOC entry 5322 (class 0 OID 16719)
-- Dependencies: 249
-- Data for Name: modelo_ml; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.modelo_ml (id, sensor_id, variable_id, politica_id, version, algoritmo, parametros, artefacto_ruta, hash_artefacto, dominio_min, dominio_max, estado, entrenado_en, activado_en) FROM stdin;
\.


--
-- TOC entry 5304 (class 0 OID 16471)
-- Dependencies: 231
-- Data for Name: nodo; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.nodo (id, codigo, sitio_id, estado, intervalo_muestreo_s, credencial_hash, instalado_en, ultima_recepcion) FROM stdin;
\.


--
-- TOC entry 5319 (class 0 OID 16658)
-- Dependencies: 246
-- Data for Name: politica_ml; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.politica_ml (id, version, referencia_fuente_id, agregado_min, completitud_min_pct, colocacion_dias, pares_minimos, test_pct, mejora_rmse_min_pct, sin_datos_seg, vigente_desde, vigente_hasta, motivo, creado_por) FROM stdin;
\.


--
-- TOC entry 5320 (class 0 OID 16698)
-- Dependencies: 247
-- Data for Name: politica_variable; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.politica_variable (politica_id, variable_id, rango_min, rango_max, umbral_alerta) FROM stdin;
\.


--
-- TOC entry 5311 (class 0 OID 16573)
-- Dependencies: 238
-- Data for Name: referencia_fuente; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.referencia_fuente (id, nombre, sitio_id, calibracion_ref) FROM stdin;
\.


--
-- TOC entry 5313 (class 0 OID 16590)
-- Dependencies: 240
-- Data for Name: referencia_lectura; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.referencia_lectura (id, fuente_id, variable_id, unidad_id, medido_en, valor) FROM stdin;
\.


--
-- TOC entry 5294 (class 0 OID 16390)
-- Dependencies: 221
-- Data for Name: rol; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.rol (id, nombre) FROM stdin;
1	Administrador
2	Visualizador
\.


--
-- TOC entry 5306 (class 0 OID 16495)
-- Dependencies: 233
-- Data for Name: sensor; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.sensor (id, nodo_id, codigo, modelo, numero_serie, origen, activo, alta_en, baja_en, reemplaza_a) FROM stdin;
\.


--
-- TOC entry 5307 (class 0 OID 16525)
-- Dependencies: 234
-- Data for Name: sensor_variable; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.sensor_variable (sensor_id, variable_id) FROM stdin;
\.


--
-- TOC entry 5302 (class 0 OID 16456)
-- Dependencies: 229
-- Data for Name: sitio; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.sitio (id, codigo, nombre, latitud, longitud) FROM stdin;
\.


--
-- TOC entry 5298 (class 0 OID 16427)
-- Dependencies: 225
-- Data for Name: unidad; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.unidad (id, simbolo) FROM stdin;
\.


--
-- TOC entry 5296 (class 0 OID 16401)
-- Dependencies: 223
-- Data for Name: usuario; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.usuario (id, rol_id, username, nombre_completo, email, password_hash, activo, creado_en, rol_solicitado_id, estado, aprobado_por, aprobado_en) FROM stdin;
1	1	admin	Administrador Base	admin@scca.local	$2a$10$7U.2Ih0YAUEniYtJvTcQpegSyAWy6dfrUEtkSzQW/bT.xMRyWiSim	t	2026-10-28 12:04:20.087341-04	1	aprobado	\N	2026-10-28 12:04:20.087341-04
\.


--
-- TOC entry 5324 (class 0 OID 16753)
-- Dependencies: 251
-- Data for Name: validacion_ml; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.validacion_ml (id, modelo_id, politica_id, pares, mae_orig, rmse_orig, sesgo_orig, mae_ml, rmse_ml, sesgo_ml, r2, mejora_rmse_pct, hash_conjunto, estado, evaluado_en) FROM stdin;
\.


--
-- TOC entry 5300 (class 0 OID 16437)
-- Dependencies: 227
-- Data for Name: variable; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.variable (id, codigo, nombre, unidad_id) FROM stdin;
\.


--
-- TOC entry 5376 (class 0 OID 0)
-- Dependencies: 254
-- Name: alerta_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.alerta_id_seq', 1, false);


--
-- TOC entry 5377 (class 0 OID 0)
-- Dependencies: 256
-- Name: auditoria_evento_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.auditoria_evento_id_seq', 1, false);


--
-- TOC entry 5378 (class 0 OID 0)
-- Dependencies: 252
-- Name: lectura_corregida_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.lectura_corregida_id_seq', 1, false);


--
-- TOC entry 5379 (class 0 OID 0)
-- Dependencies: 243
-- Name: lectura_cuarentena_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.lectura_cuarentena_id_seq', 1, false);


--
-- TOC entry 5380 (class 0 OID 0)
-- Dependencies: 241
-- Name: lectura_original_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.lectura_original_id_seq', 1, false);


--
-- TOC entry 5381 (class 0 OID 0)
-- Dependencies: 235
-- Name: mantenimiento_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.mantenimiento_id_seq', 1, false);


--
-- TOC entry 5382 (class 0 OID 0)
-- Dependencies: 248
-- Name: modelo_ml_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.modelo_ml_id_seq', 1, false);


--
-- TOC entry 5383 (class 0 OID 0)
-- Dependencies: 230
-- Name: nodo_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.nodo_id_seq', 1, false);


--
-- TOC entry 5384 (class 0 OID 0)
-- Dependencies: 245
-- Name: politica_ml_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.politica_ml_id_seq', 1, false);


--
-- TOC entry 5385 (class 0 OID 0)
-- Dependencies: 237
-- Name: referencia_fuente_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.referencia_fuente_id_seq', 1, false);


--
-- TOC entry 5386 (class 0 OID 0)
-- Dependencies: 239
-- Name: referencia_lectura_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.referencia_lectura_id_seq', 1, false);


--
-- TOC entry 5387 (class 0 OID 0)
-- Dependencies: 220
-- Name: rol_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.rol_id_seq', 2, true);


--
-- TOC entry 5388 (class 0 OID 0)
-- Dependencies: 232
-- Name: sensor_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.sensor_id_seq', 1, false);


--
-- TOC entry 5389 (class 0 OID 0)
-- Dependencies: 228
-- Name: sitio_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.sitio_id_seq', 1, false);


--
-- TOC entry 5390 (class 0 OID 0)
-- Dependencies: 224
-- Name: unidad_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.unidad_id_seq', 1, false);


--
-- TOC entry 5391 (class 0 OID 0)
-- Dependencies: 222
-- Name: usuario_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.usuario_id_seq', 1, true);


--
-- TOC entry 5392 (class 0 OID 0)
-- Dependencies: 250
-- Name: validacion_ml_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.validacion_ml_id_seq', 1, false);


--
-- TOC entry 5393 (class 0 OID 0)
-- Dependencies: 226
-- Name: variable_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.variable_id_seq', 1, false);


--
-- TOC entry 5105 (class 2606 OID 16818)
-- Name: alerta alerta_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.alerta
    ADD CONSTRAINT alerta_pkey PRIMARY KEY (id);


--
-- TOC entry 5107 (class 2606 OID 16859)
-- Name: auditoria_evento auditoria_evento_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.auditoria_evento
    ADD CONSTRAINT auditoria_evento_pkey PRIMARY KEY (id);


--
-- TOC entry 5101 (class 2606 OID 16790)
-- Name: lectura_corregida lectura_corregida_lectura_id_modelo_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lectura_corregida
    ADD CONSTRAINT lectura_corregida_lectura_id_modelo_id_key UNIQUE (lectura_id, modelo_id);


--
-- TOC entry 5103 (class 2606 OID 16788)
-- Name: lectura_corregida lectura_corregida_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lectura_corregida
    ADD CONSTRAINT lectura_corregida_pkey PRIMARY KEY (id);


--
-- TOC entry 5086 (class 2606 OID 16656)
-- Name: lectura_cuarentena lectura_cuarentena_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lectura_cuarentena
    ADD CONSTRAINT lectura_cuarentena_pkey PRIMARY KEY (id);


--
-- TOC entry 5082 (class 2606 OID 16630)
-- Name: lectura_original lectura_original_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lectura_original
    ADD CONSTRAINT lectura_original_pkey PRIMARY KEY (id);


--
-- TOC entry 5084 (class 2606 OID 16632)
-- Name: lectura_original lectura_original_sensor_id_variable_id_id_muestra_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lectura_original
    ADD CONSTRAINT lectura_original_sensor_id_variable_id_id_muestra_key UNIQUE (sensor_id, variable_id, id_muestra);


--
-- TOC entry 5071 (class 2606 OID 16556)
-- Name: mantenimiento mantenimiento_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mantenimiento
    ADD CONSTRAINT mantenimiento_pkey PRIMARY KEY (id);


--
-- TOC entry 5094 (class 2606 OID 16738)
-- Name: modelo_ml modelo_ml_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.modelo_ml
    ADD CONSTRAINT modelo_ml_pkey PRIMARY KEY (id);


--
-- TOC entry 5096 (class 2606 OID 16740)
-- Name: modelo_ml modelo_ml_sensor_id_variable_id_version_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.modelo_ml
    ADD CONSTRAINT modelo_ml_sensor_id_variable_id_version_key UNIQUE (sensor_id, variable_id, version);


--
-- TOC entry 5059 (class 2606 OID 16488)
-- Name: nodo nodo_codigo_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.nodo
    ADD CONSTRAINT nodo_codigo_key UNIQUE (codigo);


--
-- TOC entry 5061 (class 2606 OID 16486)
-- Name: nodo nodo_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.nodo
    ADD CONSTRAINT nodo_pkey PRIMARY KEY (id);


--
-- TOC entry 5088 (class 2606 OID 16685)
-- Name: politica_ml politica_ml_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.politica_ml
    ADD CONSTRAINT politica_ml_pkey PRIMARY KEY (id);


--
-- TOC entry 5090 (class 2606 OID 16687)
-- Name: politica_ml politica_ml_version_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.politica_ml
    ADD CONSTRAINT politica_ml_version_key UNIQUE (version);


--
-- TOC entry 5092 (class 2606 OID 16707)
-- Name: politica_variable politica_variable_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.politica_variable
    ADD CONSTRAINT politica_variable_pkey PRIMARY KEY (politica_id, variable_id);


--
-- TOC entry 5073 (class 2606 OID 16583)
-- Name: referencia_fuente referencia_fuente_nombre_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.referencia_fuente
    ADD CONSTRAINT referencia_fuente_nombre_key UNIQUE (nombre);


--
-- TOC entry 5075 (class 2606 OID 16581)
-- Name: referencia_fuente referencia_fuente_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.referencia_fuente
    ADD CONSTRAINT referencia_fuente_pkey PRIMARY KEY (id);


--
-- TOC entry 5077 (class 2606 OID 16602)
-- Name: referencia_lectura referencia_lectura_fuente_id_variable_id_medido_en_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.referencia_lectura
    ADD CONSTRAINT referencia_lectura_fuente_id_variable_id_medido_en_key UNIQUE (fuente_id, variable_id, medido_en);


--
-- TOC entry 5079 (class 2606 OID 16600)
-- Name: referencia_lectura referencia_lectura_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.referencia_lectura
    ADD CONSTRAINT referencia_lectura_pkey PRIMARY KEY (id);


--
-- TOC entry 5035 (class 2606 OID 16399)
-- Name: rol rol_nombre_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rol
    ADD CONSTRAINT rol_nombre_key UNIQUE (nombre);


--
-- TOC entry 5037 (class 2606 OID 16397)
-- Name: rol rol_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rol
    ADD CONSTRAINT rol_pkey PRIMARY KEY (id);


--
-- TOC entry 5063 (class 2606 OID 16512)
-- Name: sensor sensor_codigo_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sensor
    ADD CONSTRAINT sensor_codigo_key UNIQUE (codigo);


--
-- TOC entry 5065 (class 2606 OID 16514)
-- Name: sensor sensor_modelo_numero_serie_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sensor
    ADD CONSTRAINT sensor_modelo_numero_serie_key UNIQUE (modelo, numero_serie);


--
-- TOC entry 5067 (class 2606 OID 16510)
-- Name: sensor sensor_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sensor
    ADD CONSTRAINT sensor_pkey PRIMARY KEY (id);


--
-- TOC entry 5069 (class 2606 OID 16531)
-- Name: sensor_variable sensor_variable_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sensor_variable
    ADD CONSTRAINT sensor_variable_pkey PRIMARY KEY (sensor_id, variable_id);


--
-- TOC entry 5055 (class 2606 OID 16469)
-- Name: sitio sitio_codigo_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sitio
    ADD CONSTRAINT sitio_codigo_key UNIQUE (codigo);


--
-- TOC entry 5057 (class 2606 OID 16467)
-- Name: sitio sitio_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sitio
    ADD CONSTRAINT sitio_pkey PRIMARY KEY (id);


--
-- TOC entry 5045 (class 2606 OID 16433)
-- Name: unidad unidad_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.unidad
    ADD CONSTRAINT unidad_pkey PRIMARY KEY (id);


--
-- TOC entry 5047 (class 2606 OID 16435)
-- Name: unidad unidad_simbolo_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.unidad
    ADD CONSTRAINT unidad_simbolo_key UNIQUE (simbolo);


--
-- TOC entry 5039 (class 2606 OID 16420)
-- Name: usuario usuario_email_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.usuario
    ADD CONSTRAINT usuario_email_key UNIQUE (email);


--
-- TOC entry 5041 (class 2606 OID 16416)
-- Name: usuario usuario_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.usuario
    ADD CONSTRAINT usuario_pkey PRIMARY KEY (id);


--
-- TOC entry 5043 (class 2606 OID 16418)
-- Name: usuario usuario_username_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.usuario
    ADD CONSTRAINT usuario_username_key UNIQUE (username);


--
-- TOC entry 5099 (class 2606 OID 16765)
-- Name: validacion_ml validacion_ml_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.validacion_ml
    ADD CONSTRAINT validacion_ml_pkey PRIMARY KEY (id);


--
-- TOC entry 5049 (class 2606 OID 16447)
-- Name: variable variable_codigo_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.variable
    ADD CONSTRAINT variable_codigo_key UNIQUE (codigo);


--
-- TOC entry 5051 (class 2606 OID 16449)
-- Name: variable variable_id_unidad_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.variable
    ADD CONSTRAINT variable_id_unidad_id_key UNIQUE (id, unidad_id);


--
-- TOC entry 5053 (class 2606 OID 16445)
-- Name: variable variable_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.variable
    ADD CONSTRAINT variable_pkey PRIMARY KEY (id);


--
-- TOC entry 5080 (class 1259 OID 16643)
-- Name: ix_lectura_serie; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_lectura_serie ON public.lectura_original USING btree (sensor_id, variable_id, medido_en DESC);


--
-- TOC entry 5097 (class 1259 OID 16751)
-- Name: ux_modelo_activo; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX ux_modelo_activo ON public.modelo_ml USING btree (sensor_id, variable_id) WHERE ((estado)::text = 'activo'::text);


--
-- TOC entry 5145 (class 2620 OID 16876)
-- Name: auditoria_evento tg_auditoria_ro; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER tg_auditoria_ro BEFORE DELETE OR UPDATE ON public.auditoria_evento FOR EACH ROW EXECUTE FUNCTION public.bloquear_modificacion();


--
-- TOC entry 5144 (class 2620 OID 16877)
-- Name: lectura_original tg_lectura_ro; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER tg_lectura_ro BEFORE DELETE OR UPDATE ON public.lectura_original FOR EACH ROW EXECUTE FUNCTION public.bloquear_modificacion();


--
-- TOC entry 5143 (class 2620 OID 16879)
-- Name: sensor tg_sensor_baja; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER tg_sensor_baja BEFORE UPDATE OF activo ON public.sensor FOR EACH ROW EXECUTE FUNCTION public.retirar_modelos_sensor();


--
-- TOC entry 5135 (class 2606 OID 16839)
-- Name: alerta alerta_atendida_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.alerta
    ADD CONSTRAINT alerta_atendida_por_fkey FOREIGN KEY (atendida_por) REFERENCES public.usuario(id);


--
-- TOC entry 5136 (class 2606 OID 16834)
-- Name: alerta alerta_modelo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.alerta
    ADD CONSTRAINT alerta_modelo_id_fkey FOREIGN KEY (modelo_id) REFERENCES public.modelo_ml(id);


--
-- TOC entry 5137 (class 2606 OID 16819)
-- Name: alerta alerta_nodo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.alerta
    ADD CONSTRAINT alerta_nodo_id_fkey FOREIGN KEY (nodo_id) REFERENCES public.nodo(id);


--
-- TOC entry 5138 (class 2606 OID 16829)
-- Name: alerta alerta_unidad_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.alerta
    ADD CONSTRAINT alerta_unidad_id_fkey FOREIGN KEY (unidad_id) REFERENCES public.unidad(id);


--
-- TOC entry 5139 (class 2606 OID 16824)
-- Name: alerta alerta_variable_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.alerta
    ADD CONSTRAINT alerta_variable_id_fkey FOREIGN KEY (variable_id) REFERENCES public.variable(id);


--
-- TOC entry 5140 (class 2606 OID 16865)
-- Name: auditoria_evento auditoria_evento_modelo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.auditoria_evento
    ADD CONSTRAINT auditoria_evento_modelo_id_fkey FOREIGN KEY (modelo_id) REFERENCES public.modelo_ml(id);


--
-- TOC entry 5141 (class 2606 OID 16870)
-- Name: auditoria_evento auditoria_evento_politica_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.auditoria_evento
    ADD CONSTRAINT auditoria_evento_politica_id_fkey FOREIGN KEY (politica_id) REFERENCES public.politica_ml(id);


--
-- TOC entry 5142 (class 2606 OID 16860)
-- Name: auditoria_evento auditoria_evento_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.auditoria_evento
    ADD CONSTRAINT auditoria_evento_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuario(id);


--
-- TOC entry 5133 (class 2606 OID 16791)
-- Name: lectura_corregida lectura_corregida_lectura_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lectura_corregida
    ADD CONSTRAINT lectura_corregida_lectura_id_fkey FOREIGN KEY (lectura_id) REFERENCES public.lectura_original(id);


--
-- TOC entry 5134 (class 2606 OID 16796)
-- Name: lectura_corregida lectura_corregida_modelo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lectura_corregida
    ADD CONSTRAINT lectura_corregida_modelo_id_fkey FOREIGN KEY (modelo_id) REFERENCES public.modelo_ml(id);


--
-- TOC entry 5123 (class 2606 OID 16633)
-- Name: lectura_original lectura_original_sensor_id_variable_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lectura_original
    ADD CONSTRAINT lectura_original_sensor_id_variable_id_fkey FOREIGN KEY (sensor_id, variable_id) REFERENCES public.sensor_variable(sensor_id, variable_id);


--
-- TOC entry 5124 (class 2606 OID 16638)
-- Name: lectura_original lectura_original_variable_id_unidad_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lectura_original
    ADD CONSTRAINT lectura_original_variable_id_unidad_id_fkey FOREIGN KEY (variable_id, unidad_id) REFERENCES public.variable(id, unidad_id);


--
-- TOC entry 5117 (class 2606 OID 16557)
-- Name: mantenimiento mantenimiento_nodo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mantenimiento
    ADD CONSTRAINT mantenimiento_nodo_id_fkey FOREIGN KEY (nodo_id) REFERENCES public.nodo(id);


--
-- TOC entry 5118 (class 2606 OID 16567)
-- Name: mantenimiento mantenimiento_registrado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mantenimiento
    ADD CONSTRAINT mantenimiento_registrado_por_fkey FOREIGN KEY (registrado_por) REFERENCES public.usuario(id);


--
-- TOC entry 5119 (class 2606 OID 16562)
-- Name: mantenimiento mantenimiento_sensor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mantenimiento
    ADD CONSTRAINT mantenimiento_sensor_id_fkey FOREIGN KEY (sensor_id) REFERENCES public.sensor(id);


--
-- TOC entry 5129 (class 2606 OID 16741)
-- Name: modelo_ml modelo_ml_politica_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.modelo_ml
    ADD CONSTRAINT modelo_ml_politica_id_fkey FOREIGN KEY (politica_id) REFERENCES public.politica_ml(id);


--
-- TOC entry 5130 (class 2606 OID 16746)
-- Name: modelo_ml modelo_ml_sensor_id_variable_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.modelo_ml
    ADD CONSTRAINT modelo_ml_sensor_id_variable_id_fkey FOREIGN KEY (sensor_id, variable_id) REFERENCES public.sensor_variable(sensor_id, variable_id);


--
-- TOC entry 5112 (class 2606 OID 16489)
-- Name: nodo nodo_sitio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.nodo
    ADD CONSTRAINT nodo_sitio_id_fkey FOREIGN KEY (sitio_id) REFERENCES public.sitio(id);


--
-- TOC entry 5125 (class 2606 OID 16693)
-- Name: politica_ml politica_ml_creado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.politica_ml
    ADD CONSTRAINT politica_ml_creado_por_fkey FOREIGN KEY (creado_por) REFERENCES public.usuario(id);


--
-- TOC entry 5126 (class 2606 OID 16688)
-- Name: politica_ml politica_ml_referencia_fuente_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.politica_ml
    ADD CONSTRAINT politica_ml_referencia_fuente_id_fkey FOREIGN KEY (referencia_fuente_id) REFERENCES public.referencia_fuente(id);


--
-- TOC entry 5127 (class 2606 OID 16708)
-- Name: politica_variable politica_variable_politica_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.politica_variable
    ADD CONSTRAINT politica_variable_politica_id_fkey FOREIGN KEY (politica_id) REFERENCES public.politica_ml(id);


--
-- TOC entry 5128 (class 2606 OID 16713)
-- Name: politica_variable politica_variable_variable_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.politica_variable
    ADD CONSTRAINT politica_variable_variable_id_fkey FOREIGN KEY (variable_id) REFERENCES public.variable(id);


--
-- TOC entry 5120 (class 2606 OID 16584)
-- Name: referencia_fuente referencia_fuente_sitio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.referencia_fuente
    ADD CONSTRAINT referencia_fuente_sitio_id_fkey FOREIGN KEY (sitio_id) REFERENCES public.sitio(id);


--
-- TOC entry 5121 (class 2606 OID 16603)
-- Name: referencia_lectura referencia_lectura_fuente_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.referencia_lectura
    ADD CONSTRAINT referencia_lectura_fuente_id_fkey FOREIGN KEY (fuente_id) REFERENCES public.referencia_fuente(id);


--
-- TOC entry 5122 (class 2606 OID 16608)
-- Name: referencia_lectura referencia_lectura_variable_id_unidad_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.referencia_lectura
    ADD CONSTRAINT referencia_lectura_variable_id_unidad_id_fkey FOREIGN KEY (variable_id, unidad_id) REFERENCES public.variable(id, unidad_id);


--
-- TOC entry 5113 (class 2606 OID 16515)
-- Name: sensor sensor_nodo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sensor
    ADD CONSTRAINT sensor_nodo_id_fkey FOREIGN KEY (nodo_id) REFERENCES public.nodo(id);


--
-- TOC entry 5114 (class 2606 OID 16520)
-- Name: sensor sensor_reemplaza_a_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sensor
    ADD CONSTRAINT sensor_reemplaza_a_fkey FOREIGN KEY (reemplaza_a) REFERENCES public.sensor(id);


--
-- TOC entry 5115 (class 2606 OID 16532)
-- Name: sensor_variable sensor_variable_sensor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sensor_variable
    ADD CONSTRAINT sensor_variable_sensor_id_fkey FOREIGN KEY (sensor_id) REFERENCES public.sensor(id);


--
-- TOC entry 5116 (class 2606 OID 16537)
-- Name: sensor_variable sensor_variable_variable_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sensor_variable
    ADD CONSTRAINT sensor_variable_variable_id_fkey FOREIGN KEY (variable_id) REFERENCES public.variable(id);


--
-- TOC entry 5108 (class 2606 OID 16927)
-- Name: usuario usuario_aprobado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.usuario
    ADD CONSTRAINT usuario_aprobado_por_fkey FOREIGN KEY (aprobado_por) REFERENCES public.usuario(id);


--
-- TOC entry 5109 (class 2606 OID 16421)
-- Name: usuario usuario_rol_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.usuario
    ADD CONSTRAINT usuario_rol_id_fkey FOREIGN KEY (rol_id) REFERENCES public.rol(id);


--
-- TOC entry 5110 (class 2606 OID 16921)
-- Name: usuario usuario_rol_solicitado_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.usuario
    ADD CONSTRAINT usuario_rol_solicitado_id_fkey FOREIGN KEY (rol_solicitado_id) REFERENCES public.rol(id);


--
-- TOC entry 5131 (class 2606 OID 16766)
-- Name: validacion_ml validacion_ml_modelo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.validacion_ml
    ADD CONSTRAINT validacion_ml_modelo_id_fkey FOREIGN KEY (modelo_id) REFERENCES public.modelo_ml(id);


--
-- TOC entry 5132 (class 2606 OID 16771)
-- Name: validacion_ml validacion_ml_politica_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.validacion_ml
    ADD CONSTRAINT validacion_ml_politica_id_fkey FOREIGN KEY (politica_id) REFERENCES public.politica_ml(id);


--
-- TOC entry 5111 (class 2606 OID 16450)
-- Name: variable variable_unidad_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.variable
    ADD CONSTRAINT variable_unidad_id_fkey FOREIGN KEY (unidad_id) REFERENCES public.unidad(id);


--
-- TOC entry 5336 (class 0 OID 0)
-- Dependencies: 6
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: pg_database_owner
--

GRANT USAGE ON SCHEMA public TO app_api;


--
-- TOC entry 5338 (class 0 OID 0)
-- Dependencies: 255
-- Name: TABLE alerta; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.alerta TO app_api;


--
-- TOC entry 5339 (class 0 OID 0)
-- Dependencies: 254
-- Name: SEQUENCE alerta_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT USAGE ON SEQUENCE public.alerta_id_seq TO app_api;


--
-- TOC entry 5340 (class 0 OID 0)
-- Dependencies: 257
-- Name: TABLE auditoria_evento; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT ON TABLE public.auditoria_evento TO app_api;


--
-- TOC entry 5341 (class 0 OID 0)
-- Dependencies: 256
-- Name: SEQUENCE auditoria_evento_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT USAGE ON SEQUENCE public.auditoria_evento_id_seq TO app_api;


--
-- TOC entry 5342 (class 0 OID 0)
-- Dependencies: 253
-- Name: TABLE lectura_corregida; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.lectura_corregida TO app_api;


--
-- TOC entry 5343 (class 0 OID 0)
-- Dependencies: 252
-- Name: SEQUENCE lectura_corregida_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT USAGE ON SEQUENCE public.lectura_corregida_id_seq TO app_api;


--
-- TOC entry 5344 (class 0 OID 0)
-- Dependencies: 244
-- Name: TABLE lectura_cuarentena; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.lectura_cuarentena TO app_api;


--
-- TOC entry 5345 (class 0 OID 0)
-- Dependencies: 243
-- Name: SEQUENCE lectura_cuarentena_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT USAGE ON SEQUENCE public.lectura_cuarentena_id_seq TO app_api;


--
-- TOC entry 5346 (class 0 OID 0)
-- Dependencies: 242
-- Name: TABLE lectura_original; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT ON TABLE public.lectura_original TO app_api;


--
-- TOC entry 5347 (class 0 OID 0)
-- Dependencies: 241
-- Name: SEQUENCE lectura_original_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT USAGE ON SEQUENCE public.lectura_original_id_seq TO app_api;


--
-- TOC entry 5348 (class 0 OID 0)
-- Dependencies: 236
-- Name: TABLE mantenimiento; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.mantenimiento TO app_api;


--
-- TOC entry 5349 (class 0 OID 0)
-- Dependencies: 235
-- Name: SEQUENCE mantenimiento_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT USAGE ON SEQUENCE public.mantenimiento_id_seq TO app_api;


--
-- TOC entry 5350 (class 0 OID 0)
-- Dependencies: 249
-- Name: TABLE modelo_ml; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.modelo_ml TO app_api;


--
-- TOC entry 5351 (class 0 OID 0)
-- Dependencies: 248
-- Name: SEQUENCE modelo_ml_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT USAGE ON SEQUENCE public.modelo_ml_id_seq TO app_api;


--
-- TOC entry 5352 (class 0 OID 0)
-- Dependencies: 231
-- Name: TABLE nodo; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.nodo TO app_api;


--
-- TOC entry 5353 (class 0 OID 0)
-- Dependencies: 230
-- Name: SEQUENCE nodo_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT USAGE ON SEQUENCE public.nodo_id_seq TO app_api;


--
-- TOC entry 5354 (class 0 OID 0)
-- Dependencies: 246
-- Name: TABLE politica_ml; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.politica_ml TO app_api;


--
-- TOC entry 5355 (class 0 OID 0)
-- Dependencies: 245
-- Name: SEQUENCE politica_ml_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT USAGE ON SEQUENCE public.politica_ml_id_seq TO app_api;


--
-- TOC entry 5356 (class 0 OID 0)
-- Dependencies: 247
-- Name: TABLE politica_variable; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.politica_variable TO app_api;


--
-- TOC entry 5357 (class 0 OID 0)
-- Dependencies: 238
-- Name: TABLE referencia_fuente; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.referencia_fuente TO app_api;


--
-- TOC entry 5358 (class 0 OID 0)
-- Dependencies: 237
-- Name: SEQUENCE referencia_fuente_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT USAGE ON SEQUENCE public.referencia_fuente_id_seq TO app_api;


--
-- TOC entry 5359 (class 0 OID 0)
-- Dependencies: 240
-- Name: TABLE referencia_lectura; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.referencia_lectura TO app_api;


--
-- TOC entry 5360 (class 0 OID 0)
-- Dependencies: 239
-- Name: SEQUENCE referencia_lectura_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT USAGE ON SEQUENCE public.referencia_lectura_id_seq TO app_api;


--
-- TOC entry 5361 (class 0 OID 0)
-- Dependencies: 221
-- Name: TABLE rol; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.rol TO app_api;


--
-- TOC entry 5362 (class 0 OID 0)
-- Dependencies: 220
-- Name: SEQUENCE rol_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT USAGE ON SEQUENCE public.rol_id_seq TO app_api;


--
-- TOC entry 5363 (class 0 OID 0)
-- Dependencies: 233
-- Name: TABLE sensor; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.sensor TO app_api;


--
-- TOC entry 5364 (class 0 OID 0)
-- Dependencies: 232
-- Name: SEQUENCE sensor_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT USAGE ON SEQUENCE public.sensor_id_seq TO app_api;


--
-- TOC entry 5365 (class 0 OID 0)
-- Dependencies: 234
-- Name: TABLE sensor_variable; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.sensor_variable TO app_api;


--
-- TOC entry 5366 (class 0 OID 0)
-- Dependencies: 229
-- Name: TABLE sitio; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.sitio TO app_api;


--
-- TOC entry 5367 (class 0 OID 0)
-- Dependencies: 228
-- Name: SEQUENCE sitio_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT USAGE ON SEQUENCE public.sitio_id_seq TO app_api;


--
-- TOC entry 5368 (class 0 OID 0)
-- Dependencies: 225
-- Name: TABLE unidad; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.unidad TO app_api;


--
-- TOC entry 5369 (class 0 OID 0)
-- Dependencies: 224
-- Name: SEQUENCE unidad_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT USAGE ON SEQUENCE public.unidad_id_seq TO app_api;


--
-- TOC entry 5370 (class 0 OID 0)
-- Dependencies: 223
-- Name: TABLE usuario; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.usuario TO app_api;


--
-- TOC entry 5371 (class 0 OID 0)
-- Dependencies: 222
-- Name: SEQUENCE usuario_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT USAGE ON SEQUENCE public.usuario_id_seq TO app_api;


--
-- TOC entry 5372 (class 0 OID 0)
-- Dependencies: 251
-- Name: TABLE validacion_ml; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.validacion_ml TO app_api;


--
-- TOC entry 5373 (class 0 OID 0)
-- Dependencies: 250
-- Name: SEQUENCE validacion_ml_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT USAGE ON SEQUENCE public.validacion_ml_id_seq TO app_api;


--
-- TOC entry 5374 (class 0 OID 0)
-- Dependencies: 227
-- Name: TABLE variable; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.variable TO app_api;


--
-- TOC entry 5375 (class 0 OID 0)
-- Dependencies: 226
-- Name: SEQUENCE variable_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT USAGE ON SEQUENCE public.variable_id_seq TO app_api;


-- Completed on 2026-10-28 20:02:38

--
-- PostgreSQL database dump complete
--

\unrestrict DeHq8T9GqyznKeExcC4TSdxbqf1laNXZc3bA4Nn15bR1wzxGIue7pKrfvoop3va

