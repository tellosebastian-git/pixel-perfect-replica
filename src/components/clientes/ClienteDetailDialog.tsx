import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { DrawerForm } from '@/components/ui/drawer-form';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { EditableSectionHeader } from '@/components/ui/EditableSectionHeader';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { useClientes, Cliente, ReservaCliente, ClienteUpdate } from '@/hooks/useClientes';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/contexts/OrganizationContext';
import { useSucursal } from '@/contexts/SucursalContext';
import { useRequirePinForAction } from '@/components/ActionPinGate';
import { toast } from 'sonner';
import {
  Loader2, MessageCircle, MapPin, Calendar as CalendarLucide,
  CalendarIcon, AlertCircle, ShieldAlert, ShieldOff, Trash2, Lock,
} from 'lucide-react';
import { format, parseISO, isAfter, isBefore } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { type PhoneInputChange } from '@/components/ui/phone-input';
import { formatPhoneDisplay } from '@/lib/phone';
import { ClienteFormFields } from '@/components/agenda/ClienteFormFields';
import { clienteModeFieldsSchema } from '@/components/agenda/clienteModeSchema';
import { isValidEmail } from '@/components/clientes/import/lib/normalize';

interface ClienteDetailDialogProps {
  clienteId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const estadoLabel: Record<string, string> = {
  pendiente: 'Pendiente',
  confirmado: 'Confirmado',
  completado: 'Completado',
  cancelado: 'Cancelado',
};

type EditingSection = null | 'contacto' | 'redes' | 'personal' | 'nota';

/**
 * Regla de negocio del alta/edición standalone de cliente (distinta a la de
 * validateClienteMode, pensada para el flujo dentro de un turno): Apellido
 * opcional, Teléfono *o* Email — mismo criterio ya usado en
 * NuevoClienteDialog (Build C1).
 */
const contactoSchema = clienteModeFieldsSchema
  .omit({ clienteId: true })
  .superRefine((data, ctx) => {
    if (!data.nombre.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['nombre'], message: 'Ingresá el nombre' });
    }
    if (data.telefono && !data.telefono.isValid && data.telefono.reason !== 'empty') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['telefono'], message: 'Revisá el teléfono antes de guardar' });
    }
    const hasTelefono = !!data.telefono?.e164;
    const hasEmail = !!data.email.trim();
    if (!hasTelefono && !hasEmail) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['email'], message: 'Ingresá teléfono o email' });
    }
    if (data.email.trim() && !isValidEmail(data.email.trim())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['email'], message: 'Email inválido' });
    }
  });
type ContactoFormValues = z.infer<typeof contactoSchema>;

const redesSchema = z.object({
  instagram: z.string().max(120).optional().default(''),
  tiktok: z.string().max(120).optional().default(''),
  otraRedSocial: z.string().max(120).optional().default(''),
});
type RedesFormValues = z.infer<typeof redesSchema>;

const personalSchema = z.object({
  fechaNacimiento: z.string().optional().default(''),
  alergias: z.string().max(240).optional().default(''),
  aceptaMarketing: z.boolean().default(true),
});
type PersonalFormValues = z.infer<typeof personalSchema>;

const notaSchema = z.object({
  notaInterna: z.string().max(240).optional().default(''),
});
type NotaFormValues = z.infer<typeof notaSchema>;

const contactoDefaults = (c: Cliente): ContactoFormValues => ({
  nombre: c.nombre,
  apellido: c.apellido,
  telefono: c.telefono ? { e164: c.telefono, isValid: true, country: null, display: '' } as PhoneInputChange : null,
  email: c.email ?? '',
});
const redesDefaults = (c: Cliente): RedesFormValues => ({
  instagram: c.instagram ?? '',
  tiktok: c.tiktok ?? '',
  otraRedSocial: c.otra_red_social ?? '',
});
const personalDefaults = (c: Cliente): PersonalFormValues => ({
  fechaNacimiento: c.fecha_nacimiento ?? '',
  alergias: c.alergias ?? '',
  aceptaMarketing: c.acepta_marketing,
});
const notaDefaults = (c: Cliente): NotaFormValues => ({
  notaInterna: c.nota_interna ?? '',
});

