import { useMemo, useState } from 'react';
import { Bell, ClipboardList, AlertTriangle, Inbox, CheckCheck, Check, Undo2, ChevronDown, Filter, Calendar, CalendarX, CalendarClock, MessageSquare, Wallet, Receipt, Banknote, ShieldAlert, KeyRound, Eye, LogIn, Lock, FileEdit, Settings2 } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleTrigger } from '@/components/ui/collapsible';

import { cn } from '@/lib/utils';
import { useNotifications, type NotificationItem } from '@/hooks/useNotifications';
import { useNotificationPreferences } from '@/hooks/useNotificationPreferences';
import { useAuth } from '@/contexts/AuthContext';
import { useSucursal } from '@/contexts/SucursalContext';
import { useIsMobile } from '@/hooks/use-mobile';
import { format, parseISO, subDays, startOfDay } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  CATEGORY_LABELS,
  getCatalogForRole,
  getEventDef,
  type EventCategory,
} from '@/lib/notifications/catalog';

interface NotificationsBellProps {
  collapsed?: boolean;
  onNavigate?: () => void;
}

const TYPE_META: Record<string, { label: string; icon: typeof ClipboardList; tone: string }> = {
  tarea_pendiente: { label: 'Tarea pendiente', icon: ClipboardList, tone: 'text-status-info-foreground' },
  tarea_asignada: { label: 'Tarea asignada', icon: ClipboardList, tone: 'text-status-info-foreground' },
  tarea_equipo_asignada: { label: 'Tarea de equipo', icon: ClipboardList, tone: 'text-status-info-foreground' },
  tarea_vencida: { label: 'Tarea vencida', icon: AlertTriangle, tone: 'text-status-warning-foreground' },
  peticion_nueva: { label: 'Petición nueva', icon: MessageSquare, tone: 'text-status-info-foreground' },
  peticion_aprobada: { label: 'Petición aprobada', icon: MessageSquare, tone: 'text-status-success-foreground' },
  peticion_rechazada: { label: 'Petición rechazada', icon: MessageSquare, tone: 'text-status-warning-foreground' },
  peticion_vencida: { label: 'Petición vencida', icon: AlertTriangle, tone: 'text-status-warning-foreground' },
  turno_creado: { label: 'Turno creado', icon: Calendar, tone: 'text-status-info-foreground' },
  turno_creado_propio: { label: 'Mi nuevo turno', icon: Calendar, tone: 'text-status-info-foreground' },
  turno_creado_companero: { label: 'Turno de un compañero', icon: Calendar, tone: 'text-muted-foreground' },
  turno_reprogramado: { label: 'Turno reprogramado', icon: CalendarClock, tone: 'text-status-info-foreground' },
  turno_reprogramado_propio: { label: 'Mi turno reprogramado', icon: CalendarClock, tone: 'text-status-info-foreground' },
  turno_reprogramado_companero: { label: 'Compañero reprogramado', icon: CalendarClock, tone: 'text-muted-foreground' },
  turno_cancelado: { label: 'Turno cancelado', icon: CalendarX, tone: 'text-status-warning-foreground' },
  turno_cancelado_propio: { label: 'Mi turno cancelado', icon: CalendarX, tone: 'text-status-warning-foreground' },
  turno_cancelado_companero: { label: 'Compañero cancelado', icon: CalendarX, tone: 'text-muted-foreground' },
  // Fase 4 — caja
  cierre_caja_realizado: { label: 'Cierre de caja', icon: Wallet, tone: 'text-status-info-foreground' },
  cierre_caja_dia_anterior_realizado: { label: 'Cierre día anterior', icon: Wallet, tone: 'text-status-warning-foreground' },
  transaccion_anulada: { label: 'Transacción anulada', icon: Undo2, tone: 'text-status-warning-foreground' },
  anulacion_cierre: { label: 'Anulación de cierre', icon: Undo2, tone: 'text-status-warning-foreground' },
  // Fase 4 — finanzas
  visualizacion_gastos: { label: 'Visualización de gastos', icon: Eye, tone: 'text-muted-foreground' },
  gasto_registrado: { label: 'Gasto registrado', icon: Receipt, tone: 'text-status-info-foreground' },
  gasto_editado: { label: 'Gasto editado', icon: FileEdit, tone: 'text-status-info-foreground' },
  gasto_anulado: { label: 'Gasto anulado', icon: Undo2, tone: 'text-status-warning-foreground' },
  inversion_creada: { label: 'Inversión registrada', icon: Banknote, tone: 'text-status-info-foreground' },
  deuda_creada: { label: 'Deuda registrada', icon: Banknote, tone: 'text-status-warning-foreground' },
  // Fase 4 — sueldos
  visualizacion_sueldos: { label: 'Visualización de sueldos', icon: Eye, tone: 'text-muted-foreground' },
  pago_sueldo_registrado: { label: 'Pago de sueldo', icon: Banknote, tone: 'text-status-info-foreground' },
  // Fase 4 — seguridad
  cambio_permisos: { label: 'Cambio de acceso', icon: ShieldAlert, tone: 'text-status-info-foreground' },
  cambio_roles: { label: 'Cambio de cargo', icon: ShieldAlert, tone: 'text-status-info-foreground' },
  cambio_configuracion_critica: { label: 'Configuración crítica', icon: Settings2, tone: 'text-status-info-foreground' },
  accion_bloqueada_permisos: { label: 'Acción bloqueada', icon: Lock, tone: 'text-status-warning-foreground' },
  inicio_sesion_cuenta_sucursal: { label: 'Inicio de sesión', icon: LogIn, tone: 'text-muted-foreground' },
  accion_autorizada_pin: { label: 'Acción autorizada con PIN', icon: KeyRound, tone: 'text-status-info-foreground' },


};

