import { useState, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Building2, Settings, Store } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { DrawerForm } from '@/components/ui/drawer-form';
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { PhoneInput } from '@/components/ui/phone-input';
import { sucursalFieldsSchema, emptySucursalDefaults, type SucursalFieldsValues } from './sucursalFormSchema';
import { useOrganization } from '@/contexts/OrganizationContext';
import { useSucursal, Sucursal } from '@/contexts/SucursalContext';
import { useAuth } from '@/contexts/AuthContext';
import { useSupabaseData } from '@/hooks/useSupabaseData';
import { supabase } from '@/integrations/supabase/client';
import { Barber } from '@/types/barbershop';
import type { AppRole } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { SucursalTabContent } from './SucursalTabContent';
import { MiNegocioGeneralTabContent } from './MiNegocioGeneralTabContent';
import { useOnboarding } from './onboarding/OnboardingProvider';

interface BarberWithSucursal extends Barber {
  sucursalId: string | null;
}

function rolEquipoToRolesLocal(re: string | null | undefined): AppRole[] {
  switch (re) {
    case 'general_manager': return ['general_manager'];
    case 'encargado':
    case 'manager': return ['manager'];
    case 'barbero':
    case 'barber': return ['barber'];
    case 'owner': return ['owner'];
    case 'otros': return ['otros'];
    default: return ['barber'];
  }
}

function dbToBarberWithSucursal(row: any): BarberWithSucursal {
  const rolesEquipoRaw = Array.isArray(row.roles_equipo) ? (row.roles_equipo as string[]) : [];
  const rolesEquipo: AppRole[] = rolesEquipoRaw.length > 0
    ? rolesEquipoRaw.filter((r): r is AppRole => ['owner','general_manager','manager','barber','otros'].includes(r))
    : rolEquipoToRolesLocal(row.rol_equipo);
  return {
    id: row.id,
    uid: row.id,
    firstName: row.nombre,
    lastName: row.apellido,
    phone: row.telefono || '',
    commission: Number(row.comision) || 0,
    compensationType: row.tipo_compensacion || 'comision',
    fixedSalary: row.sueldo_fijo != null ? Number(row.sueldo_fijo) : undefined,
    teamRole: row.rol_equipo || 'barbero',
    rolesEquipo,
    dni: row.dni || undefined,
    active: row.activo,
    sucursalId: row.sucursal_id || null,
  };
}

interface MiNegocioPanelProps {
  onGoToGeneralConfig?: () => void;
  onNavigateToMiNegocio?: (sucursalId: string, barberoId: string) => void;
}

export interface MiNegocioPanelHandle {
  navigateToSucursalEquipo(sucursalId: string, barberoId: string): void;
  navigateToSucursalHorarios(sucursalId: string): void;
}

