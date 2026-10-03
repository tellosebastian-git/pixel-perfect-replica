import { useState, useEffect, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { DollarSign, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CurrencyInput } from '@/components/ui/currency-input';
import { DatePicker } from '@/components/ui/date-picker';
import { DrawerForm } from '@/components/ui/drawer-form';
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { RepeatPicker, getRepeatLabel } from '@/components/tareas/RepeatPicker';
import { CustomRepeatSheet, getCustomRepeatLabel } from '@/components/tareas/CustomRepeatSheet';

interface BonoFijoConfigProps {
  barberId: string;
  organizationId: string;
  sucursalId: string;
  forceShow?: boolean;
}

interface BonoConfig {
  id: string;
  monto: number;
  fecha_inicio: string;
  fecha_fin: string | null;
  repeat_preset: string;
  repeat_frequency: string | null;
  repeat_interval: number | null;
  repeat_byweekday: number[] | null;
  proxima_fecha: string;
  activa: boolean;
}

const bonoFijoSchema = z.object({
  monto: z.string(),
  fechaInicio: z.string().min(1, 'Seleccioná una fecha de inicio.'),
  fechaFin: z.string().nullable(),
  repeatPreset: z.string(),
  repeatFrequency: z.string(),
  repeatInterval: z.number(),
  repeatByweekday: z.array(z.number()),
}).superRefine((data, ctx) => {
  const montoNum = parseFloat(data.monto);
  if (isNaN(montoNum) || montoNum <= 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['monto'], message: 'Ingresá un monto válido.' });
  }
});

type BonoFormValues = z.infer<typeof bonoFijoSchema>;

function emptyValues(): BonoFormValues {
  return {
    monto: '',
    fechaInicio: format(new Date(), 'yyyy-MM-dd'),
    fechaFin: null,
    repeatPreset: 'monthly',
    repeatFrequency: '',
    repeatInterval: 1,
    repeatByweekday: [],
  };
}

function valuesFromConfig(cfg: BonoConfig): BonoFormValues {
  return {
    monto: String(cfg.monto),
    fechaInicio: cfg.fecha_inicio,
    fechaFin: cfg.fecha_fin,
    repeatPreset: cfg.repeat_preset,
    repeatFrequency: cfg.repeat_frequency || '',
    repeatInterval: cfg.repeat_interval || 1,
    repeatByweekday: cfg.repeat_byweekday || [],
  };
}

