import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useOrganization } from '@/contexts/OrganizationContext';
import { useSucursal } from '@/contexts/SucursalContext';
import type { EstadoAviso } from '@/lib/avisosGlobales';
import { isEventEnabledForUser } from '@/lib/notifications/catalog';
import { weekRange } from '@/lib/tareasData';
import type { AlcanceTareas, FiltroTareas } from '@/lib/tareasAgenda';
import { avisoPendiente, construirAviso, EVENTO_AVISO_SEMANAL, momentoDelDia } from '@/lib/tareasAvisoSemanal';
import { useOrganizationToday } from '@/hooks/useOrganizationToday';
import { useNotificationPreferences } from './useNotificationPreferences';
import { useTareas } from './useTareas';
import { useTareasSemana } from './useTareasSemana';
import { useTareasAlcance } from './useTareasAlcance';
import { useSucursalesDeIntegrante } from './useTareaResponsables';
import { useAgendaSemanal } from './useAgendaSemanal';

export type EleccionAviso = 'listo' | 'pospuesto';

/**
 * Aviso semanal de Tareas (BUILD 4C): si corresponde mostrarlo al entrar y con qué contenido.
 *
 * - Solo personas (barbero o supervisor), nunca la cuenta de sucursal; respeta la preferencia de Configuración →
 *   Notificaciones y el plan/permiso de Tareas (`disponible`).
 * - Del aviso se guarda solo su estado (Listo / Más tarde) por usuario + organización + semana + momento.
 * - El contenido sale de las mismas lecturas acotadas de Principal → Tareas (abiertas, completadas de la semana,
 *   Programadas R1) y de la misma agenda: nada de historial ni copias de tareas. Solo se lee si el aviso está pendiente.
 * - Cualquier error lo apaga en silencio: nunca se convierte en "todo al día" ni bloquea la app.
 */
export function useAvisoSemanalTareas({ disponible }: { disponible: boolean | null }) {
  const { user, profile, isOwner, isGeneralManager, isManager, isBarber, isSucursalAccount } = useAuth();
  const { organization } = useOrganization();
  const { currentSucursal } = useSucursal();
  const today = useOrganizationToday();
  const queryClient = useQueryClient();
  const { preferences, preferencesReady, preferencesError } = useNotificationPreferences();

  const userId = user?.id;
  const orgId = organization?.id;
  const supervisor = isOwner || isGeneralManager || isManager;
  // La cuenta de sucursal es un dispositivo compartido y no representa a una persona: no recibe el aviso.
  const persona = !isSucursalAccount && (supervisor || isBarber);
  const momento = momentoDelDia(today);
  const semana = weekRange(today).lunes;
  const activado = isEventEnabledForUser(EVENTO_AVISO_SEMANAL, preferences);
  const elegible = !!userId && !!orgId && persona && disponible === true;
  const claveEstado = ['tareas_aviso_semanal', orgId, userId, semana, momento] as const;

  const guardado = useQuery({
    queryKey: claveEstado,
    enabled: elegible && preferencesReady && activado,
    staleTime: 60_000,
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase.from('tareas_aviso_semanal').select('estado, pospuesto_hasta')
        .eq('user_id', userId!).eq('organization_id', orgId!).eq('semana', semana).eq('momento', momento)
        .abortSignal(signal).maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
  });
  const pendiente = guardado.isSuccess && avisoPendiente(guardado.data);

  // Mismo alcance que Principal → Tareas: "Mis tareas" solo para un supervisor que además trabaja como integrante;
  // si la última elección ya no es válida, Negocio. El barbero ve lo suyo (RLS de 4A).
  const leer = elegible && preferencesReady && activado && pendiente;
  const miBarberoId = profile?.barbero_id ?? null;
  const [alcanceElegido] = useTareasAlcance(userId, orgId);
  const alcance: AlcanceTareas = supervisor && !!miBarberoId ? alcanceElegido : 'negocio';
  const personal = alcance === 'mias' || (isBarber && !supervisor);
  const misSucursales = useSucursalesDeIntegrante(miBarberoId, leer && alcance === 'mias');
  const operativas = useTareas({ enabled: leer });
  const semanaQuery = useTareasSemana(today, { enabled: leer });

  const filtro: FiltroTareas = { alcance, miBarberoId, misSucursales: misSucursales.data ?? [], responsable: 'todos', sucursal: 'todas' };
  const ctx = { today, week: semanaQuery.week, diasVencimiento: organization?.tareas_vencimiento_dias_default ?? 1 };
  const agenda = useAgendaSemanal({
    tareas: operativas.tareas, tareasActualizadas: operativas.dataUpdatedAt,
    resueltasServidor: semanaQuery.resueltas.data, resueltasActualizadas: semanaQuery.resueltas.dataUpdatedAt,
    previstasServidor: semanaQuery.previstas.data, filtro, ctx, timezone: organization?.timezone,
  });
  const { reiniciar } = agenda;
  useEffect(() => { reiniciar(); }, [orgId, userId, currentSucursal?.id, reiniciar]);

  const contenido = construirAviso(momento, agenda.agenda, agenda.progreso, agenda.resueltasSemana.length, semanaQuery.week);
  const datosListos = operativas.hasData && semanaQuery.resueltas.isSuccess && semanaQuery.previstas.isSuccess
    && (alcance !== 'mias' || misSucursales.isSuccess);
  const fallo = !!operativas.error || semanaQuery.resueltas.isError || semanaQuery.previstas.isError || misSucursales.isError;

  let estado: EstadoAviso;
  if (disponible === null) estado = 'pendiente';
  else if (!elegible || preferencesError) estado = 'no';
  else if (!preferencesReady) estado = 'pendiente';
  else if (!activado || guardado.isError) estado = 'no';
  else if (!guardado.isSuccess) estado = 'pendiente';
  else if (!pendiente || (fallo && !datosListos)) estado = 'no';
  else if (!datosListos) estado = 'pendiente';
  else estado = contenido.relevante ? 'listo' : 'no';

  /** Solo el estado del aviso: el plazo de "Más tarde" lo fija el servidor (≈ 3 h). */
  const guardar = useMutation({
    mutationFn: async (eleccion: EleccionAviso) => {
      if (!userId || !orgId) throw new Error('Sin sesión');
      const { data, error } = await supabase.from('tareas_aviso_semanal')
        .upsert({ user_id: userId, organization_id: orgId, semana, momento, estado: eleccion }, { onConflict: 'user_id,organization_id,semana,momento' })
        .select('estado, pospuesto_hasta').single();
      if (error) throw error;
      return data;
    },
    onSuccess: data => queryClient.setQueryData(claveEstado, data),
  });

  return {
    estado, momento, contenido, personal,
    progreso: agenda.progreso, week: semanaQuery.week, today,
    marcarCompletada: agenda.marcarCompletada, desmarcarCompletada: agenda.desmarcarCompletada,
    operador: { supervisor, cuentaSucursal: isSucursalAccount, barbero: isBarber, miBarberoId },
    guardar: guardar.mutateAsync,
  };
}
