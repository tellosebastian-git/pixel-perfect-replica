import { fechaDeTarea, type AgendaTareas, type ItemAgenda, type ProgresoSemanal } from './tareasAgenda';
import type { WeekRange } from './tareasData';

/**
 * Aviso semanal de Tareas (BUILD 4C). Usa las mismas definiciones de la agenda de 4B (`agruparTareas`,
 * `progresoSemanal`): acá solo se decide qué momento corresponde, si hay algo que decir y qué mostrar.
 */
export type MomentoAviso = 'lunes' | 'jueves' | 'sabado';

/** Máximo de tareas dentro del aviso: el resto vive en Principal → Tareas. */
export const MAX_TAREAS_AVISO = 5;

/** Preferencia de Configuración → Notificaciones que lo apaga (solo a este aviso). */
export const EVENTO_AVISO_SEMANAL = 'tareas_resumen_semanal';

/**
 * Ventanas sobre el día de la organización (`organizations.timezone`, nunca el del dispositivo):
 * lunes a miércoles → inicio de semana; jueves y viernes → seguimiento; sábado y domingo → cierre.
 */
export function momentoDelDia(today: string): MomentoAviso {
  const dia = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 = domingo
  if (dia >= 1 && dia <= 3) return 'lunes';
  if (dia === 4 || dia === 5) return 'jueves';
  return 'sabado';
}

export interface EstadoAvisoGuardado {
  estado: string;
  pospuesto_hasta: string | null;
}

/** "Listo" lo cierra para ese momento; "Más tarde" lo deja volver cuando vence el plazo que fijó el servidor. */
export function avisoPendiente(fila: EstadoAvisoGuardado | null | undefined, ahora = Date.now()): boolean {
  if (!fila) return true;
  if (fila.estado === 'listo') return false;
  if (fila.estado === 'pospuesto') return !fila.pospuesto_hasta || Date.parse(fila.pospuesto_hasta) <= ahora;
  return false;
}

/** Sección de la agenda de la que sale cada tarea del aviso (la misma de Principal → Tareas). */
export type SeccionAviso = 'atencion' | 'hoy' | 'proximas';
export type ItemAviso = ItemAgenda & { seccion: SeccionAviso };

export interface ContenidoAviso {
  momento: MomentoAviso;
  /** Hay algo que decir para este momento; si no, el aviso no aparece. */
  relevante: boolean;
  /** Hasta `MAX_TAREAS_AVISO`, en orden: necesitan atención, hoy, próximas más cercanas de la semana. */
  items: ItemAviso[];
  /** Cuántas más de la semana quedan fuera del aviso. */
  restantes: number;
  /** Cantidad de "Hoy" (para el inicio de semana). */
  paraHoy: number;
  /** Nada abierto ni atrasado en la semana, y hubo actividad: cierre positivo. */
  todoAlDia: boolean;
}

/** Fecha del ítem dentro de la semana (las Programadas ya llegan acotadas a la semana desde la base). */
const dentroDeLaSemana = (item: ItemAgenda, week: WeekRange) => {
  if (item.kind === 'prevista') return item.prevista.fecha <= week.domingo;
  const fecha = fechaDeTarea(item.tarea);
  return !fecha || fecha <= week.domingo;
};

/**
 * Lunes y jueves: solo si todavía queda algo de la semana (abiertas, Programadas) o algo que necesita atención.
 * Sábado: cierre si hubo actividad en la semana, aunque esté todo resuelto. La lista se limita a la semana:
 * lo que viene después vive en Principal → Tareas.
 */
export function construirAviso(
  momento: MomentoAviso, agenda: AgendaTareas, progreso: ProgresoSemanal, resueltasEstaSemana: number, week: WeekRange,
): ContenidoAviso {
  const atencion = agenda.atencion.length;
  const quedan = progreso.vencidas + progreso.pendientes + progreso.programadas;
  const huboActividad = progreso.total > 0 || resueltasEstaSemana > 0;
  const relevante = momento === 'sabado' ? huboActividad || atencion > 0 : quedan > 0 || atencion > 0;
  const candidatas: ItemAviso[] = [
    ...agenda.atencion.map(i => ({ ...i, seccion: 'atencion' as const })),
    ...agenda.hoy.map(i => ({ ...i, seccion: 'hoy' as const })),
    ...agenda.proximas.filter(i => dentroDeLaSemana(i, week)).map(i => ({ ...i, seccion: 'proximas' as const })),
  ];

  return {
    momento,
    relevante,
    items: candidatas.slice(0, MAX_TAREAS_AVISO),
    restantes: Math.max(0, candidatas.length - MAX_TAREAS_AVISO),
    paraHoy: agenda.hoy.length,
    todoAlDia: huboActividad && quedan === 0 && atencion === 0,
  };
}

export const TITULO_AVISO: Record<MomentoAviso, string> = {
  lunes: 'Arranca la semana',
  jueves: 'Cómo viene la semana',
  sabado: 'Cierre de la semana',
};
