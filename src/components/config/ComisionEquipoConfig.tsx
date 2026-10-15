import { BARBER_CLIENT_COLUMNS } from '@/lib/barberoColumns';
import { useState, useEffect, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Users, Percent, Trash2, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Form, FormField, FormItem, FormControl, FormMessage } from '@/components/ui/form';
import { DrawerForm } from '@/components/ui/drawer-form';
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
import { Barber, getBarberDisplayName } from '@/types/barbershop';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

interface ComisionEquipoConfigProps {
  barberId: string;
  organizationId: string;
  sucursalId: string;
  allBarbers: Barber[];
  forceShow?: boolean;
}

interface Config {
  id: string;
  activa: boolean;
  scope_type: string;
  sucursal_id: string | null;
}

interface Regla {
  id: string;
  barbero_origen_id: string;
  porcentaje: number;
  vigencia_desde: string;
  vigencia_hasta: string | null;
  activa: boolean;
}

function mapDbBarber(row: any): Barber {
  return {
    id: row.id,
    uid: row.id,
    firstName: row.nombre,
    lastName: row.apellido,
    phone: row.telefono || '',
    commission: Number(row.comision) || 0,
    compensationType: row.tipo_compensacion as any,
    fixedSalary: row.sueldo_fijo ? Number(row.sueldo_fijo) : undefined,
    teamRole: row.rol_equipo as any,
    payDay: row.fecha_cobro_dia,
    address: undefined,
    dni: row.dni || undefined,
    active: row.activo,
  };
}

const addReglaSchema = z.object({
  barberoId: z.string().min(1, 'Seleccioná un barbero.'),
  porcentaje: z.string().refine((v) => {
    const n = parseFloat(v);
    return !Number.isNaN(n) && n > 0 && n <= 100;
  }, 'El porcentaje debe ser mayor a 0 y menor o igual a 100.'),
});

type AddReglaValues = z.infer<typeof addReglaSchema>;

