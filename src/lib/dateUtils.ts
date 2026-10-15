/**
 * Utilidades de manejo de fechas con soporte de zona horaria
 * Permite consistencia en operaciones de fecha independientemente del dispositivo
 */

// Mapa de países a zonas horarias
export const COUNTRY_TIMEZONES: Record<string, string> = {
  AR: 'America/Argentina/Buenos_Aires',
  MX: 'America/Mexico_City',
  CO: 'America/Bogota',
  CL: 'America/Santiago',
  PE: 'America/Lima',
  EC: 'America/Guayaquil',
  UY: 'America/Montevideo',
  PY: 'America/Asuncion',
  BO: 'America/La_Paz',
  VE: 'America/Caracas',
  ES: 'Europe/Madrid',
  BR: 'America/Sao_Paulo',
  CR: 'America/Costa_Rica',
  PA: 'America/Panama',
  DO: 'America/Santo_Domingo',
  GT: 'America/Guatemala',
  HN: 'America/Tegucigalpa',
  SV: 'America/El_Salvador',
  NI: 'America/Managua',
  PR: 'America/Puerto_Rico',
  CU: 'America/Havana',
};

// Lista de países para el selector
export const COUNTRIES = [
  { code: 'AR', name: 'Argentina', flag: '🇦🇷' },
  { code: 'MX', name: 'México', flag: '🇲🇽' },
  { code: 'CO', name: 'Colombia', flag: '🇨🇴' },
  { code: 'CL', name: 'Chile', flag: '🇨🇱' },
  { code: 'PE', name: 'Perú', flag: '🇵🇪' },
  { code: 'EC', name: 'Ecuador', flag: '🇪🇨' },
  { code: 'UY', name: 'Uruguay', flag: '🇺🇾' },
  { code: 'PY', name: 'Paraguay', flag: '🇵🇾' },
  { code: 'BO', name: 'Bolivia', flag: '🇧🇴' },
  { code: 'VE', name: 'Venezuela', flag: '🇻🇪' },
  { code: 'ES', name: 'España', flag: '🇪🇸' },
  { code: 'BR', name: 'Brasil', flag: '🇧🇷' },
  { code: 'CR', name: 'Costa Rica', flag: '🇨🇷' },
  { code: 'PA', name: 'Panamá', flag: '🇵🇦' },
  { code: 'DO', name: 'República Dominicana', flag: '🇩🇴' },
  { code: 'GT', name: 'Guatemala', flag: '🇬🇹' },
  { code: 'HN', name: 'Honduras', flag: '🇭🇳' },
  { code: 'SV', name: 'El Salvador', flag: '🇸🇻' },
  { code: 'NI', name: 'Nicaragua', flag: '🇳🇮' },
  { code: 'PR', name: 'Puerto Rico', flag: '🇵🇷' },
  { code: 'CU', name: 'Cuba', flag: '🇨🇺' },
];

/**
 * Calcula el offset UTC de una zona horaria IANA para una fecha dada.
 * Retorna un string como "+03:00" o "-05:00".
 */
function getTimezoneOffsetString(date: Date, tz: string): string {
  try {
    // Usar Intl para obtener el offset en la zona horaria dada
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'longOffset',
    });
    const parts = formatter.formatToParts(date);
    const tzPart = parts.find(p => p.type === 'timeZoneName');
    if (tzPart) {
      // tzPart.value es algo como "GMT-03:00" o "GMT+05:30" o "GMT"
      const match = tzPart.value.match(/GMT([+-]\d{2}:\d{2})/);
      if (match) return match[1];
      // "GMT" sin offset = UTC
      if (tzPart.value === 'GMT') return '+00:00';
    }
  } catch {
    // fallback si el timezone no es válido
  }
  // Fallback: usar el offset del browser local
  const offsetMin = date.getTimezoneOffset();
  const sign = offsetMin <= 0 ? '+' : '-';
  const absMin = Math.abs(offsetMin);
  const h = String(Math.floor(absMin / 60)).padStart(2, '0');
  const m = String(absMin % 60).padStart(2, '0');
  return `${sign}${h}:${m}`;
}

/**
 * Obtiene el inicio del día en formato string para queries de Supabase.
 * Si se proporciona timezone, incluye el offset para que PostgreSQL
 * interprete la hora correctamente en esa zona horaria.
 */
export function getStartOfDayLocal(date: Date, timezone?: string | null): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const base = `${year}-${month}-${day}T00:00:00`;
  if (timezone) {
    return `${base}${getTimezoneOffsetString(date, timezone)}`;
  }
  return base;
}

/**
 * Obtiene el fin del día en formato string para queries de Supabase.
 * Si se proporciona timezone, incluye el offset para que PostgreSQL
 * interprete la hora correctamente en esa zona horaria.
 */
