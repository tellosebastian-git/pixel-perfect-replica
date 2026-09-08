import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { AlertTriangle, BadgeDollarSign, Eye, EyeOff, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { CurrencyInput } from '@/components/ui/currency-input';
import { DrawerForm, DrawerFormSection } from '@/components/ui/drawer-form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import type {
  PlatformAdminPlanDto,
  PlatformAdminPriceApplyInput,
  PlatformAdminPriceApplyResponse,
  PlatformAdminPricePreviewResponse,
} from '@/types/platformAdmin';
import { formatAdminMoney } from '@/admin/adminFormatters';

interface PriceChangeDrawerProps {
  open: boolean;
  plan: PlatformAdminPlanDto | null;
  onOpenChange: (open: boolean) => void;
  onPreview: (planCode: string) => Promise<PlatformAdminPricePreviewResponse>;
  onApply: (input: PlatformAdminPriceApplyInput) => Promise<PlatformAdminPriceApplyResponse>;
  onApplied: (result: PlatformAdminPriceApplyResponse) => void;
}

interface FieldErrors {
  amount?: string;
  reason?: string;
  password?: string;
  confirmation?: string;
}

export function PriceChangeDrawer({
  open,
  plan,
  onOpenChange,
  onPreview,
  onApply,
  onApplied,
}: PriceChangeDrawerProps) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [password, setPassword] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [preview, setPreview] = useState<PlatformAdminPricePreviewResponse | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});

  const isDirty = useMemo(() => {
    if (!plan) return false;
    return amount !== String(plan.amountArs) || Boolean(reason || password || confirmed);
  }, [amount, confirmed, password, plan, reason]);

  useEffect(() => {
    if (!open) {
      setPassword('');
      setShowPassword(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !plan) return;
    setAmount(String(plan.amountArs));
    setReason('');
    setPassword('');
    setConfirmed(false);
    setShowPassword(false);
    setPreview(null);
    setPreviewError(null);
    setSubmitError(null);
    setErrors({});

    let cancelled = false;
    setIsPreviewing(true);
    void onPreview(plan.code)
      .then((result) => {
        if (!cancelled) setPreview(result);
      })
      .catch(() => {
        if (!cancelled) setPreviewError('No pudimos calcular el impacto. Reintentá antes de aplicar el cambio.');
      })
      .finally(() => {
        if (!cancelled) setIsPreviewing(false);
      });

    return () => {
      cancelled = true;
    };
  }, [onPreview, open, plan]);

  const retryPreview = async () => {
    if (!plan) return;
    setPreviewError(null);
    setIsPreviewing(true);
    try {
      setPreview(await onPreview(plan.code));
    } catch {
      setPreviewError('No pudimos calcular el impacto. Reintentá antes de aplicar el cambio.');
    } finally {
      setIsPreviewing(false);
    }
  };

  const validate = () => {
    const nextErrors: FieldErrors = {};
    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      nextErrors.amount = 'Ingresá un importe ARS mayor que cero.';
    } else if (plan && parsedAmount === plan.amountArs) {
      nextErrors.amount = 'El nuevo importe debe ser distinto del actual.';
    }
    if (reason.trim().length < 10) nextErrors.reason = 'Explicá el motivo en al menos 10 caracteres.';
    if (!password) nextErrors.password = 'Ingresá nuevamente la contraseña administrativa.';
    if (!confirmed) nextErrors.confirmation = 'Confirmá que revisaste el impacto.';
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!plan || !preview || !validate()) return;

    setSubmitError(null);
    setIsApplying(true);
    try {
      const result = await onApply({
        planCode: plan.code,
        newAmountArs: Number(amount),
        expectedAmountArs: plan.amountArs,
        expectedPriceVersion: plan.priceVersion,
        expectedUpdatedAt: plan.updatedAt,
        reason: reason.trim(),
        password,
      });
      setPassword('');
      onApplied(result);
      onOpenChange(false);
    } catch (error) {
      const status = typeof error === 'object' && error && 'status' in error ? Number(error.status) : null;
      const code = typeof error === 'object' && error && 'code' in error && typeof error.code === 'string'
        ? error.code
        : null;
      setPassword('');
      setSubmitError(
        code === 'MUTATIONS_DISABLED'
          ? 'La edición de precios está deshabilitada en producción. Habilitala desde la configuración del servidor y volvé a intentarlo.'
          : status === 409
          ? 'El precio cambió en otra sesión. Cerrá este panel, actualizá los planes y volvé a intentarlo.'
          : 'No se pudo aplicar el cambio. Verificá la contraseña y el estado de la operación.',
      );
    } finally {
      setPassword('');
      setIsApplying(false);
    }
  };

  return (
    <DrawerForm
      open={open}
      onOpenChange={onOpenChange}
      title={plan ? `Cambiar precio de ${plan.name}` : 'Cambiar precio'}
      description="Define un nuevo precio, revisa su impacto y confirma la operación administrativa."
      size="md"
      isDirty={isDirty && !isApplying}
      footer={(
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isApplying}>
            Cancelar
          </Button>
          <Button type="submit" form="admin-price-change-form" disabled={!preview || isPreviewing || isApplying}>
            {isApplying ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeDollarSign className="h-4 w-4" />}
            {isApplying ? 'Creando lote…' : 'Aplicar precio'}
          </Button>
        </div>
      )}
    >
      {plan && (
        <form id="admin-price-change-form" onSubmit={handleSubmit} className="space-y-6" noValidate>
          <DrawerFormSection
            icon={BadgeDollarSign}
            title="Nuevo precio mensual"
            description={`Precio actual ${formatAdminMoney(plan.amountArs)} · versión ${plan.priceVersion}`}
          >
            <div className="space-y-2">
              <Label htmlFor="admin-plan-amount">Importe en pesos argentinos</Label>
              <CurrencyInput
                id="admin-plan-amount"
                value={amount}
                onChange={(value) => {
                  setAmount(value);
                  setErrors((current) => ({ ...current, amount: undefined }));
                }}
                disabled={isApplying}
                aria-invalid={Boolean(errors.amount)}
                aria-describedby={errors.amount ? 'admin-plan-amount-error' : 'admin-plan-amount-help'}
              />
              {errors.amount ? (
                <p id="admin-plan-amount-error" className="text-xs text-status-error-foreground">{errors.amount}</p>
              ) : (
                <p id="admin-plan-amount-help" className="text-xs text-muted-foreground">
                  Entra en vigencia de inmediato para nuevas contrataciones.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="admin-price-reason">Motivo del cambio</Label>
              <Textarea
                id="admin-price-reason"
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value);
                  setErrors((current) => ({ ...current, reason: undefined }));
                }}
                maxLength={500}
                placeholder="Ej.: actualización comercial del plan…"
                disabled={isApplying}
                aria-invalid={Boolean(errors.reason)}
                aria-describedby={errors.reason ? 'admin-price-reason-error' : undefined}
              />
              <div className="flex justify-between gap-3">
                {errors.reason ? (
                  <p id="admin-price-reason-error" className="text-xs text-status-error-foreground">{errors.reason}</p>
                ) : <span />}
                <span className="text-xs tabular-nums text-muted-foreground">{reason.length}/500</span>
              </div>
            </div>
          </DrawerFormSection>

          <DrawerFormSection
            icon={RefreshCw}
            title="Impacto en Mercado Pago"
            description="Las renovaciones se actualizan; los checkouts pendientes se invalidan y deberán regenerarse."
          >
            {isPreviewing ? (
              <div className="grid grid-cols-2 gap-3" aria-label="Calculando impacto">
                {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-16" />)}
              </div>
            ) : previewError ? (
              <div className="rounded-lg border border-status-warning bg-status-warning-bg p-3">
                <p className="text-sm text-status-warning-foreground">{previewError}</p>
                <Button type="button" variant="outline" size="sm" onClick={() => void retryPreview()} className="mt-3">
                  Reintentar
                </Button>
              </div>
            ) : preview ? (
              <div className="grid grid-cols-2 gap-3">
                <ImpactValue label="Renovaciones activas" value={preview.impact.eligibleActiveRenewals} />
                <ImpactValue label="Checkouts pendientes" value={preview.impact.pendingCheckouts} />
                <ImpactValue label="Total afectado" value={preview.impact.totalAffected} emphasis />
                <ImpactValue label="Excluidos" value={preview.impact.excluded} />
              </div>
            ) : null}

            <Alert className="border-status-warning bg-status-warning-bg">
              <AlertTriangle className="h-4 w-4 text-status-warning-foreground" />
              <AlertTitle className="text-sm text-status-warning-foreground">El catálogo no se revierte ante un éxito parcial</AlertTitle>
              <AlertDescription className="text-xs text-status-warning-foreground">
                Cada resultado queda auditado. Un checkout pendiente anterior deja de reutilizarse al confirmar el cambio.
              </AlertDescription>
            </Alert>
          </DrawerFormSection>

          <DrawerFormSection
            icon={ShieldCheck}
            title="Confirmación administrativa"
            description="La contraseña se verifica en servidor y nunca se registra."
          >
            <div className="space-y-2">
              <Label htmlFor="admin-price-password">Contraseña</Label>
              <div className="relative">
                <Input
                  id="admin-price-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setErrors((current) => ({ ...current, password: undefined }));
                  }}
                  className="pr-10"
                  disabled={isApplying}
                  aria-invalid={Boolean(errors.password)}
                  aria-describedby={errors.password ? 'admin-price-password-error' : undefined}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  className="absolute right-1 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  disabled={isApplying}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {errors.password && <p id="admin-price-password-error" className="text-xs text-status-error-foreground">{errors.password}</p>}
            </div>

            <div className="rounded-lg border border-border p-3">
              <label className="flex cursor-pointer items-start gap-3 text-sm leading-relaxed text-foreground">
                <Checkbox
                  checked={confirmed}
                  onCheckedChange={(checked) => {
                    setConfirmed(checked === true);
                    setErrors((current) => ({ ...current, confirmation: undefined }));
                  }}
                  className="mt-0.5"
                  disabled={isApplying}
                  aria-invalid={Boolean(errors.confirmation)}
                />
                <span>
                  Confirmo que revisé el impacto y que el nuevo importe se aplicará al catálogo y a las renovaciones elegibles.
                </span>
              </label>
              {errors.confirmation && <p className="mt-2 pl-7 text-xs text-status-error-foreground">{errors.confirmation}</p>}
            </div>
          </DrawerFormSection>

          {submitError && (
            <p role="alert" className="rounded-lg border border-status-error bg-status-error-bg p-3 text-sm text-status-error-foreground">
              {submitError}
            </p>
          )}
        </form>
      )}
    </DrawerForm>
  );
}

function ImpactValue({ label, value, emphasis = false }: { label: string; value: number; emphasis?: boolean }) {
  return (
    <div className={emphasis ? 'rounded-lg border border-primary/30 bg-primary/5 p-3' : 'rounded-lg border border-border p-3'}>
      <p className="text-xl font-semibold tabular-nums text-foreground">{value.toLocaleString('es-AR')}</p>
      <p className="mt-0.5 text-[11px] leading-tight text-muted-foreground">{label}</p>
    </div>
  );
}
