import { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Service, Extra, Barber, Discount, Line, TeamRole } from '@/types/barbershop';
import { useAuth, type AppRole } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { useOrganization } from '@/contexts/OrganizationContext';
import { useSucursal } from '@/contexts/SucursalContext';
import { canonicalizePhoneAR, phoneErrorMessage } from '@/lib/phone';
import { parsePhoneNumberFromString } from 'libphonenumber-js/min';

/**
 * Defensa final para `barberos.telefono`: vacío → NULL; válido → E.164;
 * inválido → throw con mensaje legible. No depender solo de la UI.
 * Acepta cualquier E.164 internacional (AR, UY, CL, CO, MX, ES, BR, ...).
 */
function safeBarberPhone(input: unknown): string | null {
  const raw = (input ?? '').toString().trim();
  if (!raw) return null;
  // Si ya viene en E.164 válido (cualquier país), aceptar tal cual.
  if (raw.startsWith('+')) {
    try {
      const pn = parsePhoneNumberFromString(raw);
      if (pn && pn.isValid()) return pn.number;
    } catch { /* noop */ }
  }
  // Fallback AR para entradas legacy (sin '+').
  const r = canonicalizePhoneAR(raw);
  if (r.ok) return r.e164;
  throw new Error(phoneErrorMessage((r as { ok: false; reason: 'empty' | 'invalid' | 'foreign' | 'ambiguous_landline' }).reason));
}

// Helper: ejecuta una query y, si falla, anota la tabla en el error para diagnóstico.
async function runQuery<T>(table: string, p: PromiseLike<{ data: T; error: any }>): Promise<T> {
  const { data, error } = await p;
  if (error) {
    const tagged: any = new Error(error.message || `Error consultando ${table}`);
    tagged.code = error.code;
    tagged.table = table;
    tagged.original = error;
    throw tagged;
  }
  return data as T;
}

// ============= Branch row shapes =============
type ServicioSucursalRow = { id: string; servicio_id: string; sucursal_id: string; precio: number; activo: boolean };
type ExtraSucursalRow = { id: string; extra_id: string; sucursal_id: string; precio: number; activo: boolean };
type DescuentoSucursalRow = { id: string; descuento_id: string; sucursal_id: string; activo: boolean };

// ============= Transforms =============
function dbToLine(row: any): Line {
  return {
    id: row.id,
    name: row.nombre,
    color: row.color || undefined,
    active: row.activo,
    descripcion: row.descripcion ?? undefined,
    orden: typeof row.orden === 'number' ? row.orden : undefined,
  };
}

function dbToService(row: any, lines: Line[], branchRow?: ServicioSucursalRow): Service {
  const line = lines.find(l => l.id === row.linea_id);
  const globalActive: boolean = !!row.activo;
  const hasBranch = !!branchRow;
  const price = hasBranch ? Number(branchRow!.precio) : Number(row.precio);
  const branchActive = hasBranch ? !!branchRow!.activo : undefined;
  const operativeActive = hasBranch ? (globalActive && !!branchActive) : globalActive;
  return {
    id: row.id,
    uid: row.id,
    name: row.nombre,
    price,
    durationMin: row.duracion_min ?? 30,
    lineId: row.linea_id || undefined,
    lineName: line?.name,
    sucursalId: row.sucursal_id || undefined,
    active: operativeActive,
    descripcion: row.descripcion ?? undefined,
    globalActive,
    branchActive,
    sucursalConfigId: branchRow?.id,
    priceConfigured: price > 0,
  };
}

function dbToExtra(row: any, branchRow?: ExtraSucursalRow): Extra {
  const globalActive: boolean = !!row.activo;
  const hasBranch = !!branchRow;
  const price = hasBranch ? Number(branchRow!.precio) : Number(row.precio);
  const branchActive = hasBranch ? !!branchRow!.activo : undefined;
  const operativeActive = hasBranch ? (globalActive && !!branchActive) : globalActive;
  return {
    id: row.id,
    uid: row.id,
    name: row.nombre,
    price,
    sucursalId: row.sucursal_id || undefined,
    active: operativeActive,
    globalActive,
    branchActive,
    sucursalConfigId: branchRow?.id,
    priceConfigured: price > 0,
  };
}

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

