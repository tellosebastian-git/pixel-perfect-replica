import type { Tarea } from '@/hooks/useTareas';
import { calendarDayDifference, todayInTimezoneIso } from './dateUtils';
import type { WeekRange } from './tareasData';

/**
 * Principal → Tareas: organización temporal de la lista (BUILD 4B). Sin calendario propio: las fechas de
 * las Tareas automáticas futuras llegan calculadas por la base (`tareas_previstas`); acá solo se ubican.
 */

/** Ocurrencia futura de una Tarea automática que todavía no existe como tarea (R1). */
export interface TareaPrevista {
  recurrencia_id: string;
  fecha: string;
  hora: string | null;
  titulo: string;
  descripcion: string | null;
  sucursal_id: string;
  assignment_scope: string;
  asignado_a_id: string | null;
  asignado_a_nombre: string | null;
}

export interface ContextoAgenda {
  today: string;
  week: WeekRange;
  /** `organizations.tareas_vencimiento_dias_default`. */
  diasVencimiento: number;
}

export interface ItemTarea {
  kind: 'tarea';
  tarea: Tarea;
  vencida: boolean;
  /** Fecha anterior a hoy dentro de esta semana ("Desde el martes"). */
  desde: string | null;
  /** Días que faltan para que venza; `null` sin fecha. */
  diasParaVencer: number | null;
}
export interface ItemPrevista { kind: 'prevista'; prevista: TareaPrevista }
export type ItemAgenda = ItemTarea | ItemPrevista;

export interface AgendaTareas {
  atencion: ItemTarea[];
  hoy: ItemAgenda[];
  proximas: ItemAgenda[];
  sinFecha: ItemTarea[];
}

const ABIERTAS = new Set(['pendiente', 'en_progreso', 'vencida']);

export const fechaDeTarea = (t: Pick<Tarea, 'fecha_inicio' | 'fecha_limite'>) => t.fecha_inicio ?? t.fecha_limite ?? null;

export function esTareaAbierta(t: Tarea) {
  return t.tipo === 'tarea' && ABIERTAS.has(t.estado);
}

/** Mismo plazo que la base: fecha + días de la organización, en días civiles. */
export function diasParaVencer(t: Tarea, diasVencimiento: number, today: string): number | null {
  const fecha = fechaDeTarea(t);
  if (!fecha) return null;
  return calendarDayDifference(fecha, today) + Math.max(0, diasVencimiento);
}

/** "Empezada" y "atrasada" son independientes: una tarea en progreso también puede estar vencida. */
export function esVencida(t: Tarea, diasVencimiento: number, today: string) {
  if (!esTareaAbierta(t)) return false;
  if (t.estado === 'vencida' || t.vencida_at) return true;
  const dias = diasParaVencer(t, diasVencimiento, today);
  return dias !== null && dias < 0;
}

const porHora = (a: string | null, b: string | null) => (a ?? '99:99').localeCompare(b ?? '99:99');
const fechaItem = (i: ItemAgenda) => (i.kind === 'tarea' ? fechaDeTarea(i.tarea) : i.prevista.fecha) ?? '';
const horaItem = (i: ItemAgenda) => (i.kind === 'tarea' ? i.tarea.hora : i.prevista.hora);
const creadaItem = (i: ItemAgenda) => (i.kind === 'tarea' ? i.tarea.created_at : '');
const cronologico = (a: ItemAgenda, b: ItemAgenda) =>
  fechaItem(a).localeCompare(fechaItem(b)) || porHora(horaItem(a), horaItem(b)) || creadaItem(a).localeCompare(creadaItem(b));

/**
 * Necesitan atención: vencidas (incluida en progreso + vencida) y abiertas de semanas anteriores.
 * Hoy: las de hoy y las abiertas desde un día anterior de esta semana que siguen vigentes.
 * Próximas: futuras, con las Programadas intercaladas por fecha. Sin fecha: las más viejas primero.
 */
export function agruparTareas(tareas: Tarea[], previstas: TareaPrevista[], ctx: ContextoAgenda): AgendaTareas {
  const agenda: AgendaTareas = { atencion: [], hoy: [], proximas: [], sinFecha: [] };
  for (const tarea of tareas) {
    if (!esTareaAbierta(tarea)) continue;
    const fecha = fechaDeTarea(tarea);
    const vencida = esVencida(tarea, ctx.diasVencimiento, ctx.today);
    const item: ItemTarea = { kind: 'tarea', tarea, vencida, desde: null, diasParaVencer: diasParaVencer(tarea, ctx.diasVencimiento, ctx.today) };
    if (vencida || (fecha && fecha < ctx.week.lunes)) agenda.atencion.push(item);
    else if (!fecha) agenda.sinFecha.push(item);
    else if (fecha < ctx.today) agenda.hoy.push({ ...item, desde: fecha });
    else if (fecha === ctx.today) agenda.hoy.push(item);
    else agenda.proximas.push(item);
  }
  for (const prevista of previstas) {
    if (prevista.fecha < ctx.today) continue;
    (prevista.fecha === ctx.today ? agenda.hoy : agenda.proximas).push({ kind: 'prevista', prevista });
  }
  agenda.atencion.sort(cronologico);
  agenda.hoy.sort(cronologico);
  agenda.proximas.sort(cronologico);
  agenda.sinFecha.sort((a, b) => a.tarea.created_at.localeCompare(b.tarea.created_at) || a.tarea.id.localeCompare(b.tarea.id));
  return agenda;
}

