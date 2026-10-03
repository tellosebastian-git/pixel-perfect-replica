import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PhoneInput } from '@/components/ui/phone-input';
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form';
import { StatusPill } from '@/components/ui/StatusPill';
import { MapPin, Phone, Building2, AlertTriangle, KeyRound, Info, MoreVertical } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { DrawerForm } from '@/components/ui/drawer-form';
import { CuentaSucursalBlock } from '@/components/config/CuentaSucursalBlock';
import { sucursalFieldsSchema, sucursalDefaultsFromExisting, type SucursalFieldsValues } from './sucursalFormSchema';
import { useSucursal } from '@/contexts/SucursalContext';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Sucursal } from '@/contexts/SucursalContext';
import { useOrganization } from '@/contexts/OrganizationContext';
import { useAuth } from '@/contexts/AuthContext';
import { Barber, Service, Extra, Discount, Line } from '@/types/barbershop';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { EquipoSucursalPanel } from './config/EquipoSucursalPanel';
import { HorariosAtencionCard } from './config/horarios/HorariosAtencionCard';
import { CobrarConfig } from './config/CobrarConfig';
import { DiscountsConfig } from './config/DiscountsConfig';
import { PaymentMethodsConfig } from './config/PaymentMethodsConfig';
import { ProductosConfig } from '@/components/productos/ProductosConfig';

interface SucursalTabContentProps {
  sucursal: Sucursal;
  barbers: Barber[];
  allBarbers: Barber[];
  allSucursales?: Sucursal[];
  services: Service[];
  extras: Extra[];
  discounts: Discount[];
  lines: Line[];
  onAddBarber: (barber: Omit<Barber, 'id' | 'uid'>) => void;
  onUpdateBarber: (id: string, updates: Partial<Barber>) => void;
  onRefreshBarbers?: () => Promise<void> | void;
  onAddService: (service: Omit<Service, 'id' | 'uid'>) => Promise<Service | null>;
  onUpdateService: (id: string, updates: Partial<Service>) => Promise<void>;
  onAddExtra: (extra: Omit<Extra, 'id' | 'uid'>) => Promise<Extra | null>;
  onUpdateExtra: (id: string, updates: Partial<Extra>) => Promise<void>;
  onAddDiscount: (discount: Omit<Discount, 'id'>) => Promise<Discount | null>;
  onUpdateDiscount: (id: string, updates: Partial<Discount>) => Promise<void>;
  onDeleteDiscount: (id: string) => void;
  onToggleDiscountActive?: (id: string, activo: boolean) => void;
  onAddLine: (line: Omit<Line, 'id'>) => Promise<Line | null>;
  onUpdateLine: (id: string, updates: Partial<Line>) => Promise<void>;
  onSucursalUpdated: () => void;
  onGoToGeneralConfig?: () => void;
  highlightBarberoId?: string;
  /** Cambia de valor cuando se llega desde Turnos: dispara scroll + resalte en Horarios. */
  highlightHorariosNonce?: number;
}

