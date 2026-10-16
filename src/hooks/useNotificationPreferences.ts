import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useOrganization } from '@/contexts/OrganizationContext';
import {
  getEventDef,
  isEventVisibleForRole,
  resolveModeForUser,
  type RoleScope,
  type PrefMode,
  type NotificationEventDef,
} from '@/lib/notifications/catalog';

interface PreferenceRow {
  event_type: string;
  enabled: boolean;
  mode: PrefMode | null;
}

/**
 * Hook de preferencias de notificación por usuario.
 *
 * - Toggle simple (enabled boolean) para eventos sin `supportsMode`.
 * - Modo (disabled / always / sucursal_account_only) para eventos con `supportsMode`.
 * - `mode` es la fuente de verdad cuando no es NULL. `enabled` queda en sync.
 */
export function useNotificationPreferences() {
  const { user, isOwner, isGeneralManager, isManager, isBarber, isSucursalAccount } = useAuth();
  const { organization } = useOrganization();
  const queryClient = useQueryClient();

  const scope: RoleScope = useMemo(() => {
    const roles: RoleScope['roles'] = [];
    if (isOwner) roles.push('owner');
    if (isGeneralManager) roles.push('general_manager');
    if (isManager) roles.push('manager');
    if (isBarber) roles.push('barber');
    if (isSucursalAccount) roles.push('sucursal_account');
    return { roles, isSucursalAccount, isBarber };
  }, [isOwner, isGeneralManager, isManager, isBarber, isSucursalAccount]);

  const { data: preferenceRows = [], isSuccess: preferencesReady, isError: preferencesError } = useQuery({
    queryKey: ['notification_preferences', user?.id, organization?.id],
    queryFn: async () => {
      if (!user?.id) return [] as PreferenceRow[];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('user_notification_preferences')
        .select('event_type, enabled, mode')
        .eq('user_id', user.id);
      if (error) throw error;
      return (data ?? []) as PreferenceRow[];
    },
    enabled: !!user?.id && !!organization?.id,
  });

  // Mapas separados para compatibilidad con consumidores existentes.
  const preferences = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const r of preferenceRows) m.set(r.event_type, r.enabled);
    return m;
  }, [preferenceRows]);

  const preferencesFull = useMemo(() => {
    const m = new Map<string, { enabled: boolean | null; mode: PrefMode | null }>();
    for (const r of preferenceRows) m.set(r.event_type, { enabled: r.enabled, mode: r.mode });
    return m;
  }, [preferenceRows]);

  const getMode = (def: NotificationEventDef): PrefMode =>
    resolveModeForUser(def, preferencesFull.get(def.eventType));

  const setPreference = useMutation({
    mutationFn: async ({
      eventType,
      enabled,
      mode,
    }: { eventType: string; enabled?: boolean; mode?: PrefMode }) => {
      if (!user?.id || !organization?.id) throw new Error('Sin sesión');
      const def = getEventDef(eventType);
      if (!def) throw new Error('Evento desconocido');
      if (!def.implemented) throw new Error('Evento no disponible');
      if (!isEventVisibleForRole(def, scope)) throw new Error('Evento no permitido para tu cargo');

      // Resolver fila final manteniendo coherencia mode <-> enabled.
      let finalEnabled: boolean;
      let finalMode: PrefMode | null;
      if (def.supportsMode) {
        const resolved: PrefMode = mode ?? (enabled === false ? 'disabled' : 'always');
        finalMode = resolved;
        finalEnabled = resolved !== 'disabled';
      } else {
        finalMode = null;
        finalEnabled = enabled ?? true;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from('user_notification_preferences')
        .upsert(
          {
            user_id: user.id,
            organization_id: organization.id,
            event_type: eventType,
            enabled: finalEnabled,
            mode: finalMode,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,event_type' },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notification_preferences'] });
      queryClient.invalidateQueries({ queryKey: ['notification_deliveries'] });
    },
  });

  return {
    preferences,
    /** Ya se leyeron las preferencias guardadas (sin esto, un aviso apagado podría aparecer un instante). */
    preferencesReady,
    preferencesError,
    preferencesFull,
    scope,
    getMode,
    setPreference,
  };
}
