import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlertTriangle, CalendarDays, ClipboardList, Info, Loader2, Minus, Plus, Repeat, Users } from 'lucide-react';
import { DrawerForm, DrawerFormSection } from '@/components/ui/drawer-form';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { DatePicker } from '@/components/ui/date-picker';
import { TimePicker } from '@/components/ui/time-picker';
import { useSucursal } from '@/contexts/SucursalContext';
import { useTareaResponsables } from '@/hooks/useTareaResponsables';
import { useOrganizationToday } from '@/hooks/useOrganizationToday';
import type { Tarea, TareaInsert } from '@/hooks/useTareas';
import type { TareaRecurrente, TareaRecurrenteUpdate } from '@/hooks/useTareasRecurrentes';
import { addCivilDays, mensajeTareas } from '@/lib/tareasData';
import { formatDiaLargo } from '@/lib/tareasAgenda';
import { DIAS_SEMANA, FRECUENCIAS, REPETICIONES, describirRepeticion } from '@/lib/tareasRepeticion';
import { TareasLoadError } from './TareasLoadError';

export type TareaFormModo =
  | { tipo: 'nueva'; automatica?: boolean }
  | { tipo: 'editar-tarea'; tarea: Tarea }
  | { tipo: 'editar-automatica'; receta: TareaRecurrente };

export type TareaPatch = Pick<Tarea, 'titulo' | 'descripcion' | 'asignado_a_id' | 'asignado_a_nombre' | 'assignment_scope' | 'fecha_inicio' | 'hora'>;

interface Props {
  /** `null` = cerrado. */
  modo: TareaFormModo | null;
  onClose: () => void;
  onCrear: (payload: TareaInsert) => Promise<unknown>;
  onActualizarTarea: (id: string, patch: TareaPatch) => Promise<unknown>;
  onActualizarAutomatica: (patch: TareaRecurrenteUpdate) => Promise<unknown>;
  /** Título de la Tarea automática que generó una tarea, si se conoce. */
  automaticaTitulo?: (recurrenciaId: string) => string | null;
  /** Abre la Tarea automática de origen (solo para quien puede editarla). */
  onEditarAutomatica?: (recurrenciaId: string) => void;
}

const EQUIPO = '__team__';
const TITULO_MIN = 3;
const TITULO_MAX = 80;
const DESCRIPCION_MAX = 240;
const ERROR_GUARDADO = 'No pudimos guardar los cambios. Revisá los datos y reintentá.';

type Cuando = 'hoy' | 'manana' | 'otra' | 'sin';
type Frecuencia = 'daily' | 'weekly' | 'monthly' | 'yearly';

interface Valores {
  titulo: string;
  descripcion: string;
  sucursalId: string;
  responsable: string;
  cuando: Cuando;
  fecha: string | null;
  conHora: boolean;
  hora: string;
  repeticion: string;
  frecuencia: Frecuencia;
  intervalo: number;
  dias: number[];
}

const diaSemana = (fecha: string) => new Date(`${fecha}T00:00:00Z`).getUTCDay();

function cuandoDe(fecha: string | null, today: string): Cuando {
  if (!fecha) return 'sin';
  if (fecha === today) return 'hoy';
  if (fecha === addCivilDays(today, 1)) return 'manana';
  return 'otra';
}

