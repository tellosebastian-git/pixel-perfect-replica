import { describe, expect, it } from 'vitest';
import type { Tarea } from '@/hooks/useTareas';
import {
  agruparTareas, coincideFiltro, formatDiaCorto, formatRangoSemana, progresoSemanal, resueltasDeLaSemana, type TareaPrevista,
} from './tareasAgenda';
import { historyCursorFilter, mensajeTareas, weekRange } from './tareasData';
import { describirRepeticion } from './tareasRepeticion';

// Miércoles 14 de octubre de 2026 (organización en Buenos Aires). Semana: lunes 12 a domingo 18.
const today = '2026-10-14';
const week = weekRange(today);
const ctx = { today, week, diasVencimiento: 1 };

let n = 0;
const tarea = (o: Partial<Tarea> = {}): Tarea => ({
  id: `t${++n}`, organization_id: 'org', tipo: 'tarea', titulo: `Tarea ${n}`, descripcion: null, estado: 'pendiente',
  asignado_a_id: null, asignado_a_nombre: null, creado_por_id: 'u', creado_por_nombre: 'Ana', assignment_scope: 'team',
  sucursal_id: 's1', recurrente: false, fecha_inicio: today, fecha_limite: null, hora: null, repeat_preset: null,
  repeat_frequency: null, repeat_interval: null, repeat_byweekday: null, vencimiento_dias: null, completada_por_id: null,
  completada_por_nombre: null, completada_at: null, recurrencia_id: null, vencida_at: null,
  created_at: '2026-10-01T12:00:00Z', updated_at: '2026-10-01T12:00:00Z', accion_version: 'v', ...o,
});
const prevista = (fecha: string, o: Partial<TareaPrevista> = {}): TareaPrevista => ({
  recurrencia_id: 'r1', fecha, hora: null, titulo: 'Limpieza', descripcion: null, sucursal_id: 's1', assignment_scope: 'team',
  asignado_a_id: null, asignado_a_nombre: null, ...o,
});
const ids = (items: { kind: string; tarea?: Tarea; prevista?: TareaPrevista }[]) =>
  items.map(i => (i.kind === 'tarea' ? i.tarea!.titulo : `prevista ${i.prevista!.fecha}`));

describe('semana de la organización', () => {
  it('va de lunes a domingo, también cuando hoy es domingo o lunes', () => {
    expect(weekRange('2026-10-14')).toEqual({ lunes: '2026-10-12', domingo: '2026-10-18' });
    expect(weekRange('2026-10-18')).toEqual({ lunes: '2026-10-12', domingo: '2026-10-18' });
    expect(weekRange('2026-10-12')).toEqual({ lunes: '2026-10-12', domingo: '2026-10-18' });
    expect(weekRange('2026-11-01')).toEqual({ lunes: '2026-10-26', domingo: '2026-11-01' });
    expect(formatRangoSemana(week)).toBe('12 al 18 oct');
    expect(formatDiaCorto('2026-10-16')).toBe('vie 16 oct');
  });
});

