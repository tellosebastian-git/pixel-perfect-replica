import { createContext, useContext, useEffect, useState, useCallback, useRef, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './AuthContext';
import { useOrganization } from './OrganizationContext';
import { perfStart } from '@/lib/perfLog';
import { ReadCancelledError, ReadFailure, runReadWithRetry } from '@/lib/readRetry';


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
const EMPTY_SUCURSALES: Sucursal[] = [];

export function SucursalProvider({ children }: { children: ReactNode }) {
  const { user, profile, isOwner, isGeneralManager, isSucursalAccount, isLoading: authLoading } = useAuth();
  const { organization, isLoading: orgLoading } = useOrganization();
  const [storedSucursales, setSucursales] = useState<Sucursal[]>([]);
  const [storedCurrentSucursal, setCurrentSucursalState] = useState<Sucursal | null>(null);
  const [localLoading, setLocalLoading] = useState(false);
  const [storedError, setError] = useState<string | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const generationRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const selectionRef = useRef<{ key: string; id: string } | null>(null);
  const orgId = organization?.id;
  const currentKey = user && orgId ? `${user.id}:${orgId}` : null;
  const sucursales = currentKey && loadedKey === currentKey ? storedSucursales : EMPTY_SUCURSALES;
  const currentSucursal = currentKey && loadedKey === currentKey ? storedCurrentSucursal : null;
  const error = currentKey && loadedKey === currentKey ? storedError : null;

  const fetchSucursales = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const generation = ++generationRef.current;
    setLoadedKey(currentKey);
    setSucursales([]);
    setCurrentSucursalState(null);
    setError(null);
    if (!currentKey || !orgId) {
      setLocalLoading(false);
      return;
    }
    setLocalLoading(true);
    const perf = perfStart('sucursales');

    try {
      const data = await runReadWithRetry<Sucursal[]>(async signal => {
        const { data, error: queryError, status } = await supabase
          .from('sucursales')
          .select('*')
          .eq('organization_id', orgId)
          .eq('activa', true)
          .is('deleted_at', null)
          .order('nombre')
          .abortSignal(signal);
        return { data: (data ?? []) as Sucursal[], error: queryError, status };
      }, { signal: controller.signal });
      if (generationRef.current !== generation || controller.signal.aborted) return;

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
      const previousId = selectionRef.current?.key === currentKey ? selectionRef.current.id : null;
      const preferredId = previousId ?? profile?.default_sucursal_id;
      const selected = mapped.find(s => s.id === preferredId) ?? mapped[0] ?? null;
      setCurrentSucursalState(selected);
      selectionRef.current = selected && currentKey ? { key: currentKey, id: selected.id } : null;
      perf.success({ count: mapped.length });
    } catch (err) {
      if (err instanceof ReadCancelledError || controller.signal.aborted) return;
      if (err instanceof ReadFailure && err.message === 'read_timeout') perf.timeout(); else perf.error(err);
      if (generationRef.current === generation) setError('No pudimos cargar tus sucursales. Probá reintentar.');
    } finally {
      if (generationRef.current === generation) setLocalLoading(false);
    }
  }, [currentKey, orgId, profile?.default_sucursal_id]);


  useEffect(() => {
    if (!authLoading && !orgLoading) void fetchSucursales();
    return () => controllerRef.current?.abort();
  }, [fetchSucursales, authLoading, orgLoading]);

  const setCurrentSucursal = useCallback(async (id: string | null) => {
    // Sucursal accounts are locked to their assigned sucursal — no switching.
    if (isSucursalAccount || !currentKey || loadedKey !== currentKey) return;
    // Block branch switching for non-owner/GM users
    if (!isOwner && !isGeneralManager) return;

    if (id === null) {
      // "Todas" mode — only owners can do this
      setCurrentSucursalState(null);
      selectionRef.current = null;
    } else {
      const found = sucursales.find(s => s.id === id);
      if (found) {
        setCurrentSucursalState(found);
        selectionRef.current = { key: currentKey, id: found.id };
        // Persist preference
        if (user) {
          await supabase
            .from('profiles')
            .update({ default_sucursal_id: id })
            .eq('id', user.id);
        }
      }
    }
  }, [sucursales, user, isOwner, isGeneralManager, isSucursalAccount, currentKey, loadedKey]);

  // Sucursal accounts never have "Todas" mode.
  const isAllMode = Boolean(currentKey && loadedKey === currentKey && !isSucursalAccount && (isOwner || isGeneralManager) && currentSucursal === null);

  return (
    <SucursalContext.Provider
      value={{
        sucursales,
        currentSucursal,
        isAllMode,
        isLoading: authLoading || orgLoading || Boolean(currentKey && (loadedKey !== currentKey || localLoading)),
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
