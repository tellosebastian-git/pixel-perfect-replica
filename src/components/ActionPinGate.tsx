import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { PinGateDialog } from '@/components/PinGateDialog';
import { useAuth } from '@/contexts/AuthContext';
import { SucursalActionKey, SUCURSAL_ACTION_LABELS } from '@/lib/sucursalActions';
import { toast } from 'sonner';

export interface ActionPinResult {
  ok: boolean;
  cancelled?: boolean;
  validatedByUserId?: string | null;
  validatedByRole?: 'owner' | 'general_manager' | 'manager' | null;
  userName?: string | null;
}

type RequireFn = (
  actionKey: SucursalActionKey,
  sucursalId: string | null | undefined,
  organizationId?: string | null,
) => Promise<ActionPinResult>;

interface CtxValue {
  requirePinForAction: RequireFn;
}

const ActionPinGateContext = createContext<CtxValue | null>(null);

interface PendingState {
  actionKey: SucursalActionKey;
  sucursalId: string | null;
  organizationId: string | null;
  resolve: (r: ActionPinResult) => void;
}

export function ActionPinGateProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingState | null>(null);
  const pendingRef = useRef<PendingState | null>(null);

  // Bypass: el PIN solo aplica a cuentas de sucursal. El resto de cuentas personales
  // (owner, general_manager, manager, barber) nunca pasa por el flujo de PIN.
  // Importante: esperar a que AuthContext termine de cargar antes de evaluar el bypass,
  // para evitar un "bypass fantasma" mientras roles=[] e isSucursalAccount=false por defecto.
  const { isSucursalAccount, isLoading: authLoading } = useAuth();
  const isSucursalAccountRef = useRef(isSucursalAccount);
  const authReadyRef = useRef(!authLoading);
  useEffect(() => {
    isSucursalAccountRef.current = isSucursalAccount;
  }, [isSucursalAccount]);
  useEffect(() => {
    authReadyRef.current = !authLoading;
  }, [authLoading]);

  const requirePinForAction = useCallback<RequireFn>(async (actionKey, sucursalId, organizationId) => {
    // Tiempo máximo de espera a que AuthContext termine de cargar antes de decidir
    // si aplicar bypass o pedir PIN. NO es el tiempo del usuario para tipear el PIN.
    const AUTH_READY_TIMEOUT_MS = 90_000;

    // Esperar a que AuthContext esté inicializado (fail-safe).
    if (!authReadyRef.current) {
      await new Promise<void>((resolve) => {
        const start = Date.now();
        const check = () => {
          if (authReadyRef.current) return resolve();
          if (Date.now() - start > AUTH_READY_TIMEOUT_MS) return resolve();
          setTimeout(check, 50);
        };
        check();
      });
    }

    // Si auth sigue sin estar listo, fail-safe: no autorizar.
    if (!authReadyRef.current) {
      return { ok: false, cancelled: true };
    }

    // Cuentas personales: ejecutan la acción directamente, sin PIN.
    if (!isSucursalAccountRef.current) {
      return { ok: true, validatedByRole: null, validatedByUserId: null, userName: null };
    }

    // 1. Resolver organization_id si no vino: del profile del usuario actual
    let orgId = organizationId ?? null;
    if (!orgId) {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: prof } = await supabase
          .from('profiles')
          .select('organization_id')
          .eq('id', user.id)
          .maybeSingle();
        orgId = prof?.organization_id ?? null;
      }
    }

    if (!orgId) {
      return { ok: false, cancelled: false };
    }

    // 2. Consultar si la acción requiere PIN
    try {
      const { data: requires, error } = await supabase.rpc('sucursal_action_requires_pin', {
        _organization_id: orgId,
        _sucursal_id: sucursalId ?? null,
        _action_key: actionKey,
      });
      if (error) throw error;
      if (!requires) {
        return { ok: true, validatedByRole: null, validatedByUserId: null, userName: null };
      }
    } catch (e) {
      console.error('sucursal_action_requires_pin error', e);
      // Fail-safe: si falla la consulta, pedir PIN.
    }

    // 3. Pedir PIN vía dialog global
    return new Promise<ActionPinResult>((resolve) => {
      const state: PendingState = {
        actionKey,
        sucursalId: sucursalId ?? null,
        organizationId: orgId!,
        resolve,
      };
      pendingRef.current = state;
      setPending(state);
    });
  }, []);

  const handleValidate = useCallback(async (pin: string) => {
    const cur = pendingRef.current;
    if (!cur) return { success: false } as any;
    try {
      const { data, error } = await supabase.functions.invoke('validate-pin', {
        body: {
          pin,
          sucursal_id: cur.sucursalId,
          action_key: cur.actionKey,
        },
      });
      if (error) throw error;
      if (data?.valid) {
        const result: ActionPinResult = {
          ok: true,
          validatedByUserId: data.validatedByUserId ?? data.barbero_user_id ?? null,
          validatedByRole: data.validatedByRole ?? null,
          userName: data.userName ?? data.user_name ?? null,
        };
        pendingRef.current = null;
        setPending(null);
        cur.resolve(result);
        toast.success('PIN autorizado');
        return { success: true, userName: result.userName ?? undefined };
      }
      return { success: false, error: data?.error || 'PIN incorrecto' } as any;
    } catch (e: any) {
      return { success: false, error: e?.message || 'Error al validar PIN' } as any;
    }
  }, []);

  const handleClose = useCallback(() => {
    const cur = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    if (cur) cur.resolve({ ok: false, cancelled: true });
  }, []);

  return (
    <ActionPinGateContext.Provider value={{ requirePinForAction }}>
      {children}
      <PinGateDialog
        open={pending !== null}
        onValidate={handleValidate}
        onClose={handleClose}
        sectionName={pending ? SUCURSAL_ACTION_LABELS[pending.actionKey] : 'esta acción'}
      />
    </ActionPinGateContext.Provider>
  );
}

export function useRequirePinForAction() {
  const ctx = useContext(ActionPinGateContext);
  if (!ctx) {
    throw new Error('useRequirePinForAction debe usarse dentro de <ActionPinGateProvider>');
  }
  return ctx.requirePinForAction;
}
