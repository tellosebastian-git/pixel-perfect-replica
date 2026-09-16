import { useCallback, useEffect, useRef, useState } from 'react';
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
  const [storedAccess, setAccess] = useState<SubscriptionAccess | null>(null);
  const [localLoading, setLocalLoading] = useState(false);
  const [storedError, setError] = useState<string | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const generationRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const orgId = organization?.id;
  const currentKey = user && orgId ? `${user.id}:${orgId}` : null;
  const access = currentKey && loadedKey === currentKey && storedAccess?.organization_id === orgId
    ? storedAccess : null;
  const error = currentKey && loadedKey === currentKey ? storedError : null;

  const fetchAccess = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const generation = ++generationRef.current;
    setLoadedKey(currentKey);
    setAccess(null);
    setError(null);
    if (!currentKey || !orgId) {
      setLocalLoading(false);
      return;
    }
    setLocalLoading(true);

    try {
      const { data, error: rpcError } = await supabaseUntyped
        .rpc('get_organization_subscription_access', { _org_id: orgId })
        .abortSignal(controller.signal);

      if (generationRef.current !== generation || controller.signal.aborted) return;
      if (rpcError) throw rpcError;

      const row = Array.isArray(data) ? data[0] : data;
      if (!row || row.organization_id !== orgId) {
        throw new Error('No pudimos cargar el estado de la suscripción.');
      }

      setAccess(row as SubscriptionAccess);
    } catch (err) {
      if (generationRef.current !== generation || controller.signal.aborted) return;
      console.error('[subscription-access] error:', err);
      setAccess(null);
      setError('No pudimos verificar el estado de la suscripción.');
    } finally {
      if (generationRef.current === generation) setLocalLoading(false);
    }
  }, [currentKey, orgId]);

  useEffect(() => {
    void fetchAccess();
    return () => controllerRef.current?.abort();
  }, [fetchAccess]);

  return {
    access,
    isLoading: Boolean(currentKey && (loadedKey !== currentKey || localLoading)),
    error,
    refreshAccess: fetchAccess,
  };
}
