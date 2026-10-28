-- Migración de autenticación: solicitudes de registro + admin base
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Un usuario pendiente todavía no tiene rol asignado
ALTER TABLE usuario ALTER COLUMN rol_id DROP NOT NULL;

ALTER TABLE usuario
  ADD COLUMN rol_solicitado_id SMALLINT REFERENCES rol(id),
  ADD COLUMN estado VARCHAR(10) NOT NULL DEFAULT 'pendiente'
      CHECK (estado IN ('pendiente','aprobado','rechazado')),
  ADD COLUMN aprobado_por INT REFERENCES usuario(id),
  ADD COLUMN aprobado_en TIMESTAMPTZ;

-- Roles
INSERT INTO rol (nombre) VALUES ('Administrador'), ('Visualizador')
ON CONFLICT (nombre) DO NOTHING;

-- Admin base (usuario: admin / clave: Cambiar!)
INSERT INTO usuario (rol_id, rol_solicitado_id, username, nombre_completo, email,
                     password_hash, estado, aprobado_en)
SELECT r.id, r.id, 'admin', 'Administrador Base', 'admin@scca.local',
       crypt('Cambiar', gen_salt('bf', 10)), 'aprobado', now()
FROM rol r WHERE r.nombre = 'Administrador'
ON CONFLICT (username) DO NOTHING;