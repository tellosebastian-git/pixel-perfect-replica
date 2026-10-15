// Local PostgreSQL/WASM only. No URLs, credentials or production data; every user, name and amount is synthetic.
// Install the isolated test dependency once (see docs/MODULOS/notificaciones.md):
//   npm install --prefix node_modules/.admin-sql-test --no-package-lock --no-save @electric-sql/pglite@0.5.8
// Run from the repository root:
//   node supabase/tests/tareas-automaticas-sql.mjs                      (the suite)
//   node supabase/tests/tareas-automaticas-sql.mjs --mutation-check     (proves the suite fails when a migration is weakened)
//
// Phase 1 rebuilds the CURRENT production shape (historic migrations + Etapa 1) and proves the defects that
// Etapa 2 fixes ("baseline"). Phase 2 applies the four Etapa 2 migrations exactly as shipped and verifies:
// calendar, timezone, generation, exceptional recovery, pauses, edits, vencimientos, recipients,
// multi-tenant isolation, error isolation, privileges and the migrations' own safety checks.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { PGlite } = await import(pathToFileURL(resolve('node_modules/.admin-sql-test/node_modules/@electric-sql/pglite/dist/index.js')).href);

const DIR = 'supabase/migrations';
const E1 = ['20261012100000_notifications_security_functions.sql', '20261012100100_notifications_security_rls.sql', '20261012100200_organizations_timezone_validation.sql'];
const E2 = ['20261012120000_tareas_automaticas_calendario.sql', '20261012120100_tareas_automaticas_pausa_integridad.sql',
  '20261012120200_tareas_automaticas_motor.sql', '20261012120300_tareas_tipo_estado_integridad.sql',
  '20261012120400_tareas_automaticas_pertenencia_estructural.sql'];

// ---------------------------------------------------------------------------------------------------------
// Mutation testing: each entry weakens ONE shipped migration; the suite must fail for every one of them.
// ---------------------------------------------------------------------------------------------------------
const MUTATIONS = [
  { name: 'engine generates tipo admin again', file: E2[2], from: `'tarea', r.titulo`, to: `'admin', r.titulo` },
  { name: 'engine creates occurrences that would be born overdue', file: E2[2], from: `IF v_vigente + v_dias < v_hoy THEN`, to: `IF false THEN` },
  { name: 'engine without FOR UPDATE SKIP LOCKED', file: E2[2], from: `WHERE id = p_receta FOR UPDATE SKIP LOCKED;`, to: `WHERE id = p_receta FOR UPDATE;` },
  { name: 'engine without ON CONFLICT DO NOTHING', file: E2[2], from: `ON CONFLICT (recurrencia_id, fecha_inicio) WHERE recurrencia_id IS NOT NULL AND fecha_inicio IS NOT NULL\n      DO NOTHING;`, to: `;` },
  { name: 'engine does not leave a recovery trace', file: E2[2], from: `recuperaciones     = CASE WHEN v_rec_tipo IS NOT NULL THEN recuperaciones + 1 ELSE recuperaciones END`, to: `recuperaciones     = recuperaciones` },
  { name: 'reconcile also resumes manual pauses', file: E2[1], from: `AND t.pausa_motivo IS DISTINCT FROM 'manual'\n     ORDER BY t.id`, to: `AND true\n     ORDER BY t.id` },
  { name: 'editing any field moves proxima_fecha', file: E2[4], from: `IF TG_OP = 'INSERT' OR v_cambio OR v_reanuda THEN`, to: `IF true THEN` },
  { name: 'a client can write the pause motive', file: E2[4], from: `      NEW.pausa_motivo := OLD.pausa_motivo;\n      NEW.pausada_at := OLD.pausada_at;`, to: `      NULL;` },
  { name: 'recipe may point at a sucursal of another organization', file: E2[4], from: `WHERE s.id = NEW.sucursal_id AND s.organization_id = NEW.organization_id) THEN`, to: `WHERE s.id = NEW.sucursal_id) THEN` },
  { name: 'pause rule consults disponible again', file: E2[4], from: `AND bs.sucursal_id = p_sucursal\n                      AND (bs.tipo IN`, to: `AND bs.sucursal_id = p_sucursal AND bs.disponible\n                      AND (bs.tipo IN` },
  { name: 'expired temporal assignment still counts', file: E2[4], from: `AND bs.fecha_fin >= v_hoy`, to: `AND true` },
  { name: 'future temporal assignment already counts', file: E2[4], from: `(bs.fecha_inicio IS NULL OR bs.fecha_inicio <= v_hoy)`, to: `true` },
  { name: 'moving the principal does not sync the old sucursal', file: E2[4], from: `    OR OLD.sucursal_id IS DISTINCT FROM NEW.sucursal_id\n`, to: `` },
  { name: 'internal reconcile function left executable by clients', file: E2[1], from: `    'public._tareas_auto_reconciliar(uuid,uuid,uuid,timestamptz)',\n`, to: `` },
  { name: 'day is computed in UTC instead of the organization timezone', file: E2[0], from: `(SELECT o.timezone\n               FROM public.organizations o`, to: `(SELECT 'UTC'::text\n               FROM public.organizations o` },
  { name: 'calendar ignores the N weeks interval', file: E2[0], from: `/ 7) % p_paso = 0`, to: `/ 7) % 1 = 0` },
  { name: 'recipient is the barbero id instead of the barbero users', file: E2[2], from: `SELECT bu AS u FROM public._notif_barbero_users(NEW.organization_id, NEW.asignado_a_id) AS bu`, to: `SELECT NEW.asignado_a_id AS u` },
  { name: 'Etapa 3 reset selects peticiones too', file: 'supabase/diagnostics/20261013_etapa3_reset_tareas/01_backup.sql', from: "SELECT t.* FROM public.tareas t WHERE t.tipo IN ('admin', 'tarea')\n$f$;", to: "SELECT t.* FROM public.tareas t WHERE t.tipo IN ('admin', 'tarea', 'peticion')\n$f$;" },
  { name: 'Etapa 3 notification scope accepts an orphan peticion event', file: 'supabase/diagnostics/20261013_etapa3_reset_tareas/01_backup.sql', from: "AND n.type IN ('tarea_pendiente', 'tarea_asignada', 'tarea_equipo_asignada', 'tarea_vencida')\n           AND NOT EXISTS", to: "AND n.type IN ('tarea_pendiente', 'tarea_asignada', 'tarea_equipo_asignada', 'tarea_vencida', 'peticion_vencida')\n           AND NOT EXISTS" },
  { name: 'Etapa 3 reset does not revalidate against the backup under lock', file: 'supabase/diagnostics/20261013_etapa3_reset_tareas/01_backup.sql', from: "  IF EXISTS (SELECT 1 FROM etapa3_backup.verificar() v WHERE NOT v.ok) THEN\n    RAISE EXCEPTION 'ETAPA3_ABORT: el alcance vivo", to: "  IF false THEN\n    RAISE EXCEPTION 'ETAPA3_ABORT: el alcance vivo" },
  { name: 'Etapa 3 restore leaves the triggers disabled', file: 'supabase/diagnostics/20261013_etapa3_reset_tareas/01_backup.sql', from: "  ALTER TABLE public.tareas ENABLE TRIGGER USER;\n  ALTER TABLE public.tareas_recurrentes ENABLE TRIGGER USER;\n", to: "" },
  { name: 'Etapa 3 backup ignores orphan Tareas notifications', file: 'supabase/diagnostics/20261013_etapa3_reset_tareas/01_backup.sql', from: "   WHERE n.source_module = 'tareas'\n     AND n.source_id IS NOT NULL\n", to: "   WHERE n.source_module = 'tareas'\n     AND n.source_id IS NOT NULL\n     AND (EXISTS (SELECT 1 FROM public.tareas t0 WHERE t0.id = n.source_id) OR EXISTS (SELECT 1 FROM public.tareas_recurrentes r0 WHERE r0.id = n.source_id))\n" },
  { name: '3B keeps admin as a valid tipo', file: '20261013120000_tareas_integridad_post_reset.sql', from: "CHECK (tipo IN ('tarea', 'peticion'));", to: "CHECK (tipo IN ('tarea', 'peticion', 'admin'));" },
  { name: 'in-progress tasks never become overdue', file: E2[2], from: `((t.estado = 'pendiente') OR (t.estado = 'en_progreso' AND t.vencida_at IS NULL))`, to: `(t.estado = 'pendiente')` },
];
const MUT = process.env.MUTATION !== undefined ? MUTATIONS[Number(process.env.MUTATION)] : null;

if (!process.env.TAREAS_FIXTURE_ONLY && process.argv.includes('--mutation-check')) {
  let survived = 0;
  for (const [i, m] of MUTATIONS.entries()) {
    const run = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { env: { ...process.env, MUTATION: String(i) }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const killed = run.status !== 0;
    if (!killed) survived++;
    console.log(`${killed ? 'KILLED  ' : 'SURVIVED'} mutation ${i + 1}/${MUTATIONS.length} - ${m.name}`);
  }
  console.log(survived === 0 ? `All ${MUTATIONS.length} mutations were detected by the suite.` : `${survived} mutation(s) SURVIVED: the suite is too weak.`);
  process.exit(survived === 0 ? 0 : 1);
}

const files = (await readdir(DIR)).filter(f => f.endsWith('.sql')).sort();
const cache = new Map();
async function read(name) {
  if (!cache.has(name)) {
    let sql = (await readFile(name.includes('/') ? name : `${DIR}/${name}`, 'utf8')).replace(/\r/g, '');
    if (MUT && MUT.file === name) {
      const pairs = [[MUT.from, MUT.to], ...(MUT.also ?? [])];
      for (const [from, to] of pairs) {
        if (from === to) continue;
        assert(sql.includes(from), `mutation "${MUT.name}": text to weaken not found in ${name}`);
        sql = sql.replace(from, to);
      }
    }
    cache.set(name, sql);
  }
  return cache.get(name);
}
const mig = async prefix => {
  const name = files.find(f => f.startsWith(prefix));
  assert(name, `Missing migration ${prefix}`);
  return read(name);
};
function extractFunction(sql, name) {
  const start = sql.search(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(`, 'i'));
  assert(start >= 0, `Missing function ${name}`);
  const rest = sql.slice(start);
  const open = rest.match(/\bAS\s+(\$[A-Za-z_]*\$)/i);
  assert(open, `No body for ${name}`);
  const bodyStart = open.index + open[0].length;
  const end = rest.indexOf(open[1], bodyStart);
  assert(end > 0, `Unterminated body for ${name}`);
  return `${rest.slice(0, end + open[1].length)};`;
}

const ROLLBACK = Symbol('rollback');
let passed = 0;
async function test(name, work) { await work(); passed++; console.log(`ok ${passed} - ${name}`); }

// ---------------------------------------------------------------------------------------------------------
// Synthetic environment: objects owned by a NON-superuser (like `postgres` in Supabase) and Supabase's
// default privileges (anon/authenticated/service_role) emulated, so EXECUTE/ACL/RLS semantics are real.
// ---------------------------------------------------------------------------------------------------------
const SETUP = `
  SET TIME ZONE 'UTC';
  CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
  CREATE ROLE service_role NOLOGIN BYPASSRLS; CREATE ROLE app_owner NOLOGIN;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
  GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role, app_owner;
  GRANT USAGE, CREATE ON SCHEMA public TO app_owner;
  GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
`;
// The production shape of every table the Tareas automáticas engine and the notification triggers touch.
const SCHEMA = `
  CREATE TYPE public.app_role AS ENUM ('owner','manager','barber','general_manager','otros','sucursal_account');
  CREATE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
    BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
  CREATE TABLE public.organizations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
    timezone text DEFAULT 'America/Argentina/Buenos_Aires', tareas_vencimiento_dias_default integer NOT NULL DEFAULT 1,
    peticiones_vencimiento_dias integer NOT NULL DEFAULT 60, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
  CREATE TABLE public.profiles (id uuid PRIMARY KEY, organization_id uuid, barbero_id uuid, full_name text, email text);
  CREATE TABLE public.user_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, role public.app_role NOT NULL);
  CREATE TABLE public.sucursales (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id),
    nombre text, timezone text, activa boolean NOT NULL DEFAULT true, fecha_desactivacion timestamptz, deleted_at timestamptz);
  CREATE TABLE public.user_sucursales (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, sucursal_id uuid NOT NULL, organization_id uuid NOT NULL);
  CREATE TABLE public.sucursal_accounts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
    sucursal_id uuid NOT NULL UNIQUE, user_id uuid UNIQUE, email text);
  CREATE TABLE public.barberos (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid, nombre text NOT NULL, apellido text NOT NULL,
    sucursal_id uuid, activo boolean NOT NULL DEFAULT true, fecha_baja date);
  CREATE TABLE public.barberos_sucursales (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
    barbero_id uuid NOT NULL, sucursal_id uuid NOT NULL, disponible boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid, tipo text NOT NULL DEFAULT 'principal', fecha_inicio date, fecha_fin date, dias_semana integer[]);
  CREATE TABLE public.servicios (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), nombre text);
  CREATE TABLE public.turnos (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, sucursal_id uuid,
    barbero_id uuid, servicio_id uuid, fecha date, hora_inicio time, hora_fin time, estado text DEFAULT 'confirmado', cliente_nombre text);
  CREATE TABLE public.tareas_recurrentes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    sucursal_id uuid NOT NULL REFERENCES public.sucursales(id) ON DELETE CASCADE,
    titulo text NOT NULL, descripcion text,
    assignment_scope text NOT NULL DEFAULT 'individual' CONSTRAINT tareas_recurrentes_assignment_scope_check CHECK (assignment_scope IN ('individual','team')),
    asignado_a uuid REFERENCES public.barberos(id) ON DELETE SET NULL, asignado_nombre text, hora text,
    repeat_preset text NOT NULL DEFAULT 'never', repeat_frequency text, repeat_interval integer DEFAULT 1, repeat_byweekday integer[],
    fecha_inicio date NOT NULL, proxima_fecha date NOT NULL, activo boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid);
  CREATE TABLE public.tareas (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES public.organizations(id),
    tipo text NOT NULL DEFAULT 'tarea', titulo text NOT NULL, descripcion text, estado text NOT NULL DEFAULT 'pendiente',
    asignado_a_id uuid REFERENCES public.barberos(id), asignado_a_nombre text, creado_por_id uuid, creado_por_nombre text,
    recurrente boolean DEFAULT false, fecha_limite date, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
    hora text, repeat_preset text DEFAULT 'never', repeat_frequency text, repeat_interval integer DEFAULT 1, repeat_byweekday integer[],
    vencimiento_dias integer DEFAULT 60, sucursal_id uuid REFERENCES public.sucursales(id),
    assignment_scope text NOT NULL DEFAULT 'individual' CONSTRAINT tareas_assignment_scope_check CHECK (assignment_scope IN ('individual','team')),
    completada_por_id uuid, completada_por_nombre text, completada_at timestamptz, fecha_inicio date, vencida_at timestamptz,
    recurrencia_id uuid REFERENCES public.tareas_recurrentes(id) ON DELETE SET NULL);
  CREATE UNIQUE INDEX uq_tareas_recurrencia_fecha ON public.tareas (recurrencia_id, fecha_inicio)
    WHERE recurrencia_id IS NOT NULL AND fecha_inicio IS NOT NULL;
  CREATE INDEX idx_tareas_recurrentes_proxima_fecha_activo ON public.tareas_recurrentes (proxima_fecha) WHERE activo = true;
  CREATE TRIGGER update_tareas_updated_at BEFORE UPDATE ON public.tareas FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  CREATE TRIGGER update_tareas_recurrentes_updated_at BEFORE UPDATE ON public.tareas_recurrentes FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  CREATE TRIGGER update_barberos_sucursales_updated_at BEFORE UPDATE ON public.barberos_sucursales FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  -- Production: only one row per barbero can be "disponible" (it rotates with the schedule).
  CREATE FUNCTION public.bs_ensure_single_disponible() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
    BEGIN
      IF NEW.disponible = true THEN
        UPDATE public.barberos_sucursales SET disponible = false, updated_at = now(), updated_by = auth.uid()
         WHERE barbero_id = NEW.barbero_id AND organization_id = NEW.organization_id AND id <> NEW.id AND disponible = true;
      END IF;
      RETURN NEW;
    END $$;
  CREATE TRIGGER bs_ensure_single_disponible_trg BEFORE INSERT OR UPDATE OF disponible ON public.barberos_sucursales
    FOR EACH ROW EXECUTE FUNCTION public.bs_ensure_single_disponible();
  CREATE TABLE public.ingresos (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid, sucursal_id uuid, closed_at timestamptz,
    identificador uuid, entry_mode text, backfilled_at timestamptz, backfilled_by uuid, dia date, total_cobrado numeric);
  CREATE TABLE public.anulaciones_cierre (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid, ingreso_id uuid,
    motivo text, fecha_cierre date, barbero_nombre text, anulado_por_id uuid);
  CREATE TABLE public.venta (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid, sucursal_id uuid, estado text DEFAULT 'activo',
    anulado_por_id text, total_cobrado numeric, metodo_pago text, tipo_venta text, barbero_nombre text, fecha_hora timestamptz DEFAULT now());
  CREATE TABLE public."Egresos" (id bigserial PRIMARY KEY, organization_id uuid, sucursal_id uuid, estado text DEFAULT 'activo',
    "Monto" numeric, "Categoria" text, "Descripcion" text, "Fecha" timestamptz DEFAULT now(), tipo_costo text, anulado_motivo text, anulado_por uuid);
  CREATE TABLE public.inversiones (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid, sucursal_id uuid, nombre text,
    monto_total numeric, categoria text, meses_amortizacion integer, fecha_compra date);
  CREATE TABLE public.deudas (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid, sucursal_id uuid, acreedor text,
    monto_total numeric, cuotas_totales integer, fecha_inicio date);
  CREATE TABLE public.pagos_sueldos (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid, sucursal_id uuid, concepto text,
    monto numeric, barbero_nombre text, fecha timestamptz DEFAULT now());
  CREATE TABLE public.sucursal_action_pin_config (organization_id uuid, sucursal_id uuid, action_key text, requires_pin boolean);
