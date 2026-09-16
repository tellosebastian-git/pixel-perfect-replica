import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { perfStart, withTimeout } from '@/lib/perfLog';
import { ReadCancelledError, ReadFailure, runReadWithRetry } from '@/lib/readRetry';


export type AppRole = 'owner' | 'general_manager' | 'manager' | 'barber' | 'sucursal_account' | 'otros';

interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  barbero_id: string | null;
  organization_id: string | null;
  default_sucursal_id: string | null;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  roles: AppRole[];
  isLoading: boolean;
  /** Error explícito si falla la hidratación (profile/roles). Null si no hay error. */
  authError: string | null;
  isOwner: boolean;
  isGeneralManager: boolean;
  isManager: boolean;
  isBarber: boolean;
  isSucursalAccount: boolean;
  hasNoAccess: boolean;
  mustChangePassword: boolean;
  canManagePayments: boolean;
  canOperarCajaYGastos: boolean;
  canManageConfig: boolean;
  canViewConfig: boolean;
  canManageBarbers: boolean;
  canManageUsers: boolean;
  canViewAllClosings: boolean;
  canViewResumen: boolean;
  canViewTareas: boolean;
  canViewMiNegocio: boolean;
  canViewFinanzas: boolean;
  canViewTurnosAgenda: boolean;
  canViewClientes: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null; userId: string | null }>;
  signUp: (email: string, password: string, fullName: string, businessName?: string, country?: string, plan?: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  retrySessionRestore: () => Promise<void>;
}


