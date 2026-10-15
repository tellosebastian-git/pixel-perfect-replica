import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useOrganization } from '@/contexts/OrganizationContext';
import { type Tarea } from '@/hooks/useTareas';
import { useSucursal } from '@/contexts/SucursalContext';
import { getEventDef, resolveNotificationEventType } from '@/lib/notifications/catalog';
import { useNotificationPreferences } from '@/hooks/useNotificationPreferences';

export type NotificationType =
  | 'tarea_pendiente'
  | 'tarea_vencida'
  | 'peticion_vencida';

interface DeliveryRow {
  id: string;                       // notification_deliveries.id
  notification_id: string;
  organization_id: string;
  user_id: string;
  read_at: string | null;
  hidden_at: string | null;
  created_at: string;
  notifications: {
    id: string;
    organization_id: string;
    sucursal_id: string | null;
    event_key: string;
    type: NotificationType | string;
    category: string | null;
    summary: string | null;
    actor_user_id: string | null;
    actor_name: string | null;
    actor_account_type: string | null;
    authorized_by_user_id: string | null;
    authorized_by_name: string | null;
    expires_at: string | null;
    source_module: string;
    source_table: string | null;
    source_id: string | null;
    title: string;
    body: string | null;
    notification_at: string;
    metadata: Record<string, unknown>;
    created_at: string;
    updated_at: string;
  };
}

export interface NotificationItem {
  id: string;                  // notification_deliveries.id (UUID)
  notification_id: string;     // notifications.id
  source_type: NotificationType | string;
  /** eventType canónico del catálogo (resuelto desde legacy si aplica). */
  event_type: string;
  /** Categoría del catálogo (si el evento existe en él). */
  category: string | null;
  source_id: string;           // tarea/peticion id
  titulo: string;
  body: string | null;
  summary: string | null;
  fecha: string;               // notification_at ISO
  read: boolean;
  source_module: string;
  sucursal_id: string | null;
  actor_name: string | null;
  authorized_by_name: string | null;
  metadata: Record<string, unknown>;
  tarea?: Tarea;
}

