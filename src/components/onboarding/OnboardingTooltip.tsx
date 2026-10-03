import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useOnboarding } from './OnboardingProvider';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { useIsMobile } from '@/hooks/use-mobile';
import { ArrowRight, Sparkles, X } from 'lucide-react';

const TOOLTIP_W = 340;
const MARGIN = 16;
/** Aire mínimo entre el card y el borde del viewport */
const EDGE = 12;
/** Altura estimada mientras no hay medición real (primer frame) */
const FALLBACK_H = 300;

type Placement = 'bottom' | 'top' | 'right' | 'left' | 'center';

export function OnboardingTooltip() {
  const { isActive, currentStep, currentIndex, totalSteps, targetRect, targetMissing, next, skip, setTooltipFits } = useOnboarding();
  const isMobile = useIsMobile();
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: TOOLTIP_W, h: FALLBACK_H });
  const [vp, setVp] = useState({
    w: typeof window !== 'undefined' ? window.innerWidth : 1024,
    h: typeof window !== 'undefined' ? window.innerHeight : 768,
  });

  useEffect(() => {
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Medición real del card (alto y ancho) para decidir el lado y aplicar clamp.
  const measure = useCallback(() => {
    const el = cardRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setSize(prev => (Math.abs(prev.h - r.height) < 1 && Math.abs(prev.w - r.width) < 1 ? prev : { w: r.width, h: r.height }));
  }, []);

  useLayoutEffect(() => {
    measure();
    const el = cardRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, currentStep, isMobile, targetMissing]);

  // Al cambiar de paso, volvemos a la estimación conservadora hasta medir.
  useEffect(() => {
    setSize({ w: TOOLTIP_W, h: FALLBACK_H });
  }, [currentStep?.id]);

  // === Cálculo de posición (desktop) ===
  const maxH = Math.max(160, vp.h - EDGE * 2);
  const h = Math.min(size.h, maxH);
  const w = size.w || TOOLTIP_W;

  let placement: Placement = 'center';
  let top = vp.h / 2;
  let left = vp.w / 2;
  let transform = 'translate(-50%, -50%)';

  if (targetRect && !targetMissing) {
    const spaceBelow = vp.h - targetRect.bottom;
    const spaceAbove = targetRect.top;
    const spaceRight = vp.w - targetRect.right;
    const spaceLeft = targetRect.left;
    const needV = h + MARGIN + EDGE;
    const needH = w + MARGIN + EDGE;

    if (spaceBelow >= needV) placement = 'bottom';
    else if (spaceAbove >= needV) placement = 'top';
    else if (spaceRight >= needH) placement = 'right';
    else if (spaceLeft >= needH) placement = 'left';
    else placement = 'center';

    if (placement === 'bottom' || placement === 'top') {
      left = targetRect.left + targetRect.width / 2;
      const halfW = w / 2;
      left = Math.min(Math.max(left, halfW + EDGE), vp.w - halfW - EDGE);
      transform = placement === 'bottom' ? 'translate(-50%, 0)' : 'translate(-50%, -100%)';
      top = placement === 'bottom' ? targetRect.bottom + MARGIN : targetRect.top - MARGIN;
      // Clamp vertical: el card siempre entra completo.
      if (placement === 'bottom') top = Math.min(top, vp.h - h - EDGE);
      else top = Math.max(top, h + EDGE);
      top = placement === 'bottom' ? Math.max(top, EDGE) : Math.min(top, vp.h - EDGE);
    } else if (placement === 'right' || placement === 'left') {
      transform = placement === 'right' ? 'translate(0, -50%)' : 'translate(-100%, -50%)';
      left = placement === 'right' ? targetRect.right + MARGIN : targetRect.left - MARGIN;
      left = placement === 'right'
        ? Math.min(left, vp.w - w - EDGE)
        : Math.max(left, w + EDGE);
      const halfH = h / 2;
      top = targetRect.top + targetRect.height / 2;
      top = Math.min(Math.max(top, halfH + EDGE), vp.h - halfH - EDGE);
    }
  }

  const fits = placement !== 'center';

  // Informamos al provider si el tooltip entra donde corresponde: si no entra,
  // el provider libera el bloqueo de scroll para que el usuario nunca quede trabado.
  useEffect(() => {
    if (!isActive) return;
    setTooltipFits?.(isMobile || !!currentStep?.isWelcome || targetMissing || fits);
  }, [isActive, isMobile, currentStep, targetMissing, fits, setTooltipFits]);

  useEffect(() => () => setTooltipFits?.(true), [setTooltipFits]);


  if (!isActive || !currentStep) return null;

  const stepLabel = (
    <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
      Paso {currentIndex + 1} de {totalSteps}
    </span>
  );

  const bullets = currentStep.bullets && currentStep.bullets.length > 0 && (
    <ul className="mt-3 space-y-1.5">
      {currentStep.bullets.map((b, i) => (
        <li key={i} className="flex gap-2 text-sm text-foreground">
          <span className="mt-1.5 h-1 w-1 rounded-full bg-primary shrink-0" />
          <span className="leading-relaxed">{b}</span>
        </li>
      ))}
    </ul>
  );

  // === Paso de bienvenida: diálogo centrado ===
  if (currentStep.isWelcome) {
    return (
      <Dialog open onOpenChange={(open) => { if (!open) skip(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary mb-2">
              <Sparkles className="h-5 w-5" />
            </div>
            <DialogTitle>{currentStep.title}</DialogTitle>
            <DialogDescription className="leading-relaxed pt-1">
              {currentStep.description}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="ghost" onClick={skip} className="sm:mr-auto">
              Omitir por ahora
            </Button>
            <Button onClick={next} className="gap-1.5">
              Empezar recorrido
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // === Target ausente: fallback centrado, siempre con salida ===
  if (targetMissing) {
    return (
      <Dialog open onOpenChange={(open) => { if (!open) skip(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            {stepLabel}
            <DialogTitle>{currentStep.title}</DialogTitle>
            <DialogDescription className="leading-relaxed pt-1">
              {currentStep.description}
            </DialogDescription>
          </DialogHeader>

          {currentStep.bullets && currentStep.bullets.length > 0 && (
            <ul className="space-y-1.5">
              {currentStep.bullets.map((b, i) => (
                <li key={i} className="flex gap-2 text-sm text-foreground">
                  <span className="mt-1.5 h-1 w-1 rounded-full bg-primary shrink-0" />
                  <span className="leading-relaxed">{b}</span>
                </li>
              ))}
            </ul>
          )}

          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="ghost" onClick={skip} className="sm:mr-auto">
              Omitir tutorial
            </Button>
            <Button onClick={next} className="gap-1.5">
              Continuar
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  const footer = (
    <div className="flex items-center justify-between mt-4 pt-3 border-t border-border shrink-0">
      <button
        onClick={skip}
        className="text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        Omitir tutorial
      </button>
      {currentStep.hideContinueButton ? (
        <span className="text-xs text-muted-foreground italic">
          {isMobile ? 'Tocá para continuar' : 'Elegí una sucursal para continuar'}
        </span>
      ) : (
        <Button size="sm" onClick={next} className="gap-1.5">
          Continuar
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );

  const closeButton = (
    <button
      type="button"
      onClick={skip}
      aria-label="Cerrar tutorial"
      className="absolute right-2.5 top-2.5 rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
    >
      <X className="h-3.5 w-3.5" />
    </button>
  );

  // === Mobile: bottom sheet fijo ===
  if (isMobile) {
    return (
      <div className="fixed inset-x-0 bottom-0 z-[70] animate-fade-in px-3 pb-3 pt-2">
        <div
          ref={cardRef}
          className="relative rounded-2xl border border-border bg-popover text-popover-foreground shadow-md p-4 flex flex-col"
          style={{ maxHeight: vp.h - 80 }}
        >
          {closeButton}
          <div className="flex items-center justify-between mb-1.5 pr-7 shrink-0">
            {stepLabel}
          </div>
          <div className="min-h-0 overflow-y-auto">
            <h3 className="text-base font-semibold text-foreground pr-7">{currentStep.title}</h3>
            <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{currentStep.description}</p>
            {bullets}
          </div>
          {footer}
        </div>
      </div>
    );
  }

  // === Desktop: tooltip posicionado sobre el target (con flip + clamp) ===
  const arrow: 'top' | 'bottom' | 'left' | 'right' | null =
    placement === 'bottom' ? 'top'
    : placement === 'top' ? 'bottom'
    : placement === 'right' ? 'left'
    : placement === 'left' ? 'right'
    : null;

  // Con el clamp aplicado la flecha puede dejar de apuntar al target: la ocultamos.
  const arrowAligned =
    !!targetRect && (
      (placement === 'bottom' && Math.abs(top - (targetRect.bottom + MARGIN)) < 2) ||
      (placement === 'top' && Math.abs(top - (targetRect.top - MARGIN)) < 2) ||
      (placement === 'right' && Math.abs(left - (targetRect.right + MARGIN)) < 2) ||
      (placement === 'left' && Math.abs(left - (targetRect.left - MARGIN)) < 2)
    );

  return (
    <div
      className="fixed z-[70] animate-fade-in"
      style={{ top, left, transform, width: TOOLTIP_W }}
    >
      <div
        ref={cardRef}
        className="relative rounded-xl border border-border bg-popover text-popover-foreground shadow-md p-4 flex flex-col"
        style={{ maxHeight: maxH }}
      >
        {arrow && arrowAligned && <Arrow direction={arrow} />}
        {closeButton}
        <div className="flex items-center justify-between mb-2 pr-7 shrink-0">
          {stepLabel}
        </div>
        <div className="min-h-0 overflow-y-auto">
          <h3 className="text-base font-semibold text-foreground pr-7">{currentStep.title}</h3>
          <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{currentStep.description}</p>
          {bullets}
        </div>
        {footer}
      </div>
    </div>
  );
}

function Arrow({ direction }: { direction: 'top' | 'bottom' | 'left' | 'right' }) {
  const base = 'absolute w-3 h-3 bg-popover border-border rotate-45';
  const map = {
    top: `${base} -top-1.5 left-1/2 -translate-x-1/2 border-l border-t`,
    bottom: `${base} -bottom-1.5 left-1/2 -translate-x-1/2 border-r border-b`,
    left: `${base} -left-1.5 top-1/2 -translate-y-1/2 border-l border-b`,
    right: `${base} -right-1.5 top-1/2 -translate-y-1/2 border-r border-t`,
  } as const;
  return <div className={map[direction]} />;
}
