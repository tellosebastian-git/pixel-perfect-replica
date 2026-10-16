import { supabase } from '@/integrations/supabase/client';
import type { Tarea } from '@/hooks/useTareas';

export interface TaskCursor { id: string; created_at: string }

/** No confiar en el tamaño recibido: el servidor puede imponer un límite menor. */
export async function readAllTaskPages<T extends TaskCursor>(fetchPage: (cursor: TaskCursor | null) => Promise<T[]>): Promise<T[]> {
  const rows: T[] = [];
  let cursor: TaskCursor | null = null;
  for (;;) {
    const page = await fetchPage(cursor);
    if (!page.length) return rows;
    const next = page[page.length - 1];
    if (cursor?.id === next.id) throw new Error('No pudimos completar la carga. Reintentá.');
    rows.push(...page);
    cursor = next;
  }
}

export function taskCursorFilter(cursor: TaskCursor): string {
  // Valores devueltos por Postgres; comillas preservan timestamps y evitan sintaxis ambigua.
  const date = JSON.stringify(cursor.created_at);
  const id = JSON.stringify(cursor.id);
  return `created_at.lt.${date},and(created_at.eq.${date},id.lt.${id})`;
}

export interface TaskReadScope {
  organizationId: string;
  sucursalId: string | null;
  signal?: AbortSignal;
}

export async function fetchTaskPage(scope: TaskReadScope, cursor: TaskCursor | null): Promise<Tarea[]> {
  let query = supabase.from('tareas').select('*').eq('organization_id', scope.organizationId);
  if (scope.sucursalId) query = query.eq('sucursal_id', scope.sucursalId);
  // Peticiones conserva sus estados actuales; las completadas de Tareas van al historial.
  query = query.or('tipo.eq.peticion,estado.neq.completada');
  if (cursor) query = query.or(taskCursorFilter(cursor));
  query = query.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(500);
  if (scope.signal) query = query.abortSignal(scope.signal);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as Tarea[];
}

/** Cursor del historial: fecha de completado (más reciente primero) e id; sin fecha de completado, al final. */
export interface HistoryCursor { id: string; completada_at: string | null }

export function historyCursorFilter(cursor: HistoryCursor): string {
  const id = JSON.stringify(cursor.id);
  if (!cursor.completada_at) return `and(completada_at.is.null,id.lt.${id})`;
  const at = JSON.stringify(cursor.completada_at);
  return `completada_at.lt.${at},and(completada_at.eq.${at},id.lt.${id}),completada_at.is.null`;
}

/** Historial bajo demanda: páginas de 50, filtros aplicados en servidor antes de paginar. */
export async function fetchHistoryPage(scope: TaskReadScope, cursor: HistoryCursor | null, responsible = 'todos'): Promise<Tarea[]> {
  let query = supabase.from('tareas').select('*').eq('organization_id', scope.organizationId)
    .eq('tipo', 'tarea').eq('estado', 'completada');
  if (scope.sucursalId) query = query.eq('sucursal_id', scope.sucursalId);
  if (responsible === '__team__') query = query.eq('assignment_scope', 'team');
  else if (responsible !== 'todos') query = query.eq('asignado_a_id', responsible);
  if (cursor) query = query.or(historyCursorFilter(cursor));
  query = query.order('completada_at', { ascending: false, nullsFirst: false }).order('id', { ascending: false }).limit(50);
  if (scope.signal) query = query.abortSignal(scope.signal);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as Tarea[];
}

/** Semana de la organización: lunes a domingo, en días civiles (sin zona del dispositivo). */
export interface WeekRange { lunes: string; domingo: string }

export function addCivilDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export function weekRange(today: string): WeekRange {
  const offset = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
  return { lunes: addCivilDays(today, -offset), domingo: addCivilDays(today, 6 - offset) };
}

/**
 * Completadas de Tareas que importan a esta semana: las programadas para la semana (progreso) y las
 * completadas desde el lunes (Resueltas esta semana). El límite de `completada_at` lleva un día de margen
 * por la zona horaria; el recorte exacto por día de la organización se hace con los datos recibidos.
 */
export async function fetchWeekResolvedPage(scope: TaskReadScope, cursor: TaskCursor | null, week: WeekRange): Promise<Tarea[]> {
  let query = supabase.from('tareas').select('*').eq('organization_id', scope.organizationId)
    .eq('tipo', 'tarea').eq('estado', 'completada');
  if (scope.sucursalId) query = query.eq('sucursal_id', scope.sucursalId);
  const desde = JSON.stringify(`${addCivilDays(week.lunes, -1)}T00:00:00Z`);
  query = query.or(`and(fecha_inicio.gte.${week.lunes},fecha_inicio.lte.${week.domingo}),completada_at.gte.${desde}`);
  if (cursor) query = query.or(taskCursorFilter(cursor));
  query = query.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(500);
  if (scope.signal) query = query.abortSignal(scope.signal);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as Tarea[];
}

/**
 * Texto para el usuario: nunca un error técnico crudo. Los errores de la base o de red (con `code`, o de
 * transporte) se traducen al texto de la acción; los mensajes propios de estas pantallas ya son humanos.
 */
export function mensajeTareas(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'code' in error) return fallback;
  if (error instanceof Error && error.message && !/fetch|network|json|typeerror|abort/i.test(error.message)) return error.message;
  return fallback;
}

/** Una tarea puntual con el acceso del usuario (RLS): `null` si no existe o ya no es visible para él. */
export async function fetchTareaPorId(organizationId: string, id: string): Promise<Tarea | null> {
  const { data, error } = await supabase.from('tareas').select('*')
    .eq('organization_id', organizationId).eq('id', id).maybeSingle();
  if (error) throw error;
  return (data ?? null) as Tarea | null;
}

/** Validación adicional de datos, con la sesión/RLS existentes; no concede permisos. */
export async function requireTaskBranch(organizationId: string, sucursalId: string | null) {
  if (!sucursalId) throw new Error('Seleccioná una sucursal para crear la tarea.');
  const { data, error } = await supabase.from('sucursales').select('id')
    .eq('organization_id', organizationId).eq('id', sucursalId).eq('activa', true).is('deleted_at', null).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('La sucursal ya no está disponible. Elegí una sucursal válida.');
  return data.id;
}
