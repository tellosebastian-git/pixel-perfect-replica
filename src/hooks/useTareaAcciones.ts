import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { supabaseUntyped } from '@/lib/supabaseUntyped';
import { useAuth } from '@/contexts/AuthContext';

export type TareaAccion = 'iniciar' | 'completar' | 'deshacer';
export interface TareaAccionRequest { id: string; version: string; accion: TareaAccion }
interface ActionResult {
  ok: boolean; code?: string; message?: string; version: string; estado: string; actor_nombre: string; undo_until?: string;
  /** Instantes del servidor, nunca del dispositivo. */
  iniciada_at?: string | null; completada_at?: string | null;
}

/** Rechazo de una acción por el servidor: conserva el código (`conflict`, `invalid_state`, `forbidden`…). */
export class TareaAccionError extends Error {
  constructor(message: string, readonly code: string | null) {
    super(message);
    this.name = 'TareaAccionError';
  }
}

export function useTareaAcciones() {
  const { isSucursalAccount } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    retry: false,
    gcTime: 0,
    mutationFn: async ({ id, version, accion, pin }: TareaAccionRequest & { pin?: string }) => {
      if (!version) throw new Error('Actualizá la lista antes de realizar la acción.');
      const response = isSucursalAccount
        ? await supabase.functions.invoke('tareas-action', { body: { tarea_id: id, version, accion, pin } })
        : await supabaseUntyped.rpc('tareas_accion', { p_tarea: id, p_version: version, p_accion: accion });
      if (response.error) throw new Error('No pudimos confirmar la acción. Actualizá la lista antes de reintentar.');
      const result = response.data as unknown as ActionResult;
      if (!result?.ok) throw new TareaAccionError(result?.message || 'No pudimos realizar la acción.', result?.code ?? null);
      return result;
    },
    onSettled: (_data, _error, variables) => {
      // Do not retain a PIN in React Query's mutation cache after the request.
      delete variables.pin;
      void queryClient.invalidateQueries({ queryKey: ['tareas'] });
    },
  });
}
