import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, ReactNode } from 'react';
import { ONBOARDING_STEPS, OnboardingStep, OnboardingSubTab, OnboardingEvent } from './steps';
import { useOnboardingState } from '@/hooks/useOnboardingState';
import { useAuth } from '@/contexts/AuthContext';
import { useIsMobile } from '@/hooks/use-mobile';

/** Tiempo máximo de espera a que el target de un paso aparezca en el DOM. */
const TARGET_TIMEOUT_MS = 1500;

interface OnboardingContextValue {
  isActive: boolean;
  currentStep: OnboardingStep | null;
  currentIndex: number;
  totalSteps: number;
  targetRect: DOMRect | null;
  /** true cuando el target del paso no apareció en el DOM dentro del timeout */
  targetMissing: boolean;
  next: () => void;
  skip: () => void;
  restart: () => void;
  isAllowedTab: (tabId: string) => boolean;
  registerTabSetter: (fn: ((tab: string) => void) | null) => void;
  registerSubTabSetter: (fn: ((kind: OnboardingSubTab) => void) | null) => void;
  /** Permite al onboarding abrir secciones colapsadas antes de mostrar un paso */
  registerSectionOpener: (id: string, fn: (() => void) | null) => void;
  /** Permite consultar si la sub-tab activa corresponde a una sucursal válida */
  registerSubTabProbe: (fn: (() => boolean) | null) => void;
  /** El tooltip informa si entra completo en el viewport; si no, se libera el scroll */
  setTooltipFits: (fits: boolean) => void;
  notifyEvent: (event: OnboardingEvent) => void;
}