export function SucursalTabContent({
  sucursal, barbers, allBarbers, allSucursales = [],
  services, extras, discounts, lines,
  onAddBarber, onUpdateBarber, onRefreshBarbers,
  onAddService, onUpdateService,
  onAddExtra, onUpdateExtra,
  onAddDiscount, onUpdateDiscount, onDeleteDiscount, onToggleDiscountActive,
  onAddLine, onUpdateLine,
  onSucursalUpdated,
  onGoToGeneralConfig,
  highlightBarberoId,
  highlightHorariosNonce,
}: SucursalTabContentProps) {
  const { organization } = useOrganization();
  const { isOwner, isGeneralManager, isManager } = useAuth();
  const { sucursales: sucursalesAsignadas } = useSucursal();
  const canManageServiceStructure = isOwner || isGeneralManager;
  const canManageSucursalInfo = isOwner || isGeneralManager;
  const canManageCuentaSucursal =
    isOwner ||
    isGeneralManager ||
    (isManager && sucursalesAsignadas.some((s) => s.id === sucursal.id));
  // Misma condición de rol que Turnos › Configuración (owner, encargado general, encargado).
  const canManageHorarios = isOwner || isGeneralManager || isManager;
  const [cuentaOpen, setCuentaOpen] = useState(false);

  // Captura el flag de highlight al renderizar (antes de que el efecto del hijo lo borre).
  // Los efectos de los hijos se ejecutan antes que los del padre en React, por lo que
  // leer aquí —en lazy init— garantiza que tenemos el valor antes de que desaparezca.
  const [shouldScrollToEquipo] = useState(() => {
    if (typeof window === 'undefined' || !organization?.id) return false;
    try {
      return !!localStorage.getItem(`vittro:miNegocio:highlightBarbero:${organization.id}`);
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (!shouldScrollToEquipo) return;
    const timeout = setTimeout(() => {
      const el = document.querySelector('[data-onboarding-id="equipo-section"]');
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 200);
    return () => clearTimeout(timeout);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Info editing ---
  const [isEditingInfo, setIsEditingInfo] = useState(false);
  const infoForm = useForm<SucursalFieldsValues>({
    resolver: zodResolver(sucursalFieldsSchema),
    defaultValues: sucursalDefaultsFromExisting(sucursal),
  });
  const [isTogglingActive, setIsTogglingActive] = useState(false);
  const [fechaDesactivacion, setFechaDesactivacion] = useState<string | null>(null);
  const [futureTurnosCount, setFutureTurnosCount] = useState<number | null>(null);
  const [showToggleDialog, setShowToggleDialog] = useState(false);

  useEffect(() => {
    infoForm.reset(sucursalDefaultsFromExisting(sucursal));
    setIsEditingInfo(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sucursal.id]);

  // Cargar fecha_desactivacion para esta sucursal
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('sucursales')
        .select('fecha_desactivacion')
        .eq('id', sucursal.id)
        .maybeSingle();
      if (!cancelled) setFechaDesactivacion((data as any)?.fecha_desactivacion ?? null);
    })();
    return () => { cancelled = true; };
  }, [sucursal.id, sucursal.activa]);

  const handleSaveInfo = async (values: SucursalFieldsValues) => {
    const { error } = await supabase
      .from('sucursales')
      .update({
        nombre: values.nombre.trim(),
        direccion: values.direccion?.trim() || null,
        telefono: values.telefono?.e164 ?? null,
      })
      .eq('id', sucursal.id);
    if (error) {
      toast.error('Error al guardar');
      return;
    }
    toast.success('Sucursal actualizada');
    setIsEditingInfo(false);
    onSucursalUpdated();
  };

  const closeEditingInfo = () => {
    setIsEditingInfo(false);
    infoForm.reset(sucursalDefaultsFromExisting(sucursal));
  };

  const formatFechaDDMMYYYY = (iso: string | null | undefined): string => {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}/${d.getFullYear()}`;
  };

  const openToggleDialog = async () => {
    setFutureTurnosCount(null);
    setShowToggleDialog(true);
    if (sucursal.activa) {
      const today = new Date().toISOString().slice(0, 10);
      const { count } = await supabase
        .from('turnos')
        .select('id', { count: 'exact', head: true })
        .eq('sucursal_id', sucursal.id)
        .gte('fecha', today)
        .in('estado', ['pendiente', 'confirmado', 'en_curso']);
      setFutureTurnosCount(count ?? 0);
    }
  };

  const handleToggleActive = async () => {
    if (!organization?.id) return;
    setIsTogglingActive(true);
    try {
      const { data, error } = await supabase.functions.invoke('toggle-sucursal', {
        body: { sucursalId: sucursal.id, organizationId: organization.id },
      });
      if (error) throw new Error(error.message || 'Error al cambiar el estado');
      const action = (data as any)?.action as 'deactivated' | 'reactivated' | undefined;
      const restored = !!(data as any)?.restored;
      const reason = (data as any)?.reason as string | undefined;
      toast.success(action === 'deactivated' ? 'Sucursal desactivada' : 'Sucursal reactivada');
      if (action === 'reactivated' && !restored && reason === 'manual_changes_detected') {
        toast.message('Hubo cambios en el equipo mientras la sucursal estuvo inactiva. Revisá la disponibilidad de los barberos manualmente.');
      }
      setShowToggleDialog(false);
      onSucursalUpdated();
    } catch (e: any) {
      toast.error(e?.message || 'Error al cambiar el estado');
    } finally {
      setIsTogglingActive(false);
    }
  };

  const isInactive = !sucursal.activa;

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="mt-4 space-y-6 sm:mt-6">
      {/* Banner contextual de la vista Sucursal */}
      <div className="flex items-start gap-3 rounded-lg border border-secondary bg-secondary px-4 py-3 text-sm text-primary shadow-sm">
        <Info className="h-4 w-4 mt-0.5 shrink-0 text-primary/60" />
        <p>Configurá lo específico de esta sucursal: precios, stock, equipo y métodos de pago. El catálogo base y la compensación se definen desde la vista General.</p>
      </div>

      {/* Anchor nav — solo desktop */}
      <nav className="hidden md:block sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border/60 py-2 shadow-sm">
        <div className="flex items-center gap-1 overflow-x-auto">
          <button onClick={() => scrollTo('seccion-informacion')} className="shrink-0 rounded px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            Información
          </button>
          <button onClick={() => scrollTo('seccion-equipo')} className="shrink-0 rounded px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            Equipo
          </button>
          {canManageHorarios && (
            <button onClick={() => scrollTo('seccion-horarios')} className="shrink-0 rounded px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
              Horarios
            </button>
          )}
          <button onClick={() => scrollTo('seccion-servicios')} className="shrink-0 rounded px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            Servicios
          </button>
          <button onClick={() => scrollTo('seccion-productos')} className="shrink-0 rounded px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            Productos
          </button>
          <button onClick={() => scrollTo('seccion-descuentos')} className="shrink-0 rounded px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            Descuentos
          </button>
          <button onClick={() => scrollTo('seccion-metodos-pago')} className="shrink-0 rounded px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            Métodos de pago
          </button>
        </div>
      </nav>

      {/* Información de la sucursal */}
      <div id="seccion-informacion">
        <Card data-onboarding-id="info-sucursal-card">
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 mt-0.5">
                  <Building2 className="w-5 h-5 text-primary" />
                </div>
                <div className="min-w-0 space-y-1.5">
                  <CardTitle className="min-w-0 text-base leading-tight">{sucursal.nombre}</CardTitle>
                  <StatusPill
                    key={String(sucursal.activa)}
                    status={sucursal.activa ? 'success' : 'neutral'}
                    label={sucursal.activa ? 'Activa' : 'Inactiva'}
                    className="animate-pop-in"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2 sm:shrink-0">
                {canManageCuentaSucursal && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCuentaOpen(true)}
                    data-onboarding-id="cuenta-sucursal-button"
                    className="w-full justify-center sm:w-auto"
                  >
                    <KeyRound className="h-4 w-4 mr-1" /> Cuenta de sucursal
                  </Button>
                )}
                {canManageSucursalInfo && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setIsEditingInfo(true)}
                  >
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <div className="flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 break-words text-sm text-muted-foreground">{sucursal.direccion || 'Sin dirección'}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Phone className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 break-words text-sm text-muted-foreground">{sucursal.telefono || 'Sin teléfono'}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Banner de sucursal inactiva */}
      {isInactive && (
        <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" />
          <div className="space-y-1">
            <p className="text-sm text-destructive">
              Esta sucursal está desactivada. Reactivala para gestionar estas secciones.
            </p>
            {fechaDesactivacion && (
              <p className="text-xs text-destructive/80">
                Desactivada el {formatFechaDDMMYYYY(fechaDesactivacion)}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Secciones inhabilitadas si la sucursal está inactiva */}
      <div className={isInactive ? 'opacity-50 pointer-events-none select-none' : ''}>
        {/* Equipo unificado */}
        <div id="seccion-equipo" data-onboarding-id="equipo-section">
          <EquipoSucursalPanel
            sucursalId={sucursal.id}
            sucursalNombre={sucursal.nombre}
            organizationId={organization?.id || ''}
            highlightBarberoId={highlightBarberoId}
          />
        </div>

        {/* Horarios de atención — misma condición de rol que Turnos › Configuración */}
        {canManageHorarios && (
          <div
            id="seccion-horarios"
            className="border-t pt-6 mt-6"
            data-onboarding-id="horarios-atencion-card"
          >
            <HorariosAtencionCard
              sucursalId={sucursal.id}
              organizationId={organization?.id || ''}
              barbers={barbers.filter((b) => (b.rolesEquipo ?? []).includes('barber'))}
              highlightNonce={highlightHorariosNonce}
            />
          </div>
        )}

        {/* Servicios */}
        <section id="seccion-servicios" className="border-t pt-6 mt-6" data-onboarding-id="catalogo-section">
          <h3 className="text-base font-medium text-foreground mb-4">Servicios</h3>
          <CobrarConfig
            services={services} extras={extras} lines={lines}
            onAddService={onAddService} onUpdateService={onUpdateService}
            onAddExtra={onAddExtra} onUpdateExtra={onUpdateExtra}
            onAddLine={onAddLine} onUpdateLine={onUpdateLine}
            canCreateServices={canManageServiceStructure}
            canEditServiceStructure={canManageServiceStructure}
          />
        </section>

        {/* Productos */}
        <section id="seccion-productos" className="border-t pt-6 mt-6">
          <h3 className="text-base font-medium text-foreground mb-4">Productos</h3>
          <ProductosConfig sucursalId={sucursal.id} />
        </section>

        {/* Descuentos */}
        <section id="seccion-descuentos" className="border-t pt-6 mt-6">
          <h3 className="text-base font-medium text-foreground mb-4">Descuentos</h3>
          <DiscountsConfig
            discounts={discounts}
            onAdd={onAddDiscount}
            onUpdate={onUpdateDiscount}
            onDelete={onDeleteDiscount}
            onToggleActive={onToggleDiscountActive}
          />
        </section>

        {/* Métodos de pago y recargos (override por sucursal) */}
        <div id="seccion-metodos-pago" className="mt-6" data-onboarding-id="metodos-pago-section">
          <PaymentMethodsConfig sucursalId={sucursal.id} onGoToGeneral={onGoToGeneralConfig} />
        </div>

      </div>

      <AlertDialog
        open={showToggleDialog}
        onOpenChange={(o) => { if (!o && !isTogglingActive) setShowToggleDialog(false); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isInactive
                ? `Reactivar ${sucursal.nombre}`
                : `Desactivar ${sucursal.nombre}`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isInactive
                ? 'La sucursal volverá a estar operativa.'
                : 'Los barberos de esta sucursal quedarán bloqueados y no podrán operar hasta que los asignes a otra sucursal o reactives esta.'}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {!isInactive && futureTurnosCount !== null && futureTurnosCount > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-status-warning/40 bg-status-warning/10 p-3 text-sm text-status-warning-foreground">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                Esta sucursal tiene {futureTurnosCount} turno{futureTurnosCount === 1 ? '' : 's'} futuro{futureTurnosCount === 1 ? '' : 's'} que quedará{futureTurnosCount === 1 ? '' : 'n'} sin atender.
              </p>
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isTogglingActive}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleToggleActive(); }}
              disabled={isTogglingActive}
              className={!isInactive ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : ''}
            >
              {isTogglingActive
                ? 'Procesando...'
                : (isInactive ? 'Reactivar' : 'Desactivar')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <DrawerForm
        open={isEditingInfo}
        onOpenChange={(o) => { if (!o) closeEditingInfo(); }}
        title="Editar información"
        size="sm"
        isDirty={infoForm.formState.isDirty}
        footer={
          <div className="flex w-full items-center justify-between">
            <Button
              variant={isInactive ? 'outline' : 'destructive'}
              disabled={infoForm.formState.isDirty || infoForm.formState.isSubmitting}
              title={infoForm.formState.isDirty ? 'Guardá los cambios antes de continuar' : undefined}
              onClick={() => {
                void openToggleDialog();
                closeEditingInfo();
              }}
            >
              {isInactive ? 'Reactivar' : 'Desactivar'}
            </Button>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                disabled={infoForm.formState.isSubmitting}
                onClick={closeEditingInfo}
              >
                Cancelar
              </Button>
              <Button
                disabled={infoForm.formState.isSubmitting}
                onClick={infoForm.handleSubmit(handleSaveInfo)}
              >
                {infoForm.formState.isSubmitting ? 'Guardando...' : 'Guardar'}
              </Button>
            </div>
          </div>
        }
      >
        <Form {...infoForm}>
          <div className="space-y-5">
            {/* Context card — qué sucursal se está editando */}
            <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <Building2 className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                  <span className="truncate text-sm font-medium text-foreground">{sucursal.nombre}</span>
                  {sucursal.activa ? (
                    <span className="inline-flex items-center gap-1.5 text-xs text-status-success-foreground">
                      <span className="h-1.5 w-1.5 rounded-full bg-status-success" />
                      Activa
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
                      Inactiva
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Campos editables */}
            <div className="space-y-4">
              <FormField
                control={infoForm.control}
                name="nombre"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nombre</FormLabel>
                    <FormControl>
                      <Input {...field} maxLength={80} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={infoForm.control}
                name="direccion"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                      Dirección (opcional)
                    </FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Av. Corrientes 1234" maxLength={120} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={infoForm.control}
                name="telefono"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-1.5">
                      <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                      Teléfono (opcional)
                    </FormLabel>
                    <PhoneInput
                      value={field.value?.e164 ?? null}
                      onChange={(o) => field.onChange(o)}
                      defaultCountry="AR"
                      allowedCountries={['AR', 'UY', 'CL', 'CO', 'MX', 'ES', 'BR']}
                      mode="any"
                    />
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </div>
        </Form>
      </DrawerForm>

      <Sheet open={cuentaOpen} onOpenChange={setCuentaOpen}>
        <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader className="mb-4">
            <SheetTitle>Cuenta de sucursal — {sucursal.nombre}</SheetTitle>
            <SheetDescription>
              Cuenta operativa generada automáticamente para operar desde caja o recepción sin usar cuentas personales del equipo.
            </SheetDescription>
          </SheetHeader>
          <CuentaSucursalBlock sucursal={sucursal} />
        </SheetContent>
      </Sheet>
    </div>
  );
}
