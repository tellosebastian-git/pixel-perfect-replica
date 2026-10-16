/* eslint-disable react-refresh/only-export-components -- reemplaza módulos de contexto que exportan hooks, no un componente de UI. */
// QA local de Principal → Tareas: contextos, PIN y cliente Supabase sustituidos por datos sintéticos.
// Solo lo usa qa/vite.tareas.config.ts. No es una ruta de producción ni una entrada del build.
import { todayInTimezoneIso } from '@/lib/dateUtils';

const params = new URLSearchParams(location.search);
const rol = params.get('rol') ?? 'owner';
const escenario = params.get('estado') ?? 'normal';
const TZ = 'America/Argentina/Buenos_Aires';
// `?hoy=AAAA-MM-DD`: día de la organización para revisar el aviso semanal (lunes, jueves, sábado, domingo).
const hoyParam = params.get('hoy');
const today = hoyParam && /^\d{4}-\d{2}-\d{2}$/.test(hoyParam) ? hoyParam : todayInTimezoneIso(TZ);
export function useOrganizationToday() { return today; }
const dia = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const offsetLunes = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
const base = hoyParam ? Date.parse(`${today}T18:00:00Z`) : Date.now();
const hace = (dias: number) => new Date(base - dias * 86_400_000).toISOString();
const ORG = 'org-qa';
const S1 = 's-centro';
const S2 = 's-norte';

const roles = {
  owner: { isOwner: true, canManageConfig: true, barbero: 'b-ana' },
  manager: { isManager: true, barbero: null },
  barbero: { isBarber: true, barbero: 'b-bruno' },
  cuenta: { isSucursalAccount: true, barbero: null },
}[rol] ?? { isOwner: true, canManageConfig: true, barbero: 'b-ana' };

export function useAuth() {
  return {
    isOwner: false, isGeneralManager: false, isManager: false, isBarber: false, isSucursalAccount: false, canManageConfig: false, ...roles,
    user: { id: `u-${rol}` }, profile: { id: `u-${rol}`, barbero_id: roles.barbero, full_name: 'Ana Ríos', email: 'ana@example.invalid' },
  };
}
export function useOrganization() {
  return { organization: { id: ORG, name: 'Barbería QA', timezone: TZ, tareas_vencimiento_dias_default: 1, peticiones_vencimiento_dias: 60 } };
}
const sucursales = [
  { id: S1, nombre: 'Centro', activa: true, organization_id: ORG },
  { id: S2, nombre: 'Norte', activa: true, organization_id: ORG },
];
export function useSucursal() {
  const una = rol === 'cuenta' || rol === 'barbero' || params.get('sucursal') === 'centro';
  return { currentSucursal: una ? sucursales[0] : null, sucursales, isAllMode: !una, isLoading: false, error: null, refreshSucursales: () => {} };
}
export function useRequirePinForAction() {
  return async () => ({ ok: true, userName: rol === 'cuenta' ? 'Bruno Paz' : null });
}
export function ActionPinGateProvider({ children }: { children: React.ReactNode }) { return children; }

let n = 0;
const tarea = (o: Record<string, unknown>) => ({
  id: `t-${++n}`, organization_id: ORG, tipo: 'tarea', titulo: '', descripcion: null, estado: 'pendiente', asignado_a_id: null,
  asignado_a_nombre: 'Todo el equipo', creado_por_id: 'u', creado_por_nombre: 'Ana Ríos', assignment_scope: 'team', sucursal_id: S1,
  recurrente: false, fecha_inicio: today, fecha_limite: null, hora: null, repeat_preset: null, repeat_frequency: null, repeat_interval: null,
  repeat_byweekday: null, vencimiento_dias: null, completada_por_id: null, completada_por_nombre: null, completada_at: null,
  iniciada_por_id: null, iniciada_por_nombre: null, iniciada_at: null, accion_version: `v-${n}`, recurrencia_id: null, vencida_at: null,
  created_at: hace(10), updated_at: hace(1), ...o,
});
const bruno = { assignment_scope: 'individual', asignado_a_id: 'b-bruno', asignado_a_nombre: 'Bruno Paz' };
const ana = { assignment_scope: 'individual', asignado_a_id: 'b-ana', asignado_a_nombre: 'Ana Ríos' };