`;
// Helpers used by the production RLS policies (simplified bodies, same contract).
const RLS_HELPERS = `
  CREATE FUNCTION public.get_user_barbero_id(_user_id uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$ SELECT barbero_id FROM public.profiles WHERE id = _user_id $$;
  CREATE FUNCTION public.get_user_sucursal_ids(_user_id uuid) RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$ SELECT sucursal_id FROM public.user_sucursales WHERE user_id = _user_id $$;
  CREATE FUNCTION public.is_sucursal_account(_user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$ SELECT public.has_role(_user_id, 'sucursal_account'::public.app_role) $$;
`;
// The same policies production has on tareas / tareas_recurrentes (see pg_policies).
const RLS_POLICIES = `
  ALTER TABLE public.tareas ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.tareas_recurrentes ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "Barber view scoped tareas" ON public.tareas FOR SELECT TO authenticated USING (
    organization_id = public.get_user_organization_id(auth.uid()) AND public.has_role(auth.uid(), 'barber'::public.app_role)
    AND (((tipo = 'peticion') AND (creado_por_id = auth.uid()))
      OR ((tipo = 'tarea') AND (assignment_scope = 'individual') AND (asignado_a_id = public.get_user_barbero_id(auth.uid())))
      OR ((tipo = 'tarea') AND (assignment_scope = 'team') AND (sucursal_id IN (SELECT public.get_user_sucursal_ids(auth.uid()))))));
  CREATE POLICY "Owner GM Manager view org tareas" ON public.tareas FOR SELECT TO authenticated USING (
    organization_id = public.get_user_organization_id(auth.uid()) AND (public.has_role(auth.uid(), 'owner'::public.app_role)
      OR public.has_role(auth.uid(), 'general_manager'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role)));
  CREATE POLICY "Owner GM Manager can update tareas" ON public.tareas FOR UPDATE TO authenticated USING (
    organization_id = public.get_user_organization_id(auth.uid()) AND (public.has_role(auth.uid(), 'owner'::public.app_role)
      OR public.has_role(auth.uid(), 'general_manager'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role)));
  CREATE POLICY "Owner GM Manager can insert tareas" ON public.tareas FOR INSERT TO authenticated WITH CHECK (
    organization_id = public.get_user_organization_id(auth.uid()) AND (public.has_role(auth.uid(), 'owner'::public.app_role)
      OR public.has_role(auth.uid(), 'general_manager'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role)));
  CREATE POLICY "Owner GM Manager view org tareas_recurrentes" ON public.tareas_recurrentes FOR SELECT TO authenticated USING (
    organization_id = public.get_user_organization_id(auth.uid()) AND (public.has_role(auth.uid(), 'owner'::public.app_role)
      OR public.has_role(auth.uid(), 'general_manager'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role)));
  CREATE POLICY "Barber view scoped tareas_recurrentes" ON public.tareas_recurrentes FOR SELECT TO authenticated USING (
    organization_id = public.get_user_organization_id(auth.uid()) AND public.has_role(auth.uid(), 'barber'::public.app_role)
    AND (((assignment_scope = 'individual') AND (asignado_a = public.get_user_barbero_id(auth.uid())))
      OR ((assignment_scope = 'team') AND (sucursal_id IN (SELECT public.get_user_sucursal_ids(auth.uid()))))));
  CREATE POLICY "Owner GM Manager can insert tareas_recurrentes" ON public.tareas_recurrentes FOR INSERT TO authenticated WITH CHECK (
    organization_id = public.get_user_organization_id(auth.uid()) AND (public.has_role(auth.uid(), 'owner'::public.app_role)
      OR public.has_role(auth.uid(), 'general_manager'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role)));
  CREATE POLICY "Owner GM Manager can update tareas_recurrentes" ON public.tareas_recurrentes FOR UPDATE TO authenticated USING (
    organization_id = public.get_user_organization_id(auth.uid()) AND (public.has_role(auth.uid(), 'owner'::public.app_role)
      OR public.has_role(auth.uid(), 'general_manager'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role)));
  CREATE POLICY "Owner GM Manager can delete tareas_recurrentes" ON public.tareas_recurrentes FOR DELETE TO authenticated USING (
    organization_id = public.get_user_organization_id(auth.uid()) AND (public.has_role(auth.uid(), 'owner'::public.app_role)
      OR public.has_role(auth.uid(), 'general_manager'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role)));
  CREATE POLICY "Sucursal account insert tareas_recurrentes" ON public.tareas_recurrentes FOR INSERT TO authenticated WITH CHECK (
    organization_id = public.get_user_organization_id(auth.uid()) AND public.is_sucursal_account(auth.uid())
    AND (sucursal_id IN (SELECT public.get_user_sucursal_ids(auth.uid()))));
`;

// Historic migrations that define the notification objects, in chronological order (same list as the Etapa 1 suite).
const HISTORY = [
  ['20260515004612', s => s], ['20260515013926', s => s], ['20260515153052', s => s], ['20260515210540', s => s],
  ['20260515212453', s => s], ['20260515220322', s => s], ['20260515222233', s => s],
  ['20260602052143', s => s.replace('CREATE EXTENSION IF NOT EXISTS pg_cron;', '')],
  ['20260607200114', s => s],
  ['20260608120225', s => s.slice(0, s.lastIndexOf('\n', s.indexOf('Bloque B')))],
];

async function asOwner(db, sql) {
  await db.transaction(async tx => { await tx.exec('SET LOCAL ROLE app_owner'); await tx.exec(sql); });
}
/** Builds the production shape. `stage`: 'base' (before Etapa 1), 'e1', then 'm1'..'m4' (cumulative Etapa 2). */
async function build(stage = 'm5', database) {
  const db = database ?? await PGlite.create();
  await db.exec(SETUP);
  await asOwner(db, SCHEMA);
  await asOwner(db, extractFunction(await mig('20260109143656'), 'has_role'));
  await asOwner(db, extractFunction(await mig('20260109213200'), 'get_user_organization_id'));
  await asOwner(db, RLS_HELPERS);
  await asOwner(db, RLS_POLICIES);
  for (const [prefix, adapt] of HISTORY) await asOwner(db, adapt(await mig(prefix)));
  await asOwner(db, extractFunction(await mig('20260602052818'), 'upsert_notification'));
  const orgPolicy = (await mig('20260315195351')).match(/CREATE POLICY "Owner and GM can update own organization"[\s\S]*?;/)[0];
  await asOwner(db, `
    ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "synthetic select own organization" ON public.organizations FOR SELECT TO authenticated
      USING (id = public.get_user_organization_id(auth.uid()));
    ${orgPolicy}`);
  // The OLD engine, exactly as it ships in the repository (20260604133557).
  const old = await mig('20260604133557');
  await asOwner(db, extractFunction(old, '_calc_next_tarea_date'));
  await asOwner(db, extractFunction(old, 'process_tareas_recurrentes'));
  const order = ['base', 'e1', 'm1', 'm2', 'm3', 'm4', 'm5'];
  const upTo = order.indexOf(stage);
  if (upTo >= 1) for (const name of E1) await asOwner(db, await read(name));
  for (let i = 0; i < 5; i++) if (upTo >= i + 2) await asOwner(db, await read(E2[i]));
  return db;
}

// ---------------------------------------------------------------------------------------------------------
// Synthetic world: organizations A (Buenos Aires), B (Buenos Aires) and M (Madrid), every role, and a team.
// ---------------------------------------------------------------------------------------------------------
const id = () => randomUUID();
const W = {
  orgA: id(), orgB: id(), orgM: id(), S1: id(), S2: id(), SB1: id(), SM1: id(),
  ownerA: id(), gmA: id(), mgrS1: id(), mgrS2: id(), barberS1: id(), barberS1b: id(), saS1: id(), ownerB: id(), barberB: id(), ownerM: id(),
  bar1: id(), bar2: id(), bar3: id(), barOwnerA: id(), barB1: id(), barM1: id(),
};
const LABEL = Object.fromEntries(Object.entries(W).map(([k, v]) => [v, k]));

async function seedWorld(db) {
  await db.exec('SET session_replication_role = replica');
  await db.query(`INSERT INTO organizations(id,name,timezone) VALUES ($1,'Org A sintetica','America/Argentina/Buenos_Aires'),($2,'Org B sintetica','America/Argentina/Buenos_Aires'),($3,'Org M sintetica','Europe/Madrid')`, [W.orgA, W.orgB, W.orgM]);
  await db.query(`INSERT INTO sucursales(id,organization_id,nombre) VALUES ($1,$5,'S1'),($2,$5,'S2'),($3,$6,'SB1'),($4,$7,'SM1')`, [W.S1, W.S2, W.SB1, W.SM1, W.orgA, W.orgB, W.orgM]);
  const users = [['ownerA', 'A'], ['gmA', 'A'], ['mgrS1', 'A'], ['mgrS2', 'A'], ['barberS1', 'A'], ['barberS1b', 'A'], ['saS1', 'A'], ['ownerB', 'B'], ['barberB', 'B'], ['ownerM', 'M']];
  const orgOf = { A: W.orgA, B: W.orgB, M: W.orgM };
  const barberoOf = { barberS1: W.bar1, barberS1b: W.bar1, barberB: W.barB1, ownerA: W.barOwnerA };
  for (const [name, org] of users) {
    await db.query('INSERT INTO auth.users(id) VALUES ($1)', [W[name]]);
    await db.query('INSERT INTO profiles(id,organization_id,barbero_id,full_name,email) VALUES ($1,$2,$3,$4,$5)',
      [W[name], orgOf[org], barberoOf[name] ?? null, `Nombre ${name}`, `${name.toLowerCase()}@example.invalid`]);
  }
  const roles = { ownerA: 'owner', gmA: 'general_manager', mgrS1: 'manager', mgrS2: 'manager', barberS1: 'barber', barberS1b: 'barber', saS1: 'sucursal_account', ownerB: 'owner', barberB: 'barber', ownerM: 'owner' };
  for (const [name, role] of Object.entries(roles)) await db.query('INSERT INTO user_roles(user_id,role) VALUES ($1,$2)', [W[name], role]);
  await db.query('INSERT INTO user_sucursales(user_id,sucursal_id,organization_id) VALUES ($1,$2,$3),($4,$5,$3),($6,$2,$3),($7,$2,$3)',
    [W.mgrS1, W.S1, W.orgA, W.mgrS2, W.S2, W.barberS1, W.saS1]);
  await db.query('INSERT INTO sucursal_accounts(organization_id,sucursal_id,user_id,email) VALUES ($1,$2,$3,$4)', [W.orgA, W.S1, W.saS1, 'sa1@example.invalid']);
  const barbers = [['bar1', W.orgA], ['bar2', W.orgA], ['bar3', W.orgA], ['barOwnerA', W.orgA], ['barB1', W.orgB], ['barM1', W.orgM]];
  for (const [name, org] of barbers) await db.query('INSERT INTO barberos(id,organization_id,nombre,apellido) VALUES ($1,$2,$3,$4)', [W[name], org, `Barbero ${name}`, 'Sintetico']);
  const bs = [['bar1', 'S1', true, W.orgA, 'principal'], ['bar2', 'S1', true, W.orgA, 'principal'], ['bar2', 'S2', false, W.orgA, 'recurrente'], ['bar3', 'S1', true, W.orgA, 'principal'],
    ['barOwnerA', 'S1', true, W.orgA, 'principal'], ['barB1', 'SB1', true, W.orgB, 'principal'], ['barM1', 'SM1', true, W.orgM, 'principal']];
  for (const [b, s, disp, org, tipo] of bs) await db.query('INSERT INTO barberos_sucursales(organization_id,barbero_id,sucursal_id,disponible,tipo,dias_semana) VALUES ($1,$2,$3,$4,$5,$6)', [org, W[b], W[s], disp, tipo, tipo === 'recurrente' ? [1] : null]);
  await db.exec('SET session_replication_role = origin');
}

// ---------------------------------------------------------------------------------------------------------
// Session helpers. Every scenario runs in a transaction that is ALWAYS rolled back.
// ---------------------------------------------------------------------------------------------------------
const owner = tx => tx.exec(`RESET ROLE; SET LOCAL ROLE app_owner; SELECT set_config('request.jwt.claim.sub', '', true)`);
const client = async (tx, user, role = 'authenticated') => {
  await tx.exec(`RESET ROLE; SET LOCAL ROLE ${role}`);
  await tx.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [user ? W[user] : '']);
};
let db;
/** Runs `work(tx)` as the table owner (no JWT, like the cron) and rolls everything back. */
async function scenario(work) {
  let out;
  try {
    await db.transaction(async tx => { await owner(tx); out = await work(tx); throw ROLLBACK; });
  } catch (error) { if (error !== ROLLBACK) throw error; }
  return out;
}
const rows = async (tx, sql, params) => (await tx.query(sql, params)).rows;
const one = async (tx, sql, params) => (await tx.query(sql, params)).rows[0];
const val = async (tx, sql, params) => Object.values((await tx.query(sql, params)).rows[0] ?? {})[0];
/** Runs `fn` and expects it to fail; the failing statement is wrapped in a savepoint so the transaction stays usable. */
async function fails(tx, sql, params, pattern) {
  await tx.exec('SAVEPOINT expect_fail');
  let error = null;
  try { await tx.query(sql, params); } catch (e) { error = e; }
  await tx.exec(error ? 'ROLLBACK TO SAVEPOINT expect_fail' : 'RELEASE SAVEPOINT expect_fail');
  assert(error, `expected failure: ${sql.slice(0, 80)}`);
  if (pattern) assert.match(`${error.message} ${error.code ?? ''}`, pattern);
  return error;
}

const SIM = '2026-10-12T15:00:00Z';                 // Monday 2026-10-12 in Buenos Aires
const realToday = async tx => String(await val(tx, `SELECT public._tareas_auto_hoy($1::uuid)::text`, [W.orgA]));
const dstr = v => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

/** Creates a Tarea automática as the owner WITHOUT triggering the generation-on-save (so the engine can be driven with `_now`). */
async function mkRecipe(tx, o = {}) {
  await tx.exec(`SELECT set_config('vittro.tareas_auto', 'on', true)`);
  const r = await one(tx, `INSERT INTO tareas_recurrentes(organization_id,sucursal_id,titulo,assignment_scope,asignado_a,asignado_nombre,hora,
      repeat_preset,repeat_frequency,repeat_interval,repeat_byweekday,fecha_inicio,proxima_fecha,activo)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12,$13) RETURNING id`,
  [o.org ?? W.orgA, o.suc ?? W.S1, o.titulo ?? `Receta ${randomUUID().slice(0, 6)}`, o.scope ?? 'team', o.barbero ?? null, o.nombre ?? null, o.hora ?? null,
    o.preset ?? 'daily', o.freq ?? null, o.interval ?? null, o.byday ?? null, o.inicio ?? '2026-09-01', o.activo ?? true]);
  if (o.proxima) await tx.query('UPDATE tareas_recurrentes SET proxima_fecha=$2 WHERE id=$1', [r.id, o.proxima]);
  await tx.exec(`SELECT set_config('vittro.tareas_auto', '', true)`);
  return r.id;
}
const engine = (tx, now = SIM) => val(tx, `SELECT public._tareas_auto_procesar($1::timestamptz)`, [now]);
const recipe = (tx, rid) => one(tx, `SELECT *, proxima_fecha::text AS proxima, fecha_inicio::text AS inicio, recuperacion_fecha::text AS rec_fecha FROM tareas_recurrentes WHERE id=$1`, [rid]);
const occurrences = (tx, rid) => rows(tx, `SELECT *, fecha_inicio::text AS fecha FROM tareas WHERE recurrencia_id=$1 ORDER BY fecha_inicio`, [rid]);
const recipientsOfTitle = async (tx, type, title) => (await rows(tx, `SELECT d.user_id FROM notification_deliveries d JOIN notifications n ON n.id=d.notification_id WHERE n.type=$1 AND n.title=$2`, [type, title]))
  .map(r => LABEL[r.user_id] ?? r.user_id).sort();
const notifCount = (tx, type) => val(tx, `SELECT count(*)::int FROM notifications WHERE type=$1`, [type]);

// =========================================================================================================
// PHASE 1 - BASELINE (production today, with Etapa 1 applied): the defects Etapa 2 fixes.
// =========================================================================================================
export { build, seedWorld, W, asOwner };
if (!process.env.TAREAS_FIXTURE_ONLY) {
db = await build('e1');
await seedWorld(db);

await test('[baseline] the old engine generates tipo=admin (invisible for barberos and without expiry)', async () => {
  await scenario(async tx => {
    const rid = (await one(tx, `INSERT INTO tareas_recurrentes(organization_id,sucursal_id,titulo,assignment_scope,repeat_preset,fecha_inicio,proxima_fecha)
      VALUES ($1,$2,'Receta base','team','daily',CURRENT_DATE-3,CURRENT_DATE-1) RETURNING id`, [W.orgA, W.S1])).id;
    await tx.exec('RESET ROLE; SET LOCAL ROLE service_role');
    assert((await val(tx, 'SELECT public.process_tareas_recurrentes()')) >= 1);
    await owner(tx);
    assert.deepEqual((await occurrences(tx, rid)).map(o => o.tipo), ['admin']);
  });
});
await test('[baseline] _calc_next_tarea_date treats weekly/biweekly/quarterly/semiannual/yearly as "+1 day"', async () => {
  await scenario(async tx => {
    for (const preset of ['weekly', 'biweekly', 'quarterly', 'semiannual', 'yearly'])
      assert.equal(dstr(await val(tx, `SELECT public._calc_next_tarea_date('2026-10-07'::date,$1,NULL,1,NULL)`, [preset])), '2026-10-08', preset);
  });
});
await test('[baseline] the assignment notice uses barberos.id as if it were a user id: the barbero never receives it', async () => {
  await scenario(async tx => {
    await tx.query(`INSERT INTO tareas(organization_id,sucursal_id,tipo,titulo,assignment_scope,asignado_a_id,creado_por_id,creado_por_nombre)
      VALUES ($1,$2,'tarea','Tarea individual base','individual',$3,$4,'Owner')`, [W.orgA, W.S1, W.bar1, W.ownerA]);
    const to = await recipientsOfTitle(tx, 'tarea_asignada', 'Tarea individual base');
    assert(!to.includes('barberS1'), 'barberS1 (the real user of bar1) should be missing in the baseline');
    assert(to.includes('ownerA') && to.includes('mgrS1'));
  });
});
await test('[baseline] an in-progress task is never marked overdue', async () => {
  await scenario(async tx => {
    await tx.query(`INSERT INTO tareas(organization_id,sucursal_id,tipo,titulo,estado,assignment_scope,fecha_inicio) VALUES ($1,$2,'tarea','En progreso base','en_progreso','team',CURRENT_DATE-10)`, [W.orgA, W.S1]);
    await tx.exec('RESET ROLE; SET LOCAL ROLE service_role');
    await val(tx, 'SELECT public.process_vencimientos_tareas()');
    await owner(tx);
    assert.equal((await one(tx, `SELECT estado, vencida_at FROM tareas WHERE titulo='En progreso base'`)).vencida_at, null);
  });
});

// =========================================================================================================
// PHASE 2 - apply the four Etapa 2 migrations exactly as shipped, then verify.
// =========================================================================================================
await test('E2-M1 .. E2-M4 apply cleanly, in order, on top of production (Etapa 1 applied) with data in the tables', async () => {
  // Legacy rows the migrations must tolerate: an admin occurrence and a paused recipe without motive.
  await db.query(`INSERT INTO tareas_recurrentes(id,organization_id,sucursal_id,titulo,assignment_scope,repeat_preset,repeat_interval,fecha_inicio,proxima_fecha,activo)
    VALUES ($1,$2,$3,'Legado activa','team','monthly',1,'2026-05-26','2026-10-26',true),($4,$2,$3,'Legado pausada','team','weekly',1,'2026-05-26','2026-10-26',false)`, [W.legacyActive = id(), W.orgA, W.S1, W.legacyPaused = id()]);
  await db.query(`INSERT INTO tareas(organization_id,sucursal_id,tipo,titulo,estado,assignment_scope,recurrencia_id,fecha_inicio,creado_por_nombre) VALUES ($1,$2,'admin','Ocurrencia admin legada','pendiente','team',$3,'2026-09-26','Sistema')`,
    [W.orgA, W.S1, W.legacyActive]);
  for (const name of E2) await asOwner(db, await read(name));
});
await test('the paused legacy recipe got the motive "manual"; the active legacy recipe still runs and nothing else was touched', async () => {
  const p = (await db.query('SELECT activo, pausa_motivo FROM tareas_recurrentes WHERE id=$1', [W.legacyPaused])).rows[0];
  assert.deepEqual(p, { activo: false, pausa_motivo: 'manual' });
  const a = (await db.query(`SELECT activo, pausa_motivo, proxima_fecha::text AS p FROM tareas_recurrentes WHERE id=$1`, [W.legacyActive])).rows[0];
  assert.deepEqual(a, { activo: true, pausa_motivo: null, p: '2026-10-26' });
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM tareas WHERE tipo='admin'`)).rows[0].n, 1, 'the historic admin row is untouched (Etapa 3 owns it)');
});
await test('all new constraints exist and were validated (no NOT VALID left over in the synthetic production shape)', async () => {
  const c = (await db.query(`SELECT conname, convalidated FROM pg_constraint WHERE conrelid IN ('public.tareas_recurrentes'::regclass,'public.tareas'::regclass)
     AND conname IN ('tareas_recurrentes_pausa_motivo_check','tareas_recurrentes_activo_pausa_check','tareas_recurrentes_recuperacion_tipo_check','tareas_recurrentes_repeat_preset_check',
       'tareas_recurrentes_repeat_interval_check','tareas_recurrentes_repeat_custom_check','tareas_recurrentes_repeat_byweekday_check','tareas_estado_check') ORDER BY 1`)).rows;
  assert.equal(c.length, 8);
  assert(c.every(r => r.convalidated), JSON.stringify(c));
});

