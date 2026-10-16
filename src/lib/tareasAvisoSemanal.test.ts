import { describe, expect, it } from 'vitest';
import type { Tarea } from '@/hooks/useTareas';
import { agruparTareas, progresoSemanal, resueltasDeLaSemana, type TareaPrevista } from './tareasAgenda';
import { avisoPendiente, construirAviso, MAX_TAREAS_AVISO, momentoDelDia, type MomentoAviso } from './tareasAvisoSemanal';
import { weekRange } from './tareasData';
import { todayInTimezoneIso } from './dateUtils';

// Semana de la organización: lunes 12 a domingo 18 de octubre de 2026.
let n = 0;
const tarea = (o: Partial<Tarea> = {}): Tarea => ({
  id: `t${++n}`, organization_id: 'org', tipo: 'tarea', titulo: `Tarea ${n}`, descripcion: null, estado: 'pendiente',
  asignado_a_id: null, asignado_a_nombre: null, creado_por_id: 'u', creado_por_nombre: 'Ana', assignment_scope: 'team',
  sucursal_id: 's1', recurrente: false, fecha_inicio: '2026-10-14', fecha_limite: null, hora: null, repeat_preset: null,
  repeat_frequency: null, repeat_interval: null, repeat_byweekday: null, vencimiento_dias: null, completada_por_id: null,
  completada_por_nombre: null, completada_at: null, recurrencia_id: null, vencida_at: null,
  created_at: '2026-10-01T12:00:00Z', updated_at: '2026-10-01T12:00:00Z', accion_version: 'v', ...o,
});
const completada = (fecha: string, at = `${fecha}T15:00:00Z`) => tarea({ estado: 'completada', fecha_inicio: fecha, completada_at: at });
const prevista = (fecha: string): TareaPrevista => ({
  recurrencia_id: 'r1', fecha, hora: null, titulo: 'Limpieza', descripcion: null, sucursal_id: 's1', assignment_scope: 'team',
  asignado_a_id: null, asignado_a_nombre: null,
});

/** Mismo camino que el aviso: agenda y progreso de 4B, y recién después el contenido del aviso. */
function aviso(today: string, abiertas: Tarea[], resueltas: Tarea[] = [], previstas: TareaPrevista[] = [], momento?: MomentoAviso) {
  const week = weekRange(today);
  const ctx = { today, week, diasVencimiento: 1 };
  const agenda = agruparTareas(abiertas, previstas, ctx);
  const progreso = progresoSemanal(abiertas, resueltas, previstas, ctx);
  const resueltasSemana = resueltasDeLaSemana(resueltas, week, 'America/Argentina/Buenos_Aires').length;
  return construirAviso(momento ?? momentoDelDia(today), agenda, progreso, resueltasSemana, week);
}
const titulos = (c: ReturnType<typeof aviso>) => c.items.map(i => (i.kind === 'tarea' ? i.tarea.titulo : `Programada ${i.prevista.fecha}`));

describe('aviso semanal: ventanas', () => {
  it('lunes a miércoles = inicio, jueves y viernes = seguimiento, sábado y domingo = cierre (sin aviso propio del domingo)', () => {
    expect(['2026-10-12', '2026-10-13', '2026-10-14'].map(momentoDelDia)).toEqual(['lunes', 'lunes', 'lunes']);
    expect(['2026-10-15', '2026-10-16'].map(momentoDelDia)).toEqual(['jueves', 'jueves']);
    expect(['2026-10-17', '2026-10-18'].map(momentoDelDia)).toEqual(['sabado', 'sabado']);
  });

  it('el cambio domingo → lunes lo decide el día de la organización, no el del dispositivo', () => {
    // Lunes 19 a las 01:30 UTC: en Buenos Aires todavía es domingo 18 → sigue el cierre de la semana anterior.
    const instante = new Date('2026-10-19T01:30:00Z');
    expect(todayInTimezoneIso('America/Argentina/Buenos_Aires', instante)).toBe('2026-10-18');
    expect(momentoDelDia(todayInTimezoneIso('America/Argentina/Buenos_Aires', instante))).toBe('sabado');
    expect(weekRange(todayInTimezoneIso('America/Argentina/Buenos_Aires', instante)).lunes).toBe('2026-10-12');
    // Domingo 18 a las 20:00 UTC: en Tokio ya es lunes 19 → arranca la semana nueva.
    const tokio = todayInTimezoneIso('Asia/Tokyo', new Date('2026-10-18T20:00:00Z'));
    expect(tokio).toBe('2026-10-19');
    expect(momentoDelDia(tokio)).toBe('lunes');
    expect(weekRange(tokio).lunes).toBe('2026-10-19');
  });
});