const abiertas = escenario === 'normal' ? [
  tarea({ titulo: 'Reponer toallas y capas limpias', estado: 'vencida', fecha_inicio: dia(-offsetLunes - 3), vencida_at: hace(2), ...bruno }),
  tarea({ titulo: 'Revisar stock de navajas y hojas', estado: 'en_progreso', fecha_inicio: dia(-offsetLunes - 1), vencida_at: hace(1), iniciada_por_nombre: 'Bruno Paz', iniciada_at: hace(1), sucursal_id: S2, recurrencia_id: 'r-stock' }),
  tarea({ titulo: 'Abrir caja y contar el cambio', hora: '09:00', ...ana }),
  tarea({ titulo: 'Limpiar y desinfectar sillones y estaciones', descripcion: 'Alcohol al 70 % en apoyabrazos, apoyacabezas y mesadas. Cambiar las toallas de papel.', recurrencia_id: 'r-limpieza', hora: '20:30' }),
  ...(offsetLunes > 0 ? [tarea({ titulo: 'Ordenar el depósito de productos', fecha_inicio: dia(-1), estado: 'en_progreso', iniciada_por_nombre: 'Ana Ríos', iniciada_at: hace(1), ...ana })] : []),
  tarea({ titulo: 'Pedido de insumos al proveedor (ceras, after shave y polvo)', fecha_inicio: dia(2), hora: '11:00', ...bruno, sucursal_id: S2 }),
  tarea({ titulo: 'Cambiar el foco del baño', fecha_inicio: null, created_at: hace(12) }),
  tarea({ titulo: 'Arreglar la persiana del frente', fecha_inicio: null, created_at: hace(3), descripcion: 'Se traba a la mitad; llamar al técnico si no se resuelve.' }),
] : [];
const resueltas = escenario === 'normal' ? [
  tarea({ titulo: 'Cerrar caja del día', estado: 'completada', fecha_inicio: dia(-1), completada_at: hace(0.6), completada_por_nombre: 'Ana Ríos', recurrencia_id: 'r-caja', ...ana }),
  tarea({ titulo: 'Limpiar vidriera', estado: 'completada', fecha_inicio: dia(-9), completada_at: hace(0.3), completada_por_nombre: 'Bruno Paz' }),
] : escenario === 'aldia' ? [tarea({ titulo: 'Cerrar caja del día', estado: 'completada', fecha_inicio: today, completada_at: hace(0.1), completada_por_nombre: 'Ana Ríos' })] : [];
const peticiones = escenario === 'normal' ? [
  tarea({ tipo: 'peticion', titulo: 'Comprar secador nuevo', descripcion: 'El de la estación 2 se apaga solo.', creado_por_nombre: 'Bruno Paz', created_at: hace(4), vencimiento_dias: 30, assignment_scope: 'individual' }),
  tarea({ tipo: 'peticion', titulo: 'Cambiar el horario del sábado', estado: 'vencida', creado_por_nombre: 'Carla Gómez', created_at: hace(70), assignment_scope: 'individual' }),
] : [];
const previstas = escenario === 'normal' ? [1, 2, 3, 4, 5, 6].map(d => dia(d)).filter(f => f <= dia(6 - offsetLunes)).map(fecha => ({
  recurrencia_id: 'r-limpieza', fecha, hora: '20:30', titulo: 'Limpiar y desinfectar sillones y estaciones', descripcion: null, sucursal_id: S1,
  assignment_scope: 'team', asignado_a_id: null, asignado_a_nombre: 'Todo el equipo',
})) : [];
const receta = (o: Record<string, unknown>) => ({
  organization_id: ORG, sucursal_id: S1, descripcion: null, assignment_scope: 'team', asignado_a: null, asignado_nombre: 'Todo el equipo',
  hora: null, repeat_frequency: null, repeat_interval: null, repeat_byweekday: null, fecha_inicio: dia(-20), proxima_fecha: dia(1), activo: true,
  pausa_motivo: null, pausada_at: null, created_at: hace(20), updated_at: hace(1), created_by: null, ...o,
});
const recetas = escenario === 'nuevo' ? [] : [
  receta({ id: 'r-limpieza', titulo: 'Limpiar y desinfectar sillones y estaciones', repeat_preset: 'daily', hora: '20:30' }),
  receta({ id: 'r-caja', titulo: 'Cerrar caja del día', repeat_preset: 'weekdays', asignado_a: 'b-ana', asignado_nombre: 'Ana Ríos', assignment_scope: 'individual' }),
  receta({ id: 'r-stock', titulo: 'Revisar stock de navajas y hojas', repeat_preset: 'custom', repeat_frequency: 'weekly', repeat_interval: 2, repeat_byweekday: [1, 4], sucursal_id: S2 }),
  receta({ id: 'r-vidriera', titulo: 'Limpiar vidriera', repeat_preset: 'weekly', activo: false, pausa_motivo: 'barbero_inactivo', asignado_a: 'b-carla', asignado_nombre: 'Carla Gómez', assignment_scope: 'individual' }),
];
const personas = [['b-ana', 'Ana', 'Ríos'], ['b-bruno', 'Bruno', 'Paz'], ['b-carla', 'Carla', 'Gómez']]
  .map(([id, nombre, apellido], i) => ({ id: `bs-${i}`, tipo: 'principal', fecha_inicio: null, fecha_fin: null, sucursal_id: S1, barberos: { id, nombre, apellido, activo: true, organization_id: ORG } }));

