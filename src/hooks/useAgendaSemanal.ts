import { useCallback, useMemo, useState } from 'react';
import type { Tarea } from './useTareas';
import {
  agruparTareas, coincideFiltro, progresoSemanal, resueltasDeLaSemana, type ContextoAgenda, type FiltroTareas, type TareaPrevista,
} from '@/lib/tareasAgenda';

interface EntradaAgenda {
  /** Lectura operativa (abiertas + peticiones) de `useTareas`. */
  tareas: Tarea[];
  tareasActualizadas: number;
  /** Completadas de la semana y Programadas (R1) de `useTareasSemana`. */
  resueltasServidor: Tarea[] | undefined;
  resueltasActualizadas: number;
  previstasServidor: TareaPrevista[] | undefined;
  filtro: FiltroTareas;
  ctx: ContextoAgenda;
  timezone?: string | null;
}

/**
 * La semana tal como la ven Principal → Tareas y el aviso semanal: una sola definición de abierta, prevista,
 * completada, Programada y pendiente anterior. Una tarea completada en este dispositivo se refleja en el momento
 * (sale de la lista y suma al progreso) hasta que la lectura del servidor la confirma.
 */
export function useAgendaSemanal(e: EntradaAgenda) {
  const [completadasLocales, setCompletadasLocales] = useState<Map<string, { tarea: Tarea; at: number }>>(new Map());

  const locales = useMemo(() => [...completadasLocales.values()]
    .filter(x => !(e.tareasActualizadas > x.at && e.resueltasActualizadas > x.at)), [completadasLocales, e.tareasActualizadas, e.resueltasActualizadas]);
  const ocultas = useMemo(() => new Set(locales.map(x => x.tarea.id)), [locales]);

  const tareasInternas = e.tareas.filter(t => t.tipo === 'tarea');
  const abiertas = tareasInternas.filter(t => !ocultas.has(t.id) && coincideFiltro(t, e.filtro));
  const previstas = (e.previstasServidor ?? []).filter(p => coincideFiltro(p, e.filtro));
  const servidor = e.resueltasServidor ?? [];
  const resueltas = [...servidor, ...locales.map(x => x.tarea).filter(t => !servidor.some(r => r.id === t.id))]
    .filter(t => coincideFiltro(t, e.filtro));
  const agenda = agruparTareas(abiertas, previstas, e.ctx);
  const progreso = progresoSemanal(abiertas, resueltas, previstas, e.ctx);
  const resueltasSemana = resueltasDeLaSemana(resueltas, e.ctx.week, e.timezone);

  const marcarCompletada = useCallback((original: Tarea, completada: Tarea) =>
    setCompletadasLocales(prev => new Map(prev).set(original.id, { tarea: completada, at: Date.now() })), []);
  const desmarcarCompletada = useCallback((id: string) =>
    setCompletadasLocales(prev => { const next = new Map(prev); next.delete(id); return next; }), []);
  const reiniciar = useCallback(() => setCompletadasLocales(new Map()), []);

  return {
    tareasInternas, ocultas, resueltas, agenda, progreso, resueltasSemana,
    marcarCompletada, desmarcarCompletada, reiniciar,
  };
}
