import { useState, useEffect, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useDelayedVisible } from '@/hooks/useDelayedVisible';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { DatePicker } from '@/components/ui/date-picker';
import { TimePicker } from '@/components/ui/time-picker';
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form';
import { DrawerForm } from '@/components/ui/drawer-form';
import { ShieldOff, Plus, Trash2, Calendar } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Barber } from '@/types/barbershop';

interface BloqueosSectionProps {
  sucursalId: string;
  organizationId: string;
  barbers: Barber[];
}

interface Bloqueo {
  id: string;
  fecha_inicio: string;
  fecha_fin: string;
  todo_el_dia: boolean;
  hora_inicio: string | null;
  hora_fin: string | null;
  motivo: string | null;
  barbero_id: string | null;
}

const bloqueoSchema = z.object({
  fecha_inicio: z.string().min(1, 'La fecha de inicio es obligatoria.'),
  fecha_fin: z.string().min(1, 'La fecha de fin es obligatoria.'),
  todo_el_dia: z.boolean(),
  hora_inicio: z.string(),
  hora_fin: z.string(),
  motivo: z.string().max(240, 'El motivo no puede superar los 240 caracteres.').optional(),
  barbero_id: z.string(),
}).superRefine((data, ctx) => {
  if (data.fecha_inicio && data.fecha_fin && data.fecha_fin < data.fecha_inicio) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['fecha_fin'],
      message: 'La fecha fin debe ser posterior a la fecha inicio.',
    });
  }
});

type BloqueoFormValues = z.infer<typeof bloqueoSchema>;

const emptyValues: BloqueoFormValues = {
  fecha_inicio: '',
  fecha_fin: '',
  todo_el_dia: true,
  hora_inicio: '09:00',
  hora_fin: '18:00',
  motivo: '',
  barbero_id: '__sucursal__',
};

