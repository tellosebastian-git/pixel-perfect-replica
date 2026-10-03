import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { format, addMonths, subMonths } from 'date-fns';
import { es } from 'date-fns/locale';
import { Trash2, ChevronLeft, ChevronRight, Plus, Repeat, Receipt } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { useGastos, TipoCosto } from '@/hooks/useGastos';
import { supabase } from '@/integrations/supabase/client';
import { useGastosRecurrentes } from '@/hooks/useGastosRecurrentes';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { useDelayedVisible } from '@/hooks/useDelayedVisible';
import { DrawerForm } from '@/components/ui/drawer-form';
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form';
import { RepeatPicker, getRepeatLabel } from '@/components/tareas/RepeatPicker';
import { CustomRepeatSheet, getCustomRepeatLabel } from '@/components/tareas/CustomRepeatSheet';
import { GastosRecurrentesList } from '@/components/GastosRecurrentesList';
import { useRequirePinForAction } from '@/components/ActionPinGate';
import { useSucursal } from '@/contexts/SucursalContext';
import { useAuth } from '@/contexts/AuthContext';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';

const CATEGORIAS_POR_TIPO: Record<TipoCosto, string[]> = {
  fijo: [
    'Alquiler del local',
    'Servicios del local (mínimo fijo)',
    'Internet',
    'Sueldos fijos del personal',
    'Suscripciones y software',
    'Seguro del local',
    'Honorarios profesionales',
    'Amortización de equipamiento',
    'Pagos de deudas',
    'Otros (fijo)',
  ],
  variable: [
    'Insumos de trabajo',
    'Publicidad y promociones',
    'Reposición de productos para venta',
    'Insumos administrativos',
    'Gastos operativos variables',
    'Comisiones del personal',
    'Pagos de deudas',
    'Otros (variable)',
  ],
  semivariable: [
    'Servicios públicos del local',
    'Sueldos y comisiones del personal',
    'Mantenimiento del local',
    'Limpieza del local',
    'Elementos de higiene y limpieza',
    'Marketing y publicidad recurrente',
    'Costos administrativos variables',
    'Gastos operativos generales',
    'Otros (semivariable)',
  ],
};

const TIPO_LABELS: Record<TipoCosto, string> = {
  fijo: '🧱 Fijo',
  variable: '📈 Variable',
  semivariable: '⚖️ Semivariable',
};

const TIPO_BADGE_VARIANT: Record<TipoCosto, 'default' | 'secondary' | 'outline'> = {
  fijo: 'default',
  variable: 'secondary',
  semivariable: 'outline',
};

const gastoFormSchema = z.object({
  tipoCosto: z.enum(['fijo', 'variable', 'semivariable']),
  categoria: z.string().min(1, 'Seleccioná una categoría.'),
  monto: z.string().refine((v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) && n > 0;
  }, 'Ingresá un monto válido.'),
  fecha: z.string().min(1, 'Seleccioná una fecha.'),
  descripcion: z.string().max(240, 'La descripción no puede superar los 240 caracteres.').optional().default(''),
  esRecurrente: z.boolean(),
  repeatPreset: z.string(),
  repeatFrequency: z.string(),
  repeatInterval: z.number(),
  repeatByweekday: z.array(z.number()),
});

type GastoFormValues = z.infer<typeof gastoFormSchema>;

const getGastoFormDefaults = (): GastoFormValues => ({
  tipoCosto: 'fijo',
  categoria: '',
  monto: '',
  fecha: format(new Date(), 'yyyy-MM-dd'),
  descripcion: '',
  esRecurrente: false,
  repeatPreset: 'monthly',
  repeatFrequency: 'weekly',
  repeatInterval: 1,
  repeatByweekday: [],
});

