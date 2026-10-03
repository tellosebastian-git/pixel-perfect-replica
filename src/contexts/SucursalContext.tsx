import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './AuthContext';
import { useOrganization } from './OrganizationContext';
import { perfStart, withTimeout, isTimeoutError } from '@/lib/perfLog';

const SUCURSALES_TIMEOUT_MS = 12000;


export interface Sucursal {
  id: string;
  organization_id: string;
  nombre: string;
  direccion: string | null;
  telefono: string | null;
  timezone: string | null;
  activa: boolean;
}

interface SucursalContextType {
  sucursales: Sucursal[];
  currentSucursal: Sucursal | null; // null = "Todas" (only for owner)
  isAllMode: boolean;
  isLoading: boolean;
  error: string | null;
  setCurrentSucursal: (id: string | null) => void;
  refreshSucursales: () => Promise<void>;
}


const SucursalContext = createContext<SucursalContextType | undefined>(undefined);

export function SucursalProvider({ children }: { children: ReactNode }) {
  const { user, isOwner, isGeneralManager, isSucursalAccount, isLoading: authLoading } = useAuth();
  const { organization, isLoading: orgLoading } = useOrganization();
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [currentSucursal, setCurrentSucursalState] = useState<Sucursal | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSucursales = useCallback(async () => {
    if (!user || !organization) {
      setSucursales([]);
      setCurrentSucursalState(null);
      setError(null);
      setIsLoading(false);
      return;
    }

    setError(null);
    const perf = perfStart('sucursales');

    try {
      const loader = (async () => {
        const sucRes = await supabase
          .from('sucursales')
          .select('*')
          .eq('organization_id', organization.id)
          .eq('activa', true)
          .is('deleted_at', null)
          .order('nombre');
        if (sucRes.error) throw sucRes.error;

        const profRes = await supabase
          .from('profiles')
          .select('default_sucursal_id')
          .eq('id', user.id)
          .maybeSingle();
        // No tirar error si el profile no devuelve nada; default_sucursal_id es opcional.

        return {
          sucursales: sucRes.data ?? [],
          defaultId: profRes.data?.default_sucursal_id ?? null,
        };
      })();

      const { sucursales: data, defaultId } = await withTimeout(
        loader,
        SUCURSALES_TIMEOUT_MS,
        'fetchSucursales',
      );

      const mapped: Sucursal[] = data.map(s => ({
        id: s.id,
        organization_id: s.organization_id,
        nombre: s.nombre,
        direccion: s.direccion,
        telefono: s.telefono,
        timezone: s.timezone,
        activa: s.activa,
      }));

      setSucursales(mapped);

      if (mapped.length > 0 && !currentSucursal) {
        const defaultSuc = mapped.find(s => s.id === defaultId);
        setCurrentSucursalState(defaultSuc || mapped[0]);
      }
      perf.success({ count: mapped.length });
    } catch (err) {
      if (isTimeoutError(err)) perf.timeout(); else perf.error(err);
      setError(
        isTimeoutError(err)
          ? 'La carga de sucursales está tardando demasiado. Probá reintentar.'
          : 'No pudimos cargar tus sucursales.',
      );
    } finally {
      setIsLoading(false);
    }
  }, [user, organization, currentSucursal]);


  useEffect(() => {
    if (!authLoading && !orgLoading) {
      fetchSucursales();
    }
  }, [user, organization, authLoading, orgLoading]);

  const setCurrentSucursal = useCallback(async (id: string | null) => {
    // Sucursal accounts are locked to their assigned sucursal — no switching.
    if (isSucursalAccount) return;
    // Block branch switching for non-owner/GM users
    if (!isOwner && !isGeneralManager) return;

    if (id === null) {
      // "Todas" mode — only owners can do this
      setCurrentSucursalState(null);
    } else {
      const found = sucursales.find(s => s.id === id);
      if (found) {
        setCurrentSucursalState(found);
        // Persist preference
        if (user) {
          await supabase
            .from('profiles')
            .update({ default_sucursal_id: id })
            .eq('id', user.id);
        }
      }
    }
  }, [sucursales, user, isOwner, isGeneralManager, isSucursalAccount]);

  // Sucursal accounts never have "Todas" mode.
  const isAllMode = !isSucursalAccount && (isOwner || isGeneralManager) && currentSucursal === null;

  return (
    <SucursalContext.Provider
      value={{
        sucursales,
        currentSucursal,
        isAllMode,
        isLoading: isLoading || authLoading || orgLoading,
        error,
        setCurrentSucursal,

        refreshSucursales: fetchSucursales,
      }}
    >
      {children}
    </SucursalContext.Provider>
  );
}

export function useSucursal() {
  const context = useContext(SucursalContext);
  if (context === undefined) {
    throw new Error('useSucursal must be used within a SucursalProvider');
  }
  return context;
}
