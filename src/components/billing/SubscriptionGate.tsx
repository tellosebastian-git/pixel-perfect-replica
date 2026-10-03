import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, BadgeCheck, CreditCard, Crown, Loader2, LogOut, RefreshCw, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useOrganization } from '@/contexts/OrganizationContext';
import type { BillingPlanCode, SubscriptionAccess } from '@/hooks/useSubscriptionAccess';
import { getFunctionErrorMessage } from '@/lib/functionErrors';
import { PLAN_BENEFITS, PLAN_SUMMARY } from '@/lib/planAccess';
import { supabaseUntyped } from '@/lib/supabaseUntyped';
import { cn } from '@/lib/utils';

interface SubscriptionPlan {
  code: BillingPlanCode;
  name: string;
  amount_ars: number | string;
  sort_order: number;
}

interface SubscriptionGateProps {
  access: SubscriptionAccess | null;
  onRetry: () => void;
}

const PLAN_ACCENTS: Record<BillingPlanCode, string> = {
  basico: 'border-border',
  profesional: 'border-status-info/40 bg-status-info-bg/40',
  premium: 'border-status-warning/50 bg-status-warning-bg/50',
};

function formatPrice(value: number | string) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(Number(value));
}

function gateCopy(access: SubscriptionAccess | null) {
  switch (access?.block_reason) {
    case 'trial_expired':
      return {
        title: 'Termino la prueba gratuita',
        description: 'Durante 15 dias usaste Vittro con acceso Premium. Para seguir trabajando, elegi un plan mensual.',
      };
    case 'payment_failed':
      return {
        title: 'No pudimos confirmar el pago',
        description: 'Actualiza la suscripcion para volver a entrar al sistema.',
      };
    case 'subscription_cancelled':
      return {
        title: 'La suscripcion fue cancelada',
        description: 'El periodo pago ya finalizo. Elegi un plan para reactivar el acceso.',
      };
    default:
      return {
        title: 'La suscripcion esta vencida',
        description: 'Renova el plan para volver a usar Vittro en este negocio.',
      };
  }
}

