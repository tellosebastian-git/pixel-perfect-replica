-- BUILD 4A (continuación): excepción SECURITY DEFINER autorizada para implementación local.
-- No aplicar en producción sin autorización de despliegue. Ningún DEFINER nuevo en public.
-- Principal → Tareas. No cambia el motor, crons ni funciones de notificaciones de Etapas 1–3.
BEGIN;
CREATE SCHEMA IF NOT EXISTS tareas_private;
REVOKE ALL ON SCHEMA tareas_private FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA tareas_private TO authenticated, service_role;

-- A column REVOKE does not override a table-level grant. Existing authenticated SELECT/UPDATE/
-- INSERT on barberos exposed the PIN digest and could bypass set-pin. Keep exactly the previously
-- available non-PIN columns (and existing RLS), removing only direct digest access. Server stays intact.
DO $$ DECLARE r text; p text; cols text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    FOREACH p IN ARRAY ARRAY['SELECT','INSERT','UPDATE'] LOOP
      SELECT string_agg(quote_ident(a.attname),',' ORDER BY a.attnum) INTO cols
        FROM pg_attribute a WHERE a.attrelid = 'public.barberos'::regclass AND a.attnum > 0
          AND NOT a.attisdropped AND a.attname <> 'pin_hash'
          AND has_column_privilege(r,'public.barberos',a.attname,p);
      EXECUTE format('REVOKE %s ON public.barberos FROM %I',p,r);
      EXECUTE format('REVOKE %s (pin_hash) ON public.barberos FROM %I',p,r);
      IF cols IS NOT NULL THEN EXECUTE format('GRANT %s (%s) ON public.barberos TO %I',p,cols,r); END IF;
      IF has_column_privilege(r,'public.barberos','pin_hash',p) THEN
        RAISE EXCEPTION '4A: permiso PIN heredado de otro rol; resolver antes de aplicar';
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- La comprobación viva de solo lectura previa encontró cero tareas/peticiones.
-- Se repite bajo bloqueo al aplicar: no se inventa sucursal ni se elimina información.
LOCK TABLE public.tareas IN SHARE ROW EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.tareas WHERE tipo = 'tarea' AND sucursal_id IS NULL) THEN
    RAISE EXCEPTION '4A: existen tareas sin sucursal; resolver sus datos antes de aplicar';
  END IF;
END $$;
ALTER TABLE public.tareas ADD CONSTRAINT tareas_sucursal_required CHECK (tipo <> 'tarea' OR sucursal_id IS NOT NULL);
ALTER TABLE public.tareas
  ADD COLUMN iniciada_por_id uuid REFERENCES auth.users(id),
  ADD COLUMN iniciada_por_nombre text,
  ADD COLUMN iniciada_at timestamptz,
  ADD COLUMN accion_version uuid NOT NULL DEFAULT gen_random_uuid();