function valoresIniciales(modo: TareaFormModo, today: string, sucursalActual: string): Valores {
  const base: Valores = {
    titulo: '', descripcion: '', sucursalId: sucursalActual, responsable: EQUIPO, cuando: 'hoy', fecha: today,
    conHora: false, hora: '09:00', repeticion: 'never', frecuencia: 'weekly', intervalo: 1, dias: [],
  };
  if (modo.tipo === 'nueva') return { ...base, repeticion: modo.automatica ? 'weekly' : 'never' };
  if (modo.tipo === 'editar-tarea') {
    const t = modo.tarea;
    const fecha = t.fecha_inicio ?? t.fecha_limite ?? null;
    return {
      ...base, titulo: t.titulo ?? '', descripcion: t.descripcion ?? '', sucursalId: t.sucursal_id ?? '',
      responsable: t.assignment_scope === 'team' || !t.asignado_a_id ? EQUIPO : t.asignado_a_id,
      cuando: cuandoDe(fecha, today), fecha, conHora: !!t.hora, hora: t.hora ?? '09:00',
    };
  }
  const r = modo.receta;
  return {
    ...base, titulo: r.titulo ?? '', descripcion: r.descripcion ?? '', sucursalId: r.sucursal_id,
    responsable: r.assignment_scope === 'team' || !r.asignado_a ? EQUIPO : r.asignado_a,
    cuando: cuandoDe(r.fecha_inicio, today), fecha: r.fecha_inicio, conHora: !!r.hora, hora: r.hora ?? '09:00',
    repeticion: r.repeat_preset && r.repeat_preset !== 'never' ? r.repeat_preset : 'weekly',
    frecuencia: (FRECUENCIAS.some(f => f.value === r.repeat_frequency) ? r.repeat_frequency : 'weekly') as Frecuencia,
    intervalo: r.repeat_interval ?? 1, dias: r.repeat_byweekday ?? [],
  };
}

const fechaEfectiva = (v: Pick<Valores, 'cuando' | 'fecha'>, today: string) =>
  v.cuando === 'hoy' ? today : v.cuando === 'manana' ? addCivilDays(today, 1) : v.cuando === 'otra' ? v.fecha : null;

/**
 * Tareas → Nueva tarea / Nueva Tarea automática / Editar. Un solo formulario: elegir una repetición
 * convierte el alta en una Tarea automática (cambian título, explicación, fecha y acción final).
 * Editar una tarea generada no toca la programación: eso se edita en su Tarea automática.
 */
