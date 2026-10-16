import { useFinanceDemo } from '@/contexts/FinanceDemoContext';
import { DEMO_IDENTITY } from '@/lib/financeDemoData';
import { useState, useEffect } from 'react';
import { Bell, CreditCard, BarChart3, Wallet, ClipboardList, CalendarClock, Users, Store, Settings, ChevronLeft, Lock, Menu, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useAuth } from '@/contexts/AuthContext';
import { useOrganization } from '@/contexts/OrganizationContext';
import { usePinProtection } from '@/hooks/usePinProtection';
import { useWindowMode } from '@/hooks/use-window-mode';
import { SucursalSelector } from '@/components/SucursalSelector';
import { NotificationsBell } from '@/components/notifications/NotificationsBell';
import type { NotificationItem } from '@/hooks/useNotifications';
import { destinoDeNotificacion, irATareas } from '@/lib/tareasNavegacion';
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

// Tamaño del ícono de nav en modo rail (isRailWidth): fijo en pantallas altas
// (100vh ≈ 900px+ → 40px, el tamaño de siempre), se achica con la altura de
// viewport en pantallas más bajas hasta un piso de 36px (cómodo para tocar)
// a ~768px de alto (laptop chica, caso de 8 ítems de nav) — así el rail
// nunca necesita scroll interno en el rango de alturas propio de desktop,
// sin JS ni mediciones en runtime. Solo aplica en rail; expandido no cambia.
const RAIL_ICON_SIZE = 'clamp(36px, 3vh + 13px, 40px)';