const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export function useOnboarding() {
  const ctx = useContext(OnboardingContext);
  if (!ctx) throw new Error('useOnboarding must be used within OnboardingProvider');
  return ctx;
}

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const { row, isLoading, upsert } = useOnboardingState();
  const { isOwner, isGeneralManager } = useAuth();
  const isMobile = useIsMobile();
  const canSeeOnboarding = isOwner || isGeneralManager;
  const steps = useMemo(
    () => ONBOARDING_STEPS.filter(s => (isMobile ? !s.hideOnMobile : !s.hideOnDesktop)),
    [isMobile]
  );
  const tabSetterRef = useRef<((tab: string) => void) | null>(null);
  const subTabSetterRef = useRef<((kind: OnboardingSubTab) => void) | null>(null);
  const sectionOpenersRef = useRef<Map<string, () => void>>(new Map());
  const subTabProbeRef = useRef<(() => boolean) | null>(null);
  const autoAdvancedForStepRef = useRef<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState<number>(-1);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [targetMissing, setTargetMissing] = useState(false);
  const [tooltipFits, setTooltipFits] = useState(true);


  const isActive = currentIndex >= 0 && currentIndex < steps.length;
  const currentStep = isActive ? steps[currentIndex] : null;

  const next = useCallback(() => {
    setCurrentIndex(idx => {
      const nextIdx = idx + 1;
      const completedId = steps[idx]?.id;
      const newCompleted = completedId
        ? Array.from(new Set([...(row?.completed_steps ?? []), completedId]))
        : (row?.completed_steps ?? []);
      if (nextIdx >= steps.length) {
        upsert({
          status: 'completed',
          current_step: null,
          completed_steps: newCompleted,
          completed_at: new Date().toISOString(),
        });
        return -1;
      }
      upsert({
        status: 'in_progress',
        current_step: steps[nextIdx].id,
        completed_steps: newCompleted,
      });
      return nextIdx;
    });
  }, [row, upsert, steps]);

  const skip = useCallback(() => {
    setCurrentIndex(-1);
    upsert({ status: 'skipped', current_step: null, completed_at: new Date().toISOString() });
  }, [upsert]);

  const restart = useCallback(() => {
    autoAdvancedForStepRef.current = null;
    upsert({
      status: 'in_progress',
      current_step: steps[0].id,
      completed_steps: [],
      started_at: new Date().toISOString(),
      completed_at: null,
    });
    setCurrentIndex(0);
  }, [upsert, steps]);

  // Auto-start for owners
  useEffect(() => {
    if (isLoading || !canSeeOnboarding) return;
    if (currentIndex !== -1) return;
    const status = row?.status ?? 'pending';
    if (status === 'completed' || status === 'skipped') return;
    const resumeId = row?.current_step;
    const resumeIdx = resumeId ? steps.findIndex(s => s.id === resumeId) : 0;
    setCurrentIndex(resumeIdx >= 0 ? resumeIdx : 0);
    if (status === 'pending') {
      upsert({ status: 'in_progress', started_at: new Date().toISOString(), current_step: steps[0].id });
    }
  }, [isLoading, canSeeOnboarding, row, currentIndex, upsert, steps]);

  // Auto-avance por condición del paso.
  // IMPORTANTE: este efecto se declara ANTES del que aplica requiredTab/miNegocioSubTab,
  // para que la consulta al probe le gane al forzado de la sub-tab "general".
  useEffect(() => {
    if (!currentStep) return;
    if (currentStep.autoAdvanceIf !== 'on-sucursal-tab') return;
    if (autoAdvancedForStepRef.current === currentStep.id) return;
    if (subTabProbeRef.current?.()) {
      autoAdvancedForStepRef.current = currentStep.id;
      next();
    }
  }, [currentStep, next]);

  // Apply requiredTab + sub-tab + apertura de secciones colapsadas on step change
  useEffect(() => {
    if (!currentStep) return;
    // Si este paso ya se auto-avanzó, no forzamos nada.
    if (autoAdvancedForStepRef.current === currentStep.id) return;

    if (currentStep.requiresOpen) {
      sectionOpenersRef.current.get(currentStep.requiresOpen)?.();
    }
    if (currentStep.requiredTab && tabSetterRef.current) {
      tabSetterRef.current(currentStep.requiredTab);
    }
    if (currentStep.miNegocioSubTab && subTabSetterRef.current) {
      // Pequeño delay para esperar que el panel se monte si recién se cambió la tab principal
      const t = setTimeout(() => {
        subTabSetterRef.current?.(currentStep.miNegocioSubTab!);
        // El opener puede haberse registrado recién ahora (panel montado tarde).
        if (currentStep.requiresOpen) {
          setTimeout(() => sectionOpenersRef.current.get(currentStep.requiresOpen!)?.(), 80);
        }
      }, 60);
      return () => clearTimeout(t);
    }
  }, [currentStep]);

  // Track target rect (+ detección de target ausente)
  useEffect(() => {
    if (!currentStep || currentStep.isWelcome) { setTargetRect(null); setTargetMissing(false); return; }
    setTargetMissing(false);
    let raf = 0;
    let found = false;
    let timedOut = false;
    const startedAt = performance.now();
    const update = () => {
      const el = document.querySelector(`[data-onboarding-id="${currentStep.targetId}"]`) as HTMLElement | null;
      if (el) {
        if (!found) { found = true; setTargetMissing(false); }
        const r = el.getBoundingClientRect();
        setTargetRect(prev => {
          if (prev && prev.top === r.top && prev.left === r.left && prev.width === r.width && prev.height === r.height) return prev;
          return r;
        });
      } else {
        setTargetRect(null);
        if (!found && !timedOut && performance.now() - startedAt > TARGET_TIMEOUT_MS) {
          timedOut = true;
          console.error(
            `[Onboarding] Target ausente para el paso "${currentStep.id}" (data-onboarding-id="${currentStep.targetId}")`
          );
          if (currentStep.optionalTarget) {
            next();
          } else {
            setTargetMissing(true);
          }
        }
      }
    };
    const tick = () => { update(); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    // Scroll del target dejando aire para el tooltip.
    // Un target alto (por ejemplo un colapsable recién abierto) centrado deja su
    // borde inferior debajo del centro y no queda lugar para el card: en ese caso
    // lo alineamos arriba.
    let lastScrolledH = -1;
    const scrollTargetIntoView = () => {
      const el = document.querySelector(`[data-onboarding-id="${currentStep.targetId}"]`) as HTMLElement | null;
      if (!el) return;
      const h = el.getBoundingClientRect().height;
      lastScrolledH = h;
      const block: ScrollLogicalPosition = h > window.innerHeight * 0.45 ? 'start' : 'center';
      el.scrollIntoView({ behavior: 'smooth', block });
    };
    const scrollT = setTimeout(scrollTargetIntoView, 200);
    // Si el target cambia de tamaño (animación del colapsable), reajustamos.
    const resizeT = setInterval(() => {
      const el = document.querySelector(`[data-onboarding-id="${currentStep.targetId}"]`) as HTMLElement | null;
      if (!el || lastScrolledH < 0) return;
      const h = el.getBoundingClientRect().height;
      if (Math.abs(h - lastScrolledH) > 40) scrollTargetIntoView();
    }, 250);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(scrollT);
      clearInterval(resizeT);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [currentStep, next]);

  // Bloqueo de scroll del usuario mientras el tour está activo.
  // Se activa por `isActive` (no por paso), así cubre también la transición
  // entre un paso y el siguiente: nunca hay una ventana sin bloqueo.
  // Se bloquea la interacción (wheel / touch / teclas de scroll) en lugar de
  // usar overflow:hidden, para que el scrollIntoView programático siga funcionando.
  // Excepción: si el tooltip no entra completo en el viewport, se libera el scroll
  // para que el usuario nunca quede sin forma de alcanzar el contenido.
  useEffect(() => {
    if (!isActive || !tooltipFits) return;
    const prevent = (e: Event) => { e.preventDefault(); };
    const SCROLL_KEYS = new Set([
      'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Spacebar',
    ]);
    const onKeyDown = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || t?.isContentEditable) return;
      if (SCROLL_KEYS.has(e.key)) e.preventDefault();
    };
    window.addEventListener('wheel', prevent, { passive: false });
    window.addEventListener('touchmove', prevent, { passive: false });
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('wheel', prevent);
      window.removeEventListener('touchmove', prevent);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isActive, tooltipFits]);

  // Escape siempre omite el tour, desde cualquier paso.
  useEffect(() => {
    if (!isActive) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') skip();
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [isActive, skip]);





  const isAllowedTab = useCallback((tabId: string) => {
    if (!currentStep) return true;
    if (currentStep.requiredTab && tabId === currentStep.requiredTab) return true;
    if (currentStep.allowedTabs?.includes(tabId)) return true;
    if (currentStep.id === 's1_sidebar' && tabId === 'mi-negocio') return true;
    return false;
  }, [currentStep]);

  const registerTabSetter = useCallback((fn: ((tab: string) => void) | null) => {
    tabSetterRef.current = fn;
  }, []);

  const registerSubTabSetter = useCallback((fn: ((kind: OnboardingSubTab) => void) | null) => {
    subTabSetterRef.current = fn;
  }, []);

  const registerSectionOpener = useCallback((id: string, fn: (() => void) | null) => {
    if (fn) sectionOpenersRef.current.set(id, fn);
    else sectionOpenersRef.current.delete(id);
  }, []);

  const registerSubTabProbe = useCallback((fn: (() => boolean) | null) => {
    subTabProbeRef.current = fn;
  }, []);

  const notifyEvent = useCallback((event: OnboardingEvent) => {
    if (currentStep?.advanceOnEvent === event) {
      next();
    }
  }, [currentStep, next]);

  const value = useMemo<OnboardingContextValue>(() => ({
    isActive,
    currentStep,
    currentIndex,
    totalSteps: steps.length,
    targetRect,
    targetMissing,
    next,
    skip,
    restart,
    isAllowedTab,
    registerTabSetter,
    registerSubTabSetter,
    registerSectionOpener,
    registerSubTabProbe,
    setTooltipFits,
    notifyEvent,
  }), [isActive, currentStep, currentIndex, steps.length, targetRect, targetMissing, next, skip, restart, isAllowedTab, registerTabSetter, registerSubTabSetter, registerSectionOpener, registerSubTabProbe, notifyEvent]);


  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}
