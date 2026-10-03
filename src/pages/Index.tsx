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
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import { getRequiredPlan, planAllowsFeature, resolveEffectivePlan } from '@/lib/planAccess';
import { useSucursal } from '@/contexts/SucursalContext';
import { useOrganization } from '@/contexts/OrganizationContext';
import { useOnboarding } from '@/components/onboarding/OnboardingProvider';
import { OnboardingOverlay } from '@/components/onboarding/OnboardingOverlay';
import { OnboardingTooltip } from '@/components/onboarding/OnboardingTooltip';
import { ResumenMensualStory } from '@/components/resumenMensual/ResumenMensualStory';

const Index = () => {
  const isMobile = useIsMobile();
  const { user, canManagePayments, canOperarCajaYGastos, canManageConfig, canViewConfig, isOwner, hasNoAccess, canViewResumen, canViewTareas, canViewMiNegocio, canViewFinanzas, canViewTurnosAgenda, canViewClientes, roles, isLoading: authLoading } = useAuth();
  const { organization } = useOrganization();
  usePushNotifications(user?.id, organization?.id);
  const { access: subscriptionAccess } = useSubscriptionAccess();
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
  
  const [activeTab, setActiveTab] = useState(getDefaultTab);
  const [configInitialSection, setConfigInitialSection] = useState<'menu' | 'payments' | 'mercadopago' | 'plan' | 'pin' | 'tareas' | 'notificaciones' | 'mi-cuenta'>('menu');
  const prevActiveTabRef = useRef(activeTab);
  const miNegocioPanelRef = useRef<MiNegocioPanelHandle>(null);

  // Register tab setter so onboarding can drive navigation
  useEffect(() => {
    onboarding.registerTabSetter((t) => setActiveTab(t));
    return () => onboarding.registerTabSetter(null);
  }, [onboarding]);

  // Intercepted tab change: blocks navigation outside of allowed tabs during onboarding
  const handleTabChange = (tab: string) => {
    if (onboarding.isActive && !onboarding.isAllowedTab(tab)) return;
    setActiveTab(tab);
  };

  const goToGeneralConfig = () => {
    setConfigInitialSection('payments');
    setActiveTab('config');
  };

  const goToBilling = useCallback(() => {
    setConfigInitialSection('plan');
    setActiveTab('config');
  }, []);

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

  const goToTeamSetup = useCallback(() => {
    if (organization?.id && currentSucursal?.id) {
      const storageKey = `vittro:miNegocio:activeTab:${organization.id}`;
      try {
        localStorage.setItem(storageKey, currentSucursal.id);
      } catch {
        // Ignore storage errors.
      }
    }
    setActiveTab('mi-negocio');
  }, [organization?.id, currentSucursal?.id]);

  const navigateToMiNegocioEquipo = useCallback((sucursalId: string, barberoId: string) => {
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
  }, [activeTab, organization?.id]);

  const navigateToMiNegocioHorarios = useCallback((sucursalId: string) => {
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
  }, [activeTab, organization?.id]);

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

  if (showLoadingScreen) {
    return (
      <LoadingScreen
        loading={showBlockingLoader}
        message="Cargando datos..."
        onRetry={refetchData}
      />
    );
  }

  if (blockingError) {
    return (
      <RecoverableErrorScreen
        title="No pudimos cargar los datos"
        description={blockingError}
        onRetry={refetchData}
      />
    );
  }

  return (
    <div className="h-screen overflow-hidden bg-background flex w-full">
      <AppSidebar activeTab={activeTab} onTabChange={handleTabChange} />
      <OnboardingOverlay />
      <OnboardingTooltip />
      <ResumenMensualStory />

      <main className={cn("h-full min-w-0 flex-1 overflow-y-auto overflow-x-hidden")}>
        <div className={cn("mx-auto px-4 py-6 sm:px-6 md:px-8", activeTab === 'turnos-agenda' ? "max-w-none px-4 md:px-4" : "max-w-7xl")}>
          {activeTab === 'registro' && canOperarCajaYGastos && (
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
              onNavigateToTareas={() => setActiveTab('tareas')}
              onNavigateToTeamSetup={goToTeamSetup}
              onNavigateToBilling={goToBilling}
              canViewDailyTurnos={planAllowsFeature(effectivePlan, 'appointments')}
              currentPlan={effectivePlan}
            />
          )}

          {activeTab === 'resumen' && canViewResumen && (
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

          {activeTab === 'finanzas' && canViewFinanzas && (
            <FinanzasPanel
              barbers={barbers}
              currentPlan={effectivePlan}
              onNavigateToBilling={goToBilling}
              onNavigateToHorarios={canViewMiNegocio ? navigateToMiNegocioHorarios : undefined}
            />
          )}

          {activeTab === 'tareas' && canViewTareas && (
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
          {activeTab === 'welcome' && (
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
          {activeTab === 'no-access' && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <Lock className="h-16 w-16 text-muted-foreground mb-4" />
              <h2 className="text-xl font-semibold text-foreground mb-2">Sin acceso</h2>
              <p className="text-muted-foreground max-w-md">
                No tenés permisos para acceder al sistema. Contactá al dueño o encargado de tu negocio para que te asigne un cargo.
              </p>
            </div>
          )}

          {activeTab === 'turnos-agenda' && canViewTurnosAgenda && (
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

          {activeTab === 'clientes' && canViewClientes && (
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

          {activeTab === 'mi-negocio' && canViewMiNegocio && (
            <MiNegocioPanel
              ref={miNegocioPanelRef}
              onGoToGeneralConfig={canManageConfig ? goToGeneralConfig : undefined}
              onNavigateToMiNegocio={navigateToMiNegocioEquipo}
            />
          )}

          {activeTab === 'config' && canViewConfig && (
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
