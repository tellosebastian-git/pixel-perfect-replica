import { calendarDayDifference, todayInTimezoneIso } from './dateUtils';

export interface TareaVencInput {
  tipo: string;
  estado: string;
  fecha_inicio: string | null;
  fecha_limite?: string | null;
  created_at: string;
  vencimiento_dias?: number | null;
}

/**
 * Calcula vencimiento visual de una tarea interna.
 * Vencida = hoy > fecha_inicio + diasDefault
 */
export function getTareaVencimiento(t: TareaVencInput, diasDefault: number, timezone?: string | null, now = new Date()) {
  if (t.tipo !== 'tarea' || t.estado === 'completada' || !t.fecha_inicio) {
    return { vencida: false, diasRestantes: null as number | null };
  }
  const diasRestantes = calendarDayDifference(t.fecha_inicio, todayInTimezoneIso(timezone, now)) + Math.max(0, diasDefault);
  return { vencida: diasRestantes < 0, diasRestantes };
}

/**
 * Calcula vencimiento visual de una petición (relativo a created_at).
 */
export function getPeticionVencimiento(t: TareaVencInput, diasOrgDefault: number, timezone?: string | null, now = new Date()) {
  const dias = t.vencimiento_dias ?? diasOrgDefault ?? 60;
  const creado = todayInTimezoneIso(timezone, new Date(t.created_at));
  const diasRestantes = calendarDayDifference(creado, todayInTimezoneIso(timezone, now)) + dias;
  return { vencida: diasRestantes < 0, diasRestantes };
}