export function ClienteDetailDialog({ clienteId, open, onOpenChange }: ClienteDetailDialogProps) {
  const {
    getClienteById, updateCliente, getSucursalesByCliente, getReservasByCliente,
    blockCliente, unblockCliente, deleteCliente,
  } = useClientes();
  const { organization } = useOrganization();
  const { currentSucursal } = useSucursal();
  const requirePinForAction = useRequirePinForAction();

  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [sucursalesAsociadas, setSucursalesAsociadas] = useState<Array<{ sucursal_id: string; nombre: string }>>([]);
  const [reservas, setReservas] = useState<ReservaCliente[]>([]);
  const [barberosMap, setBarberosMap] = useState<Record<string, string>>({});
  const [serviciosMap, setServiciosMap] = useState<Record<string, string>>({});
  const [sucursalesMap, setSucursalesMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const [editing, setEditing] = useState<EditingSection>(null);
  const [saving, setSaving] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  // Acciones sensibles — confirmación pura, ya conforme, no se migra a RHF.
  const [blockOpen, setBlockOpen] = useState(false);
  const [unblockOpen, setUnblockOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [motivoInput, setMotivoInput] = useState('');
  const [actionBusy, setActionBusy] = useState(false);

  const contactoForm = useForm<ContactoFormValues>({
    resolver: zodResolver(contactoSchema),
    defaultValues: { nombre: '', apellido: '', telefono: null, email: '' },
  });
  const redesForm = useForm<RedesFormValues>({
    resolver: zodResolver(redesSchema),
    defaultValues: { instagram: '', tiktok: '', otraRedSocial: '' },
  });
  const personalForm = useForm<PersonalFormValues>({
    resolver: zodResolver(personalSchema),
    defaultValues: { fechaNacimiento: '', alergias: '', aceptaMarketing: true },
  });
  const notaForm = useForm<NotaFormValues>({
    resolver: zodResolver(notaSchema),
    defaultValues: { notaInterna: '' },
  });

  useEffect(() => {
    if (!open || !clienteId || !organization?.id) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const [c, sucs, res] = await Promise.all([
          getClienteById(clienteId),
          getSucursalesByCliente(clienteId),
          getReservasByCliente(clienteId),
        ]);
        if (cancelled) return;
        setCliente(c);
        setSucursalesAsociadas(sucs);
        setReservas(res);

        const barberoIds = Array.from(new Set(res.map(r => r.barbero_id)));
        const servicioIds = Array.from(new Set(res.map(r => r.servicio_id)));
        const sucIds = Array.from(new Set(res.map(r => r.sucursal_id)));

        const [bRes, sRes, suRes] = await Promise.all([
          barberoIds.length
            ? supabase.from('barberos').select('id, nombre, apellido').in('id', barberoIds)
            : Promise.resolve({ data: [] as any[] }),
          servicioIds.length
            ? supabase.from('servicios').select('id, nombre').in('id', servicioIds)
            : Promise.resolve({ data: [] as any[] }),
          sucIds.length
            ? supabase.from('sucursales').select('id, nombre').in('id', sucIds).is('deleted_at', null)
            : Promise.resolve({ data: [] as any[] }),
        ]);

        if (cancelled) return;
        const bMap: Record<string, string> = {};
        (bRes.data || []).forEach((b: any) => { bMap[b.id] = `${b.nombre} ${b.apellido}`.trim(); });
        const sMap: Record<string, string> = {};
        (sRes.data || []).forEach((s: any) => { sMap[s.id] = s.nombre; });
        const suMap: Record<string, string> = {};
        (suRes.data || []).forEach((s: any) => { suMap[s.id] = s.nombre; });
        setBarberosMap(bMap);
        setServiciosMap(sMap);
        setSucursalesMap(suMap);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [open, clienteId, organization?.id, getClienteById, getSucursalesByCliente, getReservasByCliente]);

  useEffect(() => {
    if (!open) {
      setEditing(null);
      contactoForm.reset({ nombre: '', apellido: '', telefono: null, email: '' });
      redesForm.reset({ instagram: '', tiktok: '', otraRedSocial: '' });
      personalForm.reset({ fechaNacimiento: '', alergias: '', aceptaMarketing: true });
      notaForm.reset({ notaInterna: '' });
      setBlockOpen(false);
      setUnblockOpen(false);
      setDeleteOpen(false);
      setMotivoInput('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const startEditingSection = (section: Exclude<EditingSection, null>) => {
    if (!cliente) return;
    if (section === 'contacto') contactoForm.reset(contactoDefaults(cliente));
    else if (section === 'redes') redesForm.reset(redesDefaults(cliente));
    else if (section === 'personal') personalForm.reset(personalDefaults(cliente));
    else if (section === 'nota') notaForm.reset(notaDefaults(cliente));
    setEditing(section);
  };

  const cancelEdit = () => {
    if (cliente) {
      if (editing === 'contacto') contactoForm.reset(contactoDefaults(cliente));
      else if (editing === 'redes') redesForm.reset(redesDefaults(cliente));
      else if (editing === 'personal') personalForm.reset(personalDefaults(cliente));
      else if (editing === 'nota') notaForm.reset(notaDefaults(cliente));
    }
    setEditing(null);
  };

  const persist = async (patch: ClienteUpdate, successMsg: string) => {
    if (!cliente) return;
    setSaving(true);
    const { error } = await updateCliente(cliente.id, patch);
    setSaving(false);
    if (error) { toast.error(error); return; }
    setCliente({ ...cliente, ...patch } as Cliente);
    setEditing(null);
    toast.success(successMsg);
  };

  const onSubmitContacto = (values: ContactoFormValues) => persist({
    nombre: values.nombre.trim(),
    apellido: values.apellido.trim(),
    telefono: values.telefono?.e164 ?? null,
    email: values.email.trim() || null,
  }, 'Datos de contacto actualizados');

  const onSubmitRedes = (values: RedesFormValues) => persist({
    instagram: values.instagram.trim() || null,
    tiktok: values.tiktok.trim() || null,
    otra_red_social: values.otraRedSocial.trim() || null,
  }, 'Redes sociales actualizadas');

  const onSubmitPersonal = (values: PersonalFormValues) => persist({
    fecha_nacimiento: values.fechaNacimiento || null,
    alergias: values.alergias.trim() || null,
    acepta_marketing: values.aceptaMarketing,
  }, 'Información personal actualizada');

  const onSubmitNota = (values: NotaFormValues) => persist({
    nota_interna: values.notaInterna.trim() || null,
  }, 'Nota guardada');

  const handleSaveContacto = () => { void contactoForm.handleSubmit(onSubmitContacto)(); };
  const handleSaveRedes = () => { void redesForm.handleSubmit(onSubmitRedes)(); };
  const handleSavePersonal = () => { void personalForm.handleSubmit(onSubmitPersonal)(); };
  const handleSaveNota = () => { void notaForm.handleSubmit(onSubmitNota)(); };

  const handleConfirmBlock = async () => {
    if (!cliente) return;
    const motivo = motivoInput.trim();
    if (!motivo) { toast.error('El motivo es obligatorio'); return; }
    const gate = await requirePinForAction('bloquear_cliente', currentSucursal?.id ?? null);
    if (!gate.ok) return;
    setActionBusy(true);
    const { error } = await blockCliente(cliente.id, motivo);
    setActionBusy(false);
    if (error) { toast.error(error); return; }
    setCliente({ ...cliente, bloqueado: true, motivo_bloqueo: motivo });
    setBlockOpen(false);
    setMotivoInput('');
    toast.success('Cliente bloqueado');
  };

  const handleConfirmUnblock = async () => {
    if (!cliente) return;
    setActionBusy(true);
    const { error } = await unblockCliente(cliente.id);
    setActionBusy(false);
    if (error) { toast.error(error); return; }
    setCliente({ ...cliente, bloqueado: false, motivo_bloqueo: null });
    setUnblockOpen(false);
    toast.success('Cliente desbloqueado');
  };

  const handleConfirmDelete = async () => {
    if (!cliente) return;
    setActionBusy(true);
    const { error } = await deleteCliente(cliente.id);
    setActionBusy(false);
    if (error) { toast.error(error); return; }
    setDeleteOpen(false);
    toast.success('Cliente eliminado');
    onOpenChange(false);
  };

  if (!cliente && !loading) {
    return (
      <DrawerForm open={open} onOpenChange={onOpenChange} title="Cliente" size="lg">
        <p className="text-sm text-muted-foreground py-6 text-center">Cliente no encontrado.</p>
      </DrawerForm>
    );
  }

  const today = new Date();
  const reservasOrdenadas = [...reservas].sort((a, b) => (a.fecha + a.hora_inicio).localeCompare(b.fecha + b.hora_inicio));
  const ultimaReserva = reservasOrdenadas
    .filter(r => isBefore(parseISO(`${r.fecha}T${r.hora_inicio}`), today))
    .slice(-1)[0];
  const proximaReserva = reservasOrdenadas
    .find(r => isAfter(parseISO(`${r.fecha}T${r.hora_inicio}`), today));

  const datosIncompletos = cliente && (!cliente.telefono || !cliente.email);

  const titleContent = (
    <div className="flex items-center gap-2 min-w-0">
      <span className="truncate">{cliente ? [cliente.nombre, cliente.apellido].filter(Boolean).join(' ') : 'Cliente'}</span>
      {cliente?.bloqueado && (
        <Badge variant="destructive" className="text-[10px] gap-1 shrink-0">
          <ShieldAlert className="h-3 w-3" />
          Bloqueado
        </Badge>
      )}
    </div>
  );

  return (
    <>
      <DrawerForm
        open={open}
        onOpenChange={onOpenChange}
        title={titleContent}
        size="lg"
        isDirty={
          (editing === 'contacto' && contactoForm.formState.isDirty) ||
          (editing === 'redes' && redesForm.formState.isDirty) ||
          (editing === 'personal' && personalForm.formState.isDirty) ||
          (editing === 'nota' && notaForm.formState.isDirty)
        }
      >
        {loading || !cliente ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-6 text-sm">
            <div className="flex justify-end">
              <Button variant="outline" size="sm" onClick={() => toast('Próximamente')} className="h-8">
                <MessageCircle className="h-4 w-4" />
                WhatsApp
              </Button>
            </div>

            {/* Aviso de cliente bloqueado en la parte superior */}
            {cliente.bloqueado && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 flex items-start gap-3">
                <ShieldAlert className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-destructive">Cliente bloqueado</p>
                  {cliente.motivo_bloqueo && (
                    <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">
                      Motivo: {cliente.motivo_bloqueo}
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Datos de contacto */}
            <section>
              <EditableSectionHeader
                title="Datos de contacto"
                isEditing={editing === 'contacto'}
                saving={saving}
                disabled={editing !== null}
                onEdit={() => startEditingSection('contacto')}
                onCancel={cancelEdit}
                onSave={handleSaveContacto}
              />
              {editing === 'contacto' ? (
                <Form {...contactoForm}>
                  <ClienteFormFields
                    control={contactoForm.control}
                    nombreName="nombre"
                    apellidoName="apellido"
                    telefonoName="telefono"
                    emailName="email"
                  />
                </Form>
              ) : (
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Teléfono</span>
                    <span className={cliente.telefono ? '' : 'text-muted-foreground italic'}>
                      {cliente.telefono ? formatPhoneDisplay(cliente.telefono) : 'Sin teléfono'}
                    </span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Email</span>
                    <span className={cliente.email ? 'truncate' : 'text-muted-foreground italic'}>
                      {cliente.email || 'Sin email'}
                    </span>
                  </div>
                  {datosIncompletos && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground pt-1">
                      <AlertCircle className="h-3 w-3" />
                      Datos de contacto incompletos.
                    </div>
                  )}
                </div>
              )}
            </section>

            <Separator />

            {/* Redes sociales */}
            <section>
              <EditableSectionHeader
                title="Redes sociales"
                isEditing={editing === 'redes'}
                saving={saving}
                disabled={editing !== null}
                onEdit={() => startEditingSection('redes')}
                onCancel={cancelEdit}
                onSave={handleSaveRedes}
              />
              {editing === 'redes' ? (
                <Form {...redesForm}>
                  <div className="space-y-3">
                    <FormField
                      control={redesForm.control}
                      name="instagram"
                      render={({ field }) => (
                        <FormItem className="space-y-1.5">
                          <FormLabel className="text-xs">Instagram (opcional)</FormLabel>
                          <FormControl>
                            <Input {...field} maxLength={120} placeholder="@usuario" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={redesForm.control}
                      name="tiktok"
                      render={({ field }) => (
                        <FormItem className="space-y-1.5">
                          <FormLabel className="text-xs">TikTok (opcional)</FormLabel>
                          <FormControl>
                            <Input {...field} maxLength={120} placeholder="@usuario" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={redesForm.control}
                      name="otraRedSocial"
                      render={({ field }) => (
                        <FormItem className="space-y-1.5">
                          <FormLabel className="text-xs">Otra red social (opcional)</FormLabel>
                          <FormControl>
                            <Input {...field} maxLength={120} placeholder="Ej: Twitter @usuario" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </Form>
              ) : (
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Instagram</span>
                    <span className={cliente.instagram ? '' : 'text-muted-foreground italic'}>
                      {cliente.instagram || '—'}
                    </span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">TikTok</span>
                    <span className={cliente.tiktok ? '' : 'text-muted-foreground italic'}>
                      {cliente.tiktok || '—'}
                    </span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Otra red social</span>
                    <span className={cliente.otra_red_social ? '' : 'text-muted-foreground italic'}>
                      {cliente.otra_red_social || '—'}
                    </span>
                  </div>
                </div>
              )}
            </section>

            <Separator />

            {/* Información personal */}
            <section>
              <EditableSectionHeader
                title="Información personal"
                isEditing={editing === 'personal'}
                saving={saving}
                disabled={editing !== null}
                onEdit={() => startEditingSection('personal')}
                onCancel={cancelEdit}
                onSave={handleSavePersonal}
              />
              {editing === 'personal' ? (
                <Form {...personalForm}>
                  <div className="space-y-3">
                    <FormField
                      control={personalForm.control}
                      name="fechaNacimiento"
                      render={({ field }) => (
                        <FormItem className="space-y-1.5">
                          <FormLabel className="text-xs">Fecha de nacimiento (opcional)</FormLabel>
                          <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
                            <PopoverTrigger asChild>
                              <FormControl>
                                <Button
                                  type="button"
                                  variant="outline"
                                  className={cn("w-full justify-start text-left font-normal", !field.value && "text-muted-foreground")}
                                >
                                  <CalendarIcon className="h-4 w-4" />
                                  {field.value ? format(parseISO(field.value), "d 'de' MMMM yyyy", { locale: es }) : 'Seleccionar fecha'}
                                </Button>
                              </FormControl>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                              <Calendar
                                mode="single"
                                selected={field.value ? parseISO(field.value) : undefined}
                                onSelect={(d) => {
                                  field.onChange(d ? format(d, 'yyyy-MM-dd') : '');
                                  setDatePickerOpen(false);
                                }}
                                disabled={(date) => date > new Date() || date < new Date('1900-01-01')}
                                initialFocus
                                className={cn('p-3 pointer-events-auto')}
                                captionLayout="dropdown-buttons"
                                fromYear={1900}
                                toYear={new Date().getFullYear()}
                              />
                            </PopoverContent>
                          </Popover>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={personalForm.control}
                      name="alergias"
                      render={({ field }) => (
                        <FormItem className="space-y-1.5">
                          <FormLabel className="text-xs">Alergias (opcional)</FormLabel>
                          <FormControl>
                            <Textarea {...field} maxLength={240} rows={2} placeholder="Ej: tintes, amoníaco..." />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={personalForm.control}
                      name="aceptaMarketing"
                      render={({ field }) => (
                        <FormItem className="flex items-center justify-between rounded-lg border px-3 py-2.5 space-y-0">
                          <div className="space-y-0.5">
                            <FormLabel className="text-sm">Acepta marketing</FormLabel>
                            <p className="text-xs text-muted-foreground">Promociones y novedades por mensajes.</p>
                          </div>
                          <FormControl>
                            <Switch checked={field.value} onCheckedChange={field.onChange} />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </div>
                </Form>
              ) : (
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Fecha de nacimiento</span>
                    <span className={cliente.fecha_nacimiento ? '' : 'text-muted-foreground italic'}>
                      {cliente.fecha_nacimiento
                        ? format(parseISO(cliente.fecha_nacimiento), "d 'de' MMM yyyy", { locale: es })
                        : '—'}
                    </span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Alergias</span>
                    <span className={cn("text-right", cliente.alergias ? '' : 'text-muted-foreground italic')}>
                      {cliente.alergias || '—'}
                    </span>
                  </div>
                  <div className="flex justify-between gap-4 items-center">
                    <span className="text-muted-foreground">Acepta marketing</span>
                    <Badge variant={cliente.acepta_marketing ? 'secondary' : 'outline'} className="text-[10px]">
                      {cliente.acepta_marketing ? 'Sí' : 'No'}
                    </Badge>
                  </div>
                </div>
              )}
            </section>

            <Separator />

            {/* Sucursales */}
            <section>
              <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                Sucursales asociadas
              </h3>
              {sucursalesAsociadas.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin sucursales asociadas.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {sucursalesAsociadas.map(s => (
                    <Badge key={s.sucursal_id} variant="secondary" className="text-xs">{s.nombre}</Badge>
                  ))}
                </div>
              )}
            </section>

            <Separator />

            {/* Reservas */}
            <section>
              <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                <CalendarLucide className="h-4 w-4" />
                Reservas
              </h3>
              {reservas.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin reservas registradas.</p>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-3 mb-4 text-center">
                    <div className="rounded-lg border p-3">
                      <p className="text-xs text-muted-foreground">Total</p>
                      <p className="text-lg font-medium">{reservas.length}</p>
                    </div>
                    <div className="rounded-lg border p-3">
                      <p className="text-xs text-muted-foreground">Última</p>
                      <p className="text-xs font-medium mt-1">
                        {ultimaReserva ? format(parseISO(ultimaReserva.fecha), 'd MMM yyyy', { locale: es }) : '—'}
                      </p>
                    </div>
                    <div className="rounded-lg border p-3">
                      <p className="text-xs text-muted-foreground">Próxima</p>
                      <p className="text-xs font-medium mt-1">
                        {proximaReserva ? format(parseISO(proximaReserva.fecha), 'd MMM yyyy', { locale: es }) : '—'}
                      </p>
                    </div>
                  </div>
                  <div className="space-y-1.5 max-h-64 overflow-y-auto">
                    {[...reservas].reverse().map(r => (
                      <div key={r.id} className="flex items-center justify-between text-xs border rounded-md px-3 py-2">
                        <div className="flex flex-col">
                          <span className="font-medium">
                            {format(parseISO(r.fecha), "d MMM yyyy", { locale: es })} · {r.hora_inicio.slice(0, 5)}
                          </span>
                          <span className="text-muted-foreground">
                            {serviciosMap[r.servicio_id] || 'Servicio'} · {barberosMap[r.barbero_id] || 'Barbero'} · {sucursalesMap[r.sucursal_id] || 'Sucursal'}
                          </span>
                        </div>
                        <Badge variant="outline" className="text-[10px]">{estadoLabel[r.estado] || r.estado}</Badge>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </section>

            <Separator />

            {/* Nota interna */}
            <section>
              <EditableSectionHeader
                title="Nota interna"
                isEditing={editing === 'nota'}
                saving={saving}
                disabled={editing !== null}
                onEdit={() => startEditingSection('nota')}
                onCancel={cancelEdit}
                onSave={handleSaveNota}
              />
              {editing === 'nota' ? (
                <Form {...notaForm}>
                  <FormField
                    control={notaForm.control}
                    name="notaInterna"
                    render={({ field }) => (
                      <FormItem className="space-y-1.5">
                        <FormLabel className="text-xs">Nota (opcional)</FormLabel>
                        <FormControl>
                          <Textarea
                            {...field}
                            maxLength={240}
                            rows={4}
                            placeholder="Notas internas sobre el cliente..."
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </Form>
              ) : (
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                  {cliente.nota_interna || 'Sin notas.'}
                </p>
              )}
            </section>

            <Separator />

            {/* Acciones sensibles */}
            <section className="space-y-3">
              <h3 className="text-sm font-medium">Acciones</h3>
              <div className="flex flex-col sm:flex-row gap-2">
                {cliente.bloqueado ? (
                  <Button
                    variant="outline"
                    onClick={() => setUnblockOpen(true)}
                    className="sm:flex-1"
                  >
                    <ShieldOff className="h-4 w-4" />
                    Desbloquear cliente
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    onClick={() => { setMotivoInput(''); setBlockOpen(true); }}
                    className="sm:flex-1"
                  >
                    <Lock className="h-4 w-4" />
                    Bloquear cliente
                  </Button>
                )}
                <Button
                  variant="destructive"
                  onClick={() => setDeleteOpen(true)}
                  className="sm:flex-1"
                >
                  <Trash2 className="h-4 w-4" />
                  Eliminar cliente
                </Button>
              </div>
            </section>
          </div>
        )}
      </DrawerForm>

      {/* Modal: Bloquear cliente — confirmación pura, no migrada a RHF */}
      <Dialog open={blockOpen} onOpenChange={(o) => { if (!actionBusy) setBlockOpen(o); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock className="h-4 w-4" />
              Bloquear cliente
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <p className="text-sm text-muted-foreground">
              Indicá el motivo del bloqueo. Quedará registrado en el perfil del cliente.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="motivo_bloqueo">Motivo</Label>
              <Textarea
                id="motivo_bloqueo"
                value={motivoInput}
                onChange={(e) => setMotivoInput(e.target.value)}
                placeholder="Ej: faltó a varias reservas sin avisar."
                rows={3}
                autoFocus
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setBlockOpen(false)} disabled={actionBusy}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmBlock}
              disabled={actionBusy || motivoInput.trim().length === 0}
            >
              {actionBusy && <Loader2 className="h-4 w-4 animate-spin" />}
              Bloquear
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirmación: Desbloquear cliente */}
      <AlertDialog open={unblockOpen} onOpenChange={(o) => { if (!actionBusy) setUnblockOpen(o); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desbloquear cliente</AlertDialogTitle>
            <AlertDialogDescription>
              Se quitará la marca de bloqueo y el motivo asociado. El cliente volverá a aparecer como disponible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionBusy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmUnblock} disabled={actionBusy}>
              {actionBusy && <Loader2 className="h-4 w-4 animate-spin" />}
              Desbloquear
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmación: Eliminar cliente */}
      <AlertDialog open={deleteOpen} onOpenChange={(o) => { if (!actionBusy) setDeleteOpen(o); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar cliente</AlertDialogTitle>
            <AlertDialogDescription>
              ¿Eliminar a <span className="font-medium text-foreground">{cliente ? [cliente.nombre, cliente.apellido].filter(Boolean).join(' ') : ''}</span>?
              Esta acción ocultará el cliente de la lista. El historial de turnos se conserva.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionBusy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              disabled={actionBusy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {actionBusy && <Loader2 className="h-4 w-4 animate-spin" />}
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
