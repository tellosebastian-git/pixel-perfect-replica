import { useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Sucursal } from '@/contexts/SucursalContext';
import { useReadState, type ReadPhase } from '@/hooks/useReadState';

export interface OcupacionMonthData {
  month: string; // 'yyyy-MM'
  tasaOcupacion: number | null;
  /** Solo se completa para el mes anterior al actual: primeros N días, mismo recorte que "parcial*" de useEstadisticasData. */
  tasaOcupacionParcial: number | null;
  coberturaIncompleta: boolean;
  duracionPromedioMin: number | null;
}

/**
 * Datos para la Tasa de Ocupación de la Sección Resumen. Todo el cálculo (duración ponderada
 * por volumen real de ventas, horas vendidas, horas disponibles del horario general, tasa
 * final) se resuelve en `estadisticas_ocupacion_mensual` — este hook solo llama a la RPC y
 * expone el resultado, sin ninguna aritmética en JS.
 *
 * `tasaOcupacion`/`tasaOcupacionParcial` llegan en `null` (nunca 0 forzado) cuando falta el
 * horario general de la sucursal, no hay barberos activos con rol 'barber', o no hay ventas
 * con servicio matcheado ese mes — el frontend decide qué mostrar según ese `null`, no lo
 * calcula ni lo reinterpreta.
 */
export function useOcupacionResumen(
  organizationId: string | undefined,
  currentSucursal: Sucursal | null,
  periodoMeses: string,
) {
  const contextKey = `${organizationId ?? 'none'}::${currentSucursal?.id ?? 'all'}::${periodoMeses}`;

  const readState = useReadState<OcupacionMonthData[]>({
    contextKey,
    errorMessage: 'No pudimos cargar la ocupación.',
    staleErrorMessage: 'No pudimos actualizar la ocupación.',
    surfaceId: `estadisticas-ocupacion:${organizationId ?? 'none'}`,
  });

  const fetchAll = useCallback(() => {
    readState.run(async (signal) => {
      if (!organizationId) return { data: [], error: null };

      const meses = parseInt(periodoMeses);
      const { data, error, status } = await supabase.rpc('estadisticas_ocupacion_mensual', {
        _organization_id: organizationId,
        _sucursal_id: currentSucursal?.id ?? undefined,
        _meses: meses,
      }).abortSignal(signal);
      if (error) return { data: null, error, status };

      const rows = data || [];
      return {
        data: rows.map((r) => ({
          month: String(r.mes).slice(0, 7),
          tasaOcupacion: r.tasa_ocupacion == null ? null : Number(r.tasa_ocupacion),
          tasaOcupacionParcial: r.tasa_ocupacion_parcial == null ? null : Number(r.tasa_ocupacion_parcial),
          coberturaIncompleta: !!r.cobertura_incompleta,
          duracionPromedioMin: r.duracion_promedio_ponderada == null ? null : Number(r.duracion_promedio_ponderada),
        })),
        error: null,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, currentSucursal, periodoMeses, readState.run]);

  useEffect(() => {
    if (organizationId) fetchAll();
  }, [organizationId, fetchAll]);

  return {
    ocupacionPorMes: readState.data ?? [],
    isLoading: readState.phase === 'loading',
    phase: readState.phase as ReadPhase,
    error: readState.error,
    retry: readState.retry,
  };
}
