import { useState, useEffect } from 'react';
import { CreditCard, BarChart3, Wallet, ClipboardList, CalendarClock, Users, Store, Settings, ChevronLeft, Lock, Menu, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useAuth } from '@/contexts/AuthContext';
import { useOrganization } from '@/contexts/OrganizationContext';
import { usePinProtection } from '@/hooks/usePinProtection';
import { useIsMobile } from '@/hooks/use-mobile';
import { SucursalSelector } from '@/components/SucursalSelector';
import { NotificationsBell } from '@/components/notifications/NotificationsBell';
import { useSubscriptionAccess } from '@/hooks/useSubscriptionAccess';
import {
  getRequiredPlan,
  planAllowsFeature,
  PLAN_LABELS,
  resolveEffectivePlan,
  type PlanFeatureKey,
} from '@/lib/planAccess';

interface AppSidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

interface NavItem {
  id: string;
  label: string;
  icon: typeof CreditCard;
  feature?: PlanFeatureKey;
}

const ROLE_LABELS: Record<string, string> = {
  owner: 'Dueño',
  general_manager: 'Enc. General',
  manager: 'Enc. Sucursal',
  barber: 'Barbero',
  sucursal_account: 'Cuenta de sucursal',
};

// Agrupación visual bajo "Gestión". Es solo presentación: los permisos que
// deciden qué ítems existen no cambian.
const MGMT_IDS = new Set(['mi-negocio', 'config']);

// Curva compartida para las transiciones de "tamaño" del colapso (ancho del
// aside, paddings, ícono de nav) — la misma que ya usa el ancho del <aside>.
const SIZE_EASE = 'var(--ease-out-quint)';

// Tamaño del ícono de nav en modo rail (railMode): fijo en pantallas altas
// (100vh ≈ 900px+ → 40px, el tamaño de siempre), se achica con la altura de
// viewport en pantallas más bajas hasta un piso de 36px (cómodo para tocar)
// a ~768px de alto (laptop chica, caso de 8 ítems de nav) — así el rail
// nunca necesita scroll interno en el rango de alturas propio de desktop,
// sin JS ni mediciones en runtime. Solo aplica en rail; expandido no cambia.
const RAIL_ICON_SIZE = 'clamp(36px, 3vh + 13px, 40px)';

