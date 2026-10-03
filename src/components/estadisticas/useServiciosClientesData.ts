import { useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { format, startOfMonth, endOfMonth, subMonths, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import type { Sucursal } from '@/contexts/SucursalContext';
import { alcanzoLimiteFilas } from './rowLimit';
import { useReadState, type ReadPhase } from '@/hooks/useReadState';

export interface MixServicioItem {
  servicio: string;
  facturacion: number;
  tickets: number;
}

export interface HoraItem {
  hora: number;
  tickets: number;
}

export interface DiaHoraItem {
  dia: number;
  hora: number;
  tickets: number;
}

/** Ventas agregadas por mes, ya resueltas en la base (huso horario de la sucursal). */
export interface VentasAgregadasMes {
  month: string;
  tickets: number;
  mix: MixServicioItem[];
  porHora: HoraItem[];
  porDiaHora: DiaHoraItem[];
}

export interface MonthlyServiciosClientesData {
  month: string;
  monthLabel: string;
  tasaAttachExtras: number;
  ingresoExtras: number;
  clientesNuevos: number;
  clientesManual: number;
  clientesImportado: number;
  clientesReserva: number;
  pctEligioBarbero: number;
  /** Solo para el mes en curso: mismo recorte "primeros N días" que el resto del panel. */
  parcialClientesNuevos?: number;
}

/**
 * Datos de la Sección 4 (Servicios y clientes).
 *
 * Ventas (mix de servicios, attach de extras, distribución por hora y día-hora): salen de
 * `estadisticas_ventas_agregadas(...)`, agregadas en Postgres con el huso horario de la
 * sucursal. Antes se traían las filas crudas de `venta` y se agregaban en el cliente, lo que
 * truncaba silenciosamente a 1000 filas en períodos largos.
 *
 * Clientes nuevos y % que eligió barbero siguen leyéndose como filas (volumen bajo), con la
 * salvaguarda de truncado activa.
 */
interface ServiciosClientesBundle {
  monthlyStats: MonthlyServiciosClientesData[];
  ventasAgregadas: VentasAgregadasMes[];
  datosIncompletos: boolean;
}

const EMPTY_BUNDLE: ServiciosClientesBundle = { monthlyStats: [], ventasAgregadas: [], datosIncompletos: false };

export function useServiciosClientesData(
  organizationId: string | undefined,
  currentSucursal: Sucursal | null,
  periodoMeses: string,
) {
  const contextKey = `${organizationId ?? 'none'}::${currentSucursal?.id ?? 'all'}::${periodoMeses}`;

  const readState = useReadState<ServiciosClientesBundle>({
    contextKey,
    errorMessage: 'No pudimos cargar las métricas de servicios y clientes.',
    staleErrorMessage: 'No pudimos actualizar las métricas de servicios y clientes.',
    surfaceId: `estadisticas-servicios-clientes:${organizationId ?? 'none'}`,
  });

  const fetchAll = useCallback(() => {
    readState.run(async (signal) => {
      if (!organizationId) return { data: null, error: null };

      const meses = parseInt(periodoMeses);
      const endDate = endOfMonth(new Date());
      const startDate = startOfMonth(subMonths(new Date(), meses - 1));
      const today = new Date();
      const diaActual = today.getDate();
      const currentMonthStr = format(today, 'yyyy-MM');

      // `clientes` no tiene columna sucursal_id — "Clientes nuevos" queda a nivel organización
      // aunque haya un filtro de sucursal activo.
      const clientesQuery = supabase
        .from('clientes')
        .select('created_at, origen')
        .eq('organization_id', organizationId)
        .eq('eliminado', false)
        .gte('created_at', startDate.toISOString())
        .lte('created_at', endDate.toISOString());

      let turnosQuery = supabase
        .from('turnos')
        .select('fecha, eligio_barbero')
        .eq('organization_id', organizationId)
        .gte('fecha', format(startDate, 'yyyy-MM-dd'))
        .lte('fecha', format(endDate, 'yyyy-MM-dd'));
      if (currentSucursal) turnosQuery = turnosQuery.eq('sucursal_id', currentSucursal.id);

      const ventasRpc = supabase.rpc('estadisticas_ventas_agregadas', {
        _organization_id: organizationId,
        _sucursal_id: currentSucursal?.id ?? undefined,
        _meses: meses,
      });

      const [clientesRes, turnosRes, ventasRes] = await Promise.all([
        clientesQuery.abortSignal(signal),
        turnosQuery.abortSignal(signal),
        ventasRpc.abortSignal(signal),
      ]);
      const failed = [clientesRes, turnosRes, ventasRes].find((r) => r.error);
      if (failed) {
        return { data: null, error: failed.error, status: (failed as { status?: number }).status };
      }

      // Salvaguarda de truncado: solo aplica a las consultas que todavía leen filas crudas.
      const datosIncompletos = alcanzoLimiteFilas(clientesRes.data) || alcanzoLimiteFilas(turnosRes.data);

      const clientes = clientesRes.data || [];
      const turnos = turnosRes.data || [];
      const ventasRows = ventasRes.data || [];

      const agregadas: VentasAgregadasMes[] = ventasRows.map((r) => ({
        month: String(r.mes).slice(0, 7),
        tickets: Number(r.tickets) || 0,
        mix: ((r.mix ?? []) as unknown as MixServicioItem[]).map((m) => ({
          servicio: m.servicio,
          facturacion: Number(m.facturacion) || 0,
          tickets: Number(m.tickets) || 0,
        })),
        porHora: ((r.por_hora ?? []) as unknown as HoraItem[]).map((h) => ({
          hora: Number(h.hora) || 0,
          tickets: Number(h.tickets) || 0,
        })),
        porDiaHora: ((r.por_dia_hora ?? []) as unknown as DiaHoraItem[]).map((d) => ({
          dia: Number(d.dia) || 0,
          hora: Number(d.hora) || 0,
          tickets: Number(d.tickets) || 0,
        })),
      }));

      const monthlyStats: MonthlyServiciosClientesData[] = ventasRows.map((r, idx) => {
        const monthDate = parseISO(`${String(r.mes).slice(0, 10)}T00:00:00`);
        const monthStr = format(monthDate, 'yyyy-MM');
        const monthStart = startOfMonth(monthDate);
        const monthEnd = endOfMonth(monthDate);

        const clientesDelMes = clientes.filter((c) => {
          const d = parseISO(c.created_at);
          return d >= monthStart && d <= monthEnd;
        });
        const clientesNuevos = clientesDelMes.length;
        const clientesManual = clientesDelMes.filter((c) => c.origen === 'manual').length;
        const clientesImportado = clientesDelMes.filter((c) => c.origen === 'importado').length;
        const clientesReserva = clientesDelMes.filter((c) => c.origen === 'reserva').length;

        const turnosDelMes = turnos.filter((t) => {
          const d = parseISO(t.fecha);
          return d >= monthStart && d <= monthEnd;
        });
        const pctEligioBarbero = turnosDelMes.length > 0
          ? (turnosDelMes.filter((t) => t.eligio_barbero).length / turnosDelMes.length) * 100
          : 0;

        // Parcial (mismos primeros N días) solo para clientesNuevos — mismo patrón cumulativo
        // que Facturación/Servicios; los ratios se comparan mes completo contra mes completo.
        const nextMonthStr = idx < ventasRows.length - 1
          ? String(ventasRows[idx + 1].mes).slice(0, 7)
          : null;
        let parcialClientesNuevos: number | undefined;
        if (nextMonthStr === currentMonthStr) {
          parcialClientesNuevos = clientesDelMes.filter((c) => parseISO(c.created_at).getDate() <= diaActual).length;
        }

        return {
          month: monthStr,
          monthLabel: format(monthDate, 'MMM yy', { locale: es }),
          // Ya resueltas en la base (fin_* / estadisticas_ventas_agregadas): no se recalculan acá.
          tasaAttachExtras: Number(r.tasa_attach_extras) || 0,
          ingresoExtras: Number(r.extras_ingreso) || 0,
          clientesNuevos,
          clientesManual,
          clientesImportado,
          clientesReserva,
          pctEligioBarbero,
          parcialClientesNuevos,
        };
      });

      return { data: { monthlyStats, ventasAgregadas: agregadas, datosIncompletos }, error: null };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, currentSucursal, periodoMeses, readState.run]);

  useEffect(() => {
    if (organizationId) fetchAll();
  }, [organizationId, fetchAll]);

  const bundle = readState.data ?? EMPTY_BUNDLE;

  return {
    monthlyStats: bundle.monthlyStats,
    ventasAgregadas: bundle.ventasAgregadas,
    datosIncompletos: bundle.datosIncompletos,
    isLoading: readState.phase === 'loading',
    phase: readState.phase as ReadPhase,
    error: readState.error,
    retry: readState.retry,
  };
}
