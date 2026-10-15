import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  Building2,
  ChevronRight,
  CreditCard,
  LayoutDashboard,
  LogOut,
  Menu,
  ScrollText,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface AdminShellProps {
  children: ReactNode;
  actorLabel?: string;
  onSignOut: () => void | Promise<void>;
}

const NAV_GROUPS = [
  {
    label: 'Operación',
    items: [
      { to: '/admin', end: true, label: 'Resumen', icon: LayoutDashboard },
      { to: '/admin/barberias', label: 'Barberías', icon: Building2 },
      { to: '/admin/usuarios', label: 'Usuarios', icon: Users },
    ],
  },
  {
    label: 'Control',
    items: [
      { to: '/admin/suscripciones', label: 'Suscripciones', icon: CreditCard },
      { to: '/admin/aliados', label: 'Aliados', icon: Users },
      { to: '/admin/auditoria', label: 'Auditoría', icon: ScrollText },
    ],
  },
] as const;

export function AdminShell({ children, actorLabel = 'admin', onSignOut }: AdminShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [mobileOpen]);

  const sidebar = (
    <aside
      aria-label="Navegación del centro de administración"
      className={cn(
        'fixed inset-y-0 left-0 z-40 flex w-[min(86vw,15rem)] flex-col border-r border-sidebar-border bg-sidebar',
        'transition-transform duration-200 [transition-timing-function:var(--ease-out-quint)] lg:translate-x-0',
        mobileOpen ? 'translate-x-0' : '-translate-x-full',
      )}
    >
      <div className="bg-primary px-4 pb-4 pt-3 text-primary-foreground">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <img src="/LogotipoBlanco.png" alt="Vittro" className="h-10 w-auto object-contain object-left" />
            <div className="mt-3 flex items-center gap-2 border-t border-primary-foreground/15 pt-3">
              <ShieldCheck className="h-4 w-4 shrink-0 text-primary-foreground/80" />
              <p className="text-xs font-medium tracking-wide text-primary-foreground/80">Centro de administración</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-primary-foreground/75 transition-colors hover:bg-primary-foreground/15 hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground lg:hidden"
            aria-label="Cerrar navegación"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {NAV_GROUPS.map((group, groupIndex) => (
          <div key={group.label} className={cn(groupIndex > 0 && 'mt-6')}>
            <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {group.label}
            </p>
            <ul className="space-y-1">
              {group.items.map(({ to, end, label, icon: Icon }) => (
                <li key={to}>
                  <NavLink
                    to={to}
                    end={end}
                    className={({ isActive }) => cn(
                      'group flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      isActive
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                    )}
                  >
                    {({ isActive }) => (
                      <>
                        <Icon className="h-4 w-4 shrink-0" />
                        <span className="min-w-0 flex-1 truncate">{label}</span>
                        <ChevronRight className={cn('h-3.5 w-3.5 opacity-0 transition-opacity', isActive && 'opacity-70')} />
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-sidebar-border p-3">
        <div className="mb-2 flex items-center gap-3 rounded-lg bg-muted/60 px-3 py-2.5">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
            A
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{actorLabel}</p>
            <p className="truncate text-[11px] uppercase tracking-wide text-muted-foreground">Administrador</p>
          </div>
        </div>
        <Button type="button" variant="ghost" className="w-full justify-start text-muted-foreground" onClick={() => void onSignOut()}>
          <LogOut className="h-4 w-4" />
          Cerrar sesión
        </Button>
      </div>
    </aside>
  );

  return (
    <div className="min-h-[100svh] bg-muted/35">
      <a
        href="#admin-main"
        className="fixed left-3 top-3 z-[100] -translate-y-20 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground focus:translate-y-0"
      >
        Ir al contenido
      </a>

      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={() => setMobileOpen(true)}
        className="fixed left-4 top-4 z-40 h-11 w-11 rounded-full bg-background/95 shadow-sm backdrop-blur lg:hidden"
        aria-label="Abrir navegación"
      >
        <Menu className="h-5 w-5" />
      </Button>

      {mobileOpen && (
        <button
          type="button"
          aria-label="Cerrar navegación"
          className="fixed inset-0 z-30 bg-foreground/45 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {sidebar}

      <main id="admin-main" className="min-h-[100svh] lg:pl-60">
        <div className="mx-auto w-full max-w-7xl px-4 pb-10 pt-20 sm:px-6 lg:px-8 lg:pt-8">
          {children}
        </div>
      </main>
    </div>
  );
}
