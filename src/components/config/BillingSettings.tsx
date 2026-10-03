import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, BadgeCheck, CalendarClock, CreditCard, Crown, Loader2, RefreshCw, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useDelayedVisible } from '@/hooks/useDelayedVisible';
import { Separator } from '@/components/ui/separator';
import { supabase } from '@/integrations/supabase/client';
import { useSubscriptionAccess, type BillingPlanCode } from '@/hooks/useSubscriptionAccess';
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

interface SubscriptionPayment {
  id: string;
  plan_code: BillingPlanCode | null;
  amount_ars: number | string;
  status: string;
  paid_at: string | null;
  created_at: string;
}

const STATUS_LABELS: Record<string, string> = {
  trialing: 'Prueba gratuita',
  active: 'Activa',
  past_due: 'Pago pendiente',
  cancelled: 'Cancelada',
  expired: 'Vencida',
};

const STATUS_CLASS: Record<string, string> = {
  trialing: 'border-status-info/40 bg-status-info-bg text-status-info-foreground',
  active: 'border-status-success/40 bg-status-success-bg text-status-success-foreground',
  past_due: 'border-status-warning/40 bg-status-warning-bg text-status-warning-foreground',
  cancelled: 'border-border bg-muted text-muted-foreground',
  expired: 'border-status-error/40 bg-status-error-bg text-status-error-foreground',
};

const PLAN_ACCENTS: Record<BillingPlanCode, string> = {
  basico: 'border-border',
  profesional: 'border-status-info/40 bg-status-info-bg/30',
  premium: 'border-status-warning/50 bg-status-warning-bg/40',
};

function formatPrice(value: number | string) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(Number(value));
}

function formatDate(value: string | null | undefined) {
  if (!value) return 'Sin fecha';

  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}

function planRank(plan: SubscriptionPlan | undefined) {
  return plan?.sort_order ?? 0;
}

