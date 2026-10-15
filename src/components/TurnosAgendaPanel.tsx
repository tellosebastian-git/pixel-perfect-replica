import { BARBER_CLIENT_COLUMNS } from '@/lib/barberoColumns';
import { useState, useEffect, useCallback } from 'react';
import { Building2, CalendarClock } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PageHeader } from '@/components/ui/PageHeader';
import { useOrganization } from '@/contexts/OrganizationContext';
import { useSucursal, Sucursal } from '@/contexts/SucursalContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Barber } from '@/types/barbershop';
import { AgendaManagement, type AgendaTab } from './config/AgendaManagement';
import { useBarberosSucursalesRealtime } from '@/hooks/useBarberosSucursalesRealtime';

function dbToBarber(row: any): Barber {
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
    rolesEquipo: row.roles_equipo || [],
    dni: row.dni || undefined,
    active: row.activo,
  };
}

interface TurnosAgendaPanelProps {
  /** Lleva a Mi Negocio › ficha de sucursal › Horarios de atención. */
  onNavigateToHorarios?: (sucursalId: string) => void;
}

export function TurnosAgendaPanel({ onNavigateToHorarios }: TurnosAgendaPanelProps) {
  const { organization } = useOrganization();
  const { currentSucursal } = useSucursal();
  const { isOwner, isGeneralManager, isManager, isBarber, user } = useAuth();

  const [allSucursales, setAllSucursales] = useState<Sucursal[]>([]);
  const [allBarbers, setAllBarbers] = useState<(Barber & { sucursalId: string | null })[]>([]);
  const [managerSucursalIds, setManagerSucursalIds] = useState<string[]>([]);
  const [selectedSucursalId, setSelectedSucursalId] = useState<string | undefined>(undefined);
  // Refleja la pestaña de nivel superior de AgendaManagement (Agenda /
  // Configuración) para que el título de acá arriba la siga, sin duplicar un
  // segundo <h1> más abajo ni levantar el estado completo del hijo.
  const [topTab, setTopTab] = useState<AgendaTab>('agenda');

  const isManagerOnly = isManager && !isOwner && !isGeneralManager;

  const fetchAllSucursales = useCallback(async () => {
    if (!organization?.id) return;
    const { data } = await supabase
      .from('sucursales')
      .select('*')
      .eq('organization_id', organization.id)
      .eq('activa', true)
      .is('deleted_at', null)
      .order('nombre');
    if (data) {
      setAllSucursales(data.map(s => ({
        id: s.id, organization_id: s.organization_id, nombre: s.nombre,
        direccion: s.direccion, telefono: s.telefono, timezone: s.timezone, activa: s.activa,
      })));
    }
  }, [organization?.id]);

  const fetchAllBarbers = useCallback(async () => {
    if (!organization?.id) return;
    // Barbers read teammates via the safe view (no PII/salary/PIN exposure).
    // Owner/GM/Manager keep direct access to barberos for full fields.
    if (isBarber && !isOwner && !isGeneralManager && !isManager) {
      const { data } = await supabase
        .from('barberos_safe')
        .select('id, nombre, apellido, activo, organization_id, sucursal_id, rol_equipo, roles_equipo')
        .eq('organization_id', organization.id)
        .eq('activo', true)
        .order('nombre');
      if (data) setAllBarbers(data.map(r => ({ ...dbToBarber(r), sucursalId: r.sucursal_id })));
      return;
    }
    const { data } = await supabase
      .from('barberos')
      .select(BARBER_CLIENT_COLUMNS)
      .eq('organization_id', organization.id)
      .eq('activo', true)
      .order('nombre');
    if (data) setAllBarbers(data.map(r => ({ ...dbToBarber(r), sucursalId: r.sucursal_id })));
  }, [organization?.id, isBarber, isOwner, isGeneralManager, isManager]);

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

  // Realtime: refrescar lista de barberos cuando cambia su disponibilidad en cualquier sucursal de la org.
  useBarberosSucursalesRealtime({
    orgId: organization?.id ?? null,
    sucursalId: null,
    onChange: () => { void fetchAllBarbers(); },
  });

  const visibleSucursales = isManagerOnly
    ? allSucursales.filter(s => managerSucursalIds.includes(s.id))
    : allSucursales;

  const defaultTabId = (currentSucursal && visibleSucursales.some(s => s.id === currentSucursal.id))
    ? currentSucursal.id
    : visibleSucursales[0]?.id;

  useEffect(() => {
    if (!selectedSucursalId && defaultTabId) {
      setSelectedSucursalId(defaultTabId);
    }
  }, [defaultTabId, selectedSucursalId]);

  const activeSucursal = visibleSucursales.find(s => s.id === selectedSucursalId);

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title={topTab === 'config' ? 'Configuración' : 'Turnos'}
        icon={CalendarClock}
        subtitle={topTab === 'config'
          ? 'Ajustá cómo funciona esta sección.'
          : 'Tu agenda, las reglas de reserva y el portal de tus clientes'}
      />

      {visibleSucursales.length > 0 && (
        <div className="space-y-4 sm:space-y-6">
          {visibleSucursales.length > 1 && (
            <Select value={selectedSucursalId} onValueChange={setSelectedSucursalId}>
              <SelectTrigger className="w-auto gap-2 border-border/60 bg-transparent px-3 text-sm font-medium hover:bg-accent/50">
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                  <SelectValue placeholder="Elegí una sucursal" />
                </div>
              </SelectTrigger>
              <SelectContent>
                {visibleSucursales.map(s => (
                  <SelectItem key={s.id} value={s.id}>{s.nombre}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {activeSucursal && (
            <AgendaManagement
              key={activeSucursal.id}
              sucursalId={activeSucursal.id}
              organizationId={organization?.id || ''}
              barbers={allBarbers.filter(b => {
                if (b.sucursalId !== activeSucursal.id) return false;
                return (b.rolesEquipo ?? []).includes('barber');
              })}
              onNavigateToHorarios={onNavigateToHorarios}
              onTabChange={setTopTab}
            />
          )}
        </div>
      )}

      {visibleSucursales.length === 0 && (
        <div className="text-center py-12">
          <p className="text-muted-foreground">
            {isManagerOnly ? 'No tenés sucursales asignadas.' : 'No hay sucursales activas.'}
          </p>
        </div>
      )}
    </div>
  );
}