export const MiNegocioPanel = forwardRef<MiNegocioPanelHandle, MiNegocioPanelProps>(
  function MiNegocioPanel({ onGoToGeneralConfig, onNavigateToMiNegocio }, ref) {
  const { organization } = useOrganization();
  const { currentSucursal, refreshSucursales, setCurrentSucursal } = useSucursal();
  const { isOwner, isGeneralManager, isManager, user } = useAuth();
  const {
    allServices, allExtras, discounts, allLines,
    addService, updateService, addExtra, updateExtra,
    addDiscount, updateDiscount, deleteDiscount, setDiscountActive, addLine, updateLine, reorderLines,
    deleteService, deleteExtra, deleteLine,
    addServiceGlobal, updateServiceGlobal,
    addExtraGlobal, updateExtraGlobal,
    addDiscountGlobal, updateDiscountGlobal,
    setDiscountActiveGlobal, deleteDiscountGlobal,
  } = useSupabaseData();

  const [allSucursales, setAllSucursales] = useState<Sucursal[]>([]);
  // "Ya sé qué sucursales hay". Distinto de `allSucursales.length === 0`, que no
  // distingue "todavía cargando" de "esta organización no tiene ninguna".
  const [sucursalesLoaded, setSucursalesLoaded] = useState(false);
  const [allBarbers, setAllBarbers] = useState<BarberWithSucursal[]>([]);
  const [showDialog, setShowDialog] = useState(false);
  const sucursalForm = useForm<SucursalFieldsValues>({
    resolver: zodResolver(sucursalFieldsSchema),
    defaultValues: emptySucursalDefaults(),
  });
  const [managerSucursalIds, setManagerSucursalIds] = useState<string[]>([]);
  const [pendingHighlightBarberoId, setPendingHighlightBarberoId] = useState<string | null>(null);
  const [pendingHighlightSucursalId, setPendingHighlightSucursalId] = useState<string | null>(null);
  // Nonce: cambia en cada llegada desde Turnos para poder re-disparar el resalte
  // aunque ya estemos parados en la misma ficha de sucursal.
  const [pendingHighlightHorarios, setPendingHighlightHorarios] = useState<{ sucursalId: string; nonce: number } | null>(null);

  const isManagerOnly = isManager && !isOwner && !isGeneralManager;
  const canCreateSucursal = isOwner || isGeneralManager;
  const showGeneralTab = isOwner || isGeneralManager;
  const GENERAL_TAB = '__general__';
  const storageKey = organization?.id ? `vittro:miNegocio:activeTab:${organization.id}` : null;

  // activeTab es la única fuente visual. Se inicializa de forma perezosa desde localStorage
  // para que un remount conserve la tab elegida sin depender de currentSucursal.
  const [activeTab, setActiveTab] = useState<string>(() => {
    if (typeof window === 'undefined' || !storageKey) return '';
    try { return localStorage.getItem(storageKey) || ''; } catch { return ''; }
  });

  const fetchAllSucursales = useCallback(async () => {
    if (!organization?.id) return;
    const { data } = await supabase
      .from('sucursales')
      .select('*')
      .eq('organization_id', organization.id)
      .is('deleted_at', null)
      .order('activa', { ascending: false })
      .order('nombre');
    if (data) {
      setAllSucursales(data.map(s => ({
        id: s.id, organization_id: s.organization_id, nombre: s.nombre,
        direccion: s.direccion, telefono: s.telefono, timezone: s.timezone, activa: s.activa,
        fecha_desactivacion: (s as any).fecha_desactivacion ?? null,
      } as Sucursal & { fecha_desactivacion: string | null })));
    }
    // También en error: sin esto la tab se quedaría esperando para siempre.
    setSucursalesLoaded(true);
  }, [organization?.id]);

  const fetchAllBarbers = useCallback(async () => {
    if (!organization?.id) return;
    const { data } = await supabase
      .from('barberos')
      .select('*')
      .eq('organization_id', organization.id)
      .order('nombre');
    if (data) setAllBarbers(data.map(dbToBarberWithSucursal));
  }, [organization?.id]);

  // Fetch manager's assigned sucursales
  const fetchManagerSucursales = useCallback(async () => {
    if (!isManagerOnly || !user?.id) return;
    const { data } = await supabase
      .from('user_sucursales')
      .select('sucursal_id')
      .eq('user_id', user.id);
    if (data) setManagerSucursalIds(data.map(d => d.sucursal_id));
  }, [isManagerOnly, user?.id]);

  useEffect(() => {
    fetchAllSucursales();
    fetchAllBarbers();
    fetchManagerSucursales();
  }, [fetchAllSucursales, fetchAllBarbers, fetchManagerSucursales]);

  // Filter sucursales for managers
  const visibleSucursales = isManagerOnly
    ? allSucursales.filter(s => managerSucursalIds.includes(s.id))
    : allSucursales;

  // Tabs solo muestran activas (deleted_at ya filtrado en fetch). Inactivas viven en bloque colapsable en General.
  const visibleSucursalesActivas = visibleSucursales.filter(s => s.activa);
  const visibleSucursalesInactivas = visibleSucursales.filter(s => !s.activa);

  // Helper: ¿es esta tab válida con el estado actual?
  const isValidTab = useCallback((tab: string) => {
    if (!tab) return false;
    if (tab === GENERAL_TAB) return showGeneralTab;
    return visibleSucursales.some(s => s.id === tab);
  }, [showGeneralTab, visibleSucursales]);

  // Inicializa activeTab cuando todavía no hay una tab válida elegida.
  // No se ejecuta más una vez que activeTab es válida — así, cambiar de sucursal
  // o que currentSucursal se sincronice no recalcula la tab visual.
  useEffect(() => {
    if (!organization?.id) return;
    if (isValidTab(activeTab)) return;
    // Hasta que la lista llegue, ninguna tab de sucursal puede validarse: elegir
    // fallback acá degradaría a General y, como General sí es válida, el efecto
    // no volvería a corregirlo. Esto rompía llegar desde otra pestaña con una
    // sucursal ya elegida en localStorage.
    if (!sucursalesLoaded) return;
    // Esperar a saber qué sucursales hay (para manager esperar a tener la lista filtrada)
    if (isManagerOnly && managerSucursalIds.length === 0 && allSucursales.length > 0) {
      // Aún sincronizando permisos del manager
      return;
    }
    if (allSucursales.length === 0 && !showGeneralTab) return;

    const stored = storageKey ? (() => {
      try { return localStorage.getItem(storageKey); } catch { return null; }
    })() : null;

    if (stored && isValidTab(stored)) {
      setActiveTab(stored);
      return;
    }

    if (isManagerOnly) {
      if (visibleSucursales[0]) setActiveTab(visibleSucursales[0].id);
      return;
    }

    // Owner / GM: priorizar currentSucursal si es visible, luego primera sucursal, y por último General.
    if (currentSucursal && visibleSucursales.some(s => s.id === currentSucursal.id)) {
      setActiveTab(currentSucursal.id);
    } else if (visibleSucursales[0]) {
      setActiveTab(visibleSucursales[0].id);
    } else if (showGeneralTab) {
      setActiveTab(GENERAL_TAB);
    }
  }, [
    activeTab, isValidTab, organization?.id, storageKey, showGeneralTab,
    isManagerOnly, managerSucursalIds.length, allSucursales.length, sucursalesLoaded,
    visibleSucursales, currentSucursal,
  ]);

  // Validación defensiva: si la tab activa dejó de ser válida (sucursal eliminada/desactivada,
  // cambio de organización o de permisos), elegir un fallback. Nunca degradar a General mientras
  // exista una sucursal visible.
  useEffect(() => {
    if (!activeTab) return;
    if (isValidTab(activeTab)) return;
    // Misma razón que arriba: mientras la lista no llegó, "inválida" solo
    // significa "todavía no la puedo validar".
    if (!sucursalesLoaded) return;
    if (visibleSucursales[0]) {
      setActiveTab(visibleSucursales[0].id);
    } else if (showGeneralTab) {
      setActiveTab(GENERAL_TAB);
    } else {
      setActiveTab('');
    }
  }, [activeTab, isValidTab, visibleSucursales, showGeneralTab, sucursalesLoaded]);

  // Al llegar desde otra pestaña la tab se restaura de localStorage sin pasar por
  // handleTabChange, así que currentSucursal quedaría apuntando a otra sucursal y
  // las secciones que dependen de ella (Servicios, Productos) se verían vacías.
  useEffect(() => {
    if (!activeTab || activeTab === GENERAL_TAB) return;
    if (!isValidTab(activeTab)) return;
    if (currentSucursal?.id === activeTab) return;
    setCurrentSucursal(activeTab);
  }, [activeTab, isValidTab, currentSucursal?.id, setCurrentSucursal]);

  // Handler único: cambia tab + persiste localStorage. NO escribe null en currentSucursal al entrar a General.
  const onb = useOnboarding();

  const handleTabChange = useCallback((value: string) => {
    setActiveTab(value);
    if (storageKey) {
      try { localStorage.setItem(storageKey, value); } catch { /* ignore */ }
    }
    if (value !== GENERAL_TAB) {
      if (currentSucursal?.id !== value) {
        setCurrentSucursal(value);
      }
      onb.notifyEvent('mi-negocio:sucursal-selected');
    }
  }, [storageKey, currentSucursal?.id, setCurrentSucursal, onb]);

  useImperativeHandle(ref, () => ({
    navigateToSucursalEquipo(sucursalId: string, barberoId: string) {
      handleTabChange(sucursalId);
      setPendingHighlightBarberoId(barberoId);
      setPendingHighlightSucursalId(sucursalId);
    },
    navigateToSucursalHorarios(sucursalId: string) {
      handleTabChange(sucursalId);
      setPendingHighlightHorarios(prev => ({ sucursalId, nonce: (prev?.nonce ?? 0) + 1 }));
    },
  }), [handleTabChange]);

  useEffect(() => {
    if (!pendingHighlightBarberoId) return;
    const t = setTimeout(() => {
      setPendingHighlightBarberoId(null);
      setPendingHighlightSucursalId(null);
    }, 3000);
    return () => clearTimeout(t);
  }, [pendingHighlightBarberoId]);

  // Registrar sub-tab setter para el onboarding
  useEffect(() => {
    onb.registerSubTabSetter((kind) => {
      if (kind === 'general' && showGeneralTab) {
        handleTabChange(GENERAL_TAB);
      } else if (kind === 'first-sucursal' && visibleSucursales[0]) {
        handleTabChange(visibleSucursales[0].id);
      }
    });
    return () => onb.registerSubTabSetter(null);
  }, [onb, handleTabChange, showGeneralTab, visibleSucursales]);

  // Probe para el onboarding: ¿la sub-tab activa es una sucursal válida (no General)?
  // Permite que el paso de "elegí tu sucursal" se auto-avance si el usuario ya está parado ahí.
  useEffect(() => {
    onb.registerSubTabProbe(() =>
      activeTab !== GENERAL_TAB && visibleSucursalesActivas.some(s => s.id === activeTab)
    );
    return () => onb.registerSubTabProbe(null);
  }, [onb, activeTab, visibleSucursalesActivas]);



  const generalIsReady = activeTab === GENERAL_TAB;

  // --- Barber CRUD ---
  const addBarberToSucursal = useCallback(async (sucursalId: string, barber: Omit<Barber, 'id' | 'uid'>) => {
    if (!organization?.id) return;
    const { error } = await supabase.from('barberos').insert({
      nombre: barber.firstName.replace(/\s+/g, ' ').trim(),
      apellido: barber.lastName.replace(/\s+/g, ' ').trim(),
      telefono: barber.phone || null,
      dni: barber.dni || null,
      comision: barber.commission,
      activo: barber.active,
      organization_id: organization.id,
      sucursal_id: sucursalId,
      tipo_compensacion: barber.compensationType || 'comision',
      sueldo_fijo: barber.fixedSalary || null,
      rol_equipo: barber.teamRole || 'barbero',
    });
    if (error) {
      console.error('[addBarberToSucursal] Error de Supabase:', error);
      toast.error('Error al agregar barbero');
      return;
    }
    toast.success('Barbero agregado');
    await fetchAllBarbers();
  }, [organization?.id, fetchAllBarbers]);

  const updateBarberFn = useCallback(async (id: string, updates: Partial<Barber>) => {
    const dbUpdates: any = {};
    if (updates.firstName !== undefined) dbUpdates.nombre = updates.firstName.replace(/\s+/g, ' ').trim();
    if (updates.lastName !== undefined) dbUpdates.apellido = updates.lastName.replace(/\s+/g, ' ').trim();
    if (updates.phone !== undefined) dbUpdates.telefono = updates.phone || null;
    if (updates.dni !== undefined) dbUpdates.dni = updates.dni || null;
    if (updates.commission !== undefined) dbUpdates.comision = updates.commission;
    if (updates.active !== undefined) dbUpdates.activo = updates.active;
    if (updates.compensationType !== undefined) dbUpdates.tipo_compensacion = updates.compensationType;
    if (updates.fixedSalary !== undefined) dbUpdates.sueldo_fijo = updates.fixedSalary || null;
    if (updates.teamRole !== undefined) dbUpdates.rol_equipo = updates.teamRole;

    const { error } = await supabase.from('barberos').update(dbUpdates).eq('id', id);
    if (error) { toast.error('Error al actualizar barbero'); return; }
    await fetchAllBarbers();
  }, [fetchAllBarbers]);

  // --- Sucursal CRUD ---
  const handleOpenCreate = () => {
    sucursalForm.reset(emptySucursalDefaults());
    setShowDialog(true);
  };

  const handleCloseCreate = () => {
    setShowDialog(false);
    sucursalForm.reset(emptySucursalDefaults());
  };

  const handleSaveSucursal = async (values: SucursalFieldsValues) => {
    if (!organization?.id) return;
    const { data: insData, error } = await supabase.from('sucursales').insert({
      organization_id: organization.id,
      nombre: values.nombre.trim(),
      direccion: values.direccion?.trim() || null,
      telefono: values.telefono?.e164 ?? null,
      timezone: organization.timezone,
    }).select('id').single();
    if (error) {
      toast.error(error.message || 'Error al crear');
      return;
    }
    toast.success('Sucursal creada');
    // Auto-create the Cuenta de sucursal for this branch (best-effort).
    if (insData?.id) {
      supabase.functions.invoke('create-sucursal-account', { body: { sucursalId: insData.id } })
        .catch((e) => console.warn('create-sucursal-account failed:', e));
    }
    handleCloseCreate();
    await fetchAllSucursales();
    await refreshSucursales();
  };

  // --- Helpers to scope catalog data by sucursal ---
  // `allServices`/`allExtras` ya vienen enriquecidos con `servicios_sucursales`/`extras_sucursales`
  // para la sucursal activa (currentSucursal). Cuando la tab activa coincide, devolvemos esa lista
  // tal cual; así Mi Negocio › Sucursal › Servicios y Cobrar comparten exactamente la misma fuente.
  // Para tabs que no son la activa devolvemos lista vacía y evitamos mostrar datos de otra sucursal
  // mientras se sincroniza el cambio (handleTabChange ya dispara setCurrentSucursal).
  const getServicesForSucursal = (sucursalId: string) =>
    currentSucursal?.id === sucursalId ? allServices : [];

  const getExtrasForSucursal = (sucursalId: string) =>
    currentSucursal?.id === sucursalId ? allExtras : [];

  // Wrap add functions to inject sucursalId
  const addServiceForSucursal = useCallback((sucursalId: string) => {
    return (service: Parameters<typeof addService>[0]) => {
      return addService({ ...service, sucursalId });
    };
  }, [addService]);

  const addExtraForSucursal = useCallback((sucursalId: string) => {
    return (extra: Parameters<typeof addExtra>[0]) => {
      return addExtra({ ...extra, sucursalId });
    };
  }, [addExtra]);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <PageHeader
        title="Mi Negocio"
        icon={Store}
        subtitle="Configuración general y gestión de sucursales."
        actions={canCreateSucursal && (
          <Button size="sm" onClick={handleOpenCreate}>
            <Plus className="h-4 w-4 mr-1" /> Nueva sucursal
          </Button>
        )}
        actionsLayout="inline"
      />

      {/* Tabs */}
      {(showGeneralTab || visibleSucursalesActivas.length > 0) && activeTab && (
        <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
          <TabsList variant="underline" className="mb-6 flex-wrap">
            {showGeneralTab && (
              <TabsTrigger value={GENERAL_TAB} variant="underline" data-onboarding-id="general-tab">
                <Settings className="h-4 w-4" />
                General
              </TabsTrigger>
            )}
            {visibleSucursalesActivas.length > 0 && showGeneralTab && (
              <div className="h-5 w-px bg-border shrink-0" aria-hidden="true" />
            )}
            <div className="flex items-center gap-4 overflow-x-auto scrollbar-hide max-w-full">
              {visibleSucursalesActivas.map((s, idx) => (
                <TabsTrigger
                  key={s.id}
                  value={s.id}
                  variant="underline"
                  data-onboarding-id={idx === 0 ? 'sucursal-tab' : undefined}
                >
                  <Building2 className="h-4 w-4" />
                  {s.nombre}
                </TabsTrigger>
              ))}
            </div>
          </TabsList>

          {showGeneralTab && (
            <TabsContent value={GENERAL_TAB}>
              <div key={activeTab} className="animate-fade-in">
                <MiNegocioGeneralTabContent
                  isReady={generalIsReady}
                  services={allServices}
                  extras={allExtras}
                  discounts={discounts}
                  lines={allLines}
                  onAddService={addServiceGlobal}
                  onUpdateService={updateServiceGlobal}
                  onAddExtra={addExtraGlobal}
                  onUpdateExtra={updateExtraGlobal}
                  onAddDiscount={addDiscountGlobal}
                  onUpdateDiscount={updateDiscountGlobal}
                  onDeleteDiscount={deleteDiscountGlobal}
                  onToggleDiscountActive={setDiscountActiveGlobal}
                  onAddLine={addLine}
                  onUpdateLine={updateLine}
                  onReorderLines={reorderLines}
                  onDeleteService={deleteService}
                  onDeleteExtra={deleteExtra}
                  onDeleteLine={deleteLine}
                  organizationId={organization?.id || ''}
                  allBarbers={allBarbers}
                  allSucursales={allSucursales}
                  onAddBarberToSucursal={(barber, sucId) => addBarberToSucursal(sucId, barber)}
                  onUpdateBarber={updateBarberFn}
                  onRefreshBarbers={fetchAllBarbers}
                  onNavigateToMiNegocio={onNavigateToMiNegocio}
                  sucursalesInactivas={visibleSucursalesInactivas as Array<typeof visibleSucursalesInactivas[number] & { fecha_desactivacion: string | null }>}
                  onVerSucursalInactiva={(sucId) => handleTabChange(sucId)}
                  onAfterDeleteSucursal={async () => { await fetchAllSucursales(); await refreshSucursales(); }}
                />
              </div>
            </TabsContent>
          )}


          {visibleSucursales.map(s => (
            <TabsContent key={s.id} value={s.id}>
              <div key={activeTab} className="animate-fade-in">
                <SucursalTabContent
                  sucursal={s}
                  barbers={allBarbers.filter(b => b.sucursalId === s.id)}
                  allBarbers={allBarbers}
                  allSucursales={allSucursales}
                  services={getServicesForSucursal(s.id)}
                  extras={getExtrasForSucursal(s.id)}
                  discounts={discounts}
                  lines={allLines}
                  onAddBarber={(barber) => addBarberToSucursal(s.id, barber)}
                  onUpdateBarber={updateBarberFn}
                  onRefreshBarbers={fetchAllBarbers}
                  onAddService={addServiceForSucursal(s.id)}
                  onUpdateService={updateService}
                  onAddExtra={addExtraForSucursal(s.id)}
                  onUpdateExtra={updateExtra}
                  onAddDiscount={addDiscount}
                  onUpdateDiscount={updateDiscount}
                  onDeleteDiscount={deleteDiscount}
                  onToggleDiscountActive={setDiscountActive}
                  onAddLine={addLine}
                  onUpdateLine={updateLine}
                  onSucursalUpdated={() => { fetchAllSucursales(); refreshSucursales(); }}
                  onGoToGeneralConfig={onGoToGeneralConfig}
                  highlightBarberoId={pendingHighlightSucursalId === s.id ? pendingHighlightBarberoId ?? undefined : undefined}
                  highlightHorariosNonce={pendingHighlightHorarios?.sucursalId === s.id ? pendingHighlightHorarios.nonce : undefined}
                />
              </div>
            </TabsContent>
          ))}
        </Tabs>
      )}

      {visibleSucursales.length === 0 && (
        <div className="rounded-lg border border-dashed p-8">
          <EmptyState
            icon={Building2}
            title={isManagerOnly ? 'No tenés sucursales asignadas.' : 'No tenés sucursales todavía'}
            description={!isManagerOnly ? 'Creá la primera para empezar a configurar el negocio.' : undefined}
            action={canCreateSucursal && (
              <Button variant="outline" size="sm" onClick={handleOpenCreate}>
                Nueva sucursal
              </Button>
            )}
          />
        </div>
      )}

      {/* Crear sucursal */}
      <DrawerForm
        open={showDialog}
        onOpenChange={(o) => { if (!o) handleCloseCreate(); }}
        title="Nueva sucursal"
        size="sm"
        isDirty={sucursalForm.formState.isDirty}
        footer={
          <div className="flex w-full justify-between">
            <Button variant="ghost" disabled={sucursalForm.formState.isSubmitting} onClick={handleCloseCreate}>
              Cancelar
            </Button>
            <Button onClick={sucursalForm.handleSubmit(handleSaveSucursal)} disabled={sucursalForm.formState.isSubmitting}>
              {sucursalForm.formState.isSubmitting ? 'Guardando...' : 'Crear'}
            </Button>
          </div>
        }
      >
        <Form {...sucursalForm}>
          <div className="space-y-4">
            <FormField
              control={sucursalForm.control}
              name="nombre"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nombre</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Ej: Sucursal Centro" maxLength={80} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={sucursalForm.control}
              name="direccion"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Dirección (opcional)</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Av. Corrientes 1234" maxLength={120} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={sucursalForm.control}
              name="telefono"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Teléfono (opcional)</FormLabel>
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
        </Form>
      </DrawerForm>
    </div>
  );
  }
);
