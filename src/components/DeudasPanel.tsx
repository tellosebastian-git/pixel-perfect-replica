import { useEffect, useState, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Landmark, Trash2, Plus, CreditCard, CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react';
import { useDeudas, type Deuda, type PagoDeuda } from '@/hooks/useDeudas';
import { useInversiones } from '@/hooks/useInversiones';
import { Card, CardContent } from '@/components/ui/card';
import { SkeletonRow } from '@/components/ui/SkeletonRow';
import { useDelayedVisible } from '@/hooks/useDelayedVisible';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
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
import { DrawerForm } from '@/components/ui/drawer-form';
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form';
import { PageHeader } from '@/components/ui/PageHeader';
import { format } from 'date-fns';

function formatARS(n: number): string {
  return new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

const deudaSchema = z.object({
  acreedor: z.string().trim().min(1, 'El acreedor es obligatorio.').max(80, 'El acreedor no puede superar los 80 caracteres.'),
  montoTotal: z.string().refine((v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) && n > 0;
  }, 'Ingresá un monto válido.'),
  cuotasTotales: z.string().optional().default(''),
  fechaInicio: z.string().min(1, 'Seleccioná una fecha.'),
  fechaProximoPago: z.string().optional().default(''),
  descripcion: z.string().max(240, 'La descripción no puede superar los 240 caracteres.').optional().default(''),
});

type DeudaFormValues = z.infer<typeof deudaSchema>;

const getDeudaFormDefaults = (): DeudaFormValues => ({
  acreedor: '',
  montoTotal: '',
  cuotasTotales: '',
  fechaInicio: format(new Date(), 'yyyy-MM-dd'),
  fechaProximoPago: '',
  descripcion: '',
});

export function DeudasPanel() {
  const { deudas, isLoading, addDeuda, registrarPago, deleteDeuda, fetchPagosDeuda } = useDeudas();
  const showSkeleton = useDelayedVisible(isLoading);
  const { inversiones } = useInversiones();

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [deudaAEliminar, setDeudaAEliminar] = useState<Deuda | null>(null);
  const [deudaAPagar, setDeudaAPagar] = useState<Deuda | null>(null);
  const [mostrarPagadas, setMostrarPagadas] = useState(false);

  const form = useForm<DeudaFormValues>({
    resolver: zodResolver(deudaSchema),
    defaultValues: getDeudaFormDefaults(),
  });

  // Resync el formulario en cada apertura — evita arrastrar valores de la deuda anterior.
  useEffect(() => {
    if (isFormOpen) {
      form.reset(getDeudaFormDefaults());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFormOpen]);

  // Monto por cuota calculado
  const montoTotalWatch = form.watch('montoTotal');
  const cuotasTotalesWatch = form.watch('cuotasTotales');
  const montoCuotaCalculado = useMemo(() => {
    const total = parseFloat(montoTotalWatch);
    const cuotas = parseInt(cuotasTotalesWatch, 10);
    if (!isFinite(total) || !isFinite(cuotas) || cuotas <= 0 || total <= 0) return 0;
    return total / cuotas;
  }, [montoTotalWatch, cuotasTotalesWatch]);

  const onSubmit = async (values: DeudaFormValues) => {
    const ok = await addDeuda({
      acreedor: values.acreedor.trim(),
      monto_total: parseFloat(values.montoTotal),
      cuotas_totales: values.cuotasTotales ? parseInt(values.cuotasTotales, 10) : undefined,
      monto_cuota: montoCuotaCalculado > 0 ? montoCuotaCalculado : undefined,
      fecha_inicio: new Date(values.fechaInicio),
      fecha_proximo_pago: values.fechaProximoPago ? new Date(values.fechaProximoPago) : undefined,
      descripcion: values.descripcion || undefined,
    });
    if (ok) {
      setIsFormOpen(false);
    }
  };

  const getInversionNombre = (invId: string | null) => {
    if (!invId) return null;
    return inversiones.find(i => i.id === invId)?.nombre || null;
  };

  const deudasActivas = deudas.filter(d => d.estado !== 'pagada');
  const deudasPagadas = deudas.filter(d => d.estado === 'pagada');

  const renderDeudaCard = (d: Deuda) => (
    <DeudaCard
      key={d.id}
      deuda={d}
      inversionNombre={getInversionNombre(d.inversion_id)}
      fetchPagosDeuda={fetchPagosDeuda}
      onRegistrarPago={() => setDeudaAPagar(d)}
      onEliminar={() => setDeudaAEliminar(d)}
    />
  );


  return (
    <div className="space-y-8">
      <PageHeader
        title="Deudas"
        icon={Landmark}
        subtitle="Compromisos financieros pendientes."
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
        title="Nueva deuda"
        size="md"
        isDirty={form.formState.isDirty}
        footer={
          <div className="flex w-full justify-end gap-2">
            <Button variant="outline" onClick={() => setIsFormOpen(false)} disabled={form.formState.isSubmitting}>
              Cancelar
            </Button>
            <Button type="submit" form="deuda-form" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? 'Guardando...' : 'Guardar'}
            </Button>
          </div>
        }
      >
        <Form {...form}>
          <form id="deuda-form" onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                name="cuotasTotales"
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
              <FormItem>
                <FormLabel>Monto por cuota</FormLabel>
                <div className="h-10 px-3 flex items-center rounded-md border border-input bg-muted text-sm text-muted-foreground">
                  {montoCuotaCalculado > 0 ? `$${formatARS(montoCuotaCalculado)}` : 'Se calcula automáticamente'}
                </div>
                <p className="text-xs text-muted-foreground mt-1">Calculado en base al monto total y la cantidad de cuotas.</p>
              </FormItem>
              <FormField
                control={form.control}
                name="fechaInicio"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fecha inicio</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
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
            <FormField
              control={form.control}
              name="descripcion"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Descripción (opcional)</FormLabel>
                  <FormControl>
                    <Textarea {...field} maxLength={240} placeholder="Detalle de la deuda..." />
                  </FormControl>
                  <p className="text-xs text-muted-foreground text-right">{(field.value ?? '').length}/240</p>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>
      </DrawerForm>

      <div className="space-y-3">
        <p className="text-sm font-medium text-muted-foreground">Activas</p>
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
        ) : deudasActivas.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              <Landmark className="h-10 w-10 mx-auto mb-2 opacity-50" />
              <p>No hay deudas activas</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {deudasActivas.map(renderDeudaCard)}
          </div>
        )}
      </div>

      {deudasPagadas.length > 0 && (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => setMostrarPagadas((v) => !v)}
            className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            {mostrarPagadas ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            Deudas pagadas ({deudasPagadas.length})
          </button>
          {mostrarPagadas && (
            <div className="space-y-3">
              {deudasPagadas.map(renderDeudaCard)}
            </div>
          )}
        </div>
      )}


      <AlertDialog open={!!deudaAEliminar} onOpenChange={(open) => !open && setDeudaAEliminar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar deuda</AlertDialogTitle>
            <AlertDialogDescription>
              {deudaAEliminar && (
                <>Vas a eliminar la deuda con <strong>{deudaAEliminar.acreedor}</strong>. Esta acción no se puede deshacer.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                if (deudaAEliminar) {
                  await deleteDeuda(deudaAEliminar.id);
                  setDeudaAEliminar(null);
                }
              }}
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <RegistrarPagoDialog
        deuda={deudaAPagar}
        onClose={() => setDeudaAPagar(null)}
        registrarPago={registrarPago}
      />

    </div>
  );
}

