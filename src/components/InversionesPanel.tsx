import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { TrendingUp, Trash2, Plus, Package } from 'lucide-react';
import { useInversiones, type Inversion } from '@/hooks/useInversiones';
import { useDeudas } from '@/hooks/useDeudas';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SkeletonRow } from '@/components/ui/SkeletonRow';
import { useDelayedVisible } from '@/hooks/useDelayedVisible';
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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DrawerForm } from '@/components/ui/drawer-form';
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form';
import { PageHeader } from '@/components/ui/PageHeader';
import { format } from 'date-fns';

const CATEGORIAS = ['Mobiliario', 'Equipamiento', 'Reforma', 'Tecnología', 'Vehículo', 'Otro'];

const inversionSchema = z
  .object({
    nombre: z.string().trim().min(1, 'El nombre es obligatorio.').max(80, 'El nombre no puede superar los 80 caracteres.'),
    montoTotal: z.string().refine((v) => {
      const n = parseFloat(v);
      return Number.isFinite(n) && n > 0;
    }, 'Ingresá un monto válido.'),
    fechaCompra: z.string().min(1, 'Seleccioná una fecha.'),
    mesesAmortizacion: z.string().refine((v) => {
      const n = parseInt(v, 10);
      return Number.isFinite(n) && n > 0;
    }, 'Ingresá una cantidad de meses válida.'),
    categoria: z.string().optional().default(''),
    descripcion: z.string().max(240, 'La descripción no puede superar los 240 caracteres.').optional().default(''),
    financiada: z.boolean(),
    acreedor: z.string().max(80, 'El acreedor no puede superar los 80 caracteres.').optional().default(''),
    cuotas: z.string().optional().default(''),
    montoCuota: z.string().optional().default(''),
    fechaProximoPago: z.string().optional().default(''),
  })
  .superRefine((data, ctx) => {
    if (data.financiada && !data.acreedor.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'El acreedor es obligatorio para una inversión financiada.', path: ['acreedor'] });
    }
  });

type InversionFormValues = z.infer<typeof inversionSchema>;

const getInversionFormDefaults = (): InversionFormValues => ({
  nombre: '',
  montoTotal: '',
  fechaCompra: format(new Date(), 'yyyy-MM-dd'),
  mesesAmortizacion: '12',
  categoria: '',
  descripcion: '',
  financiada: false,
  acreedor: '',
  cuotas: '',
  montoCuota: '',
  fechaProximoPago: '',
});

