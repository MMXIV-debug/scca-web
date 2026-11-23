CREATE TABLE IF NOT EXISTS clima_consulta (
  id bigserial PRIMARY KEY,
  sitio_id integer NOT NULL REFERENCES sitio(id),
  latitud numeric(9,6) NOT NULL,
  longitud numeric(9,6) NOT NULL,
  proveedor text NOT NULL DEFAULT 'Open-Meteo',
  consultado_en timestamptz NOT NULL DEFAULT now(),
  respuesta jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS clima_consulta_sitio_fecha ON clima_consulta(sitio_id, consultado_en DESC, id DESC);

CREATE TABLE IF NOT EXISTS clima_dato (
  consulta_id bigint NOT NULL REFERENCES clima_consulta(id),
  tipo text NOT NULL CHECK (tipo IN ('actual', 'pronostico')),
  valido_en timestamptz NOT NULL,
  temperatura_c double precision NOT NULL,
  codigo_wmo integer NOT NULL,
  es_dia boolean NOT NULL,
  probabilidad_lluvia_pct double precision CHECK (probabilidad_lluvia_pct BETWEEN 0 AND 100),
  PRIMARY KEY (consulta_id, tipo, valido_en)
);
