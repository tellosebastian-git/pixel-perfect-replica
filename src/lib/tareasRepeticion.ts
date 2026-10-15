/**
 * Textos de la programación de una Tarea automática. Solo describen la regla: qué fechas tocan lo
 * decide la base (`_tareas_auto_*`), nunca el frontend.
 */

export const REPETICIONES = [
  { value: 'never', label: 'No se repite' },
  { value: 'daily', label: 'Cada día' },
  { value: 'weekdays', label: 'Entre semana (lunes a viernes)' },
  { value: 'weekends', label: 'Fines de semana' },
  { value: 'weekly', label: 'Cada semana' },
  { value: 'biweekly', label: 'Cada dos semanas' },
  { value: 'monthly', label: 'Cada mes' },
  { value: 'quarterly', label: 'Cada 3 meses' },
  { value: 'semiannual', label: 'Cada 6 meses' },
  { value: 'yearly', label: 'Cada año' },
  { value: 'custom', label: 'Personalizada' },
] as const;

export const FRECUENCIAS = [
  { value: 'daily', label: 'Días', singular: 'día', plural: 'días' },
  { value: 'weekly', label: 'Semanas', singular: 'semana', plural: 'semanas' },
  { value: 'monthly', label: 'Meses', singular: 'mes', plural: 'meses' },
  { value: 'yearly', label: 'Años', singular: 'año', plural: 'años' },
] as const;

/** Lunes primero, como la semana de la organización. 0 = domingo … 6 = sábado (convención de la base). */
export const DIAS_SEMANA = [
  { value: 1, corto: 'L', label: 'lunes' },
  { value: 2, corto: 'M', label: 'martes' },
  { value: 3, corto: 'X', label: 'miércoles' },
  { value: 4, corto: 'J', label: 'jueves' },
  { value: 5, corto: 'V', label: 'viernes' },
  { value: 6, corto: 'S', label: 'sábado' },
  { value: 0, corto: 'D', label: 'domingo' },
] as const;

const ordenLunes = (d: number) => (d === 0 ? 7 : d);

/** "los lunes y sábados": lunes a viernes no cambian en plural; sábado y domingo suman "s". */
function listaDias(dias: number[]): string {
  const nombres = [...dias].sort((a, b) => ordenLunes(a) - ordenLunes(b))
    .map(d => DIAS_SEMANA.find(w => w.value === d)?.label).filter(Boolean)
    .map(n => (n!.endsWith('s') ? n! : `${n}s`));
  if (nombres.length <= 1) return nombres.join('');
  return `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`;
}

export interface Programacion {
  repeat_preset: string | null;
  repeat_frequency?: string | null;
  repeat_interval?: number | null;
  repeat_byweekday?: number[] | null;
}

/** "Cada semana", "Cada 2 semanas, los lunes y jueves". */
export function describirRepeticion(p: Programacion): string {
  if (p.repeat_preset !== 'custom') {
    return REPETICIONES.find(r => r.value === p.repeat_preset)?.label ?? 'Personalizada';
  }
  const unidad = FRECUENCIAS.find(f => f.value === p.repeat_frequency);
  if (!unidad) return 'Personalizada';
  const n = p.repeat_interval && p.repeat_interval > 1 ? p.repeat_interval : 1;
  const base = n === 1 ? `Cada ${unidad.singular}` : `Cada ${n} ${unidad.plural}`;
  if (p.repeat_frequency === 'weekly' && p.repeat_byweekday?.length) {
    return `${base}, los ${listaDias(p.repeat_byweekday)}`;
  }
  return base;
}
