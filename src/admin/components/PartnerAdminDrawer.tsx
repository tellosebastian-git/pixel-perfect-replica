import { useCallback, useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { DatePicker } from '@/components/ui/date-picker';
import { DrawerForm } from '@/components/ui/drawer-form';
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from '@/components/ui/form';
import { callPartner, PartnerApiError, partnerMoney } from '@/lib/partnerApi';
import { adminSupabase } from '@/integrations/supabase/adminClient';
import type { PartnerPayoutItem } from '@/types/partners';

export interface PartnerAdminOperation {
  action:
    | 'admin_agreement'
    | 'admin_verify_payout'
    | 'admin_prepare_payouts'
    | 'admin_mark_paid'
    | 'admin_resolve_incident'
    | 'admin_suspend';
  id?: string;
  name?: string;
  revision?: string;
  payout?: PartnerPayoutItem;
}
const titles = {
  admin_agreement: 'Convenio personalizado',
  admin_verify_payout: 'Verificar cuenta de cobro',
  admin_prepare_payouts: 'Preparar liquidación mensual',
  admin_mark_paid: 'Registrar transferencia',
  admin_resolve_incident: 'Resolver incidencia',
  admin_suspend: 'Suspender código',
};
type Account = {
  holder: string;
  taxId: string;
  account: string;
  revision: string;
  verified: boolean;
};

export function PartnerAdminDrawer({
  operation,
  onClose,
  onSaved,
}: {
  operation: PartnerAdminOperation;
  onClose: () => void;
  onSaved: () => void;
}) {
  const action = operation.action;
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [account, setAccount] = useState<Account | null>(null);
  const [accountError, setAccountError] = useState(false);
  const [receipt, setReceipt] = useState<File | null>(null);
  const requestId = useRef(crypto.randomUUID());
  const submitted = useRef(false);
  const uploadedReceipt = useRef<string | null>(null);
  const schema = z
    .object({
      percent: z.coerce.number().int().min(1).max(100),
      startsAt: z.string(),
      endsAt: z.string(),
      reference: z.string().max(150),
      reason: z.string().trim().min(10, 'Explicá el motivo con al menos 10 caracteres.').max(500),
      password: z.string().min(1, 'Ingresá tu contraseña administrativa.').max(1024),
      confirmed: z.boolean().refine(Boolean, 'Confirmá que revisaste la operación.'),
    })
    .superRefine((values, ctx) => {
      if (
        action === 'admin_agreement' &&
        (!values.startsAt || !values.endsAt || values.endsAt < values.startsAt)
      )
        ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'Elegí una vigencia válida.' });
      if (action === 'admin_mark_paid' && values.reference.trim().length < 3)
        ctx.addIssue({
          code: 'custom',
          path: ['reference'],
          message: 'Ingresá la referencia de la transferencia.',
        });
      if (action === 'admin_mark_paid' && !receipt)
        ctx.addIssue({
          code: 'custom',
          path: ['reference'],
          message: 'Adjuntá el comprobante de la transferencia.',
        });
    });
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      percent: 30,
      startsAt: '',
      endsAt: '',
      reference: '',
      reason: '',
      password: '',
      confirmed: false,
    },
  });
  const loadAccount = useCallback(() => {
    setAccountError(false);
    void callPartner<Account>('admin_payout_details', { partnerId: operation.id }, true)
      .then(setAccount)
      .catch(() => setAccountError(true));
  }, [operation.id]);
  useEffect(() => {
    if (action === 'admin_verify_payout') loadAccount();
  }, [action, loadAccount]);
  async function checkResult() {
    setBusy(true);
    try {
      const result = await callPartner<{ status: string }>(
        'admin_operation_status',
        { requestId: requestId.current },
        true,
      );
      if (result.status === 'completed') {
        onSaved();
        onClose();
        toast.success('La operación quedó confirmada.');
      } else if (result.status === 'rejected' || result.status === 'not_found') {
        onSaved();
        onClose();
        toast.info(
          'No hay un cambio confirmado. Los datos se actualizaron para volver a revisarlos.',
        );
      } else toast.info('La operación todavía está pendiente. Consultá nuevamente.');
    } catch {
      toast.error('No pudimos consultar el resultado. Conservá este identificador.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <DrawerForm
      open
      size="md"
      title={titles[action]}
      description="Operación de plataforma con motivo y auditoría."
      isDirty={form.formState.isDirty}
      onOpenChange={(open) => {
        if (!open && !busy && !uncertain) onClose();
      }}
      footer={
        <Button
          form="partner-admin-action"
          type="submit"
          disabled={busy || uncertain || (action === 'admin_verify_payout' && !account)}
        >
          {busy ? 'Procesando…' : 'Confirmar operación'}
        </Button>
      }
    >
      <Form {...form}>
        <form
          id="partner-admin-action"
          className="space-y-5"
          onSubmit={form.handleSubmit(async (values) => {
            if (submitted.current || busy || uncertain) return;
            submitted.current = true;
            setBusy(true);
            let sent = false;
            try {
              const input: Record<string, unknown> = {
                reason: values.reason,
                password: values.password,
                confirmed: values.confirmed,
                requestId: requestId.current,
                revision: account?.revision ?? operation.revision,
              };
              if (action === 'admin_agreement') {
                input.partnerId = operation.id;
                input.percent = values.percent;
                input.startsAt = new Date(`${values.startsAt}T00:00:00-03:00`).toISOString();
                input.endsAt = new Date(
                  new Date(`${values.endsAt}T00:00:00-03:00`).getTime() + 86_400_000,
                ).toISOString();
              } else if (action === 'admin_verify_payout') input.partnerId = operation.id;
              else if (action === 'admin_suspend' || action === 'admin_resolve_incident')
                input.id = operation.id;
              else if (action === 'admin_mark_paid') {
                input.payoutId = operation.payout!.id;
                input.reference = values.reference.trim();
                const extension =
                  receipt!.type === 'application/pdf'
                    ? 'pdf'
                    : receipt!.type === 'image/png'
                      ? 'png'
                      : 'jpg';
                const path = `partner-payouts/${operation.payout!.id}/${requestId.current}.${extension}`;
                if (uploadedReceipt.current !== path) {
                  const { error } = await adminSupabase.storage
                    .from('partner-payout-receipts')
                    .upload(path, receipt!, { upsert: false, contentType: receipt!.type });
                  if (error)
                    throw new PartnerApiError(
                      'No pudimos guardar el comprobante. Probá nuevamente.',
                    );
                  uploadedReceipt.current = path;
                }
                input.receiptPath = path;
              }
              sent = true;
              await callPartner(action, input, true);
              onSaved();
              onClose();
              toast.success('Operación registrada en auditoría.');
            } catch (error) {
              if (sent) setUncertain(true);
              else submitted.current = false;
              toast.error(
                error instanceof PartnerApiError
                  ? error.message
                  : 'No pudimos confirmar la operación. Consultá el resultado antes de repetirla.',
              );
            } finally {
              form.setValue('password', '');
              setBusy(false);
            }
          })}
        >
          {operation.name && <p className="text-base font-medium">{operation.name}</p>}
          {action === 'admin_prepare_payouts' && (
            <p className="text-sm text-muted-foreground">
              Agrupa comisiones disponibles al cierre del mes anterior, con cuenta verificada y sin
              incidencias. Revisá cada ítem antes de transferir.
            </p>
          )}
          {action === 'admin_suspend' && (
            <p className="text-sm text-muted-foreground">
              El código deja de admitir nuevos registros. Los beneficios ya atribuidos se conservan
              y las comisiones pasan a revisión.
            </p>
          )}
          {action === 'admin_verify_payout' &&
            (accountError ? (
              <div role="alert" className="space-y-3 text-sm">
                <p>No pudimos cargar la cuenta.</p>
                <Button type="button" variant="outline" onClick={loadAccount}>
                  Reintentar
                </Button>
              </div>
            ) : account ? (
              <dl className="space-y-3 rounded-lg border p-4 text-sm">
                <div>
                  <dt className="text-muted-foreground">Titular</dt>
                  <dd>{account.holder}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">CUIT/CUIL</dt>
                  <dd>{account.taxId}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">CBU/CVU</dt>
                  <dd className="break-all tabular-nums">{account.account}</dd>
                </div>
                <p className="text-muted-foreground">
                  Comprobá que la cuenta pertenece al titular. El formato válido no acredita
                  titularidad.
                </p>
              </dl>
            ) : (
              <p role="status" className="text-sm text-muted-foreground">
                Cargando cuenta…
              </p>
            ))}
          {action === 'admin_agreement' && (
            <>
              <FormField
                control={form.control}
                name="percent"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Comisión del primer pago (%)</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="number"
                        min={1}
                        max={100}
                        disabled={busy || uncertain}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="startsAt"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Vigente desde</FormLabel>
                    <FormControl>
                      <DatePicker
                        value={field.value || null}
                        onChange={(value) => field.onChange(value ?? '')}
                        disabled={busy || uncertain}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="endsAt"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Vigente hasta (inclusive)</FormLabel>
                    <FormControl>
                      <DatePicker
                        value={field.value || null}
                        onChange={(value) => field.onChange(value ?? '')}
                        disabled={busy || uncertain}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </>
          )}
          {action === 'admin_mark_paid' && (
            <>
              <dl className="space-y-3 rounded-lg border p-4 text-sm">
                <div>
                  <dt className="text-muted-foreground">Importe transferido</dt>
                  <dd className="text-lg font-medium tabular-nums">
                    {partnerMoney(operation.payout!.amountCents)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Titular</dt>
                  <dd>{operation.payout!.holder}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">CBU/CVU</dt>
                  <dd className="break-all tabular-nums">{operation.payout!.account}</dd>
                </div>
              </dl>
              <FormField
                control={form.control}
                name="reference"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Referencia de transferencia</FormLabel>
                    <FormControl>
                      <Input {...field} maxLength={150} disabled={busy || uncertain} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="space-y-2">
                <label htmlFor="partner-receipt" className="text-sm font-medium">
                  Comprobante
                </label>
                <Input
                  id="partner-receipt"
                  type="file"
                  accept="application/pdf,image/png,image/jpeg"
                  disabled={busy || uncertain}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (
                      file &&
                      (!['application/pdf', 'image/png', 'image/jpeg'].includes(file.type) ||
                        file.size > 10 * 1024 * 1024)
                    ) {
                      setReceipt(null);
                      event.target.value = '';
                      toast.error('Elegí PDF, PNG o JPG de hasta 10 MB.');
                    } else {
                      setReceipt(file ?? null);
                      uploadedReceipt.current = null;
                      requestId.current = crypto.randomUUID();
                    }
                  }}
                />
              </div>
            </>
          )}
          <FormField
            control={form.control}
            name="reason"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Motivo</FormLabel>
                <FormControl>
                  <Textarea {...field} maxLength={500} disabled={busy || uncertain} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Contraseña administrativa</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    type="password"
                    autoComplete="current-password"
                    maxLength={1024}
                    disabled={busy || uncertain}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="confirmed"
            render={({ field }) => (
              <FormItem>
                <div className="flex items-start gap-3">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={(value) => field.onChange(value === true)}
                      disabled={busy || uncertain}
                    />
                  </FormControl>
                  <FormLabel className="leading-relaxed">
                    {action === 'admin_mark_paid'
                      ? 'Ya realicé la transferencia y comprobé cuenta, importe y comprobante.'
                      : 'Revisé los datos y las consecuencias de esta operación.'}
                  </FormLabel>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />
          {uncertain && (
            <div
              role="alert"
              className="space-y-3 rounded-lg border border-status-warning bg-status-warning-bg p-4 text-sm text-status-warning-foreground"
            >
              <p>No tenemos confirmación. Consultá el resultado antes de repetir la operación.</p>
              <p className="break-all">Identificador: {requestId.current}</p>
              <Button
                type="button"
                variant="outline"
                onClick={() => void checkResult()}
                disabled={busy}
              >
                Consultar resultado
              </Button>
            </div>
          )}
        </form>
      </Form>
    </DrawerForm>
  );
}