function dbToBarber(row: any): Barber {
  const rolesEquipoRaw = Array.isArray(row.roles_equipo) ? (row.roles_equipo as string[]) : [];
  const rolesEquipo: AppRole[] = rolesEquipoRaw.length > 0
    ? (rolesEquipoRaw.filter((r): r is AppRole => ['owner','general_manager','manager','barber','otros'].includes(r)))
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

function dbToDiscount(row: any, branchRow?: DescuentoSucursalRow): Discount {
  const globalActive: boolean = row.activo !== false;
  const hasBranch = !!branchRow;
  const branchActive = hasBranch ? !!branchRow!.activo : undefined;
  const operativeActive = hasBranch ? (globalActive && !!branchActive) : globalActive;
  return {
    id: row.id,
    label: row.nombre,
    value: Number(row.valor),
    type: row.tipo === 'monto' ? 'fixed' : 'percentage',
    rounding: row.redondeo || 'cliente',
    roundingUnit: Number(row.redondeo_unidad) || 100,
    paymentMethod: row.metodo_pago || 'todos',
    sucursalId: row.sucursal_id || undefined,
    appliesTo: row.aplica_a === 'productos' ? 'productos' : 'servicios',
    active: operativeActive,
    globalActive,
    branchActive,
    sucursalConfigId: branchRow?.id,
  };
}

export function useSupabaseData() {
  const { organization, isLoading: orgLoading } = useOrganization();
  const { currentSucursal } = useSucursal();
  const { user, isLoading: authLoading, roles, hasNoAccess } = useAuth();
  const sucursalId = currentSucursal?.id ?? null;

  const [services, setServices] = useState<Service[]>([]);
  const [extras, setExtras] = useState<Extra[]>([]);
  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [discounts, setDiscounts] = useState<Discount[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Contexto (organización + sucursal) al que pertenece `error` — evita que un
  // error de un contexto anterior aparezca como bloqueante del contexto actual.
  const [errorContextKey, setErrorContextKey] = useState<string | null>(null);
  // Contexto para el que la última carga EXITOSA fue confirmada. Comparado
  // contra `contextKey` en cada render — no requiere resetearse con un efecto.
  const [loadedContextKey, setLoadedContextKey] = useState<string | null>(null);

  // Gating: hasta que auth y org no terminen de hidratar, o si el usuario no tiene cargo,
  // NO disparamos fetch (no hay datos que cargar).
  const ready = !authLoading && !orgLoading && !!user && !!organization && roles.length > 0 && !hasNoAccess;
  const skip = !authLoading && !orgLoading && (hasNoAccess || roles.length === 0);

  // Clave estable del contexto de datos actual. Cambia de inmediato (mismo
  // render) cuando cambia organización o sucursal — sin esperar ningún efecto.
  const contextKey = `${organization?.id ?? 'none'}::${sucursalId ?? 'all'}`;
  const hasLoadedCurrentContext = loadedContextKey === contextKey;

  // Ref "siempre fresco" con el contexto seleccionado en la UI en este instante.
  // Se actualiza en useLayoutEffect (antes del paint, antes del efecto pasivo
  // que dispara el fetch nuevo) para no mutar un ref durante el render mismo
  // — un render descartado por concurrent features no debe dejar el ref en un
  // estado que nunca llegó a commitear.
  const currentContextKeyRef = useRef(contextKey);
  useLayoutEffect(() => {
    currentContextKeyRef.current = contextKey;
  }, [contextKey]);

  // Ordena llamadas concurrentes al MISMO contexto (ej. doble refetch) — la
  // comparación de contexto de arriba no distingue eso porque ambas comparten
  // `contextKey`.
  const requestIdRef = useRef(0);

  // Fetch all data
  const fetchData = useCallback(async () => {
    const myRequestId = ++requestIdRef.current;
    const myContextKey = `${organization?.id ?? 'none'}::${sucursalId ?? 'all'}`;
    const stillCurrent = () =>
      myContextKey === currentContextKeyRef.current && myRequestId === requestIdRef.current;

    setIsLoading(true);
    setError(null);
    console.info('[Data] phase=fetch:start', {
      userId: user?.id,
      organizationId: organization?.id,
      sucursalId,
      roles,
    });
    try {
      const linesData = await runQuery<any[]>(
        'lineas',
        supabase.from('lineas').select('*').eq('eliminado', false).order('orden', { ascending: true }).order('nombre', { ascending: true }) as any
      );
      const fetchedLines = linesData.map(dbToLine);

      let barbersQuery = supabase.from('barberos').select('*').order('nombre');
      if (sucursalId) {
        barbersQuery = barbersQuery.eq('sucursal_id', sucursalId);
      }

      const servSucPromise = sucursalId
        ? supabase.from('servicios_sucursales').select('*').eq('sucursal_id', sucursalId)
        : Promise.resolve({ data: [] as ServicioSucursalRow[], error: null as any });
      const extSucPromise = sucursalId
        ? supabase.from('extras_sucursales').select('*').eq('sucursal_id', sucursalId)
        : Promise.resolve({ data: [] as ExtraSucursalRow[], error: null as any });
      const descSucPromise = sucursalId
        ? supabase.from('descuentos_sucursales').select('*').eq('sucursal_id', sucursalId)
        : Promise.resolve({ data: [] as DescuentoSucursalRow[], error: null as any });

      const [servicesData, extrasData, barbersData, discountsData, servSucData, extSucData, descSucData] = await Promise.all([
        runQuery<any[]>('servicios', supabase.from('servicios').select('*').eq('eliminado', false).order('nombre') as any),
        runQuery<any[]>('extras', supabase.from('extras').select('*').eq('eliminado', false).order('nombre') as any),
        runQuery<any[]>('barberos', barbersQuery as any),
        runQuery<any[]>('descuentos', supabase.from('descuentos').select('*').eq('eliminado', false).order('valor') as any),
        runQuery<ServicioSucursalRow[]>('servicios_sucursales', servSucPromise as any),
        runQuery<ExtraSucursalRow[]>('extras_sucursales', extSucPromise as any),
        runQuery<DescuentoSucursalRow[]>('descuentos_sucursales', descSucPromise as any),
      ]);

      const servSucMap = new Map<string, ServicioSucursalRow>();
      (servSucData || []).forEach(r => servSucMap.set(r.servicio_id, r));
      const extSucMap = new Map<string, ExtraSucursalRow>();
      (extSucData || []).forEach(r => extSucMap.set(r.extra_id, r));
      const descSucMap = new Map<string, DescuentoSucursalRow>();
      (descSucData || []).forEach(r => descSucMap.set(r.descuento_id, r));

      const builtServices: Service[] = [];
      for (const row of servicesData) {
        if (sucursalId) {
          const br = servSucMap.get(row.id);
          if (!br) {
            console.warn('[useSupabaseData] Falta servicios_sucursales para servicio', row.id, 'sucursal', sucursalId);
            continue;
          }
          builtServices.push(dbToService(row, fetchedLines, br));
        } else {
          builtServices.push(dbToService(row, fetchedLines));
        }
      }

      const builtExtras: Extra[] = [];
      for (const row of extrasData) {
        if (sucursalId) {
          const br = extSucMap.get(row.id);
          if (!br) {
            console.warn('[useSupabaseData] Falta extras_sucursales para extra', row.id, 'sucursal', sucursalId);
            continue;
          }
          builtExtras.push(dbToExtra(row, br));
        } else {
          builtExtras.push(dbToExtra(row));
        }
      }

      const builtDiscounts: Discount[] = [];
      for (const row of discountsData) {
        if (sucursalId) {
          const br = descSucMap.get(row.id);
          if (!br) {
            console.warn('[useSupabaseData] Falta descuentos_sucursales para descuento', row.id, 'sucursal', sucursalId);
            continue;
          }
          builtDiscounts.push(dbToDiscount(row, br));
        } else {
          builtDiscounts.push(dbToDiscount(row));
        }
      }

      // Un contexto (organización/sucursal) más nuevo ya está seleccionado, o
      // una llamada más reciente a este mismo contexto ya está en curso:
      // descartar esta respuesta entera, sin aplicar ningún array.
      if (!stillCurrent()) return;

      setLines(fetchedLines);
      setServices(builtServices);
      setExtras(builtExtras);
      setBarbers(barbersData.map(dbToBarber));
      setDiscounts(builtDiscounts);
      setLoadedContextKey(myContextKey);
      console.info('[Data] phase=fetch:success');
    } catch (err: any) {
      if (!stillCurrent()) return;
      console.error('[Data] phase=fetch:error', {
        table: err?.table ?? 'unknown',
        code: err?.code,
        message: err?.message,
      });
      setError('No pudimos cargar los datos. Reintentá en unos segundos.');
      setErrorContextKey(myContextKey);
      toast.error('Error al cargar datos');
    } finally {
      if (stillCurrent()) {
        setIsLoading(false);
      }
    }
  }, [sucursalId, user?.id, organization?.id, roles]);

  useEffect(() => {
    if (skip) {
      setLines([]);
      setServices([]);
      setExtras([]);
      setBarbers([]);
      setDiscounts([]);
      setError(null);
      setErrorContextKey(null);
      setLoadedContextKey(null);
      setIsLoading(false);
      return;
    }
    if (!ready) {
      setIsLoading(true);
      return;
    }
    fetchData();
  }, [ready, skip, fetchData]);

  // Error "vivo": pertenece al contexto (organización/sucursal) seleccionado
  // ahora mismo, y ese contexto todavía no tiene una carga exitosa confirmada.
  // Un error de un contexto anterior, o un refetch fallido de un contexto que
  // ya tenía datos buenos, nunca cae acá.
  const blockingError = errorContextKey === contextKey && !hasLoadedCurrentContext ? error : null;

  // Bloquea el shell (loader global de pantalla completa) solo mientras el
  // contexto actual no tiene ninguna carga exitosa confirmada, no es un
  // usuario sin acceso (esos se resuelven aparte, vía `hasNoAccess`) y no hay
  // ya un error bloqueante para mostrar en su lugar. No depende del timing de
  // `isLoading`: se activa en el mismo render en que cambia `contextKey`.
  const showBlockingLoader = !skip && !hasLoadedCurrentContext && !blockingError;

  // ============= Helpers para resolver sucursalConfigId =============
  const findServicioSucursalId = useCallback(async (servicioId: string): Promise<string | null> => {
    if (!sucursalId) return null;
    const { data, error } = await supabase
      .from('servicios_sucursales')
      .select('id')
      .eq('servicio_id', servicioId)
      .eq('sucursal_id', sucursalId)
      .maybeSingle();
    if (error) {
      console.warn('[useSupabaseData] Error buscando servicios_sucursales:', error);
      return null;
    }
    return data?.id ?? null;
  }, [sucursalId]);

  const findExtraSucursalId = useCallback(async (extraId: string): Promise<string | null> => {
    if (!sucursalId) return null;
    const { data, error } = await supabase
      .from('extras_sucursales')
      .select('id')
      .eq('extra_id', extraId)
      .eq('sucursal_id', sucursalId)
      .maybeSingle();
    if (error) {
      console.warn('[useSupabaseData] Error buscando extras_sucursales:', error);
      return null;
    }
    return data?.id ?? null;
  }, [sucursalId]);

  const findDescuentoSucursalId = useCallback(async (descuentoId: string): Promise<string | null> => {
    if (!sucursalId) return null;
    const { data, error } = await supabase
      .from('descuentos_sucursales')
      .select('id')
      .eq('descuento_id', descuentoId)
      .eq('sucursal_id', sucursalId)
      .maybeSingle();
    if (error) {
      console.warn('[useSupabaseData] Error buscando descuentos_sucursales:', error);
      return null;
    }
    return data?.id ?? null;
  }, [sucursalId]);

  // ============= Services CRUD =============
  const addService = useCallback(async (service: Omit<Service, 'id' | 'uid'>) => {
    if (!organization) {
      toast.error('No se pudo determinar la organización');
      return null;
    }
    try {
      const normalizedName = service.name.replace(/\s+/g, ' ').trim();

      // 1. Insert global SIN propagar precio. precio=0 placeholder, sucursal_id=null.
      const insertPayload: any = {
        nombre: normalizedName,
        precio: 0,
        duracion_min: service.durationMin || 30,
        activo: true,
        linea_id: service.lineId || null,
        organization_id: organization.id,
        sucursal_id: null,
      };
      if (service.descripcion !== undefined) {
        const trimmed = (service.descripcion ?? '').trim();
        insertPayload.descripcion = trimmed ? trimmed : null;
      }
      const { data, error } = await supabase
        .from('servicios')
        .insert(insertPayload)
        .select()
        .single();
      if (error) throw error;

      let branchRow: ServicioSucursalRow | undefined;

      // 2-4. Si hay sucursal activa, buscar fila creada por trigger y aplicar precio/activo via RPC
      if (sucursalId) {
        const branchId = await findServicioSucursalId(data.id);
        if (!branchId) {
          console.warn('[addService] No se encontró servicios_sucursales tras insert; se omiten precio/activo por sucursal');
        } else {
          // Precio
          if (service.price > 0) {
            const { data: rpcData, error: rpcErr } = await supabase.rpc('set_servicio_sucursal_precio', {
              _id: branchId,
              _precio: service.price,
            });
            if (rpcErr) throw rpcErr;
            if (rpcData) branchRow = (Array.isArray(rpcData) ? rpcData[0] : rpcData) as ServicioSucursalRow;
          }
          // Activo (solo si difiere del default true)
          if (service.active === false) {
            const { data: rpcData, error: rpcErr } = await supabase.rpc('set_servicio_sucursal_activo', {
              _id: branchId,
              _activo: false,
            });
            if (rpcErr) throw rpcErr;
            if (rpcData) branchRow = (Array.isArray(rpcData) ? rpcData[0] : rpcData) as ServicioSucursalRow;
          }
          if (!branchRow) {
            // Releer estado actual
            const { data: br } = await supabase
              .from('servicios_sucursales')
              .select('*')
              .eq('id', branchId)
              .maybeSingle();
            if (br) branchRow = br as ServicioSucursalRow;
          }
        }
      } else if (service.price > 0) {
        console.warn('[addService] Hay precio pero no hay sucursal activa; el precio NO se aplica globalmente.');
      }

      const newService = dbToService(data, lines, branchRow);
      // Si hay sucursal y no hay branchRow, no agregar al state (consistente con fetch)
      if (sucursalId && !branchRow) {
        toast.success('Servicio agregado');
        return newService;
      }
      setServices(prev => [...prev, newService]);
      toast.success('Servicio agregado');
      return newService;
    } catch (error) {
      console.error('Error adding service:', error);
      toast.error('Error al agregar servicio');
      return null;
    }
  }, [lines, organization, sucursalId, findServicioSucursalId]);

  const updateService = useCallback(async (id: string, updates: Partial<Service>) => {
    try {
      // 1. Globales: nombre / duracion_min / linea_id / descripcion (NUNCA precio ni activo si hay sucursal)
      const dbUpdates: any = {};
      if (updates.name !== undefined) dbUpdates.nombre = updates.name.replace(/\s+/g, ' ').trim();
      if (updates.durationMin !== undefined) dbUpdates.duracion_min = updates.durationMin;
      if (updates.lineId !== undefined) dbUpdates.linea_id = updates.lineId || null;
      if (updates.descripcion !== undefined) {
        const trimmed = (updates.descripcion ?? '').trim();
        dbUpdates.descripcion = trimmed ? trimmed : null;
      }
      // Sin sucursal: active toggle global directo
      if (!sucursalId && updates.active !== undefined) dbUpdates.activo = updates.active;

      if (Object.keys(dbUpdates).length > 0) {
        const { error } = await supabase.from('servicios').update(dbUpdates).eq('id', id);
        if (error) throw error;
      }

      // 2. Por sucursal: precio + activo via RPCs
      let branchRow: ServicioSucursalRow | undefined;
      if (sucursalId && (updates.price !== undefined || updates.active !== undefined)) {
        // Resolver sucursalConfigId desde state o re-consultar
        let branchId = updates.sucursalConfigId
          ?? services.find(s => s.id === id)?.sucursalConfigId
          ?? null;
        if (!branchId) branchId = await findServicioSucursalId(id);

        if (!branchId) {
          console.warn('[updateService] No existe servicios_sucursales para', id, '— se omiten precio/activo');
        } else {
          if (updates.price !== undefined) {
            if (updates.price < 0) {
              toast.error('El precio no puede ser negativo');
            } else {
              const { data: rpcData, error: rpcErr } = await supabase.rpc('set_servicio_sucursal_precio', {
                _id: branchId,
                _precio: updates.price,
              });
              if (rpcErr) throw rpcErr;
              if (rpcData) branchRow = (Array.isArray(rpcData) ? rpcData[0] : rpcData) as ServicioSucursalRow;
            }
          }
          if (updates.active !== undefined) {
            const { data: rpcData, error: rpcErr } = await supabase.rpc('set_servicio_sucursal_activo', {
              _id: branchId,
              _activo: updates.active,
            });
            if (rpcErr) throw rpcErr;
            if (rpcData) branchRow = (Array.isArray(rpcData) ? rpcData[0] : rpcData) as ServicioSucursalRow;
          }
        }
      } else if (!sucursalId && updates.price !== undefined) {
        console.warn('[updateService] Hay price pero no hay sucursal activa; ignorado (no se escribe global).');
      }

      // 3. Mergear en state
      const updatedLine = updates.lineId ? lines.find(l => l.id === updates.lineId) : undefined;
      setServices(prev => prev.map(s => {
        if (s.id !== id) return s;
        const merged: Service = { ...s };
        if (updates.name !== undefined) merged.name = dbUpdates.nombre ?? updates.name;
        if (updates.durationMin !== undefined) merged.durationMin = updates.durationMin;
        if (updates.lineId !== undefined) {
          merged.lineId = updates.lineId || undefined;
          merged.lineName = updatedLine?.name;
        }
        if (updates.descripcion !== undefined) merged.descripcion = (updates.descripcion ?? '').trim() || undefined;
        if (!sucursalId && updates.active !== undefined) {
          merged.active = updates.active;
          merged.globalActive = updates.active;
        }
        if (branchRow) {
          merged.price = Number(branchRow.precio);
          merged.branchActive = !!branchRow.activo;
          merged.sucursalConfigId = branchRow.id;
          merged.priceConfigured = Number(branchRow.precio) > 0;
          merged.active = !!merged.globalActive && !!branchRow.activo;
        } else if (sucursalId && updates.active !== undefined) {
          // Optimistic si no hubo retorno de RPC
          merged.branchActive = updates.active;
          merged.active = !!merged.globalActive && updates.active;
        } else if (sucursalId && updates.price !== undefined && updates.price >= 0) {
          merged.price = updates.price;
          merged.priceConfigured = updates.price > 0;
        }
        return merged;
      }));
    } catch (error) {
      console.error('Error updating service:', error);
      toast.error('Error al actualizar servicio');
    }
  }, [lines, sucursalId, services, findServicioSucursalId]);

  // ============= Extras CRUD =============
  const addExtra = useCallback(async (extra: Omit<Extra, 'id' | 'uid'>) => {
    if (!organization) {
      toast.error('No se pudo determinar la organización');
      return null;
    }
    try {
      const normalizedName = extra.name.replace(/\s+/g, ' ').trim();

      const { data, error } = await supabase
        .from('extras')
        .insert({
          nombre: normalizedName,
          precio: 0,
          activo: true,
          organization_id: organization.id,
          sucursal_id: null,
        })
        .select()
        .single();
      if (error) throw error;

      let branchRow: ExtraSucursalRow | undefined;
      if (sucursalId) {
        const branchId = await findExtraSucursalId(data.id);
        if (!branchId) {
          console.warn('[addExtra] No se encontró extras_sucursales tras insert');
        } else {
          if (extra.price > 0) {
            const { data: rpcData, error: rpcErr } = await supabase.rpc('set_extra_sucursal_precio', {
              _id: branchId,
              _precio: extra.price,
            });
            if (rpcErr) throw rpcErr;
            if (rpcData) branchRow = (Array.isArray(rpcData) ? rpcData[0] : rpcData) as ExtraSucursalRow;
          }
          if (extra.active === false) {
            const { data: rpcData, error: rpcErr } = await supabase.rpc('set_extra_sucursal_activo', {
              _id: branchId,
              _activo: false,
            });
            if (rpcErr) throw rpcErr;
            if (rpcData) branchRow = (Array.isArray(rpcData) ? rpcData[0] : rpcData) as ExtraSucursalRow;
          }
          if (!branchRow) {
            const { data: br } = await supabase
              .from('extras_sucursales')
              .select('*')
              .eq('id', branchId)
              .maybeSingle();
            if (br) branchRow = br as ExtraSucursalRow;
          }
        }
      } else if (extra.price > 0) {
        console.warn('[addExtra] Hay precio pero no hay sucursal activa; el precio NO se aplica globalmente.');
      }

      const newExtra = dbToExtra(data, branchRow);
      if (sucursalId && !branchRow) {
        toast.success('Extra agregado');
        return newExtra;
      }
      setExtras(prev => [...prev, newExtra]);
      toast.success('Extra agregado');
      return newExtra;
    } catch (error) {
      console.error('Error adding extra:', error);
      toast.error('Error al agregar extra');
      return null;
    }
  }, [organization, sucursalId, findExtraSucursalId]);

  const updateExtra = useCallback(async (id: string, updates: Partial<Extra>) => {
    try {
      const dbUpdates: any = {};
      if (updates.name !== undefined) dbUpdates.nombre = updates.name.replace(/\s+/g, ' ').trim();
      if (!sucursalId && updates.active !== undefined) dbUpdates.activo = updates.active;

      if (Object.keys(dbUpdates).length > 0) {
        const { error } = await supabase.from('extras').update(dbUpdates).eq('id', id);
        if (error) throw error;
      }

      let branchRow: ExtraSucursalRow | undefined;
      if (sucursalId && (updates.price !== undefined || updates.active !== undefined)) {
        let branchId = updates.sucursalConfigId
          ?? extras.find(e => e.id === id)?.sucursalConfigId
          ?? null;
        if (!branchId) branchId = await findExtraSucursalId(id);

        if (!branchId) {
          console.warn('[updateExtra] No existe extras_sucursales para', id);
        } else {
          if (updates.price !== undefined) {
            if (updates.price < 0) {
              toast.error('El precio no puede ser negativo');
            } else {
              const { data: rpcData, error: rpcErr } = await supabase.rpc('set_extra_sucursal_precio', {
                _id: branchId,
                _precio: updates.price,
              });
              if (rpcErr) throw rpcErr;
              if (rpcData) branchRow = (Array.isArray(rpcData) ? rpcData[0] : rpcData) as ExtraSucursalRow;
            }
          }
          if (updates.active !== undefined) {
            const { data: rpcData, error: rpcErr } = await supabase.rpc('set_extra_sucursal_activo', {
              _id: branchId,
              _activo: updates.active,
            });
            if (rpcErr) throw rpcErr;
            if (rpcData) branchRow = (Array.isArray(rpcData) ? rpcData[0] : rpcData) as ExtraSucursalRow;
          }
        }
      } else if (!sucursalId && updates.price !== undefined) {
        console.warn('[updateExtra] Hay price pero no hay sucursal activa; ignorado.');
      }

      setExtras(prev => prev.map(e => {
        if (e.id !== id) return e;
        const merged: Extra = { ...e };
        if (updates.name !== undefined) merged.name = dbUpdates.nombre ?? updates.name;
        if (!sucursalId && updates.active !== undefined) {
          merged.active = updates.active;
          merged.globalActive = updates.active;
        }
        if (branchRow) {
          merged.price = Number(branchRow.precio);
          merged.branchActive = !!branchRow.activo;
          merged.sucursalConfigId = branchRow.id;
          merged.priceConfigured = Number(branchRow.precio) > 0;
          merged.active = !!merged.globalActive && !!branchRow.activo;
        } else if (sucursalId && updates.active !== undefined) {
          merged.branchActive = updates.active;
          merged.active = !!merged.globalActive && updates.active;
        } else if (sucursalId && updates.price !== undefined && updates.price >= 0) {
          merged.price = updates.price;
          merged.priceConfigured = updates.price > 0;
        }
        return merged;
      }));
    } catch (error) {
      console.error('Error updating extra:', error);
      toast.error('Error al actualizar extra');
    }
  }, [sucursalId, extras, findExtraSucursalId]);

  // ============= Barbers CRUD (sin cambios) =============
  const addBarber = useCallback(async (barber: Omit<Barber, 'id' | 'uid'>) => {
    if (!organization) {
      toast.error('No se pudo determinar la organización');
      return null;
    }
    try {
      const normalizedFirstName = barber.firstName.replace(/\s+/g, ' ').trim();
      const normalizedLastName = barber.lastName.replace(/\s+/g, ' ').trim();
      const { data, error } = await supabase
        .from('barberos')
        .insert({
          nombre: normalizedFirstName,
          apellido: normalizedLastName,
          telefono: safeBarberPhone(barber.phone),
          dni: barber.dni || null,
          comision: barber.commission,
          activo: barber.active,
          organization_id: organization.id,
          sucursal_id: currentSucursal?.id || null,
          tipo_compensacion: barber.compensationType || 'comision',
          sueldo_fijo: barber.fixedSalary || null,
          rol_equipo: barber.teamRole || 'barbero',
          roles_equipo: (barber.rolesEquipo && barber.rolesEquipo.length > 0)
            ? barber.rolesEquipo
            : (barber.teamRole === 'otros' ? ['otros'] : ['barber']),
          fecha_cobro_dia: barber.payDay || 1,
        })
        .select()
        .single();
      if (error) throw error;
      const newBarber = dbToBarber(data);
      setBarbers(prev => [...prev, newBarber]);
      toast.success('Barbero agregado');
      return newBarber;
    } catch (error) {
      console.error('Error adding barber:', error);
      toast.error('Error al agregar barbero');
      return null;
    }
  }, [organization, currentSucursal?.id]);

  const updateBarber = useCallback(async (id: string, updates: Partial<Barber>) => {
    try {
      const dbUpdates: any = {};
      if (updates.firstName !== undefined) dbUpdates.nombre = updates.firstName.replace(/\s+/g, ' ').trim();
      if (updates.lastName !== undefined) dbUpdates.apellido = updates.lastName.replace(/\s+/g, ' ').trim();
      if (updates.phone !== undefined) dbUpdates.telefono = safeBarberPhone(updates.phone);
      if (updates.dni !== undefined) dbUpdates.dni = updates.dni || null;
      if (updates.commission !== undefined) dbUpdates.comision = updates.commission;
      if (updates.active !== undefined) dbUpdates.activo = updates.active;
      if (updates.compensationType !== undefined) dbUpdates.tipo_compensacion = updates.compensationType;
      if (updates.fixedSalary !== undefined) dbUpdates.sueldo_fijo = updates.fixedSalary || null;
      if (updates.teamRole !== undefined) dbUpdates.rol_equipo = updates.teamRole;
      if (updates.rolesEquipo !== undefined) dbUpdates.roles_equipo = updates.rolesEquipo;
      if (updates.payDay !== undefined) dbUpdates.fecha_cobro_dia = updates.payDay;

      const { error } = await supabase.from('barberos').update(dbUpdates).eq('id', id);
      if (error) throw error;
      setBarbers(prev => prev.map(b => b.id === id ? { ...b, ...updates } : b));
    } catch (error) {
      console.error('Error updating barber:', error);
      toast.error('Error al actualizar barbero');
    }
  }, []);

  // ============= Discounts CRUD =============
  const addDiscount = useCallback(async (discount: Omit<Discount, 'id'>) => {
    if (!organization) {
      toast.error('No se pudo determinar la organización');
      return null;
    }
    try {
      const appliesTo = discount.appliesTo || 'servicios';
      const { data, error } = await supabase
        .from('descuentos')
        .insert({
          nombre: discount.label.replace(/\s+/g, ' ').trim(),
          valor: discount.value,
          tipo: discount.type === 'fixed' ? 'monto' : 'porcentaje',
          redondeo: discount.rounding || 'cliente',
          redondeo_unidad: discount.roundingUnit || 100,
          metodo_pago: discount.paymentMethod || 'todos',
          activo: true,
          aplica_a: appliesTo,
          organization_id: organization.id,
        })
        .select()
        .single();
      if (error) throw error;

      let branchRow: DescuentoSucursalRow | undefined;
      if (sucursalId) {
        const branchId = await findDescuentoSucursalId(data.id);
        if (!branchId) {
          console.warn('[addDiscount] No se encontró descuentos_sucursales tras insert');
        } else {
          const { data: br } = await supabase
            .from('descuentos_sucursales')
            .select('*')
            .eq('id', branchId)
            .maybeSingle();
          if (br) branchRow = br as DescuentoSucursalRow;
        }
      }

      const newDiscount = dbToDiscount(data, branchRow);
      if (sucursalId && !branchRow) {
        toast.success('Descuento agregado');
        return newDiscount;
      }
      setDiscounts(prev => [...prev, newDiscount]);
      toast.success('Descuento agregado');
      return newDiscount;
    } catch (error) {
      console.error('Error adding discount:', error);
      toast.error('Error al agregar descuento');
      return null;
    }
  }, [organization, sucursalId, findDescuentoSucursalId]);

  const updateDiscount = useCallback(async (id: string, updates: Partial<Discount>) => {
    if (id === 'none') return;
    try {
      // 1. Globales (label / value / type / rounding / roundingUnit / paymentMethod / appliesTo)
      const dbUpdates: any = {};
      if (updates.label !== undefined) dbUpdates.nombre = updates.label.replace(/\s+/g, ' ').trim();
      if (updates.value !== undefined) dbUpdates.valor = updates.value;
      if (updates.type !== undefined) dbUpdates.tipo = updates.type === 'fixed' ? 'monto' : 'porcentaje';
      if (updates.rounding !== undefined) dbUpdates.redondeo = updates.rounding;
      if (updates.roundingUnit !== undefined) dbUpdates.redondeo_unidad = updates.roundingUnit;
      if (updates.paymentMethod !== undefined) dbUpdates.metodo_pago = updates.paymentMethod;
      if (updates.appliesTo !== undefined) dbUpdates.aplica_a = updates.appliesTo;
      // Sin sucursal: active toggle global directo
      if (!sucursalId && updates.active !== undefined) dbUpdates.activo = updates.active;

      if (Object.keys(dbUpdates).length > 0) {
        const { error } = await supabase.from('descuentos').update(dbUpdates).eq('id', id);
        if (error) throw error;
      }

      // 2. Por sucursal: active via RPC
      let branchRow: DescuentoSucursalRow | undefined;
      if (sucursalId && updates.active !== undefined) {
        let branchId = updates.sucursalConfigId
          ?? discounts.find(d => d.id === id)?.sucursalConfigId
          ?? null;
        if (!branchId) branchId = await findDescuentoSucursalId(id);

        if (!branchId) {
          console.warn('[updateDiscount] No existe descuentos_sucursales para', id);
        } else {
          const { data: rpcData, error: rpcErr } = await supabase.rpc('set_descuento_sucursal_activo', {
            _id: branchId,
            _activo: updates.active,
          });
          if (rpcErr) throw rpcErr;
          if (rpcData) branchRow = (Array.isArray(rpcData) ? rpcData[0] : rpcData) as DescuentoSucursalRow;
        }
      }

      setDiscounts(prev => prev.map(d => {
        if (d.id !== id) return d;
        const merged: Discount = { ...d, ...updates };
        if (!sucursalId && updates.active !== undefined) {
          merged.globalActive = updates.active;
          merged.active = updates.active;
        }
        if (branchRow) {
          merged.branchActive = !!branchRow.activo;
          merged.sucursalConfigId = branchRow.id;
          merged.active = !!merged.globalActive && !!branchRow.activo;
        } else if (sucursalId && updates.active !== undefined) {
          merged.branchActive = updates.active;
          merged.active = !!merged.globalActive && updates.active;
        }
        return merged;
      }));
    } catch (error) {
      console.error('Error updating discount:', error);
      toast.error('Error al actualizar descuento');
    }
  }, [sucursalId, discounts, findDescuentoSucursalId]);

  // Toggle activo/inactivo (con sucursal → branch RPC; sin sucursal → global)
  const setDiscountActive = useCallback(async (id: string, activo: boolean) => {
    if (id === 'none') return;
    try {
      if (sucursalId) {
        const target = discounts.find(d => d.id === id);
        let branchId = target?.sucursalConfigId ?? null;
        if (!branchId) branchId = await findDescuentoSucursalId(id);
        if (!branchId) {
          console.warn('[setDiscountActive] No existe descuentos_sucursales para', id);
          toast.error('No se pudo actualizar el descuento en esta sucursal');
          return;
        }
        const { data: rpcData, error } = await supabase.rpc('set_descuento_sucursal_activo', {
          _id: branchId,
          _activo: activo,
        });
        if (error) throw error;
        const branchRow = rpcData ? ((Array.isArray(rpcData) ? rpcData[0] : rpcData) as DescuentoSucursalRow) : undefined;
        setDiscounts(prev => prev.map(d => {
          if (d.id !== id) return d;
          const branchActive = branchRow ? !!branchRow.activo : activo;
          return {
            ...d,
            branchActive,
            sucursalConfigId: branchRow?.id ?? d.sucursalConfigId,
            active: !!d.globalActive && branchActive,
          };
        }));
      } else {
        const { error } = await supabase.from('descuentos').update({ activo }).eq('id', id);
        if (error) throw error;
        setDiscounts(prev => prev.map(d => d.id === id ? { ...d, globalActive: activo, active: activo } : d));
      }
      toast.success(activo ? 'Descuento reactivado' : 'Descuento desactivado');
    } catch (error) {
      console.error('Error toggling discount:', error);
      toast.error('Error al actualizar descuento');
    }
  }, [sucursalId, discounts, findDescuentoSucursalId]);

  // ============= Eliminación segura (soft delete) =============
  // Allowlist estricta: SOLO estas tablas pueden ser "eliminadas".
  type DeletableTable = 'servicios' | 'extras' | 'descuentos' | 'lineas';
  const ALLOWED_DELETE_TABLES: ReadonlyArray<DeletableTable> = ['servicios', 'extras', 'descuentos', 'lineas'];

  const softDelete = useCallback(async (table: DeletableTable, id: string): Promise<boolean> => {
    if (!ALLOWED_DELETE_TABLES.includes(table)) {
      console.error('[softDelete] Tabla no permitida:', table);
      return false;
    }
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase
      .from(table)
      .update({
        activo: false,
        eliminado: true,
        eliminado_at: new Date().toISOString(),
        eliminado_por: user?.id ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);
    if (error) {
      console.error('[softDelete]', table, error);
      return false;
    }
    return true;
  }, []);

  const deleteService = useCallback(async (id: string) => {
    const ok = await softDelete('servicios', id);
    if (ok) {
      setServices(prev => prev.filter(s => s.id !== id));
      toast.success('Servicio eliminado correctamente.');
    } else {
      toast.error('No se pudo eliminar el servicio');
    }
  }, [softDelete]);

  const deleteExtra = useCallback(async (id: string) => {
    const ok = await softDelete('extras', id);
    if (ok) {
      setExtras(prev => prev.filter(e => e.id !== id));
      toast.success('Extra eliminado correctamente.');
    } else {
      toast.error('No se pudo eliminar el extra');
    }
  }, [softDelete]);

  const deleteLine = useCallback(async (id: string) => {
    const ok = await softDelete('lineas', id);
    if (ok) {
      setLines(prev => prev.filter(l => l.id !== id));
      // No tocar servicios.linea_id: la UI mostrará "Sin línea" para los huérfanos.
      setServices(prev => prev.map(s => s.lineId === id ? { ...s, lineName: undefined, lineId: undefined } : s));
      toast.success('Línea eliminada correctamente.');
    } else {
      toast.error('No se pudo eliminar la línea');
    }
  }, [softDelete]);

  const deleteDiscount = useCallback(async (id: string) => {
    if (id === 'none') return;
    const ok = await softDelete('descuentos', id);
    if (ok) {
      setDiscounts(prev => prev.filter(d => d.id !== id));
      toast.success('Descuento eliminado correctamente.');
    } else {
      toast.error('No se pudo eliminar el descuento');
    }
  }, [softDelete]);

  // ============= Lines CRUD =============
  const addLine = useCallback(async (line: Omit<Line, 'id'>) => {
    if (!organization) {
      toast.error('No se pudo determinar la organización');
      return null;
    }
    try {
      // Calcular el próximo orden (MAX+10) para que la línea nueva quede al final.
      // Race condition documentada: si dos crean a la vez podrían empatar; el orden
      // queda ambiguo pero no roto, y el siguiente reorden por DnD lo deja determinista.
      const { data: maxRow, error: maxErr } = await supabase
        .from('lineas')
        .select('orden')
        .eq('organization_id', organization.id)
        .eq('eliminado', false)
        .order('orden', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (maxErr) throw maxErr;
      const nextOrden = ((maxRow?.orden ?? 0) as number) + 10;

      const insertPayload: any = {
        nombre: line.name,
        activo: line.active,
        color: line.color || null,
        organization_id: organization.id,
        orden: nextOrden,
      };
      if (line.descripcion !== undefined) {
        const trimmed = (line.descripcion ?? '').trim();
        insertPayload.descripcion = trimmed ? trimmed : null;
      }

      const { data, error } = await supabase
        .from('lineas')
        .insert(insertPayload)
        .select()
        .single();
      if (error) throw error;
      const newLine = dbToLine(data);
      setLines(prev => [...prev, newLine]);
      toast.success('Línea agregada');
      return newLine;
    } catch (error) {
      console.error('Error adding line:', error);
      toast.error('Error al agregar línea');
      return null;
    }
  }, [organization]);

  const updateLine = useCallback(async (id: string, updates: Partial<Line>) => {
    try {
      const dbUpdates: any = {};
      if (updates.name !== undefined) dbUpdates.nombre = updates.name;
      if (updates.active !== undefined) dbUpdates.activo = updates.active;
      if (updates.color !== undefined) dbUpdates.color = updates.color || null;
      if (updates.descripcion !== undefined) {
        const trimmed = (updates.descripcion ?? '').trim();
        dbUpdates.descripcion = trimmed ? trimmed : null;
      }

      if (Object.keys(dbUpdates).length === 0) return;

      const { error } = await supabase.from('lineas').update(dbUpdates).eq('id', id);
      if (error) throw error;
      setLines(prev => prev.map(l => l.id === id ? { ...l, ...updates } : l));

      if (updates.name !== undefined) {
        setServices(prev => prev.map(s => s.lineId === id ? { ...s, lineName: updates.name } : s));
      }
    } catch (error) {
      console.error('Error updating line:', error);
      toast.error('Error al actualizar línea');
    }
  }, []);

  const reorderLines = useCallback(async (ids: string[]) => {
    if (!organization) {
      toast.error('No se pudo determinar la organización');
      return;
    }
    if (!ids.length) return;
    // Snapshot para rollback
    const prevLines = lines;
    // Optimista: aplicar nuevo orden en múltiplos de 10
    const orderMap = new Map(ids.map((id, idx) => [id, (idx + 1) * 10]));
    setLines(prev => prev.map(l => orderMap.has(l.id) ? { ...l, orden: orderMap.get(l.id)! } : l));
    try {
      const { error } = await supabase.rpc('reorder_lineas', {
        p_org_id: organization.id,
        p_ids: ids,
      });
      if (error) throw error;
    } catch (error) {
      console.error('Error reordering lines:', error);
      setLines(prevLines);
      toast.error('No se pudo guardar el nuevo orden');
    }
  }, [organization, lines]);

  // ============= GLOBAL handlers (tab "General" en Mi Negocio) =============
  // Estos handlers NO miran currentSucursal y NUNCA tocan tablas *_sucursales ni RPCs de sucursal.
  // Escriben siempre sobre las tablas globales (servicios / extras / descuentos).

  const addServiceGlobal = useCallback(async (service: Omit<Service, 'id' | 'uid'>) => {
    if (!organization) {
      toast.error('No se pudo determinar la organización');
      return null;
    }
    try {
      const normalizedName = service.name.replace(/\s+/g, ' ').trim();
      const insertPayload: any = {
        nombre: normalizedName,
        precio: 0,
        duracion_min: service.durationMin || 30,
        activo: service.active !== false,
        linea_id: service.lineId || null,
        organization_id: organization.id,
        sucursal_id: null,
      };
      if (service.descripcion !== undefined) {
        const trimmed = (service.descripcion ?? '').trim();
        insertPayload.descripcion = trimmed ? trimmed : null;
      }
      const { data, error } = await supabase
        .from('servicios')
        .insert(insertPayload)
        .select()
        .single();
      if (error) throw error;
      const newService = dbToService(data, lines);
      setServices(prev => [...prev, newService]);
      toast.success('Servicio agregado');
      return newService;
    } catch (error) {
      console.error('Error adding service (global):', error);
      toast.error('Error al agregar servicio');
      return null;
    }
  }, [organization, lines]);

  const updateServiceGlobal = useCallback(async (id: string, updates: Partial<Service>) => {
    try {
      const dbUpdates: any = {};
      if (updates.name !== undefined) dbUpdates.nombre = updates.name.replace(/\s+/g, ' ').trim();
      if (updates.durationMin !== undefined) dbUpdates.duracion_min = updates.durationMin;
      if (updates.lineId !== undefined) dbUpdates.linea_id = updates.lineId || null;
      if (updates.active !== undefined) dbUpdates.activo = updates.active;
      if (updates.descripcion !== undefined) {
        const trimmed = (updates.descripcion ?? '').trim();
        dbUpdates.descripcion = trimmed ? trimmed : null;
      }

      if (Object.keys(dbUpdates).length === 0) return;

      const { error } = await supabase.from('servicios').update(dbUpdates).eq('id', id);
      if (error) throw error;

      const updatedLine = updates.lineId ? lines.find(l => l.id === updates.lineId) : undefined;
      setServices(prev => prev.map(s => {
        if (s.id !== id) return s;
        const merged: Service = { ...s };
        if (updates.name !== undefined) merged.name = dbUpdates.nombre;
        if (updates.durationMin !== undefined) merged.durationMin = updates.durationMin;
        if (updates.lineId !== undefined) {
          merged.lineId = updates.lineId || undefined;
          merged.lineName = updatedLine?.name;
        }
        if (updates.descripcion !== undefined) merged.descripcion = (updates.descripcion ?? '').trim() || undefined;
        if (updates.active !== undefined) {
          merged.globalActive = updates.active;
          const branchActive = merged.branchActive;
          merged.active = branchActive === undefined ? updates.active : (updates.active && branchActive);
        }
        return merged;
      }));
    } catch (error) {
      console.error('Error updating service (global):', error);
      toast.error('Error al actualizar servicio');
    }
  }, [lines]);

  const addExtraGlobal = useCallback(async (extra: Omit<Extra, 'id' | 'uid'>) => {
    if (!organization) {
      toast.error('No se pudo determinar la organización');
      return null;
    }
    try {
      const normalizedName = extra.name.replace(/\s+/g, ' ').trim();
      const { data, error } = await supabase
        .from('extras')
        .insert({
          nombre: normalizedName,
          precio: 0,
          activo: extra.active !== false,
          organization_id: organization.id,
          sucursal_id: null,
        })
        .select()
        .single();
      if (error) throw error;
      const newExtra = dbToExtra(data);
      setExtras(prev => [...prev, newExtra]);
      toast.success('Extra agregado');
      return newExtra;
    } catch (error) {
      console.error('Error adding extra (global):', error);
      toast.error('Error al agregar extra');
      return null;
    }
  }, [organization]);

  const updateExtraGlobal = useCallback(async (id: string, updates: Partial<Extra>) => {
    try {
      const dbUpdates: any = {};
      if (updates.name !== undefined) dbUpdates.nombre = updates.name.replace(/\s+/g, ' ').trim();
      if (updates.active !== undefined) dbUpdates.activo = updates.active;
      if (Object.keys(dbUpdates).length === 0) return;

      const { error } = await supabase.from('extras').update(dbUpdates).eq('id', id);
      if (error) throw error;

      setExtras(prev => prev.map(e => {
        if (e.id !== id) return e;
        const merged: Extra = { ...e };
        if (updates.name !== undefined) merged.name = dbUpdates.nombre;
        if (updates.active !== undefined) {
          merged.globalActive = updates.active;
          const branchActive = merged.branchActive;
          merged.active = branchActive === undefined ? updates.active : (updates.active && branchActive);
        }
        return merged;
      }));
    } catch (error) {
      console.error('Error updating extra (global):', error);
      toast.error('Error al actualizar extra');
    }
  }, []);

  const addDiscountGlobal = useCallback(async (discount: Omit<Discount, 'id'>) => {
    if (!organization) {
      toast.error('No se pudo determinar la organización');
      return null;
    }
    try {
      const appliesTo = discount.appliesTo || 'servicios';
      const { data, error } = await supabase
        .from('descuentos')
        .insert({
          nombre: discount.label.replace(/\s+/g, ' ').trim(),
          valor: discount.value,
          tipo: discount.type === 'fixed' ? 'monto' : 'porcentaje',
          redondeo: discount.rounding || 'cliente',
          redondeo_unidad: discount.roundingUnit || 100,
          metodo_pago: discount.paymentMethod || 'todos',
          activo: discount.active !== false,
          aplica_a: appliesTo,
          organization_id: organization.id,
        })
        .select()
        .single();
      if (error) throw error;
      const newDiscount = dbToDiscount(data);
      setDiscounts(prev => [...prev, newDiscount]);
      toast.success('Descuento agregado');
      return newDiscount;
    } catch (error) {
      console.error('Error adding discount (global):', error);
      toast.error('Error al agregar descuento');
      return null;
    }
  }, [organization]);

  const updateDiscountGlobal = useCallback(async (id: string, updates: Partial<Discount>) => {
    if (id === 'none') return;
    try {
      const dbUpdates: any = {};
      if (updates.label !== undefined) dbUpdates.nombre = updates.label.replace(/\s+/g, ' ').trim();
      if (updates.value !== undefined) dbUpdates.valor = updates.value;
      if (updates.type !== undefined) dbUpdates.tipo = updates.type === 'fixed' ? 'monto' : 'porcentaje';
      if (updates.rounding !== undefined) dbUpdates.redondeo = updates.rounding;
      if (updates.roundingUnit !== undefined) dbUpdates.redondeo_unidad = updates.roundingUnit;
      if (updates.paymentMethod !== undefined) dbUpdates.metodo_pago = updates.paymentMethod;
      if (updates.appliesTo !== undefined) dbUpdates.aplica_a = updates.appliesTo;
      if (updates.active !== undefined) dbUpdates.activo = updates.active;

      if (Object.keys(dbUpdates).length === 0) return;

      const { error } = await supabase.from('descuentos').update(dbUpdates).eq('id', id);
      if (error) throw error;

      setDiscounts(prev => prev.map(d => {
        if (d.id !== id) return d;
        const merged: Discount = { ...d, ...updates };
        if (updates.active !== undefined) {
          merged.globalActive = updates.active;
          const branchActive = merged.branchActive;
          merged.active = branchActive === undefined ? updates.active : (updates.active && branchActive);
        }
        return merged;
      }));
    } catch (error) {
      console.error('Error updating discount (global):', error);
      toast.error('Error al actualizar descuento');
    }
  }, []);

  const setDiscountActiveGlobal = useCallback(async (id: string, activo: boolean) => {
    if (id === 'none') return;
    try {
      const { error } = await supabase.from('descuentos').update({ activo }).eq('id', id);
      if (error) throw error;
      setDiscounts(prev => prev.map(d => {
        if (d.id !== id) return d;
        const branchActive = d.branchActive;
        return {
          ...d,
          globalActive: activo,
          active: branchActive === undefined ? activo : (activo && branchActive),
        };
      }));
      toast.success(activo ? 'Descuento reactivado' : 'Descuento desactivado');
    } catch (error) {
      console.error('Error toggling discount (global):', error);
      toast.error('Error al actualizar descuento');
    }
  }, []);

  const deleteDiscountGlobal = useCallback(async (id: string) => {
    if (id === 'none') return;
    const ok = await softDelete('descuentos', id);
    if (ok) {
      setDiscounts(prev => prev.filter(d => d.id !== id));
      toast.success('Descuento eliminado correctamente.');
    } else {
      toast.error('No se pudo eliminar el descuento');
    }
  }, [softDelete]);

  // Descuentos disponibles para Cobrar: solo estado operativo activo normalizado en dbToDiscount.
  const cobrarDiscounts = discounts.filter(d => d.active === true);
  const serviceDiscounts = cobrarDiscounts.filter(d => d.appliesTo === 'servicios');
  const productDiscounts = cobrarDiscounts.filter(d => d.appliesTo === 'productos');

  return {
    isLoading,
    error,
    blockingError,
    showBlockingLoader,
    refetch: fetchData,
    services: services.filter(s => s.active),
    allServices: services,
    extras: extras.filter(e => e.active),
    allExtras: extras,
    barbers: barbers.filter(b => b.active),
    allBarbers: barbers,
    discounts,
    cobrarDiscounts,
    serviceDiscounts,
    productDiscounts,
    lines: lines.filter(l => l.active),
    allLines: lines,
    addService,
    updateService,
    addExtra,
    updateExtra,
    addBarber,
    updateBarber,
    addDiscount,
    updateDiscount,
    deleteDiscount,
    setDiscountActive,
    addLine,
    updateLine,
    reorderLines,
    deleteService,
    deleteExtra,
    deleteLine,
    // Global handlers (tab General de Mi Negocio)
    addServiceGlobal,
    updateServiceGlobal,
    addExtraGlobal,
    updateExtraGlobal,
    addDiscountGlobal,
    updateDiscountGlobal,
    setDiscountActiveGlobal,
    deleteDiscountGlobal,
    refreshData: fetchData,
  };
}
