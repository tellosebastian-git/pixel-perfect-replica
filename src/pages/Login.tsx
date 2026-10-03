import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useOrganization } from '@/contexts/OrganizationContext';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Scissors, Store, Globe, ArrowRight, ArrowLeft, Eye, EyeOff, Sparkles } from 'lucide-react';
import { perfEvent } from '@/lib/perfLog';
import { CookieConsentBanner } from '@/components/consent/CookieConsentBanner';
import { useMetaPixel } from '@/hooks/useMetaPixel';
import { trackMetaEvent } from '@/lib/analytics/metaPixel';

const PLANS = [
  { id: 'basico',      label: 'Básico',      price: '$30.000'  },
  { id: 'profesional', label: 'Profesional', price: '$50.000'  },
  { id: 'premium',     label: 'Premium',     price: '$100.000' },
] as const;
type PlanId = typeof PLANS[number]['id'];
import { supabase } from '@/integrations/supabase/client';
import { COUNTRIES } from '@/lib/dateUtils';


export default function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { signIn, signUp, authError } = useAuth();
  const { organization, error: orgError } = useOrganization();
  const [isLoading, setIsLoading] = useState(false);
  const [mode, setMode] = useState<'login' | 'register'>(
    searchParams.get('mode') === 'signup' ? 'register' : 'login'
  );
  const [showPassword, setShowPassword] = useState(false);
  // Cuando true: signIn ya tuvo éxito y estamos esperando que el contexto
  // cargue la organización para navegar a /app/<slug>.
  const [waitingOrg, setWaitingOrg] = useState(false);

  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  const [registerEmail, setRegisterEmail] = useState('');
  const [registerPassword, setRegisterPassword] = useState('');
  const [registerName, setRegisterName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [country, setCountry] = useState('AR');
  const [plan, setPlan] = useState<PlanId>('basico');

  useMetaPixel(import.meta.env.VITE_META_PIXEL_ID);

  // Watcher post-login: cuando la org carga, navegamos. Si hay error de auth/org,
  // mostramos toast y soltamos el botón. Si pasa el timeout local de seguridad,
  // mandamos al usuario a la pantalla recuperable de la app.
  const watchdogRef = useRef<number | null>(null);
  useEffect(() => {
    if (!waitingOrg) return;

    // Éxito: tenemos org → navegar.
    if (organization?.slug) {
      perfEvent('postAuth:navigate', { slug: organization.slug });
      navigate(`/app/${organization.slug}`, { replace: true });
      setWaitingOrg(false);
      setIsLoading(false);
      return;
    }

    // Error claro (auth o org): permitir reintentar desde el form.
    const err = authError ?? orgError;
    if (err) {
      perfEvent('postAuth:error', { error: err });
      toast.error('Tu sesión se inició, pero hubo un problema cargando tu cuenta', { description: err });
      setWaitingOrg(false);
      setIsLoading(false);
      return;
    }

    // Watchdog de seguridad: si en 20s no hubo ni org ni error, mandamos al
    // usuario al app igual; ProtectedRoute mostrará LoadingScreen o la
    // pantalla recuperable según corresponda. Nunca redirigimos silenciosamente a "/".
    if (watchdogRef.current == null) {
      watchdogRef.current = window.setTimeout(() => {
        perfEvent('postAuth:watchdog-handoff');
        toast.info('Estamos terminando de cargar tu cuenta...');
        navigate('/app/_', { replace: true });
        setWaitingOrg(false);
        setIsLoading(false);
      }, 20000);
    }

    return () => {
      if (watchdogRef.current != null) {
        clearTimeout(watchdogRef.current);
        watchdogRef.current = null;
      }
    };
  }, [waitingOrg, organization?.slug, authError, orgError, navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const { error } = await signIn(loginEmail, loginPassword);
      if (error) {
        toast.error('Error al iniciar sesión', {
          description: error.message === 'Invalid login credentials'
            ? 'Email o contraseña incorrectos'
            : error.message,
        });
        setIsLoading(false);
        return;
      }

      toast.success('¡Bienvenido!');
      perfEvent('postAuth:waiting-org');
      // No re-consultamos profile/org acá. AuthContext + OrganizationContext
      // ya están hidratando. El useEffect de arriba navega cuando la org esté lista.
      setWaitingOrg(true);
    } catch (err) {
      console.error('[Login] handleLogin:error', err);
      toast.error('Ocurrió un error al ingresar. Probá de nuevo.');
      setIsLoading(false);
    }
  };


  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    if (registerPassword.length < 6) {
      toast.error('La contraseña debe tener al menos 6 caracteres');
      setIsLoading(false);
      return;
    }
    if (!businessName.trim()) {
      toast.error('Ingresá el nombre de tu barbería');
      setIsLoading(false);
      return;
    }
    // Forzar cierre de sesión previa para que no se herede la org de otro usuario
    try { await supabase.auth.signOut(); } catch {}

    // Guardar email para la pantalla de verificación (limpiado tras éxito)
    localStorage.setItem('pending_verification_email', registerEmail);

    const { error } = await signUp(registerEmail, registerPassword, registerName, businessName, country, plan);
    if (error) {
      toast.error('Error al registrarse', { description: error.message });
      setIsLoading(false);
      return;
    }

    trackMetaEvent(import.meta.env.VITE_META_PIXEL_ID, 'CompleteRegistration');

    // Si Supabase devolvió sesión inmediata (verificación deshabilitada), pasar por el callback
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      navigate('/auth/callback', { replace: true });
    } else {
      navigate('/verify-email', { replace: true });
    }
    setIsLoading(false);
  };

  const handleForgotPassword = async () => {
    if (!loginEmail) {
      toast.error('Ingresá tu email primero');
      return;
    }
    const { error } = await supabase.auth.resetPasswordForEmail(loginEmail, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) {
      toast.error('Error al enviar el email', { description: error.message });
    } else {
      toast.success('Email enviado', {
        description: 'Revisá tu bandeja de entrada para resetear tu contraseña',
      });
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-white lg:flex-row">

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .animate-in { animation: fadeIn 0.4s ease both; }
        .input-field {
          width: 100%;
          height: 42px;
          padding: 0 14px;
          border: 1px solid #e2e8f0;
          border-radius: 10px;
          font-size: 16px; /* evita el auto-zoom de Safari/iOS en mobile */
          color: #0f172a;
          background: #fff;
          transition: border-color 0.15s, box-shadow 0.15s;
          outline: none;
        }
        @media (min-width: 768px) {
          .input-field {
            font-size: 14px; /* desktop igual que hoy */
          }
        }
        .input-field:focus {
          border-color: hsl(var(--primary));
          box-shadow: 0 0 0 3px rgba(30,42,74,0.08);
        }
        .input-field::placeholder { color: #94a3b8; }
        .submit-btn {
          width: 100%;
          height: 44px;
          background: hsl(var(--primary));
          color: #fff;
          border: none;
          border-radius: 10px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          transition: background 0.15s, opacity 0.15s;
        }
        .submit-btn:hover:not(:disabled) { background: #2a3a60; }
        .submit-btn:disabled { opacity: 0.6; cursor: not-allowed; }
        .tab-btn {
          flex: 1;
          padding: 8px;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 500;
          border: none;
          background: transparent;
          color: #64748b;
          cursor: pointer;
          transition: all 0.2s;
        }
        .tab-btn.active {
          background: #fff;
          color: #0f172a;
          box-shadow: 0 1px 4px rgba(0,0,0,0.08);
        }
      `}</style>

      {/* ── Left panel — branding ────────────────────────────────────────── */}
      <div
        className="hidden lg:flex flex-col justify-between w-[480px] flex-shrink-0 p-10"
        style={{ background: 'hsl(var(--primary))' }}
      >
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2.5">
           <img 
              src="/MagotipoBlanco.png" 
              alt="Logo Vittro" 
              className="h-20 w-auto object-contain"
              />
        </Link>

        {/* Center content */}
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 text-white/70 text-xs mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            Sistema de gestión para barberías
          </div>
          <h2 className="text-3xl font-semibold text-white leading-tight mb-4 tracking-tight">
            Todo lo que necesitás<br />para operar tu barbería
          </h2>
          <p className="text-white/50 text-sm leading-relaxed mb-8">
            Cobros, cierre de caja, comisiones, estadísticas y agenda online. Sin planillas, sin estimaciones.
          </p>

          {/* Mini feature list */}
          <div className="space-y-3">
            {[
              { icon: '▦', label: 'Cierre de caja por barbero' },
              { icon: '↗', label: 'Estadísticas y facturación real' },
              { icon: '📅', label: 'Agenda online sin WhatsApp' },
              { icon: '%', label: 'Comisiones calculadas automáticamente' },
            ].map(f => (
              <div key={f.label} className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-md bg-white/10 flex items-center justify-center text-[11px] text-white/70">
                  {f.icon}
                </div>
                <span className="text-white/70 text-sm">{f.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom */}
        <p className="text-white/30 text-xs">© {new Date().getFullYear()} Vittro</p>
      </div>

      {/* ── Right panel — form ───────────────────────────────────────────── */}
      <div className="flex flex-1 items-center justify-center px-4 py-8 sm:px-6 lg:p-6">
        <div className="w-full max-w-sm animate-in sm:max-w-md">

          {/* Mobile logo */}
          <div className="mb-8 flex items-center justify-center gap-2 lg:hidden">
           <img 
              src="/MagotipoAzul.png" 
              alt="Logo Vittro" 
              className="h-12 w-auto object-contain"
              />
          </div>

          <div className="mb-8 rounded-2xl border border-slate-200 bg-slate-50/80 p-4 lg:hidden">
            <p className="text-sm font-medium text-slate-900">Cobros, caja, agenda y estadísticas en un solo lugar.</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              Empezá desde el celular sin que el acceso quede apretado o pierda contexto.
            </p>
          </div>

          {/* Heading */}
          <div className="mb-7">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 mb-1">
              {mode === 'login' ? 'Bienvenido de nuevo' : 'Creá tu barbería'}
            </h1>
            <p className="text-sm text-slate-400">
              {mode === 'login'
                ? 'Ingresá a tu cuenta para continuar'
                : 'Empezás gratis, sin tarjeta de crédito'}
            </p>
          </div>

          {/* Tab switcher */}
          <div className="flex gap-1 p-1 bg-slate-100 rounded-xl mb-6">
            <button className={`tab-btn ${mode === 'login' ? 'active' : ''}`} onClick={() => setMode('login')}>
              Iniciar sesión
            </button>
            <button className={`tab-btn ${mode === 'register' ? 'active' : ''}`} onClick={() => setMode('register')}>
              Registrarse
            </button>
          </div>

          {/* ── LOGIN FORM ── */}
          {mode === 'login' && (
            <form onSubmit={handleLogin} className="space-y-4 animate-in">
              <div>
                <Label htmlFor="login-email" className="text-xs font-medium text-slate-600 mb-1.5 block">
                  Email
                </Label>
                <input
                  id="login-email"
                  type="email"
                  placeholder="tu@email.com"
                  value={loginEmail}
                  onChange={e => setLoginEmail(e.target.value)}
                  className="input-field"
                  required
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <Label htmlFor="login-password" className="text-xs font-medium text-slate-600">
                    Contraseña
                  </Label>
                  <button
                    type="button"
                    onClick={handleForgotPassword}
                    className="text-xs text-slate-400 hover:text-slate-700 transition-colors"
                  >
                    ¿Olvidaste tu contraseña?
                  </button>
                </div>
                <div className="relative">
                  <input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={loginPassword}
                    onChange={e => setLoginPassword(e.target.value)}
                    className="input-field pr-10"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              <button type="submit" className="submit-btn" disabled={isLoading}>
                {isLoading ? 'Ingresando...' : (<>Ingresar <ArrowRight size={15} /></>)}
              </button>

              <p className="text-center text-xs text-slate-400">
                ¿No tenés cuenta?{' '}
                <button type="button" onClick={() => setMode('register')} className="text-primary font-medium hover:underline">
                  Registrate gratis
                </button>
              </p>
            </form>
          )}

          {/* ── REGISTER FORM ── */}
          {mode === 'register' && (
            <form onSubmit={handleRegister} className="space-y-4 animate-in">
              <div>
                <Label htmlFor="country" className="text-xs font-medium text-slate-600 mb-1.5 flex items-center gap-1">
                  <Globe size={12} /> País
                </Label>
                <Select value={country} onValueChange={setCountry}>
                  <SelectTrigger id="country" className="h-[42px] rounded-[10px] border-slate-200 text-sm">
                    <SelectValue placeholder="Seleccionar país" />
                  </SelectTrigger>
                  <SelectContent>
                    {COUNTRIES.map(c => (
                      <SelectItem key={c.code} value={c.code}>
                        <span className="flex items-center gap-2">
                          <span>{c.flag}</span>
                          <span>{c.name}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Plan persistido en organizations.plan vía business_plan en raw_user_meta_data */}
              <div>
                <Label htmlFor="plan" className="text-xs font-medium text-slate-600 mb-1.5 flex items-center gap-1">
                  <Sparkles size={12} /> Plan
                </Label>
                <Select value={plan} onValueChange={(v) => setPlan(v as PlanId)}>
                  <SelectTrigger id="plan" className="h-[42px] rounded-[10px] border-slate-200 text-sm">
                    <SelectValue>
                      {(() => {
                        const p = PLANS.find(p => p.id === plan)!;
                        return (
                          <span className="flex min-w-0 flex-wrap items-center gap-2">
                            <span className="font-medium">{p.label}</span>
                            <span
                              className="text-white text-[11px] font-semibold px-1.5 py-0.5 rounded"
                              style={{ background: 'rgb(30, 42, 74)' }}
                            >
                              Gratis
                            </span>
                            <span className="text-slate-400 text-xs break-words">
                              <span className="line-through">{p.price}</span> después del primer mes
                            </span>
                          </span>
                        );
                      })()}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {PLANS.map(p => (
                      <SelectItem key={p.id} value={p.id}>
                        <span className="flex items-center gap-2">
                          <span className="font-medium">{p.label}</span>
                          <span
                            className="text-white text-[11px] font-semibold px-1.5 py-0.5 rounded"
                            style={{ background: 'rgb(30, 42, 74)' }}
                          >
                            Gratis
                          </span>
                          <span className="text-slate-400 text-xs">
                            <span className="line-through">{p.price}</span> después del primer mes
                          </span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="business-name" className="text-xs font-medium text-slate-600 mb-1.5 flex items-center gap-1">
                  <Store size={12} /> Nombre de tu barbería
                </Label>
                <input
                  id="business-name"
                  type="text"
                  placeholder="Ej: Sir Fausto, Barbería Premium..."
                  value={businessName}
                  onChange={e => setBusinessName(e.target.value)}
                  className="input-field"
                  required
                />
              </div>

              <div>
                <Label htmlFor="register-name" className="text-xs font-medium text-slate-600 mb-1.5 block">
                  Tu nombre completo
                </Label>
                <input
                  id="register-name"
                  type="text"
                  placeholder="Juan Pérez"
                  value={registerName}
                  onChange={e => setRegisterName(e.target.value)}
                  className="input-field"
                  required
                />
              </div>

              <div>
                <Label htmlFor="register-email" className="text-xs font-medium text-slate-600 mb-1.5 block">
                  Email
                </Label>
                <input
                  id="register-email"
                  type="email"
                  placeholder="tu@email.com"
                  value={registerEmail}
                  onChange={e => setRegisterEmail(e.target.value)}
                  className="input-field"
                  required
                />
              </div>

              <div>
                <Label htmlFor="register-password" className="text-xs font-medium text-slate-600 mb-1.5 block">
                  Contraseña
                </Label>
                <div className="relative">
                  <input
                    id="register-password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••  (mín. 6 caracteres)"
                    value={registerPassword}
                    onChange={e => setRegisterPassword(e.target.value)}
                    className="input-field pr-10"
                    required
                    minLength={6}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              <button type="submit" className="submit-btn" disabled={isLoading}>
                {isLoading ? 'Creando cuenta...' : (<>Crear mi barbería <ArrowRight size={15} /></>)}
              </button>

              <p className="text-center text-[11px] text-slate-400 leading-relaxed">
                Al registrarte, se creará tu barbería con un plan gratuito.
              </p>

              <p className="text-center text-xs text-slate-400">
                ¿Ya tenés cuenta?{' '}
                <button type="button" onClick={() => setMode('login')} className="text-primary font-medium hover:underline">
                  Iniciá sesión
                </button>
              </p>
            </form>
          )}

        </div>
      </div>

      <CookieConsentBanner />
    </div>
  );
}
