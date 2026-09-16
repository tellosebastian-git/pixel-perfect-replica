import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './AuthContext';
import { perfStart } from '@/lib/perfLog';
import { ReadCancelledError, ReadFailure, runReadWithRetry } from '@/lib/readRetry';


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
  const { user, profile, isLoading: authLoading, authError } = useAuth();
  const [storedOrganization, setOrganization] = useState<Organization | null>(null);
  const [planFeatures, setPlanFeatures] = useState<PlanFeatures | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [storedError, setError] = useState<string | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const generationRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  const readyProfile = !authLoading && !authError && user && profile?.id === user.id ? profile : null;
  const orgId = readyProfile?.organization_id ?? null;
  const currentKey = readyProfile ? `${readyProfile.id}:${orgId ?? 'none'}` : null;
  const organization = loadedKey === currentKey ? storedOrganization : null;
  const error = loadedKey === currentKey ? storedError : null;

  const fetchOrganization = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const generation = ++generationRef.current;
    setLoadedKey(currentKey);
    setOrganization(null);
    setPlanFeatures(null);
    setError(null);

    if (!currentKey) {
      setIsLoading(false);
      return;
    }
    if (!orgId) {
      setError('Tu cuenta no tiene una organización asignada.');
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const perf = perfStart('organization');
    try {
      const org = await runReadWithRetry<Organization | null>(async signal => {
        const { data, error: queryError, status } = await supabase
          .from('organizations')
          .select('*')
          .eq('id', orgId)
          .maybeSingle()
          .abortSignal(signal);
        return { data: data as Organization | null, error: queryError, status };
      }, { signal: controller.signal });
      if (generationRef.current !== generation || controller.signal.aborted) return;
      if (!org) {
        setError('No pudimos cargar tu organización.');
        perf.success({ result: 'empty' });
        return;
      }
      setOrganization(org);
      perf.success({ result: 'ok' });

      // Optional plan features never block access and cannot write after a tenant switch.
      void (async () => {
        try {
          const { data } = await supabase
            .from('plan_features')
            .select('max_barbers, max_services, can_export_reports, can_view_analytics')
            .eq('plan', org.plan)
            .maybeSingle()
            .abortSignal(controller.signal);
          if (generationRef.current === generation && !controller.signal.aborted && data) {
            setPlanFeatures(data as PlanFeatures);
          }
        } catch (planErr) {
          if (!controller.signal.aborted) console.warn('[Org] plan_features:error', planErr);
        }
      })();
    } catch (err) {
      if (err instanceof ReadCancelledError || controller.signal.aborted) return;
      if (err instanceof ReadFailure && err.message === 'read_timeout') perf.timeout(); else perf.error(err);
      if (generationRef.current === generation) {
        setError('No pudimos cargar tu organización. Probá reintentar.');
      }
    } finally {
      if (generationRef.current === generation) setIsLoading(false);
    }
  }, [currentKey, orgId]);

  const refreshOrganization = async () => { await fetchOrganization(); };

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

      if (currentKey && loadedKey === currentKey) {
        setOrganization(prev => prev?.id === organization.id ? { ...prev, ...updates } : prev);
      }
      return { error: null };
    } catch (err) {
      return { error: err as Error };
    }
  };

  useEffect(() => {
    void fetchOrganization();
    return () => controllerRef.current?.abort();
  }, [fetchOrganization]);

  return (
    <OrganizationContext.Provider
      value={{
        organization,
        planFeatures: loadedKey === currentKey ? planFeatures : null,
        isLoading: authLoading || Boolean(currentKey && (loadedKey !== currentKey || isLoading)),
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
