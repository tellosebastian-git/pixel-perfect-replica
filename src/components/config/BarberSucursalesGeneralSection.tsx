import { useEffect, useState, useCallback } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { useDelayedVisible } from '@/hooks/useDelayedVisible';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Trash2, MapPin, Repeat, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form';
import { DrawerForm } from '@/components/ui/drawer-form';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import {
  useBarberosSucursales,
  type BarberoSucursalRow,
} from '@/hooks/useBarberosSucursales';
import { WeekdayPicker, formatDiasSemana } from './WeekdayPicker';
import { useAuth } from '@/contexts/AuthContext';

interface Props {
  barberoId: string;
  organizationId: string;
  sucursales: { id: string; nombre: string }[];
  /** Notificar al padre cuando cambia la sucursal principal para refrescar listas. */
  onPrincipalChanged?: () => void | Promise<void>;
  /** Navegar a Mi Negocio > sucursal > sección equipo para este barbero. */
  onVerConfig?: (sucursalId: string, barberoId: string) => void;
}

/**
 * Sección embebida en cada barbero del panel Equipo General.
 * Permite gestionar la sucursal principal (doble escritura legacy + bs)
 * y las asignaciones recurrentes a otras sucursales.
 */
export function BarberSucursalesGeneralSection({
  barberoId, organizationId, sucursales, onPrincipalChanged, onVerConfig,
}: Props) {
  const { isOwner, isGeneralManager } = useAuth();
  const canManageRecurrentes = isOwner || isGeneralManager;
  const bs = useBarberosSucursales(organizationId);

  const [loading, setLoading] = useState(true);
  const showSkeleton = useDelayedVisible(loading);
  const [fetchError, setFetchError] = useState(false);
  const [rows, setRows] = useState<BarberoSucursalRow[]>([]);
  const [savingPrincipal, setSavingPrincipal] = useState(false);
  const [recurrenteOpen, setRecurrenteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<BarberoSucursalRow | null>(null);

  const fetchRows = useCallback(async () => {
    if (!organizationId || !barberoId) return;
    setLoading(true);
    setFetchError(false);
    try {
      const list = await bs.listByBarbero(barberoId);
      setRows(list);
    } catch (e: any) {
      console.error('BarberSucursalesGeneralSection fetch error', e);
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  }, [bs, organizationId, barberoId]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const principal = rows.find(r => r.tipo === 'principal');
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const recurrentes = rows.filter(r => r.tipo === 'recurrente');
  const recurrentesVigentes = recurrentes.filter(r =>
    !r.fecha_fin || new Date(r.fecha_fin) >= hoy
  );

  const handleChangePrincipal = async (newSucursalId: string) => {
    if (!newSucursalId || newSucursalId === principal?.sucursal_id) return;
    setSavingPrincipal(true);
    try {
      await bs.savePrincipalDualWrite(barberoId, newSucursalId);
      toast.success('Sucursal principal actualizada');
      await fetchRows();
      if (onPrincipalChanged) await onPrincipalChanged();
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo actualizar la sucursal principal');
    } finally {
      setSavingPrincipal(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await bs.deleteRow(deleteTarget.id);
      toast.success('Asignación recurrente eliminada');
      setDeleteTarget(null);
      await fetchRows();
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo eliminar');
    }
  };

  const sucursalName = (id: string) => sucursales.find(s => s.id === id)?.nombre || '—';

  return (
    <div className="pt-3 mt-3 border-t border-border/50 space-y-3">
      <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
        <MapPin className="h-3.5 w-3.5" /> Sucursales
      </div>

      {loading ? (
        showSkeleton ? (
          <div className="space-y-1.5">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-3.5 w-28" />
          </div>
        ) : null
      ) : fetchError ? (
        <div className="flex items-center gap-2 py-2">
          <p className="text-xs text-destructive flex-1">No se pudo cargar la información · </p>
          <button
            onClick={() => { setFetchError(false); void fetchRows(); }}
            className="text-xs text-primary hover:underline"
          >
            Reintentar
          </button>
        </div>
      ) : (
        <>
          {/* Principal */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Sucursal principal</Label>
            <Select
              value={principal?.sucursal_id ?? ''}
              onValueChange={handleChangePrincipal}
              disabled={savingPrincipal}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Sin asignar" />
              </SelectTrigger>
              <SelectContent>
                {sucursales.length === 0 ? (
                  <SelectItem value="__empty__" disabled>Sin sucursales configuradas</SelectItem>
                ) : (
                  sucursales.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.nombre}</SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            {principal?.sucursal_id && sucursales.some(s => s.id === principal.sucursal_id) && (
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-xs">Principal</Badge>
                {onVerConfig && (
                  <button
                    className="flex items-center gap-0.5 text-xs text-primary hover:underline underline-offset-2"
                    onClick={() => onVerConfig(principal.sucursal_id, barberoId)}
                  >
                    Ver config <ArrowRight className="h-3 w-3" />
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Recurrentes */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs text-muted-foreground">
                Sucursales secundarias 
              </Label>
              {canManageRecurrentes && (
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setRecurrenteOpen(true)}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Agregar
                </Button>
              )}
            </div>

            {recurrentesVigentes.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">Sin asignaciones</p>
            ) : (
              <div className="space-y-1.5">
                {recurrentesVigentes.map(r => (
                  <div key={r.id} className="flex items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="text-xs">
                        <Repeat className="h-3 w-3 mr-1" /> {sucursalName(r.sucursal_id)}
                      </Badge>
                      <span className="text-muted-foreground">
                        {formatDiasSemana(r.dias_semana)}
                        {r.fecha_inicio && ` · desde ${formatShortDate(r.fecha_inicio)}`}
                        {r.fecha_fin && ` · hasta ${formatShortDate(r.fecha_fin)}`}
                      </span>
                      {onVerConfig && sucursales.some(s => s.id === r.sucursal_id) && (
                        <button
                          className="flex items-center gap-0.5 text-xs text-primary hover:underline underline-offset-2"
                          onClick={() => onVerConfig(r.sucursal_id, barberoId)}
                        >
                          Ver config <ArrowRight className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                    {canManageRecurrentes && (
                      <Button
                        variant="ghost" size="icon" className="h-7 w-7"
                        onClick={() => setDeleteTarget(r)}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Sheet: agregar recurrente */}
      {canManageRecurrentes && (
        <AgregarRecurrenteSheet
          open={recurrenteOpen}
          onOpenChange={setRecurrenteOpen}
          organizationId={organizationId}
          barberoId={barberoId}
          sucursales={sucursales}
          principalSucursalId={principal?.sucursal_id}
          onCreated={fetchRows}
        />
      )}

      {/* Eliminar recurrente */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar asignación recurrente</AlertDialogTitle>
            <AlertDialogDescription>
              Se quitará la asignación recurrente a {deleteTarget ? sucursalName(deleteTarget.sucursal_id) : ''}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}`;
}

interface AgregarRecurrenteSheetProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  organizationId: string;
  barberoId: string;
  sucursales: { id: string; nombre: string }[];
  principalSucursalId?: string;
  onCreated: () => void | Promise<void>;
}

const agregarRecurrenteSchema = z.object({
  sucursalId: z.string().min(1, 'Elegí una sucursal.'),
  dias: z.array(z.number()).min(1, 'Elegí al menos un día de la semana.'),
  fechaInicio: z.string().optional().default(''),
  fechaFin: z.string().optional().default(''),
}).superRefine((data, ctx) => {
  if (data.fechaInicio && data.fechaFin && data.fechaFin < data.fechaInicio) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['fechaFin'], message: 'No puede ser anterior a la fecha de inicio.' });
  }
});
type AgregarRecurrenteFormValues = z.infer<typeof agregarRecurrenteSchema>;

function AgregarRecurrenteSheet({
  open, onOpenChange, organizationId, barberoId, sucursales, principalSucursalId, onCreated,
}: AgregarRecurrenteSheetProps) {
  const bs = useBarberosSucursales(organizationId);
  const selectable = sucursales.filter(s => s.id !== principalSucursalId);

  const defaults = (): AgregarRecurrenteFormValues => ({ sucursalId: '', dias: [], fechaInicio: '', fechaFin: '' });
  const form = useForm<AgregarRecurrenteFormValues>({
    resolver: zodResolver(agregarRecurrenteSchema),
    defaultValues: defaults(),
  });
  const saving = form.formState.isSubmitting;
  const fechaInicioWatch = form.watch('fechaInicio');

  useEffect(() => {
    if (open) form.reset(defaults());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleClose = () => {
    onOpenChange(false);
    form.reset(defaults());
  };

  const onSubmit = async (values: AgregarRecurrenteFormValues) => {
    try {
      await bs.insertRecurrente({
        barbero_id: barberoId,
        sucursal_id: values.sucursalId,
        dias_semana: values.dias,
        fecha_inicio: values.fechaInicio || null,
        fecha_fin: values.fechaFin || null,
      });
      toast.success('Asignación recurrente creada');
      handleClose();
      await onCreated();
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo crear');
    }
  };

  return (
    <DrawerForm
      open={open}
      onOpenChange={(o) => { if (!o) handleClose(); }}
      title="Sucursal secundaria recurrente"
      size="sm"
      isDirty={form.formState.isDirty}
      footer={
        <div className="flex w-full justify-between">
          <Button variant="ghost" disabled={saving} onClick={handleClose}>
            Cancelar
          </Button>
          <Button disabled={saving} onClick={form.handleSubmit(onSubmit)}>
            {saving ? 'Guardando...' : 'Guardar'}
          </Button>
        </div>
      }
    >
      <Form {...form}>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Definí en qué sucursal trabaja este barbero ciertos días de la semana.
          </p>
          <FormField
            control={form.control}
            name="sucursalId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Sucursal</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger><SelectValue placeholder="Elegí una sucursal" /></SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {selectable.length === 0 ? (
                      <SelectItem value="__empty__" disabled>Sin sucursales configuradas</SelectItem>
                    ) : (
                      selectable.map(s => (
                        <SelectItem key={s.id} value={s.id}>{s.nombre}</SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="dias"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Días de la semana</FormLabel>
                <WeekdayPicker value={field.value} onChange={field.onChange} />
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="grid grid-cols-2 gap-3">
            <FormField
              control={form.control}
              name="fechaInicio"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Desde (opcional)</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
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
                  <FormLabel>Hasta (opcional)</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} min={fechaInicioWatch || undefined} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>
      </Form>
    </DrawerForm>
  );
}