export function getEndOfDayLocal(date: Date, timezone?: string | null): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const base = `${year}-${month}-${day}T23:59:59`;
  if (timezone) {
    return `${base}${getTimezoneOffsetString(date, timezone)}`;
  }
  return base;
}

/**
 * Formatea una fecha para display en formato YYYY-MM-DD
 */
export function formatDateForQuery(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Mismo respaldo que usa la base cuando `organizations.timezone` falta o no es válida (`_tareas_auto_hoy`). */
const TIMEZONE_RESPALDO = 'America/Argentina/Buenos_Aires';

/** Día civil, sin conversión a la zona del dispositivo. */
export function calendarDayDifference(date: string, reference: string): number {
  return (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${reference}T00:00:00Z`)) / 86_400_000;
}

export function formatCalendarDate(date: string): string {
  return new Intl.DateTimeFormat('es', { timeZone: 'UTC', day: '2-digit', month: 'short' }).format(new Date(`${date}T00:00:00Z`));
}

export function formatTimestampInTimezone(value: string, timezone?: string | null, includeTime = true): string {
  const options: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', year: 'numeric', ...(includeTime ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } as const : {}) };
  try {
    return new Intl.DateTimeFormat('es', { ...options, timeZone: timezone || TIMEZONE_RESPALDO }).format(new Date(value));
  } catch {
    return new Intl.DateTimeFormat('es', { ...options, timeZone: TIMEZONE_RESPALDO }).format(new Date(value));
  }
}

/**
 * "Hoy" (YYYY-MM-DD) en la zona horaria de la organización, NO en la del navegador.
 * Es el mismo día que calcula la base con `organizations.timezone` para Tareas automáticas
 * (`_tareas_auto_hoy`): si la zona falta o no es válida, usa Buenos Aires como ella.
 */
export function todayInTimezoneIso(timezone?: string | null, now: Date = new Date()): string {
  for (const tz of [timezone, TIMEZONE_RESPALDO]) {
    if (!tz) continue;
    try {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
      const get = (type: string) => parts.find(p => p.type === type)?.value;
      const y = get('year'), m = get('month'), d = get('day');
      if (y && m && d) return `${y}-${m}-${d}`;
    } catch {
      // zona inválida: probar el respaldo
    }
  }
  return now.toISOString().slice(0, 10);
}

/**
 * Convierte "2026-04-15" → "Martes 15 de abril"
 */
export function formatFechaLegible(fecha: string): string {
  try {
    const [year, month, day] = fecha.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    const formatter = new Intl.DateTimeFormat('es', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
    const result = formatter.format(date);
    return result.charAt(0).toUpperCase() + result.slice(1);
  } catch {
    return fecha;
  }
}

/**
 * Genera URL de Google Calendar con timezone correcto.
 * Convierte fecha + hora local a UTC usando el timezone de la org.
 */
export function buildGoogleCalendarUrl(params: {
  title: string;
  description: string;
  location: string;
  fecha: string;
  horaInicio: string;
  horaFin: string;
  timezone?: string | null;
}): string {
  const { title, description, location, fecha, horaInicio, horaFin, timezone } = params;

  // Parse local date+time
  const startLocal = new Date(`${fecha}T${horaInicio}:00`);
  const endLocal = new Date(`${fecha}T${horaFin}:00`);

  // If we have a timezone, compute the offset and convert to UTC
  if (timezone) {
    const offsetStr = getTimezoneOffsetString(startLocal, timezone);
    const match = offsetStr.match(/([+-])(\d{2}):(\d{2})/);
    if (match) {
      const sign = match[1] === '+' ? 1 : -1;
      const offsetMinutes = sign * (parseInt(match[2]) * 60 + parseInt(match[3]));
      // UTC = local - offset
      startLocal.setMinutes(startLocal.getMinutes() - offsetMinutes);
      endLocal.setMinutes(endLocal.getMinutes() - offsetMinutes);
    }
  }

  const fmt = (d: Date) => {
    const y = d.getUTCFullYear();
    const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
    const da = String(d.getUTCDate()).padStart(2, '0');
    const h = String(d.getUTCHours()).padStart(2, '0');
    const mi = String(d.getUTCMinutes()).padStart(2, '0');
    return `${y}${mo}${da}T${h}${mi}00Z`;
  };

  const dates = `${fmt(startLocal)}/${fmt(endLocal)}`;

  const url = new URL('https://www.google.com/calendar/render');
  url.searchParams.set('action', 'TEMPLATE');
  url.searchParams.set('text', title);
  url.searchParams.set('dates', dates);
  url.searchParams.set('details', description);
  url.searchParams.set('location', location);

  return url.toString();
}
