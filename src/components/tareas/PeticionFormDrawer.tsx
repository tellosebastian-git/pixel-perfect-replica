import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { DrawerForm } from '@/components/ui/drawer-form';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { TareaInsert } from '@/hooks/useTareas';
import { mensajeTareas } from '@/lib/tareasData';

const TITULO_MAX = 80;
const DESCRIPCION_MAX = 240;
const PLAZOS = [15, 30, 60, 90];

const schema = z.object({
  titulo: z.string().trim().min(1, 'El título es obligatorio.').min(3, 'El título debe tener al menos 3 caracteres.').max(TITULO_MAX),
  descripcion: z.string().trim().max(DESCRIPCION_MAX, `La descripción no puede superar ${DESCRIPCION_MAX} caracteres.`),
  vencimientoDias: z.number({ invalid_type_error: 'Escribí una cantidad de días.' }).int().min(1, 'Mínimo 1 día.').max(365, 'Máximo 365 días.'),
});
type Valores = z.infer<typeof schema>;
const vacio: Valores = { titulo: '', descripcion: '', vencimientoDias: 60 };

interface Props {
  open: boolean;
  onClose: () => void;
  /** Quién la pide (validado con PIN en cuentas de sucursal). */
  creadorNombre?: string;
  onCrear: (payload: TareaInsert) => Promise<unknown>;
}

/** Principal → Tareas → Peticiones → Nueva petición. Mismos campos y plazos que antes, en el panel canónico. */
export function PeticionFormDrawer({ open, onClose, creadorNombre, onCrear }: Props) {
  const form = useForm<Valores>({ resolver: zodResolver(schema), defaultValues: vacio });
  useEffect(() => { if (open) form.reset(vacio); }, [open, form]);
  const enviando = form.formState.isSubmitting;
  const errorRaiz = form.formState.errors.root?.message;

  const onSubmit = form.handleSubmit(async v => {
    try {
      await onCrear({ tipo: 'peticion', titulo: v.titulo, descripcion: v.descripcion || undefined, creado_por_nombre: creadorNombre, vencimiento_dias: v.vencimientoDias });
      form.reset(vacio);
      onClose();
    } catch (error) {
      form.setError('root', { message: mensajeTareas(error, 'No pudimos crear la petición. Revisá los datos y reintentá.') });
    }
  });

  return (
    <DrawerForm open={open} onOpenChange={next => { if (!next) onClose(); }} size="sm" title="Nueva petición"
      description="Pedile algo al equipo de gestión y definí en cuántos días debería resolverse."
      isDirty={form.formState.isDirty && !enviando}
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={enviando}>Cancelar</Button>
          <Button type="submit" form="peticion-form" disabled={enviando}>
            {enviando && <Loader2 className="animate-spin" aria-hidden />}
            {enviando ? 'Creando…' : 'Crear petición'}
          </Button>
        </div>
      }>
      <Form {...form}>
        <form id="peticion-form" noValidate onSubmit={onSubmit} className="space-y-5">
          {creadorNombre && <p className="text-sm text-muted-foreground">La pide <span className="font-medium text-foreground">{creadorNombre}</span></p>}
          {errorRaiz && (
            <div role="alert" className="flex items-start gap-2 rounded-lg border border-status-error bg-status-error-bg p-3 text-sm text-status-error-foreground">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /><span>{errorRaiz}</span>
            </div>
          )}
          <FormField control={form.control} name="titulo" render={({ field }) => (
            <FormItem>
              <FormLabel>Título</FormLabel>
              <FormControl><Input {...field} maxLength={TITULO_MAX} placeholder="Ej: Comprar toallas nuevas" autoComplete="off" /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="descripcion" render={({ field }) => (
            <FormItem>
              <FormLabel>Descripción (opcional)</FormLabel>
              <FormControl><Textarea {...field} rows={3} maxLength={DESCRIPCION_MAX} className="resize-none" /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="vencimientoDias" render={({ field }) => (
            <FormItem>
              <FormLabel>Vence en</FormLabel>
              <ToggleGroup type="single" variant="outline" value={PLAZOS.includes(field.value) ? String(field.value) : ''}
                onValueChange={v => v && field.onChange(Number(v))} className="flex flex-wrap justify-start gap-2" aria-label="Plazo sugerido">
                {PLAZOS.map(d => (
                  <ToggleGroupItem key={d} value={String(d)} className="h-10 px-3.5 data-[state=on]:border-primary data-[state=on]:bg-primary/10 data-[state=on]:text-primary">
                    {d} días
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <div className="flex items-center gap-2">
                <FormControl>
                  <Input type="number" inputMode="numeric" min={1} max={365} className="w-24" aria-label="Días hasta que vence"
                    value={Number.isNaN(field.value) ? '' : field.value} onChange={e => field.onChange(e.target.valueAsNumber)} />
                </FormControl>
                <span className="text-sm text-muted-foreground">días</span>
              </div>
              <FormDescription>Si nadie la resuelve en ese plazo, queda vencida.</FormDescription>
              <FormMessage />
            </FormItem>
          )} />
        </form>
      </Form>
    </DrawerForm>
  );
}
