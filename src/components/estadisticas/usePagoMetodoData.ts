import { useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { startOfMonth, endOfMonth, subMonths, format } from 'date-fns';
import type { Sucursal } from '@/contexts/SucursalContext';
import { alcanzoLimiteFilas } from './rowLimit';
import { useReadState, type ReadPhase } from '@/hooks/useReadState';


export interface MontoPorMetodo {
  efectivo: number;
  mercado_pago: number;
  transferencia: number;
  debito: number;
  credito: number;
}

function emptyMontos(): MontoPorMetodo {
  return { efectivo: 0, mercado_pago: 0, transferencia: 0, debito: 0, credito: 0 };
}

/**
 * ⚠️ ESPEJO: el desglose por método de pago (con el fallback venta_pagos → venta) también
 * existe en la función SQL public.generar_resumenes_mensuales()
 * (migración 20260801030358_c08bb365-6c9c-4c57-8bea-1d4c9e4d7c28.sql).
 * Si cambiás esta fórmula acá, actualizala también ahí — no hay sincronización automática.
 *
 * Composición de cobros por método de pago — mes actual vs. mes anterior, para el
 * donut "Cómo se cobra" y su línea de tendencia ("Digital +X% vs. mes anterior").
 * Independiente del selector de período del panel: siempre compara el mes
 * calendario actual contra el inmediatamente anterior.
 *
 * Fallback venta_pagos → venta idéntico al de useTransactions.ts (loadTransactionsByDate):
 * si una venta no tiene filas en venta_pagos (pre 17/abr/2026, o cualquier hueco), se
 * cuenta como un único pago con venta.metodo_pago + venta.total_final.
 */
interface PagoMetodoBundle {
  montosMesActual: MontoPorMetodo;
  montosMesAnterior: MontoPorMetodo;
  datosIncompletos: boolean;
}

const EMPTY_BUNDLE: PagoMetodoBundle = {
  montosMesActual: emptyMontos(), montosMesAnterior: emptyMontos(), datosIncompletos: false,
};

export function usePagoMetodoData(
  organizationId: string | undefined,
  currentSucursal: Sucursal | null,
) {
  const contextKey = `${organizationId ?? 'none'}::${currentSucursal?.id ?? 'all'}`;

  const readState = useReadState<PagoMetodoBundle>({
    contextKey,
    errorMessage: 'No pudimos cargar los métodos de pago.',
    staleErrorMessage: 'No pudimos actualizar los métodos de pago.',
    surfaceId: `estadisticas-pago-metodo:${organizationId ?? 'none'}`,
  });

  const fetchAll = useCallback(() => {
    readState.run(async (signal) => {
      if (!organizationId) return { data: null, error: null };

      const today = new Date();
      const rangeStart = startOfMonth(subMonths(today, 1));
      const rangeEnd = endOfMonth(today);
      const currentMonthStr = format(today, 'yyyy-MM');

      let ventaQuery = supabase
        .from('venta')
        .select('id, fecha_hora, metodo_pago, total_final')
        .eq('organization_id', organizationId)
        .eq('estado', 'activo')
        .gte('fecha_hora', rangeStart.toISOString())
        .lte('fecha_hora', rangeEnd.toISOString());
      if (currentSucursal) {
        ventaQuery = ventaQuery.eq('sucursal_id', currentSucursal.id);
      }

      // venta_pagos vía embed `!inner` a `venta` — filtros server-side por org/sucursal/estado/
      // rango, sin materializar una lista larga de UUIDs (evita 400 Bad Request por URL demasiado
      // larga en organizaciones con alto volumen). Se tipa el select como `string` plano para
      // no disparar el parser de tipos costoso de supabase-js sobre el embed.
      const sel = (s: string): string => s;
      let pagosQuery = supabase
        .from('venta_pagos')
        .select(sel('venta_id, metodo_pago, monto, venta!inner(organization_id, sucursal_id, estado, fecha_hora)'))
        .eq('venta.organization_id', organizationId)
        .eq('venta.estado', 'activo')
        .gte('venta.fecha_hora', rangeStart.toISOString())
        .lte('venta.fecha_hora', rangeEnd.toISOString());
      if (currentSucursal) {
        pagosQuery = pagosQuery.eq('venta.sucursal_id', currentSucursal.id);
      }

      type PagoRow = { venta_id: string; metodo_pago: string; monto: number | string | null };

      const [ventasRes, pagosRes] = await Promise.all([
        ventaQuery.abortSignal(signal),
        pagosQuery.returns<PagoRow[]>().abortSignal(signal),
      ]);
      const failed = [ventasRes, pagosRes].find((r) => r.error);
      if (failed) {
        return { data: null, error: failed.error, status: (failed as { status?: number }).status };
      }

      // Salvaguarda de truncado: estas dos consultas siguen leyendo filas crudas.
      const datosIncompletos = alcanzoLimiteFilas(ventasRes.data) || alcanzoLimiteFilas(pagosRes.data);

      const ventas = ventasRes.data || [];

      const pagos = (pagosRes.data || []).map((p) => ({
        venta_id: p.venta_id,
        metodo_pago: p.metodo_pago,
        monto: Number(p.monto) || 0,
      }));

      const pagosPorVenta = new Map<string, { metodo_pago: string; monto: number }[]>();
      pagos.forEach((p) => {
        const list = pagosPorVenta.get(p.venta_id) || [];
        list.push(p);
        pagosPorVenta.set(p.venta_id, list);
      });

      const montosActual = emptyMontos();
      const montosAnterior = emptyMontos();

      (ventas || []).forEach((v) => {
        const ventaPagosRows = pagosPorVenta.get(v.id);
        // Mismo fallback que useTransactions.ts: sin filas propias en venta_pagos,
        // toda la venta cuenta como un único pago con el método/monto de `venta`.
        const efectivos = ventaPagosRows && ventaPagosRows.length > 0
          ? ventaPagosRows
          : [{ metodo_pago: v.metodo_pago, monto: Number(v.total_final) || 0 }];

        const mesVenta = format(new Date(v.fecha_hora), 'yyyy-MM');
        const target = mesVenta === currentMonthStr ? montosActual : montosAnterior;
        efectivos.forEach((p) => {
          if (p.metodo_pago in target) {
            (target as unknown as Record<string, number>)[p.metodo_pago] += p.monto;
          }
        });
      });

      return {
        data: { montosMesActual: montosActual, montosMesAnterior: montosAnterior, datosIncompletos },
        error: null,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, currentSucursal, readState.run]);

  useEffect(() => {
    if (organizationId) fetchAll();
  }, [organizationId, fetchAll]);

  const bundle = readState.data ?? EMPTY_BUNDLE;

  return {
    montosMesActual: bundle.montosMesActual,
    montosMesAnterior: bundle.montosMesAnterior,
    datosIncompletos: bundle.datosIncompletos,
    isLoading: readState.phase === 'loading',
    phase: readState.phase as ReadPhase,
    error: readState.error,
    retry: readState.retry,
  };
}
