import { Receipt, TrendingUp, Landmark, BarChart3, Wallet, Lock } from 'lucide-react';
import { GastosPanel } from '@/components/GastosPanel';
import { InversionesPanel } from '@/components/InversionesPanel';
import { DeudasPanel } from '@/components/DeudasPanel';
import { EstadisticasPanel } from '@/components/EstadisticasPanel';
import { SueldosPanel } from '@/components/SueldosPanel';
import { PlanLockedFeature } from '@/components/billing/PlanLockedFeature';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/ui/PageHeader';
import { useAuth } from '@/contexts/AuthContext';
import type { BillingPlanCode } from '@/hooks/useSubscriptionAccess';
import { getRequiredPlan, planAllowsFeature, PLAN_LABELS, type PlanFeatureKey } from '@/lib/planAccess';
import type { Barber } from '@/types/barbershop';

interface FinanzasPanelProps {
  barbers: Barber[];
  currentPlan: BillingPlanCode;
  onNavigateToBilling: () => void;
  /** Deep-link a Mi Negocio → ficha de sucursal → card de Horarios, para el estado vacío de
   * Ocupación en Estadísticas. */
  onNavigateToHorarios?: (sucursalId: string) => void;
}

interface LockedFinanceProps {
  feature: PlanFeatureKey;
  title: string;
  description: string;
  currentPlan: BillingPlanCode;
  onNavigateToBilling: () => void;
  variant?: 'analytics' | 'finance';
}

function LockedTabMarker({ feature }: { feature: PlanFeatureKey }) {
  const requiredPlan = getRequiredPlan(feature);

  return (
    <span
      title={`Requiere plan ${PLAN_LABELS[requiredPlan]}`}
      className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-status-warning-bg text-status-warning-foreground"
    >
      <Lock className="h-3 w-3" />
    </span>
  );
}

function LockedFinance({
  feature,
  title,
  description,
  currentPlan,
  onNavigateToBilling,
  variant = 'finance',
}: LockedFinanceProps) {
  return (
    <PlanLockedFeature
      title={title}
      description={description}
      requiredPlan={getRequiredPlan(feature)}
      currentPlan={currentPlan}
      onManagePlan={onNavigateToBilling}
      variant={variant}
    />
  );
}

