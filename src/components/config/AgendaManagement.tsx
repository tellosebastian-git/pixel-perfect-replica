import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Calendar, Settings, Globe, SlidersHorizontal } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { AgendaConfigSection } from './AgendaConfigSection';
import { BloqueosSection } from './BloqueosSection';
import { HorariosAccesoDirectoCard } from './HorariosAccesoDirectoCard';
import { PortalPublicoSection } from './PortalPublicoSection';
import { AgendaPanel } from '@/components/agenda/AgendaPanel';
import { Barber } from '@/types/barbershop';
import { useSucursal } from '@/contexts/SucursalContext';
import { useAuth } from '@/contexts/AuthContext';

interface AgendaManagementProps {
  sucursalId: string;
  organizationId: string;
  barbers: Barber[];
  /** Lleva a Mi Negocio › ficha de sucursal › Horarios de atención. */
  onNavigateToHorarios?: (sucursalId: string) => void;
  /** Refleja tabActiva hacia TurnosAgendaPanel.tsx: el título del PageHeader
      superior ("Turnos" / "Configuración") lo sigue sin necesidad de levantar
      el estado acá — mismo protocolo que onDirtyChange más abajo. */
  onTabChange?: (tab: AgendaTab) => void;
}

export type AgendaTab = 'agenda' | 'config';
type ConfigTab = 'portal' | 'reservas';

function readStoredTab<T extends string>(key: string, fallback: T): T {
  try {
    return (localStorage.getItem(key) as T) || fallback;
  } catch {
    return fallback;
  }
}

function writeStoredTab(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Ignore storage errors.
  }
}

