import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './AuthContext';
import { perfStart, withTimeout, isTimeoutError } from '@/lib/perfLog';

const ORGANIZATION_TIMEOUT_MS = 12000;


interface Organization {
  id: string;
  name: string;
  slug: string;
  plan: 'basico' | 'profesional' | 'premium';
  plan_expires_at: string | null;
  logo_url: string | null;
  phone: string | null;
  address: string | null;
  is_active: boolean;
  timezone: string;
  peticiones_vencimiento_dias: number;
  tareas_vencimiento_dias_default: number;
}

interface PlanFeatures {
  max_barbers: number;
  max_services: number;
  can_export_reports: boolean;
  can_view_analytics: boolean;
  price_monthly: number;
}

interface OrganizationContextType {
  organization: Organization | null;
  planFeatures: PlanFeatures | null;
  isLoading: boolean;
  error: string | null;
  refreshOrganization: () => Promise<void>;
  updateOrganization: (updates: Partial<Organization>) => Promise<{ error: Error | null }>;
}

const OrganizationContext = createContext<OrganizationContextType | undefined>(undefined);

export function OrganizationProvider({ children }: { children: ReactNode }) {
  const { user, isLoading: authLoading } = useAuth();
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [planFeatures, setPlanFeatures] = useState<PlanFeatures | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOrganization = async () => {
    setError(null);

    if (!user) {
      setOrganization(null);
      setPlanFeatures(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const perf = perfStart('organization');

    try {
      const loader = (async () => {
        // 1. Resolver organization_id desde el profile.
        const { data: profileRow, error: profileErr } = await supabase
          .from('profiles')
          .select('organization_id')
          .eq('id', user.id)
          .maybeSingle();
        if (profileErr) throw profileErr;

        const orgId = profileRow?.organization_id;
        if (!orgId) return { org: null as Organization | null, noOrg: true };

        // 2. Cargar organización por id explícito.
        const { data: orgData, error: orgErr } = await supabase
          .from('organizations')
          .select('*')
          .eq('id', orgId)
          .maybeSingle();
        if (orgErr) throw orgErr;
        return { org: (orgData as Organization | null) ?? null, noOrg: false };
      })();

      const { org, noOrg } = await withTimeout(loader, ORGANIZATION_TIMEOUT_MS, 'fetchOrganization');

      if (noOrg) {
        setOrganization(null);
        setPlanFeatures(null);
        setError('Tu cuenta no tiene una organización asignada.');
        perf.success({ result: 'no-org' });
        return;
      }
      if (!org) {
        setOrganization(null);
        setPlanFeatures(null);
        setError('No pudimos cargar tu organización.');
        perf.success({ result: 'empty' });
        return;
      }

      setOrganization(org);
      perf.success({ result: 'ok' });

      // 3. Plan features en background: nunca bloquea ni rompe el flujo.
      (async () => {
        try {
          const { data: featuresData } = await supabase
            .from('plan_features')
            .select('*')
            .eq('plan', org.plan)
            .maybeSingle();
          if (featuresData) setPlanFeatures(featuresData as PlanFeatures);
        } catch (planErr) {
          console.warn('[Org] plan_features:error', planErr);
        }
      })();

    } catch (err) {
      if (isTimeoutError(err)) perf.timeout(); else perf.error(err);
      setOrganization(null);
      setPlanFeatures(null);
      setError(
        isTimeoutError(err)
          ? 'La carga de tu organización está tardando demasiado. Probá reintentar.'
          : 'No pudimos cargar tu organización. Reintentá en unos segundos.',
      );
    } finally {
      setIsLoading(false);
    }
  };


  const refreshOrganization = async () => {
    await fetchOrganization();
  };

  const updateOrganization = async (updates: Partial<Organization>) => {
    if (!organization) {
      return { error: new Error('No organization found') };
    }

    try {
      const { error: updErr } = await supabase
        .from('organizations')
        .update(updates)
        .eq('id', organization.id);

      if (updErr) {
        return { error: updErr };
      }

      setOrganization(prev => prev ? { ...prev, ...updates } : null);
      return { error: null };
    } catch (err) {
      return { error: err as Error };
    }
  };

  useEffect(() => {
    if (!authLoading) {
      fetchOrganization();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, authLoading]);

  return (
    <OrganizationContext.Provider
      value={{
        organization,
        planFeatures,
        isLoading: isLoading || authLoading,
        error,
        refreshOrganization,
        updateOrganization,
      }}
    >
      {children}
    </OrganizationContext.Provider>
  );
}

export function useOrganization() {
  const context = useContext(OrganizationContext);
  if (context === undefined) {
    throw new Error('useOrganization must be used within an OrganizationProvider');
  }
  return context;
}
