import { useInfiniteQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { useOrganization } from '@/contexts/OrganizationContext';
import { useSucursal } from '@/contexts/SucursalContext';
import { fetchHistoryPage, type HistoryCursor } from '@/lib/tareasData';

/** Historial de Tareas completadas, ordenado por fecha de completado; solo se pide al abrirlo. */
export function useTareasHistorial(enabled: boolean, sucursalFilter: string, responsible: string) {
  const { user } = useAuth();
  const { organization } = useOrganization();
  const { currentSucursal, isAllMode, isLoading, error } = useSucursal();
  const sucursalId = currentSucursal?.id ?? (sucursalFilter === 'todas' ? null : sucursalFilter);
  return useInfiniteQuery({
    queryKey: ['tareas', 'historial', organization?.id, user?.id, sucursalId, responsible],
    enabled: enabled && !!organization?.id && !!user?.id && !isLoading && !error && (!!currentSucursal || isAllMode),
    initialPageParam: null as HistoryCursor | null,
    queryFn: ({ pageParam, signal }) => fetchHistoryPage({ organizationId: organization!.id, sucursalId, signal }, pageParam, responsible),
    getNextPageParam: lastPage => lastPage.length ? lastPage[lastPage.length - 1] : undefined,
  });
}