export function BonoFijoConfig({ barberId, organizationId, sucursalId, forceShow }: BonoFijoConfigProps) {
  const [config, setConfig] = useState<BonoConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [showRepeatPicker, setShowRepeatPicker] = useState(false);
  const [showCustomRepeat, setShowCustomRepeat] = useState(false);

  const form = useForm<BonoFormValues>({
    resolver: zodResolver(bonoFijoSchema),
    defaultValues: emptyValues(),
  });

  const fetchConfig = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data } = await supabase
        .from('bono_fijo_config')
        .select('*')
        .eq('barbero_id', barberId)
        .eq('organization_id', organizationId)
        .eq('activa', true)
        .maybeSingle();

      setConfig(data as BonoConfig | null);
    } catch (e) {
      console.error('Error loading bono fijo config:', e);
    } finally {
      setIsLoading(false);
    }
  }, [barberId, organizationId]);

  useEffect(() => { fetchConfig(); }, [fetchConfig]);

  if (isLoading) return null;
  if (!config && !forceShow && !drawerOpen) return null;

  const openCreate = () => {
    form.reset(emptyValues());
    setDrawerOpen(true);
  };

  const openEdit = () => {
    if (config) form.reset(valuesFromConfig(config));
    setDrawerOpen(true);
  };

  const closeDrawer = () => setDrawerOpen(false);

  const buildInsertPayload = (values: BonoFormValues) => ({
    organization_id: organizationId,
    sucursal_id: sucursalId,
    barbero_id: barberId,
    monto: parseFloat(values.monto),
    fecha_inicio: values.fechaInicio,
    fecha_fin: values.fechaFin,
    repeat_preset: values.repeatPreset,
    repeat_frequency: values.repeatPreset === 'custom' ? values.repeatFrequency : null,
    repeat_interval: values.repeatPreset === 'custom' ? values.repeatInterval : 1,
    repeat_byweekday: values.repeatPreset === 'custom' && values.repeatByweekday.length > 0 ? values.repeatByweekday : null,
    proxima_fecha: values.fechaInicio,
    activa: true,
  });

  const handleCreate = async (values: BonoFormValues) => {
    try {
      const { error } = await supabase.from('bono_fijo_config').insert(buildInsertPayload(values));
      if (error) throw error;
      toast.success('Bono fijo configurado');
      closeDrawer();
      fetchConfig();
    } catch (e: any) {
      console.error(e);
      if (e.message?.includes('uq_bono_fijo_activo_por_barbero')) {
        toast.error('Ya existe un bono fijo activo para este empleado');
      } else {
        toast.error(e.message || 'Error al crear bono fijo');
      }
    }
  };

  const handleUpdate = async (values: BonoFormValues) => {
    if (!config) return;
    try {
      // Close current config
      const ayer = format(new Date(Date.now() - 86400000), 'yyyy-MM-dd');
      await supabase
        .from('bono_fijo_config')
        .update({ activa: false, fecha_fin: ayer })
        .eq('id', config.id);

      // Create new config
      const { error } = await supabase.from('bono_fijo_config').insert(buildInsertPayload(values));
      if (error) throw error;
      toast.success('Bono fijo actualizado');
      closeDrawer();
      fetchConfig();
    } catch (e: any) {
      console.error(e);
      toast.error(e.message || 'Error al actualizar bono fijo');
    }
  };

  const onSubmit = (values: BonoFormValues) => (config ? handleUpdate(values) : handleCreate(values));

  const handleDeactivate = async () => {
    if (!config) return;
    try {
      const hoy = format(new Date(), 'yyyy-MM-dd');
      await supabase
        .from('bono_fijo_config')
        .update({ activa: false, fecha_fin: hoy })
        .eq('id', config.id);

      toast.success('Bono fijo desactivado');
      setConfig(null);
    } catch (e) {
      toast.error('Error al desactivar');
    }
  };

  const getRecurrenciaLabel = () => {
    if (!config) return '';
    if (config.repeat_preset === 'custom') {
      return getCustomRepeatLabel(config.repeat_frequency, config.repeat_interval, config.repeat_byweekday);
    }
    return getRepeatLabel(config.repeat_preset);
  };

  const formRepeatPreset = form.watch('repeatPreset');
  const formRepeatFrequency = form.watch('repeatFrequency');
  const formRepeatInterval = form.watch('repeatInterval');
  const formRepeatByweekday = form.watch('repeatByweekday');

  const getFormRecurrenciaLabel = () => {
    if (formRepeatPreset === 'custom') {
      return getCustomRepeatLabel(formRepeatFrequency, formRepeatInterval, formRepeatByweekday);
    }
    return getRepeatLabel(formRepeatPreset);
  };

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(amount);

  return (
    <>
      {!config ? (
        <div className="p-3 rounded-md border border-dashed border-border bg-muted/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <DollarSign className="h-4 w-4" />
              <span>Bono fijo</span>
            </div>
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={openCreate}>
              Configurar
            </Button>
          </div>
        </div>
      ) : (
        <div className="p-3 rounded-md border border-border bg-muted/20 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">Bono fijo</span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
              onClick={() => setShowDelete(true)}
              aria-label="Eliminar bono fijo"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>

          <div className="text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Monto</span>
              <span className="font-medium">{formatCurrency(config.monto)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Recurrencia</span>
              <span>{getRecurrenciaLabel()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Desde</span>
              <span>{format(new Date(config.fecha_inicio + 'T12:00:00'), "dd/MM/yyyy", { locale: es })}</span>
            </div>
            {config.fecha_fin && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Hasta</span>
                <span>{format(new Date(config.fecha_fin + 'T12:00:00'), "dd/MM/yyyy", { locale: es })}</span>
              </div>
            )}
          </div>

          <Button variant="outline" size="sm" className="h-7 text-xs w-full" onClick={openEdit}>
            Editar bono
          </Button>

          <AlertDialog open={showDelete} onOpenChange={setShowDelete}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Eliminar bono fijo</AlertDialogTitle>
                <AlertDialogDescription>
                  Se desactiva el extra a partir de hoy. No se modifican pagos ni cierres históricos. Podés volver a configurarlo más adelante.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => { setShowDelete(false); handleDeactivate(); }}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Eliminar
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}

      <DrawerForm
        open={drawerOpen}
        onOpenChange={(o) => { if (!o) closeDrawer(); }}
        title={config ? 'Editar bono fijo' : 'Bono fijo'}
        size="sm"
        isDirty={form.formState.isDirty}
        footer={
          <div className="flex w-full justify-between">
            <Button variant="ghost" onClick={closeDrawer} disabled={form.formState.isSubmitting}>
              Cancelar
            </Button>
            <Button onClick={form.handleSubmit(onSubmit)} disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? 'Guardando...' : 'Guardar'}
            </Button>
          </div>
        }
      >
        <Form {...form}>
          <div className="space-y-4">
            <FormField
              control={form.control}
              name="monto"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Monto</FormLabel>
                  <FormControl>
                    <CurrencyInput value={field.value} onChange={field.onChange} placeholder="0" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="fechaInicio"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Fecha de inicio</FormLabel>
                  <FormControl>
                    <DatePicker value={field.value} onChange={(v) => field.onChange(v ?? '')} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="fechaFin"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Fecha de fin (opcional)</FormLabel>
                  <FormControl>
                    <DatePicker value={field.value} onChange={field.onChange} clearable placeholder="Sin fecha de fin" />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormItem>
              <FormLabel>Recurrencia</FormLabel>
              <Button
                type="button"
                variant="outline"
                className="w-full justify-start text-left font-normal"
                onClick={() => setShowRepeatPicker(true)}
              >
                {getFormRecurrenciaLabel()}
              </Button>
            </FormItem>
          </div>
        </Form>

        <RepeatPicker
          open={showRepeatPicker}
          onOpenChange={setShowRepeatPicker}
          value={formRepeatPreset}
          onChange={(v) => {
            form.setValue('repeatPreset', v, { shouldDirty: true });
            form.setValue('repeatFrequency', '', { shouldDirty: true });
            form.setValue('repeatByweekday', [], { shouldDirty: true });
          }}
          onCustom={() => setShowCustomRepeat(true)}
        />
        <CustomRepeatSheet
          open={showCustomRepeat}
          onOpenChange={setShowCustomRepeat}
          frequency={formRepeatFrequency || 'weekly'}
          interval={formRepeatInterval}
          byweekday={formRepeatByweekday}
          onConfirm={(freq, intv, days) => {
            form.setValue('repeatPreset', 'custom', { shouldDirty: true });
            form.setValue('repeatFrequency', freq, { shouldDirty: true });
            form.setValue('repeatInterval', intv, { shouldDirty: true });
            form.setValue('repeatByweekday', days, { shouldDirty: true });
          }}
        />
      </DrawerForm>
    </>
  );
}