export function AgendaManagement({ sucursalId, organizationId, barbers, onNavigateToHorarios, onTabChange }: AgendaManagementProps) {
  const { sucursales } = useSucursal();
  const sucursal = sucursales.find(s => s.id === sucursalId);
  const { isOwner, isGeneralManager, isManager } = useAuth();
  const canManageAgendaConfig = isOwner || isGeneralManager || isManager;
  // El portal escribe en organizations, cuya RLS solo admite owner y GM.
  const canManagePortal = isOwner || isGeneralManager;

  const agendaTabKey = `vittro:agenda:activeTab:${organizationId}:${sucursalId}`;
  const configTabKey = `vittro:agenda:configTab:${organizationId}:${sucursalId}`;

  const [tabActiva, setTabActiva] = useState<AgendaTab>(() => readStoredTab<AgendaTab>(agendaTabKey, 'agenda'));
  const [configTab, setConfigTab] = useState<ConfigTab>(() => {
    const stored = readStoredTab<ConfigTab>(configTabKey, 'reservas');
    return stored === 'portal' && !canManagePortal ? 'reservas' : stored;
  });

  const agendaTriggerRef = useRef<HTMLButtonElement>(null);
  // Al volver con la flecha, el botón se desmonta en el mismo click y el foco
  // se perdería: lo devolvemos al trigger "Agenda", que es donde quedó parado
  // el usuario. Solo cuando el cambio vino de la flecha, no de un click al tab.
  const focusAgendaTrigger = useRef(false);

  const goToTab = (next: AgendaTab) => {
    setTabActiva(next);
    writeStoredTab(agendaTabKey, next);
  };

  // PortalPublicoSection y AgendaConfigSection reportan si tienen cambios sin
  // guardar (mismo protocolo onDirtyChange en las dos). Cualquier navegación
  // que las desmonte (sub-tabs de Configuración, tabs de nivel superior, o la
  // flecha "Volver a Agenda") pasa por este guard — si hay cambios pendientes
  // en la sub-tab activa, pide confirmación antes de perderlos.
  const [portalDirty, setPortalDirty] = useState(false);
  const [reservasDirty, setReservasDirty] = useState(false);
  const [pendingLeaveConfig, setPendingLeaveConfig] = useState<(() => void) | null>(null);

  const guardLeaveConfig = (action: () => void) => {
    const dirty = (configTab === 'portal' && portalDirty) || (configTab === 'reservas' && reservasDirty);
    if (dirty) {
      setPendingLeaveConfig(() => action);
      return;
    }
    action();
  };

  useEffect(() => {
    if (tabActiva === 'agenda' && focusAgendaTrigger.current) {
      focusAgendaTrigger.current = false;
      agendaTriggerRef.current?.focus();
    }
  }, [tabActiva]);

  // Se dispara también en el primer render (con el valor leído de
  // localStorage) y de nuevo cada vez que la sucursal activa remonta este
  // componente (key={activeSucursal.id} en TurnosAgendaPanel.tsx), para que
  // el título superior siempre refleje la pestaña de la sucursal vigente.
  useEffect(() => {
    onTabChange?.(tabActiva);
  }, [tabActiva, onTabChange]);

  // Los roles pueden resolverse después del primer render: si para entonces
  // el usuario no puede ver el portal, lo devolvemos a reservas. No se
  // reescribe el storage para no pisar la preferencia de un owner.
  useEffect(() => {
    if (!canManagePortal && configTab === 'portal') {
      setConfigTab('reservas');
    }
  }, [canManagePortal, configTab]);

  if (!canManageAgendaConfig) {
    return (
      <div className="mt-2">
        <AgendaPanel
          sucursalId={sucursalId}
          organizationId={organizationId}
          sucursalTimezone={sucursal?.timezone}
          barbers={barbers}
        />
      </div>
    );
  }

  const reservasContent = (
    <>
      <AgendaConfigSection
        sucursalId={sucursalId}
        organizationId={organizationId}
        onDirtyChange={setReservasDirty}
      />
      <HorariosAccesoDirectoCard
        onGoToHorarios={onNavigateToHorarios ? () => onNavigateToHorarios(sucursalId) : undefined}
      />
      <BloqueosSection sucursalId={sucursalId} organizationId={organizationId} barbers={barbers} />
    </>
  );

  // La flecha vive fuera del TabsList a propósito: el List es role="tablist"
  // con roving focus de Radix, y un botón que no es tab ahí adentro rompe la
  // navegación con flechas del teclado.
  const volverAAgenda = (
    <button
      type="button"
      onClick={() => guardLeaveConfig(() => {
        focusAgendaTrigger.current = true;
        goToTab('agenda');
      })}
      aria-label="Volver a Agenda"
      title="Volver a Agenda"
      className="shrink-0 px-1 pb-3 text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ArrowLeft className="h-4 w-4" />
    </button>
  );

  return (
    <div className="w-full mt-2 space-y-4">
      <Tabs value={tabActiva} onValueChange={(v) => guardLeaveConfig(() => goToTab(v as AgendaTab))}>
        {/* Una sola fila de navegación: en Agenda son los dos tabs de nivel
            superior; dentro de Configuración la reemplaza la fila de la sección
            (flecha para volver + sub-tabs). */}
        {tabActiva === 'agenda' && (
          <TabsList variant="underline" className="w-auto">
            <TabsTrigger ref={agendaTriggerRef} value="agenda" variant="underline" className="text-[13px]">
              <Calendar className="h-4 w-4" />
              Agenda
            </TabsTrigger>
            <TabsTrigger value="config" variant="underline" className="text-[13px]">
              <Settings className="h-4 w-4" />
              Configuración
            </TabsTrigger>
          </TabsList>
        )}

        <TabsContent value="agenda" className="mt-3">
          <AgendaPanel
            sucursalId={sucursalId}
            organizationId={organizationId}
            sucursalTimezone={sucursal?.timezone}
            barbers={barbers}
          />
        </TabsContent>

        {/* mt-0: la fila de Configuración tiene que caer en la misma altura que
            la de Agenda, si no la barra salta al navegar entre las dos. */}
        <TabsContent value="config" className="mt-0">
          {canManagePortal ? (
            <Tabs
              value={configTab}
              onValueChange={(v) => {
                const next = v as ConfigTab;
                guardLeaveConfig(() => {
                  setConfigTab(next);
                  writeStoredTab(configTabKey, next);
                });
              }}
            >
              {/* La hairline sube al wrapper para que corra continua bajo la
                  flecha y bajo los tabs; w-fit conserva el ancho ajustado al
                  contenido que ya tenía el TabsList. */}
              <div className="flex w-fit items-end gap-4 border-b border-border">
                {volverAAgenda}
                <TabsList variant="underline" className="w-auto border-b-0">
                  <TabsTrigger value="reservas" variant="underline" className="text-[13px]">
                    <SlidersHorizontal className="h-4 w-4" />
                    Configuración de reservas
                  </TabsTrigger>
                  <TabsTrigger value="portal" variant="underline" className="text-[13px]">
                    <Globe className="h-4 w-4" />
                    Portal público
                  </TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="reservas" className="mt-3 space-y-6">
                {reservasContent}
              </TabsContent>

              <TabsContent value="portal" className="mt-3">
                <PortalPublicoSection onDirtyChange={setPortalDirty} />
              </TabsContent>
            </Tabs>
          ) : (
            /* Sin acceso al portal queda una sola sección: la flecha se mantiene
               en la misma posición, sin una barra de tabs de un solo ítem. Va
               sin hairline porque el riel es el subrayado de los tabs y acá no
               hay tabs — una línea de 24px bajo la flecha leería como un error. */
            <>
              <div className="flex w-fit items-end">{volverAAgenda}</div>
              <div className="mt-3 space-y-6">{reservasContent}</div>
            </>
          )}
        </TabsContent>
      </Tabs>

      <AlertDialog open={!!pendingLeaveConfig} onOpenChange={(open) => { if (!open) setPendingLeaveConfig(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Descartar cambios?</AlertDialogTitle>
            <AlertDialogDescription>
              Tenés cambios sin guardar en este formulario. Si cerrás ahora, se van a perder.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Seguir editando</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                pendingLeaveConfig?.();
                setPendingLeaveConfig(null);
              }}
            >
              Descartar cambios
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
