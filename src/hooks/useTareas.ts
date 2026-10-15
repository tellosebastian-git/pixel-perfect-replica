import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/contexts/OrganizationContext';
import { useSucursal } from '@/contexts/SucursalContext';
import { useAuth } from '@/contexts/AuthContext';
import { feedback } from '@/lib/feedback';
import { fetchTaskPage, readAllTaskPages, requireTaskBranch } from '@/lib/tareasData';

export interface Tarea {
  id: string;
  organization_id: string;
  tipo: 'tarea' | 'peticion';
  titulo: string;
  descripcion: string | null;
  estado: string;
  asignado_a_id: string | null;
  asignado_a_nombre: string | null;
  creado_por_id: string;
  creado_por_nombre: string | null;
  assignment_scope: 'individual' | 'team';
  sucursal_id: string | null;
  recurrente: boolean;

  fecha_inicio: string | null;
  fecha_limite: string | null;
  hora: string | null;
  repeat_preset: string | null;
  repeat_frequency: string | null;
  repeat_interval: number | null;
  repeat_byweekday: number[] | null;
  vencimiento_dias: number | null;
  completada_por_id: string | null;
  completada_por_nombre: string | null;
  completada_at: string | null;
  iniciada_por_id?: string | null;
  iniciada_por_nombre?: string | null;
  iniciada_at?: string | null;
  accion_version?: string;
  /** Si viene de una Tarea automática, su id. La programación vive en la Tarea automática, no en esta tarea. */
  recurrencia_id: string | null;
  /** Cuándo pasó su fecha límite (una tarea `en_progreso` también puede quedar vencida). */
  vencida_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TareaInsert {
  tipo: 'tarea' | 'peticion';
  titulo: string;
  descripcion?: string;
  asignado_a_id?: string | null;
  asignado_a_nombre?: string;
  assignment_scope?: 'individual' | 'team';
  sucursal_id?: string | null;
  creado_por_nombre?: string;
  fecha_inicio?: string;
  fecha_limite?: string;
  hora?: string;
  repeat_preset?: string;
  repeat_frequency?: string;
  repeat_interval?: number;
  repeat_byweekday?: number[];
  recurrente?: boolean;
  vencimiento_dias?: number;
}

export function useTareas() {
  const { organization } = useOrganization();
  const { currentSucursal, sucursales, isAllMode, isLoading: scopeLoading, error: scopeError, refreshSucursales } = useSucursal();
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();

  const canRead = !!organization?.id && !!user?.id && !scopeLoading && !scopeError && (!!currentSucursal || isAllMode);
  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ['tareas', 'operativas', organization?.id, user?.id, currentSucursal?.id],
    queryFn: ({ signal }) => readAllTaskPages(cursor => fetchTaskPage({ organizationId: organization!.id, sucursalId: currentSucursal?.id ?? null, signal }, cursor)),
    enabled: canRead,
  });

  const addTarea = useMutation({
    mutationFn: async (tarea: TareaInsert) => {
      if (!organization?.id || !user?.id) throw new Error('No org or user');
      const { creado_por_nombre, ...rest } = tarea;
      // Resolver scope para tareas internas
      let assignment_scope: 'individual' | 'team' = rest.assignment_scope ?? 'individual';
      let asignado_a_id = rest.asignado_a_id ?? null;
      let asignado_a_nombre = rest.asignado_a_nombre;
      let sucursal_id = rest.sucursal_id ?? currentSucursal?.id ?? null;

      if (tarea.tipo === 'tarea') {
        if (!sucursales.some(s => s.id === sucursal_id && s.organization_id === organization.id && s.activa)) {
          throw new Error('Seleccioná una sucursal válida para crear la tarea.');
        }
        if (currentSucursal && sucursal_id !== currentSucursal.id) throw new Error('La sucursal cambió. Volvé a abrir el formulario.');
        sucursal_id = await requireTaskBranch(organization.id, sucursal_id);
        if (!asignado_a_id) {
          assignment_scope = 'team';
          asignado_a_nombre = 'Todo el equipo';
          asignado_a_id = null;
          sucursal_id = currentSucursal?.id ?? sucursal_id;
        } else {
          assignment_scope = 'individual';
        }
      }

      const isRecurrente = !!tarea.repeat_preset && tarea.repeat_preset !== 'never';

      // Una tarea con repetición es una Tarea automática: se crea SOLO la Tarea automática. La base calcula
      // la próxima fecha (calendario y zona horaria de la organización) y genera la tarea de hoy si corresponde.
      if (isRecurrente && tarea.tipo === 'tarea') {
        if (!sucursal_id) throw new Error('Seleccioná una sucursal para crear la tarea automática.');
        const fechaInicio = rest.fecha_inicio && rest.fecha_inicio.length > 0 ? rest.fecha_inicio : null;
        if (!fechaInicio) throw new Error('Elegí la fecha de inicio de la tarea automática.');

        const { error: recetaErr } = await supabase
          .from('tareas_recurrentes')
          .insert({
            organization_id: organization.id,
            sucursal_id,
            titulo: rest.titulo,
            descripcion: rest.descripcion ?? null,
            assignment_scope,
            asignado_a: asignado_a_id,
            asignado_nombre: asignado_a_nombre ?? null,
            hora: rest.hora ?? null,
            repeat_preset: tarea.repeat_preset!,
            repeat_frequency: rest.repeat_frequency ?? null,
            repeat_interval: rest.repeat_interval ?? null,
            repeat_byweekday: rest.repeat_byweekday ?? null,
            fecha_inicio: fechaInicio,
            // Marcador: el servidor lo reemplaza por la próxima fecha real de la serie.
            proxima_fecha: fechaInicio,
            activo: true,
            created_by: user.id,
          });
        if (recetaErr) throw recetaErr;
        return { automatica: true, tipo: tarea.tipo };
      }

      const { error } = await supabase.from('tareas').insert({
        ...rest,
        organization_id: organization.id,
        sucursal_id,
        asignado_a_id,
        asignado_a_nombre,
        assignment_scope,
        creado_por_id: user.id,
        creado_por_nombre: creado_por_nombre || profile?.full_name || profile?.email || '',
        // Una tarea común no repite: la repetición solo existe en las Tareas automáticas.
        recurrente: false,
      });
      if (error) throw error;
      return { automatica: false, tipo: tarea.tipo };
    },
    // El error lo muestra el formulario, que conserva lo cargado; acá solo se confirma el éxito.
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['tareas'] });
      queryClient.invalidateQueries({ queryKey: ['tareas_recurrentes'] });
      feedback.success(result.automatica ? 'Tarea automática creada' : result.tipo === 'peticion' ? 'Petición creada' : 'Tarea creada');
    },
  });

  type TareaUpdate = {
    id: string;
    estado?: string;
    titulo?: string;
    descripcion?: string | null;
    asignado_a_id?: string | null;
    asignado_a_nombre?: string | null;
    assignment_scope?: 'individual' | 'team';
    fecha_inicio?: string | null;
    fecha_limite?: string | null;
    hora?: string | null;
  };

  const updateTarea = useMutation({
    mutationFn: async ({ id, ...updates }: TareaUpdate) => {
      const payload: Record<string, unknown> = { ...updates };
      if (updates.estado === 'completada') {
        payload.completada_at = new Date().toISOString();
        payload.completada_por_id = user?.id ?? null;
        payload.completada_por_nombre = profile?.full_name || profile?.email || null;
      }
      if (!organization?.id) throw new Error('No hay organización activa.');
      let query = supabase.from('tareas').update(payload).eq('organization_id', organization.id).eq('id', id);
      // Internal task transitions are server actions; keep the existing petition workflow separate.
      if (updates.estado !== undefined) query = query.eq('tipo', 'peticion');
      const { error } = await query.select('id').single();
      if (error) throw error;
    },
    // Éxito y error los comunica quien llama: el texto depende de si es una tarea o una petición.
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tareas'] });
    },
  });

  const deleteTarea = useMutation({
    mutationFn: async (id: string) => {
      if (!organization?.id) throw new Error('No hay organización activa.');
      const { error } = await supabase.from('tareas').delete().eq('organization_id', organization.id).eq('id', id).select('id').single();
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tareas'] });
    },
  });

  return { tareas: canRead ? data ?? [] : [], hasData: canRead && data !== undefined, isLoading: isLoading || scopeLoading,
    error: scopeError || error, isFetching, dataUpdatedAt,
    refetch: () => scopeError ? refreshSucursales() : refetch(), addTarea, updateTarea, deleteTarea };
}