describe('aviso semanal: Listo y Más tarde', () => {
  const ahora = Date.parse('2026-10-15T12:00:00Z');
  it('sin estado guardado, aparece; "Listo" lo cierra para ese momento', () => {
    expect(avisoPendiente(null, ahora)).toBe(true);
    expect(avisoPendiente({ estado: 'listo', pospuesto_hasta: null }, ahora)).toBe(false);
  });
  it('"Más tarde" vuelve recién cuando vence el plazo del servidor (≈ 3 h)', () => {
    expect(avisoPendiente({ estado: 'pospuesto', pospuesto_hasta: '2026-10-15T14:59:00Z' }, ahora)).toBe(false);
    expect(avisoPendiente({ estado: 'pospuesto', pospuesto_hasta: '2026-10-15T11:59:00Z' }, ahora)).toBe(true);
  });
});

describe('aviso semanal: contenido', () => {
  it('lunes: lo previsto, lo de hoy y lo anterior, en orden atención → hoy → próximas', () => {
    const anterior = tarea({ titulo: 'Anterior', fecha_inicio: '2026-10-08' });
    const hoy = tarea({ titulo: 'Hoy', fecha_inicio: '2026-10-12' });
    const jueves = tarea({ titulo: 'Jueves', fecha_inicio: '2026-10-15' });
    const c = aviso('2026-10-12', [jueves, hoy, anterior], [], [prevista('2026-10-14')]);
    expect(c.relevante).toBe(true);
    expect(titulos(c)).toEqual(['Anterior', 'Hoy', 'Programada 2026-10-14', 'Jueves']);
    expect(c.items.map(i => i.seccion)).toEqual(['atencion', 'hoy', 'proximas', 'proximas']);
    expect(c.paraHoy).toBe(1);
  });

  it('nunca más de 5 tareas; el resto se cuenta y lo de semanas siguientes no entra', () => {
    const abiertas = Array.from({ length: 7 }, (_, i) => tarea({ titulo: `S${i}`, fecha_inicio: '2026-10-16' }));
    const despues = tarea({ titulo: 'Semana que viene', fecha_inicio: '2026-10-21' });
    const c = aviso('2026-10-12', [...abiertas, despues]);
    expect(c.items).toHaveLength(MAX_TAREAS_AVISO);
    expect(c.restantes).toBe(2);
    expect(titulos(c)).not.toContain('Semana que viene');
  });

  it('lunes o jueves sin nada por hacer: no aparece (ni con la semana ya resuelta)', () => {
    expect(aviso('2026-10-13', []).relevante).toBe(false);
    expect(aviso('2026-10-15', [], [completada('2026-10-12'), completada('2026-10-14')]).relevante).toBe(false);
    // Una tarea sin fecha no es "de la semana".
    expect(aviso('2026-10-15', [tarea({ fecha_inicio: null })]).relevante).toBe(false);
  });

  it('jueves: aparece si queda algo (vencida, pendiente o Programada)', () => {
    const vencida = tarea({ titulo: 'Vencida', fecha_inicio: '2026-10-12' });
    const c = aviso('2026-10-15', [vencida], [completada('2026-10-13')]);
    expect(c.relevante).toBe(true);
    expect(c.items[0]).toMatchObject({ seccion: 'atencion', vencida: true });
    expect(aviso('2026-10-15', [], [completada('2026-10-13')], [prevista('2026-10-17')]).relevante).toBe(true);
  });

  it('sábado al 100 %: aparece igual, como cierre "todo al día"', () => {
    const c = aviso('2026-10-17', [], [completada('2026-10-12'), completada('2026-10-15')]);
    expect(c).toMatchObject({ momento: 'sabado', relevante: true, todoAlDia: true, items: [] });
  });

  it('sábado con lo que falta: lo lista (incluida una Programada del domingo); sin actividad, no aparece', () => {
    const c = aviso('2026-10-17', [tarea({ titulo: 'Falta', fecha_inicio: '2026-10-16' })], [completada('2026-10-13')], [prevista('2026-10-18')]);
    expect(c.todoAlDia).toBe(false);
    expect(titulos(c)).toEqual(['Falta', 'Programada 2026-10-18']);
    expect(aviso('2026-10-17', []).relevante).toBe(false);
  });

  it('una completada tarde de otra semana cuenta como actividad del cierre, pero no cambia el progreso', () => {
    const tardia = completada('2026-10-02', '2026-10-13T15:00:00Z');
    const c = aviso('2026-10-17', [], [tardia]);
    expect(c.relevante).toBe(true);
    expect(c.todoAlDia).toBe(true);
  });
});