// ---------------------------------------------------------------------------------------------------------
// Calendar: one canonical semantic, anchored on fecha_inicio.
// ---------------------------------------------------------------------------------------------------------
const next = (tx, inicio, preset, freq, interval, byday, after) =>
  val(tx, `SELECT public._tareas_auto_siguiente($1::date,$2,$3,$4::int,$5::int[],$6::date)::text`, [inicio, preset, freq, interval, byday, after]);
async function series(tx, inicio, preset, freq, interval, byday, n) {
  const out = [];
  let after = new Date(Date.parse(inicio) - 86400000).toISOString().slice(0, 10);
  for (let i = 0; i < n; i++) { after = await next(tx, inicio, preset, freq, interval, byday, after); out.push(after); }
  return out;
}
await test('calendar: weekly, every 2 weeks, every N weeks, several weekdays (starts before the first weekday of the anchor week)', async () => {
  await scenario(async tx => {
    assert.deepEqual(await series(tx, '2026-10-07', 'weekly', null, null, null, 4), ['2026-10-07', '2026-10-14', '2026-10-21', '2026-10-28']);
    assert.deepEqual(await series(tx, '2026-10-07', 'biweekly', null, null, null, 3), ['2026-10-07', '2026-10-21', '2026-11-04']);
    assert.deepEqual(await series(tx, '2026-10-05', 'custom', 'weekly', 3, null, 3), ['2026-10-05', '2026-10-26', '2026-11-16']);
    assert.deepEqual(await series(tx, '2026-10-07', 'custom', 'weekly', 2, [1, 4], 5), ['2026-10-08', '2026-10-19', '2026-10-22', '2026-11-02', '2026-11-05']);
    assert.deepEqual(await series(tx, '2026-10-11', 'weekly', null, null, null, 2), ['2026-10-11', '2026-10-18'], 'Sunday = 0');
    assert.deepEqual(await series(tx, '2026-10-07', 'custom', 'weekly', 1, [4, 1, 4], 3), ['2026-10-08', '2026-10-12', '2026-10-15'], 'unordered and repeated days');
  });
});
await test('calendar: daily, custom daily, weekdays, weekends', async () => {
  await scenario(async tx => {
    assert.deepEqual(await series(tx, '2026-10-30', 'daily', null, null, null, 3), ['2026-10-30', '2026-10-31', '2026-11-01']);
    assert.deepEqual(await series(tx, '2026-10-01', 'custom', 'daily', 3, null, 3), ['2026-10-01', '2026-10-04', '2026-10-07']);
    assert.deepEqual(await series(tx, '2026-10-09', 'weekdays', null, null, null, 4), ['2026-10-09', '2026-10-12', '2026-10-13', '2026-10-14']);
    assert.deepEqual(await series(tx, '2026-10-12', 'weekends', null, null, null, 3), ['2026-10-17', '2026-10-18', '2026-10-24']);
  });
});
await test('calendar: monthly on day 29, 30 and 31, February, leap year, quarterly, semiannual', async () => {
  await scenario(async tx => {
    assert.deepEqual(await series(tx, '2026-01-31', 'monthly', null, null, null, 6), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30']);
    assert.deepEqual(await series(tx, '2028-01-31', 'monthly', null, null, null, 3), ['2028-01-31', '2028-02-29', '2028-03-31'], 'leap year');
    assert.deepEqual(await series(tx, '2026-01-29', 'monthly', null, null, null, 3), ['2026-01-29', '2026-02-28', '2026-03-29'], 'day 29 returns after February');
    assert.deepEqual(await series(tx, '2028-01-29', 'monthly', null, null, null, 3), ['2028-01-29', '2028-02-29', '2028-03-29']);
    assert.deepEqual(await series(tx, '2026-01-30', 'monthly', null, null, null, 4), ['2026-01-30', '2026-02-28', '2026-03-30', '2026-04-30']);
    assert.deepEqual(await series(tx, '2026-01-31', 'quarterly', null, null, null, 4), ['2026-01-31', '2026-04-30', '2026-07-31', '2026-10-31']);
    assert.deepEqual(await series(tx, '2026-08-31', 'semiannual', null, null, null, 3), ['2026-08-31', '2027-02-28', '2027-08-31']);
    assert.deepEqual(await series(tx, '2026-01-31', 'custom', 'monthly', 2, null, 4), ['2026-01-31', '2026-03-31', '2026-05-31', '2026-07-31']);
  });
});
await test('calendar: yearly on 29 February and custom yearly', async () => {
  await scenario(async tx => {
    assert.deepEqual(await series(tx, '2028-02-29', 'yearly', null, null, null, 5), ['2028-02-29', '2029-02-28', '2030-02-28', '2031-02-28', '2032-02-29']);
    assert.deepEqual(await series(tx, '2026-03-15', 'custom', 'yearly', 2, null, 2), ['2026-03-15', '2028-03-15']);
  });
});
await test('calendar: no drift - 36 chained monthly occurrences equal anchor + k months', async () => {
  await scenario(async tx => {
    const got = await series(tx, '2026-01-31', 'monthly', null, null, null, 36);
    const expected = (await rows(tx, `SELECT ('2026-01-31'::date + make_interval(months => k))::date::text AS d FROM generate_series(0,35) k ORDER BY k`)).map(r => r.d);
    assert.deepEqual(got, expected);
    const weekly = await series(tx, '2026-10-07', 'biweekly', null, null, null, 30);
    assert.equal(weekly[29], dstr(await val(tx, `SELECT ('2026-10-07'::date + 29*14)::text`)));
  });
});
await test('calendar: "vigente" is the last series date <= the given day; before the start there is none', async () => {
  await scenario(async tx => {
    const v = (inicio, preset, hasta, freq = null, interval = null, byday = null) => val(tx, `SELECT public._tareas_auto_vigente($1::date,$2,$3,$4::int,$5::int[],$6::date)::text`, [inicio, preset, freq, interval, byday, hasta]);
    assert.equal(await v('2026-10-07', 'weekly', '2026-10-13'), '2026-10-07');
    assert.equal(await v('2026-10-07', 'weekly', '2026-10-14'), '2026-10-14');
    assert.equal(await v('2026-10-07', 'weekly', '2026-10-06'), null);
    assert.equal(await v('2026-01-31', 'monthly', '2026-03-30'), '2026-02-28');
    assert.equal(await v('2026-01-31', 'monthly', '2026-02-27'), '2026-01-31');
    assert.equal(await v('2026-01-15', 'monthly', '2026-02-10'), '2026-01-15');
    assert.equal(await v('2026-10-07', 'custom', '2026-11-04', 'weekly', 2, [1, 4]), '2026-11-02');
    assert.equal(await v('2026-10-01', 'custom', '2026-10-09', 'daily', 3), '2026-10-07');
  });
});
await test('calendar: invalid programmings return NULL (never, custom without frequency, interval 0 or 100, weekday 7)', async () => {
  await scenario(async tx => {
    assert.equal(await next(tx, '2026-10-07', 'never', null, null, null, '2026-10-01'), null);
    assert.equal(await next(tx, '2026-10-07', 'custom', null, 1, null, '2026-10-01'), null);
    assert.equal(await next(tx, '2026-10-07', 'custom', 'daily', 0, null, '2026-10-01'), null);
    assert.equal(await next(tx, '2026-10-07', 'custom', 'daily', 100, null, '2026-10-01'), null);
    assert.equal(await next(tx, '2026-10-07', 'custom', 'weekly', 1, [7], '2026-10-01'), null);
    assert.equal(await next(tx, '2026-10-07', 'custom', 'hourly', 1, null, '2026-10-01'), null);
  });
});

// ---------------------------------------------------------------------------------------------------------
// Timezone: organizations.timezone is the only source of "today".
// ---------------------------------------------------------------------------------------------------------
await test('timezone: the same UTC instant is a different day in Buenos Aires and Madrid; midnight boundaries are exact', async () => {
  await scenario(async tx => {
    const hoy = (org, now) => val(tx, `SELECT public._tareas_auto_hoy($1::uuid,$2::timestamptz)::text`, [org, now]);
    assert.equal(await hoy(W.orgA, '2026-10-13T01:00:00Z'), '2026-10-12');
    assert.equal(await hoy(W.orgM, '2026-10-13T01:00:00Z'), '2026-10-13');
    assert.equal(await hoy(W.orgA, '2026-10-13T02:59:59Z'), '2026-10-12');
    assert.equal(await hoy(W.orgA, '2026-10-13T03:00:00Z'), '2026-10-13');
    assert.equal(await hoy(W.orgM, '2026-10-12T21:59:59Z'), '2026-10-12');
    assert.equal(await hoy(W.orgM, '2026-10-12T22:00:00Z'), '2026-10-13');
  });
});
await test('timezone: invalid or missing organization timezone falls back to Buenos Aires (and is reported as invalid)', async () => {
  await scenario(async tx => {
    const bad = id(), nul = id();
    await tx.exec('RESET ROLE; SET LOCAL session_replication_role = replica');   // only a superuser may skip the validation trigger
    await tx.query(`INSERT INTO organizations(id,name,timezone) VALUES ($1,'Org tz invalida','Mars/Phobos'),($2,'Org tz nula',NULL)`, [bad, nul]);
    await tx.exec('SET LOCAL session_replication_role = origin');
    await owner(tx);
    for (const org of [bad, nul]) assert.equal(await val(tx, `SELECT public._tareas_auto_hoy($1::uuid,'2026-10-13T01:00:00Z')::text`, [org]), '2026-10-12');
    assert.equal(await val(tx, `SELECT public._tareas_auto_tz_valida($1::uuid)`, [bad]), false);
    assert.equal(await val(tx, `SELECT public._tareas_auto_tz_valida($1::uuid)`, [W.orgA]), true);
  });
});
await test('timezone: at the same instant the engine generates the day of EACH organization (Buenos Aires vs Madrid)', async () => {
  await scenario(async tx => {
    const a = await mkRecipe(tx, { org: W.orgA, suc: W.S1, titulo: 'Diaria BA', preset: 'daily', proxima: '2026-10-12' });
    const m = await mkRecipe(tx, { org: W.orgM, suc: W.SM1, titulo: 'Diaria Madrid', preset: 'daily', proxima: '2026-10-12' });
    await engine(tx, '2026-10-13T01:00:00Z');
    assert.deepEqual((await occurrences(tx, a)).map(o => o.fecha), ['2026-10-12']);
    assert.deepEqual((await occurrences(tx, m)).map(o => o.fecha), ['2026-10-13']);
    assert.equal((await recipe(tx, a)).proxima, '2026-10-13');
    assert.equal((await recipe(tx, m)).proxima, '2026-10-14');
  });
});

// ---------------------------------------------------------------------------------------------------------
// Generation: tipo=tarea, no admin, no duplicates on retry.
// ---------------------------------------------------------------------------------------------------------
await test('generation: occurrences are tipo=tarea, recurrente=false, without repeat_* and with the right assignment; never admin', async () => {
  await scenario(async tx => {
    const team = await mkRecipe(tx, { titulo: 'Equipo S1', scope: 'team', nombre: 'Todo el equipo', hora: '09:30', preset: 'weekly', inicio: '2026-10-05', proxima: '2026-10-12' });
    const ind = await mkRecipe(tx, { titulo: 'Individual bar1', scope: 'individual', barbero: W.bar1, preset: 'daily', proxima: '2026-10-12' });
    assert.equal(await engine(tx), 2);
    const [t] = await occurrences(tx, team);
    assert.deepEqual([t.tipo, t.estado, t.recurrente, t.repeat_preset, t.repeat_frequency, t.repeat_interval, t.repeat_byweekday, t.creado_por_id, t.creado_por_nombre, t.hora, t.assignment_scope, t.asignado_a_id, t.asignado_a_nombre, t.sucursal_id, t.organization_id, t.fecha],
      ['tarea', 'pendiente', false, null, null, null, null, null, 'Sistema', '09:30', 'team', null, 'Todo el equipo', W.S1, W.orgA, '2026-10-12']);
    const [i] = await occurrences(tx, ind);
    assert.deepEqual([i.tipo, i.assignment_scope, i.asignado_a_id], ['tarea', 'individual', W.bar1]);
    assert(i.asignado_a_nombre.includes('Barbero bar1'));
    assert.equal(await val(tx, `SELECT count(*)::int FROM tareas WHERE tipo='admin' AND titulo IN ('Equipo S1','Individual bar1')`), 0);
  });
});
await test('generation: one occurrence per run (the current one) and the next date is the first series date after today', async () => {
  await scenario(async tx => {
    const rid = await mkRecipe(tx, { preset: 'weekly', inicio: '2026-10-05', proxima: '2026-10-12' });
    await engine(tx);
    const r = await recipe(tx, rid);
    assert.equal(r.proxima, '2026-10-19');
    assert.equal(r.recuperaciones, 0, 'a normal run leaves no recovery trace');
    assert.equal(r.recuperacion_tipo, null);
  });
});
await test('idempotency: running the cron twice, or retrying with the same instant, never duplicates an occurrence', async () => {
  await scenario(async tx => {
    const rid = await mkRecipe(tx, { preset: 'daily', proxima: '2026-10-12' });
    assert.equal(await engine(tx), 1);
    assert.equal(await engine(tx), 0, 'second run: nothing is due any more');
    // A retry after a crash: the recipe is rewound but the occurrence already exists.
    await tx.exec('SELECT set_config(\'vittro.tareas_auto\', \'on\', true)');
    await tx.query('UPDATE tareas_recurrentes SET proxima_fecha=$2 WHERE id=$1', [rid, '2026-10-12']);
    await tx.exec('SELECT set_config(\'vittro.tareas_auto\', \'\', true)');
    assert.equal(await engine(tx), 0, 'ON CONFLICT DO NOTHING: no second row');
    assert.equal((await occurrences(tx, rid)).length, 1);
    assert.equal((await recipe(tx, rid)).proxima, '2026-10-13', 'and the calendar still advances');
  });
});
await test('idempotency: the engine skips a recipe whose row another transaction holds (FOR UPDATE SKIP LOCKED is in the shipped code)', async () => {
  const src = (await db.query(`SELECT pg_get_functiondef(to_regprocedure('public._tareas_auto_generar(uuid,timestamptz)')) AS d`)).rows[0].d;
  assert.match(src, /FOR UPDATE SKIP LOCKED/);
  assert.match(src, /ON CONFLICT \(recurrencia_id, fecha_inicio\)/);
});
await test('generation on save: creating a Tarea automática that is due today creates today\'s occurrence immediately, once', async () => {
  await scenario(async tx => {
    const hoy = await realToday(tx);
    await client(tx, 'ownerA');
    const r = await one(tx, `INSERT INTO tareas_recurrentes(organization_id,sucursal_id,titulo,assignment_scope,repeat_preset,fecha_inicio,proxima_fecha,created_by)
      VALUES ($1,$2,'Creada por el dueño','team','weekly',$3,'2000-01-01',$4) RETURNING id, proxima_fecha::text AS proxima`, [W.orgA, W.S1, hoy, W.ownerA]);
    assert.equal(r.proxima, hoy, 'the server ignores the proxima_fecha sent by the client (2000-01-01)');
    await owner(tx);
    assert.equal((await recipe(tx, r.id)).proxima, String(await val(tx, `SELECT ($1::date + 7)::text`, [hoy])), 'and the save already generated the occurrence of today and advanced the calendar');
    const occ = await occurrences(tx, r.id);
    assert.deepEqual(occ.map(o => [o.tipo, o.fecha]), [['tarea', hoy]]);
    assert.equal(await engine(tx, new Date().toISOString()), 0);
    assert.equal((await occurrences(tx, r.id)).length, 1);
  });
});
await test('generation on save: a future start date creates nothing until its day; a past start date only aligns the next date', async () => {
  await scenario(async tx => {
    const hoy = await realToday(tx);
    const expected = await val(tx, `SELECT public._tareas_auto_siguiente($1::date-10,'weekly',NULL,NULL,NULL,$1::date-1)::text`, [hoy]);
    await client(tx, 'mgrS1');
    const future = await one(tx, `INSERT INTO tareas_recurrentes(organization_id,sucursal_id,titulo,assignment_scope,repeat_preset,fecha_inicio,proxima_fecha) VALUES ($1,$2,'Futura','team','weekly',$3::date+10,$3) RETURNING id, proxima_fecha::text AS p`, [W.orgA, W.S1, hoy]);
    assert.equal(future.p, String(await val(tx, `SELECT ($1::date+10)::text`, [hoy])));
    const past = await one(tx, `INSERT INTO tareas_recurrentes(organization_id,sucursal_id,titulo,assignment_scope,repeat_preset,fecha_inicio,proxima_fecha) VALUES ($1,$2,'Pasada','team','weekly',$3::date-10,$3::date-10) RETURNING id, proxima_fecha::text AS p`, [W.orgA, W.S1, hoy]);
    assert.equal(past.p, expected);
    assert(past.p >= hoy);
    await owner(tx);
    assert.equal((await occurrences(tx, future.id)).length, 0);
  });
});

// ---------------------------------------------------------------------------------------------------------
// Exceptional recovery after an engine outage.
// ---------------------------------------------------------------------------------------------------------
await test('recovery: a daily automation stopped for 10 days generates ONLY today\'s occurrence and leaves a trace', async () => {
  await scenario(async tx => {
    const rid = await mkRecipe(tx, { preset: 'daily', proxima: '2026-10-02' });
    assert.equal(await engine(tx), 1);
    assert.deepEqual((await occurrences(tx, rid)).map(o => o.fecha), ['2026-10-12']);
    const r = await recipe(tx, rid);
    assert.deepEqual([r.proxima, r.recuperacion_tipo, r.rec_fecha, r.recuperaciones], ['2026-10-13', 'omitida', '2026-10-02', 1]);
    assert(r.recuperacion_at);
  });
});
await test('recovery: a Monday automation recovered on Thursday does NOT create a task that is born overdue, sends nothing and moves on to next Monday', async () => {
  await scenario(async tx => {
    const rid = await mkRecipe(tx, { preset: 'weekly', inicio: '2026-09-28', proxima: '2026-10-12', titulo: 'Lunes perdido' });
    const before = await val(tx, 'SELECT count(*)::int FROM notifications');
    assert.equal(await engine(tx, '2026-10-15T15:00:00Z'), 0);
    assert.equal((await occurrences(tx, rid)).length, 0);
    assert.equal(await val(tx, 'SELECT count(*)::int FROM notifications'), before, 'no assignment and no overdue notification');
    const r = await recipe(tx, rid);
    assert.deepEqual([r.proxima, r.recuperacion_tipo, r.rec_fecha, r.recuperaciones], ['2026-10-19', 'omitida', '2026-10-12', 1]);
    // The vencimientos job has nothing to flag either: the task never existed.
    await tx.exec('RESET ROLE; SET LOCAL ROLE service_role');
    await val(tx, 'SELECT public.process_vencimientos_tareas()');
    await owner(tx);
    assert.equal(await notifCount(tx, 'tarea_vencida'), 0);
  });
});
await test('recovery: recovered the next day (not overdue yet) the occurrence IS created, flagged as late; repeated outages keep counting', async () => {
  await scenario(async tx => {
    const rid = await mkRecipe(tx, { preset: 'weekly', inicio: '2026-09-28', proxima: '2026-10-12' });
    assert.equal(await engine(tx, '2026-10-13T15:00:00Z'), 1);
    assert.deepEqual((await occurrences(tx, rid)).map(o => [o.fecha, o.estado, o.tipo]), [['2026-10-12', 'pendiente', 'tarea']]);
    let r = await recipe(tx, rid);
    assert.deepEqual([r.proxima, r.recuperacion_tipo, r.recuperaciones], ['2026-10-19', 'tardia', 1]);
    // A second outage: the failure is not normalised, the counter grows.
    await tx.exec(`SELECT set_config('vittro.tareas_auto', 'on', true)`);
    await tx.query(`UPDATE tareas_recurrentes SET proxima_fecha='2026-10-19' WHERE id=$1`, [rid]);
    await tx.exec(`SELECT set_config('vittro.tareas_auto', '', true)`);
    await engine(tx, '2026-10-23T15:00:00Z');
    r = await recipe(tx, rid);
    assert.deepEqual([r.recuperacion_tipo, r.recuperaciones, r.proxima], ['omitida', 2, '2026-10-26']);
  });
});
await test('recovery: a recipe whose next date is off the calendar (legacy data) heals without generating and without a trace', async () => {
  await scenario(async tx => {
    // biweekly from Monday 2026-05-18: 10-12 is not in the series (10-05 and 10-19 are).
    const rid = await mkRecipe(tx, { preset: 'biweekly', inicio: '2026-05-18', proxima: '2026-10-12' });
    assert.equal(await engine(tx), 0);
    const r = await recipe(tx, rid);
    assert.deepEqual([r.proxima, r.recuperaciones, r.recuperacion_tipo], ['2026-10-19', 0, null]);
  });
});

// ---------------------------------------------------------------------------------------------------------
// Resources: pauses and automatic resume.
// ---------------------------------------------------------------------------------------------------------
const state = async (tx, rid) => { const r = await recipe(tx, rid); return [r.activo, r.pausa_motivo]; };
await test('resources: active sucursal + available barbero generate', async () => {
  await scenario(async tx => {
    const team = await mkRecipe(tx, { scope: 'team', proxima: '2026-10-12' });
    const ind = await mkRecipe(tx, { scope: 'individual', barbero: W.bar1, proxima: '2026-10-12' });
    assert.equal(await engine(tx), 2);
    assert.deepEqual([await state(tx, team), await state(tx, ind)], [[true, null], [true, null]]);
  });
});
await test('sucursal inactive pauses its automations (only that sucursal), notifies admins and the manager of that sucursal, generates nothing; reactivating resumes them', async () => {
  await scenario(async tx => {
    const s1t = await mkRecipe(tx, { suc: W.S1, scope: 'team', titulo: 'S1 equipo', proxima: '2026-10-12' });
    const s1i = await mkRecipe(tx, { suc: W.S1, scope: 'individual', barbero: W.bar1, titulo: 'S1 individual', proxima: '2026-10-12' });
    const s2 = await mkRecipe(tx, { suc: W.S2, scope: 'team', titulo: 'S2 equipo', proxima: '2026-10-12' });
    await tx.query('UPDATE sucursales SET activa=false WHERE id=$1', [W.S1]);
    assert.deepEqual([await state(tx, s1t), await state(tx, s1i), await state(tx, s2)], [[false, 'sucursal_inactiva'], [false, 'sucursal_inactiva'], [true, null]]);
    assert.deepEqual(await recipientsOfTitle(tx, 'tarea_automatica_pausada', 'S1 equipo'), ['gmA', 'mgrS1', 'ownerA']);
    assert.equal(await engine(tx), 1, 'only the S2 automation generates');
    assert.equal((await occurrences(tx, s1t)).length, 0);
    await tx.query('UPDATE sucursales SET activa=true WHERE id=$1', [W.S1]);
    assert.deepEqual([await state(tx, s1t), await state(tx, s1i)], [[true, null], [true, null]]);
    const hoy = await realToday(tx);
    assert((await recipe(tx, s1t)).proxima >= hoy, 'resumed from today, nothing from the past is rebuilt');
  });
});
await test('a soft-deleted sucursal (deleted_at) pauses its automations too', async () => {
  await scenario(async tx => {
    const rid = await mkRecipe(tx, { suc: W.S2, scope: 'team' });
    await tx.query('UPDATE sucursales SET deleted_at=now() WHERE id=$1', [W.S2]);
    assert.deepEqual(await state(tx, rid), [false, 'sucursal_inactiva']);
  });
});
await test('barbero inactive pauses ONLY the automations assigned to that person; the team ones keep running; reactivating resumes', async () => {
  await scenario(async tx => {
    const ind = await mkRecipe(tx, { scope: 'individual', barbero: W.bar1, titulo: 'De bar1', proxima: '2026-10-12' });
    const other = await mkRecipe(tx, { scope: 'individual', barbero: W.bar3, titulo: 'De bar3', proxima: '2026-10-12' });
    const team = await mkRecipe(tx, { scope: 'team', titulo: 'Equipo', proxima: '2026-10-12' });
    await tx.query('UPDATE barberos SET activo=false WHERE id=$1', [W.bar1]);
    assert.deepEqual([await state(tx, ind), await state(tx, other), await state(tx, team)], [[false, 'barbero_inactivo'], [true, null], [true, null]]);
    assert.deepEqual(await recipientsOfTitle(tx, 'tarea_automatica_pausada', 'De bar1'), ['gmA', 'mgrS1', 'ownerA']);
    assert.equal(await engine(tx), 2);
    await tx.query('UPDATE barberos SET activo=true WHERE id=$1', [W.bar1]);
    assert.deepEqual(await state(tx, ind), [true, null]);
  });
});
// ---- Pertenencia estructural: `disponible` (rotación diaria) NO pausa; las asignaciones vigentes sí deciden ----
const bsPar = (tx, barbero, suc) => rows(tx, `SELECT id, tipo FROM barberos_sucursales WHERE barbero_id=$1 AND sucursal_id=$2`, [barbero, suc]);
const sumaPausas = (tx, ...titulos) => Promise.all(titulos.map(t => recipientsOfTitle(tx, 'tarea_automatica_pausada', t))).then(a => a.flat());

await test('availability rotation: with assignments in S1 and S2, changing `disponible` back and forth never pauses or resumes anything, and nobody is notified', async () => {
  await scenario(async tx => {
    const s1 = await mkRecipe(tx, { suc: W.S1, scope: 'individual', barbero: W.bar2, titulo: 'bar2 en S1', proxima: '2026-10-12' });
    const s2 = await mkRecipe(tx, { suc: W.S2, scope: 'individual', barbero: W.bar2, titulo: 'bar2 en S2', proxima: '2026-10-12' });
    assert.deepEqual([await state(tx, s1), await state(tx, s2)], [[true, null], [true, null]], 'a recurrente assignment sustains S2 although today the person is in S1');
    for (let i = 0; i < 3; i++) {
      await tx.query(`UPDATE barberos_sucursales SET disponible=true WHERE barbero_id=$1 AND sucursal_id=$2`, [W.bar2, W.S2]);
      assert.deepEqual([await state(tx, s1), await state(tx, s2)], [[true, null], [true, null]]);
      await tx.query(`UPDATE barberos_sucursales SET disponible=true WHERE barbero_id=$1 AND sucursal_id=$2`, [W.bar2, W.S1]);
      assert.deepEqual([await state(tx, s1), await state(tx, s2)], [[true, null], [true, null]]);
    }
    assert.deepEqual(await sumaPausas(tx, 'bar2 en S1', 'bar2 en S2'), []);
    assert.equal(await engine(tx), 2, 'and the engine keeps generating for both');
  });
});
await test('"Desactivar de la sucursal" (`disponible=false` on the only row) does not pause the automation', async () => {
  await scenario(async tx => {
    const rid = await mkRecipe(tx, { scope: 'individual', barbero: W.bar1, titulo: 'solo disponibilidad', proxima: '2026-10-12' });
    await tx.query(`UPDATE barberos_sucursales SET disponible=false WHERE barbero_id=$1 AND sucursal_id=$2`, [W.bar1, W.S1]);
    assert.deepEqual(await state(tx, rid), [true, null]);
    assert.equal(await engine(tx), 1);
    assert.equal((await occurrences(tx, rid)).length, 1);
  });
});
await test('deleting the LAST valid assignment pauses (barbero_sin_asignacion, no bell notice); recovering any valid assignment resumes it; a manual pause stays manual', async () => {
  await scenario(async tx => {
    const auto = await mkRecipe(tx, { scope: 'individual', barbero: W.bar3, titulo: 'bar3 auto' });
    const manual = await mkRecipe(tx, { scope: 'individual', barbero: W.bar3, titulo: 'bar3 manual', activo: false });
    assert.deepEqual(await state(tx, manual), [false, 'manual']);
    await tx.query('DELETE FROM barberos_sucursales WHERE barbero_id=$1 AND sucursal_id=$2', [W.bar3, W.S1]);
    assert.deepEqual([await state(tx, auto), await state(tx, manual)], [[false, 'barbero_sin_asignacion'], [false, 'manual']]);
    assert.deepEqual(await sumaPausas(tx, 'bar3 auto', 'bar3 manual'), [], 'no notification for this cause');
    assert.equal(await engine(tx), 0);
    await tx.query(`INSERT INTO barberos_sucursales(organization_id,barbero_id,sucursal_id,tipo) VALUES ($1,$2,$3,'principal')`, [W.orgA, W.bar3, W.S1]);
    assert.deepEqual([await state(tx, auto), await state(tx, manual)], [[true, null], [false, 'manual']], 'the manual pause is never resumed');
    assert((await recipe(tx, auto)).proxima >= await realToday(tx), 'resumed from today, nothing from the past is rebuilt');
  });
});
await test('deleting one of several assignments of the same barbero+sucursal does not pause; deleting the last one does', async () => {
  await scenario(async tx => {
    const rid = await mkRecipe(tx, { scope: 'individual', barbero: W.bar1, titulo: 'bar1 varias' });
    await tx.query(`INSERT INTO barberos_sucursales(organization_id,barbero_id,sucursal_id,tipo,dias_semana) VALUES ($1,$2,$3,'recurrente','{1}')`, [W.orgA, W.bar1, W.S1]);
    await tx.query(`DELETE FROM barberos_sucursales WHERE barbero_id=$1 AND sucursal_id=$2 AND tipo='principal'`, [W.bar1, W.S1]);
    assert.deepEqual(await state(tx, rid), [true, null]);
    await tx.query(`DELETE FROM barberos_sucursales WHERE barbero_id=$1 AND sucursal_id=$2`, [W.bar1, W.S1]);
    assert.deepEqual(await state(tx, rid), [false, 'barbero_sin_asignacion']);
  });
});
await test('moving the principal S1 -> S2 syncs both sides: S1 pauses only if nothing else sustains it; S2 resumes', async () => {
  await scenario(async tx => {
    const s1 = await mkRecipe(tx, { suc: W.S1, scope: 'individual', barbero: W.bar1, titulo: 'bar1 origen' });
    const s2 = await mkRecipe(tx, { suc: W.S2, scope: 'individual', barbero: W.bar1, titulo: 'bar1 destino' });
    assert.deepEqual(await state(tx, s2), [false, 'barbero_sin_asignacion'], 'no assignment in S2 yet');
    await tx.query(`UPDATE barberos_sucursales SET sucursal_id=$2 WHERE barbero_id=$1 AND tipo='principal'`, [W.bar1, W.S2]);
    assert.deepEqual([await state(tx, s1), await state(tx, s2)], [[false, 'barbero_sin_asignacion'], [true, null]]);
    // now with a recurrente still holding S1 when the principal moves back
    await tx.query(`INSERT INTO barberos_sucursales(organization_id,barbero_id,sucursal_id,tipo,dias_semana) VALUES ($1,$2,$3,'recurrente','{3}')`, [W.orgA, W.bar1, W.S1]);
    assert.deepEqual(await state(tx, s1), [true, null], 'a recurrente assignment brings S1 back');
    await tx.query(`UPDATE barberos_sucursales SET sucursal_id=$2 WHERE barbero_id=$1 AND tipo='principal'`, [W.bar1, W.S1]);
    assert.deepEqual(await state(tx, s2), [false, 'barbero_sin_asignacion']);
    assert.deepEqual(await state(tx, s1), [true, null]);
  });
});
await test('a recurrente assignment sustains membership even when today is not one of its days', async () => {
  await scenario(async tx => {
    const hoyIso = Number(await val(tx, `SELECT EXTRACT(ISODOW FROM $1::date)::int`, [await realToday(tx)]));
    const otro = (hoyIso % 7) + 1;
    await tx.query(`UPDATE barberos_sucursales SET dias_semana=$3 WHERE barbero_id=$1 AND sucursal_id=$2`, [W.bar2, W.S2, [otro]]);
    const rid = await mkRecipe(tx, { suc: W.S2, scope: 'individual', barbero: W.bar2, titulo: 'recurrente otro dia' });
    assert.deepEqual(await state(tx, rid), [true, null]);
    await engine(tx);
    assert.deepEqual(await state(tx, rid), [true, null]);
  });
});
await test('temporal assignments: valid inside the range, NOT before it starts, NOT after it ends (the historic row stays)', async () => {
  await scenario(async tx => {
    const hoy = await realToday(tx);
    const add = (ini, fin) => tx.query(`INSERT INTO barberos_sucursales(organization_id,barbero_id,sucursal_id,tipo,fecha_inicio,fecha_fin) VALUES ($1,$2,$3,'temporal',$4::date,$5::date)`, [W.orgA, W.bar3, W.S2, ini, fin]);
    const plus = async n => String(await val(tx, `SELECT ($1::date + $2::int)::text`, [hoy, n]));
    const rid = await mkRecipe(tx, { suc: W.S2, scope: 'individual', barbero: W.bar3, titulo: 'bar3 temporal' });
    assert.deepEqual(await state(tx, rid), [false, 'barbero_sin_asignacion'], 'no assignment at all');
    await add(await plus(3), await plus(5));
    assert.deepEqual(await state(tx, rid), [false, 'barbero_sin_asignacion'], 'future temporal does not count yet');
    await tx.query(`DELETE FROM barberos_sucursales WHERE barbero_id=$1 AND sucursal_id=$2`, [W.bar3, W.S2]);
    await add(await plus(-9), await plus(-2));
    assert.deepEqual(await state(tx, rid), [false, 'barbero_sin_asignacion'], 'expired temporal does not count');
    assert.equal(Number(await val(tx, `SELECT count(*)::int FROM barberos_sucursales WHERE barbero_id=$1 AND sucursal_id=$2`, [W.bar3, W.S2])), 1, 'the historic row is not deleted');
    await tx.query(`UPDATE barberos_sucursales SET fecha_inicio=$3::date, fecha_fin=$4::date WHERE barbero_id=$1 AND sucursal_id=$2`, [W.bar3, W.S2, await plus(-1), await plus(4)]);
    assert.deepEqual(await state(tx, rid), [true, null], 'inside the range it counts (editing the dates syncs immediately)');
    await tx.query(`UPDATE barberos_sucursales SET fecha_inicio=NULL WHERE barbero_id=$1 AND sucursal_id=$2`, [W.bar3, W.S2]);
    assert.deepEqual(await state(tx, rid), [true, null], 'a NULL start means it already started');
  });
});
await test('time passing with no UPDATE: the hourly sync pauses when a temporal ends and resumes when one starts (and respects manual pauses)', async () => {
  await scenario(async tx => {
    const hoy = await realToday(tx);
    const plus = async n => String(await val(tx, `SELECT ($1::date + $2::int)::text`, [hoy, n]));
    await tx.query(`INSERT INTO barberos_sucursales(organization_id,barbero_id,sucursal_id,tipo,fecha_inicio,fecha_fin) VALUES ($1,$2,$3,'temporal',$4::date,$5::date)`, [W.orgA, W.bar3, W.S2, await plus(-1), await plus(2)]);
    const auto = await mkRecipe(tx, { suc: W.S2, scope: 'individual', barbero: W.bar3, titulo: 'tiempo auto' });
    const manual = await mkRecipe(tx, { suc: W.S2, scope: 'individual', barbero: W.bar3, titulo: 'tiempo manual', activo: false });
    assert.deepEqual([await state(tx, auto), await state(tx, manual)], [[true, null], [false, 'manual']]);
    // The calendar moves on without any write to barberos_sucursales: simulate by changing the dates with the sync trigger off.
    await tx.exec('ALTER TABLE barberos_sucursales DISABLE TRIGGER trg_tareas_auto_sync_upd');
    await tx.query(`UPDATE barberos_sucursales SET fecha_inicio=$3::date, fecha_fin=$4::date WHERE barbero_id=$1 AND sucursal_id=$2`, [W.bar3, W.S2, await plus(-8), await plus(-1)]);
    assert.deepEqual(await state(tx, auto), [true, null], 'nothing reacted yet');
    await engine(tx);
    assert.deepEqual([await state(tx, auto), await state(tx, manual)], [[false, 'barbero_sin_asignacion'], [false, 'manual']], 'the hourly sync pauses it');
    await tx.query(`UPDATE barberos_sucursales SET fecha_inicio=$3::date, fecha_fin=$4::date WHERE barbero_id=$1 AND sucursal_id=$2`, [W.bar3, W.S2, await plus(0), await plus(5)]);
    await engine(tx);
    assert.deepEqual([await state(tx, auto), await state(tx, manual)], [[true, null], [false, 'manual']], 'the start date arrives: resumes only the automatic pause');
  });
});
await test('priority is kept: an inactive barbero or sucursal wins over a missing assignment; a row of ANOTHER organization never sustains membership', async () => {
  await scenario(async tx => {
    const rid = await mkRecipe(tx, { scope: 'individual', barbero: W.bar3, titulo: 'prioridad' });
    await tx.query('DELETE FROM barberos_sucursales WHERE barbero_id=$1 AND sucursal_id=$2', [W.bar3, W.S1]);
    assert.deepEqual(await state(tx, rid), [false, 'barbero_sin_asignacion']);
    await tx.query('UPDATE barberos SET activo=false WHERE id=$1', [W.bar3]);
    assert.deepEqual(await state(tx, rid), [false, 'barbero_inactivo']);
    await tx.query('UPDATE sucursales SET activa=false WHERE id=$1', [W.S1]);
    assert.deepEqual(await state(tx, rid), [false, 'sucursal_inactiva']);
    await tx.query('UPDATE sucursales SET activa=true WHERE id=$1', [W.S1]);
    await tx.query('UPDATE barberos SET activo=true WHERE id=$1', [W.bar3]);
    assert.deepEqual(await state(tx, rid), [false, 'barbero_sin_asignacion'], 'back to the only remaining cause');
    // a (corrupt) row that claims the same barbero+sucursal but belongs to organization B must not count
    await tx.exec('RESET ROLE; SET LOCAL session_replication_role = replica');
    await tx.query(`INSERT INTO barberos_sucursales(organization_id,barbero_id,sucursal_id,tipo) VALUES ($1,$2,$3,'principal')`, [W.orgB, W.bar3, W.S1]);
    await tx.exec('SET LOCAL session_replication_role = origin');
    await owner(tx);
    assert.equal(await engine(tx), 0);
    assert.deepEqual(await state(tx, rid), [false, 'barbero_sin_asignacion']);
  });
});
await test('a MANUAL pause is never resumed automatically and an automatic pause never overwrites it', async () => {
  await scenario(async tx => {
    const rid = await mkRecipe(tx, { scope: 'team', titulo: 'Manual S1', proxima: '2026-10-12' });
    await client(tx, 'ownerA');
    await tx.query('UPDATE tareas_recurrentes SET activo=false WHERE id=$1', [rid]);
    await owner(tx);
    assert.deepEqual(await state(tx, rid), [false, 'manual']);
    await tx.query('UPDATE sucursales SET activa=false WHERE id=$1', [W.S1]);
    assert.deepEqual(await state(tx, rid), [false, 'manual'], 'not overwritten');
    assert.deepEqual(await recipientsOfTitle(tx, 'tarea_automatica_pausada', 'Manual S1'), []);
    await tx.query('UPDATE sucursales SET activa=true WHERE id=$1', [W.S1]);
    assert.deepEqual(await state(tx, rid), [false, 'manual'], 'not resumed');
    await engine(tx);
    assert.deepEqual(await state(tx, rid), [false, 'manual']);
    assert.equal((await occurrences(tx, rid)).length, 0);
  });
});
await test('priority and combined causes: the motive follows the strongest cause that remains; resume only when none remains', async () => {
  await scenario(async tx => {
    const rid = await mkRecipe(tx, { scope: 'individual', barbero: W.bar1 });
    await tx.query('UPDATE barberos SET activo=false WHERE id=$1', [W.bar1]);
    await tx.query('UPDATE sucursales SET activa=false WHERE id=$1', [W.S1]);
    assert.deepEqual(await state(tx, rid), [false, 'sucursal_inactiva']);
    await tx.query('UPDATE sucursales SET activa=true WHERE id=$1', [W.S1]);
    assert.deepEqual(await state(tx, rid), [false, 'barbero_inactivo'], 'the sucursal is back but the person is still inactive');
    await tx.query('UPDATE barberos SET activo=true WHERE id=$1', [W.bar1]);
    assert.deepEqual(await state(tx, rid), [true, null]);
  });
});
await test('deactivating/reactivating a sucursal the way the app does it (availability off first, then inactive; snapshot restore, then active)', async () => {
  await scenario(async tx => {
    const team = await mkRecipe(tx, { scope: 'team', titulo: 'cascada equipo' });
    const ind = await mkRecipe(tx, { scope: 'individual', barbero: W.bar1, titulo: 'cascada individual' });
    await tx.query('UPDATE barberos_sucursales SET disponible=false WHERE sucursal_id=$1', [W.S1]);
    assert.deepEqual([await state(tx, team), await state(tx, ind)], [[true, null], [true, null]], 'availability alone pauses nothing');
    await tx.query('UPDATE sucursales SET activa=false WHERE id=$1', [W.S1]);
    assert.deepEqual([await state(tx, team), await state(tx, ind)], [[false, 'sucursal_inactiva'], [false, 'sucursal_inactiva']]);
    await tx.query('UPDATE barberos_sucursales SET disponible=true WHERE sucursal_id=$1 AND barbero_id=$2', [W.S1, W.bar1]);
    assert.deepEqual(await state(tx, ind), [false, 'sucursal_inactiva']);
    await tx.query('UPDATE sucursales SET activa=true WHERE id=$1', [W.S1]);
    assert.deepEqual([await state(tx, team), await state(tx, ind)], [[true, null], [true, null]]);
  });
});
await test('a person cannot resume by hand while the resource is inactive (clear message) and cannot create on an inactive sucursal or barbero', async () => {
  await scenario(async tx => {
    const rid = await mkRecipe(tx, { scope: 'team' });
    await tx.query('UPDATE sucursales SET activa=false WHERE id=$1', [W.S1]);
    await client(tx, 'ownerA');
    await fails(tx, 'UPDATE tareas_recurrentes SET activo=true WHERE id=$1', [rid], /sucursal está inactiva/);
    await fails(tx, `INSERT INTO tareas_recurrentes(organization_id,sucursal_id,titulo,assignment_scope,repeat_preset,fecha_inicio,proxima_fecha) VALUES ($1,$2,'x','team','daily','2026-10-12','2026-10-12')`, [W.orgA, W.S1], /sucursal está inactiva/);
    await owner(tx);
    await tx.query('UPDATE sucursales SET activa=true WHERE id=$1', [W.S1]);
    await tx.query('UPDATE barberos SET activo=false WHERE id=$1', [W.bar3]);
    await client(tx, 'ownerA');
    await fails(tx, `INSERT INTO tareas_recurrentes(organization_id,sucursal_id,titulo,assignment_scope,asignado_a,repeat_preset,fecha_inicio,proxima_fecha) VALUES ($1,$2,'x','individual',$3,'daily','2026-10-12','2026-10-12')`, [W.orgA, W.S1, W.bar3], /persona asignada está inactiva/);
  });
});
await test('safety net: with the triggers off, the engine still pauses (and does not generate for) a recipe whose resource went inactive, and resumes it when it is back', async () => {
  await scenario(async tx => {
    const rid = await mkRecipe(tx, { scope: 'team', proxima: '2026-10-12' });
    await tx.exec('ALTER TABLE sucursales DISABLE TRIGGER trg_tareas_auto_sync');
    await tx.query('UPDATE sucursales SET activa=false WHERE id=$1', [W.S1]);
    assert.deepEqual(await state(tx, rid), [true, null], 'no trigger fired');
    assert.equal(await engine(tx), 0);
    assert.deepEqual(await state(tx, rid), [false, 'sucursal_inactiva']);
    await tx.query('UPDATE sucursales SET activa=true WHERE id=$1', [W.S1]);
    assert.equal(await engine(tx), 1, 'hourly self-healing: resumed and generated in the same run');
    assert.deepEqual(await state(tx, rid), [true, null]);
  });
});

// ---------------------------------------------------------------------------------------------------------
// Editing: only a schedule change moves proxima_fecha.
// ---------------------------------------------------------------------------------------------------------
await test('edit: title, description, hour, assignment and even a re-sent identical schedule never move proxima_fecha; the client cannot set it', async () => {
  await scenario(async tx => {
    const rid = await mkRecipe(tx, { preset: 'monthly', inicio: '2026-05-26', proxima: '2026-10-26' });
    await tx.exec('UPDATE tareas_recurrentes SET repeat_interval=1 WHERE id=\'' + rid + '\'');   // legacy shape: monthly with interval 1
    await client(tx, 'ownerA');
    await tx.query(`UPDATE tareas_recurrentes SET titulo='Nuevo titulo' WHERE id=$1`, [rid]);
    await tx.query(`UPDATE tareas_recurrentes SET descripcion='Nueva descripcion', hora='08:15' WHERE id=$1`, [rid]);
    await tx.query(`UPDATE tareas_recurrentes SET assignment_scope='individual', asignado_a=$2, asignado_nombre='Otro' WHERE id=$1`, [rid, W.bar3]);
    await tx.query(`UPDATE tareas_recurrentes SET proxima_fecha='2030-01-01', titulo='Con proxima forjada' WHERE id=$1`, [rid]);
    // what the form re-sends on every save:
    await tx.query(`UPDATE tareas_recurrentes SET repeat_preset='monthly', repeat_frequency=NULL, repeat_interval=NULL, repeat_byweekday=NULL, fecha_inicio='2026-05-26' WHERE id=$1`, [rid]);
    assert.equal((await recipe(tx, rid)).proxima, '2026-10-26');
  });
});
await test('edit: changing the schedule (preset, interval, weekdays or start date) DOES recompute proxima_fecha with the canonical calendar', async () => {
  await scenario(async tx => {
    const hoy = await realToday(tx);
    const rid = await mkRecipe(tx, { preset: 'monthly', inicio: '2026-05-26', proxima: '2026-10-26' });
    // After the save the server has already generated today's occurrence when today is in the series, so the next date is the one after it.
    const exp = async (inicio, preset, freq, interval, byday) => {
      const sig = after => val(tx, `SELECT public._tareas_auto_siguiente($1::date,$2,$3,$4::int,$5::int[],$6::date)::text`, [inicio, preset, freq, interval, byday, after]);
      const first = await sig(String(await val(tx, `SELECT (GREATEST($1::date,$2::date)-1)::text`, [inicio, hoy])));
      return first === hoy ? sig(hoy) : first;
    };
    const start20 = String(await val(tx, `SELECT ($1::date+20)::text`, [hoy]));
    const [e1, e2, e3] = [await exp('2026-05-26', 'biweekly', null, null, null), await exp('2026-05-26', 'custom', 'weekly', 2, [1, 4]), await exp(start20, 'custom', 'weekly', 2, [1, 4])];
    await client(tx, 'ownerA');
    await tx.query(`UPDATE tareas_recurrentes SET repeat_preset='biweekly' WHERE id=$1`, [rid]);
    assert.equal((await recipe(tx, rid)).proxima, e1);
    await tx.query(`UPDATE tareas_recurrentes SET repeat_preset='custom', repeat_frequency='weekly', repeat_interval=2, repeat_byweekday='{1,4}' WHERE id=$1`, [rid]);
    assert.equal((await recipe(tx, rid)).proxima, e2);
    await tx.query(`UPDATE tareas_recurrentes SET fecha_inicio=$2::date+20 WHERE id=$1`, [rid, hoy]);
    assert.equal((await recipe(tx, rid)).proxima, e3);
  });
});
await test('edit: a client cannot write the pause motive, its timestamp or the recovery trace', async () => {
  await scenario(async tx => {
    const rid = await mkRecipe(tx, { scope: 'team' });
    await client(tx, 'ownerA');
    await tx.query(`UPDATE tareas_recurrentes SET pausa_motivo='sucursal_inactiva', pausada_at=now(), recuperacion_tipo='omitida', recuperaciones=9, recuperacion_fecha='2020-01-01' WHERE id=$1`, [rid]);
    const r = await recipe(tx, rid);
    assert.deepEqual([r.activo, r.pausa_motivo, r.pausada_at, r.recuperacion_tipo, r.recuperaciones, r.rec_fecha], [true, null, null, null, 0, null]);
    await tx.query(`UPDATE tareas_recurrentes SET activo=false WHERE id=$1`, [rid]);
    assert.deepEqual(await state(tx, rid), [false, 'manual']);
    await tx.query(`UPDATE tareas_recurrentes SET activo=true WHERE id=$1`, [rid]);
    assert.deepEqual(await state(tx, rid), [true, null]);
  });
});
await test('edit: an invalid schedule is rejected for a client (never, custom without frequency, interval 0)', async () => {
  await scenario(async tx => {
    const rid = await mkRecipe(tx, { scope: 'team' });
    await client(tx, 'ownerA');
    await fails(tx, `UPDATE tareas_recurrentes SET repeat_preset='never' WHERE id=$1`, [rid], /no es válida/);
    await fails(tx, `UPDATE tareas_recurrentes SET repeat_preset='custom', repeat_frequency=NULL WHERE id=$1`, [rid], /no es válida/);
    await fails(tx, `UPDATE tareas_recurrentes SET repeat_preset='custom', repeat_frequency='daily', repeat_interval=0 WHERE id=$1`, [rid], /no es válida/);
  });
});

// ---------------------------------------------------------------------------------------------------------
// Vencimientos: pendiente and en_progreso.
// ---------------------------------------------------------------------------------------------------------
await test('vencimientos: pendiente becomes vencida; en_progreso stays en_progreso but is marked overdue (vencida_at); each notifies once', async () => {
  await scenario(async tx => {
    await tx.query(`INSERT INTO tareas(organization_id,sucursal_id,tipo,titulo,estado,assignment_scope,asignado_a_id,fecha_inicio,creado_por_nombre)
      VALUES ($1,$2,'tarea','V pendiente','pendiente','individual',$3,CURRENT_DATE-8,'Sistema'),($1,$2,'tarea','V en progreso','en_progreso','individual',$3,CURRENT_DATE-8,'Sistema'),
             ($1,$2,'tarea','V al dia','pendiente','team',NULL,CURRENT_DATE,'Sistema'),($1,$2,'tarea','V completada','completada','team',NULL,CURRENT_DATE-8,'Sistema')`, [W.orgA, W.S1, W.bar1]);
    await tx.exec('RESET ROLE; SET LOCAL ROLE service_role');
    assert.equal(await val(tx, 'SELECT public.process_vencimientos_tareas()'), 2);
    assert.equal(await val(tx, 'SELECT public.process_vencimientos_tareas()'), 0, 'idempotent');
    await owner(tx);
    const st = Object.fromEntries((await rows(tx, `SELECT titulo, estado, vencida_at IS NOT NULL AS venc FROM tareas WHERE titulo LIKE 'V %'`)).map(r => [r.titulo, [r.estado, r.venc]]));
    assert.deepEqual(st, { 'V pendiente': ['vencida', true], 'V en progreso': ['en_progreso', true], 'V al dia': ['pendiente', false], 'V completada': ['completada', false] });
    for (const t of ['V pendiente', 'V en progreso']) assert.deepEqual(await recipientsOfTitle(tx, 'tarea_vencida', t), ['barberS1', 'barberS1b', 'gmA', 'mgrS1', 'ownerA']);
    // finishing it later keeps the "resolved late" evidence
    await tx.query(`UPDATE tareas SET estado='completada' WHERE titulo='V en progreso'`);
    assert.notEqual((await one(tx, `SELECT vencida_at FROM tareas WHERE titulo='V en progreso'`)).vencida_at, null);
  });
});
await test('vencimientos: the deadline follows tareas_vencimiento_dias_default and the organization\'s own day', async () => {
  await scenario(async tx => {
    await tx.query(`UPDATE organizations SET tareas_vencimiento_dias_default=3 WHERE id=$1`, [W.orgA]);
    await tx.query(`INSERT INTO tareas(organization_id,sucursal_id,tipo,titulo,estado,assignment_scope,fecha_inicio) VALUES ($1,$2,'tarea','W2 dias','en_progreso','team',CURRENT_DATE-2),($1,$2,'tarea','W4 dias','en_progreso','team',CURRENT_DATE-5)`, [W.orgA, W.S1]);
    await tx.exec('RESET ROLE; SET LOCAL ROLE service_role');
    assert.equal(await val(tx, 'SELECT public.process_vencimientos_tareas()'), 1);
    await owner(tx);
    assert.equal((await one(tx, `SELECT vencida_at IS NOT NULL AS v FROM tareas WHERE titulo='W2 dias'`)).v, false);
    assert.equal((await one(tx, `SELECT vencida_at IS NOT NULL AS v FROM tareas WHERE titulo='W4 dias'`)).v, true);
  });
});

// ---------------------------------------------------------------------------------------------------------
// Recipients: barbero -> user through profiles.barbero_id.
// ---------------------------------------------------------------------------------------------------------
await test('recipients: _notif_barbero_users maps a barbero to ALL its users via profiles.barbero_id; never to its own id; other organizations see nothing', async () => {
  await scenario(async tx => {
    const users = async (org, b) => (await rows(tx, 'SELECT * FROM public._notif_barbero_users($1::uuid,$2::uuid)', [org, b])).map(r => LABEL[Object.values(r)[0]]).sort();
    assert.deepEqual(await users(W.orgA, W.bar1), ['barberS1', 'barberS1b']);
    assert.deepEqual(await users(W.orgA, W.bar3), [], 'a barbero without a user');
    assert.deepEqual(await users(W.orgB, W.bar1), [], 'a barbero of another organization');
    assert.deepEqual(await users(W.orgA, W.barB1), []);
  });
});
await test('recipients: an engine-generated individual task notifies the barbero\'s USERS, admins and the sucursal manager - and a barbero without a user just doesn\'t get one', async () => {
  await scenario(async tx => {
    await mkRecipe(tx, { scope: 'individual', barbero: W.bar1, titulo: 'Para bar1', proxima: '2026-10-12' });
    await mkRecipe(tx, { scope: 'individual', barbero: W.bar3, titulo: 'Para bar3', proxima: '2026-10-12' });
    await engine(tx);
    assert.deepEqual(await recipientsOfTitle(tx, 'tarea_asignada', 'Para bar1'), ['barberS1', 'barberS1b', 'gmA', 'mgrS1', 'ownerA']);
    assert.deepEqual(await recipientsOfTitle(tx, 'tarea_asignada', 'Para bar3'), ['gmA', 'mgrS1', 'ownerA']);
    assert.equal(await val(tx, `SELECT count(*)::int FROM notification_deliveries WHERE user_id IN ($1,$2,$3)`, [W.bar1, W.bar2, W.bar3]), 0, 'no delivery to a barbero id');
  });
});
await test('recipients: a team occurrence goes to admins, the sucursal manager, the barberos available there and the sucursal account', async () => {
  await scenario(async tx => {
    await mkRecipe(tx, { scope: 'team', titulo: 'Para el equipo', proxima: '2026-10-12' });
    await engine(tx);
    assert.deepEqual(await recipientsOfTitle(tx, 'tarea_equipo_asignada', 'Para el equipo'), ['barberS1', 'barberS1b', 'gmA', 'mgrS1', 'ownerA', 'saS1']);
  });
});
await test('recipients: the "barbero removed from sucursal" notice excludes the barbero\'s own users (an owner who is also a barbero)', async () => {
  await scenario(async tx => {
    await tx.query(`UPDATE barberos_sucursales SET disponible=false WHERE barbero_id=$1 AND sucursal_id=$2`, [W.barOwnerA, W.S1]);
    const to = await recipientsOfTitle(tx, 'barbero_removido_sucursal', `Barbero barOwnerA Sintetico fue deshabilitado en S1.`);
    assert.deepEqual(to, ['gmA', 'mgrS1']);
    await tx.query(`UPDATE barberos_sucursales SET disponible=false WHERE barbero_id=$1 AND sucursal_id=$2`, [W.bar3, W.S1]);
    assert.deepEqual(await recipientsOfTitle(tx, 'barbero_removido_sucursal', `Barbero bar3 Sintetico fue deshabilitado en S1.`), ['gmA', 'mgrS1', 'ownerA']);
  });
});
await test('visibility: the barbero now sees his generated task and the team one (tipo=tarea) but not other people\'s', async () => {
  await scenario(async tx => {
    await mkRecipe(tx, { scope: 'individual', barbero: W.bar1, titulo: 'Mia', proxima: '2026-10-12' });
    await mkRecipe(tx, { scope: 'individual', barbero: W.bar3, titulo: 'De otro', proxima: '2026-10-12' });
    await mkRecipe(tx, { scope: 'team', titulo: 'De todos', proxima: '2026-10-12' });
    await engine(tx);
    await client(tx, 'barberS1');
    const seen = (await rows(tx, `SELECT titulo FROM tareas WHERE titulo IN ('Mia','De otro','De todos') ORDER BY titulo`)).map(r => r.titulo);
    assert.deepEqual(seen, ['De todos', 'Mia']);
    const recipes = (await rows(tx, `SELECT titulo FROM tareas_recurrentes WHERE titulo IN ('Mia','De otro','De todos') ORDER BY titulo`)).map(r => r.titulo);
    assert.deepEqual(recipes, ['De todos', 'Mia']);
  });
});

// ---------------------------------------------------------------------------------------------------------
// Multi-tenant isolation.
// ---------------------------------------------------------------------------------------------------------
await test('multi-tenant: the engine only generates inside each organization; reconciling another organization touches nothing', async () => {
  await scenario(async tx => {
    const a = await mkRecipe(tx, { org: W.orgA, suc: W.S1, titulo: 'Solo A', proxima: '2026-10-12' });
    const b = await mkRecipe(tx, { org: W.orgB, suc: W.SB1, titulo: 'Solo B', proxima: '2026-10-12' });
    await engine(tx);
    const [oa] = await occurrences(tx, a), [ob] = await occurrences(tx, b);
    assert.deepEqual([oa.organization_id, oa.sucursal_id, ob.organization_id, ob.sucursal_id], [W.orgA, W.S1, W.orgB, W.SB1]);
    await tx.query('UPDATE sucursales SET activa=false WHERE id=$1', [W.S1]);
    // wrong tenant on purpose: org B asking to reconcile A's sucursal / barbero changes nothing of A
    const before = await state(tx, a);
    assert.equal(await val(tx, 'SELECT public._tareas_auto_reconciliar($1::uuid,$2::uuid,NULL)', [W.orgB, W.S1]), 0);
    assert.equal(await val(tx, 'SELECT public._tareas_auto_reconciliar($1::uuid,NULL,$2::uuid)', [W.orgB, W.bar1]), 0);
    assert.deepEqual(await state(tx, a), before);
    assert.deepEqual(await state(tx, b), [true, null]);
  });
});
await test('multi-tenant: the notification of a pause is visible only to its recipients of that organization (Etapa 1 isolation holds)', async () => {
  await scenario(async tx => {
    await mkRecipe(tx, { scope: 'team', titulo: 'Aislada', proxima: '2026-10-12' });
    await tx.query('UPDATE sucursales SET activa=false WHERE id=$1', [W.S1]);
    const seenBy = async user => { await client(tx, user); const n = await val(tx, `SELECT count(*)::int FROM notifications WHERE title='Aislada'`); await owner(tx); return n; };
    assert.equal(await seenBy('ownerA'), 1);
    assert.equal(await seenBy('mgrS1'), 1);
    for (const u of ['barberS1', 'saS1', 'mgrS2', 'ownerB', 'barberB', 'ownerM']) assert.equal(await seenBy(u), 0, `${u} must not see it`);
  });
});
await test('multi-tenant: another organization cannot read, change or create against these recipes, and the trigger rejects foreign sucursales / people', async () => {
  await scenario(async tx => {
    const a = await mkRecipe(tx, { org: W.orgA, suc: W.S1, titulo: 'Privada de A' });
    await client(tx, 'ownerB');
    assert.equal(await val(tx, 'SELECT count(*)::int FROM tareas_recurrentes WHERE id=$1', [a]), 0);
    assert.equal((await tx.query(`UPDATE tareas_recurrentes SET titulo='Pisada' WHERE id=$1`, [a])).affectedRows, 0);
    await fails(tx, `INSERT INTO tareas_recurrentes(organization_id,sucursal_id,titulo,assignment_scope,repeat_preset,fecha_inicio,proxima_fecha) VALUES ($1,$2,'x','team','daily','2026-10-12','2026-10-12')`, [W.orgA, W.S1], /row-level security|42501/);
    await fails(tx, `INSERT INTO tareas_recurrentes(organization_id,sucursal_id,titulo,assignment_scope,repeat_preset,fecha_inicio,proxima_fecha) VALUES ($1,$2,'x','team','daily','2026-10-12','2026-10-12')`, [W.orgB, W.S1], /sucursal no pertenece/);
    await fails(tx, `INSERT INTO tareas_recurrentes(organization_id,sucursal_id,titulo,assignment_scope,asignado_a,repeat_preset,fecha_inicio,proxima_fecha) VALUES ($1,$2,'x','individual',$3,'daily','2026-10-12','2026-10-12')`, [W.orgB, W.SB1, W.bar1], /persona asignada no pertenece/);
    await owner(tx);
    assert.equal((await recipe(tx, a)).titulo, 'Privada de A');
  });
});

// ---------------------------------------------------------------------------------------------------------
// Error isolation.
// ---------------------------------------------------------------------------------------------------------
await test('error isolation: a defective automation does not stop the others (same organization or another one)', async () => {
  await scenario(async tx => {
    const bad = await mkRecipe(tx, { org: W.orgA, titulo: 'BOOM', proxima: '2026-10-12' });
    const ok = await mkRecipe(tx, { org: W.orgA, titulo: 'Sana A', proxima: '2026-10-12' });
    const okB = await mkRecipe(tx, { org: W.orgB, suc: W.SB1, titulo: 'Sana B', proxima: '2026-10-12' });
    await tx.exec(`CREATE FUNCTION public.t_boom() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.titulo = 'BOOM' THEN RAISE EXCEPTION 'defecto sintetico'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER t_boom BEFORE INSERT ON public.tareas FOR EACH ROW EXECUTE FUNCTION public.t_boom();`);
    assert.equal(await engine(tx), 2);
    assert.equal((await occurrences(tx, bad)).length, 0);
    assert.equal((await occurrences(tx, ok)).length, 1);
    assert.equal((await occurrences(tx, okB)).length, 1);
    assert.equal((await recipe(tx, bad)).proxima, '2026-10-12', 'the defective one is left untouched and will be retried');
  });
});
await test('error isolation: a failing row in the vencimientos job does not stop the rest', async () => {
  await scenario(async tx => {
    await tx.query(`INSERT INTO tareas(organization_id,sucursal_id,tipo,titulo,estado,assignment_scope,fecha_inicio) VALUES ($1,$2,'tarea','BOOM','pendiente','team',CURRENT_DATE-9),($1,$2,'tarea','Buena','pendiente','team',CURRENT_DATE-9)`, [W.orgA, W.S1]);
    await tx.exec(`CREATE FUNCTION public.t_boom2() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.title = 'BOOM' THEN RAISE EXCEPTION 'defecto sintetico'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER t_boom2 BEFORE INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.t_boom2();`);
    await tx.exec('RESET ROLE; SET LOCAL ROLE service_role');
    assert.equal(await val(tx, 'SELECT public.process_vencimientos_tareas()'), 1);
    await owner(tx);
    const st = Object.fromEntries((await rows(tx, `SELECT titulo, estado FROM tareas WHERE titulo IN ('BOOM','Buena')`)).map(r => [r.titulo, r.estado]));
    assert.deepEqual(st, { BOOM: 'pendiente', Buena: 'vencida' });
  });
});

// ---------------------------------------------------------------------------------------------------------
// Constraints and legacy compatibility.
// ---------------------------------------------------------------------------------------------------------
await test('integrity: estado is limited to the app\'s set; tipo admin cannot be created again but historic admin rows keep working (including deleting their recipe)', async () => {
  await scenario(async tx => {
    await fails(tx, `INSERT INTO tareas(organization_id,sucursal_id,tipo,titulo,estado,assignment_scope) VALUES ($1,$2,'tarea','x','cancelada','team')`, [W.orgA, W.S1], /tareas_estado_check|23514/);
    await fails(tx, `INSERT INTO tareas(organization_id,sucursal_id,tipo,titulo,assignment_scope) VALUES ($1,$2,'admin','x','team')`, [W.orgA, W.S1], /Tipo de tarea no válido/);
    const rid = await mkRecipe(tx, { titulo: 'Con historico' });
    await tx.exec('ALTER TABLE tareas DISABLE TRIGGER trg_tareas_tipo_guard');
    await tx.query(`INSERT INTO tareas(organization_id,sucursal_id,tipo,titulo,assignment_scope,recurrencia_id,fecha_inicio) VALUES ($1,$2,'admin','Historica','team',$3,'2026-09-01')`, [W.orgA, W.S1, rid]);
    await tx.exec('ALTER TABLE tareas ENABLE TRIGGER trg_tareas_tipo_guard');
    await tx.query(`UPDATE tareas SET titulo='Historica editada' WHERE titulo='Historica'`);
    await tx.query(`INSERT INTO tareas(organization_id,sucursal_id,tipo,titulo,assignment_scope) VALUES ($1,$2,'tarea','Normal','team')`, [W.orgA, W.S1]);
    await fails(tx, `UPDATE tareas SET tipo='admin' WHERE titulo='Normal'`, [], /Tipo de tarea no válido/);
    await client(tx, 'ownerA');
    await tx.query('DELETE FROM tareas_recurrentes WHERE id=$1', [rid]);   // FK SET NULL updates the historic admin row
    await owner(tx);
    assert.equal((await one(tx, `SELECT recurrencia_id FROM tareas WHERE titulo='Historica editada'`)).recurrencia_id, null);
  });
});
await test('integrity: the CHECK constraints are the last line of defence even if the preparation trigger were off', async () => {
  await scenario(async tx => {
    await tx.exec('ALTER TABLE tareas_recurrentes DISABLE TRIGGER trg_tareas_recurrentes_prepare');
    const ins = (extra) => `INSERT INTO tareas_recurrentes(organization_id,sucursal_id,titulo,assignment_scope,fecha_inicio,proxima_fecha,${extra[0]}) VALUES ('${W.orgA}','${W.S1}','x','team','2026-10-12','2026-10-12',${extra[1]})`;
    await fails(tx, ins(['repeat_preset', `'never'`]), [], /repeat_preset_check/);
    await fails(tx, ins(['repeat_preset', `'custom'`]), [], /repeat_custom_check/);
    await fails(tx, ins(['repeat_interval', `150`]), [], /repeat_interval_check/);
    await fails(tx, ins(['repeat_byweekday', `'{9}'`]), [], /repeat_byweekday_check/);
    await fails(tx, ins(['activo', `false`]), [], /activo_pausa_check/);
    await fails(tx, ins(['activo, pausa_motivo', `false,'cualquiera'`]), [], /pausa_motivo_check/);
  });
});

// ---------------------------------------------------------------------------------------------------------
// Privileges, SECURITY DEFINER hygiene and Etapa 1 regression.
// ---------------------------------------------------------------------------------------------------------
const NEW_INTERNAL = [
  'public._tareas_auto_lunes(date)', 'public._tareas_auto_regla(date,text,text,integer,integer[])', 'public._tareas_auto_en_semana(date,date,integer,integer[])',
  'public._tareas_auto_siguiente(date,text,text,integer,integer[],date)', 'public._tareas_auto_vigente(date,text,text,integer,integer[],date)',
  'public._tareas_auto_hoy(uuid,timestamptz)', 'public._tareas_auto_tz_valida(uuid)', 'public._tareas_auto_motivo_pausa(uuid,uuid,text,uuid)',
  'public._tareas_auto_notificar_pausa(uuid,uuid,uuid,text,text,timestamptz)', 'public._tareas_auto_reconciliar(uuid,uuid,uuid,timestamptz)',
  'public._tareas_auto_generar(uuid,timestamptz)', 'public._tareas_auto_procesar(timestamptz)', 'public._notif_barbero_users(uuid,uuid)',
  'public.trg_tareas_recurrentes_prepare()', 'public.trg_tareas_recurrentes_generar()', 'public.trg_tareas_auto_sync_barberos()',
  'public.trg_tareas_auto_sync_sucursales()', 'public.trg_tareas_auto_sync_barberos_sucursales()', 'public.trg_tareas_tipo_guard()',
];
const canExecute = async (role, signature) => (await db.query(`SELECT has_function_privilege($1, to_regprocedure($2), 'EXECUTE') AS ok`, [role, signature])).rows[0].ok;
const publicExecute = async signature => (await db.query(`SELECT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  WHERE p.oid = to_regprocedure($1) AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS ok`, [signature])).rows[0].ok;
await test('privileges: every new internal function is closed to PUBLIC, anon, authenticated and service_role; the cron entrypoints are service_role only', async () => {
  for (const sig of NEW_INTERNAL) {
    assert((await db.query('SELECT to_regprocedure($1) IS NOT NULL AS ok', [sig])).rows[0].ok, `${sig} exists`);
    for (const role of ['anon', 'authenticated', 'service_role']) assert.equal(await canExecute(role, sig), false, `${role} must not execute ${sig}`);
    assert.equal(await publicExecute(sig), false, `PUBLIC must not execute ${sig}`);
  }
  for (const sig of ['public.process_tareas_recurrentes()', 'public.process_vencimientos_tareas()']) {
    assert.equal(await canExecute('service_role', sig), true);
    for (const role of ['anon', 'authenticated']) assert.equal(await canExecute(role, sig), false);
    assert.equal(await publicExecute(sig), false);
  }
});
await test('privileges: clients get "permission denied" calling the engine, the helpers or the cron entrypoints; the triggers still fire for them', async () => {
  await scenario(async tx => {
    const calls = [`SELECT public._tareas_auto_procesar(now())`, `SELECT public._tareas_auto_hoy('${W.orgA}'::uuid)`, `SELECT * FROM public._notif_barbero_users('${W.orgA}'::uuid,'${W.bar1}'::uuid)`,
      `SELECT public._tareas_auto_reconciliar('${W.orgA}'::uuid)`, `SELECT public.process_tareas_recurrentes()`];
    for (const [role, user] of [['authenticated', 'ownerA'], ['anon', null], ['service_role', null]]) {
      for (const call of calls) {
        if (role === 'service_role' && call.includes('process_tareas_recurrentes')) continue;
        await client(tx, user, role);
        await fails(tx, call, [], /permission denied/);
      }
    }
    await client(tx, 'ownerA');
    assert.equal((await one(tx, `INSERT INTO tareas_recurrentes(organization_id,sucursal_id,titulo,assignment_scope,repeat_preset,fecha_inicio,proxima_fecha) VALUES ($1,$2,'Dispara triggers','team','weekly','2099-01-01','2099-01-01') RETURNING proxima_fecha::text AS p`, [W.orgA, W.S1])).p, '2099-01-01');
  });
});
await test('security definer hygiene: every new SECURITY DEFINER function has an empty search_path and the same owner as the notification helpers', async () => {
  const defs = (await db.query(`SELECT p.proname, p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner) AS owner FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND (p.proname LIKE '\\_tareas\\_auto\\_%' OR p.proname LIKE 'trg\\_tareas\\_%' OR p.proname IN ('_notif_barbero_users','process_tareas_recurrentes','process_vencimientos_tareas','trg_barberos_sucursales_after_disponible_off_notif'))`)).rows;
  assert(defs.length >= 20);
  const definers = defs.filter(d => d.prosecdef);
  const legacy = ['trg_tareas_after_update_notif', 'trg_tareas_block_barber_peticion'];   // untouched by Etapa 2
  assert.deepEqual(definers.map(d => d.proname).filter(n => !legacy.includes(n)).sort(), [
    'process_tareas_recurrentes', 'process_vencimientos_tareas', 'trg_barberos_sucursales_after_disponible_off_notif', 'trg_tareas_after_insert_notif',
    'trg_tareas_auto_sync_barberos', 'trg_tareas_auto_sync_barberos_sucursales', 'trg_tareas_auto_sync_sucursales', 'trg_tareas_recurrentes_generar', 'trg_tareas_recurrentes_prepare']);
  for (const d of definers) {
    if (legacy.includes(d.proname)) continue;
    assert((d.proconfig ?? []).some(c => /^search_path=("")?$/.test(c)), d.proname + " must pin search_path to ''");
    assert.equal(d.owner, 'app_owner');
  }
  for (const d of defs.filter(d => !d.prosecdef)) assert((d.proconfig ?? []).some(c => /^search_path=("")?$/.test(c)), `${d.proname} (invoker) pins search_path`);
});
await test('Etapa 1 regression: the closed helpers stay closed, the only client RPC is still notif_emit_view_event, and deliveries stay the only read authorization', async () => {
  const funcs = (await db.query(`SELECT p.oid::regprocedure::text AS sig, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND (p.proname LIKE '\\_notif%' OR p.proname LIKE 'notif\\_%' OR p.proname LIKE 'upsert\\_notification%')`)).rows;
  assert(funcs.length >= 14);
  for (const f of funcs) for (const role of ['anon', 'authenticated', 'service_role']) {
    const allowed = f.proname === 'notif_emit_view_event' && role === 'authenticated';
    assert.equal(await canExecute(role, f.sig), allowed, `${role} on ${f.sig}`);
  }
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM pg_proc WHERE proname LIKE 'upsert\\_notification%'`)).rows[0].n, 0, 'the removed RPCs did not come back');
  await scenario(async tx => {
    await mkRecipe(tx, { scope: 'team', titulo: 'Reservada', proxima: '2026-10-12' });
    await tx.query('UPDATE sucursales SET activa=false WHERE id=$1', [W.S1]);
    await client(tx, 'barberS1');
    await fails(tx, `INSERT INTO notifications(organization_id,event_key,type,source_module,title) VALUES ($1,'forjada','forjado','tareas','x')`, [W.orgA], /permission denied|row-level/);
    assert.equal(await val(tx, `SELECT count(*)::int FROM notifications WHERE title='Reservada'`), 0);
  });
});

// ---------------------------------------------------------------------------------------------------------
// The migrations' own safety checks.
// ---------------------------------------------------------------------------------------------------------
await test('the migrations can be re-applied (idempotent) without changing the behaviour', async () => {
  for (const name of E2) await asOwner(db, await read(name));
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM pg_trigger WHERE tgname IN ('trg_tareas_recurrentes_prepare','trg_tareas_recurrentes_generar','trg_tareas_tipo_guard') AND NOT tgisinternal`)).rows[0].n, 3);
  await scenario(async tx => {
    const rid = await mkRecipe(tx, { preset: 'daily', proxima: '2026-10-12' });
    assert.equal(await engine(tx), 1);
    assert.equal((await occurrences(tx, rid)).length, 1);
  });
});
await test('E2-M1 aborts if Etapa 1 (security of Notificaciones) is not applied', async () => {
  const fresh = await build('base');
  await assert.rejects(asOwner(fresh, await read(E2[0])), /Etapa 1/);
  await fresh.close();
});
await test('E2-M2 aborts when an automation points at a sucursal of another organization, and gives the existing paused ones the motive "manual"', async () => {
  const fresh = await build('m1');
  await seedWorld(fresh);
  await fresh.exec('SET session_replication_role = replica');
  await fresh.query(`INSERT INTO tareas_recurrentes(organization_id,sucursal_id,titulo,assignment_scope,repeat_preset,fecha_inicio,proxima_fecha,activo) VALUES ($1,$2,'Cruzada','team','daily','2026-10-12','2026-10-12',true)`, [W.orgB, W.S1]);
  await fresh.exec('SET session_replication_role = origin');
  await assert.rejects(asOwner(fresh, await read(E2[1])), /otra organización/);
  await fresh.exec('SET session_replication_role = replica');
  await fresh.query(`DELETE FROM tareas_recurrentes`);
  await fresh.query(`INSERT INTO tareas_recurrentes(organization_id,sucursal_id,titulo,assignment_scope,repeat_preset,fecha_inicio,proxima_fecha,activo) VALUES ($1,$2,'Pausada vieja','team','daily','2026-10-12','2026-10-12',false)`, [W.orgA, W.S1]);
  await fresh.exec('SET session_replication_role = origin');
  await asOwner(fresh, await read(E2[1]));
  assert.deepEqual((await fresh.query(`SELECT activo, pausa_motivo FROM tareas_recurrentes`)).rows, [{ activo: false, pausa_motivo: 'manual' }]);
  await fresh.close();
});
await test('E2-M2 leaves a constraint NOT VALID (and still applies) when historic rows violate it, instead of touching them', async () => {
  const fresh = await build('m1');
  await seedWorld(fresh);
  await fresh.exec('SET session_replication_role = replica');
  await fresh.query(`INSERT INTO tareas_recurrentes(organization_id,sucursal_id,titulo,assignment_scope,repeat_preset,fecha_inicio,proxima_fecha) VALUES ($1,$2,'Preset viejo','team','never','2026-10-12','2026-10-12')`, [W.orgA, W.S1]);
  await fresh.exec('SET session_replication_role = origin');
  await asOwner(fresh, await read(E2[1]));
  const c = (await fresh.query(`SELECT conname, convalidated FROM pg_constraint WHERE conname LIKE 'tareas_recurrentes_repeat_preset_check'`)).rows;
  assert.deepEqual(c, [{ conname: 'tareas_recurrentes_repeat_preset_check', convalidated: false }]);
  assert.equal((await fresh.query(`SELECT repeat_preset FROM tareas_recurrentes`)).rows[0].repeat_preset, 'never', 'the row was not modified');
  await fresh.close();
});