export interface ProgresoSemanal {
  completadas: number;
  total: number;
  vencidas: number;
  pendientes: number;
  programadas: number;
  /** Abiertas de semanas anteriores: no entran en el total de esta semana. */
  anteriores: number;
}

/**
 * Semana = lunes a domingo de la organización. Cuentan solo tareas con fecha en la semana (más las Programadas
 * de la semana). Sin fecha y pendientes anteriores quedan fuera del total; una completada tarde no cambia
 * el progreso de una semana que no era la suya.
 */
export function progresoSemanal(abiertas: Tarea[], resueltas: Tarea[], previstas: TareaPrevista[], ctx: ContextoAgenda): ProgresoSemanal {
  const enSemana = (fecha: string | null) => !!fecha && fecha >= ctx.week.lunes && fecha <= ctx.week.domingo;
  let vencidas = 0;
  let pendientes = 0;
  let anteriores = 0;
  for (const t of abiertas) {
    if (!esTareaAbierta(t)) continue;
    const fecha = fechaDeTarea(t);
    if (enSemana(fecha)) {
      if (esVencida(t, ctx.diasVencimiento, ctx.today)) vencidas++;
      else pendientes++;
    } else if (fecha && fecha < ctx.week.lunes) anteriores++;
  }
  const completadas = resueltas.filter(t => t.tipo === 'tarea' && t.estado === 'completada' && enSemana(fechaDeTarea(t))).length;
  const programadas = previstas.filter(p => enSemana(p.fecha) && p.fecha >= ctx.today).length;
  return { completadas, total: completadas + vencidas + pendientes + programadas, vencidas, pendientes, programadas, anteriores };
}

/** Resueltas esta semana: completadas desde el lunes según el día de la organización (incluye las tardías). */
export function resueltasDeLaSemana(resueltas: Tarea[], week: WeekRange, timezone?: string | null): Tarea[] {
  return resueltas
    .filter(t => {
      if (!t.completada_at) return false;
      const dia = todayInTimezoneIso(timezone, new Date(t.completada_at));
      return dia >= week.lunes && dia <= week.domingo;
    })
    .sort((a, b) => (b.completada_at ?? '').localeCompare(a.completada_at ?? '') || b.id.localeCompare(a.id));
}

export type AlcanceTareas = 'mias' | 'negocio';

export interface FiltroTareas {
  alcance: AlcanceTareas;
  /** `barberos.id` del usuario, para "Mis tareas". */
  miBarberoId: string | null;
  /** Sucursales con pertenencia estructural del usuario, para las tareas de equipo en "Mis tareas". */
  misSucursales: string[];
  responsable: string;
  sucursal: string;
}

interface Asignable { assignment_scope: string; asignado_a_id: string | null; sucursal_id: string | null }

/** Alcance personal o filtros de Negocio; RLS ya decidió qué puede ver cada uno. */
export function coincideFiltro(item: Asignable, f: FiltroTareas): boolean {
  if (f.alcance === 'mias') {
    if (item.assignment_scope === 'team') return !!item.sucursal_id && f.misSucursales.includes(item.sucursal_id);
    return !!f.miBarberoId && item.asignado_a_id === f.miBarberoId;
  }
  if (f.sucursal !== 'todas' && item.sucursal_id !== f.sucursal) return false;
  if (f.responsable === '__team__') return item.assignment_scope === 'team';
  if (f.responsable !== 'todos') return item.asignado_a_id === f.responsable;
  return true;
}

const fmt = (options: Intl.DateTimeFormatOptions, date: string) =>
  new Intl.DateTimeFormat('es', { timeZone: 'UTC', ...options }).format(new Date(`${date}T00:00:00Z`));

/** "jue 16 oct" */
export const formatDiaCorto = (date: string) => fmt({ weekday: 'short', day: 'numeric', month: 'short' }, date).replace(/\./g, '').replace(',', '');
/** "martes" */
export const formatDiaSemana = (date: string) => fmt({ weekday: 'long' }, date);
/** "martes 14 de octubre" */
export const formatDiaLargo = (date: string) => fmt({ weekday: 'long', day: 'numeric', month: 'long' }, date).replace(',', '');
/** "13 al 19 oct" */
export function formatRangoSemana(week: WeekRange): string {
  const mismoMes = week.lunes.slice(0, 7) === week.domingo.slice(0, 7);
  const desde = mismoMes ? fmt({ day: 'numeric' }, week.lunes) : fmt({ day: 'numeric', month: 'short' }, week.lunes).replace('.', '');
  return `${desde} al ${fmt({ day: 'numeric', month: 'short' }, week.domingo).replace('.', '')}`;
}
