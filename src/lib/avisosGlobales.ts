/**
 * Avisos globales automáticos al entrar a Vittro (BUILD 4C): onboarding, resumen mensual y aviso semanal de Tareas.
 *
 * - Prioridad: onboarding > resumen mensual > Tareas. Mientras uno de mayor prioridad no se resolvió, los demás esperan.
 * - Uno solo por entrada: el elegido queda fijo; al cerrarse no se encadena el siguiente (vuelve en una entrada posterior).
 * - Nunca encima de otra ventana, drawer, PIN, menú o selector, con un campo en edición o con una acción guardándose.
 * - Si la persona ya empezó a trabajar en la pantalla (tocó o escribió en el contenido principal), no se la interrumpe:
 *   el aviso queda para la próxima entrada. El onboarding no espera: es el primer uso de la app.
 *
 * "Entrada" = esta carga de la app para un usuario + organización. La elección vive fuera de React para que un
 * remontaje (p. ej. la pantalla de carga) no vuelva a mostrar un aviso ya mostrado. La parte React está en
 * `src/components/avisos/AvisosGlobales.tsx`.
 */
export type AvisoGlobal = 'onboarding' | 'resumen' | 'tareas';
/** `pendiente`: todavía no se sabe; `listo`: quiere mostrarse; `no`: nada que mostrar en esta entrada. */
export type EstadoAviso = 'pendiente' | 'listo' | 'no';

export const PRIORIDAD_AVISOS: readonly AvisoGlobal[] = ['onboarding', 'resumen', 'tareas'];

/** El primero en prioridad que quiere mostrarse; `esperar` mientras uno de mayor prioridad no se resolvió. */
export function elegirAviso(estados: Partial<Record<AvisoGlobal, EstadoAviso>>): AvisoGlobal | 'esperar' | 'ninguno' {
  for (const id of PRIORIDAD_AVISOS) {
    const estado = estados[id] ?? 'pendiente';
    if (estado === 'pendiente') return 'esperar';
    if (estado === 'listo') return id;
  }
  return 'ninguno';
}

const SUPERFICIES_OCUPADAS = [
  '[role="dialog"]', '[role="alertdialog"]', '[data-vaul-drawer]', '[data-radix-popper-content-wrapper]',
].join(',');

/** Nada abierto encima (ventana, drawer, PIN, menú, selector) y ningún campo en edición. */
export function superficieDisponible(doc: Document = document): boolean {
  if (doc.querySelector(SUPERFICIES_OCUPADAS)) return false;
  const activo = doc.activeElement as HTMLElement | null;
  return !(activo && (activo.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(activo.tagName)));
}

// ---------- Estado por entrada (fuera de React) ----------
export interface EntradaAvisos {
  elegido: AvisoGlobal | 'ninguno' | null;
  cerrado: boolean;
  /** La persona ya empezó a trabajar en la pantalla. */
  enUso: boolean;
}
export const ENTRADA_VACIA: EntradaAvisos = { elegido: null, cerrado: false, enUso: false };
const entradas = new Map<string, EntradaAvisos>();
const suscriptores = new Set<() => void>();

export function suscribirEntradas(fn: () => void) {
  suscriptores.add(fn);
  return () => { suscriptores.delete(fn); };
}
export const leerEntrada = (clave: string | null): EntradaAvisos => (clave ? entradas.get(clave) ?? ENTRADA_VACIA : ENTRADA_VACIA);
export function actualizarEntrada(clave: string, cambios: Partial<EntradaAvisos>) {
  entradas.set(clave, { ...leerEntrada(clave), ...cambios });
  suscriptores.forEach(fn => fn());
}
/** Solo para tests: simula una carga nueva de la app. */
export function reiniciarAvisosGlobales() {
  entradas.clear();
  suscriptores.forEach(fn => fn());
}
