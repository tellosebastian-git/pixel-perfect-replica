import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2, AlertCircle, MailX } from 'lucide-react';

type Status = 'loading' | 'error' | 'expired';

/**
 * Espera a que llegue una sesión válida vía onAuthStateChange.
 * Cubre: caché stale de getSession(), procesamiento de hash/code recién recibido.
 */
function waitForSession(timeoutMs: number) {
  return new Promise<Awaited<ReturnType<typeof supabase.auth.getSession>>['data']['session']>((resolve) => {
    let resolved = false;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session && !resolved) {
        resolved = true;
        subscription.unsubscribe();
        resolve(session);
      }
    });
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        subscription.unsubscribe();
        resolve(null);
      }
    }, timeoutMs);
  });
}

export default function AuthCallback() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status>('loading');
  const [slowMessage, setSlowMessage] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const slowTimer = window.setTimeout(() => {
      if (!cancelled) setSlowMessage(true);
    }, 4000);

    const hardTimeout = window.setTimeout(() => {
      if (!cancelled && status === 'loading') {
        setStatus('error');
      }
    }, 8000);

    (async () => {
      try {
        // Detectar errores explícitos de Supabase en URL (link inválido/expirado)
        const hash = window.location.hash || '';
        if (hash.includes('error=') || hash.includes('error_code=')) {
          if (!cancelled) setStatus('expired');
          return;
        }

        // 1) Intentar leer sesión actual
        let { data: sessionData } = await supabase.auth.getSession();
        let session = sessionData.session;

        // 2) Si no hay, esperar evento (Supabase puede estar procesando hash/code)
        if (!session) {
          session = await waitForSession(3000);
        }

        if (!session) {
          if (!cancelled) setStatus('expired');
          return;
        }

        // 3) Re-validar para evitar caché stale de getSession()
        await supabase.auth.refreshSession();
        const { data: userData } = await supabase.auth.getUser();
        const user = userData.user;

        if (!user) {
          if (!cancelled) setStatus('error');
          return;
        }

        if (!user.email_confirmed_at) {
          // Idempotencia: si llegó acá sin verificar, mandarlo a /verify-email
          if (!cancelled) navigate('/verify-email', { replace: true });
          return;
        }

        const userId = user.id;

        if (user.app_metadata?.account_kind === 'partner') {
          localStorage.removeItem('pending_verification_email');
          window.clearTimeout(slowTimer); window.clearTimeout(hardTimeout);
          if (!cancelled) navigate('/aliados/panel', { replace: true });
          return;
        }

        // 4) Resolver organization (multi-tenant, sin hardcoded)
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('organization_id')
          .eq('id', userId)
          .maybeSingle();

        if (profileError || !profile?.organization_id) {
          console.error('AuthCallback: profile/org missing for user', userId, profileError);
          await supabase.auth.signOut();
          toast.error('No encontramos tu organización. Iniciá sesión nuevamente.');
          if (!cancelled) navigate('/login', { replace: true });
          return;
        }

        const { data: org, error: orgError } = await supabase
          .from('organizations')
          .select('slug')
          .eq('id', profile.organization_id)
          .maybeSingle();

        if (orgError || !org?.slug) {
          console.error('AuthCallback: organization slug missing', profile.organization_id, orgError);
          await supabase.auth.signOut();
          toast.error('No pudimos cargar tu organización. Iniciá sesión nuevamente.');
          if (!cancelled) navigate('/login', { replace: true });
          return;
        }

        // Limpieza al éxito
        localStorage.removeItem('pending_verification_email');

        window.clearTimeout(slowTimer);
        window.clearTimeout(hardTimeout);

        if (!cancelled) {
          toast.success('¡Cuenta verificada!');
          navigate(`/app/${org.slug}`, { replace: true });
        }
      } catch (err) {
        console.error('AuthCallback: unexpected error', err);
        if (!cancelled) setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(slowTimer);
      window.clearTimeout(hardTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen bg-white flex items-center justify-center p-6">
      <div className="w-full max-w-sm text-center">
        {status === 'loading' && (
          <>
            <div className="flex justify-center mb-5">
              <Loader2 size={36} className="animate-spin" style={{ color: 'hsl(var(--primary))' }} />
            </div>
            <h1 className="text-lg font-semibold text-slate-900 mb-1">
              Verificando tu cuenta...
            </h1>
            <p className="text-sm text-slate-400">Un momento, por favor.</p>
            {slowMessage && (
              <p className="text-xs text-slate-400 mt-4 animate-pulse">
                Esto está tardando más de lo esperado...
              </p>
            )}
          </>
        )}

        {status === 'expired' && (
          <>
            <div className="flex justify-center mb-5">
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center"
                style={{ background: 'rgba(234,88,12,0.1)' }}
              >
                <MailX size={28} style={{ color: '#ea580c' }} />
              </div>
            </div>
            <h1 className="text-lg font-semibold text-slate-900 mb-2">
              El enlace es inválido o expiró
            </h1>
            <p className="text-sm text-slate-500 mb-6">
              Solicitá un nuevo email de verificación para continuar.
            </p>
            <div className="space-y-3">
              <button
                onClick={() => navigate('/verify-email', { replace: true })}
                className="w-full h-11 rounded-[10px] text-white text-sm font-medium"
                style={{ background: 'hsl(var(--primary))' }}
              >
                Solicitar nuevo email
              </button>
              <button
                onClick={() => navigate('/login', { replace: true })}
                className="w-full h-10 rounded-[10px] text-sm text-slate-500 hover:text-slate-800 transition-colors"
              >
                Volver al login
              </button>
            </div>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="flex justify-center mb-5">
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center"
                style={{ background: 'rgba(220,38,38,0.1)' }}
              >
                <AlertCircle size={28} style={{ color: '#dc2626' }} />
              </div>
            </div>
            <h1 className="text-lg font-semibold text-slate-900 mb-2">
              No pudimos verificar tu cuenta
            </h1>
            <p className="text-sm text-slate-500 mb-6">
              Algo salió mal. Iniciá sesión nuevamente o solicitá un nuevo email.
            </p>
            <button
              onClick={() => navigate('/login', { replace: true })}
              className="w-full h-11 rounded-[10px] text-white text-sm font-medium"
              style={{ background: 'hsl(var(--primary))' }}
            >
              Ir al login
            </button>
          </>
        )}
      </div>
    </div>
  );
}