export function useNotifications() {
  const { user } = useAuth();
  const { organization } = useOrganization();
  const { currentSucursal, isAllMode, isLoading: scopeLoading, error: scopeError } = useSucursal();
  const { preferences } = useNotificationPreferences();
  const queryClient = useQueryClient();

  // Los vencimientos (tarea_vencida / peticion_vencida) se procesan 100%
  // server-side por process_vencimientos_tareas() (cron horario). El frontend
  // ya NO genera ni persiste candidatos: solo lee deliveries.

  // 3. Query principal: deliveries del usuario actual + notificacion embebida
  const { data: deliveries = [] } = useQuery({
    queryKey: ['notification_deliveries', user?.id, organization?.id],
    queryFn: async () => {
      if (!user?.id || !organization?.id) return [] as DeliveryRow[];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('notification_deliveries')
        .select('id, notification_id, organization_id, user_id, read_at, hidden_at, created_at, notifications!inner(*)')
        .eq('user_id', user.id)
        .eq('organization_id', organization.id)
        .is('hidden_at', null)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      // Reorder by notification_at desc client-side (preserves historical order)
      const rows = (data ?? []) as DeliveryRow[];
      rows.sort(
        (a, b) =>
          new Date(b.notifications?.notification_at ?? b.created_at).getTime() -
          new Date(a.notifications?.notification_at ?? a.created_at).getTime(),
      );
      return rows;
    },
    enabled: !!user?.id && !!organization?.id,
  });

  // Solo las fuentes de las últimas 100 entregas, con el mismo scope y RLS que antes.
  const sourceIds = useMemo(() => [...new Set(deliveries.filter(d => d.notifications?.source_module === 'tareas' && d.notifications?.source_table === 'tareas')
    .map(d => d.notifications.source_id).filter((id): id is string => !!id))].sort(), [deliveries]);
  const { data: tareas = [] } = useQuery({
    queryKey: ['tareas', 'notification_sources', organization?.id, user?.id, currentSucursal?.id, sourceIds],
    enabled: !!organization?.id && !!user?.id && !scopeLoading && !scopeError && (!!currentSucursal || isAllMode) && sourceIds.length > 0,
    queryFn: async ({ signal }) => {
      let query = supabase.from('tareas').select('*').eq('organization_id', organization!.id).in('id', sourceIds).abortSignal(signal);
      if (currentSucursal) query = query.eq('sucursal_id', currentSucursal.id);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as Tarea[];
    },
  });

  // 4. Compatibilidad: lecturas legacy (notification_reads) por (source_type, source_id)
  // notification_reads.source_type guarda el mismo string que notifications.type.
  const { data: legacyReads = [] } = useQuery({
    queryKey: ['notification_reads', user?.id, organization?.id],
    queryFn: async () => {
      if (!user?.id || !organization?.id) return [];
      const { data, error } = await supabase
        .from('notification_reads')
        .select('source_type, source_id')
        .eq('user_id', user.id)
        .eq('organization_id', organization.id);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user?.id && !!organization?.id,
  });

  const legacyReadsBySourceKey = useMemo(() => {
    const s = new Set<string>();
    for (const r of legacyReads as Array<{ source_type: string; source_id: string }>) {
      s.add(`${r.source_type}:${r.source_id}`);
    }
    return s;
  }, [legacyReads]);

  // 5. Filtrar fuentes activas (tareas/peticiones aún visibles y vigentes)
  const tareasById = useMemo(() => {
    const m = new Map<string, Tarea>();
    if (!scopeLoading && !scopeError && (currentSucursal || isAllMode)) {
      for (const t of tareas) m.set(t.id, t);
    }
    return m;
  }, [tareas, scopeLoading, scopeError, currentSucursal, isAllMode]);

  const notifications: NotificationItem[] = useMemo(() => {
    const out: NotificationItem[] = [];
    for (const d of deliveries) {
      const n = d.notifications;
      if (!n) continue;

      // Filtro por catálogo + preferencia del usuario.
      // - Evento `implemented = false` → ocultar.
      // - Preferencia desactivada → ocultar.
      // - Tipo desconocido (no en catálogo) → mostrar (compatibilidad).
      const canon = resolveNotificationEventType(n.type) ?? n.type;
      const def = getEventDef(canon);
      if (def) {
        if (!def.implemented) continue;
        const pref = preferences.get(def.eventType);
        const enabled = pref ?? def.defaultEnabled;
        if (!enabled) continue;
      }

      // Filtrado activo de eventos que apuntan a una tarea/petición (source_table = 'tareas').
      // Los avisos de una Tarea automática (source_table = 'tareas_recurrentes') no dependen de una tarea visible.
      if (n.source_module === 'tareas' && n.source_id && n.source_table === 'tareas') {
        const t = tareasById.get(n.source_id);
        if (!t) continue; // no visible para el usuario o eliminada
        if (t.estado === 'completada') continue;
        if (t.tipo === 'peticion' && t.estado !== 'pendiente') continue;
      }
      const read =
        !!d.read_at ||
        (n.source_id && legacyReadsBySourceKey.has(`${n.type}:${n.source_id}`)) ||
        false;

      out.push({
        id: d.id,
        notification_id: n.id,
        source_type: n.type,
        event_type: canon,
        category: def?.category ?? n.category ?? null,
        source_id: n.source_id ?? '',
        titulo: n.title,
        body: n.body ?? null,
        summary: n.summary ?? null,
        fecha: n.notification_at,
        read: !!read,
        source_module: n.source_module,
        sucursal_id: n.sucursal_id ?? null,
        actor_name: n.actor_name ?? null,
        authorized_by_name: n.authorized_by_name ?? null,
        metadata: (n.metadata ?? {}) as Record<string, unknown>,
        tarea: n.source_id ? tareasById.get(n.source_id) : undefined,
      });
    }
    return out;
  }, [deliveries, tareasById, legacyReadsBySourceKey, preferences]);

  const unreadNotifications = useMemo(
    () => notifications.filter(n => !n.read),
    [notifications],
  );
  const readNotifications = useMemo(
    () => notifications.filter(n => n.read),
    [notifications],
  );
  const unreadCount = unreadNotifications.length;

  // 6. Mutations — operan sobre notification_deliveries (id = delivery.id)
  const markAsRead = useMutation({
    mutationFn: async (item: Pick<NotificationItem, 'id' | 'source_type' | 'source_id'>) => {
      if (!user?.id || !organization?.id) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from('notification_deliveries')
        .update({ read_at: new Date().toISOString() })
        .eq('id', item.id)
        .eq('user_id', user.id);
      if (error) throw error;
    },
    onError: (e) => console.warn('[notifications] markAsRead error', e),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notification_deliveries'] });
    },
  });

  const markAsUnread = useMutation({
    mutationFn: async (item: Pick<NotificationItem, 'id' | 'source_type' | 'source_id'>) => {
      if (!user?.id || !organization?.id) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from('notification_deliveries')
        .update({ read_at: null })
        .eq('id', item.id)
        .eq('user_id', user.id);
      if (error) throw error;
      // Compat: también limpiar lectura legacy si existiera
      if (item.source_type && item.source_id) {
        await supabase
          .from('notification_reads')
          .delete()
          .eq('user_id', user.id)
          .eq('organization_id', organization.id)
          .eq('source_type', item.source_type)
          .eq('source_id', item.source_id);
      }
    },
    onError: (e) => console.warn('[notifications] markAsUnread error', e),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notification_deliveries'] });
      queryClient.invalidateQueries({ queryKey: ['notification_reads'] });
    },
  });

  const markAllAsRead = useMutation({
    mutationFn: async () => {
      if (!user?.id || !organization?.id) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from('notification_deliveries')
        .update({ read_at: new Date().toISOString() })
        .eq('user_id', user.id)
        .eq('organization_id', organization.id)
        .is('read_at', null)
        .is('hidden_at', null);
      if (error) throw error;
    },
    onError: (e) => console.warn('[notifications] markAllAsRead error', e),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notification_deliveries'] });
    },
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['notification_deliveries'] });
    queryClient.invalidateQueries({ queryKey: ['notification_reads'] });
    queryClient.invalidateQueries({ queryKey: ['tareas'] });
  };

  return {
    notifications,
    unreadNotifications,
    readNotifications,
    unreadCount,
    markAsRead,
    markAsUnread,
    markAllAsRead,
    refresh,
  };
}
