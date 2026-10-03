import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { perfStart, perfEvent, withTimeout, isTimeoutError } from '@/lib/perfLog';

const PROFILE_ROLES_TIMEOUT_MS = 12000;


export type AppRole = 'owner' | 'general_manager' | 'manager' | 'barber' | 'sucursal_account' | 'otros';

interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  barbero_id: string | null;
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
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, fullName: string, businessName?: string, country?: string, plan?: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}


const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  // Race-guard: tracks the user.id whose hydration is in flight so duplicate
  // events for the same session don't pile up and pisar estados.
  const hydratingForRef = useRef<string | null>(null);
  // Track last fully-hydrated user id; lets us skip redundant rehydrations.
  const hydratedForRef = useRef<string | null>(null);

  const fetchProfileAndRoles = async (userId: string) => {
    const [profileRes, rolesRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
      supabase.from('user_roles').select('role').eq('user_id', userId),
    ]);
    if (profileRes.error) throw profileRes.error;
    if (rolesRes.error) throw rolesRes.error;
    return {
      profile: (profileRes.data as Profile | null) ?? null,
      roles: (rolesRes.data ?? []).map(r => r.role as AppRole),
    };
  };

  // Idempotent session hydration. Used by both getSession() and onAuthStateChange.
  const hydrateSession = async (nextSession: Session | null) => {
    // No session → clear everything synchronously.
    if (!nextSession) {
      hydratingForRef.current = null;
      hydratedForRef.current = null;
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

    // Same user already hydrated AND not currently hydrating → just refresh session token state.
    if (hydratedForRef.current === nextUserId && hydratingForRef.current === null) {
      setSession(nextSession);
      setUser(nextSession.user);
      setIsLoading(false);
      return;
    }

    // Same user already hydrating → ignore duplicate.
    if (hydratingForRef.current === nextUserId) {
      return;
    }

    hydratingForRef.current = nextUserId;
    setSession(nextSession);
    setUser(nextSession.user);
    setAuthError(null);
    const perf = perfStart('profileRoles');

    try {
      const { profile: nextProfile, roles: nextRoles } = await withTimeout(
        fetchProfileAndRoles(nextUserId),
        PROFILE_ROLES_TIMEOUT_MS,
        'fetchProfileAndRoles',
      );
      perf.success({ rolesCount: nextRoles.length });
      // Only commit if still the active hydration target (avoid stale writes after fast switch).
      if (hydratingForRef.current === nextUserId) {
        setProfile(nextProfile);
        setRoles(nextRoles);
        setAuthError(null);
        hydratedForRef.current = nextUserId;
      }
    } catch (err) {
      if (isTimeoutError(err)) perf.timeout(); else perf.error(err);
      if (hydratingForRef.current === nextUserId) {
        // Keep user/session, clear derived data to avoid false permissions.
        setProfile(null);
        setRoles([]);
        hydratedForRef.current = null;
        setAuthError(
          isTimeoutError(err)
            ? 'No pudimos cargar tu perfil. La conexión está tardando demasiado.'
            : 'No pudimos cargar tu perfil y permisos. Reintentá en unos segundos.',
        );
      }
    } finally {
      // Liberar SIEMPRE el ref, no solo cuando coincide con el target activo.
      // Evita que un hydrate colgado bloquee futuros eventos de auth.
      hydratingForRef.current = null;
      setIsLoading(false);
    }
  };

  const refreshProfile = async () => {
    if (user) {
      // Force rehydrate by clearing the cache key.
      hydratedForRef.current = null;
      hydratingForRef.current = null;
      setIsLoading(true);
      await hydrateSession(session);
    }
  };


  useEffect(() => {
    // Listener FIRST (Supabase recommendation). Defer with setTimeout(0) to avoid
    // blocking the auth callback and prevent deadlocks.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      console.info('[Auth] phase=onAuthStateChange event=', event);
      console.info('[Auth][DIAG]', {
        timestamp: new Date().toISOString(),
        event,
        nextSessionIsNull: !nextSession,
        hadPreviousSession: !!session,
      });

      // Clear localStorage hint when verified.
      if (nextSession?.user?.email_confirmed_at) {
        localStorage.removeItem('pending_verification_email');
      }


      setTimeout(() => {
        hydrateSession(nextSession);
      }, 0);
    });

    // Then check existing session.
    console.info('[Auth] phase=getSession:start');
    supabase.auth.getSession()
      .then(({ data: { session: existing } }) => {
        console.info('[Auth] phase=getSession:done hasSession=', !!existing);
        hydrateSession(existing);
      })
      .catch(err => {
        console.error('[Auth] phase=getSession:error', err);
        setIsLoading(false);
      });

    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signIn = async (email: string, password: string) => {
    const perf = perfStart('signIn');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) perf.error(error); else perf.success();
    return { error };
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
    hydratingForRef.current = null;
    hydratedForRef.current = null;
    setUser(null);
    setSession(null);
    setProfile(null);
    setRoles([]);
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
        refreshProfile
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
