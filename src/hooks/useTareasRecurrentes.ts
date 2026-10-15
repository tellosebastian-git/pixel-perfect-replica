import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { todayInTimezoneIso } from '@/lib/dateUtils';
import { readAllTaskPages, taskCursorFilter, requireTaskBranch, mensajeTareas } from '@/lib/tareasData';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/contexts/OrganizationContext';
import { useSucursal } from '@/contexts/SucursalContext';
import { useAuth } from '@/contexts/AuthContext';
import type { PausaMotivo } from '@/lib/tareasAutomaticas';
import { feedback } from '@/lib/feedback';

export interface TareaRecurrente {
  id: string;
  organization_id: string;
  sucursal_id: string;
  titulo: string;
  descripcion: string | null;
  assignment_scope: 'individual' | 'team';
  asignado_a: string | null;
  asignado_nombre: string | null;
  hora: string | null;
  repeat_preset: string;
  repeat_frequency: string | null;
  repeat_interval: number | null;
  repeat_byweekday: number[] | null;
  fecha_inicio: string;
  proxima_fecha: string;
  activo: boolean;
  /** `null` = activa. Si está pausada, indica por qué (la pausa automática se reanuda sola; la manual no). */
  pausa_motivo: PausaMotivo | null;
  pausada_at: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export interface TareaRecurrenteInsert {
  titulo: string;
  descripcion?: string | null;
  assignment_scope: 'individual' | 'team';
  asignado_a?: string | null;
  asignado_nombre?: string | null;
  hora?: string | null;
  repeat_preset: string;
  repeat_frequency?: string | null;
  repeat_interval?: number | null;
  repeat_byweekday?: number[] | null;
  fecha_inicio: string;
  sucursal_id?: string | null;
}

export interface TareaRecurrenteUpdate {
  id: string;
  titulo?: string;
  descripcion?: string | null;
  assignment_scope?: 'individual' | 'team';
  asignado_a?: string | null;
  asignado_nombre?: string | null;
  hora?: string | null;
  repeat_preset?: string;
  repeat_frequency?: string | null;
  repeat_interval?: number | null;
  repeat_byweekday?: number[] | null;
  fecha_inicio?: string;
  activo?: boolean;
}

/** `enabled = false` para quien no ve Tareas automáticas: la lista no se pide. */
export function useTareasRecurrentes(enabled = true) {
  const { organization } = useOrganization();
  const { currentSucursal, isAllMode, isLoading: scopeLoading, error: scopeError, refreshSucursales } = useSucursal();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const canRead = enabled && !!organization?.id && !!user?.id && !scopeLoading && !scopeError && (!!currentSucursal || isAllMode);
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['tareas_recurrentes', organization?.id, user?.id, currentSucursal?.id],
    queryFn: ({ signal }) => readAllTaskPages(async cursor => {
      if (!organization?.id) return [];
      let query = supabase
        .from('tareas_recurrentes')
        .select('*')
        .eq('organization_id', organization.id)
        .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(500).abortSignal(signal);
      if (cursor) query = query.or(taskCursorFilter(cursor));

      if (currentSucursal) {
        query = query.eq('sucursal_id', currentSucursal.id);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as TareaRecurrente[];
    }),
    enabled: canRead,
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['tareas_recurrentes'] });
    queryClient.invalidateQueries({ queryKey: ['tareas'] });
  };

  const addReceta = useMutation({
    mutationFn: async (receta: TareaRecurrenteInsert) => {
      if (!organization?.id || !user?.id) throw new Error('Falta organización o usuario');
      const sucursal_id = receta.sucursal_id ?? currentSucursal?.id ?? null;
      if (!sucursal_id) throw new Error('Seleccioná una sucursal para crear la tarea automática.');
      await requireTaskBranch(organization.id, sucursal_id);

      const payload = {
        organization_id: organization.id,
        sucursal_id,
        titulo: receta.titulo,
        descripcion: receta.descripcion ?? null,
        assignment_scope: receta.assignment_scope,
        asignado_a: receta.asignado_a ?? null,
        asignado_nombre: receta.asignado_nombre ?? null,
        hora: receta.hora ?? null,
        repeat_preset: receta.repeat_preset,
        repeat_frequency: receta.repeat_frequency ?? null,
        repeat_interval: receta.repeat_interval ?? null,
        repeat_byweekday: receta.repeat_byweekday ?? null,
        fecha_inicio: receta.fecha_inicio,
        // Marcador: la base calcula la próxima fecha real desde `fecha_inicio` y la zona horaria de la organización.
        proxima_fecha: receta.fecha_inicio,
        activo: true,
        created_by: user.id,
      };

      const { error } = await supabase.from('tareas_recurrentes').insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateAll();
      feedback.success('Tarea automática creada');
    },
  });

  const updateReceta = useMutation({
    mutationFn: async (patch: TareaRecurrenteUpdate) => {
      const { id, ...updates } = patch;

      // La próxima fecha NO se calcula acá: la base la recalcula solo cuando cambia la programación
      // (inicio, repetición, intervalo o días). Editar título, descripción u hora no la mueve.
      const { error } = await supabase
        .from('tareas_recurrentes')
        .update(updates)
        .eq('id', id);
      if (error) throw error;
    },
    // El error lo muestra el formulario, que conserva lo cargado.
    onSuccess: () => {
      invalidateAll();
      feedback.success('Tarea automática actualizada');
    },
  });

  const toggleActivo = useMutation({
    mutationFn: async ({ id, activo }: { id: string; activo: boolean }) => {
      const { error } = await supabase
        .from('tareas_recurrentes')
        .update({ activo })
        .eq('id', id);
      if (error) throw error;
      return activo;
    },
    onSuccess: (activo) => {
      invalidateAll();
      feedback.success(activo ? 'Tarea automática reanudada' : 'Tarea automática pausada');
    },
    onError: (e: Error) => feedback.error(mensajeTareas(e, 'No pudimos cambiar el estado de la Tarea automática. Reintentá.')),
  });

  const deleteReceta = useMutation({
    mutationFn: async (id: string) => {
      // 1) Borrar tareas futuras pendientes asociadas a esta receta.
      if (!organization?.id) throw new Error('Falta organización');
      const today = todayInTimezoneIso(organization.timezone);
      const { error: childrenError } = await supabase
        .from('tareas')
        .delete()
        .eq('recurrencia_id', id)
        .eq('organization_id', organization.id)
        .eq('estado', 'pendiente')
        .gte('fecha_inicio', today);
      if (childrenError) throw childrenError;

      // 2) Borrar la receta.
      const { error } = await supabase
        .from('tareas_recurrentes')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateAll();
      feedback.success('Tarea automática eliminada');
    },
    onError: (e: Error) => feedback.error(mensajeTareas(e, 'No pudimos eliminar la Tarea automática. Reintentá.')),
  });

  return {
    recetas: canRead ? data ?? [] : [],
    hasData: canRead && data !== undefined,
    isLoading: enabled && (scopeLoading || (canRead && isLoading)),
    error: scopeError || error,
    isFetching,
    refetch: () => scopeError ? refreshSucursales() : refetch(),
    addReceta,
    updateReceta,
    toggleActivo,
    deleteReceta,
  };
}