CREATE TABLE tareas_private.completados (
  tarea_id uuid PRIMARY KEY REFERENCES public.tareas(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES auth.users(id),
  estado_anterior text NOT NULL CHECK (estado_anterior IN ('pendiente','en_progreso','vencida')),
  version uuid NOT NULL,
  vence_at timestamptz NOT NULL
);
-- Contador serializado por cuenta: errores se devuelven como JSON para conservar el rate limit.
CREATE TABLE tareas_private.pin_intentos (
  cuenta_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  intentos integer NOT NULL DEFAULT 0,
  ventana timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON ALL TABLES IN SCHEMA tareas_private FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION tareas_private.pertenece(p_org uuid, p_sucursal uuid, p_barbero uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.barberos b JOIN public.barberos_sucursales bs
      ON bs.barbero_id = b.id AND bs.organization_id = b.organization_id
    WHERE b.id = p_barbero AND b.organization_id = p_org AND b.activo
      AND bs.sucursal_id = p_sucursal
      AND (bs.tipo IN ('principal','recurrente') OR (bs.tipo = 'temporal'
        AND (bs.fecha_inicio IS NULL OR bs.fecha_inicio <= public._tareas_auto_hoy(p_org))
        AND bs.fecha_fin >= public._tareas_auto_hoy(p_org)))
  )
$$;

CREATE FUNCTION tareas_private.permitido(p_actor uuid, p_org uuid, p_sucursal uuid, p_asignado uuid, p_equipo boolean, p_admin boolean)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = p_actor AND p.organization_id = p_org
      AND NOT public.is_sucursal_account(p_actor)
      AND EXISTS (SELECT 1 FROM public.sucursales s WHERE s.id = p_sucursal AND s.organization_id = p_org)
      AND (
        public.has_role(p_actor, 'owner') OR public.has_role(p_actor, 'general_manager')
        OR (public.has_role(p_actor, 'manager') AND EXISTS (
          SELECT 1 FROM public.user_sucursales us WHERE us.user_id = p_actor
            AND us.organization_id = p_org AND us.sucursal_id = p_sucursal))
        OR (NOT p_admin AND NOT public.has_role(p_actor, 'manager') AND public.has_role(p_actor, 'barber')
          AND tareas_private.pertenece(p_org, p_sucursal, p.barbero_id)
          AND (p_equipo OR p_asignado = p.barbero_id))
      )
  )
$$;

-- RLS helper: no caller-supplied identity and no data/PII returned, only permission.
CREATE FUNCTION tareas_private.alcance(p_org uuid, p_sucursal uuid, p_asignado uuid, p_equipo boolean, p_admin boolean)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT auth.uid() IS NOT NULL AND (
    tareas_private.permitido(auth.uid(), p_org, p_sucursal, p_asignado, p_equipo, p_admin)
    OR (NOT p_admin AND public.is_sucursal_account(auth.uid()) AND EXISTS (
      SELECT 1 FROM public.sucursal_accounts sa JOIN public.profiles p ON p.id = sa.user_id
      WHERE sa.user_id = auth.uid() AND sa.organization_id = p_org AND p.organization_id = p_org
        AND sa.sucursal_id = p_sucursal))
  )
$$;

-- Preserve existing petition policies, with the approved Manager branch restriction.
-- Policies are read from the actual catalog instead of guessing historical names.
DO $$ DECLARE p record; q text; c text; manager_guard text :=
  '(NOT public.has_role(auth.uid(), ''manager'') OR public.has_role(auth.uid(), ''owner'') OR public.has_role(auth.uid(), ''general_manager'') OR EXISTS (SELECT 1 FROM public.user_sucursales us WHERE us.user_id = auth.uid() AND us.organization_id = tareas.organization_id AND us.sucursal_id = tareas.sucursal_id))';
BEGIN
  FOR p IN SELECT * FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tareas' LOOP
    q := CASE WHEN p.qual IS NULL THEN '' ELSE format(' USING (tipo = ''peticion'' AND (%s) AND %s)', p.qual, manager_guard) END;
    c := CASE WHEN p.cmd NOT IN ('INSERT','UPDATE','ALL') THEN '' ELSE
      format(' WITH CHECK (tipo = ''peticion'' AND (%s) AND %s)', coalesce(p.with_check,p.qual,'true'), manager_guard) END;
    EXECUTE format('ALTER POLICY %I ON public.tareas%s%s', p.policyname, q, c);
  END LOOP;
END $$;
CREATE POLICY tareas_4a_read ON public.tareas FOR SELECT TO authenticated
  USING (tipo = 'tarea' AND tareas_private.alcance(organization_id,sucursal_id,asignado_a_id,assignment_scope = 'team',false));
CREATE POLICY tareas_4a_insert ON public.tareas FOR INSERT TO authenticated
  WITH CHECK (tipo = 'tarea' AND tareas_private.alcance(organization_id,sucursal_id,asignado_a_id,assignment_scope = 'team',true));
CREATE POLICY tareas_4a_update_admin ON public.tareas FOR UPDATE TO authenticated
  USING (tipo = 'tarea' AND tareas_private.alcance(organization_id,sucursal_id,asignado_a_id,assignment_scope = 'team',true))
  WITH CHECK (tipo = 'tarea' AND tareas_private.alcance(organization_id,sucursal_id,asignado_a_id,assignment_scope = 'team',true));
CREATE POLICY tareas_4a_delete ON public.tareas FOR DELETE TO authenticated
  USING (tipo = 'tarea' AND tareas_private.alcance(organization_id,sucursal_id,asignado_a_id,assignment_scope = 'team',true));

-- The existing automation policies must not give Managers a second org-wide entry point.
-- RESTRICTIVE only narrows existing capabilities; no change to cron/engine execution.
CREATE POLICY tareas_4a_manager_recetas ON public.tareas_recurrentes AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT public.has_role(auth.uid(),'manager') OR public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'general_manager') OR EXISTS (
    SELECT 1 FROM public.user_sucursales us WHERE us.user_id = auth.uid()
      AND us.organization_id = tareas_recurrentes.organization_id AND us.sucursal_id = tareas_recurrentes.sucursal_id));