export function SubscriptionGate({ access, onRetry }: SubscriptionGateProps) {
  const { signOut, isOwner, isGeneralManager } = useAuth();
  const { organization } = useOrganization();
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const [plansError, setPlansError] = useState<string | null>(null);
  const [checkoutPlan, setCheckoutPlan] = useState<BillingPlanCode | null>(null);

  const canManageBilling = isOwner || isGeneralManager;
  const copy = gateCopy(access);
  const hasPreviousPlan = Boolean(access?.current_plan_code);

  useEffect(() => {
    let cancelled = false;

    async function fetchPlans() {
      setPlansLoading(true);
      setPlansError(null);

      try {
        const { data, error } = await supabaseUntyped
          .from<SubscriptionPlan>('subscription_plans')
          .select('code, name, amount_ars, sort_order')
          .eq('is_active', true)
          .order('sort_order', { ascending: true });

        if (error) throw error;
        if (!cancelled) setPlans((data ?? []) as SubscriptionPlan[]);
      } catch (err) {
        console.error('[subscription-gate] plans error:', err);
        if (!cancelled) setPlansError('No pudimos cargar los planes.');
      } finally {
        if (!cancelled) setPlansLoading(false);
      }
    }

    void fetchPlans();

    return () => {
      cancelled = true;
    };
  }, []);

  const currentPlanLabel = useMemo(() => {
    const code = access?.current_plan_code ?? access?.effective_plan_code;
    const plan = plans.find((item) => item.code === code);
    return plan?.name ?? code ?? null;
  }, [access?.current_plan_code, access?.effective_plan_code, plans]);

  const startCheckout = async (planCode: BillingPlanCode) => {
    if (!canManageBilling) return;

    setCheckoutPlan(planCode);
    try {
      const { data, error } = await supabase.functions.invoke('subscription-create-checkout', {
        body: { plan_code: planCode },
      });

      if (error) throw error;
      if (!data?.init_point) throw new Error('Mercado Pago no devolvio el checkout.');

      window.location.href = data.init_point;
    } catch (err) {
      console.error('[subscription-gate] checkout error:', err);
      const message = await getFunctionErrorMessage(err, 'Reintenta en unos segundos.');
      toast.error('No pudimos abrir Mercado Pago', {
        description: message,
      });
    } finally {
      setCheckoutPlan(null);
    }
  };

  return (
    <div className="min-h-screen bg-background px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-5xl flex-col justify-center gap-6">
        <div className="flex items-center justify-center rounded-lg border border-border bg-card px-4 py-3 shadow-sm">
          <div className="grid h-10 w-10 place-items-center rounded-tile bg-primary">
            <img src="/favicon.png" alt="Vittro" className="h-6 w-6 object-contain" />
          </div>
        </div>

        <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5 shadow-sm sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="max-w-2xl">
              <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-status-warning-bg text-status-warning-foreground">
                <ShieldAlert className="h-5 w-5" />
              </div>
              <h1 className="text-2xl font-semibold tracking-normal text-foreground">{copy.title}</h1>
              <p className="mt-2 max-w-[65ch] text-sm leading-6 text-muted-foreground">
                {copy.description}
              </p>
              {organization?.name && (
                <p className="mt-3 text-sm text-muted-foreground">
                  Negocio: <span className="font-medium text-foreground">{organization.name}</span>
                </p>
              )}
            </div>

            <div className="flex flex-wrap gap-2 sm:justify-end">
              <Button variant="outline" size="sm" onClick={onRetry}>
                <RefreshCw className="h-4 w-4" />
                Reintentar
              </Button>
              <Button variant="ghost" size="sm" onClick={signOut}>
                <LogOut className="h-4 w-4" />
                Cerrar sesion
              </Button>
            </div>
          </div>

          {hasPreviousPlan && currentPlanLabel && (
            <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
              Ultimo plan registrado: <span className="font-medium text-foreground">{currentPlanLabel}</span>
            </div>
          )}

          {!canManageBilling && (
            <div className="rounded-lg border border-status-info/30 bg-status-info-bg px-4 py-3 text-sm text-status-info-foreground">
              Avisale al dueño o encargado general del negocio para actualizar la suscripcion.
            </div>
          )}
        </div>

        {canManageBilling && (
          <div>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-foreground">
                  {hasPreviousPlan ? 'Renovar o cambiar plan' : 'Elegir plan'}
                </h2>
                <p className="text-sm text-muted-foreground">Precios finales mensuales en pesos argentinos.</p>
              </div>
              <Badge variant="secondary">Mercado Pago</Badge>
            </div>

            {plansLoading ? (
              <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
                Cargando planes...
              </div>
            ) : plansError ? (
              <div className="rounded-lg border border-status-error/30 bg-status-error-bg p-4 text-sm text-status-error-foreground">
                {plansError}
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-3">
                {plans.map((plan) => {
                  const isCurrent = access?.current_plan_code === plan.code;
                  const isLoading = checkoutPlan === plan.code;

                  return (
                    <Card key={plan.code} className={cn('rounded-lg shadow-sm', PLAN_ACCENTS[plan.code])}>
                      <CardHeader className="space-y-3 pb-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <CardTitle className="text-lg">{plan.name}</CardTitle>
                            <p className="mt-1 text-2xl font-semibold text-foreground">
                              {formatPrice(plan.amount_ars)}
                            </p>
                          </div>
                          {plan.code === 'premium' ? (
                            <div className="rounded-lg bg-status-warning text-white p-2">
                              <Crown className="h-4 w-4" />
                            </div>
                          ) : (
                            <div className="rounded-lg bg-primary/10 p-2 text-primary">
                              <CreditCard className="h-4 w-4" />
                            </div>
                          )}
                        </div>
                        {isCurrent && (
                          <Badge variant="outline" className="w-fit border-status-success/40 bg-status-success-bg text-status-success-foreground">
                            Plan actual
                          </Badge>
                        )}
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <p className="text-sm leading-6 text-muted-foreground">
                          {PLAN_SUMMARY[plan.code]}
                        </p>

                        <ul className="space-y-3 text-sm">
                          {PLAN_BENEFITS[plan.code].map((benefit) => (
                            <li key={benefit.title} className="flex gap-2.5">
                              <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-status-success-foreground" />
                              <span>
                                <span className="block font-medium text-foreground">{benefit.title}</span>
                                <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                                  {benefit.description}
                                </span>
                              </span>
                            </li>
                          ))}
                        </ul>
                        <Button
                          className="w-full"
                          onClick={() => startCheckout(plan.code)}
                          disabled={isLoading}
                        >
                          {isLoading ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin" />
                              Abriendo...
                            </>
                          ) : (
                            <>
                              {hasPreviousPlan ? 'Continuar con este plan' : 'Elegir plan'}
                              <ArrowRight className="h-4 w-4" />
                            </>
                          )}
                        </Button>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