export function TareaFormDrawer({ modo, onClose, onCrear, onActualizarTarea, onActualizarAutomatica, automaticaTitulo, onEditarAutomatica }: Props) {
  const open = !!modo;
  const [ultimoModo, setUltimoModo] = useState<TareaFormModo | null>(modo);
  useEffect(() => { if (modo) setUltimoModo(modo); }, [modo]);
  const m = modo ?? ultimoModo ?? { tipo: 'nueva' as const };

  const today = useOrganizationToday();
  const { currentSucursal, sucursales, error: branchError, isLoading: branchLoading, refreshSucursales } = useSucursal();
  const esNueva = m.tipo === 'nueva';
  const tareaEditada = m.tipo === 'editar-tarea' ? m.tarea : null;
  const recetaEditada = m.tipo === 'editar-automatica' ? m.receta : null;
  const eligeSucursal = esNueva && !currentSucursal;

  // El esquema depende del contexto (sucursal, equipo, modo): el resolver siempre usa el vigente.
  const schemaRef = useRef<z.ZodTypeAny | null>(null);
  const form = useForm<Valores>({
    defaultValues: valoresIniciales(m, today, currentSucursal?.id ?? ''),
    resolver: (values, context, options) => zodResolver(schemaRef.current!)(values, context, options),
  });
  const [sucursalId, repeticion, cuando, fecha, conHora, frecuencia, intervalo, dias, responsable] = useWatch({
    control: form.control,
    name: ['sucursalId', 'repeticion', 'cuando', 'fecha', 'conHora', 'frecuencia', 'intervalo', 'dias', 'responsable'],
  });
  const responsables = useTareaResponsables(sucursalId || null, open && !!sucursalId);
  const personas = useMemo(() => responsables.data ?? [], [responsables.data]);
  const asignadoOriginal = tareaEditada?.asignado_a_id ?? recetaEditada?.asignado_a ?? null;
  const nombreOriginal = tareaEditada?.asignado_a_nombre ?? recetaEditada?.asignado_nombre ?? null;

  const esAutomatica = m.tipo === 'editar-automatica' || (esNueva && repeticion !== 'never');
  const muestraRepeticion = esNueva || m.tipo === 'editar-automatica';

  const schema = useMemo(() => z.object({
    titulo: z.string().trim()
      .min(1, 'El título es obligatorio.')
      .min(TITULO_MIN, `El título debe tener al menos ${TITULO_MIN} caracteres.`)
      .max(TITULO_MAX, `El título no puede superar ${TITULO_MAX} caracteres.`),
    descripcion: z.string().trim().max(DESCRIPCION_MAX, `La descripción no puede superar ${DESCRIPCION_MAX} caracteres.`),
    sucursalId: z.string(),
    responsable: z.string(),
    cuando: z.enum(['hoy', 'manana', 'otra', 'sin']),
    fecha: z.string().nullable(),
    conHora: z.boolean(),
    hora: z.string(),
    repeticion: z.string(),
    frecuencia: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
    intervalo: z.number().int().min(1).max(99),
    dias: z.array(z.number()),
  }).superRefine((v, ctx) => {
    if (eligeSucursal && !sucursales.some(s => s.id === v.sucursalId && s.activa)) {
      ctx.addIssue({ code: 'custom', path: ['sucursalId'], message: 'Elegí una sucursal para guardar la tarea.' });
    }
    const valido = v.responsable === EQUIPO || personas.some(p => p.id === v.responsable) || (!esNueva && v.responsable === asignadoOriginal);
    if (!valido) ctx.addIssue({ code: 'custom', path: ['responsable'], message: 'Elegí una persona que pertenezca a esta sucursal.' });
    const automatica = m.tipo === 'editar-automatica' || (esNueva && v.repeticion !== 'never');
    if (v.cuando === 'otra' && !v.fecha) ctx.addIssue({ code: 'custom', path: ['fecha'], message: 'Elegí la fecha.' });
    if (automatica && v.cuando === 'sin') ctx.addIssue({ code: 'custom', path: ['cuando'], message: 'Elegí desde cuándo empieza.' });
    if (v.conHora && v.cuando !== 'sin' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(v.hora)) {
      ctx.addIssue({ code: 'custom', path: ['hora'], message: 'Escribí una hora válida (HH:MM).' });
    }
    if (automatica && v.repeticion === 'custom' && v.frecuencia === 'weekly' && v.dias.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['dias'], message: 'Elegí al menos un día de la semana.' });
    }
  }), [eligeSucursal, sucursales, personas, esNueva, asignadoOriginal, m.tipo]);
  schemaRef.current = schema;

  // Al abrir (o cambiar de tarea) se cargan los valores de ese modo; nunca se pisa lo que el usuario está escribiendo.
  const clave = modo ? `${modo.tipo}:${modo.tipo === 'editar-tarea' ? modo.tarea.id : modo.tipo === 'editar-automatica' ? modo.receta.id : String(!!modo.automatica)}` : null;
  useEffect(() => {
    if (modo) form.reset(valoresIniciales(modo, today, currentSucursal?.id ?? ''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave]);

  // Pasar a Tarea automática exige fecha de inicio; volver a "No se repite" la conserva.
  useEffect(() => {
    if (esAutomatica && cuando === 'sin') form.setValue('cuando', 'hoy', { shouldDirty: true });
  }, [esAutomatica, cuando, form]);

  const fechaFinal = fechaEfectiva({ cuando, fecha }, today);
  const programacion = { repeat_preset: repeticion, repeat_frequency: frecuencia, repeat_interval: intervalo, repeat_byweekday: dias };

  const onSubmit = form.handleSubmit(async v => {
    const equipo = v.responsable === EQUIPO;
    const persona = equipo ? undefined : personas.find(p => p.id === v.responsable);
    const nombre = equipo ? 'Todo el equipo' : persona?.nombre ?? nombreOriginal ?? undefined;
    const fechaInicio = fechaEfectiva(v, today);
    const hora = v.conHora && fechaInicio ? v.hora : null;
    const custom = v.repeticion === 'custom';
    try {
      if (m.tipo === 'editar-tarea') {
        await onActualizarTarea(m.tarea.id, {
          titulo: v.titulo, descripcion: v.descripcion || null, assignment_scope: equipo ? 'team' : 'individual',
          asignado_a_id: equipo ? null : v.responsable, asignado_a_nombre: nombre ?? null, fecha_inicio: fechaInicio, hora,
        });
      } else if (m.tipo === 'editar-automatica') {
        await onActualizarAutomatica({
          id: m.receta.id, titulo: v.titulo, descripcion: v.descripcion || null, assignment_scope: equipo ? 'team' : 'individual',
          asignado_a: equipo ? null : v.responsable, asignado_nombre: nombre ?? null, hora,
          repeat_preset: v.repeticion, repeat_frequency: custom ? v.frecuencia : null, repeat_interval: custom ? v.intervalo : null,
          repeat_byweekday: custom && v.frecuencia === 'weekly' ? v.dias : null, fecha_inicio: fechaInicio ?? m.receta.fecha_inicio,
        });
      } else {
        const automatica = v.repeticion !== 'never';
        await onCrear({
          tipo: 'tarea', sucursal_id: currentSucursal?.id ?? v.sucursalId, titulo: v.titulo, descripcion: v.descripcion || undefined,
          asignado_a_id: equipo ? null : v.responsable, asignado_a_nombre: nombre, assignment_scope: equipo ? 'team' : 'individual',
          fecha_inicio: fechaInicio ?? undefined, hora: hora ?? undefined, repeat_preset: v.repeticion,
          repeat_frequency: automatica && custom ? v.frecuencia : undefined, repeat_interval: automatica && custom ? v.intervalo : undefined,
          repeat_byweekday: automatica && custom && v.frecuencia === 'weekly' ? v.dias : undefined, recurrente: automatica,
        });
      }
      form.reset(form.getValues());
      onClose();
    } catch (error) {
      form.setError('root', { message: mensajeTareas(error, ERROR_GUARDADO) });
    }
  });

  const titulo = m.tipo === 'editar-tarea' ? 'Editar tarea'
    : m.tipo === 'editar-automatica' ? 'Editar Tarea automática'
      : esAutomatica ? 'Nueva Tarea automática' : 'Nueva tarea';
  const accion = !esNueva ? 'Guardar cambios' : esAutomatica ? 'Crear Tarea automática' : 'Crear tarea';
  const enviando = form.formState.isSubmitting;
  const errorRaiz = form.formState.errors.root?.message;
  const origen = tareaEditada?.recurrencia_id ?? null;
  const sucursalFija = !eligeSucursal ? sucursales.find(s => s.id === sucursalId)?.nombre ?? null : null;

  return (
    <DrawerForm
      open={open}
      onOpenChange={next => { if (!next) onClose(); }}
      size="md"
      title={titulo}
      description={esAutomatica ? 'Configurá una tarea que Vittro crea sola en cada fecha.' : 'Definí qué hay que hacer, quién lo hace y cuándo.'}
      isDirty={form.formState.isDirty && !enviando}
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={enviando}>Cancelar</Button>
          <Button type="submit" form="tarea-form" disabled={enviando || branchLoading || !!branchError}>
            {enviando && <Loader2 className="animate-spin" aria-hidden />}
            {enviando ? 'Guardando…' : accion}
          </Button>
        </div>
      }
    >
      <Form {...form}>
        <form id="tarea-form" noValidate onSubmit={onSubmit} className="space-y-7">
          {errorRaiz && (
            <div role="alert" className="flex items-start gap-2 rounded-lg border border-status-error bg-status-error-bg p-3 text-sm text-status-error-foreground">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>{errorRaiz}</span>
            </div>
          )}

          {origen && (
            <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/50 p-3 text-sm">
              <Repeat className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0 space-y-1.5">
                <p className="text-foreground">
                  Creada por la Tarea automática{automaticaTitulo?.(origen) ? <> «{automaticaTitulo(origen)}»</> : null}. Acá cambiás solo esta tarea; la programación se edita en la Tarea automática.
                </p>
                {onEditarAutomatica && (
                  <Button type="button" variant="link" className="h-auto p-0" onClick={() => onEditarAutomatica(origen)}>Editar Tarea automática</Button>
                )}
              </div>
            </div>
          )}

          <DrawerFormSection icon={ClipboardList} title="Qué hay que hacer">
            <FormField control={form.control} name="titulo" render={({ field }) => (
              <FormItem>
                <FormLabel>Título</FormLabel>
                <FormControl>
                  <Input {...field} maxLength={TITULO_MAX} placeholder="Ej: Limpiar y desinfectar herramientas" autoComplete="off" />
                </FormControl>
                <div className="flex items-start justify-between gap-3">
                  <FormMessage />
                  <span className="ml-auto text-xs tabular-nums text-muted-foreground">{field.value.trim().length}/{TITULO_MAX}</span>
                </div>
              </FormItem>
            )} />
            <FormField control={form.control} name="descripcion" render={({ field }) => (
              <FormItem>
                <FormLabel>Descripción (opcional)</FormLabel>
                <FormControl>
                  <Textarea {...field} rows={3} maxLength={DESCRIPCION_MAX} className="resize-none" placeholder="Detalles que ayuden a hacerla bien." />
                </FormControl>
                <div className="flex items-start justify-between gap-3">
                  <FormMessage />
                  <span className="ml-auto text-xs tabular-nums text-muted-foreground">{field.value.trim().length}/{DESCRIPCION_MAX}</span>
                </div>
              </FormItem>
            )} />
          </DrawerFormSection>

          <DrawerFormSection icon={Users} title="Quién y dónde">
            {branchError && <TareasLoadError subject="las sucursales" retry={refreshSucursales} pending={branchLoading} />}
            {eligeSucursal ? (
              <FormField control={form.control} name="sucursalId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Sucursal</FormLabel>
                  <Select value={field.value} onValueChange={value => { field.onChange(value); form.setValue('responsable', EQUIPO); }}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Elegí una sucursal" /></SelectTrigger></FormControl>
                    <SelectContent>{sucursales.filter(s => s.activa).map(s => <SelectItem key={s.id} value={s.id}>{s.nombre}</SelectItem>)}</SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            ) : sucursalFija && sucursales.length > 1 ? (
              <p className="text-sm text-muted-foreground">Sucursal: <span className="text-foreground">{sucursalFija}</span></p>
            ) : null}

            <FormField control={form.control} name="responsable" render={({ field }) => (
              <FormItem>
                <FormLabel>Responsable</FormLabel>
                <Select value={field.value} onValueChange={value => field.onChange(value || EQUIPO)}
                  disabled={!sucursalId || responsables.isLoading || responsables.isError}>
                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value={EQUIPO}>Todo el equipo</SelectItem>
                    {!esNueva && asignadoOriginal && responsable === asignadoOriginal && !personas.some(p => p.id === asignadoOriginal) && (
                      <SelectItem value={asignadoOriginal}>{nombreOriginal || 'Responsable actual'}</SelectItem>
                    )}
                    {personas.map(p => <SelectItem key={p.id} value={p.id}>{p.nombre}</SelectItem>)}
                  </SelectContent>
                </Select>
                <FormDescription>
                  {!sucursalId ? 'Elegí primero la sucursal.'
                    : responsables.isLoading ? 'Cargando el equipo de la sucursal…'
                      : field.value === EQUIPO ? 'La ve y la puede completar cualquiera del equipo de la sucursal.' : 'Solo esta persona la tiene asignada.'}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )} />
            {responsables.isError && <TareasLoadError subject="el equipo de la sucursal" retry={() => responsables.refetch()} pending={responsables.isFetching} />}
          </DrawerFormSection>

          <DrawerFormSection icon={CalendarDays} title="Cuándo">
            <FormField control={form.control} name="cuando" render={({ field }) => (
              <FormItem>
                <FormLabel>{esAutomatica ? 'Empieza el' : 'Fecha'}</FormLabel>
                <FormControl>
                  <ToggleGroup type="single" variant="outline" value={field.value} onValueChange={value => value && field.onChange(value)}
                    className="flex flex-wrap justify-start gap-2">
                    {([['hoy', 'Hoy'], ['manana', 'Mañana'], ['otra', 'Otra fecha'], ...(esAutomatica ? [] : [['sin', 'Sin fecha']])] as [Cuando, string][]).map(([valor, label]) => (
                      <ToggleGroupItem key={valor} value={valor}
                        className="h-10 px-3.5 data-[state=on]:border-primary data-[state=on]:bg-primary/10 data-[state=on]:text-primary">
                        {label}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            {cuando === 'otra' && (
              <FormField control={form.control} name="fecha" render={({ field }) => (
                <FormItem>
                  <FormLabel className="sr-only">{esAutomatica ? 'Fecha de inicio' : 'Fecha de la tarea'}</FormLabel>
                  <FormControl><DatePicker value={field.value} onChange={field.onChange} placeholder="Elegí la fecha" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            )}
            {cuando !== 'sin' && (
              <div className="space-y-3">
                <FormField control={form.control} name="conHora" render={({ field }) => (
                  <FormItem className="flex items-center justify-between gap-3 space-y-0">
                    <div className="space-y-0.5">
                      <FormLabel>Con hora</FormLabel>
                      <FormDescription>Solo si tiene un horario fijo.</FormDescription>
                    </div>
                    <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                  </FormItem>
                )} />
                {conHora && (
                  <FormField control={form.control} name="hora" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="sr-only">Hora</FormLabel>
                      <FormControl><TimePicker value={field.value} onChange={field.onChange} className="max-w-40" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                )}
              </div>
            )}
          </DrawerFormSection>

          {muestraRepeticion && (
            <DrawerFormSection icon={Repeat} title="Repetición">
              <FormField control={form.control} name="repeticion" render={({ field }) => (
                <FormItem>
                  <FormLabel>Se repite</FormLabel>
                  <Select value={field.value} onValueChange={value => {
                    field.onChange(value);
                    if (value === 'custom' && form.getValues('dias').length === 0 && fechaFinal) form.setValue('dias', [diaSemana(fechaFinal)]);
                  }}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      {REPETICIONES.filter(r => esNueva || r.value !== 'never').map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              {repeticion === 'custom' && (
                <div className="space-y-4 rounded-lg border border-border p-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <FormField control={form.control} name="frecuencia" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Unidad</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                          <SelectContent>{FRECUENCIAS.map(f => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}</SelectContent>
                        </Select>
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="intervalo" render={({ field }) => {
                      const unidad = FRECUENCIAS.find(f => f.value === frecuencia)!;
                      return (
                        <FormItem>
                          <FormLabel>Cada</FormLabel>
                          <div className="flex items-center gap-2">
                            <Button type="button" variant="outline" size="icon" aria-label="Disminuir" disabled={field.value <= 1}
                              onClick={() => field.onChange(Math.max(1, field.value - 1))}><Minus aria-hidden /></Button>
                            <FormControl>
                              <output className="flex h-10 flex-1 items-center justify-center rounded-lg border border-input text-sm font-medium tabular-nums" aria-live="polite">
                                {field.value} {field.value === 1 ? unidad.singular : unidad.plural}
                              </output>
                            </FormControl>
                            <Button type="button" variant="outline" size="icon" aria-label="Aumentar" disabled={field.value >= 99}
                              onClick={() => field.onChange(Math.min(99, field.value + 1))}><Plus aria-hidden /></Button>
                          </div>
                        </FormItem>
                      );
                    }} />
                  </div>
                  {frecuencia === 'weekly' && (
                    <FormField control={form.control} name="dias" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Días</FormLabel>
                        <FormControl>
                          <ToggleGroup type="multiple" variant="outline" value={field.value.map(String)}
                            onValueChange={values => field.onChange(values.map(Number))} className="grid grid-cols-7 gap-1.5">
                            {DIAS_SEMANA.map(d => (
                              <ToggleGroupItem key={d.value} value={String(d.value)} aria-label={d.label}
                                className="h-10 px-0 data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
                                {d.corto}
                              </ToggleGroupItem>
                            ))}
                          </ToggleGroup>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  )}
                </div>
              )}

              {esAutomatica && (
                <div className="flex items-start gap-2 rounded-lg bg-muted/60 p-3 text-sm text-foreground" aria-live="polite">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <p>
                    Vittro va a crear esta tarea <strong className="font-medium">{describirRepeticion(programacion).toLowerCase()}</strong>
                    {fechaFinal ? <>, desde el {formatDiaLargo(fechaFinal)}</> : null}. Cada una aparece en Tareas en su fecha y se completa por separado.
                    {esNueva && ' Después la pausás o la cambiás desde Tareas automáticas.'}
                  </p>
                </div>
              )}
            </DrawerFormSection>
          )}
        </form>
      </Form>
    </DrawerForm>
  );
}