-- INVOKER is intentional: current_user distinguishes direct client writes from the controlled
-- DEFINER and existing trusted cron/trigger code. No user-settable GUC is used as a bypass.
CREATE FUNCTION tareas_private.proteger_campos()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND current_user IN ('authenticated','anon') THEN
    IF NEW.tipo IS DISTINCT FROM OLD.tipo OR NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
      RAISE EXCEPTION 'No se puede cambiar la organización ni el tipo de una tarea' USING ERRCODE = '42501';
    END IF;
    IF OLD.tipo = 'tarea' AND ROW(NEW.estado,NEW.completada_por_id,NEW.completada_por_nombre,NEW.completada_at,
      NEW.iniciada_por_id,NEW.iniciada_por_nombre,NEW.iniciada_at) IS DISTINCT FROM
      ROW(OLD.estado,OLD.completada_por_id,OLD.completada_por_nombre,OLD.completada_at,
      OLD.iniciada_por_id,OLD.iniciada_por_nombre,OLD.iniciada_at) THEN
      RAISE EXCEPTION 'Usá las acciones controladas de Tareas' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF NEW.tipo = 'tarea' THEN
    IF NOT EXISTS (SELECT 1 FROM public.sucursales s WHERE s.id = NEW.sucursal_id AND s.organization_id = NEW.organization_id) THEN
      RAISE EXCEPTION 'La sucursal no pertenece a la organización' USING ERRCODE = '23514';
    END IF;
    IF NEW.asignado_a_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.barberos b WHERE b.id = NEW.asignado_a_id AND b.organization_id = NEW.organization_id) THEN
      RAISE EXCEPTION 'El responsable no pertenece a la organización' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'INSERT' AND current_user IN ('authenticated','anon') AND
      (NEW.estado <> 'pendiente' OR NEW.completada_at IS NOT NULL OR NEW.completada_por_id IS NOT NULL
        OR NEW.completada_por_nombre IS NOT NULL OR NEW.iniciada_at IS NOT NULL OR NEW.iniciada_por_id IS NOT NULL OR NEW.iniciada_por_nombre IS NOT NULL) THEN
      RAISE EXCEPTION 'Las tareas se crean pendientes y sin actores de acciones' USING ERRCODE = '42501';
    END IF;
  END IF;
  NEW.accion_version := gen_random_uuid();
  RETURN NEW;
END $$;
CREATE TRIGGER tareas_4a_proteger BEFORE INSERT OR UPDATE ON public.tareas
  FOR EACH ROW EXECUTE FUNCTION tareas_private.proteger_campos();

