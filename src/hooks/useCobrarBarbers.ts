import { useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/contexts/OrganizationContext';
import { useSucursal } from '@/contexts/SucursalContext';
import { Barber, TeamRole } from '@/types/barbershop';
import type { AppRole } from '@/contexts/AuthContext';
import { useBarberosSucursalesRealtime } from '@/hooks/useBarberosSucursalesRealtime';
import { useReadState } from '@/hooks/useReadState';

/**
 * Lectura propia de "barberos disponibles para Cobrar".
 *
 * Reglas (Fase 2):
 * - Con sucursal seleccionada: barberos cuyo id está en `barberos_sucursales`
 *   con `sucursal_id = currentSucursal.id` AND `disponible = true`, filtrados
 *   además por `activo = true` y por tener `'barber'` en `roles_equipo`.
 * - Modo "Todas" (owner/GM, sin sucursal): todos los barberos de la org con
 *   `activo = true` y `'barber'` en `roles_equipo`, SIN cruzar disponibilidad.
 *
 * NO se reutiliza el array compartido `barbers` de useSupabaseData porque
 * Sueldos / Estadísticas / Resumen / Finanzas deben seguir leyendo por
 * `sucursal_id` (base) y sin filtro de `activo`.
 */

const VALID_ROLES: AppRole[] = ['owner', 'general_manager', 'manager', 'barber', 'otros'];

function rolEquipoToRoles(re: string | null | undefined): AppRole[] {
  switch (re) {
    case 'owner': return ['owner'];
    case 'general_manager': return ['general_manager'];
    case 'manager': return ['manager'];
    case 'barbero': return ['barber'];
    case 'otros': return ['otros'];
    default: return [];
  }
}

function rowToBarber(row: any): Barber {
  const rolesEquipoRaw = Array.isArray(row.roles_equipo) ? (row.roles_equipo as string[]) : [];
  const rolesEquipo: AppRole[] = rolesEquipoRaw.length > 0
    ? rolesEquipoRaw.filter((r): r is AppRole => VALID_ROLES.includes(r as AppRole))
    : rolEquipoToRoles(row.rol_equipo);
  return {
    id: row.id,
    uid: row.id,
    firstName: row.nombre,
    lastName: row.apellido,
    phone: row.telefono || '',
    commission: Number(row.comision) || 0,
    compensationType: row.tipo_compensacion || 'comision',
    fixedSalary: row.sueldo_fijo != null ? Number(row.sueldo_fijo) : undefined,
    teamRole: (row.rol_equipo as TeamRole) || 'barbero',
    rolesEquipo,
    sucursalId: row.sucursal_id ?? null,
    payDay: row.fecha_cobro_dia || 1,
    address: undefined,
    dni: row.dni || undefined,
    active: row.activo,
  };
}

export function useCobrarBarbers() {
  const { organization } = useOrganization();
  const { currentSucursal } = useSucursal();

  const orgId = organization?.id ?? null;
  const sucursalId = currentSucursal?.id ?? null;
  const contextKey = `${orgId ?? 'none'}::${sucursalId ?? 'all'}`;

  const readState = useReadState<Barber[]>({
    contextKey,
    errorMessage: 'No pudimos cargar el equipo.',
    staleErrorMessage: 'No pudimos actualizar el equipo.',
    surfaceId: `cobrar-barbers:${orgId ?? 'none'}`,
  });

  const fetchBarbers = useCallback(() => {
    readState.run(async (signal) => {
      if (!orgId) return { data: [], error: null };

      let ids: string[] | null = null;

      if (sucursalId) {
        const { data: disp, error: dispErr, status: dispStatus } = await supabase
          .from('barberos_sucursales')
          .select('barbero_id')
          .eq('sucursal_id', sucursalId)
          .eq('disponible', true)
          .abortSignal(signal);
        if (dispErr) return { data: null, error: dispErr, status: dispStatus };
        ids = (disp ?? []).map((r: any) => r.barbero_id);
        if (ids.length === 0) return { data: [], error: null };
      }

      let q = supabase
        .from('barberos')
        .select('*')
        .eq('organization_id', orgId)
        .eq('activo', true)
        .order('nombre');

      if (ids) q = q.in('id', ids);

      const { data, error: bErr, status: bStatus } = await q.abortSignal(signal);
      if (bErr) return { data: null, error: bErr, status: bStatus };

      const mapped = (data ?? [])
        .map(rowToBarber)
        .filter(b => (b.rolesEquipo ?? []).includes('barber'));

      return { data: mapped, error: null };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, sucursalId, readState.run]);

  useEffect(() => {
    fetchBarbers();
  }, [fetchBarbers]);

  useBarberosSucursalesRealtime({
    orgId,
    sucursalId,
    onChange: () => { fetchBarbers(); },
  });

  return {
    barbers: readState.data ?? [],
    isLoading: readState.phase === 'loading',
    error: readState.error,
    isStale: readState.isStale,
    retry: readState.retry,
    refetch: fetchBarbers,
  };
}