describe('jerarquía temporal', () => {
  const vencida = tarea({ titulo: 'Vencida', fecha_inicio: '2026-10-10', estado: 'vencida' });
  const progresoVencida = tarea({ titulo: 'En progreso vencida', fecha_inicio: '2026-10-12', estado: 'en_progreso', vencida_at: '2026-10-14T03:00:00Z' });
  const semanaPasada = tarea({ titulo: 'Semana pasada', fecha_inicio: '2026-10-11' });
  const deAyer = tarea({ titulo: 'De ayer', fecha_inicio: '2026-10-13' });
  const deHoy = tarea({ titulo: 'De hoy', hora: '10:00' });
  const deHoyTemprano = tarea({ titulo: 'De hoy temprano', hora: '08:00' });
  const futura = tarea({ titulo: 'Viernes', fecha_inicio: '2026-10-16' });
  const sinFechaVieja = tarea({ titulo: 'Sin fecha vieja', fecha_inicio: null, created_at: '2026-09-01T00:00:00Z' });
  const sinFechaNueva = tarea({ titulo: 'Sin fecha nueva', fecha_inicio: null, created_at: '2026-10-10T00:00:00Z' });
  const completada = tarea({ titulo: 'Completada', estado: 'completada' });
  const peticion = tarea({ titulo: 'Petición', tipo: 'peticion' });
  const agenda = agruparTareas(
    [futura, deHoy, sinFechaNueva, vencida, semanaPasada, deAyer, progresoVencida, sinFechaVieja, completada, peticion, deHoyTemprano],
    // Plazo de 7 días: "Semana pasada" todavía no venció, pero es de una semana anterior.
    [prevista('2026-10-17'), prevista('2026-10-15'), prevista(today), prevista('2026-10-13')], { ...ctx, diasVencimiento: 7 },
  );

  it('Necesitan atención: vencidas, en progreso + vencida y abiertas de semanas anteriores', () => {
    expect(ids(agenda.atencion)).toEqual(['Vencida', 'Semana pasada', 'En progreso vencida']);
    expect(agenda.atencion.find(i => i.tarea.titulo === 'Semana pasada')?.vencida).toBe(false);
    expect(agenda.atencion.find(i => i.tarea.titulo === 'En progreso vencida')?.vencida).toBe(true);
  });
  it('una tarea iniciada sigue en Hoy mientras no venza', () => {
    const iniciada = tarea({ titulo: 'Iniciada el lunes', fecha_inicio: '2026-10-12', estado: 'en_progreso' });
    const resultado = agruparTareas([iniciada], [], { ...ctx, diasVencimiento: 7 });
    expect(resultado.hoy[0]).toMatchObject({ kind: 'tarea', desde: '2026-10-12', vencida: false });
  });
  it('Hoy: las de hoy por hora y las de días anteriores de esta semana con "desde"', () => {
    expect(ids(agenda.hoy)).toEqual(['De ayer', 'De hoy temprano', 'De hoy', `prevista ${today}`]);
    expect(agenda.hoy[0]).toMatchObject({ kind: 'tarea', desde: '2026-10-13' });
  });
  it('Próximas: cronológicas, con las Programadas intercaladas y sin reconstruir el pasado', () => {
    expect(ids(agenda.proximas)).toEqual(['prevista 2026-10-15', 'Viernes', 'prevista 2026-10-17']);
  });
  it('Sin fecha: las más viejas primero; completadas y peticiones fuera de la agenda', () => {
    expect(ids(agenda.sinFecha)).toEqual(['Sin fecha vieja', 'Sin fecha nueva']);
    const todas = [...agenda.atencion, ...agenda.hoy, ...agenda.proximas, ...agenda.sinFecha];
    expect(ids(todas)).not.toContain('Completada');
    expect(ids(todas)).not.toContain('Petición');
  });
  it('una manual y una automática conviven en la misma sección', () => {
    const auto = tarea({ titulo: 'Automática de hoy', recurrencia_id: 'r1' });
    expect(ids(agruparTareas([deHoy, auto], [], ctx).hoy)).toEqual(['De hoy', 'Automática de hoy']);
  });
});

describe('progreso semanal', () => {
  it('cuenta solo lo de esta semana; sin fecha y anteriores quedan afuera; programadas cuentan', () => {
    const abiertas = [
      tarea({ fecha_inicio: '2026-10-12', estado: 'vencida' }),
      tarea({ fecha_inicio: today }),
      tarea({ fecha_inicio: '2026-10-18' }),
      tarea({ fecha_inicio: null }),
      tarea({ fecha_inicio: '2026-10-06' }),
    ];
    const resueltas = [
      tarea({ estado: 'completada', fecha_inicio: '2026-10-13', completada_at: '2026-10-13T15:00:00Z' }),
      tarea({ estado: 'completada', fecha_inicio: today, completada_at: '2026-10-14T15:00:00Z' }),
      // Completada tarde esta semana: aparece en Resueltas pero no suma al progreso de esta semana.
      tarea({ estado: 'completada', fecha_inicio: '2026-10-08', completada_at: '2026-10-13T15:00:00Z' }),
    ];
    expect(progresoSemanal(abiertas, resueltas, [prevista('2026-10-16'), prevista('2026-10-17')], ctx)).toEqual({
      completadas: 2, total: 7, vencidas: 1, pendientes: 2, programadas: 2, anteriores: 1,
    });
  });
});