function RegistrarPagoDialog({
  deuda,
  onClose,
  registrarPago,
}: {
  deuda: Deuda | null;
  onClose: () => void;
  registrarPago: (
    deuda: Deuda,
    monto: number,
    fecha: string,
    observacion?: string,
  ) => Promise<boolean>;
}) {
  const saldoPendiente = deuda
    ? Math.max(0, Number(deuda.monto_total) - Number(deuda.monto_pagado))
    : 0;
  const sugerido = deuda
    ? Math.min(
        saldoPendiente,
        deuda.monto_cuota && deuda.monto_cuota > 0
          ? Number(deuda.monto_cuota)
          : saldoPendiente,
      )
    : 0;

  const [monto, setMonto] = useState<string>('');
  const [fecha, setFecha] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [observacion, setObservacion] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  // Valores iniciales de esta apertura, para detectar cambios sin guardar (isDirty del
  // DrawerForm) sin tocar la lógica de validación de arriba, que ya está bien.
  const [initial, setInitial] = useState({ monto: '', fecha: '', observacion: '' });

  // Reset on open
  useMemo(() => {
    if (deuda) {
      const initMonto = sugerido > 0 ? sugerido.toFixed(2) : '';
      const initFecha = format(new Date(), 'yyyy-MM-dd');
      setMonto(initMonto);
      setFecha(initFecha);
      setObservacion('');
      setInitial({ monto: initMonto, fecha: initFecha, observacion: '' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deuda?.id]);

  const isDirty = monto !== initial.monto || fecha !== initial.fecha || observacion !== initial.observacion;

  const montoNum = parseFloat(monto);
  const montoInvalido =
    !isFinite(montoNum) ||
    montoNum <= 0 ||
    montoNum > saldoPendiente + 0.009;

  const handleSubmit = async () => {
    if (!deuda || montoInvalido) return;
    setSubmitting(true);
    const ok = await registrarPago(deuda, montoNum, fecha, observacion);
    setSubmitting(false);
    if (ok) onClose();
  };

  return (
    <DrawerForm
      open={!!deuda}
      onOpenChange={(open) => !open && onClose()}
      title="Registrar pago"
      size="sm"
      isDirty={isDirty}
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting || montoInvalido || !fecha}
          >
            Registrar pago
          </Button>
        </div>
      }
    >
      {deuda && (
        <p className="text-xs text-muted-foreground mb-4">
          {deuda.acreedor} · Saldo pendiente ${formatARS(saldoPendiente)}
          {deuda.cuotas_totales && deuda.cuotas_totales > 0 ? (
            <> · Cuota {deuda.cuotas_pagadas + 1} de {deuda.cuotas_totales}</>
          ) : null}
        </p>
      )}

      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="pago-monto">Monto a pagar</Label>
          <CurrencyInput
            id="pago-monto"
            value={monto}
            onChange={setMonto}
            placeholder="0,00"
          />
          {montoInvalido && monto !== '' && (
            <p className="text-xs text-destructive">
              {montoNum <= 0
                ? 'El monto debe ser mayor a 0'
                : 'No puede superar el saldo pendiente'}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="pago-fecha">Fecha de pago</Label>
          <Input
            id="pago-fecha"
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="pago-obs">Observación (opcional)</Label>
          <Textarea
            id="pago-obs"
            value={observacion}
            onChange={(e) => setObservacion(e.target.value)}
            maxLength={240}
            rows={2}
            placeholder="Nota interna sobre este pago"
          />
        </div>
      </div>
    </DrawerForm>
  );
}

function DeudaCard({
  deuda,
  inversionNombre,
  fetchPagosDeuda,
  onRegistrarPago,
  onEliminar,
}: {
  deuda: Deuda;
  inversionNombre: string | null;
  fetchPagosDeuda: (id: string) => Promise<PagoDeuda[]>;
  onRegistrarPago: () => void;
  onEliminar: () => void;
}) {
  const esPagada = deuda.estado === 'pagada';
  const pendiente = Math.max(0, Number(deuda.monto_total) - Number(deuda.monto_pagado));
  const progreso = deuda.monto_total > 0 ? (deuda.monto_pagado / deuda.monto_total) * 100 : 0;
  const tieneCuotas = !!deuda.cuotas_totales && deuda.cuotas_totales > 0;

  const [expandido, setExpandido] = useState(false);
  const [pagos, setPagos] = useState<PagoDeuda[] | null>(null);
  const [cargando, setCargando] = useState(false);

  // Refresca el historial cuando cambia monto_pagado (nuevo pago) si está abierto
  useEffect(() => {
    if (!expandido) return;
    let active = true;
    setCargando(true);
    fetchPagosDeuda(deuda.id).then((res) => {
      if (!active) return;
      setPagos(res);
      setCargando(false);
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandido, deuda.id, deuda.monto_pagado]);

  const titulo = deuda.descripcion?.trim() || deuda.acreedor;
  const subtitulo = deuda.descripcion?.trim() ? deuda.acreedor : null;

  return (
    <Card className={esPagada ? 'opacity-70' : ''}>
      <CardContent className="py-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Landmark className="h-4 w-4 text-primary flex-shrink-0" />
              <span className="font-medium text-foreground truncate">{titulo}</span>
              <Badge variant={esPagada ? 'default' : 'secondary'} className="text-xs">
                {esPagada ? (
                  <>
                    <CheckCircle2 className="h-3 w-3 mr-1" /> Pagada
                  </>
                ) : (
                  'Activa'
                )}
              </Badge>
              {inversionNombre && (
                <Badge variant="outline" className="text-xs">Inversión: {inversionNombre}</Badge>
              )}
            </div>
            {subtitulo && (
              <p className="text-xs text-muted-foreground">{subtitulo}</p>
            )}

            <div className="text-sm text-muted-foreground space-y-1">
              {tieneCuotas && (
                <p className="text-xs">
                  {deuda.cuotas_pagadas} / {deuda.cuotas_totales} cuotas pagadas
                </p>
              )}
              <div className="flex items-center gap-2">
                <Progress value={progreso} className="h-2 flex-1" />
                <span className="text-xs whitespace-nowrap">
                  ${formatARS(deuda.monto_pagado)} / ${formatARS(deuda.monto_total)}
                </span>
              </div>
              {!esPagada && (
                <p className="text-xs">
                  Pendiente: <span className="text-foreground font-medium">${formatARS(pendiente)}</span>
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1">
            {!esPagada && (
              <Button size="sm" variant="outline" onClick={onRegistrarPago}>
                <CreditCard className="h-3 w-3 mr-1" /> Registrar pago
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="text-destructive h-8 w-8"
              onClick={onEliminar}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="border-t pt-2">
          <button
            type="button"
            onClick={() => setExpandido((v) => !v)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {expandido ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {expandido ? 'Ocultar historial de pagos' : 'Ver historial de pagos'}
          </button>

          {expandido && (
            <div className="mt-2">
              {cargando ? (
                <p className="text-xs text-muted-foreground">Cargando pagos…</p>
              ) : !pagos || pagos.length === 0 ? (
                <p className="text-xs text-muted-foreground">Sin pagos registrados.</p>
              ) : (
                <ul className="divide-y divide-border rounded-md border bg-muted/30">
                  {pagos.map((p) => (
                    <li key={p.id} className="px-3 py-2 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-foreground">
                          <span className="font-medium">${formatARS(Number(p.monto))}</span>
                          {p.numero_cuota != null && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                              Cuota {p.numero_cuota}
                            </Badge>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(p.fecha_pago + 'T00:00:00'), 'dd/MM/yyyy')}
                        </span>
                      </div>
                      {p.observacion && (
                        <p className="text-xs text-muted-foreground mt-1">{p.observacion}</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