await test('E2-M5 migrates a pause that carries the old motive to barbero_sin_asignacion, keeps the CHECK valid and leaves other rows alone', async () => {
  const fresh = await build('m4');
  await seedWorld(fresh);
  await fresh.exec('SET session_replication_role = replica');
  await fresh.query(`INSERT INTO tareas_recurrentes(organization_id,sucursal_id,titulo,assignment_scope,asignado_a,repeat_preset,fecha_inicio,proxima_fecha,activo,pausa_motivo)
    VALUES ($1,$2,'Vieja','individual',$3,'daily','2026-10-12','2026-10-12',false,'barbero_no_disponible'),
           ($1,$2,'Manual','team',NULL,'daily','2026-10-12','2026-10-12',false,'manual'),
           ($1,$2,'Activa','team',NULL,'daily','2026-10-12','2026-10-12',true,NULL)`, [W.orgA, W.S1, W.bar2]);
  await fresh.exec('SET session_replication_role = origin');
  await asOwner(fresh, await read(E2[4]));
  const got = Object.fromEntries((await fresh.query(`SELECT titulo, activo, pausa_motivo FROM tareas_recurrentes`)).rows.map(r => [r.titulo, [r.activo, r.pausa_motivo]]));
  assert.deepEqual(got, { Vieja: [false, 'barbero_sin_asignacion'], Manual: [false, 'manual'], Activa: [true, null] });
  assert.equal((await fresh.query(`SELECT convalidated FROM pg_constraint WHERE conname='tareas_recurrentes_pausa_motivo_check'`)).rows[0].convalidated, true);
  assert.equal((await fresh.query(`SELECT count(*)::int AS n FROM pg_trigger WHERE tgname='trg_tareas_auto_sync_upd' AND pg_get_triggerdef(oid) ILIKE '%disponible%'`)).rows[0].n, 0, 'no trigger reacts to disponible any more');
  await fresh.close();
});

