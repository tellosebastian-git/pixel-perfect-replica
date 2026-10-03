import { useCallback, useEffect, useState } from 'react';
import { useOrganization } from '@/contexts/OrganizationContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabaseUntyped } from '@/lib/supabaseUntyped';

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'cancelled' | 'expired';
export type BillingPlanCode = 'basico' | 'profesional' | 'premium';

export interface SubscriptionAccess {
  organization_id: string;
  subscription_id: string;
  status: SubscriptionStatus;
  current_plan_code: BillingPlanCode | null;
  effective_plan_code: BillingPlanCode;
  pending_plan_code: BillingPlanCode | null;
  trial_started_at: string | null;
  trial_ends_at: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  has_access: boolean;
  access_ends_at: string | null;
  days_until_access_ends: number | null;
  block_reason: 'trial_expired' | 'payment_failed' | 'subscription_expired' | 'subscription_cancelled' | null;
}

interface UseSubscriptionAccessResult {
  access: SubscriptionAccess | null;
  isLoading: boolean;
  error: string | null;
  refreshAccess: () => Promise<void>;
}

export function useSubscriptionAccess(): UseSubscriptionAccessResult {
  const { user } = useAuth();
  const { organization } = useOrganization();
  const [access, setAccess] = useState<SubscriptionAccess | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAccess = useCallback(async () => {
    if (!user || !organization?.id) {
      setAccess(null);
      setError(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const { data, error: rpcError } = await supabaseUntyped
        .rpc('get_organization_subscription_access', { _org_id: organization.id });

      if (rpcError) throw rpcError;

      const row = Array.isArray(data) ? data[0] : data;
      if (!row) {
        throw new Error('No pudimos cargar el estado de la suscripción.');
      }

      setAccess(row as SubscriptionAccess);
    } catch (err) {
      console.error('[subscription-access] error:', err);
      setAccess(null);
      setError('No pudimos verificar el estado de la suscripción.');
    } finally {
      setIsLoading(false);
    }
  }, [organization?.id, user]);

  useEffect(() => {
    void fetchAccess();
  }, [fetchAccess]);

  return {
    access,
    isLoading,
    error,
    refreshAccess: fetchAccess,
  };
}
