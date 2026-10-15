import { describe, expect, it, vi } from 'vitest';
import { readAllTaskPages } from './tareasData';
import { calendarDayDifference, formatCalendarDate, formatTimestampInTimezone } from './dateUtils';
import { getTareaVencimiento } from './tareasVencimiento';

describe('4A-1: carga completa sin truncamiento', () => {
  it('recupera más de 1000 filas aunque el servidor limite cada página', async () => {
    const rows = Array.from({ length: 1105 }, (_, i) => ({ id: String(2000 - i), created_at: '2026-10-13T00:00:00Z' }));
    const fetch = vi.fn(async (cursor) => {
      const start = cursor ? rows.findIndex(r => r.id === cursor.id) + 1 : 0;
      return rows.slice(start, start + 200);
    });
    expect(await readAllTaskPages(fetch)).toEqual(rows);
    expect(fetch).toHaveBeenCalledTimes(7);
  });
  it('no entrega una lista parcial si falla una página posterior', async () => {
    const fetch = vi.fn().mockResolvedValueOnce([{ id: 'a', created_at: '2026-10-13' }]).mockRejectedValueOnce(new Error('offline'));
    await expect(readAllTaskPages(fetch)).rejects.toThrow('offline');
  });
  it('detecta un cursor que no avanza', async () => {
    await expect(readAllTaskPages(async () => [{ id: 'a', created_at: '2026-10-13' }])).rejects.toThrow();
  });
});

describe('4A-1: fechas de calendario de la organización', () => {
  it('compara días civiles sin redondear horas ni depender de DST', () => {
    expect(calendarDayDifference('2026-10-13', '2026-10-13')).toBe(0);
    expect(calendarDayDifference('2026-10-12', '2026-10-13')).toBe(-1);
    expect(calendarDayDifference('2026-03-09', '2026-03-08')).toBe(1);
    expect(formatCalendarDate('2026-10-13')).toContain('13');
  });
  it('calcula vencimiento con el día de la organización', () => {
    const tarea = { tipo: 'tarea', estado: 'en_progreso', fecha_inicio: '2026-10-11', created_at: '2026-10-11T00:00:00Z' };
    const now = new Date('2026-10-13T01:00:00Z');
    expect(getTareaVencimiento(tarea, 1, 'America/Argentina/Buenos_Aires', now)).toEqual({ vencida: false, diasRestantes: 0 });
    expect(getTareaVencimiento(tarea, 1, 'Europe/Madrid', now)).toEqual({ vencida: true, diasRestantes: -1 });
  });
  it('formatea timestamps en la zona de la organización', () => {
    expect(formatTimestampInTimezone('2026-10-13T01:00:00Z', 'America/Argentina/Buenos_Aires')).toContain('12');
  });
});