// ---------------------------------------------------------------------------------------------------------
// Etapa 3: backup + reset controlado (supabase/diagnostics/20261013_etapa3_reset_tareas) y migración 3B.
// Runs the operation scripts exactly as shipped, as the NON-superuser owner, on a dedicated database.
// ---------------------------------------------------------------------------------------------------------
const E3_DIR = 'supabase/diagnostics/20261013_etapa3_reset_tareas';
const E3 = { backup: `${E3_DIR}/01_backup.sql`, verificar: `${E3_DIR}/02_verificar_backup.sql`, ensayo: `${E3_DIR}/03_ensayo_restore.sql`,
  reset: `${E3_DIR}/04_reset.sql`, post: `${E3_DIR}/05_postcondiciones.sql` };
const E3B = '20261013120000_tareas_integridad_post_reset.sql';
/** Runs a whole operation script (it carries its own BEGIN/COMMIT) as the owner; returns the rows of its last SELECT. */
async function e3run(edb, path) {
  await edb.exec('SET ROLE app_owner');
  try {
    const results = await edb.exec(await read(path));
    return results.filter(r => r.rows?.length).at(-1)?.rows ?? [];
  } catch (error) {
    try { await edb.exec('ROLLBACK'); } catch { /* no open transaction */ }
    throw error;
  } finally {
    await edb.exec('RESET ROLE');
  }
}
const ids = async (edb, sql) => (await edb.query(sql)).rows.map(r => r.id).sort();
const sorted = list => [...list].sort();
const disabledTriggers = async q => (await q.query(`SELECT count(*)::int AS n FROM pg_trigger WHERE NOT tgisinternal
  AND tgrelid IN ('tareas'::regclass,'tareas_recurrentes'::regclass) AND tgenabled <> 'O'`)).rows[0].n;