const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const hydratingForRef = useRef<string | null>(null);
  const hydratedForRef = useRef<string | null>(null);
  const currentSessionRef = useRef<Session | null>(null);
  const requestGenerationRef = useRef(0);
  const requestControllerRef = useRef<AbortController | null>(null);
  const initialEventHandledRef = useRef(false);

  const fetchProfileAndRoles = async (userId: string, signal: AbortSignal) => {
    const [nextProfile, nextRoles] = await Promise.all([
      runReadWithRetry<Profile | null>(async attemptSignal => {
        const { data, error, status } = await supabase
          .from('profiles')
          .select('id, email, full_name, barbero_id, organization_id, default_sucursal_id')
          .eq('id', userId)
          .maybeSingle()
          .abortSignal(attemptSignal);
        return { data: data as Profile | null, error, status };
      }, { signal }),
      runReadWithRetry<AppRole[]>(async attemptSignal => {
        const { data, error, status } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', userId)
          .abortSignal(attemptSignal);
        return { data: (data ?? []).map(row => row.role as AppRole), error, status };
      }, { signal }),
    ]);
    if (!nextProfile) throw new Error('profile_missing');
    return { profile: nextProfile, roles: nextRoles };
  };

  const hydrateSession = async (nextSession: Session | null, force = false) => {
    if (!nextSession) {
      requestGenerationRef.current += 1;
      requestControllerRef.current?.abort();
      requestControllerRef.current = null;
      hydratingForRef.current = null;
      hydratedForRef.current = null;
      currentSessionRef.current = null;
      setSession(null);
      setUser(null);
      setProfile(null);
      setRoles([]);
      setAuthError(null);
      setIsLoading(false);
      console.info('[Auth] phase=hydrate:cleared');
      return;
    }

    const nextUserId = nextSession.user.id;
    const previousUserId = currentSessionRef.current?.user.id;
    currentSessionRef.current = nextSession;
    setSession(nextSession);
    setUser(nextSession.user);

    if (!force && hydratedForRef.current === nextUserId && hydratingForRef.current === null) {
      setIsLoading(false);
      return;
    }

    if (!force && hydratingForRef.current === nextUserId) return;

    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;
    const generation = ++requestGenerationRef.current;
    hydratingForRef.current = nextUserId;
    if (previousUserId !== nextUserId || force) {
      setProfile(null);
      setRoles([]);
    }
    setIsLoading(true);
    setAuthError(null);
    const perf = perfStart('profileRoles');

    try {
      const { profile: nextProfile, roles: nextRoles } = await fetchProfileAndRoles(nextUserId, controller.signal);
      perf.success({ rolesCount: nextRoles.length });
      if (requestGenerationRef.current === generation && !controller.signal.aborted) {
        setProfile(nextProfile);
        setRoles(nextRoles);
        setAuthError(null);
        hydratedForRef.current = nextUserId;
      }
    } catch (err) {
      if (err instanceof ReadCancelledError || controller.signal.aborted) return;
      // Promise.all can reject while its sibling read is still running.
      controller.abort();
      if (err instanceof ReadFailure && err.message === 'read_timeout') perf.timeout(); else perf.error(err);
      if (requestGenerationRef.current === generation) {
        setProfile(null);
        setRoles([]);
        hydratedForRef.current = null;
        setAuthError(
          err instanceof Error && err.message === 'profile_missing'
            ? 'No encontramos el perfil de esta cuenta.'
            : 'No pudimos cargar tu perfil y permisos. Probá reintentar.',
        );
      }
    } finally {
      if (requestGenerationRef.current === generation) {
        hydratingForRef.current = null;
        requestControllerRef.current = null;
        setIsLoading(false);
      }
    }
  };

  const refreshProfile = async () => {
    if (currentSessionRef.current) await hydrateSession(currentSessionRef.current, true);
  };

  const retrySessionRestore = async () => {
    if (currentSessionRef.current) {
      await hydrateSession(currentSessionRef.current, true);
      return;
    }
    setIsLoading(true);
    setAuthError(null);
    try {
      const { data, error } = await withTimeout(supabase.auth.getSession(), 12000, 'getSession');
      if (error) throw error;
      if (!currentSessionRef.current) await hydrateSession(data.session);
    } catch (err) {
      console.error('[Auth] phase=restore:error', err);
      if (!currentSessionRef.current) {
        setAuthError('No pudimos verificar tu sesión. Probá reintentar.');
        setIsLoading(false);
      }
    }
  };


  useEffect(() => {
    // INITIAL_SESSION is the sole startup source. Never await Supabase calls in this callback.
    let mounted = true;
    initialEventHandledRef.current = false;
    const startupTimer = window.setTimeout(() => {
      if (!initialEventHandledRef.current && mounted) {
        setAuthError('No pudimos verificar tu sesión. Probá reintentar.');
        setIsLoading(false);
      }
    }, 15000);
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!mounted) return;
      if (event === 'INITIAL_SESSION' && initialEventHandledRef.current) return;
      if (event === 'INITIAL_SESSION' && currentSessionRef.current &&
          nextSession?.user.id !== currentSessionRef.current.user.id) return;
      initialEventHandledRef.current = true;
      window.clearTimeout(startupTimer);
      console.info('[Auth] phase=onAuthStateChange event=', event);
      console.info('[Auth][DIAG]', {
        timestamp: new Date().toISOString(),
        event,
        nextSessionIsNull: !nextSession,
        hadPreviousSession: !!currentSessionRef.current,
      });

      // Clear localStorage hint when verified.
      if (nextSession?.user?.email_confirmed_at) {
        localStorage.removeItem('pending_verification_email');
      }


      window.setTimeout(() => {
        if (mounted) void hydrateSession(nextSession);
      }, 0);
    });

    return () => {
      mounted = false;
      window.clearTimeout(startupTimer);
      requestGenerationRef.current += 1;
      requestControllerRef.current?.abort();
      requestControllerRef.current = null;
      hydratingForRef.current = null;
      subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signIn = async (email: string, password: string) => {
    const perf = perfStart('signIn');
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) perf.error(error); else perf.success();
    if (data.session) void hydrateSession(data.session);
    return { error: error ?? (data.session ? null : new Error('No pudimos iniciar la sesión. Probá de nuevo.')), userId: data.session?.user.id ?? null };
  };


  const signUp = async (email: string, password: string, fullName: string, businessName?: string, country?: string, plan?: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        data: {
          full_name: fullName,
          business_name: businessName || 'Mi Barbería',
          country: country || 'AR',
          business_plan: (plan || 'basico').toLowerCase(),
        }
      }
    });
    return { error };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    await hydrateSession(null);
  };

  // Computed permissions based on roles
  const isOwner = roles.includes('owner');
  const isGeneralManager = roles.includes('general_manager');
  const isManager = roles.includes('manager');
  const isBarber = roles.includes('barber');
  const isSucursalAccount = roles.includes('sucursal_account');

  const hasNoAccess = roles.length > 0 && roles.every(r => r === 'otros');

  const mustChangePassword = (user?.user_metadata?.must_change_password === true)
    || (isSucursalAccount && user?.user_metadata?.temp_password_pending === true);

  const canManagePayments = isOwner || isGeneralManager || isManager;
  const canOperarCajaYGastos = isOwner || isGeneralManager || isManager || isSucursalAccount;
  const canManageConfig = isOwner || isGeneralManager;
  const canViewConfig = !hasNoAccess && roles.length > 0; // todos los roles operativos
  const canManageBarbers = isOwner || isGeneralManager;
  const canManageUsers = isOwner || isGeneralManager;
  const canViewAllClosings = isOwner || isGeneralManager || isManager || isSucursalAccount;
  const canViewResumen = !hasNoAccess && roles.length > 0;
  const canViewTareas = !hasNoAccess && roles.length > 0;
  const canViewMiNegocio = (isOwner || isGeneralManager || isManager) && !isSucursalAccount;
  const canViewFinanzas = isOwner || isGeneralManager || isManager || isSucursalAccount;
  const canViewTurnosAgenda = isOwner || isGeneralManager || isManager || isSucursalAccount || isBarber;
  const canViewClientes = !hasNoAccess && (isOwner || isGeneralManager || isManager || isSucursalAccount);

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        profile,
        roles,
        isLoading,
        authError,

        isOwner,
        isGeneralManager,
        isManager,
        isBarber,
        isSucursalAccount,
        hasNoAccess,
        mustChangePassword,
        canManagePayments,
        canOperarCajaYGastos,
        canManageConfig,
        canViewConfig,
        canManageBarbers,
        canManageUsers,
        canViewAllClosings,
        canViewResumen,
        canViewTareas,
        canViewMiNegocio,
        canViewFinanzas,
        canViewTurnosAgenda,
        canViewClientes,
        signIn,
        signUp,
        signOut,
        refreshProfile,
        retrySessionRestore
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