const TURNO_TYPES = new Set([
  'turno_creado', 'turno_creado_propio', 'turno_creado_companero',
  'turno_reprogramado', 'turno_reprogramado_propio', 'turno_reprogramado_companero',
  'turno_cancelado', 'turno_cancelado_propio', 'turno_cancelado_companero',
]);

function turnoSummary(n: NotificationItem): string | null {
  if (!TURNO_TYPES.has(n.event_type)) return null;
  const m = (n.metadata ?? {}) as Record<string, unknown>;
  const hora = typeof m.hora_inicio === 'string' ? String(m.hora_inicio).slice(0, 5) : null;
  const barbero = typeof m.barbero_nombre === 'string' ? (m.barbero_nombre as string).trim() : null;
  const servicio = typeof m.servicio_nombre === 'string' ? (m.servicio_nombre as string) : null;
  return [hora, barbero, servicio].filter(Boolean).join(' · ') || null;
}

function turnoCliente(n: NotificationItem): string | null {
  if (!TURNO_TYPES.has(n.event_type)) return null;
  const m = (n.metadata ?? {}) as Record<string, unknown>;
  return typeof m.cliente_nombre === 'string' ? (m.cliente_nombre as string) : null;
}

type DateRange = 'all' | 'today' | '7d' | '30d';

function hasMeaningfulMetadata(n: NotificationItem): boolean {
  if (n.body) return true;
  if (n.summary) return true;
  if (n.actor_name || n.authorized_by_name) return true;
  if (turnoSummary(n) || turnoCliente(n)) return true;
  if (n.metadata && typeof n.metadata === 'object' && Object.keys(n.metadata).length > 0) return true;
  return false;
}