export function BillingSettings() {
  const { access, isLoading, error, refreshAccess } = useSubscriptionAccess();
  const showSkeleton = useDelayedVisible(isLoading);
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [payments, setPayments] = useState<SubscriptionPayment[]>([]);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchBillingData() {
      const [plansRes, paymentsRes] = await Promise.all([
        supabaseUntyped
          .from<SubscriptionPlan>('subscription_plans')
          .select('code, name, amount_ars, sort_order')
          .eq('is_active', true)
          .order('sort_order', { ascending: true }),
        supabaseUntyped
          .from<SubscriptionPayment>('subscription_payments')
          .select('id, plan_code, amount_ars, status, paid_at, created_at')
          .order('created_at', { ascending: false })
          .limit(5),
      ]);

      if (!cancelled) {
        if (!plansRes.error) setPlans((plansRes.data ?? []) as SubscriptionPlan[]);
        if (!paymentsRes.error) setPayments((paymentsRes.data ?? []) as SubscriptionPayment[]);
      }
    }

    void fetchBillingData();

    return () => {
      cancelled = true;
    };
  }, []);

  const currentPlan = useMemo(() => {
    const code = access?.current_plan_code ?? access?.effective_plan_code;
    return plans.find((plan) => plan.code === code);
  }, [access?.current_plan_code, access?.effective_plan_code, plans]);

  const effectivePlan = useMemo(
    () => plans.find((plan) => plan.code === access?.effective_plan_code),
    [access?.effective_plan_code, plans],
  );

  const pendingPlan = useMemo(
    () => plans.find((plan) => plan.code === access?.pending_plan_code),
    [access?.pending_plan_code, plans],
  );

  const startCheckout = async (planCode: BillingPlanCode) => {
    setBusyAction(`checkout:${planCode}`);
    try {
      const { data, error: checkoutError } = await supabase.functions.invoke('subscription-create-checkout', {
        body: { plan_code: planCode },
      });

      if (checkoutError) throw checkoutError;
      if (!data?.init_point) throw new Error('Mercado Pago no devolvio el checkout.');

      window.location.href = data.init_point;
    } catch (err) {
      console.error('[billing-settings] checkout error:', err);
      const message = await getFunctionErrorMessage(err, 'Reintenta en unos segundos.');
      toast.error('No pudimos abrir Mercado Pago', {
        description: message,
      });
    } finally {
      setBusyAction(null);
    }
  };

  const changePlan = async (planCode: BillingPlanCode) => {
    setBusyAction(`change:${planCode}`);
    try {
      const { data, error: changeError } = await supabase.functions.invoke('subscription-change-plan', {
        body: { plan_code: planCode },
      });

      if (changeError) throw changeError;

      if (data?.requires_checkout) {
        await startCheckout(planCode);
        return;
      }

      toast.success(data?.change_type === 'downgrade' ? 'Cambio programado' : 'Plan actualizado');
      await refreshAccess();
    } catch (err) {
      console.error('[billing-settings] change plan error:', err);
      const message = await getFunctionErrorMessage(err, 'Reintenta en unos segundos.');
      toast.error('No pudimos cambiar el plan', {
        description: message,
      });
    } finally {
      setBusyAction(null);
    }
  };

  const cancelSubscription = async () => {
    setBusyAction('cancel');
    try {
      const { error: cancelError } = await supabase.functions.invoke('subscription-cancel');
      if (cancelError) throw cancelError;

      toast.success('Suscripcion cancelada', {
        description: 'El acceso se mantiene hasta el fin del periodo pago.',
      });
      await refreshAccess();
    } catch (err) {
      console.error('[billing-settings] cancel error:', err);
      const message = await getFunctionErrorMessage(err, 'Reintenta en unos segundos.');
      toast.error('No pudimos cancelar la suscripcion', {
        description: message,
      });
    } finally {
      setBusyAction(null);
    }
  };

  const reactivateSubscription = async () => {
    setBusyAction('reactivate');
    try {
      const { data, error: reactivateError } = await supabase.functions.invoke('subscription-reactivate');
      if (reactivateError) throw reactivateError;

      if (data?.requires_checkout) {
        const planCode = (data.plan_code ?? access?.current_plan_code ?? 'basico') as BillingPlanCode;
        await startCheckout(planCode);
        return;
      }

      toast.success('Suscripcion reactivada');
      await refreshAccess();
    } catch (err) {
      console.error('[billing-settings] reactivate error:', err);
      const message = await getFunctionErrorMessage(err, 'Reintenta en unos segundos.');
      toast.error('No pudimos reactivar la suscripcion', {
        description: message,
      });
    } finally {
      setBusyAction(null);
    }
  };

  if (isLoading) {
    if (!showSkeleton) return null;
    return (
      <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-3">
            <Skeleton className="h-5 w-24 rounded-full" />
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-72 max-w-full" />
          </div>
          <Skeleton className="h-9 w-28 shrink-0" />
        </div>
      </div>
    );
  }

  if (error || !access) {
    return (
      <div className="rounded-lg border border-status-error/30 bg-status-error-bg p-4 text-sm text-status-error-foreground">
        {error ?? 'No pudimos cargar la suscripcion.'}
      </div>
    );
  }

  const isTrial = access.status === 'trialing';
  const canCancel = access.status === 'active' && !access.cancel_at_period_end;
  const canReactivate = access.status === 'cancelled' && access.cancel_at_period_end;

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={cn('w-fit', STATUS_CLASS[access.status])}>
                {STATUS_LABELS[access.status] ?? access.status}
              </Badge>
              {access.cancel_at_period_end && (
                <Badge variant="outline" className="border-status-warning/40 bg-status-warning-bg text-status-warning-foreground">
                  No renueva automaticamente
                </Badge>
              )}
            </div>
            <h2 className="text-xl font-semibold text-foreground">
              {isTrial ? 'Estas usando Premium gratis' : `Plan ${effectivePlan?.name ?? access.effective_plan_code}`}
            </h2>
            <p className="mt-2 max-w-[65ch] text-sm leading-6 text-muted-foreground">
              {isTrial
                ? 'La prueba dura 15 dias desde el inicio del onboarding. Al finalizar, hay que elegir un plan para seguir usando la app.'
                : 'La suscripcion habilita a todos los usuarios del negocio.'}
            </p>
          </div>

          <Button variant="outline" size="sm" onClick={refreshAccess}>
            <RefreshCw className="h-4 w-4" />
            Actualizar
          </Button>
        </div>

        <Separator className="my-5" />

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg bg-muted/50 p-3">
            <p className="text-xs font-medium text-muted-foreground">Acceso hasta</p>
            <p className="mt-1 text-sm font-semibold text-foreground">{formatDate(access.access_ends_at)}</p>
          </div>
          <div className="rounded-lg bg-muted/50 p-3">
            <p className="text-xs font-medium text-muted-foreground">Dias restantes</p>
            <p className="mt-1 text-sm font-semibold text-foreground">
              {access.days_until_access_ends ?? 0}
            </p>
          </div>
          <div className="rounded-lg bg-muted/50 p-3">
            <p className="text-xs font-medium text-muted-foreground">Plan pendiente</p>
            <p className="mt-1 text-sm font-semibold text-foreground">
              {pendingPlan ? pendingPlan.name : 'Sin cambios'}
            </p>
          </div>
        </div>

        {(canCancel || canReactivate) && (
          <div className="mt-5 flex flex-wrap gap-2">
            {canCancel && (
              <Button
                variant="outline"
                onClick={cancelSubscription}
                disabled={busyAction === 'cancel'}
              >
                {busyAction === 'cancel' ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                Cancelar renovacion
              </Button>
            )}
            {canReactivate && (
              <Button
                onClick={reactivateSubscription}
                disabled={busyAction === 'reactivate'}
              >
                {busyAction === 'reactivate' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Reactivar suscripcion
              </Button>
            )}
          </div>
        )}
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-foreground">Planes mensuales</h2>
            <p className="text-sm text-muted-foreground">Precios finales en pesos argentinos.</p>
          </div>
          <Badge variant="secondary">Mercado Pago</Badge>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          {plans.map((plan) => {
            const isCurrent = currentPlan?.code === plan.code && access.status === 'active';
            const isEffective = effectivePlan?.code === plan.code;
            const isUpgrade = planRank(plan) > planRank(effectivePlan);
            const actionKey = access.status === 'active' ? `change:${plan.code}` : `checkout:${plan.code}`;
            const isBusy = busyAction === actionKey;

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
                      <div className="rounded-lg bg-status-warning p-2 text-white">
                        <Crown className="h-4 w-4" />
                      </div>
                    ) : (
                      <div className="rounded-lg bg-primary/10 p-2 text-primary">
                        <CreditCard className="h-4 w-4" />
                      </div>
                    )}
                  </div>
                  {isEffective && (
                    <Badge variant="outline" className="w-fit border-status-success/40 bg-status-success-bg text-status-success-foreground">
                      {isTrial ? 'Plan de prueba' : 'Plan actual'}
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
                    variant={isCurrent ? 'outline' : 'default'}
                    disabled={isBusy || (isCurrent && !pendingPlan)}
                    onClick={() => {
                      if (access.status === 'active') {
                        void changePlan(plan.code);
                      } else {
                        void startCheckout(plan.code);
                      }
                    }}
                  >
                    {isBusy ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Procesando...
                      </>
                    ) : isCurrent ? (
                      'Plan actual'
                    ) : access.status === 'active' ? (
                      <>
                        {isUpgrade ? 'Subir de plan' : 'Bajar de plan'}
                        <ArrowRight className="h-4 w-4" />
                      </>
                    ) : (
                      <>
                        Elegir plan
                        <ArrowRight className="h-4 w-4" />
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-5">
        <div className="mb-4 flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-base font-semibold text-foreground">Ultimos pagos</h2>
        </div>

        {payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavia no hay pagos registrados.</p>
        ) : (
          <div className="divide-y divide-border">
            {payments.map((payment) => (
              <div key={payment.id} className="flex items-center justify-between gap-4 py-3 text-sm">
                <div>
                  <p className="font-medium text-foreground">
                    {payment.plan_code ?? 'Plan'} · {formatPrice(payment.amount_ars)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(payment.paid_at ?? payment.created_at)}
                  </p>
                </div>
                <Badge variant="outline" className={cn('capitalize', STATUS_CLASS[payment.status] ?? 'border-border')}>
                  {payment.status}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