const X = { R1: id(), R2: id(), RB: id(), A1: id(), A2: id(), A3: id(), TG: id(), TM: id(), P1: id(), P2: id(), TB: id(), PB: id(),
  N1: id(), N2: id(), N3: id(), N4: id(), N5: id(), N6: id(), N7: id(), PN: id(), PV: id(), O1: id(), O2: id() };
/** Legacy data like production: admin occurrences, a generated and a manual tarea, peticiones, two organizations,
 *  Tareas notifications (some orphans), a peticion_* event, another module and a "tarea" word in foreign metadata. */
async function seedLegacy(edb) {
  await edb.exec(`SET session_replication_role = replica`);
  const q = (sql, params) => edb.query(sql, params);
  await q(`INSERT INTO tareas_recurrentes(id,organization_id,sucursal_id,titulo,assignment_scope,asignado_a,repeat_preset,fecha_inicio,proxima_fecha)
    VALUES ($1,$4,$5,'R1','team',NULL,'biweekly','2026-05-12','2026-10-13'), ($2,$4,$5,'R2','individual',$7,'daily','2026-05-12','2026-10-13'),
           ($3,$6,$8,'RB','team',NULL,'weekly','2026-05-12','2026-10-13')`, [X.R1, X.R2, X.RB, W.orgA, W.S1, W.orgB, W.bar1, W.SB1]);
  const t = `INSERT INTO tareas(id,organization_id,sucursal_id,tipo,titulo,estado,assignment_scope,asignado_a_id,recurrencia_id,fecha_inicio,creado_por_id) VALUES `;
  await q(t + `($1,$9,$10,'admin','A1','pendiente','team',NULL,$11,'2026-10-01',NULL), ($2,$9,$10,'admin','A2','pendiente','team',NULL,$11,'2026-10-02',NULL),
    ($3,$9,$10,'admin','A3','pendiente','team',NULL,$11,'2026-10-03',NULL), ($4,$9,$10,'tarea','TG','completada','individual',$12,$13,'2026-10-05',NULL),
    ($5,$9,$10,'tarea','TM','pendiente','individual',$12,NULL,NULL,NULL), ($6,$9,$10,'peticion','P1','pendiente','individual',NULL,NULL,NULL,$14),
    ($7,$9,$10,'peticion','P2','aprobada','individual',NULL,NULL,NULL,$14), ($8,$15,$16,'tarea','TB','pendiente','team',NULL,$17,'2026-10-06',NULL)`,
  [X.A1, X.A2, X.A3, X.TG, X.TM, X.P1, X.P2, X.TB, W.orgA, W.S1, X.R1, W.bar1, X.R2, W.mgrS1, W.orgB, W.SB1, X.RB]);
  await q(t + `($1,$2,$3,'peticion','PB','pendiente','individual',NULL,NULL,NULL,$4)`, [X.PB, W.orgB, W.SB1, W.ownerB]);
  const n = `INSERT INTO notifications(id,organization_id,event_key,type,source_module,source_table,source_id,title,metadata) VALUES `;
  await q(n + `($1,$12,'k1','tarea_asignada','tareas','tareas',$13,'n','{}'), ($2,$12,'k2','tarea_vencida','tareas','tareas',$14,'n','{}'),
    ($3,$12,'k3','tarea_pendiente','tareas','tareas',$15,'n','{}'), ($4,$12,'k4','tarea_equipo_asignada','tareas','tareas',$16,'n','{}'),
    ($5,$12,'k5','tarea_automatica_pausada','tareas','tareas_recurrentes',$17,'n','{}'), ($6,$12,'k6','tarea_automatica_pausada','tareas','tareas_recurrentes',$18,'n','{}'),
    ($7,$19,'k7','tarea_asignada','tareas','tareas',$20,'n','{}'), ($8,$12,'k8','peticion_nueva','tareas','tareas',$21,'n','{}'),
    ($9,$12,'k9','peticion_vencida','tareas','tareas',$22,'n','{}'), ($10,$12,'k10','turno_nuevo','turnos','turnos',$23,'una tarea de agenda','{}'),
    ($11,$12,'k11','pin_cambiado','seguridad','sucursal_action_pin_config',NULL,'tarea','{"accion":"tareas.borrar","nota":"tarea_asignada"}')`,
  [X.N1, X.N2, X.N3, X.N4, X.N5, X.N6, X.N7, X.PN, X.PV, X.O1, X.O2, W.orgA, X.TM, id(), id(), X.TG, X.R2, id(), W.orgB, X.TB, X.P1, id(), id()]);
  await q(`INSERT INTO notification_deliveries(notification_id,organization_id,user_id)
    VALUES ($1,$7,$9),($1,$7,$10),($2,$7,$9),($3,$7,$9),($4,$8,$11),($5,$7,$9),($6,$7,$9)`,
  [X.N1, X.N2, X.N5, X.N7, X.PN, X.O1, W.orgA, W.orgB, W.ownerA, W.mgrS1, W.ownerB]);
  await q(`INSERT INTO notification_reads(organization_id,user_id,source_type,source_id,notification_id)
    VALUES ($1,$2,'tarea_asignada',$3,$4),($1,$2,'peticion_nueva',$5,$6),($1,$2,'turno_nuevo',$7,$8)`,
  [W.orgA, W.ownerA, X.TM, X.N1, X.P1, X.PN, id(), X.O1]);
  await edb.exec(`SET session_replication_role = origin`);
}
const e3 = await build('m5');
await seedWorld(e3);
await e3.exec(`DO $g$ BEGIN EXECUTE format('GRANT CREATE ON DATABASE %I TO app_owner', current_database()); END $g$`);
await seedLegacy(e3);
const before = {
  notifications: await ids(e3, `SELECT id FROM notifications`),
  deliveries: await ids(e3, `SELECT id FROM notification_deliveries`),
  peticiones: (await e3.query(`SELECT * FROM tareas WHERE tipo='peticion' ORDER BY id`)).rows,
  barberos_sucursales: (await e3.query(`SELECT * FROM barberos_sucursales ORDER BY id`)).rows,
};
const KEEP_NOTIFS = sorted([X.PN, X.PV, X.O1, X.O2]);
const SCOPE = { notifications: 7, notification_deliveries: 5, notification_reads: 1, tareas: 6, tareas_recurrentes: 3 };