export function ComisionEquipoConfig({ barberId, organizationId, sucursalId, allBarbers, forceShow }: ComisionEquipoConfigProps) {
  const [config, setConfig] = useState<Config | null>(null);
  const [reglas, setReglas] = useState<Regla[]>([]);
  const [filteredBarbers, setFilteredBarbers] = useState<Barber[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [porcentajeErrors, setPorcentajeErrors] = useState<Record<string, string>>({});

  const addForm = useForm<AddReglaValues>({
    resolver: zodResolver(addReglaSchema),
    defaultValues: { barberoId: '', porcentaje: '' },
  });

  const openRuleBarberIds = reglas.filter(r => r.activa && !r.vigencia_hasta).map(r => r.barbero_origen_id);
  const availableBarbers = filteredBarbers.filter(b => b.active && b.id !== barberId && !openRuleBarberIds.includes(b.id));

  const fetchFilteredBarbers = useCallback(async (scopeType: string, configSucursalId: string | null) => {
    let query = supabase
      .from('barberos')
      .select(BARBER_CLIENT_COLUMNS)
      .eq('organization_id', organizationId)
      .eq('activo', true)
      .neq('id', barberId);

    if (scopeType === 'branch_only') {
      const sId = configSucursalId || sucursalId;
      query = query.eq('sucursal_id', sId);
    }

    const { data } = await query;
    setFilteredBarbers((data || []).map(mapDbBarber));
  }, [organizationId, barberId, sucursalId]);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data: configData } = await supabase
        .from('comision_equipo_config')
        .select('id, activa, scope_type, sucursal_id')
        .eq('encargado_id', barberId)
        .eq('organization_id', organizationId)
        .eq('activa', true)
        .limit(1)
        .maybeSingle();

      setConfig(configData);

      if (configData) {
        const { data: reglasData } = await supabase
          .from('comision_equipo_reglas')
          .select('id, barbero_origen_id, porcentaje, vigencia_desde, vigencia_hasta, activa')
          .eq('config_id', configData.id)
          .eq('activa', true)
          .is('vigencia_hasta', null)
          .order('created_at', { ascending: false });

        setReglas(reglasData || []);
        await fetchFilteredBarbers(configData.scope_type, configData.sucursal_id);
      } else {
        setReglas([]);
        setFilteredBarbers([]);
      }
    } catch (e) {
      console.error('Error loading comision equipo config:', e);
    } finally {
      setIsLoading(false);
    }
  }, [barberId, organizationId, fetchFilteredBarbers]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (isLoading) return null;
  if (!config && !forceShow) return null;

  const handleCreateConfig = async () => {
    try {
      const { data, error } = await supabase
        .from('comision_equipo_config')
        .insert({
          encargado_id: barberId,
          organization_id: organizationId,
          scope_type: 'branch_only',
          sucursal_id: sucursalId,
          activa: true,
        })
        .select('id, activa, scope_type, sucursal_id')
        .single();

      if (error) throw error;
      setConfig(data);
      await fetchFilteredBarbers(data.scope_type, data.sucursal_id);
      toast.success('Comisión extra por equipo activada');
    } catch (e: any) {
      console.error(e);
      toast.error(e.message || 'Error al crear configuración');
    }
  };

  const handleToggleConfig = async (activa: boolean) => {
    if (!config) return;
    try {
      const { error } = await supabase
        .from('comision_equipo_config')
        .update({ activa })
        .eq('id', config.id);

      if (error) throw error;
      setConfig(prev => prev ? { ...prev, activa } : null);
      toast.success(activa ? 'Comisión activada' : 'Comisión desactivada');
    } catch (e) {
      toast.error('Error al actualizar');
    }
  };

  const onAddRegla = async (values: AddReglaValues) => {
    if (!config) return;
    try {
      const { error } = await supabase
        .from('comision_equipo_reglas')
        .insert({
          config_id: config.id,
          barbero_origen_id: values.barberoId,
          porcentaje: parseFloat(values.porcentaje),
          organization_id: organizationId,
          sucursal_id: sucursalId,
          vigencia_desde: format(new Date(), 'yyyy-MM-dd'),
        });

      if (error) throw error;
      addForm.reset({ barberoId: '', porcentaje: '' });
      toast.success('Regla agregada');
      fetchData();
    } catch (e: any) {
      console.error(e);
      toast.error(e.message || 'Error al agregar regla');
    }
  };

  const handleBulkAdd = async () => {
    if (!config || availableBarbers.length === 0) return;
    const valid = await addForm.trigger('porcentaje');
    if (!valid) return;
    const porcentaje = parseFloat(addForm.getValues('porcentaje'));

    setBulkLoading(true);
    try {
      const hoy = format(new Date(), 'yyyy-MM-dd');
      const rows = availableBarbers.map(b => ({
        config_id: config.id,
        barbero_origen_id: b.id,
        porcentaje,
        organization_id: organizationId,
        sucursal_id: sucursalId,
        vigencia_desde: hoy,
      }));

      const { error } = await supabase
        .from('comision_equipo_reglas')
        .insert(rows);

      if (error) throw error;
      addForm.setValue('porcentaje', '');
      toast.success(`${rows.length} barberos agregados`);
      fetchData();
    } catch (e: any) {
      console.error(e);
      toast.error(e.message || 'Error al agregar barberos');
    } finally {
      setBulkLoading(false);
    }
  };

  const handleUpdatePorcentaje = async (regla: Regla, newValue: string) => {
    const porcentaje = parseFloat(newValue);
    if (isNaN(porcentaje) || porcentaje <= 0 || porcentaje > 100) {
      setPorcentajeErrors((prev) => ({ ...prev, [regla.id]: 'Debe ser mayor a 0 y menor o igual a 100.' }));
      return;
    }
    setPorcentajeErrors((prev) => {
      if (!(regla.id in prev)) return prev;
      const { [regla.id]: _removed, ...rest } = prev;
      return rest;
    });
    if (porcentaje === regla.porcentaje) return;
    if (!config) return;

    const hoy = format(new Date(), 'yyyy-MM-dd');
    const ayer = format(new Date(Date.now() - 86400000), 'yyyy-MM-dd');

    try {
      await supabase
        .from('comision_equipo_reglas')
        .update({ vigencia_hasta: ayer })
        .eq('id', regla.id);

      const { error } = await supabase
        .from('comision_equipo_reglas')
        .insert({
          config_id: config.id,
          barbero_origen_id: regla.barbero_origen_id,
          porcentaje,
          organization_id: organizationId,
          sucursal_id: sucursalId,
          vigencia_desde: hoy,
        });

      if (error) throw error;
      toast.success('Porcentaje actualizado');
      fetchData();
    } catch (e: any) {
      console.error(e);
      toast.error(e.message || 'Error al actualizar porcentaje');
    }
  };

  const handleRemoveRegla = async (regla: Regla) => {
    const hoy = format(new Date(), 'yyyy-MM-dd');
    try {
      await supabase
        .from('comision_equipo_reglas')
        .update({ vigencia_hasta: hoy, activa: false })
        .eq('id', regla.id);

      toast.success('Barbero removido de la comisión');
      fetchData();
    } catch (e) {
      toast.error('Error al remover');
    }
  };

  if (!config) {
    return (
      <div className="p-3 rounded-md border border-dashed border-border bg-muted/20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Users className="h-4 w-4" />
            <span>Comisión extra por equipo</span>
          </div>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleCreateConfig}>
            Activar
          </Button>
        </div>
      </div>
    );
  }

  const isBranchOnly = config.scope_type === 'branch_only';

  return (
    <div className="p-3 rounded-md border border-border bg-muted/20 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">Comisión extra por equipo</span>
        </div>
        <div className="flex items-center gap-2">
          <Switch checked={config.activa} onCheckedChange={handleToggleConfig} />
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
            onClick={() => setShowDelete(true)}
            aria-label="Eliminar extra"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {config.activa && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {reglas.length > 0
              ? `${reglas.length} regla${reglas.length === 1 ? '' : 's'} configurada${reglas.length === 1 ? '' : 's'}`
              : 'Sin reglas configuradas'}
          </span>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setManageOpen(true)}>
            Gestionar reglas
          </Button>
        </div>
      )}

      <AlertDialog open={showDelete} onOpenChange={setShowDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar comisión extra por equipo</AlertDialogTitle>
            <AlertDialogDescription>
              Se desactiva el extra a partir de hoy. No se modifican cierres ni pagos históricos. Podés volver a configurarlo más adelante.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                setShowDelete(false);
                await handleToggleConfig(false);
                setConfig(null);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <DrawerForm
        open={manageOpen}
        onOpenChange={setManageOpen}
        title="Comisión extra por equipo"
        size="sm"
        isDirty={addForm.formState.isDirty}
      >
        <div className="space-y-4">
          {reglas.length > 0 && (
            <div className="space-y-2">
              {reglas.map(regla => {
                const barberOrigen = allBarbers.find(b => b.id === regla.barbero_origen_id)
                  || filteredBarbers.find(b => b.id === regla.barbero_origen_id);
                const rowError = porcentajeErrors[regla.id];
                return (
                  <div key={regla.id} className="rounded bg-background border border-border p-2 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm truncate">
                        {barberOrigen ? getBarberDisplayName(barberOrigen) : 'Barbero eliminado'}
                      </span>
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1">
                          <Input
                            type="number"
                            className={cn(
                              // 16px en mobile para evitar el auto-zoom de Safari/iOS
                              "w-16 h-9 md:h-7 text-base md:text-xs text-right",
                              rowError && "border-destructive focus-visible:ring-destructive",
                            )}
                            defaultValue={regla.porcentaje}
                            min={0.01}
                            max={100}
                            step={0.5}
                            aria-invalid={!!rowError}
                            onBlur={(e) => handleUpdatePorcentaje(regla, e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                handleUpdatePorcentaje(regla, (e.target as HTMLInputElement).value);
                              }
                            }}
                          />
                          <Percent className="h-3 w-3 text-muted-foreground" />
                        </div>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                          onClick={() => handleRemoveRegla(regla)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                    {rowError && (
                      <p className="text-xs text-destructive text-right">{rowError}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {availableBarbers.length > 0 && (
            <Form {...addForm}>
              <div className="space-y-2">
                <div className="flex items-start gap-2">
                  <FormField
                    control={addForm.control}
                    name="barberoId"
                    render={({ field }) => (
                      <FormItem className="flex-1">
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue placeholder="Seleccionar barbero" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {availableBarbers.map(b => (
                              <SelectItem key={b.id} value={b.id}>
                                {getBarberDisplayName(b)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={addForm.control}
                    name="porcentaje"
                    render={({ field }) => (
                      <FormItem>
                        <div className="flex items-center gap-1">
                          <FormControl>
                            <Input
                              type="number"
                              className="w-16 h-9 md:h-8 text-base md:text-xs text-right"
                              placeholder="%"
                              min={0.01}
                              max={100}
                              step={0.5}
                              {...field}
                            />
                          </FormControl>
                          <Percent className="h-3 w-3 text-muted-foreground shrink-0" />
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    disabled={addForm.formState.isSubmitting}
                    onClick={addForm.handleSubmit(onAddRegla)}
                  >
                    Agregar
                  </Button>
                </div>

                {isBranchOnly && availableBarbers.length > 1 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs w-full"
                    disabled={bulkLoading}
                    onClick={handleBulkAdd}
                  >
                    <UserPlus className="h-3.5 w-3.5 mr-1.5" />
                    Agregar todos los barberos de esta sucursal ({availableBarbers.length})
                  </Button>
                )}
              </div>
            </Form>
          )}

          {reglas.length === 0 && availableBarbers.length === 0 && (
            <p className="text-xs text-muted-foreground">No hay barberos disponibles para asignar.</p>
          )}
        </div>
      </DrawerForm>
    </div>
  );
}
