import { useFinanceDemo } from '@/contexts/FinanceDemoContext';
import { useState, useEffect, useCallback, useRef } from 'react';
import { Scissors, Lock, Loader2 } from 'lucide-react';
import { PaymentRegistration } from '@/components/PaymentRegistration';
import { ConfigurationPanel } from '@/components/ConfigurationPanel';
import { DailySummary } from '@/components/DailySummary';
import { FinanzasPanel } from '@/components/FinanzasPanel';
import { TareasPanel } from '@/components/TareasPanel';
import { MiNegocioPanel, type MiNegocioPanelHandle } from '@/components/MiNegocioPanel';
import { TurnosAgendaPanel } from '@/components/TurnosAgendaPanel';
import { ClientesPanel } from '@/components/ClientesPanel';
import { AppSidebar } from '@/components/AppSidebar';
import { PlanLockedFeature } from '@/components/billing/PlanLockedFeature';
// PinProtectedSection eliminado: el PIN solo aplica a Cuenta de sucursal vía gates de acción/vista.
import { LoadingScreen, RecoverableErrorScreen, useLoadingScreenMounted } from '@/components/LoadingScreen';
import { useSupabaseData } from '@/hooks/useSupabaseData';
import { useCobrarBarbers } from '@/hooks/useCobrarBarbers';
import { useTransactions } from '@/hooks/useTransactions';
import { useSubscriptionAccess } from '@/hooks/useSubscriptionAccess';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { getRequiredPlan, planAllowsFeature, resolveEffectivePlan } from '@/lib/planAccess';
import { useSucursal } from '@/contexts/SucursalContext';
import { useOrganization } from '@/contexts/OrganizationContext';
import { useOnboarding } from '@/components/onboarding/OnboardingProvider';
import { OnboardingOverlay } from '@/components/onboarding/OnboardingOverlay';
import { OnboardingTooltip } from '@/components/onboarding/OnboardingTooltip';
import { ResumenMensualStory } from '@/components/resumenMensual/ResumenMensualStory';
import { AvisosGlobalesProvider, useAvisoGlobal } from '@/components/avisos/AvisosGlobales';
import { AvisoSemanalTareas } from '@/components/tareas/AvisoSemanalTareas';
import { consumirDestinoTareas, useDestinoTareas } from '@/lib/tareasNavegacion';

/** El tour de onboarding es el primero de los avisos globales al entrar. */
function OnboardingEnAvisos() {
  const { avisoGlobal } = useOnboarding();
  const { abierto, cerrar } = useAvisoGlobal('onboarding', avisoGlobal);
  // Terminado o salteado, el tour deja de ocupar el lugar, sin dar paso a otro aviso en esta entrada.
  useEffect(() => { if (abierto && avisoGlobal !== 'listo') cerrar(); }, [abierto, avisoGlobal, cerrar]);
  return null;
}