await test('Etapa 3B: the integrity migration refuses to run while legacy admin rows exist (and changes nothing)', async () => {
  await assert.rejects(asOwner(e3, await read(E3B)), /E3B/);
  assert.equal((await e3.query(`SELECT count(*)::int AS n FROM pg_constraint WHERE conname='tareas_tipo_check'`)).rows[0].n, 0);
  assert.equal((await e3.query(`SELECT to_regprocedure('public.trg_tareas_tipo_guard()') IS NOT NULL AS ok`)).rows[0].ok, true);
});
await test('Etapa 3 backup: copies exactly the scope (admin and tarea in, peticion out; Tareas events incl. structural orphans in; peticion_*, other modules and "tarea" in metadata out)', async () => {
  await e3run(e3, E3.backup);
  assert.deepEqual(await ids(e3, `SELECT id FROM etapa3_backup.tareas`), sorted([X.A1, X.A2, X.A3, X.TG, X.TM, X.TB]));
  assert.deepEqual(await ids(e3, `SELECT id FROM etapa3_backup.tareas_recurrentes`), sorted([X.R1, X.R2, X.RB]));
  assert.deepEqual(await ids(e3, `SELECT id FROM etapa3_backup.notifications`), sorted([X.N1, X.N2, X.N3, X.N4, X.N5, X.N6, X.N7]));
  assert.equal((await e3.query(`SELECT count(*)::int AS n FROM etapa3_backup.notification_deliveries`)).rows[0].n, 5);
  assert.equal((await e3.query(`SELECT count(*)::int AS n FROM etapa3_backup.notification_reads`)).rows[0].n, 1);
  const full = (await e3.query(`SELECT ROW(b.*) IS NOT DISTINCT FROM ROW(t.*) AS same FROM etapa3_backup.tareas b JOIN tareas t USING (id)`)).rows;
  assert(full.length === 6 && full.every(r => r.same), 'complete rows, not a column subset');
  const m = Object.fromEntries((await e3.query(`SELECT clave, cantidad, detalle FROM etapa3_backup.manifest`)).rows.map(r => [r.clave, r]));
  assert.equal(Number(m.tareas.cantidad), 6);
  assert.deepEqual(m.tareas.detalle.por_tipo, { admin: 3, tarea: 3 });
  assert.equal(Number(m.notifications.detalle.huerfanas), 3);
  assert.equal(Number(m.control_peticiones.cantidad), 3);
  for (const k of ['control_organizations', 'control_barberos', 'control_sucursales', 'control_barberos_sucursales', 'motor_etapa2', 'meta']) assert(m[k], k);
  const check = await e3run(e3, E3.verificar);
  assert(check.length >= 20 && check.every(r => r.ok), JSON.stringify(check.filter(r => !r.ok)));
});
await test('Etapa 3 backup: the schema is closed to clients and is never overwritten', async () => {
  for (const role of ['anon', 'authenticated', 'service_role']) {
    for (const sql of ['SELECT * FROM etapa3_backup.tareas', 'SELECT * FROM etapa3_backup.manifest', 'SELECT etapa3_backup.reset()']) {
      await e3.exec(`SET ROLE ${role}`);
      try { await assert.rejects(e3.query(sql), /permission denied/, `${role}: ${sql}`); } finally { await e3.exec('RESET ROLE'); }
    }
  }
  await assert.rejects(e3run(e3, E3.backup), /ya existe/);
  assert.equal((await e3.query(`SELECT count(*)::int AS n FROM etapa3_backup.tareas`)).rows[0].n, 6, 'the first backup is intact');
});
await test('Etapa 3 restore rehearsal: deletes and restores inside a sub-block that is always rolled back; nothing changes and triggers stay enabled', async () => {
  const [{ resultado }] = await e3run(e3, E3.ensayo);
  assert.equal(resultado.ensayo, 'ok');
  assert.deepEqual(resultado.borrado_simulado, SCOPE);
  assert.deepEqual(resultado.restaurado, SCOPE);
  assert.deepEqual(await ids(e3, `SELECT id FROM notifications`), before.notifications);
  assert.deepEqual(await ids(e3, `SELECT id FROM notification_deliveries`), before.deliveries);
  assert.equal(await disabledTriggers(e3), 0);
  assert((await e3run(e3, E3.verificar)).every(r => r.ok));
});
await test('Etapa 3 reset: aborts without deleting anything when a new row appeared after the backup, or when a notification cannot be classified', async () => {
  const tareasAntes = await ids(e3, `SELECT id FROM tareas`);
  const intrusos = [
    ['tareas', `INSERT INTO tareas(id,organization_id,sucursal_id,tipo,titulo,estado,assignment_scope) VALUES ($1,$2,$3,'tarea','Nueva','pendiente','team')`, i => [i, W.orgA, W.S1]],
    ['notifications', `INSERT INTO notifications(id,organization_id,event_key,type,source_module,source_table,source_id,title) VALUES ($1,$2,'kx','tarea_reasignada','tareas','tareas',$3,'n')`, i => [i, W.orgA, X.TM]],
    ['notifications', `INSERT INTO notifications(id,organization_id,event_key,type,source_module,source_table,source_id,title) VALUES ($1,$2,'ky','tarea_asignada','tareas','tareas',$3,'n')`, i => [i, W.orgA, X.P1]],
    ['notification_deliveries', `INSERT INTO notification_deliveries(id,notification_id,organization_id,user_id) VALUES ($1,$2,$3,$4)`, i => [i, X.N3, W.orgA, W.gmA]],
  ];
  for (const [table, sql, params] of intrusos) {
    const intruso = id();
    await e3.exec('SET session_replication_role = replica');
    await e3.query(sql, params(intruso));
    await e3.exec('SET session_replication_role = origin');
    await assert.rejects(e3run(e3, E3.reset), /ya no coincide/, table);
    assert.deepEqual(await ids(e3, `SELECT id FROM tareas WHERE id <> '${intruso}'`), tareasAntes);
    assert.deepEqual(await ids(e3, `SELECT id FROM notifications WHERE id <> '${intruso}'`), before.notifications);
    await e3.query(`DELETE FROM ${table} WHERE id=$1`, [intruso]);
  }
  assert((await e3run(e3, E3.verificar)).every(r => r.ok), 'back to the verified state');
});
await test('Etapa 3 reset: deletes only the scope (notifications → tareas → Tareas automáticas), cascades deliveries/reads, keeps peticiones, other modules and protected data, and notifies nobody', async () => {
  const [{ resultado }] = await e3run(e3, E3.reset);
  assert.deepEqual(resultado, SCOPE);
  assert.equal((await e3.query(`SELECT count(*)::int AS n FROM tareas WHERE tipo IN ('admin','tarea')`)).rows[0].n, 0);
  assert.equal((await e3.query(`SELECT count(*)::int AS n FROM tareas_recurrentes`)).rows[0].n, 0);
  assert.deepEqual((await e3.query(`SELECT * FROM tareas WHERE tipo='peticion' ORDER BY id`)).rows, before.peticiones, 'peticiones identical');
  assert.deepEqual(await ids(e3, `SELECT id FROM notifications`), KEEP_NOTIFS, 'only the Tareas notifications are gone; no new ones');
  assert.equal((await e3.query(`SELECT count(*)::int AS n FROM notification_deliveries`)).rows[0].n, 2, 'PN and O1 deliveries remain');
  assert.deepEqual((await e3.query(`SELECT source_type FROM notification_reads ORDER BY 1`)).rows.map(r => r.source_type), ['peticion_nueva', 'turno_nuevo']);
  assert.deepEqual((await e3.query(`SELECT * FROM barberos_sucursales ORDER BY id`)).rows, before.barberos_sucursales);
  const post = await e3run(e3, E3.post);
  assert(post.length >= 15 && post.every(r => r.ok), JSON.stringify(post.filter(r => !r.ok)));
});
await test('Etapa 3 reset: a second run changes nothing (0 rows, no error)', async () => {
  const [{ resultado }] = await e3run(e3, E3.reset);
  assert.deepEqual(resultado, { ya_aplicado: true, borradas: 0 });
  assert.deepEqual(await ids(e3, `SELECT id FROM notifications`), KEEP_NOTIFS);
  assert.equal((await e3.query(`SELECT count(*)::int AS n FROM tareas`)).rows[0].n, 3);
});
await test('Etapa 3 restore: brings back every row with its ids, recurrencia_id, source_id and timestamps (identical checksums), and leaves triggers enabled', async () => {
  try {
    await e3.transaction(async tx => {
      await tx.exec('SET LOCAL ROLE app_owner');
      await tx.query(`SELECT etapa3_backup.restaurar()`);
      const cmp = (await tx.query(`SELECT * FROM etapa3_backup.comparar_con_vivo()`)).rows;
      assert(cmp.length === 5 && cmp.every(r => r.coincide), JSON.stringify(cmp));
      assert.equal((await tx.query(`SELECT recurrencia_id FROM tareas WHERE id=$1`, [X.TG])).rows[0].recurrencia_id, X.R2);
      assert.equal((await tx.query(`SELECT source_id FROM notifications WHERE id=$1`, [X.N5])).rows[0].source_id, X.R2);
      assert.equal(await disabledTriggers(tx), 0);
      assert.equal((await tx.query(`SELECT count(*)::int AS n FROM tareas WHERE recurrencia_id = $1`, [X.R1])).rows[0].n, 3, 'restoring a recipe did not generate occurrences');
      throw ROLLBACK;
    });
  } catch (error) { if (error !== ROLLBACK) throw error; }
});
await test('Etapa 3B: the CHECK rejects admin and accepts tarea/peticion, replaces the temporary trigger, and the engine keeps generating', async () => {
  await asOwner(e3, await read(E3B));
  assert.equal((await e3.query(`SELECT to_regprocedure('public.trg_tareas_tipo_guard()') IS NULL AS gone`)).rows[0].gone, true);
  try {
    await e3.transaction(async tx => {
      await tx.exec('SET LOCAL ROLE app_owner');
      const ins = tipo => `INSERT INTO tareas(organization_id,sucursal_id,tipo,titulo,assignment_scope) VALUES ('${W.orgA}','${W.S1}','${tipo}','x','team') RETURNING id`;
      await fails(tx, ins('admin'), [], /tareas_tipo_check/);
      await fails(tx, ins('otro'), [], /tareas_tipo_check/);
      const ok = (await tx.query(ins('tarea'))).rows[0].id;
      await tx.query(ins('peticion'));
      await fails(tx, `UPDATE tareas SET tipo='admin' WHERE id='${ok}'`, [], /tareas_tipo_check/);
      // The engine still generates tipo 'tarea' occurrences under the new constraints. The recipe trigger fixes
      // proxima_fecha from the organization's real "today", so the date is derived from it (never hardcoded).
      const hoy = (await tx.query(`SELECT public._tareas_auto_hoy($1::uuid)::text AS hoy`, [W.orgA])).rows[0].hoy;
      const mediodia = (await tx.query(`SELECT (($2::date + time '12:00') AT TIME ZONE COALESCE(o.timezone, 'America/Argentina/Buenos_Aires'))::text AS ts
        FROM organizations o WHERE o.id = $1`, [W.orgA, hoy])).rows[0].ts;
      await tx.exec(`SELECT set_config('vittro.tareas_auto', 'on', true)`);
      const rid = (await tx.query(`INSERT INTO tareas_recurrentes(organization_id,sucursal_id,titulo,assignment_scope,repeat_preset,fecha_inicio,proxima_fecha)
        VALUES ($1,$2,'Post reset','team','daily',$3::date,$3::date) RETURNING id`, [W.orgA, W.S1, hoy])).rows[0].id;
      await tx.exec(`SELECT set_config('vittro.tareas_auto', '', true)`);
      assert.equal(Number((await tx.query(`SELECT public._tareas_auto_procesar($1::timestamptz) AS n`, [mediodia])).rows[0].n), 1);
      assert.equal((await tx.query(`SELECT tipo FROM tareas WHERE recurrencia_id=$1`, [rid])).rows[0].tipo, 'tarea');
      // Occurrence integrity: always 'tarea' and dated; deleting the recipe still detaches its occurrences.
      await fails(tx, `INSERT INTO tareas(organization_id,sucursal_id,tipo,titulo,assignment_scope,recurrencia_id,fecha_inicio) VALUES ('${W.orgA}','${W.S1}','peticion','x','team','${rid}','2026-10-20')`, [], /tareas_recurrencia_check/);
      await fails(tx, `INSERT INTO tareas(organization_id,sucursal_id,tipo,titulo,assignment_scope,recurrencia_id) VALUES ('${W.orgA}','${W.S1}','tarea','x','team','${rid}')`, [], /tareas_recurrencia_check/);
      await tx.query(`DELETE FROM tareas_recurrentes WHERE id=$1`, [rid]);
      assert.equal((await tx.query(`SELECT count(*)::int AS n FROM tareas WHERE titulo='Post reset' AND recurrencia_id IS NULL`)).rows[0].n, 1);
      throw ROLLBACK;
    });
  } catch (error) { if (error !== ROLLBACK) throw error; }
  const post = await e3run(e3, E3.post);
  assert(post.every(r => r.ok), JSON.stringify(post.filter(r => !r.ok)));
});
await test('Etapa 3B: after the CHECK, restoring admin rows fails safely (nothing restored, triggers enabled)', async () => {
  await assert.rejects(e3.transaction(async tx => { await tx.exec('SET LOCAL ROLE app_owner'); await tx.query(`SELECT etapa3_backup.restaurar()`); }), /tareas_tipo_check|tareas_recurrencia_check/);
  assert.equal((await e3.query(`SELECT count(*)::int AS n FROM tareas_recurrentes`)).rows[0].n, 0);
  assert.equal(await disabledTriggers(e3), 0);
});
await e3.close();

console.log(`${passed} SQL integration tests passed (local synthetic PostgreSQL, no production access).`);
await db.close();
}
