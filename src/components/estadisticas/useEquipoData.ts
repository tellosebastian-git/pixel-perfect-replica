import { useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { format, startOfMonth, endOfMonth, subMonths, eachMonthOfInterval, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import type { Sucursal } from '@/contexts/SucursalContext';
import { alcanzoLimiteFilas } from './rowLimit';
import { useReadState, type ReadPhase } from '@/hooks/useReadState';


export interface BarberoMonthStats {
  month: string;
  monthLabel: string;
  facturacion: number;
  servicios: number;
  comisionDevengada: number;
}

export interface BarberoRankingRow {
  id: string;
  nombre: string;
  facturacion: number;
  servicios: number;
  comisionDevengada: number;
  ticketPromedio: number;
}

export interface ProductoRankingRow {
  id: string;
  nombre: string;
  totalProductos: number;
}

/**
 * Datos para la Sección Equipo: 3 rankings del mes actual (facturación, servicios, comisión
 * devengada) + 1 ranking condicional de venta de productos + historial mensual por barbero
 * (para el detalle al click, sobre el mismo rango de `periodoMeses` que el resto del panel).
 *
 * Filtro de "barbero" en todo el hook: `barberos.roles_equipo` incluye 'barber' — mismo criterio
 * que el fix de DailySummary.tsx / useOcupacionResumen.ts, no el conteo genérico de activos.
 */
interface EquipoBundle {
  rankingActual: BarberoRankingRow[];
  productosRanking: ProductoRankingRow[];
  historialPorBarbero: Map<string, BarberoMonthStats[]>;
  datosIncompletos: boolean;
}

const EMPTY_BUNDLE: EquipoBundle = {
  rankingActual: [], productosRanking: [], historialPorBarbero: new Map(), datosIncompletos: false,
};

export function useEquipoData(
  organizationId: string | undefined,
  currentSucursal: Sucursal | null,
  periodoMeses: string,
) {
  const contextKey = `${organizationId ?? 'none'}::${currentSucursal?.id ?? 'all'}::${periodoMeses}`;

  const readState = useReadState<EquipoBundle>({
    contextKey,
    errorMessage: 'No pudimos cargar los datos de equipo.',
    staleErrorMessage: 'No pudimos actualizar los datos de equipo.',
    surfaceId: `estadisticas-equipo:${organizationId ?? 'none'}`,
  });

  const fetchAll = useCallback(() => {
    readState.run(async (signal) => {
      if (!organizationId) return { data: null, error: null };

      const meses = parseInt(periodoMeses);
      const endDate = endOfMonth(new Date());
      const startDate = startOfMonth(subMonths(new Date(), meses - 1));
      const today = new Date();
      const currentMonthStart = startOfMonth(today);
      const currentMonthEnd = endOfMonth(today);
      const currentMonthStr = format(today, 'yyyy-MM');

      let barberosQuery = supabase
        .from('barberos')
        .select('id, nombre, apellido, roles_equipo')
        .eq('organization_id', organizationId)
        .eq('activo', true);
      if (currentSucursal) barberosQuery = barberosQuery.eq('sucursal_id', currentSucursal.id);

      let ingresosQuery = supabase
        .from('ingresos')
        .select('barbero_id, created_at, total_facturado, cantidad_de_servicios, sueldo, comision_productos, estado')
        .eq('organization_id', organizationId)
        .gte('created_at', startDate.toISOString())
        .lte('created_at', endDate.toISOString())
        .neq('estado', 'eliminado');
      if (currentSucursal) ingresosQuery = ingresosQuery.eq('sucursal_id', currentSucursal.id);

      // venta_producto tiene organization_id/sucursal_id/created_at propios — no hace falta
      // joinear contra `venta` para filtrar por fecha o sucursal.
      let ventaProductoQuery = supabase
        .from('venta_producto')
        .select('barbero_id, subtotal')
        .eq('organization_id', organizationId)
        .gte('created_at', currentMonthStart.toISOString())
        .lte('created_at', currentMonthEnd.toISOString());
      if (currentSucursal) ventaProductoQuery = ventaProductoQuery.eq('sucursal_id', currentSucursal.id);

      const [barberosRes, ingresosRes, ventaProductoRes] = await Promise.all([
        barberosQuery.abortSignal(signal), ingresosQuery.abortSignal(signal), ventaProductoQuery.abortSignal(signal),
      ]);
      const failed = [barberosRes, ingresosRes, ventaProductoRes].find((r) => r.error);
      if (failed) {
        return { data: null, error: failed.error, status: (failed as { status?: number }).status };
      }

      // Salvaguarda de truncado: este hook sigue leyendo filas crudas y agregando en cliente.
      const datosIncompletos =
        alcanzoLimiteFilas(ingresosRes.data) || alcanzoLimiteFilas(ventaProductoRes.data);


      const barberosBarber = (barberosRes.data || []).filter(
        (b) => Array.isArray(b.roles_equipo) && (b.roles_equipo as string[]).includes('barber'),
      );
      const nombreMap = new Map<string, string>();
      barberosBarber.forEach((b) => nombreMap.set(b.id, `${b.nombre} ${b.apellido || ''}`.trim()));
      const barberoIds = new Set(nombreMap.keys());

      const ingresos = (ingresosRes.data || []).filter(
        (i) => i.barbero_id && barberoIds.has(i.barbero_id as string),
      );

      // Ranking del mes actual
      const actualByBarbero = new Map<string, { facturacion: number; servicios: number; comision: number }>();
      ingresos.forEach((i) => {
        const mes = format(parseISO(i.created_at), 'yyyy-MM');
        if (mes !== currentMonthStr) return;
        const bid = i.barbero_id as string;
        const acc = actualByBarbero.get(bid) || { facturacion: 0, servicios: 0, comision: 0 };
        acc.facturacion += Number(i.total_facturado) || 0;
        acc.servicios += Number(i.cantidad_de_servicios) || 0;
        acc.comision += (Number(i.sueldo) || 0) + (Number(i.comision_productos) || 0);
        actualByBarbero.set(bid, acc);
      });

      const rankingActual: BarberoRankingRow[] = Array.from(actualByBarbero.entries()).map(([bid, acc]) => ({
        id: bid,
        nombre: nombreMap.get(bid) || 'Sin nombre',
        facturacion: acc.facturacion,
        servicios: acc.servicios,
        comisionDevengada: acc.comision,
        ticketPromedio: acc.servicios > 0 ? acc.facturacion / acc.servicios : 0,
      }));

      // Historial mensual por barbero, para el detalle al click (mismo rango que el resto del panel)
      const months = eachMonthOfInterval({ start: startDate, end: endDate });
      const historialPorBarbero = new Map<string, BarberoMonthStats[]>();
      barberoIds.forEach((bid) => {
        const ingresosBarbero = ingresos.filter((i) => i.barbero_id === bid);
        const serie: BarberoMonthStats[] = months.map((monthDate) => {
          const monthStart = startOfMonth(monthDate);
          const monthEnd = endOfMonth(monthDate);
          const rows = ingresosBarbero.filter((i) => {
            const d = parseISO(i.created_at);
            return d >= monthStart && d <= monthEnd;
          });
          return {
            month: format(monthDate, 'yyyy-MM'),
            monthLabel: format(monthDate, 'MMM yy', { locale: es }),
            facturacion: rows.reduce((s, i) => s + (Number(i.total_facturado) || 0), 0),
            servicios: rows.reduce((s, i) => s + (Number(i.cantidad_de_servicios) || 0), 0),
            comisionDevengada: rows.reduce((s, i) => s + (Number(i.sueldo) || 0) + (Number(i.comision_productos) || 0), 0),
          };
        });
        historialPorBarbero.set(bid, serie);
      });

      // Ranking de venta de productos — condicional (ver EstadisticasPanel.tsx: no se renderiza
      // en absoluto si queda vacío).
      const productosPorBarbero = new Map<string, number>();
      (ventaProductoRes.data || []).forEach((vp) => {
        if (!vp.barbero_id || !barberoIds.has(vp.barbero_id)) return;
        productosPorBarbero.set(
          vp.barbero_id,
          (productosPorBarbero.get(vp.barbero_id) || 0) + (Number(vp.subtotal) || 0),
        );
      });
      const productosRanking: ProductoRankingRow[] = Array.from(productosPorBarbero.entries()).map(([bid, total]) => ({
        id: bid,
        nombre: nombreMap.get(bid) || 'Sin nombre',
        totalProductos: total,
      }));

      return { data: { rankingActual, productosRanking, historialPorBarbero, datosIncompletos }, error: null };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, currentSucursal, periodoMeses, readState.run]);

  useEffect(() => {
    if (organizationId) fetchAll();
  }, [organizationId, fetchAll]);

  const bundle = readState.data ?? EMPTY_BUNDLE;

  return {
    rankingActual: bundle.rankingActual,
    productosRanking: bundle.productosRanking,
    historialPorBarbero: bundle.historialPorBarbero,
    datosIncompletos: bundle.datosIncompletos,
    isLoading: readState.phase === 'loading',
    phase: readState.phase as ReadPhase,
    error: readState.error,
    retry: readState.retry,
  };
}
