import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useOrganization } from '@/contexts/OrganizationContext';
import { useSucursal } from '@/contexts/SucursalContext';
import { TareaActionPinDialog } from '@/components/tareas/TareaActionPinDialog';
import { feedback } from '@/lib/feedback';
import { mensajeTareas } from '@/lib/tareasData';
import type { Tarea } from './useTareas';
import { TareaAccionError, useTareaAcciones, type TareaAccionRequest } from './useTareaAcciones';

const ERROR_ACCION = 'No pudimos realizar la acción. Actualizá la lista y reintentá.';
type PinPendiente = TareaAccionRequest & { tarea?: Tarea };

export interface AccionesTareaOpciones {
  /** Tras confirmar el servidor: la fila puede mostrarse resuelta en el momento. */
  onCompletada?: (original: Tarea, completada: Tarea) => void;
  onDeshecha?: (id: string) => void;
}

/**
 * Iniciar / completar / deshacer (acciones de servidor de 4A) con su feedback, el PIN de la cuenta de sucursal y la
 * respuesta segura cuando otra persona ya completó la tarea. Una sola lógica para Principal → Tareas y el aviso
 * semanal: el servidor decide permisos, versión y plazo de deshacer; acá solo se presenta el resultado.
 */
export function useAccionesTarea(opciones: AccionesTareaOpciones = {}) {
  const { isSucursalAccount, profile } = useAuth();
  const { organization } = useOrganization();
  const { currentSucursal } = useSucursal();
  const acciones = useTareaAcciones();
  const [pinAction, setPinAction] = useState<PinPendiente | null>(null);
  const opcionesRef = useRef(opciones);
  opcionesRef.current = opciones;
  const organizacionRef = useRef(organization?.id);
  organizacionRef.current = organization?.id;

  // Cambiar de organización, sucursal o persona descarta un PIN pedido para el contexto anterior.
  useEffect(() => { setPinAction(null); }, [organization?.id, currentSucursal?.id, profile?.id]);

  const enCurso = (id: string): 'iniciar' | 'completar' | null => (acciones.isPending && acciones.variables?.id === id
    ? (acciones.variables.accion === 'iniciar' ? 'iniciar' : 'completar') : null);

  /** Otra persona ya la completó: se informa quién (dato del servidor) y nada se sobrescribe. */
  const informar = async (error: unknown, request: TareaAccionRequest) => {
    const orgId = organizacionRef.current;
    if (request.accion === 'completar' && error instanceof TareaAccionError
      && (error.code === 'conflict' || error.code === 'invalid_state') && orgId) {
      const { data } = await supabase.from('tareas').select('estado, completada_por_nombre')
        .eq('organization_id', orgId).eq('id', request.id).maybeSingle();
      if (data?.estado === 'completada') {
        feedback.info(data.completada_por_nombre ? `Ya la completó ${data.completada_por_nombre}.` : 'Esta tarea ya estaba completada.');
        return;
      }
    }
    // Los rechazos del servidor ya son mensajes humanos; un error técnico nunca se muestra crudo.
    feedback.error(error instanceof TareaAccionError ? error.message : mensajeTareas(error, ERROR_ACCION));
  };

  const ejecutar = async (request: TareaAccionRequest, tarea?: Tarea, pin?: string) => {
    const result = await acciones.mutateAsync({ ...request, pin });
    setPinAction(null);
    if (request.accion === 'completar' && tarea) {
      const completada: Tarea = {
        ...tarea, estado: 'completada', accion_version: result.version,
        completada_at: result.completada_at ?? new Date().toISOString(), completada_por_nombre: result.actor_nombre,
      };
      opcionesRef.current.onCompletada?.(tarea, completada);
      // El plazo lo controla el servidor; el aviso dura lo mismo que la ventana que permite.
      feedback.success('Tarea completada', {
        id: `tarea-completada-${tarea.id}`, duration: 30_000,
        action: { label: 'Deshacer', onClick: () => solicitar({ id: tarea.id, version: result.version, accion: 'deshacer' }, tarea) },
      });
    } else if (request.accion === 'deshacer') {
      opcionesRef.current.onDeshecha?.(request.id);
      feedback.success('Listo: la tarea volvió a quedar abierta');
    }
  };

  function solicitar(request: TareaAccionRequest, tarea?: Tarea) {
    if (acciones.isPending) return;
    if (isSucursalAccount) setPinAction({ ...request, tarea });
    else void ejecutar(request, tarea).catch(e => informar(e, request));
  }

  const pinDialog = pinAction ? (
    <TareaActionPinDialog key={`${pinAction.id}:${pinAction.accion}`} pending={acciones.isPending}
      onClose={() => setPinAction(null)} onSubmit={pin => ejecutar(pinAction, pinAction.tarea, pin)} />
  ) : null;

  return { solicitar, enCurso, pendiente: acciones.isPending, pinDialog };
}
