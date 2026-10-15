import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from '@/components/ui/form';
import { DrawerForm } from '@/components/ui/drawer-form';
import { callPartner, PartnerApiError } from '@/lib/partnerApi';
import {
  normalizePartnerCode,
  validatePayoutDetails,
  PARTNER_TERMS_VERSION,
} from '../../../supabase/functions/_shared/partner-domain';

const enrollment = z.object({
  code: z
    .string()
    .min(4, 'Usá al menos 4 caracteres.')
    .max(20, 'Usá hasta 20 caracteres.')
    .refine((value) => {
      try {
        normalizePartnerCode(value);
        return true;
      } catch {
        return false;
      }
    }, 'Usá letras sin acentos o números. Elegí un código personal.'),
  accepted: z.boolean().refine(Boolean, 'Aceptá las condiciones para adherirte.'),
});
const payout = z
  .object({
    holder: z.string().trim().min(3, 'Ingresá el titular.').max(80),
    taxId: z.string().min(11, 'Ingresá tu CUIT o CUIL.').max(13),
    account: z.string().regex(/^\d{22}$/, 'Ingresá los 22 dígitos, sin espacios.'),
  })
  .superRefine((values, context) => {
    try {
      validatePayoutDetails({
        holder: values.holder,
        taxId: values.taxId,
        account: values.account,
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      const path =
        code === 'INVALID_TAX_ID' ? 'taxId' : code === 'INVALID_ACCOUNT' ? 'account' : 'holder';
      context.addIssue({
        code: 'custom',
        path: [path],
        message: 'Revisá este dato antes de guardar.',
      });
    }
  });

export function PartnerEnrollment({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const form = useForm<z.infer<typeof enrollment>>({
    resolver: zodResolver(enrollment),
    defaultValues: { code: '', accepted: false },
  });
  const [busy, setBusy] = useState(false);
  return (
    <DrawerForm
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      title="Crear mi código"
      description="Elegí el código que vas a compartir con tu comunidad."
      size="md"
      isDirty={form.formState.isDirty}
      footer={
        <Button form="partner-enroll" disabled={busy} type="submit">
          {busy ? 'Creando…' : 'Crear mi código'}
        </Button>
      }
    >
      <Form {...form}>
        <form
          id="partner-enroll"
          className="space-y-5"
          onSubmit={form.handleSubmit(async (values) => {
            setBusy(true);
            try {
              await callPartner('enroll', {
                ...values,
                country: 'AR',
                termsVersion: PARTNER_TERMS_VERSION,
              });
              onSaved();
              onClose();
              toast.success('Tu código está listo para compartir.');
            } catch (error) {
              if (
                error instanceof PartnerApiError &&
                ['CODE_TAKEN', 'INVALID_CODE'].includes(error.code)
              )
                form.setError('code', { message: error.message });
              else
                toast.error(
                  error instanceof PartnerApiError ? error.message : 'No pudimos crear tu código.',
                );
            } finally {
              setBusy(false);
            }
          })}
        >
          <p className="text-sm text-muted-foreground">
            Participás desde Argentina. Tu comisión inicial es del 10% del primer pago de cada
            barbería, después de su descuento.
          </p>
          <FormField
            control={form.control}
            name="code"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Tu código</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    maxLength={20}
                    autoCapitalize="characters"
                    autoComplete="off"
                    placeholder="Ej.: BRUNO10"
                    disabled={busy}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="accepted"
            render={({ field }) => (
              <FormItem>
                <div className="flex items-start gap-3">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={(value) => field.onChange(value === true)}
                      disabled={busy}
                    />
                  </FormControl>
                  <FormLabel className="leading-relaxed">
                    Acepto las{' '}
                    <a
                      className="underline underline-offset-4"
                      href="/aliados#condiciones"
                      target="_blank"
                      rel="noreferrer"
                    >
                      condiciones del programa
                    </a>
                    , versión {PARTNER_TERMS_VERSION}.
                  </FormLabel>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />
        </form>
      </Form>
    </DrawerForm>
  );
}

export function PartnerPayoutForm({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const form = useForm<z.infer<typeof payout>>({
    resolver: zodResolver(payout),
    defaultValues: { holder: '', taxId: '', account: '' },
  });
  const [busy, setBusy] = useState(false);
  return (
    <DrawerForm
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      title="Datos de cobro"
      description="Cuenta argentina del titular que recibirá las comisiones."
      size="md"
      isDirty={form.formState.isDirty}
      footer={
        <Button form="partner-payout" disabled={busy} type="submit">
          {busy ? 'Guardando…' : 'Guardar datos'}
        </Button>
      }
    >
      <Form {...form}>
        <form
          id="partner-payout"
          className="space-y-5"
          onSubmit={form.handleSubmit(async (values) => {
            setBusy(true);
            try {
              await callPartner('save_payout', values);
              onSaved();
              onClose();
              toast.success('Datos guardados. Vittro revisará la titularidad antes de pagar.');
            } catch (error) {
              toast.error(
                error instanceof PartnerApiError ? error.message : 'No pudimos guardar tus datos.',
              );
            } finally {
              setBusy(false);
            }
          })}
        >
          <p className="text-sm text-muted-foreground">
            Vittro revisa y liquida las comisiones disponibles una vez por mes. Cambiar la cuenta
            requiere una nueva verificación.
          </p>
          <FormField
            control={form.control}
            name="holder"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Titular de la cuenta</FormLabel>
                <FormControl>
                  <Input {...field} maxLength={80} autoComplete="name" disabled={busy} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="taxId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>CUIT o CUIL</FormLabel>
                <FormControl>
                  <Input {...field} maxLength={13} inputMode="numeric" disabled={busy} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="account"
            render={({ field }) => (
              <FormItem>
                <FormLabel>CBU o CVU</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    maxLength={22}
                    inputMode="numeric"
                    autoComplete="off"
                    disabled={busy}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </form>
      </Form>
    </DrawerForm>
  );
}
