import { useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Sucursal } from '@/contexts/SucursalContext';
import { useReadState, type ReadPhase } from '@/hooks/useReadState';

export interface ProximaCuota {
  monto: number;
  fecha: string; // yyyy-MM-dd
}

/**
 * Saldo de deuda pendiente para la mini-card "Deuda pendiente" de Vistazo rápido. Consulta
 * directa desde el frontend (no función SQL): `deudas` es una tabla chica (bajo volumen por
 * organización) y esto es un valor "a hoy", sin serie mensual que agregar — no encaja en
 * v_estadisticas_mensuales ni justifica una función fin_*.
 *
 * Independiente del selector de período del panel, igual que usePagoMetodoData.ts.
 *
 * Nota: RLS de `deudas` solo permite owner/manager (ver migración de la tabla) — un usuario
 * general_manager o sucursal_account con acceso a Estadísticas verá $0/sin deuda aunque exista,
 * sin distinción visual de "sin permiso" vs. "sin deuda real". Limitación heredada de la RLS
 * existente, no introducida acá — no se resuelve en este build (candado: no tocar roles/RLS).
 */
interface DeudaBundle {
  saldoPendiente: number;
  proximaCuota: ProximaCuota | null;
}

const EMPTY_BUNDLE: DeudaBundle = { saldoPendiente: 0, proximaCuota: null };

export function useDeudaPendienteData(
  organizationId: string | undefined,
  currentSucursal: Sucursal | null,
) {
  const contextKey = `${organizationId ?? 'none'}::${currentSucursal?.id ?? 'all'}`;

  const readState = useReadState<DeudaBundle>({
    contextKey,
    errorMessage: 'No pudimos cargar la deuda pendiente.',
    staleErrorMessage: 'No pudimos actualizar la deuda pendiente.',
    surfaceId: `estadisticas-deuda:${organizationId ?? 'none'}`,
  });

  const fetchAll = useCallback(() => {
    readState.run(async (signal) => {
      if (!organizationId) return { data: EMPTY_BUNDLE, error: null };

      let query = supabase
        .from('deudas')
        .select('monto_total, monto_pagado, monto_cuota, fecha_proximo_pago')
        .eq('organization_id', organizationId)
        .eq('estado', 'activa');
      if (currentSucursal) {
        query = query.eq('sucursal_id', currentSucursal.id);
      }

      const { data, error, status } = await query.abortSignal(signal);
      if (error) return { data: null, error, status };

      const rows = data || [];
      const saldoPendiente = rows.reduce(
        (sum, d) => sum + (Number(d.monto_total) || 0) - (Number(d.monto_pagado) || 0),
        0,
      );

      const conProximaCuota = rows.filter(
        (d): d is typeof d & { fecha_proximo_pago: string } =>
          !!d.fecha_proximo_pago && d.monto_cuota != null,
      );
      const proxima = conProximaCuota.reduce<typeof conProximaCuota[number] | null>((min, d) => {
        if (!min || d.fecha_proximo_pago < min.fecha_proximo_pago) return d;
        return min;
      }, null);

      const proximaCuota = proxima ? { monto: Number(proxima.monto_cuota), fecha: proxima.fecha_proximo_pago } : null;

      return { data: { saldoPendiente, proximaCuota }, error: null };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, currentSucursal, readState.run]);

  useEffect(() => {
    if (organizationId) fetchAll();
  }, [organizationId, fetchAll]);

  const bundle = readState.data ?? EMPTY_BUNDLE;

  return {
    saldoPendiente: bundle.saldoPendiente,
    proximaCuota: bundle.proximaCuota,
    isLoading: readState.phase === 'loading',
    phase: readState.phase as ReadPhase,
    error: readState.error,
    retry: readState.retry,
  };
}