export function BloqueosSection({ sucursalId, organizationId, barbers }: BloqueosSectionProps) {
  const [bloqueos, setBloqueos] = useState<Bloqueo[]>([]);
  const [loading, setLoading] = useState(true);
  const showSkeleton = useDelayedVisible(loading);
  const [showForm, setShowForm] = useState(false);

  const form = useForm<BloqueoFormValues>({
    resolver: zodResolver(bloqueoSchema),
    defaultValues: emptyValues,
  });

  const fetchBloqueos = useCallback(async () => {
    const today = new Date().toISOString().split('T')[0];
    const { data } = await supabase
      .from('bloqueos_agenda')
      .select('*')
      .eq('sucursal_id', sucursalId)
      .gte('fecha_fin', today)
      .order('fecha_inicio', { ascending: false });
    if (data) {
      setBloqueos(data.map(b => ({
        id: b.id,
        fecha_inicio: b.fecha_inicio,
        fecha_fin: b.fecha_fin,
        todo_el_dia: b.todo_el_dia,
        hora_inicio: b.hora_inicio,
        hora_fin: b.hora_fin,
        motivo: b.motivo,
        barbero_id: b.barbero_id,
      })));
    }
    setLoading(false);
  }, [sucursalId]);

  useEffect(() => { fetchBloqueos(); }, [fetchBloqueos]);

  const openCreate = () => {
    form.reset(emptyValues);
    setShowForm(true);
  };

  const closeDrawer = () => setShowForm(false);

  const onSubmit = async (values: BloqueoFormValues) => {
    const insert: any = {
      sucursal_id: sucursalId,
      organization_id: organizationId,
      fecha_inicio: values.fecha_inicio,
      fecha_fin: values.fecha_fin,
      todo_el_dia: values.todo_el_dia,
      motivo: values.motivo || null,
    };
    if (!values.todo_el_dia) {
      insert.hora_inicio = values.hora_inicio;
      insert.hora_fin = values.hora_fin;
    }
    if (values.barbero_id !== '__sucursal__') {
      insert.barbero_id = values.barbero_id;
    }

    const { error } = await supabase.from('bloqueos_agenda').insert(insert);
    if (error) { toast.error('Error al crear bloqueo'); return; }
    toast.success('Ausencia registrada');
    closeDrawer();
    fetchBloqueos();
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('bloqueos_agenda').delete().eq('id', id);
    if (error) { toast.error('Error al eliminar'); return; }
    toast.success('Bloqueo eliminado');
    fetchBloqueos();
  };

  const getBarberName = (barberoId: string | null) => {
    if (!barberoId) return null;
    const b = barbers.find(x => x.id === barberoId);
    return b ? `${b.firstName} ${b.lastName}` : 'Barbero desconocido';
  };

  const formatDate = (d: string) => {
    try { return format(new Date(d + 'T12:00:00'), 'dd MMM yyyy', { locale: es }); }
    catch { return d; }
  };

  const todoElDiaValue = form.watch('todo_el_dia');

  if (loading) {
    if (!showSkeleton) return null;
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Skeleton className="w-8 h-8 rounded-lg shrink-0" />
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-44" />
                <Skeleton className="h-3 w-64 max-w-full" />
              </div>
            </div>
            <Skeleton className="h-9 w-32 shrink-0" />
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="border rounded-lg p-3">
              <Skeleton className="h-4 w-40 mb-2" />
              <Skeleton className="h-3 w-24" />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <>
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Chip primary, no destructive: registrar una ausencia es una regla
                de agenda que se edita acá, no una acción destructiva. Ver la
                regla de color de chip en CRITERIOS_DISEÑO.md §1.9. */}
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <ShieldOff className="w-4 h-4 text-primary" />
            </div>
            <div>
              <CardTitle className="text-sm">Gestionar ausencias y cierres</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Registrá días o franjas horarias en las que la sucursal o un barbero no estarán disponibles para recibir turnos.
              </p>
            </div>
          </div>
          <Button size="sm" variant="outline" className="h-9 shrink-0 text-xs" onClick={openCreate}>
            <Plus className="h-3 w-3 mr-1" /> Nueva ausencia
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {bloqueos.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-4">No hay ausencias o cierres registrados</p>
        )}

        {bloqueos.map(b => (
          <div key={b.id} className="flex items-start justify-between border rounded-lg p-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant={b.barbero_id ? 'outline' : 'secondary'} className="text-[10px] h-5">
                  {b.barbero_id ? getBarberName(b.barbero_id) : 'Sucursal'}
                </Badge>
                <span className="text-xs font-medium flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  {formatDate(b.fecha_inicio)}
                  {b.fecha_fin !== b.fecha_inicio && ` – ${formatDate(b.fecha_fin)}`}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px] h-4">
                  {b.todo_el_dia ? 'Todo el día' : `${b.hora_inicio} – ${b.hora_fin}`}
                </Badge>
                {b.motivo && <span className="text-xs text-muted-foreground">{b.motivo}</span>}
              </div>
            </div>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0" onClick={() => handleDelete(b.id)}>
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>

      <DrawerForm
        open={showForm}
        onOpenChange={(o) => { if (!o) closeDrawer(); }}
        title="Nueva ausencia"
        size="sm"
        isDirty={form.formState.isDirty}
        footer={
          <div className="flex w-full justify-end gap-2">
            <Button variant="ghost" onClick={closeDrawer} disabled={form.formState.isSubmitting}>Cancelar</Button>
            <Button onClick={form.handleSubmit(onSubmit)} disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? 'Guardando...' : 'Crear ausencia'}
            </Button>
          </div>
        }
      >
        <Form {...form}>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="fecha_inicio"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Fecha inicio</FormLabel>
                    <FormControl>
                      <DatePicker value={field.value || null} onChange={(v) => field.onChange(v ?? '')} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="fecha_fin"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Fecha fin</FormLabel>
                    <FormControl>
                      <DatePicker value={field.value || null} onChange={(v) => field.onChange(v ?? '')} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="todo_el_dia"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center gap-2 space-y-0">
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} className="scale-75" />
                  </FormControl>
                  <FormLabel className="text-xs">Todo el día</FormLabel>
                </FormItem>
              )}
            />

            {!todoElDiaValue && (
              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="hora_inicio"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Hora inicio</FormLabel>
                      <FormControl>
                        <TimePicker value={field.value} onChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="hora_fin"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Hora fin</FormLabel>
                      <FormControl>
                        <TimePicker value={field.value} onChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>
            )}

            <FormField
              control={form.control}
              name="barbero_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs">Aplica a</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="h-8 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="__sucursal__">Toda la sucursal</SelectItem>
                      {barbers.filter(b => b.active).map(b => (
                        <SelectItem key={b.id} value={b.id}>{b.firstName} {b.lastName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="motivo"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs">Motivo (opcional)</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      placeholder="Ej: Feriado, vacaciones..."
                      className="min-h-[60px] text-sm"
                      maxLength={240}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </Form>
      </DrawerForm>
    </>
  );
}