CREATE FUNCTION tareas_private.accion(p_tarea uuid, p_accion text, p_version uuid, p_cuenta uuid DEFAULT NULL, p_pin_hash text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  t public.tareas%ROWTYPE; v_actor uuid; v_org uuid; v_nombre text; v_ids uuid[];
  v_now timestamptz; v_undo tareas_private.completados%ROWTYPE; v_rate tareas_private.pin_intentos%ROWTYPE;
BEGIN
  IF p_accion IS NULL OR p_accion NOT IN ('iniciar','completar','deshacer') OR p_version IS NULL THEN
    RETURN jsonb_build_object('ok',false,'code','invalid','message','Acción inválida. Actualizá la lista.');
  END IF;
  IF p_cuenta IS NOT NULL THEN
    -- Only the server Edge Function supplies a verified auth.getUser() subject and PIN digest.
    IF current_setting('role',true) IS DISTINCT FROM 'service_role' OR p_pin_hash IS NULL THEN
      RAISE EXCEPTION 'Canal de PIN no autorizado' USING ERRCODE = '42501';
    END IF;
    v_actor := p_cuenta;
  ELSE
    v_actor := auth.uid();
    IF v_actor IS NULL OR public.is_sucursal_account(v_actor) THEN
      RETURN jsonb_build_object('ok',false,'code','pin_required','message','Esta cuenta requiere PIN para realizar la acción.');
    END IF;
  END IF;
  SELECT p.organization_id INTO v_org FROM public.profiles p WHERE p.id = v_actor;
  -- Organization filter precedes row locking. The response never reveals foreign tasks.
  SELECT * INTO t FROM public.tareas WHERE id = p_tarea AND organization_id = v_org AND tipo = 'tarea' FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',false,'code','forbidden','message','No tenés acceso a esta tarea.');
  END IF;
  IF p_cuenta IS NOT NULL THEN
    IF NOT public.is_sucursal_account(p_cuenta) OR NOT EXISTS (
      SELECT 1 FROM public.sucursal_accounts sa WHERE sa.user_id = p_cuenta AND sa.organization_id = v_org AND sa.sucursal_id = t.sucursal_id
    ) THEN RETURN jsonb_build_object('ok',false,'code','forbidden','message','No tenés acceso a esta tarea.'); END IF;
    INSERT INTO tareas_private.pin_intentos(cuenta_id) VALUES(p_cuenta) ON CONFLICT DO NOTHING;
    SELECT * INTO v_rate FROM tareas_private.pin_intentos WHERE cuenta_id = p_cuenta FOR UPDATE;
    v_now := clock_timestamp();
    IF v_rate.ventana + interval '5 minutes' <= v_now THEN
      UPDATE tareas_private.pin_intentos SET intentos = 0, ventana = v_now WHERE cuenta_id = p_cuenta;
      v_rate.intentos := 0;
    END IF;
    IF v_rate.intentos >= 5 THEN RETURN jsonb_build_object('ok',false,'code','rate_limit','message','Demasiados intentos. Esperá 5 minutos.'); END IF;
    UPDATE tareas_private.pin_intentos SET intentos = intentos + 1 WHERE cuenta_id = p_cuenta;
    -- Ambiguous PINs/profiles fail closed: never choose a random LIMIT 1 identity.
    SELECT array_agg(p.id) INTO v_ids FROM public.barberos b JOIN public.profiles p
      ON p.barbero_id = b.id AND p.organization_id = b.organization_id
      WHERE b.organization_id = v_org AND b.activo AND b.pin_hash = p_pin_hash;
    IF coalesce(cardinality(v_ids),0) <> 1 THEN
      RETURN jsonb_build_object('ok',false,'code','invalid_pin','message','PIN incorrecto o sin una identidad única habilitada.');
    END IF;
    v_actor := v_ids[1];
  END IF;
  IF NOT tareas_private.permitido(v_actor,t.organization_id,t.sucursal_id,t.asignado_a_id,t.assignment_scope = 'team',false) THEN
    RETURN jsonb_build_object('ok',false,'code','forbidden','message','No tenés permiso para actuar en esta tarea.');
  END IF;
  IF t.accion_version IS DISTINCT FROM p_version THEN
    RETURN jsonb_build_object('ok',false,'code','conflict','message','La tarea cambió o ya fue completada. Actualizá la lista.');
  END IF;
  SELECT coalesce(nullif(p.full_name,''),p.email,'Usuario') INTO v_nombre FROM public.profiles p WHERE p.id = v_actor AND p.organization_id = v_org;
  v_now := clock_timestamp();
  IF p_accion = 'iniciar' AND t.estado IN ('pendiente','vencida') THEN
    UPDATE public.tareas SET estado = 'en_progreso', iniciada_por_id = v_actor, iniciada_por_nombre = v_nombre,
      iniciada_at = v_now WHERE id = t.id RETURNING * INTO t;
  ELSIF p_accion = 'completar' AND t.estado IN ('pendiente','en_progreso','vencida') THEN
    INSERT INTO tareas_private.completados(tarea_id,actor_id,estado_anterior,version,vence_at)
      VALUES(t.id,v_actor,t.estado,t.accion_version,v_now + interval '30 seconds')
      ON CONFLICT(tarea_id) DO UPDATE SET actor_id = EXCLUDED.actor_id, estado_anterior = EXCLUDED.estado_anterior,
        version = EXCLUDED.version, vence_at = EXCLUDED.vence_at;
    UPDATE public.tareas SET estado = 'completada', completada_por_id = v_actor, completada_por_nombre = v_nombre,
      completada_at = v_now WHERE id = t.id RETURNING * INTO t;
    UPDATE tareas_private.completados SET version = t.accion_version WHERE tarea_id = t.id;
  ELSIF p_accion = 'deshacer' AND t.estado = 'completada' THEN
    SELECT * INTO v_undo FROM tareas_private.completados WHERE tarea_id = t.id;
    IF NOT FOUND OR v_undo.actor_id <> v_actor OR t.completada_por_id IS DISTINCT FROM v_actor
      OR v_undo.version IS DISTINCT FROM t.accion_version OR v_undo.vence_at < v_now THEN
      RETURN jsonb_build_object('ok',false,'code','undo_denied','message','Solo quien completó puede deshacer durante 30 segundos, si la tarea no cambió.');
    END IF;
    UPDATE public.tareas SET estado = v_undo.estado_anterior, completada_por_id = NULL, completada_por_nombre = NULL,
      completada_at = NULL WHERE id = t.id RETURNING * INTO t;
    DELETE FROM tareas_private.completados WHERE tarea_id = t.id;
  ELSE
    RETURN jsonb_build_object('ok',false,'code','invalid_state','message','La tarea ya no permite esa acción. Actualizá la lista.');
  END IF;
  IF p_cuenta IS NOT NULL THEN UPDATE tareas_private.pin_intentos SET intentos = 0 WHERE cuenta_id = p_cuenta; END IF;
  RETURN jsonb_build_object('ok',true,'version',t.accion_version,'estado',t.estado,'actor_nombre',v_nombre,
    'iniciada_at',t.iniciada_at,'completada_at',t.completada_at,
    'undo_until',CASE WHEN p_accion = 'completar' THEN v_now + interval '30 seconds' END);
END $$;

-- Principal → Tareas → Historial: páginas de 50 por fecha de completado. Plan medido en PostgreSQL local
-- con RLS 4A: sin índice cada página evalúa RLS sobre todas las completadas de la organización y ordena
-- (4.500 → 173 ms; 45.000 → 1,6 s, igual que el orden previo por created_at); con este índice, ~2 ms constantes.
CREATE INDEX idx_tareas_historial_completadas ON public.tareas (organization_id, completada_at DESC NULLS LAST, id DESC)
  WHERE tipo = 'tarea' AND estado = 'completada';

-- R1 (Principal → Tareas → Próximas y progreso semanal): ocurrencias futuras de Tareas automáticas
-- activas que todavía no existen como tarea. Solo lectura. Reutiliza el calendario canónico del motor
-- (`_tareas_auto_siguiente`, siempre desde `fecha_inicio`) sin copiarlo, y el mismo alcance que la
-- lectura de tareas (`alcance`, sin acción administrativa). DEFINER porque el calendario está cerrado a
-- clientes; por eso filtra la organización del perfil explícitamente y nunca acepta una identidad.
-- Desde `proxima_fecha` (puntero del motor) y nunca antes de hoy: lo atrasado no se reconstruye.
CREATE FUNCTION tareas_private.previstas(p_desde date, p_hasta date, p_sucursal uuid DEFAULT NULL)
RETURNS TABLE (recurrencia_id uuid, fecha date, hora text, titulo text, descripcion text, sucursal_id uuid,
  assignment_scope text, asignado_a_id uuid, asignado_a_nombre text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_org uuid; v_hoy date; r record; v_d date;
BEGIN
  IF p_desde IS NULL OR p_hasta IS NULL OR p_hasta < p_desde OR p_hasta - p_desde > 13 THEN
    RAISE EXCEPTION 'Rango de fechas inválido' USING ERRCODE = '22023';
  END IF;
  SELECT p.organization_id INTO v_org FROM public.profiles p WHERE p.id = auth.uid();
  IF v_org IS NULL THEN RETURN; END IF;
  v_hoy := public._tareas_auto_hoy(v_org);
  FOR r IN SELECT tr.id, tr.fecha_inicio, tr.repeat_preset, tr.repeat_frequency, tr.repeat_interval, tr.repeat_byweekday,
      tr.proxima_fecha, tr.hora, tr.titulo, tr.descripcion, tr.sucursal_id, tr.assignment_scope, tr.asignado_a, tr.asignado_nombre
    FROM public.tareas_recurrentes tr
    WHERE tr.organization_id = v_org AND tr.activo AND tr.pausa_motivo IS NULL
      AND (p_sucursal IS NULL OR tr.sucursal_id = p_sucursal)
      AND tareas_private.alcance(tr.organization_id, tr.sucursal_id, tr.asignado_a, tr.assignment_scope = 'team', false)
  LOOP
    v_d := public._tareas_auto_siguiente(r.fecha_inicio, r.repeat_preset, r.repeat_frequency, r.repeat_interval,
      r.repeat_byweekday, GREATEST(p_desde, v_hoy, r.proxima_fecha) - 1);
    WHILE v_d IS NOT NULL AND v_d <= p_hasta LOOP
      IF NOT EXISTS (SELECT 1 FROM public.tareas t WHERE t.recurrencia_id = r.id AND t.fecha_inicio = v_d) THEN
        recurrencia_id := r.id; fecha := v_d; hora := r.hora; titulo := r.titulo; descripcion := r.descripcion;
        sucursal_id := r.sucursal_id; assignment_scope := r.assignment_scope; asignado_a_id := r.asignado_a;
        asignado_a_nombre := r.asignado_nombre;
        RETURN NEXT;
      END IF;
      v_d := public._tareas_auto_siguiente(r.fecha_inicio, r.repeat_preset, r.repeat_frequency, r.repeat_interval,
        r.repeat_byweekday, v_d);
    END LOOP;
  END LOOP;
END $$;

CREATE FUNCTION public.tareas_previstas(p_desde date, p_hasta date, p_sucursal uuid DEFAULT NULL)
RETURNS TABLE (recurrencia_id uuid, fecha date, hora text, titulo text, descripcion text, sucursal_id uuid,
  assignment_scope text, asignado_a_id uuid, asignado_a_nombre text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT * FROM tareas_private.previstas(p_desde, p_hasta, p_sucursal)
$$;

CREATE FUNCTION public.tareas_accion(p_tarea uuid, p_accion text, p_version uuid)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT tareas_private.accion(p_tarea,p_accion,p_version)
$$;
CREATE FUNCTION public.tareas_accion_pin(p_tarea uuid, p_accion text, p_version uuid, p_cuenta uuid, p_pin_hash text)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT tareas_private.accion(p_tarea,p_accion,p_version,p_cuenta,p_pin_hash)
$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA tareas_private FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION tareas_private.alcance(uuid,uuid,uuid,boolean,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION tareas_private.accion(uuid,text,uuid,uuid,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION tareas_private.previstas(date,date,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.tareas_previstas(date,date,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tareas_previstas(date,date,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.tareas_accion(uuid,text,uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.tareas_accion_pin(uuid,text,uuid,uuid,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tareas_accion(uuid,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tareas_accion_pin(uuid,text,uuid,uuid,text) TO service_role;
COMMIT;