export function InversionesPanel() {
  const { inversiones, isLoading, addInversion, deleteInversion, getAmortizacionMensual, getMesesTranscurridos } = useInversiones();
  const showSkeleton = useDelayedVisible(isLoading);
  const { addDeuda } = useDeudas();

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [inversionAEliminar, setInversionAEliminar] = useState<Inversion | null>(null);

  const form = useForm<InversionFormValues>({
    resolver: zodResolver(inversionSchema),
    defaultValues: getInversionFormDefaults(),
  });

  // Resync el formulario en cada apertura — evita arrastrar valores de la inversión anterior.
  useEffect(() => {
    if (isFormOpen) {
      form.reset(getInversionFormDefaults());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFormOpen]);

  const financiadaWatch = form.watch('financiada');

  const onSubmit = async (values: InversionFormValues) => {
    const inv = await addInversion({
      nombre: values.nombre.trim(),
      monto_total: parseFloat(values.montoTotal),
      fecha_compra: new Date(values.fechaCompra),
      meses_amortizacion: parseInt(values.mesesAmortizacion, 10),
      categoria: values.categoria || undefined,
      descripcion: values.descripcion || undefined,
    });

    // Mismo comportamiento de siempre: la Deuda se crea en el mismo submit, con los
    // mismos datos (monto_total y fecha_compra de la inversión), solo cambió el
    // contenedor/validación que envuelve al formulario — no se desarma la operación.
    if (inv && values.financiada && values.acreedor.trim()) {
      await addDeuda({
        acreedor: values.acreedor.trim(),
        monto_total: parseFloat(values.montoTotal),
        cuotas_totales: values.cuotas ? parseInt(values.cuotas, 10) : undefined,
        monto_cuota: values.montoCuota ? parseFloat(values.montoCuota) : undefined,
        fecha_inicio: new Date(values.fechaCompra),
        fecha_proximo_pago: values.fechaProximoPago ? new Date(values.fechaProximoPago) : undefined,
        inversion_id: inv.id,
      });
    }

    if (inv) {
      setIsFormOpen(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inversiones"
        icon={TrendingUp}
        subtitle="Bienes y equipamiento del negocio."
        className="pl-0"
        actions={(
          <Button size="sm" onClick={() => setIsFormOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Nueva
          </Button>
        )}
      />

      <DrawerForm
        open={isFormOpen}
        onOpenChange={setIsFormOpen}
        title="Nueva inversión"
        size="md"
        isDirty={form.formState.isDirty}
        footer={
          <div className="flex w-full justify-end gap-2">
            <Button variant="outline" onClick={() => setIsFormOpen(false)} disabled={form.formState.isSubmitting}>
              Cancelar
            </Button>
            <Button type="submit" form="inversion-form" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? 'Guardando...' : 'Guardar'}
            </Button>
          </div>
        }
      >
        <Form {...form}>
          <form id="inversion-form" onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="nombre"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nombre</FormLabel>
                    <FormControl>
                      <Input {...field} maxLength={80} placeholder="Ej: Sillón nuevo" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="montoTotal"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Monto total</FormLabel>
                    <FormControl>
                      <CurrencyInput value={field.value} onChange={field.onChange} placeholder="0" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="fechaCompra"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fecha de compra</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="mesesAmortizacion"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Meses de amortización</FormLabel>
                    <FormControl>
                      <Input type="number" inputMode="numeric" {...field} placeholder="12" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="categoria"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Categoría (opcional)</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger><SelectValue placeholder="Seleccionar" /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {CATEGORIAS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="descripcion"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Descripción (opcional)</FormLabel>
                  <FormControl>
                    <Textarea {...field} maxLength={240} placeholder="Detalle de la inversión..." />
                  </FormControl>
                  <p className="text-xs text-muted-foreground text-right">{(field.value ?? '').length}/240</p>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="financiada"
              render={({ field }) => (
                <FormItem className="flex items-center gap-2 space-y-0 pt-2">
                  <FormControl>
                    <Checkbox checked={field.value} onCheckedChange={(v) => field.onChange(!!v)} />
                  </FormControl>
                  <FormLabel className="!mt-0 cursor-pointer">¿Financiada? (crea deuda asociada)</FormLabel>
                </FormItem>
              )}
            />

            {financiadaWatch && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pl-6 border-l-2 border-primary/20">
                <FormField
                  control={form.control}
                  name="acreedor"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Acreedor</FormLabel>
                      <FormControl>
                        <Input {...field} maxLength={80} placeholder="Ej: Banco Nación" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="cuotas"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Cantidad de cuotas (opcional)</FormLabel>
                      <FormControl>
                        <Input type="number" inputMode="numeric" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="montoCuota"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Monto por cuota (opcional)</FormLabel>
                      <FormControl>
                        <CurrencyInput value={field.value} onChange={field.onChange} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="fechaProximoPago"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Próximo pago (opcional)</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            )}
          </form>
        </Form>
      </DrawerForm>

      {isLoading ? (
        showSkeleton ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="py-4">
                  <SkeletonRow leading={false} />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : null
      ) : inversiones.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <Package className="h-10 w-10 mx-auto mb-2 opacity-50" />
            <p>No hay inversiones registradas</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {inversiones.map(inv => {
            const amortMensual = getAmortizacionMensual(inv);
            const mesesTransc = getMesesTranscurridos(inv);
            const progreso = (mesesTransc / inv.meses_amortizacion) * 100;

            return (
              <Card key={inv.id}>
                <CardContent className="py-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <TrendingUp className="h-4 w-4 text-primary flex-shrink-0" />
                        <span className="font-medium text-foreground truncate">{inv.nombre}</span>
                        {inv.categoria && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground">{inv.categoria}</span>
                        )}
                      </div>
                      <div className="text-sm text-muted-foreground space-y-1">
                        <p>Total: ${inv.monto_total.toLocaleString()} · Amortización: ${Math.round(amortMensual).toLocaleString()}/mes</p>
                        <div className="flex items-center gap-2">
                          <Progress value={progreso} className="h-2 flex-1" />
                          <span className="text-xs whitespace-nowrap">{mesesTransc}/{inv.meses_amortizacion} meses</span>
                        </div>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive h-8 w-8"
                      onClick={() => setInversionAEliminar(inv)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <AlertDialog open={!!inversionAEliminar} onOpenChange={(open) => !open && setInversionAEliminar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar inversión</AlertDialogTitle>
            <AlertDialogDescription>
              {inversionAEliminar && (
                <>Vas a eliminar la inversión <strong>{inversionAEliminar.nombre}</strong>. Esta acción no se puede deshacer.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                if (inversionAEliminar) {
                  await deleteInversion(inversionAEliminar.id);
                  setInversionAEliminar(null);
                }
              }}
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