export function GastosPanel() {
  const { gastos, isLoading, selectedMonth, setSelectedMonth, addGasto, anularGasto, totalPeriodo, setSyncRecurrentes } = useGastos();
  const showSkeleton = useDelayedVisible(isLoading);
  const requirePinForAction = useRequirePinForAction();
  const { currentSucursal } = useSucursal();
  const { isSucursalAccount } = useAuth();
  
  const [anularState, setAnularState] = useState<{ id: number; motivo: string } | null>(null);
  const [anulando, setAnulando] = useState(false);
  const [gastosViewUnlocked, setGastosViewUnlocked] = useState(false);
  const shouldGateGastosView = isSucursalAccount && !gastosViewUnlocked;
  const { recurrentes, syncGastosRecurrentes, addRecurrente, toggleRecurrente, deleteRecurrente } = useGastosRecurrentes();

  const handleUnlockGastosView = async () => {
    const gate = await requirePinForAction('ver_gastos', currentSucursal?.id ?? null);
    if (!gate.ok) return;
    setGastosViewUnlocked(true);
    // Notificar visualización (solo cuenta de sucursal; dedupe horario en SQL).
    if (isSucursalAccount && currentSucursal?.id) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase as any).rpc('notif_emit_view_event', {
          _module: 'gastos',
          _sucursal_id: currentSucursal.id,
        });
      } catch (e) { console.warn('[notif] view event error', e); }
    }
  };

  // Wire up the recurrentes sync into useGastos
  useEffect(() => {
    setSyncRecurrentes(syncGastosRecurrentes);
  }, [setSyncRecurrentes, syncGastosRecurrentes]);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [repeatPickerOpen, setRepeatPickerOpen] = useState(false);
  const [customRepeatOpen, setCustomRepeatOpen] = useState(false);

  const form = useForm<GastoFormValues>({
    resolver: zodResolver(gastoFormSchema),
    defaultValues: getGastoFormDefaults(),
  });

  // Resync el formulario en cada apertura — evita arrastrar valores del gasto anterior.
  useEffect(() => {
    if (isFormOpen) {
      form.reset(getGastoFormDefaults());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFormOpen]);

  const tipoCostoWatch = form.watch('tipoCosto');
  const esRecurrenteWatch = form.watch('esRecurrente');

  const handleTipoCostoChange = (value: TipoCosto) => {
    form.setValue('tipoCosto', value, { shouldDirty: true });
    form.setValue('categoria', '', { shouldDirty: true });
    if (value !== 'fijo') {
      form.setValue('esRecurrente', false, { shouldDirty: true });
    }
  };

  const getRepeatDisplayLabel = () => {
    const preset = form.watch('repeatPreset');
    if (preset === 'custom') {
      return getCustomRepeatLabel(form.watch('repeatFrequency'), form.watch('repeatInterval'), form.watch('repeatByweekday'));
    }
    return getRepeatLabel(preset);
  };

  const closeForm = () => setIsFormOpen(false);

  const onSubmit = async (values: GastoFormValues) => {
    if (values.esRecurrente && values.tipoCosto === 'fijo') {
      // Create recurring template
      const success = await addRecurrente({
        categoria: values.categoria,
        tipo_costo: values.tipoCosto,
        monto: parseFloat(values.monto),
        descripcion: values.descripcion || undefined,
        repeat_preset: values.repeatPreset,
        repeat_frequency: values.repeatPreset === 'custom' ? values.repeatFrequency : undefined,
        repeat_interval: values.repeatPreset === 'custom' ? values.repeatInterval : undefined,
        repeat_byweekday: values.repeatPreset === 'custom' ? values.repeatByweekday : undefined,
        fecha_inicio: values.fecha,
      });

      if (success) closeForm();
    } else {
      // Normal single gasto
      const gate = await requirePinForAction('registrar_gasto', currentSucursal?.id ?? null);
      if (!gate.ok) return;
      const success = await addGasto({
        categoria: values.categoria,
        monto: parseFloat(values.monto),
        descripcion: values.descripcion || '',
        fecha: new Date(values.fecha + 'T12:00:00'),
        tipoCosto: values.tipoCosto,
      });

      if (success) closeForm();
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Gastos"
        icon={Receipt}
        subtitle="Costos fijos, variables y recurrentes del negocio."
        className="pl-0"
        actions={(
          <Button size="sm" onClick={() => setIsFormOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Registrar gasto
          </Button>
        )}
      />

      <DrawerForm
        open={isFormOpen}
        onOpenChange={setIsFormOpen}
        title="Registrar gasto"
        size="md"
        isDirty={form.formState.isDirty}
        footer={
          <div className="flex w-full justify-end gap-2">
            <Button variant="outline" onClick={closeForm} disabled={form.formState.isSubmitting}>
              Cancelar
            </Button>
            <Button type="submit" form="gasto-form" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? 'Registrando...' : esRecurrenteWatch ? 'Crear gasto recurrente' : 'Registrar gasto'}
            </Button>
          </div>
        }
      >
        <Form {...form}>
          <form id="gasto-form" onSubmit={form.handleSubmit(onSubmit)} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="tipoCosto"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tipo de costo</FormLabel>
                  <Select value={field.value} onValueChange={handleTipoCostoChange}>
                    <FormControl>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="fijo">🧱 Fijo</SelectItem>
                      <SelectItem value="variable">📈 Variable</SelectItem>
                      <SelectItem value="semivariable">⚖️ Semivariable</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="categoria"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Categoría</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger><SelectValue placeholder="Seleccionar categoría" /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {CATEGORIAS_POR_TIPO[tipoCostoWatch].map((c) => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="monto"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Monto</FormLabel>
                  <FormControl>
                    <CurrencyInput placeholder="0" value={field.value} onChange={field.onChange} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="fecha"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{esRecurrenteWatch ? 'Fecha de inicio' : 'Fecha'}</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="descripcion"
              render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>Descripción (opcional)</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      maxLength={240}
                      placeholder="Detalle del gasto..."
                      rows={2}
                    />
                  </FormControl>
                  <p className="text-xs text-muted-foreground text-right">{(field.value ?? '').length}/240</p>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Recurrence toggle - only for fijo */}
            {tipoCostoWatch === 'fijo' && (
              <div className="sm:col-span-2 space-y-3">
                <FormField
                  control={form.control}
                  name="esRecurrente"
                  render={({ field }) => (
                    <FormItem className="flex items-center gap-3 space-y-0">
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                      <FormLabel className="!mt-0 flex cursor-pointer items-center gap-2">
                        <Repeat className="h-4 w-4" />
                        Gasto recurrente
                      </FormLabel>
                    </FormItem>
                  )}
                />

                {esRecurrenteWatch && (
                  <div className="flex items-center gap-2">
                    <Label className="text-sm text-muted-foreground">Repetir:</Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setRepeatPickerOpen(true)}
                    >
                      {getRepeatDisplayLabel()}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </form>
        </Form>
      </DrawerForm>

      {/* Gastos recurrentes list */}
      <GastosRecurrentesList
        recurrentes={recurrentes}
        onToggle={toggleRecurrente}
        onDelete={deleteRecurrente}
      />

      {/* Historial */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Historial</CardTitle>
            {!shouldGateGastosView && (
              <div className="flex items-center gap-2">
                <Button variant="outline" size="icon" onClick={() => setSelectedMonth(subMonths(selectedMonth, 1))}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm font-medium min-w-[120px] text-center capitalize">
                  {format(selectedMonth, 'MMMM yyyy', { locale: es })}
                </span>
                <Button variant="outline" size="icon" onClick={() => setSelectedMonth(addMonths(selectedMonth, 1))}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {shouldGateGastosView ? (
            <div className="flex flex-col items-center justify-center py-8 gap-3 text-center">
              <p className="text-sm text-muted-foreground max-w-sm">
                El detalle de gastos puede requerir autorización.
              </p>
              <Button onClick={handleUnlockGastosView}>Ver gastos</Button>
            </div>
          ) : isLoading ? (
            showSkeleton ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Categoría</TableHead>
                    <TableHead>Descripción</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                      <TableCell className="text-right"><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                      <TableCell></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : null
          ) : gastos.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">No hay gastos en este período</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Categoría</TableHead>
                  <TableHead>Descripción</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {gastos.map((g) => {
                  const esAutomatico = !!(g.pago_deuda_id || g.pago_sueldo_id || g.gasto_recurrente_id || g.inversion_id);
                  return (
                    <TableRow key={g.id}>
                      <TableCell className="whitespace-nowrap">
                        {g.Fecha ? format(new Date(g.Fecha), 'dd/MM/yyyy') : '-'}
                      </TableCell>
                      <TableCell>
                        {g.tipo_costo ? (
                          <Badge variant={TIPO_BADGE_VARIANT[g.tipo_costo]}>
                            {TIPO_LABELS[g.tipo_costo]}
                          </Badge>
                        ) : '-'}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span>{g.Categoria || '-'}</span>
                          {esAutomatico && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                              Automático
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate">{g.Descripcion || '-'}</TableCell>
                      <TableCell className="text-right font-medium">
                        ${(g.Monto || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive disabled:opacity-30"
                          disabled={esAutomatico}
                          title={esAutomatico ? 'Este gasto se generó automáticamente y no se puede editar desde acá' : undefined}
                          onClick={() => setAnularState({ id: g.id, motivo: '' })}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={4} className="font-semibold">Total del período</TableCell>
                  <TableCell className="text-right font-bold">
                    ${totalPeriodo.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell />
                </TableRow>
              </TableFooter>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Repeat picker sheets */}
      <RepeatPicker
        open={repeatPickerOpen}
        onOpenChange={setRepeatPickerOpen}
        value={form.watch('repeatPreset')}
        onChange={(val) => form.setValue('repeatPreset', val, { shouldDirty: true })}
        onCustom={() => setCustomRepeatOpen(true)}
      />

      <CustomRepeatSheet
        open={customRepeatOpen}
        onOpenChange={setCustomRepeatOpen}
        frequency={form.watch('repeatFrequency')}
        interval={form.watch('repeatInterval')}
        byweekday={form.watch('repeatByweekday')}
        onConfirm={(freq, interval, days) => {
          form.setValue('repeatPreset', 'custom', { shouldDirty: true });
          form.setValue('repeatFrequency', freq, { shouldDirty: true });
          form.setValue('repeatInterval', interval, { shouldDirty: true });
          form.setValue('repeatByweekday', days, { shouldDirty: true });
        }}
      />

      <Dialog open={anularState !== null} onOpenChange={(o) => { if (!o) setAnularState(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Anular gasto</DialogTitle>
            <DialogDescription>
              El gasto se marcará como anulado y dejará de impactar en finanzas. Esta acción queda registrada.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="motivo-anulacion">Motivo de anulación</Label>
            <Textarea
              id="motivo-anulacion"
              maxLength={240}
              value={anularState?.motivo ?? ''}
              onChange={(e) => setAnularState((s) => s ? { ...s, motivo: e.target.value } : s)}
              placeholder="Indicá brevemente por qué se anula"
            />
            <p className="text-xs text-muted-foreground text-right">
              {(anularState?.motivo.length ?? 0)}/240
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAnularState(null)} disabled={anulando}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={anulando || !anularState?.motivo.trim()}
              onClick={async () => {
                if (!anularState) return;
                setAnulando(true);
                try {
                  const gate = await requirePinForAction('anular_gasto', currentSucursal?.id ?? null);
                  if (!gate.ok) return;
                  const ok = await anularGasto(anularState.id, anularState.motivo, {
                    validatedByUserId: gate.validatedByUserId ?? null,
                  });
                  if (ok) setAnularState(null);
                } finally {
                  setAnulando(false);
                }
              }}
            >
              {anulando ? 'Anulando…' : 'Anular gasto'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