describe('resueltas esta semana', () => {
  it('usa el día de la organización (incluye tardías) y ordena por completado', () => {
    const lunesTemprano = tarea({ titulo: 'Lunes 00:30 BA', estado: 'completada', completada_at: '2026-10-12T03:30:00Z' });
    const domingoAnterior = tarea({ titulo: 'Domingo 23:30 BA', estado: 'completada', completada_at: '2026-10-12T02:30:00Z' });
    const tardia = tarea({ titulo: 'Tardía', estado: 'completada', fecha_inicio: '2026-10-01', completada_at: '2026-10-14T12:00:00Z' });
    const resultado = resueltasDeLaSemana([lunesTemprano, domingoAnterior, tardia], week, 'America/Argentina/Buenos_Aires');
    expect(resultado.map(t => t.titulo)).toEqual(['Tardía', 'Lunes 00:30 BA']);
  });
});

describe('Mis tareas / Negocio', () => {
  const base = { miBarberoId: 'b1', misSucursales: ['s1'], responsable: 'todos', sucursal: 'todas' };
  it('Mis tareas: las individuales propias y las de equipo de mis sucursales', () => {
    const mias = { ...base, alcance: 'mias' as const };
    expect(coincideFiltro({ assignment_scope: 'individual', asignado_a_id: 'b1', sucursal_id: 's2' }, mias)).toBe(true);
    expect(coincideFiltro({ assignment_scope: 'individual', asignado_a_id: 'b2', sucursal_id: 's1' }, mias)).toBe(false);
    expect(coincideFiltro({ assignment_scope: 'team', asignado_a_id: null, sucursal_id: 's1' }, mias)).toBe(true);
    expect(coincideFiltro({ assignment_scope: 'team', asignado_a_id: null, sucursal_id: 's2' }, mias)).toBe(false);
  });
  it('Negocio: filtros de responsable y sucursal', () => {
    const negocio = { ...base, alcance: 'negocio' as const };
    const fila = { assignment_scope: 'individual', asignado_a_id: 'b2', sucursal_id: 's2' };
    expect(coincideFiltro(fila, negocio)).toBe(true);
    expect(coincideFiltro(fila, { ...negocio, responsable: 'b2' })).toBe(true);
    expect(coincideFiltro(fila, { ...negocio, responsable: '__team__' })).toBe(false);
    expect(coincideFiltro(fila, { ...negocio, sucursal: 's1' })).toBe(false);
  });
});

describe('datos y textos', () => {
  it('cursor del historial por fecha de completado, estable y con las sin fecha al final', () => {
    expect(historyCursorFilter({ id: 'a', completada_at: '2026-10-14T12:00:00+00:00' }))
      .toBe('completada_at.lt."2026-10-14T12:00:00+00:00",and(completada_at.eq."2026-10-14T12:00:00+00:00",id.lt."a"),completada_at.is.null');
    expect(historyCursorFilter({ id: 'a', completada_at: null })).toBe('and(completada_at.is.null,id.lt."a")');
  });
  it('nunca muestra un error técnico crudo', () => {
    expect(mensajeTareas({ code: '23514', message: 'violates check constraint' }, 'No pudimos guardar.')).toBe('No pudimos guardar.');
    expect(mensajeTareas(new TypeError('Failed to fetch'), 'No pudimos guardar.')).toBe('No pudimos guardar.');
    expect(mensajeTareas(new Error('Seleccioná una sucursal válida para crear la tarea.'), 'x')).toBe('Seleccioná una sucursal válida para crear la tarea.');
  });
  it('describe la repetición con la terminología de Vittro', () => {
    expect(describirRepeticion({ repeat_preset: 'weekdays' })).toBe('Entre semana (lunes a viernes)');
    expect(describirRepeticion({ repeat_preset: 'custom', repeat_frequency: 'weekly', repeat_interval: 2, repeat_byweekday: [6, 1] }))
      .toBe('Cada 2 semanas, los lunes y sábados');
    expect(describirRepeticion({ repeat_preset: 'custom', repeat_frequency: 'monthly', repeat_interval: 1 })).toBe('Cada mes');
  });
});
