import { useSyncExternalStore } from 'react';

/**
 * Pedido de navegación a Principal → Tareas con un destino concreto (una tarea o una Tarea automática), desde la
 * campana o el aviso semanal. No es un router: `Index` lo ve y cambia de pestaña; `TareasPanel` lo consume una sola
 * vez, busca la tarea con el acceso del usuario (RLS) y abre su detalle. Si ya no existe o no es visible, lo dice
 * sin revelar nada de ella.
 */
export type DestinoTareas =
  | { tipo: 'tarea'; id: string }
  | { tipo: 'automatica'; id: string }
  /** Ocurrencia Programada (R1): si ya existe la tarea real, se abre la real. */
  | { tipo: 'prevista'; recurrenciaId: string; fecha: string }
  | { tipo: 'lista' };

let destino: DestinoTareas | null = null;
const suscriptores = new Set<() => void>();
const avisar = () => suscriptores.forEach(fn => fn());

export function irATareas(nuevo: DestinoTareas) {
  destino = nuevo;
  avisar();
}

/** Lo consume quien puede resolverlo; devuelve `null` si ya se resolvió. */
export function consumirDestinoTareas(): DestinoTareas | null {
  const actual = destino;
  if (actual) {
    destino = null;
    avisar();
  }
  return actual;
}

export function useDestinoTareas(): DestinoTareas | null {
  return useSyncExternalStore(
    fn => { suscriptores.add(fn); return () => { suscriptores.delete(fn); }; },
    () => destino,
    () => null,
  );
}

/** Notificación de la campana → destino. Solo las de Tareas apuntan a algo concreto. */
export function destinoDeNotificacion(n: { source_module: string; source_id: string; source_table?: string | null }): DestinoTareas {
  if (n.source_module !== 'tareas' || !n.source_id) return { tipo: 'lista' };
  return n.source_table === 'tareas_recurrentes' ? { tipo: 'automatica', id: n.source_id } : { tipo: 'tarea', id: n.source_id };
}