export function AppSidebar({ activeTab, onTabChange }: AppSidebarProps) {
  const demo = useFinanceDemo();
  // Modo de ventana (DESIGN.md → Layout): solo para las dos decisiones que
  // una media query no puede tomar por sí sola — el valor inicial de
  // `collapsed` y si un tap de navegación debe cerrar el drawer. El ancho,
  // la posición y la visibilidad del shell (aside/hamburguesa/scrim/toggle,
  // más abajo) se deciden con clases `sm:`/`lg:`, no leyendo este hook.
  const mode = useWindowMode();
  const isCompact = mode === 'compact';
  const [collapsed, setCollapsed] = useState(isCompact);
  const { profile, roles, isOwner, isGeneralManager, isManager, isBarber, canManagePayments, canOperarCajaYGastos, canManageConfig, canViewConfig, canViewResumen, canViewTareas, canViewMiNegocio, canViewFinanzas, canViewTurnosAgenda, canViewClientes, signOut } = useAuth();
  const { organization } = useOrganization();
  const { access: subscriptionAccess } = useSubscriptionAccess();
  const { isUnlocked, requiresPin, lock, unlockedBy } = usePinProtection();
  const effectivePlan = resolveEffectivePlan(subscriptionAccess, organization?.plan);

  useEffect(() => {
    if (isCompact) setCollapsed(true);
  }, [isCompact]);

  // Ancho "riel" (64px): siempre en Medium (único estado disponible ahí) o
  // en Expanded cuando el usuario lo colapsó. En Compact el drawer, cuando
  // está abierto, siempre muestra la versión completa.
  const isRailWidth = mode === 'medium' || (mode === 'expanded' && collapsed);
  // Medium exige etiqueta visible (no depende de `title`/hover): un
  // tratamiento nuevo, distinto del riel de Expanded colapsado, que sigue
  // apoyándose en `title` para mouse (DESIGN.md → Layout, Do's).
  const showMicroLabel = mode === 'medium';

  // Transición de texto que persiste en el DOM en ambos estados (logo,
  // labels de nav, section labels, selector de sucursal): opacity con
  // timing asimétrico (Opción B) + cualquier propiedad de "tamaño" extra
  // que acompañe a ese mismo elemento (margin, max-height), siempre a
  // SIZE_EASE/200ms para que quede sincronizada con el ancho del aside.
  const textTransition = (extra?: string) => {
    const opacityPart = isRailWidth
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

  const displayName = demo.active ? DEMO_IDENTITY.user : (profile?.full_name || profile?.email || 'Usuario');
  const initials =
    (displayName)
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s.charAt(0).toUpperCase())
      .join('') || 'U';

  const primaryRole = roles.find((r) => r !== 'otros');
  const primaryRoleLabel = primaryRole ? ROLE_LABELS[primaryRole] ?? null : null;

  const handleTabChange = (tab: string) => {
    onTabChange(tab);
    if (isCompact) setCollapsed(true);
  };
  // Una notificación de Tareas lleva a esa tarea (o Tarea automática) concreta, no solo al módulo.
  const abrirDesdeNotificacion = (n: NotificationItem) => {
    irATareas(destinoDeNotificacion(n));
    handleTabChange('tareas');
  };

  const renderNavItem = (item: NavItem, index: number) => {
    const active = activeTab === item.id;
    const Icon = item.icon;
    const isPlanLocked = item.feature ? !planAllowsFeature(effectivePlan, item.feature) : false;
    const requiredPlan = item.feature ? getRequiredPlan(item.feature) : null;
    const itemTitle = isRailWidth
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
            'group flex w-full items-center justify-center gap-0 rounded-[10px] py-1.5 text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            'sm:flex-col sm:gap-0.5 lg:flex-row lg:gap-0',
            isRailWidth ? 'px-0' : 'px-2',
            active
              ? 'bg-primary font-semibold text-primary-foreground'
              : 'font-medium text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
          style={{ transition: `padding-left 200ms ${SIZE_EASE}, padding-right 200ms ${SIZE_EASE}` }}
        >
          <span
            className={cn(
              'relative grid shrink-0 place-items-center',
              isRailWidth
                ? cn(
                    'rounded-[10px]',
                    active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground group-hover:bg-muted',
                  )
                : active
                  ? 'h-7 w-7 rounded-md bg-primary-foreground/15 text-primary-foreground'
                  : 'h-5 w-5 rounded-md',
            )}
            style={{
              ...(isRailWidth ? { width: RAIL_ICON_SIZE, height: RAIL_ICON_SIZE } : {}),
              transition: `width 200ms ${SIZE_EASE}, height 200ms ${SIZE_EASE}, border-radius 200ms ${SIZE_EASE}, background-color 200ms ${SIZE_EASE}, color 200ms ${SIZE_EASE}`,
            }}
          >
            <Icon className="h-5 w-5 shrink-0" />
            {isPlanLocked && isRailWidth && (
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
            className="min-w-0 truncate text-left sm:hidden lg:block"
            style={{
              opacity: isRailWidth ? 0 : 1,
              marginLeft: isRailWidth ? '0px' : '0.625rem',
              // flex-basis (no flex-1/flex-grow) a propósito: flex-grow no es
              // animable por CSS y, aunque quede invisible, seguiría
              // reclamando todo el espacio libre y correría el ícono del
              // centro. Con basis explícito el label transiciona a 0 de
              // verdad y justify-center puede centrar el ícono.
              flexBasis: isRailWidth ? '0px' : '200px',
              transition: textTransition(`margin-left 200ms ${SIZE_EASE}, flex-basis 200ms ${SIZE_EASE}`),
            }}
            aria-hidden={isRailWidth}
          >
            {item.label}
          </span>
          {showMicroLabel && (
            // Etiqueta compacta del riel Medium (DESIGN.md → Typography,
            // rol Micro extendido): visible siempre, sin depender de
            // `title`/hover — a diferencia del riel de Expanded colapsado.
            <span className="hidden w-full truncate text-center text-[10px] font-semibold leading-none sm:block lg:hidden">
              {item.label}
            </span>
          )}
          {!isRailWidth && isPlanLocked && requiredPlan && (
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
        opacity: isRailWidth ? 0 : 1,
        transition: textTransition(),
      }}
      aria-hidden={isRailWidth}
    >
      {text}
    </p>
  );

  return (
    <>
      {collapsed && (
        <Button
          variant="outline"
          size="icon"
          onClick={() => setCollapsed(false)}
          className="fixed left-4 top-4 z-40 h-11 w-11 rounded-full border bg-background/95 backdrop-blur sm:hidden"
          aria-label="Abrir navegación"
        >
          <Menu className="h-5 w-5" />
        </Button>
      )}

      {!collapsed && (
        <button
          type="button"
          aria-label="Cerrar navegación"
          className="fixed inset-0 z-40 bg-foreground/50 backdrop-blur-sm animate-fade-in sm:hidden"
          onClick={() => setCollapsed(true)}
        />
      )}

      <aside
        data-collapsed={collapsed}
        className={cn(
          'flex flex-col border-r border-border bg-background',
          // Compact (<640): drawer fuera de pantalla; `collapsed` decide si
          // está oculto o deslizado a la vista.
          'fixed inset-y-0 left-0 z-40 w-[min(85vw,20rem)] max-w-[100vw] -translate-x-full [will-change:transform] transition-transform duration-200 [transition-timing-function:var(--ease-out-quint)]',
          !collapsed && 'translate-x-0',
          // Medium (640–1023): riel persistente de 64px, único estado
          // disponible — el ancho nunca depende de `collapsed` acá porque
          // ninguna regla `lg:` lo sobrescribe todavía. Expanded (≥1024):
          // riel o sidebar expandido según la preferencia del usuario
          // (`data-collapsed`).
          'sm:static sm:z-10 sm:h-full sm:w-16 sm:translate-x-0 sm:[will-change:auto] sm:transition-[width] sm:duration-200 sm:[transition-timing-function:var(--ease-out-quint)]',
          collapsed && 'sm:delay-sidebar-width',
          'lg:data-[collapsed=false]:w-56',
        )}
      >
        {/* Brand identity — header con fondo navy sólido (bg-primary, el
            mismo tono que el ítem de nav activo y el botón de colapsar).
            Persiste en el DOM en ambos estados: solo el padding del header
            y el bloque de texto (nombre) transicionan. */}
        <div
          className="bg-primary py-1"
          style={{
            paddingLeft: isRailWidth ? '0px' : '1rem',
            paddingRight: isRailWidth ? '0px' : '1rem',
            transition: `padding-left 200ms ${SIZE_EASE}, padding-right 200ms ${SIZE_EASE}`,
          }}
        >
          <div className="relative flex items-center justify-center">
            <img
              src="/MagotipoBlanco.png"
              alt="Vittro"
              title={isRailWidth ? demo.active ? DEMO_IDENTITY.organization : (organization?.name || 'Barbería') : undefined}
              className="h-20 w-20 shrink-0 object-contain"
            />
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              aria-label="Cerrar navegación"
              className="absolute right-0 top-0 grid h-8 w-8 shrink-0 place-items-center rounded-lg text-primary-foreground/70 transition-colors hover:bg-primary-foreground/15 hover:text-primary-foreground sm:hidden"
            >
              <X className="h-4 w-4" />
            </button>
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
          {!isRailWidth && (
            <>
              <div className="mt-3 h-px w-full bg-primary-foreground/15" />
              <div className="mt-3 w-full [&_[role=combobox]]:border-0 [&_[role=combobox]]:bg-transparent [&_[role=combobox]]:text-primary-foreground/70 [&_[role=combobox]_svg]:text-primary-foreground/70 [&>div]:border-0 [&>div]:bg-transparent [&>div]:text-primary-foreground/70 [&>div]:ring-0">
                <SucursalSelector collapsed={false} />
              </div>
            </>
          )}
          {isRailWidth && <SucursalSelector collapsed />}
        </div>

        {/* Navigation */}
        <nav className="mt-2 flex-1 overflow-y-auto px-2 py-2 scrollbar-hide">
          {principalItems.length > 0 && (
            <div>
              <div
                className="overflow-hidden"
                style={{
                  opacity: isRailWidth ? 0 : 1,
                  maxHeight: isRailWidth ? '0px' : '28px',
                  transition: textTransition(`max-height 200ms ${SIZE_EASE}`),
                }}
                aria-hidden={isRailWidth}
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
                    opacity: isRailWidth ? 0 : 1,
                    transition: textTransition(),
                  }}
                  aria-hidden={isRailWidth}
                >
                  Gestión
                </p>
                {principalItems.length > 0 && (
                  <div
                    className="absolute inset-x-2 top-3 h-px bg-border"
                    style={{
                      opacity: isRailWidth ? 1 : 0,
                      transition: isRailWidth
                        ? `opacity 150ms ${SIZE_EASE} 80ms`
                        : 'opacity 120ms var(--ease-in-quint)',
                    }}
                    aria-hidden={!isRailWidth}
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
          {isRailWidth ? (
            <div className="flex flex-col items-center gap-1.5 py-2">
              <Avatar className="h-9 w-9" title={displayName}>
                <AvatarFallback className="bg-primary text-xs font-semibold text-primary-foreground">
                  {initials}
                </AvatarFallback>
              </Avatar>
              {canViewTareas && (
                <div className="[&>button]:h-8 [&>button]:w-8 [&>button]:min-w-0 [&>button]:rounded-lg [&>button]:p-0">
                  {demo.active ? <Button variant="ghost" size="icon" disabled aria-label="Notificaciones pausadas durante la grabación"><Bell className="h-4 w-4" /></Button> : <NotificationsBell collapsed onNavigate={abrirDesdeNotificacion} />}
                </div>
              )}
              {!demo.active && requiresPin && isUnlocked && (
                <button
                  type="button"
                  onClick={lock}
                  title={`Bloquear (${unlockedBy})`}
                  aria-label="Bloquear"
                  className="hit-area-expand grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
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
                    {demo.active ? <Button variant="ghost" size="icon" disabled aria-label="Notificaciones pausadas durante la grabación"><Bell className="h-4 w-4" /></Button> : <NotificationsBell collapsed onNavigate={abrirDesdeNotificacion} />}
                  </div>
                )}
                {!demo.active && requiresPin && isUnlocked && (
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
          {/* Toggle riel ↔ expandido: exclusivo de Expanded — Medium no
              tiene otro estado disponible y Compact no tiene sidebar
              persistente que colapsar. */}
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            title={collapsed ? 'Expandir' : 'Colapsar'}
            aria-label={collapsed ? 'Expandir navegación' : 'Colapsar navegación'}
            className="mt-1 hidden w-full items-center justify-center rounded-lg bg-primary py-2 text-primary-foreground transition-colors hover:bg-primary/85 lg:flex"
          >
            <ChevronLeft
              className={cn(
                'h-4 w-4 transition-transform duration-200 [transition-timing-function:var(--ease-out-quint)]',
                collapsed && 'rotate-180',
              )}
            />
          </button>
        </div>
      </aside>
    </>
  );
}
