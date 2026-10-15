import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useOrganization } from '@/contexts/OrganizationContext';
import { useSucursal } from '@/contexts/SucursalContext';
import { fetchWeekResolvedPage, readAllTaskPages, weekRange } from '@/lib/tareasData';
import type { TareaPrevista } from '@/lib/tareasAgenda';

/**
 * Lo que la lista operativa de Tareas no trae (solo carga abiertas): las completadas que importan a esta
 * semana y las ocurrencias futuras de Tareas automáticas (R1), calculadas por la base con su calendario.
 * Mismo prefijo de caché `tareas`: iniciar/completar/deshacer las refresca junto con la lista.
 */
export function useTareasSemana(today: string, options: { necesitaExistencia?: boolean } = {}) {
  const { user } = useAuth();
  const { organization } = useOrganization();
  const { currentSucursal, isAllMode, isLoading: scopeLoading, error: scopeError } = useSucursal();
  const week = weekRange(today);
  const sucursalId = currentSucursal?.id ?? null;
  const canRead = !!organization?.id && !!user?.id && !scopeLoading && !scopeError && (!!currentSucursal || isAllMode);

  const resueltas = useQuery({
    queryKey: ['tareas', 'semana', organization?.id, user?.id, sucursalId, week.lunes],
    enabled: canRead,
    queryFn: ({ signal }) => readAllTaskPages(cursor =>
      fetchWeekResolvedPage({ organizationId: organization!.id, sucursalId, signal }, cursor, week)),
  });

  const previstas = useQuery({
    queryKey: ['tareas', 'previstas', organization?.id, user?.id, sucursalId, today, week.domingo],
    enabled: canRead,
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase
        .rpc('tareas_previstas', { p_desde: today, p_hasta: week.domingo, p_sucursal: sucursalId ?? undefined })
        .abortSignal(signal);
      if (error) throw error;
      return (data ?? []) as TareaPrevista[];
    },
  });

  // Solo cuando no hay nada abierto ni de esta semana: distingue "nunca tuvo tareas" de "todo al día".
  const existeHistorial = useQuery({
    queryKey: ['tareas', 'existe', organization?.id, user?.id, sucursalId],
    enabled: canRead && !!options.necesitaExistencia,
    queryFn: async ({ signal }) => {
      let query = supabase.from('tareas').select('id').eq('organization_id', organization!.id).eq('tipo', 'tarea').limit(1);
      if (sucursalId) query = query.eq('sucursal_id', sucursalId);
      const { data, error } = await query.abortSignal(signal);
      if (error) throw error;
      return (data ?? []).length > 0;
    },
  });

  return { week, resueltas, previstas, existeHistorial };
}