const espera = (ms = 250) => new Promise(r => setTimeout(r, ms));
interface Consulta { tabla: string; eq: Record<string, unknown>; or: string[]; escritura?: string; unico?: boolean; paginada?: boolean }
const enSucursal = (rows: { sucursal_id: string | null }[], q: Consulta) => rows.filter(r => !q.eq.sucursal_id || r.sucursal_id === q.eq.sucursal_id);

async function responder(q: Consulta) {
  await espera(escenario === 'lento' ? 1200 : 250);
  if (escenario === 'error' && !q.escritura) return { data: null, error: { code: 'PGRST000', message: 'fetch failed' } };
  if (q.escritura) return { data: q.unico ? { id: 'ok' } : null, error: null };
  if (q.paginada) return { data: [], error: null };
  if (q.tabla === 'tareas') {
    if (q.eq.estado === 'completada') return { data: enSucursal(resueltas, q), error: null };
    if (q.or.some(o => o.includes('tipo.eq.peticion'))) return { data: enSucursal([...abiertas, ...peticiones], q), error: null };
    return { data: escenario === 'nuevo' ? [] : [{ id: 'existe' }], error: null };
  }
  if (q.tabla === 'tareas_recurrentes') return { data: enSucursal(recetas, q), error: null };
  // Aviso semanal: `?aviso=listo` simula "Listo" ya elegido; `?pref=off`, la preferencia apagada.
  if (q.tabla === 'tareas_aviso_semanal') return { data: params.get('aviso') === 'listo' ? { estado: 'listo', pospuesto_hasta: null } : null, error: null };
  if (q.tabla === 'user_notification_preferences') {
    return { data: params.get('pref') === 'off' ? [{ event_type: 'tareas_resumen_semanal', enabled: false, mode: null }] : [], error: null };
  }
  if (q.tabla === 'barberos_sucursales') return { data: q.eq.barbero_id ? [{ id: 'm', sucursal_id: S1, tipo: 'principal', fecha_inicio: null, fecha_fin: null }] : personas, error: null };
  if (q.tabla === 'sucursales') return { data: { id: q.eq.id }, error: null };
  return { data: [], error: null };
}

function consulta(tabla: string) {
  const q: Consulta = { tabla, eq: {}, or: [] };
  const api: Record<string, unknown> = {};
  const encadenar = () => api;
  Object.assign(api, {
    select: encadenar, order: encadenar, limit: encadenar, abortSignal: encadenar, in: encadenar, is: encadenar, not: encadenar, gte: encadenar, lte: encadenar,
    eq: (k: string, v: unknown) => { q.eq[k] = v; return api; },
    gt: () => { q.paginada = true; return api; },
    or: (s: string) => { q.or.push(s); if (/id\.lt\.|completada_at\.lt\./.test(s)) q.paginada = true; return api; },
    insert: () => { q.escritura = 'insert'; return api; },
    update: () => { q.escritura = 'update'; return api; },
    delete: () => { q.escritura = 'delete'; return api; },
    upsert: () => { q.escritura = 'upsert'; return api; },
    single: () => { q.unico = true; return api; },
    maybeSingle: () => { q.unico = true; return api; },
    then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => responder(q).then(ok, ko),
  });
  return api;
}

export const supabase = {
  from: consulta,
  rpc: (nombre: string, args: Record<string, unknown>) => {
    const promesa = (async () => {
      await espera();
      if (nombre === 'tareas_previstas') return escenario === 'error' ? { data: null, error: { code: 'PGRST000' } } : { data: previstas, error: null };
      if (nombre === 'tareas_accion') {
        await espera(400);
        const accion = args.p_accion as string;
        return { data: { ok: true, version: `v-${Date.now()}`, estado: accion === 'iniciar' ? 'en_progreso' : accion === 'completar' ? 'completada' : 'pendiente', actor_nombre: 'Ana Ríos', completada_at: new Date().toISOString() }, error: null };
      }
      return { data: null, error: null };
    })();
    return Object.assign(promesa, { abortSignal: () => promesa });
  },
  functions: { invoke: async () => ({ data: { ok: true, version: `v-${Date.now()}`, estado: 'completada', actor_nombre: 'Bruno Paz' }, error: null }) },
  auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
  channel: () => ({ on() { return this; }, subscribe() { return this; } }),
  removeChannel: () => {},
};