const Index = () => {
  const demo = useFinanceDemo();
  const { user, canManagePayments, canOperarCajaYGastos, canManageConfig, canViewConfig, isOwner, hasNoAccess, canViewResumen, canViewTareas, canViewMiNegocio, canViewFinanzas, canViewTurnosAgenda, canViewClientes, roles, isLoading: authLoading } = useAuth();
  const { organization } = useOrganization();
  usePushNotifications(demo.active ? undefined : user?.id, demo.active ? undefined : organization?.id);
  const { access: subscriptionAccess, isLoading: subscriptionLoading } = useSubscriptionAccess();
  const onboarding = useOnboarding();
  const effectivePlan = resolveEffectivePlan(subscriptionAccess, organization?.plan);

  const rolesLoaded = roles.length > 0;

  const getDefaultTab = () => {
    if (!rolesLoaded) return 'welcome';
    if (hasNoAccess) return 'no-access';
    if (canOperarCajaYGastos) return 'registro';
    if (canViewResumen) return 'resumen';
    return 'no-access';
  };
  
  const [activeTab, setActiveTab] = useState(() => demo.active ? 'finanzas' : getDefaultTab());
  const navigateFromFinance = useCallback((action: () => void) => demo.requestExit(action), [demo.requestExit]);
  const [configInitialSection, setConfigInitialSection] = useState<'menu' | 'payments' | 'mercadopago' | 'plan' | 'pin' | 'tareas' | 'notificaciones' | 'mi-cuenta'>('menu');
  const prevActiveTabRef = useRef(activeTab);
  const miNegocioPanelRef = useRef<MiNegocioPanelHandle>(null);

  // Register tab setter so onboarding can drive navigation
  useEffect(() => {
    onboarding.registerTabSetter((t) => {
      if (t === 'finanzas') setActiveTab(t);
      else navigateFromFinance(() => setActiveTab(t));
    });
    return () => onboarding.registerTabSetter(null);
  }, [onboarding, navigateFromFinance]);

  // Intercepted tab change: blocks navigation outside of allowed tabs during onboarding
  const handleTabChange = (tab: string) => {
    if (onboarding.isActive && !onboarding.isAllowedTab(tab)) return;
    if (tab === 'finanzas') setActiveTab(tab);
    else navigateFromFinance(() => setActiveTab(tab));
  };

  // Campana o aviso semanal → Principal → Tareas con una tarea concreta: TareasPanel la busca y la abre.
  const destinoTareas = useDestinoTareas();
  useEffect(() => {
    if (!destinoTareas) return;
    if (!canViewTareas || (onboarding.isActive && !onboarding.isAllowedTab('tareas'))) { consumirDestinoTareas(); return; }
    if (activeTab !== 'tareas') handleTabChange('tareas');
    // Sin el plan, Tareas muestra el bloqueo del plan: no queda nada que abrir.
    if (!subscriptionLoading && !planAllowsFeature(effectivePlan, 'tasks')) consumirDestinoTareas();
  }, [destinoTareas]); // eslint-disable-line react-hooks/exhaustive-deps
  // null mientras no se sabe (cargos o plan): el aviso semanal espera en vez de descartarse.
  const tareasDisponible = !rolesLoaded || subscriptionLoading ? null : canViewTareas && planAllowsFeature(effectivePlan, 'tasks');
  const entradaAvisos = rolesLoaded && user?.id && organization?.id ? `${user.id}:${organization.id}` : null;

  const goToGeneralConfig = () => navigateFromFinance(() => {
    setConfigInitialSection('payments');
    setActiveTab('config');
  });

  const goToBilling = useCallback(() => navigateFromFinance(() => {
    setConfigInitialSection('plan');
    setActiveTab('config');
  }), [navigateFromFinance]);

  useEffect(() => {
    if (!rolesLoaded) {
      setActiveTab('welcome');
      return;
    }
    if (hasNoAccess) {
      setActiveTab('no-access');
      return;
    }
    // Once roles load and we're still on welcome, navigate to correct default
    if (activeTab === 'welcome') {
      if (canOperarCajaYGastos) setActiveTab('registro');
      else if (canViewResumen) setActiveTab('resumen');
      return;
    }
    if (activeTab === 'registro' && !canOperarCajaYGastos) {
      setActiveTab(canViewResumen ? 'resumen' : 'no-access');
    }
    if (activeTab === 'config' && !canViewConfig) {
      setActiveTab(canViewResumen ? 'resumen' : 'no-access');
    }
    if (activeTab === 'resumen' && !canViewResumen) {
      setActiveTab('no-access');
    }
    if (activeTab === 'tareas' && !canViewTareas) {
      setActiveTab('no-access');
    }
    if (activeTab === 'finanzas' && !canViewFinanzas) {
      setActiveTab(canViewResumen ? 'resumen' : 'no-access');
    }
    if (activeTab === 'mi-negocio' && !canViewMiNegocio) {
      setActiveTab(canViewResumen ? 'resumen' : 'no-access');
    }
    if (activeTab === 'turnos-agenda' && !canViewTurnosAgenda) {
      setActiveTab(canViewResumen ? 'resumen' : 'no-access');
    }
    if (activeTab === 'clientes' && !canViewClientes) {
      setActiveTab(canViewResumen ? 'resumen' : 'no-access');
    }
  }, [activeTab, canManagePayments, canOperarCajaYGastos, canManageConfig, canViewResumen, canViewTareas, canViewFinanzas, canViewMiNegocio, canViewTurnosAgenda, canViewClientes, hasNoAccess, rolesLoaded]);

  const {
    showBlockingLoader,
    blockingError,
    refetch: refetchData,
    services,
    extras,
    barbers,
    allBarbers,
    discounts,
    cobrarDiscounts,
    lines,
  } = useSupabaseData();

  const { addTransaction, voidTransaction, getDailySummary, selectedDate, setSelectedDate } = useTransactions();
  const { currentSucursal } = useSucursal();
  const { barbers: cobrarBarbers, isLoading: cobrarBarbersLoading, error: cobrarBarbersError, retry: retryCobrarBarbers, refetch: refetchCobrarBarbers } = useCobrarBarbers();

  const goToTeamSetup = useCallback(() => navigateFromFinance(() => {
    if (organization?.id && currentSucursal?.id) {
      const storageKey = `vittro:miNegocio:activeTab:${organization.id}`;
      try {
        localStorage.setItem(storageKey, currentSucursal.id);
      } catch {
        // Ignore storage errors.
      }
    }
    setActiveTab('mi-negocio');
  }), [navigateFromFinance, organization?.id, currentSucursal?.id]);

  const navigateToMiNegocioEquipo = useCallback((sucursalId: string, barberoId: string) => navigateFromFinance(() => {
    if (activeTab === 'mi-negocio') {
      miNegocioPanelRef.current?.navigateToSucursalEquipo(sucursalId, barberoId);
    } else {
      if (organization?.id) {
        try {
          localStorage.setItem(`vittro:miNegocio:activeTab:${organization.id}`, sucursalId);
          localStorage.setItem(`vittro:miNegocio:highlightBarbero:${organization.id}`, barberoId);
        } catch {
          // Ignore storage errors.
        }
      }
      setActiveTab('mi-negocio');
    }
  }), [navigateFromFinance, activeTab, organization?.id]);

  const navigateToMiNegocioHorarios = useCallback((sucursalId: string) => navigateFromFinance(() => {
    if (activeTab === 'mi-negocio') {
      miNegocioPanelRef.current?.navigateToSucursalHorarios(sucursalId);
    } else {
      if (organization?.id) {
        try {
          localStorage.setItem(`vittro:miNegocio:activeTab:${organization.id}`, sucursalId);
          localStorage.setItem(`vittro:miNegocio:highlightHorarios:${organization.id}`, sucursalId);
        } catch {
          // Ignore storage errors.
        }
      }
      setActiveTab('mi-negocio');
    }
  }), [navigateFromFinance, activeTab, organization?.id]);

  // Refresca datos solo cuando se entra a Cobrar desde otra pestaña.
  useEffect(() => {
    const prevTab = prevActiveTabRef.current;
    if (prevTab !== 'registro' && activeTab === 'registro') {
      void refetchData();
      void refetchCobrarBarbers();
    }
    prevActiveTabRef.current = activeTab;
  }, [activeTab, refetchData, refetchCobrarBarbers]);

  const summary = getDailySummary();
  const showLoadingScreen = useLoadingScreenMounted(showBlockingLoader);

  const displayedTab = demo.active ? 'finanzas' : activeTab;
  if (showLoadingScreen && displayedTab !== 'finanzas') {
    return (
      <LoadingScreen
        loading={showBlockingLoader}
        message="Cargando datos..."
        onRetry={refetchData}
      />
    );
  }

  if (blockingError && displayedTab !== 'finanzas') {
    return (
      <RecoverableErrorScreen
        title="No pudimos cargar los datos"
        description={blockingError}
        onRetry={refetchData}
      />
    );
  }

  return (
    <div className="h-svh overflow-hidden bg-background flex w-full">
      <AppSidebar activeTab={displayedTab} onTabChange={handleTabChange} />
      {!demo.active && (
        // Avisos al entrar: onboarding > resumen mensual > Tareas, uno solo por entrada.
        <AvisosGlobalesProvider entrada={entradaAvisos}>
          <OnboardingOverlay />
          <OnboardingTooltip />
          <OnboardingEnAvisos />
          <ResumenMensualStory />
          <AvisoSemanalTareas disponible={tareasDisponible} />
        </AvisosGlobalesProvider>
      )}

      <main className={cn("h-full min-w-0 flex-1 overflow-y-auto overflow-x-hidden")}>
        <div className={cn("mx-auto px-4 py-6 sm:px-6 md:px-8", displayedTab === 'turnos-agenda' ? "max-w-none px-4 md:px-4" : "max-w-7xl")}>
          {displayedTab === 'registro' && canOperarCajaYGastos && (
            <PaymentRegistration
              services={services}
              extras={extras}
              barbers={cobrarBarbers}
              barbersLoading={cobrarBarbersLoading}
              barbersError={cobrarBarbersError}
              onRetryBarbers={retryCobrarBarbers}
              discounts={cobrarDiscounts}
              lines={lines}
              sucursalId={currentSucursal?.id || null}
              onSubmit={addTransaction}
              onNavigateToTareas={() => handleTabChange('tareas')}
              onNavigateToTeamSetup={goToTeamSetup}
              onNavigateToBilling={goToBilling}
              canViewDailyTurnos={planAllowsFeature(effectivePlan, 'appointments')}
              currentPlan={effectivePlan}
            />
          )}

          {displayedTab === 'resumen' && canViewResumen && (
            <DailySummary 
              summary={summary} 
              barbers={barbers}
              services={services}
              lines={lines}
              selectedDate={selectedDate}
              onDateChange={setSelectedDate}
              onVoidTransaction={voidTransaction}
            />
          )}

          {displayedTab === 'finanzas' && canViewFinanzas && (
            <FinanzasPanel
              barbers={barbers}
              currentPlan={effectivePlan}
              onNavigateToBilling={goToBilling}
              onNavigateToHorarios={canViewMiNegocio ? navigateToMiNegocioHorarios : undefined}
            />
          )}

          {displayedTab === 'tareas' && canViewTareas && (
            planAllowsFeature(effectivePlan, 'tasks') ? (
              <TareasPanel barbers={allBarbers} />
            ) : (
              <PlanLockedFeature
                title="Tareas esta disponible en Premium"
                description="Organiza tareas internas, peticiones y recurrencias cuando el negocio pase al plan Premium."
                requiredPlan={getRequiredPlan('tasks')}
                currentPlan={effectivePlan}
                onManagePlan={goToBilling}
                variant="tasks"
              />
            )
          )}

          {/* Welcome / loading screen */}
          {displayedTab === 'welcome' && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-20 h-20 rounded-2xl bg-primary/10 flex items-center justify-center mb-6">
                <Scissors className="h-10 w-10 text-primary" />
              </div>
              <h1 className="text-2xl font-semibold text-foreground mb-2">Vittro</h1>
              <p className="text-muted-foreground mb-8 max-w-sm">
                Tu sistema de gestión integral para barberías
              </p>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">Preparando tu espacio de trabajo...</span>
              </div>
            </div>
          )}

          {/* Real no-access (role is 'otros') */}
          {displayedTab === 'no-access' && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <Lock className="h-16 w-16 text-muted-foreground mb-4" />
              <h2 className="text-xl font-semibold text-foreground mb-2">Sin acceso</h2>
              <p className="text-muted-foreground max-w-md">
                No tenés permisos para acceder al sistema. Contactá al dueño o encargado de tu negocio para que te asigne un cargo.
              </p>
            </div>
          )}

          {displayedTab === 'turnos-agenda' && canViewTurnosAgenda && (
            planAllowsFeature(effectivePlan, 'appointments') ? (
              <TurnosAgendaPanel onNavigateToHorarios={canViewMiNegocio ? navigateToMiNegocioHorarios : undefined} />
            ) : (
              <PlanLockedFeature
                title="Turnos requiere plan Profesional"
                description="La agenda, la disponibilidad y los bloqueos se habilitan desde el plan Profesional."
                requiredPlan={getRequiredPlan('appointments')}
                currentPlan={effectivePlan}
                onManagePlan={goToBilling}
                variant="agenda"
              />
            )
          )}

          {displayedTab === 'clientes' && canViewClientes && (
            planAllowsFeature(effectivePlan, 'clients') ? (
              <ClientesPanel />
            ) : (
              <PlanLockedFeature
                title="Clientes requiere plan Profesional"
                description="Activa el plan Profesional para gestionar la base de clientes y su historial."
                requiredPlan={getRequiredPlan('clients')}
                currentPlan={effectivePlan}
                onManagePlan={goToBilling}
                variant="clients"
              />
            )
          )}

          {displayedTab === 'mi-negocio' && canViewMiNegocio && (
            <MiNegocioPanel
              ref={miNegocioPanelRef}
              onGoToGeneralConfig={canManageConfig ? goToGeneralConfig : undefined}
              onNavigateToMiNegocio={navigateToMiNegocioEquipo}
            />
          )}

          {displayedTab === 'config' && canViewConfig && (
            <ConfigurationPanel
              initialSection={configInitialSection}
              onSectionChange={setConfigInitialSection}
            />
          )}
        </div>
      </main>
    </div>
  );
};

export default Index;