export function AppSidebar({ activeTab, onTabChange }: AppSidebarProps) {
  const isMobile = useIsMobile();
  const [collapsed, setCollapsed] = useState(isMobile);
  const { profile, roles, isOwner, isGeneralManager, isManager, isBarber, canManagePayments, canOperarCajaYGastos, canManageConfig, canViewConfig, canViewResumen, canViewTareas, canViewMiNegocio, canViewFinanzas, canViewTurnosAgenda, canViewClientes, signOut } = useAuth();
  const { organization } = useOrganization();
  const { access: subscriptionAccess } = useSubscriptionAccess();
  const { isUnlocked, requiresPin, lock, unlockedBy } = usePinProtection();
  const effectivePlan = resolveEffectivePlan(subscriptionAccess, organization?.plan);

  useEffect(() => {
    if (isMobile) setCollapsed(true);
  }, [isMobile]);

  // En mobile el drawer siempre muestra la versión completa: `collapsed` solo
  // lo desliza fuera de pantalla. El riel compacto es exclusivo de desktop.
  const railMode = !isMobile && collapsed;

  // Transición de texto que persiste en el DOM en ambos estados (logo,
  // labels de nav, section labels, selector de sucursal): opacity con
  // timing asimétrico (Opción B) + cualquier propiedad de "tamaño" extra
  // que acompañe a ese mismo elemento (margin, max-height), siempre a
  // SIZE_EASE/200ms para que quede sincronizada con el ancho del aside.
  const textTransition = (extra?: string) => {
    const opacityPart = railMode
      ? 'opacity 120ms var(--ease-in-quint)'
      : `opacity 150ms ${SIZE_EASE} 80ms`;
    return extra ? `${opacityPart}, ${extra}` : opacityPart;
  };

  const navItems: NavItem[] = [
    ...(canOperarCajaYGastos ? [{ id: 'registro', label: 'Cobrar', icon: CreditCard }] : []),
    ...(canViewResumen ? [{ id: 'resumen', label: 'Caja', icon: BarChart3 }] : []),
    ...(canViewFinanzas ? [{ id: 'finanzas', label: 'Finanzas', icon: Wallet }] : []),
    ...(canViewTareas ? [{ id: 'tareas', label: 'Tareas', icon: ClipboardList, feature: 'tasks' as const }] : []),
    ...(canViewTurnosAgenda ? [{ id: 'turnos-agenda', label: 'Turnos', icon: CalendarClock, feature: 'appointments' as const }] : []),
    ...(canViewClientes ? [{ id: 'clientes', label: 'Clientes', icon: Users, feature: 'clients' as const }] : []),
    ...(canViewMiNegocio ? [{ id: 'mi-negocio', label: 'Mi Negocio', icon: Store }] : []),
    ...(canViewConfig ? [{ id: 'config', label: 'Configuración', icon: Settings }] : []),
  ];

  const principalItems = navItems.filter((i) => !MGMT_IDS.has(i.id));
  const gestionItems = navItems.filter((i) => MGMT_IDS.has(i.id));

  const displayName = profile?.full_name || profile?.email || 'Usuario';
  const initials =
    (profile?.full_name || profile?.email || 'U')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s.charAt(0).toUpperCase())
      .join('') || 'U';

  const primaryRole = roles.find((r) => r !== 'otros');
  const primaryRoleLabel = primaryRole ? ROLE_LABELS[primaryRole] ?? null : null;

  const handleTabChange = (tab: string) => {
    onTabChange(tab);
    if (isMobile) setCollapsed(true);
  };

  const renderNavItem = (item: NavItem, index: number) => {
    const active = activeTab === item.id;
    const Icon = item.icon;
    const isPlanLocked = item.feature ? !planAllowsFeature(effectivePlan, item.feature) : false;
    const requiredPlan = item.feature ? getRequiredPlan(item.feature) : null;
    const itemTitle = railMode
      ? `${item.label}${isPlanLocked && requiredPlan ? `, requiere ${PLAN_LABELS[requiredPlan]}` : ''}`
      : undefined;
    return (
      <li
        key={item.id}
        className="animate-item-in [animation-fill-mode:backwards]"
        style={{ animationDelay: `${index * 25}ms` }}
      >
        <button
          onClick={() => handleTabChange(item.id)}
          data-onboarding-id={item.id === 'mi-negocio' ? 'mi-negocio-nav' : undefined}
          aria-current={active ? 'page' : undefined}
          title={itemTitle}
          className={cn(
            'group flex w-full items-center justify-center rounded-[10px] py-1.5 text-sm transition-colors duration-150',
            railMode ? 'px-0' : 'px-2',
            active
              ? 'bg-primary font-semibold text-primary-foreground'
              : 'font-medium text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
          style={{ transition: `padding-left 200ms ${SIZE_EASE}, padding-right 200ms ${SIZE_EASE}` }}
        >
          <span
            className={cn(
              'relative grid shrink-0 place-items-center',
              railMode
                ? cn(
                    'rounded-[10px]',
                    active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground group-hover:bg-muted',
                  )
                : active
                  ? 'h-7 w-7 rounded-md bg-primary-foreground/15 text-primary-foreground'
                  : 'h-5 w-5 rounded-md',
            )}
            style={{
              ...(railMode ? { width: RAIL_ICON_SIZE, height: RAIL_ICON_SIZE } : {}),
              transition: `width 200ms ${SIZE_EASE}, height 200ms ${SIZE_EASE}, border-radius 200ms ${SIZE_EASE}, background-color 200ms ${SIZE_EASE}, color 200ms ${SIZE_EASE}`,
            }}
          >
            <Icon className="h-5 w-5 shrink-0" />
            {isPlanLocked && railMode && (
              <span
                className={cn(
                  'absolute -right-0.5 -top-0.5 grid h-4 w-4 place-items-center rounded-full border border-background',
                  active ? 'bg-primary-foreground text-primary' : 'bg-status-warning-bg text-status-warning-foreground',
                )}
              >
                <Lock className="h-2.5 w-2.5" />
              </span>
            )}
          </span>
          <span
            className="min-w-0 truncate text-left"
            style={{
              opacity: railMode ? 0 : 1,
              marginLeft: railMode ? '0px' : '0.625rem',
              // flex-basis (no flex-1/flex-grow) a propósito: flex-grow no es
              // animable por CSS y, aunque quede invisible, seguiría
              // reclamando todo el espacio libre y correría el ícono del
              // centro. Con basis explícito el label transiciona a 0 de
              // verdad y justify-center puede centrar el ícono.
              flexBasis: railMode ? '0px' : '200px',
              transition: textTransition(`margin-left 200ms ${SIZE_EASE}, flex-basis 200ms ${SIZE_EASE}`),
            }}
            aria-hidden={railMode}
          >
            {item.label}
          </span>
          {!railMode && isPlanLocked && requiredPlan && (
            <span
              className={cn(
                'ml-auto inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px]',
                active ? 'bg-primary-foreground/15 text-primary-foreground' : 'bg-status-warning-bg text-status-warning-foreground',
              )}
            >
              <Lock className="h-3 w-3" />
              {PLAN_LABELS[requiredPlan]}
            </span>
          )}
        </button>
      </li>
    );
  };

  const sectionLabel = (text: string) => (
    <p
      className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
      style={{
        opacity: railMode ? 0 : 1,
        transition: textTransition(),
      }}
      aria-hidden={railMode}
    >
      {text}
    </p>
  );

  return (
    <>
      {isMobile && collapsed && (
        <Button
          variant="outline"
          size="icon"
          onClick={() => setCollapsed(false)}
          className="fixed left-4 top-4 z-40 h-11 w-11 rounded-full border bg-background/95 backdrop-blur"
          aria-label="Abrir navegación"
        >
          <Menu className="h-5 w-5" />
        </Button>
      )}

      {isMobile && !collapsed && (
        <button
          type="button"
          aria-label="Cerrar navegación"
          className="fixed inset-0 z-40 bg-foreground/50 backdrop-blur-sm animate-fade-in"
          onClick={() => setCollapsed(true)}
        />
      )}

      <aside
        className={cn(
          'flex flex-col border-r border-border bg-background',
          isMobile
            ? 'fixed inset-y-0 left-0 z-40 w-[min(85vw,20rem)] max-w-sm transition-transform duration-200 [transition-timing-function:var(--ease-out-quint)]'
            : cn(
                'z-10 h-full transition-[width] duration-200 [transition-timing-function:var(--ease-out-quint)]',
                collapsed && 'delay-sidebar-width',
              ),
          !isMobile && (collapsed ? 'w-16' : 'w-56'),
        )}
        style={
          isMobile
            ? {
                transform: collapsed ? 'translate3d(-100%, 0, 0)' : 'translate3d(0, 0, 0)',
                willChange: 'transform',
                maxWidth: '100vw',
              }
            : undefined
        }
      >
        {/* Brand identity — header con fondo navy sólido (bg-primary, el
            mismo tono que el ítem de nav activo y el botón de colapsar).
            Persiste en el DOM en ambos estados: solo el padding del header
            y el bloque de texto (nombre) transicionan. */}
        <div
          className="bg-primary py-1"
          style={{
            paddingLeft: railMode ? '0px' : '1rem',
            paddingRight: railMode ? '0px' : '1rem',
            transition: `padding-left 200ms ${SIZE_EASE}, padding-right 200ms ${SIZE_EASE}`,
          }}
        >
          <div className="relative flex items-center justify-center">
            <img
              src="/MagotipoBlanco.png"
              alt="Vittro"
              title={railMode ? organization?.name || 'Barbería' : undefined}
              className="h-20 w-20 shrink-0 object-contain"
            />
            {isMobile && (
              <button
                type="button"
                onClick={() => setCollapsed(true)}
                aria-label="Cerrar navegación"
                className="absolute right-0 top-0 grid h-8 w-8 shrink-0 place-items-center rounded-lg text-primary-foreground/70 transition-colors hover:bg-primary-foreground/15 hover:text-primary-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          {/* Selector de sucursal — sin caja (Variante J): un hairline lo
              separa del nombre de la organización y el trigger se ve como
              texto plano. El componente interno se recolorea vía overrides
              de descendiente para no tocar SucursalSelector: sobre el fondo
              navy sólido del header usa text-primary-foreground/70, el
              mismo patrón de opacidad que ya usa el archivo para texto
              secundario sobre bg-primary.
              Nota: el selector de sucursal en sí NO se unificó — el glyph
              colapsado (ícono de ubicación) y el Select expandido son dos
              renders internos completamente distintos de SucursalSelector
              (uno es un ícono estático, el otro un dropdown interactivo),
              no una diferencia de texto. Ver reporte del build. */}
          {!railMode && (
            <>
              <div className="mt-3 h-px w-full bg-primary-foreground/15" />
              <div className="mt-3 w-full [&_[role=combobox]]:border-0 [&_[role=combobox]]:bg-transparent [&_[role=combobox]]:text-primary-foreground/70 [&_[role=combobox]_svg]:text-primary-foreground/70 [&>div]:border-0 [&>div]:bg-transparent [&>div]:text-primary-foreground/70 [&>div]:ring-0">
                <SucursalSelector collapsed={false} />
              </div>
            </>
          )}
          {railMode && <SucursalSelector collapsed />}
        </div>

        {/* Navigation */}
        <nav className="mt-2 flex-1 overflow-y-auto px-2 py-2 scrollbar-hide">
          {principalItems.length > 0 && (
            <div>
              <div
                className="overflow-hidden"
                style={{
                  opacity: railMode ? 0 : 1,
                  maxHeight: railMode ? '0px' : '28px',
                  transition: textTransition(`max-height 200ms ${SIZE_EASE}`),
                }}
                aria-hidden={railMode}
              >
                {sectionLabel('Principal')}
              </div>
              <ul className="space-y-0.5">
                {principalItems.map((item, i) => renderNavItem(item, i))}
              </ul>
            </div>
          )}

          {gestionItems.length > 0 && (
            <div className="mt-3">
              <div className="relative h-7">
                <p
                  className="absolute inset-x-3 top-0 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                  style={{
                    opacity: railMode ? 0 : 1,
                    transition: textTransition(),
                  }}
                  aria-hidden={railMode}
                >
                  Gestión
                </p>
                {principalItems.length > 0 && (
                  <div
                    className="absolute inset-x-2 top-3 h-px bg-border"
                    style={{
                      opacity: railMode ? 1 : 0,
                      transition: railMode
                        ? `opacity 150ms ${SIZE_EASE} 80ms`
                        : 'opacity 120ms var(--ease-in-quint)',
                    }}
                    aria-hidden={!railMode}
                  />
                )}
              </div>
              <ul className="space-y-0.5">
                {gestionItems.map((item, i) => renderNavItem(item, principalItems.length + i))}
              </ul>
            </div>
          )}
        </nav>

        {/* User & session.
            Nota: el bloque avatar+campana+candado NO se unificó — en rail
            (64px) se apilan verticalmente por necesidad de espacio; en
            expandido van en fila horizontal. flex-direction no es una
            propiedad animable por CSS, así que esta parte sigue siendo un
            swap condicional (igual que hoy). El chevron de colapsar SÍ
            quedó unificado como un solo botón persistente. Ver reporte. */}
        <div className="border-t border-border p-2">
          {railMode ? (
            <div className="flex flex-col items-center gap-1.5 py-2">
              <Avatar className="h-9 w-9" title={displayName}>
                <AvatarFallback className="bg-primary text-xs font-semibold text-primary-foreground">
                  {initials}
                </AvatarFallback>
              </Avatar>
              {canViewTareas && (
                <div className="[&>button]:h-8 [&>button]:w-8 [&>button]:min-w-0 [&>button]:rounded-lg [&>button]:p-0">
                  <NotificationsBell collapsed onNavigate={() => handleTabChange('tareas')} />
                </div>
              )}
              {requiresPin && isUnlocked && (
                <button
                  type="button"
                  onClick={lock}
                  title={`Bloquear (${unlockedBy})`}
                  aria-label="Bloquear"
                  className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <Lock className="h-4 w-4" />
                </button>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2.5 px-2 py-2">
              <Avatar className="h-9 w-9">
                <AvatarFallback className="bg-primary text-xs font-semibold text-primary-foreground">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{displayName}</p>
                {primaryRoleLabel && (
                  <p className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {primaryRoleLabel}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {canViewTareas && (
                  <div className="[&>button]:h-8 [&>button]:w-8 [&>button]:min-w-0 [&>button]:rounded-lg [&>button]:p-0">
                    <NotificationsBell collapsed onNavigate={() => handleTabChange('tareas')} />
                  </div>
                )}
                {requiresPin && isUnlocked && (
                  <button
                    type="button"
                    onClick={lock}
                    title={`Bloquear (${unlockedBy})`}
                    aria-label="Bloquear"
                    className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <Lock className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          )}
          {!isMobile && (
            <button
              type="button"
              onClick={() => setCollapsed(!collapsed)}
              title={collapsed ? 'Expandir' : 'Colapsar'}
              aria-label={collapsed ? 'Expandir navegación' : 'Colapsar navegación'}
              className="mt-1 flex w-full items-center justify-center rounded-lg bg-primary py-2 text-primary-foreground transition-colors hover:bg-primary/85"
            >
              <ChevronLeft
                className={cn(
                  'h-4 w-4 transition-transform duration-200 [transition-timing-function:var(--ease-out-quint)]',
                  collapsed && 'rotate-180',
                )}
              />
            </button>
          )}
        </div>
      </aside>
    </>
  );
}