export function FinanzasPanel({ barbers, currentPlan, onNavigateToBilling, onNavigateToHorarios }: FinanzasPanelProps) {
  const { isSucursalAccount } = useAuth();

  const canUseStatistics = planAllowsFeature(currentPlan, 'finance.statistics');
  const canUseSalaries = planAllowsFeature(currentPlan, 'finance.salaries');
  const canUseExpenses = planAllowsFeature(currentPlan, 'finance.expenses');
  const canUseInvestments = planAllowsFeature(currentPlan, 'finance.investments');
  const canUseDebts = planAllowsFeature(currentPlan, 'finance.debts');

  const defaultTab = isSucursalAccount
    ? 'sueldos'
    : canUseStatistics
      ? 'estadisticas'
      : canUseSalaries
        ? 'sueldos'
        : 'estadisticas';

  if (isSucursalAccount) {
    return (
      <div className="animate-fade-in">
        <PageHeader title="Finanzas" icon={Wallet} subtitle="Gestioná ingresos, gastos, sueldos e inversiones del negocio." />
        <Tabs defaultValue={defaultTab}>
          <TabsList variant="underline" className="mb-6 flex-wrap">
            <TabsTrigger value="sueldos" variant="underline">
              <Wallet className="h-4 w-4" />
              Sueldos
              {!canUseSalaries && <LockedTabMarker feature="finance.salaries" />}
            </TabsTrigger>
            <TabsTrigger value="gastos" variant="underline">
              <Receipt className="h-4 w-4" />
              Gastos
              {!canUseExpenses && <LockedTabMarker feature="finance.expenses" />}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="sueldos">
            {canUseSalaries ? (
              <SueldosPanel barbers={barbers} />
            ) : (
              <LockedFinance
                feature="finance.salaries"
                title="Sueldos requiere plan Profesional"
                description="Amplia al plan Profesional para consultar y registrar sueldos del equipo."
                currentPlan={currentPlan}
                onNavigateToBilling={onNavigateToBilling}
              />
            )}
          </TabsContent>
          <TabsContent value="gastos">
            {canUseExpenses ? (
              <GastosPanel />
            ) : (
              <LockedFinance
                feature="finance.expenses"
                title="Gastos esta disponible en Premium"
                description="Controla gastos fijos, variables y recurrentes con el plan Premium."
                currentPlan={currentPlan}
                onNavigateToBilling={onNavigateToBilling}
              />
            )}
          </TabsContent>
        </Tabs>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <PageHeader title="Finanzas" icon={Wallet} subtitle="Gestioná ingresos, gastos, sueldos e inversiones del negocio." />
      <Tabs defaultValue={defaultTab}>
        <TabsList variant="underline" className="mb-6 flex-wrap">
          <TabsTrigger value="estadisticas" variant="underline">
            <BarChart3 className="h-4 w-4" />
            Estadisticas
            {!canUseStatistics && <LockedTabMarker feature="finance.statistics" />}
          </TabsTrigger>
          <TabsTrigger value="sueldos" variant="underline">
            <Wallet className="h-4 w-4" />
            Sueldos
            {!canUseSalaries && <LockedTabMarker feature="finance.salaries" />}
          </TabsTrigger>
          <TabsTrigger value="gastos" variant="underline">
            <Receipt className="h-4 w-4" />
            Gastos
            {!canUseExpenses && <LockedTabMarker feature="finance.expenses" />}
          </TabsTrigger>
          <TabsTrigger value="inversiones" variant="underline">
            <TrendingUp className="h-4 w-4" />
            Inversiones
            {!canUseInvestments && <LockedTabMarker feature="finance.investments" />}
          </TabsTrigger>
          <TabsTrigger value="deudas" variant="underline">
            <Landmark className="h-4 w-4" />
            Deudas
            {!canUseDebts && <LockedTabMarker feature="finance.debts" />}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="estadisticas">
          {canUseStatistics ? (
            <EstadisticasPanel onNavigateToHorarios={onNavigateToHorarios} />
          ) : (
            <LockedFinance
              feature="finance.statistics"
              title="Estadisticas esta disponible en Premium"
              description="Mira facturacion, servicios, ticket promedio y rendimiento mensual con el plan Premium."
              currentPlan={currentPlan}
              onNavigateToBilling={onNavigateToBilling}
              variant="analytics"
            />
          )}
        </TabsContent>
        <TabsContent value="sueldos">
          {canUseSalaries ? (
            <SueldosPanel barbers={barbers} />
          ) : (
            <LockedFinance
              feature="finance.salaries"
              title="Sueldos requiere plan Profesional"
              description="Amplia al plan Profesional para consultar y registrar sueldos del equipo."
              currentPlan={currentPlan}
              onNavigateToBilling={onNavigateToBilling}
            />
          )}
        </TabsContent>
        <TabsContent value="gastos">
          {canUseExpenses ? (
            <GastosPanel />
          ) : (
            <LockedFinance
              feature="finance.expenses"
              title="Gastos esta disponible en Premium"
              description="Controla gastos fijos, variables y recurrentes con el plan Premium."
              currentPlan={currentPlan}
              onNavigateToBilling={onNavigateToBilling}
            />
          )}
        </TabsContent>
        <TabsContent value="inversiones">
          {canUseInvestments ? (
            <InversionesPanel />
          ) : (
            <LockedFinance
              feature="finance.investments"
              title="Inversiones esta disponible en Premium"
              description="Registra inversiones del negocio y vincula su seguimiento con el plan Premium."
              currentPlan={currentPlan}
              onNavigateToBilling={onNavigateToBilling}
            />
          )}
        </TabsContent>
        <TabsContent value="deudas">
          {canUseDebts ? (
            <DeudasPanel />
          ) : (
            <LockedFinance
              feature="finance.debts"
              title="Deudas esta disponible en Premium"
              description="Gestiona deudas, pagos pendientes y relaciones con inversiones desde Premium."
              currentPlan={currentPlan}
              onNavigateToBilling={onNavigateToBilling}
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
