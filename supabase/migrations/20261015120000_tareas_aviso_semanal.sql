-- BUILD 4C (local, no aplicar en producción sin autorización de despliegue).
-- Principal → aviso semanal de Tareas (lunes, jueves y sábado): estado del aviso por usuario + organización +
-- semana + momento. Excepción local a AGENTS.md (DB/RLS fuera de Lovable) autorizada en el brief de 4C solo para
-- esta persistencia mínima. Sin SECURITY DEFINER nuevo: tabla con RLS por usuario y organización del perfil,
-- usando los helpers existentes. No guarda tareas ni contenido del aviso: el contenido se calcula al abrirlo.
BEGIN;

CREATE TABLE public.tareas_aviso_semanal (
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- Lunes de la semana según organizations.timezone (lo calcula la app con la capa temporal canónica).
  semana date NOT NULL,
  momento text NOT NULL,
  estado text NOT NULL,
  pospuesto_hasta timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, organization_id, semana, momento),
  CONSTRAINT tareas_aviso_semanal_lunes CHECK (EXTRACT(ISODOW FROM semana) = 1),
  CONSTRAINT tareas_aviso_semanal_momento CHECK (momento IN ('lunes', 'jueves', 'sabado')),
  CONSTRAINT tareas_aviso_semanal_estado CHECK (estado IN ('listo', 'pospuesto')),
  CONSTRAINT tareas_aviso_semanal_pospuesto CHECK ((estado = 'pospuesto') = (pospuesto_hasta IS NOT NULL))
);
COMMENT ON TABLE public.tareas_aviso_semanal IS
  'BUILD 4C: si el usuario marcó Listo o pidió Más tarde en el aviso semanal de Tareas. Sin contenido de tareas.';

-- "Más tarde" dura 3 horas según el reloj del servidor, nunca el del dispositivo; también la marca de tiempo.
CREATE FUNCTION public.tareas_aviso_semanal_preparar()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  NEW.pospuesto_hasta := CASE WHEN NEW.estado = 'pospuesto' THEN clock_timestamp() + interval '3 hours' END;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END $$;
CREATE TRIGGER tareas_aviso_semanal_preparar BEFORE INSERT OR UPDATE ON public.tareas_aviso_semanal
  FOR EACH ROW EXECUTE FUNCTION public.tareas_aviso_semanal_preparar();
REVOKE ALL ON FUNCTION public.tareas_aviso_semanal_preparar() FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE public.tareas_aviso_semanal ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.tareas_aviso_semanal FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.tareas_aviso_semanal TO authenticated;

-- Solo la propia fila, en la organización del perfil. La cuenta de sucursal no recibe el aviso (dispositivo compartido).
CREATE POLICY tareas_aviso_semanal_leer ON public.tareas_aviso_semanal FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND organization_id = public.get_user_organization_id(auth.uid()));
CREATE POLICY tareas_aviso_semanal_crear ON public.tareas_aviso_semanal FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND organization_id = public.get_user_organization_id(auth.uid())
    AND NOT public.is_sucursal_account(auth.uid()));
CREATE POLICY tareas_aviso_semanal_actualizar ON public.tareas_aviso_semanal FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND organization_id = public.get_user_organization_id(auth.uid()))
  WITH CHECK (user_id = auth.uid() AND organization_id = public.get_user_organization_id(auth.uid())
    AND NOT public.is_sucursal_account(auth.uid()));

-- Postcondiciones: si el estado final no es el esperado, la migración entera se revierte.
DO $verificar$
BEGIN
  IF NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.tareas_aviso_semanal'::regclass) THEN
    RAISE EXCEPTION '4C: RLS desactivada en tareas_aviso_semanal';
  END IF;
  IF has_table_privilege('anon', 'public.tareas_aviso_semanal', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE') THEN
    RAISE EXCEPTION '4C: anon conserva privilegios sobre tareas_aviso_semanal';
  END IF;
  IF has_table_privilege('authenticated', 'public.tareas_aviso_semanal', 'DELETE, TRUNCATE') THEN
    RAISE EXCEPTION '4C: authenticated no debería poder borrar estados del aviso';
  END IF;
  IF has_function_privilege('authenticated', 'public.tareas_aviso_semanal_preparar()', 'EXECUTE')
    OR has_function_privilege('anon', 'public.tareas_aviso_semanal_preparar()', 'EXECUTE') THEN
    RAISE EXCEPTION '4C: la función del trigger quedó ejecutable por un rol de cliente';
  END IF;
  IF (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = 'public.tareas_aviso_semanal_preparar()'::regprocedure) THEN
    RAISE EXCEPTION '4C: la función del trigger no debe ser SECURITY DEFINER';
  END IF;
END
$verificar$;

COMMIT;