export function NotificationsBell({ collapsed, onNavigate }: NotificationsBellProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'unread' | 'read'>('unread');
  const isMobile = useIsMobile();
  const { isOwner, isGeneralManager } = useAuth();
  const { sucursales } = useSucursal();
  const { scope } = useNotificationPreferences();
  const {
    unreadNotifications,
    readNotifications,
    unreadCount,
    markAsRead,
    markAsUnread,
    markAllAsRead,
    refresh,
  } = useNotifications();

  // Filtros (client-side)
  const [filterSucursal, setFilterSucursal] = useState<string>('all');
  const [filterCategory, setFilterCategory] = useState<EventCategory | 'all'>('all');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterDate, setFilterDate] = useState<DateRange>('all');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const showSucursalFilter = isOwner || isGeneralManager;

  // Tipos disponibles según catálogo permitido por rol.
  const allowedTypes = useMemo(() => getCatalogForRole(scope), [scope]);
  const allowedCategories = useMemo(() => {
    const set = new Set<EventCategory>();
    for (const e of allowedTypes) set.add(e.category);
    return Array.from(set);
  }, [allowedTypes]);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setTab('unread');
      refresh();
    }
  };

  const handleClickItem = (n: NotificationItem) => {
    if (!n.read) {
      markAsRead.mutate({ id: n.id, source_type: n.source_type, source_id: n.source_id });
    }
    setOpen(false);
    onNavigate?.();
  };

  const applyFilters = (items: NotificationItem[]): NotificationItem[] => {
    const today = startOfDay(new Date());
    const cutoff =
      filterDate === 'today' ? today
      : filterDate === '7d' ? subDays(today, 7)
      : filterDate === '30d' ? subDays(today, 30)
      : null;
    return items.filter(n => {
      if (showSucursalFilter && filterSucursal !== 'all' && n.sucursal_id !== filterSucursal) return false;
      if (filterCategory !== 'all' && n.category !== filterCategory) return false;
      if (filterType !== 'all' && n.event_type !== filterType) return false;
      if (cutoff && n.fecha) {
        const f = parseISO(n.fecha);
        if (f.getTime() < cutoff.getTime()) return false;
      }
      return true;
    });
  };

  const filteredUnread = useMemo(() => applyFilters(unreadNotifications),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [unreadNotifications, filterSucursal, filterCategory, filterType, filterDate]);
  const filteredRead = useMemo(() => applyFilters(readNotifications),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [readNotifications, filterSucursal, filterCategory, filterType, filterDate]);

  const filtersActive =
    filterSucursal !== 'all' || filterCategory !== 'all' || filterType !== 'all' || filterDate !== 'all';

  const badgeLabel = unreadCount > 99 ? '99+' : String(unreadCount);
  const badge = unreadCount > 0 && (
    <span
      className={cn(
        'absolute -top-1 -right-1 min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full',
        'bg-destructive text-destructive-foreground text-[10px] font-semibold leading-none',
      )}
    >
      {badgeLabel}
    </span>
  );

  const sucursalName = (id: string | null): string | null => {
    if (!id) return null;
    return sucursales.find(s => s.id === id)?.nombre ?? null;
  };

  const renderDetails = (n: NotificationItem) => {
    const items: Array<{ k: string; v: string }> = [];
    const sName = sucursalName(n.sucursal_id);
    const tCliente = turnoCliente(n);
    const tSummary = turnoSummary(n);
    if (tCliente) items.push({ k: 'Cliente', v: tCliente });
    if (tSummary && !TURNO_TYPES.has(n.event_type)) items.push({ k: 'Detalle', v: tSummary });
    if (sName) items.push({ k: 'Sucursal', v: sName });
    const m = (n.metadata ?? {}) as Record<string, unknown>;
    const accountType = typeof m.actor_account_type === 'string' ? m.actor_account_type : null;
    if (accountType === 'sucursal_account') {
      items.push({ k: 'Desde', v: 'Cuenta de sucursal' });
    } else if (accountType === 'personal_account') {
      items.push({ k: 'Desde', v: 'Cuenta personal' });
    }
    if (n.actor_name) items.push({ k: 'Acción de', v: n.actor_name });
    if (n.authorized_by_name) items.push({ k: 'Autorizado por', v: n.authorized_by_name });
    if (typeof m.monto === 'number') {
      items.push({ k: 'Monto', v: new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(m.monto) });
    }
    if (typeof m.action_key === 'string' && !items.some(i => i.k === 'Acción')) {
      items.push({ k: 'Acción', v: m.action_key });
    }
    return (
      <div className="mt-2 space-y-1.5 rounded-md bg-muted/40 p-2">
        {n.body && <p className="text-xs text-foreground whitespace-pre-wrap">{n.body}</p>}
        {n.summary && !n.body && <p className="text-xs text-muted-foreground">{n.summary}</p>}
        {items.length > 0 && (
          <dl className="text-xs grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
            {items.map(it => (
              <div key={it.k} className="contents">
                <dt className="text-muted-foreground">{it.k}:</dt>
                <dd className="text-foreground">{it.v}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    );
  };

  const renderList = (items: NotificationItem[], variant: 'unread' | 'read') => {
    if (items.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center gap-2 py-8 text-muted-foreground">
          <Inbox className="h-6 w-6" />
          <p className="text-xs">
            {variant === 'unread'
              ? filtersActive ? 'No hay notificaciones que coincidan con los filtros' : 'No tenés notificaciones nuevas'
              : filtersActive ? 'No hay notificaciones que coincidan con los filtros' : 'No tenés notificaciones leídas'}
          </p>
        </div>
      );
    }
    return (
      <div className="flex-1 overflow-y-auto">
        <ul className="divide-y divide-border">
          {items.map(n => {
            const meta = TYPE_META[n.source_type] ?? TYPE_META.tarea_pendiente;
            const Icon = meta.icon;
            const fechaTxt = n.fecha ? format(parseISO(n.fecha), 'dd MMM', { locale: es }) : null;
            const isRead = variant === 'read';
            const def = getEventDef(n.event_type);
            const expandable = (def?.requiresDetails ?? false) || hasMeaningfulMetadata(n);
            const isExpanded = !!expanded[n.id];
            return (
              <li key={n.id}>
                <div
                  className={cn(
                    'group w-full px-3 py-2.5 flex gap-2.5 hover:bg-accent transition-colors',
                    isRead && 'opacity-70',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => handleClickItem(n)}
                    className="flex-1 min-w-0 flex gap-2.5 text-left"
                  >
                    <span className={cn('mt-0.5 shrink-0', isRead ? 'text-muted-foreground' : meta.tone)}>
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                          {def?.label ?? meta.label}
                        </span>
                        {!isRead && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
                      </div>
                      <p className={cn('text-sm truncate', isRead ? 'text-muted-foreground' : 'text-foreground')}>
                        {n.titulo}
                      </p>
                      {(() => {
                        const tSum = turnoSummary(n);
                        if (tSum) return <p className="text-xs text-muted-foreground truncate">{tSum}</p>;
                        return null;
                      })()}
                      {fechaTxt && <p className="text-xs text-muted-foreground">{fechaTxt}</p>}
                    </div>
                  </button>
                  <div className="flex items-start gap-0.5 shrink-0 mt-0.5">
                    {expandable && (
                      <Collapsible
                        open={isExpanded}
                        onOpenChange={(v) => setExpanded(prev => ({ ...prev, [n.id]: v }))}
                      >
                        <CollapsibleTrigger asChild>
                          <button
                            type="button"
                            title={isExpanded ? 'Ocultar detalle' : 'Ver detalle'}
                            aria-label={isExpanded ? 'Ocultar detalle' : 'Ver detalle'}
                            className="h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                          >
                            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', isExpanded && 'rotate-180')} />
                          </button>
                        </CollapsibleTrigger>
                      </Collapsible>
                    )}
                    <button
                      type="button"
                      title={isRead ? 'Marcar como no leída' : 'Marcar como leída'}
                      aria-label={isRead ? 'Marcar como no leída' : 'Marcar como leída'}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (isRead) {
                          markAsUnread.mutate({ id: n.id, source_type: n.source_type, source_id: n.source_id });
                        } else {
                          markAsRead.mutate({ id: n.id, source_type: n.source_type, source_id: n.source_id });
                        }
                      }}
                      className="h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    >
                      {isRead ? <Undo2 className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
                {expandable && isExpanded && (
                  <div className="px-3 pb-3 pl-9">{renderDetails(n)}</div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    );
  };

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-background/60 backdrop-blur-sm animate-fade-in pointer-events-none"
          aria-hidden
        />
      )}
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            className={cn(
              'group w-full h-auto justify-start gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-sidebar-foreground',
              collapsed && 'justify-center gap-0 px-2',
            )}
            title={collapsed ? `Notificaciones${unreadCount ? ` (${badgeLabel})` : ''}` : undefined}
          >
            <span className="relative inline-flex shrink-0">
              <Bell className="h-5 w-5 transition-transform duration-150 group-hover:scale-[1.06]" />
              {collapsed && badge}
            </span>
            {!collapsed && (
              <>
                <span className="flex-1 text-left">Notificaciones</span>
                {unreadCount > 0 && (
                  <span className="ml-auto inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-destructive px-1.5 text-[11px] font-semibold leading-none text-destructive-foreground">
                    {badgeLabel}
                  </span>
                )}
              </>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          side={isMobile ? 'bottom' : 'right'}
          align={isMobile ? 'center' : 'end'}
          sideOffset={8}
          collisionPadding={12}
          className={cn(
            'p-0 overflow-hidden flex flex-col',
            isMobile
              ? 'w-[calc(100vw-24px)] max-w-[400px] max-h-[80vh]'
              : 'w-[380px] max-h-[520px]',
          )}
        >
          <Tabs value={tab} onValueChange={(v) => setTab(v as 'unread' | 'read')} className="flex flex-col flex-1 min-h-0">
            <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border bg-popover sticky top-0 z-10">
              <TabsList className="h-8 p-0.5">
                <TabsTrigger value="unread" className="h-7 text-xs px-2.5">
                  No leídas{unreadCount > 0 && ` (${badgeLabel})`}
                </TabsTrigger>
                <TabsTrigger value="read" className="h-7 text-xs px-2.5">
                  Leídas
                </TabsTrigger>
              </TabsList>
              {tab === 'unread' && unreadCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs gap-1"
                  onClick={() => markAllAsRead.mutate()}
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                  Marcar todas
                </Button>
              )}
            </div>

            {/* Filtros compactos */}
            <div className="px-3 py-2 border-b border-border bg-popover/60 flex flex-wrap items-center gap-1.5">
              <Filter className="h-3.5 w-3.5 text-muted-foreground" />
              {showSucursalFilter && (
                <Select value={filterSucursal} onValueChange={setFilterSucursal}>
                  <SelectTrigger className="h-7 text-xs w-auto min-w-[110px] gap-1">
                    <SelectValue placeholder="Sucursal" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas las sucursales</SelectItem>
                    {sucursales.map(s => (
                      <SelectItem key={s.id} value={s.id}>{s.nombre}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Select value={filterCategory} onValueChange={(v) => setFilterCategory(v as EventCategory | 'all')}>
                <SelectTrigger className="h-7 text-xs w-auto min-w-[110px] gap-1">
                  <SelectValue placeholder="Categoría" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas las categorías</SelectItem>
                  {allowedCategories.map(c => (
                    <SelectItem key={c} value={c}>{CATEGORY_LABELS[c]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filterType} onValueChange={setFilterType}>
                <SelectTrigger className="h-7 text-xs w-auto min-w-[100px] gap-1">
                  <SelectValue placeholder="Tipo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los tipos</SelectItem>
                  {allowedTypes
                    .filter(t => filterCategory === 'all' || t.category === filterCategory)
                    .map(t => (
                      <SelectItem key={t.eventType} value={t.eventType}>{t.label}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <Select value={filterDate} onValueChange={(v) => setFilterDate(v as DateRange)}>
                <SelectTrigger className="h-7 text-xs w-auto min-w-[90px] gap-1">
                  <SelectValue placeholder="Fecha" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas las fechas</SelectItem>
                  <SelectItem value="today">Hoy</SelectItem>
                  <SelectItem value="7d">Últimos 7 días</SelectItem>
                  <SelectItem value="30d">Últimos 30 días</SelectItem>
                </SelectContent>
              </Select>
              {filtersActive && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-[11px] px-2 ml-auto"
                  onClick={() => {
                    setFilterSucursal('all');
                    setFilterCategory('all');
                    setFilterType('all');
                    setFilterDate('all');
                  }}
                >
                  Limpiar
                </Button>
              )}
            </div>

            <TabsContent value="unread" className="flex-1 min-h-0 mt-0 flex flex-col">
              {renderList(filteredUnread, 'unread')}
            </TabsContent>
            <TabsContent value="read" className="flex-1 min-h-0 mt-0 flex flex-col">
              {renderList(filteredRead, 'read')}
            </TabsContent>
          </Tabs>
        </PopoverContent>
      </Popover>
    </>
  );
}
