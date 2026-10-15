import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useOrganization } from '@/contexts/OrganizationContext';
import { useSucursal } from '@/contexts/SucursalContext';
import { useOrganizationToday } from './useOrganizationToday';
import { sostienePertenencia } from '@/lib/tareasAutomaticas';

export interface TareaResponsable { id: string; nombre: string }

/**
 * Sucursales donde un integrante tiene pertenencia estructural vigente (misma regla que la base y que
 * la lista de responsables). Para "Mis tareas" de un supervisor que además trabaja como barbero.
 */
export function useSucursalesDeIntegrante(barberoId: string | null, enabled = true) {
  const { user } = useAuth();
  const { organization } = useOrganization();
  const today = useOrganizationToday();
  return useQuery({
    queryKey: ['tarea_responsables', 'sucursales', organization?.id, user?.id, barberoId, today],
    enabled: enabled && !!organization?.id && !!user?.id && !!barberoId,
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase.from('barberos_sucursales')
        .select('id,sucursal_id,tipo,fecha_inicio,fecha_fin')
        .eq('organization_id', organization!.id).eq('barbero_id', barberoId!).order('id').limit(200).abortSignal(signal);
      if (error) throw error;
      return [...new Set((data ?? []).filter(row => sostienePertenencia(row, today)).map(row => row.sucursal_id))];
    },
  });
}

/** Pertenencia estructural; nunca disponibilidad diaria ni sucursal de origen del integrante. */
export function useTareaResponsables(sucursalId: string | null, enabled = true) {
  const { user } = useAuth();
  const { organization } = useOrganization();
  const { sucursales, isLoading: scopeLoading, error: scopeError } = useSucursal();
  const today = useOrganizationToday();
  const branchIds = sucursales.filter(s => s.organization_id === organization?.id && s.activa && (!sucursalId || s.id === sucursalId)).map(s => s.id).sort();
  return useQuery({
    queryKey: ['tarea_responsables', organization?.id, user?.id, branchIds, today],
    enabled: enabled && !!organization?.id && !!user?.id && !scopeLoading && !scopeError && branchIds.length > 0,
    queryFn: async ({ signal }) => {
      const people = new Map<string, TareaResponsable>();
      let cursor: string | null = null;
      for (;;) {
        let query = supabase.from('barberos_sucursales')
          .select('id,tipo,fecha_inicio,fecha_fin,barberos!inner(id,nombre,apellido,activo,organization_id)')
          .eq('organization_id', organization!.id).eq('barberos.organization_id', organization!.id)
          .eq('barberos.activo', true).in('sucursal_id', branchIds).order('id').limit(500).abortSignal(signal);
        if (cursor) query = query.gt('id', cursor);
        const { data, error } = await query;
        if (error) throw error;
        if (!data?.length) break;
        for (const row of data) {
          if (!sostienePertenencia(row, today)) continue;
          const person = row.barberos;
          people.set(person.id, { id: person.id, nombre: `${person.nombre} ${person.apellido}`.trim() });
        }
        const next = data[data.length - 1].id;
        if (next === cursor) throw new Error('No pudimos completar la carga de responsables.');
        cursor = next;
      }
      return [...people.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es') || a.id.localeCompare(b.id));
    },
  });
}
