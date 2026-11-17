BEGIN;

ALTER TABLE public.usuario
    ADD COLUMN IF NOT EXISTS admin_principal boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS administrador_desde timestamptz;

-- Conservar la fecha de aprobación de los administradores existentes.
UPDATE public.usuario u
SET administrador_desde = COALESCE(u.aprobado_en, CURRENT_TIMESTAMP)
FROM public.rol r
WHERE r.id = u.rol_id AND r.nombre = 'Administrador'
  AND u.estado IN ('aprobado', 'inactivo') AND u.administrador_desde IS NULL;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.usuario WHERE admin_principal) THEN
        UPDATE public.usuario u SET admin_principal = true
        FROM public.rol r
        WHERE u.username = 'admin' AND r.id = u.rol_id
          AND r.nombre = 'Administrador' AND u.estado = 'aprobado' AND u.activo;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'No se encontró la cuenta admin activa. Verifica el administrador principal antes de aplicar esta migración.';
        END IF;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS usuario_unico_admin_principal
ON public.usuario (admin_principal) WHERE admin_principal;

CREATE OR REPLACE FUNCTION public.proteger_jerarquia_admin()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    nuevo_admin boolean;
    anterior_admin boolean;
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.admin_principal THEN
            RAISE EXCEPTION 'No se puede eliminar al administrador principal.' USING ERRCODE = '23514';
        END IF;
        RETURN OLD;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF NEW.admin_principal IS DISTINCT FROM OLD.admin_principal THEN
            RAISE EXCEPTION 'No se puede cambiar el administrador principal desde la aplicación.' USING ERRCODE = '23514';
        END IF;
        IF OLD.admin_principal AND (
            NEW.rol_id IS DISTINCT FROM OLD.rol_id OR NOT NEW.activo OR NEW.estado <> 'aprobado'
        ) THEN
            RAISE EXCEPTION 'No se puede quitar el rol ni inhabilitar al administrador principal.' USING ERRCODE = '23514';
        END IF;
    ELSIF NEW.admin_principal THEN
        RAISE EXCEPTION 'El administrador principal ya está definido.' USING ERRCODE = '23514';
    END IF;

    SELECT EXISTS (SELECT 1 FROM public.rol WHERE id = NEW.rol_id AND nombre = 'Administrador')
        AND NEW.estado IN ('aprobado', 'inactivo') INTO nuevo_admin;
    IF nuevo_admin THEN
        IF TG_OP = 'UPDATE' THEN
            SELECT EXISTS (SELECT 1 FROM public.rol WHERE id = OLD.rol_id AND nombre = 'Administrador')
                AND OLD.estado IN ('aprobado', 'inactivo') INTO anterior_admin;
            IF anterior_admin AND OLD.administrador_desde IS NOT NULL THEN
                NEW.administrador_desde := OLD.administrador_desde;
                RETURN NEW;
            END IF;
        END IF;
        NEW.administrador_desde := clock_timestamp();
    ELSE
        NEW.administrador_desde := NULL;
    END IF;
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS usuario_proteger_jerarquia ON public.usuario;
CREATE TRIGGER usuario_proteger_jerarquia
BEFORE INSERT OR UPDATE OR DELETE ON public.usuario
FOR EACH ROW EXECUTE FUNCTION public.proteger_jerarquia_admin();

COMMIT;
