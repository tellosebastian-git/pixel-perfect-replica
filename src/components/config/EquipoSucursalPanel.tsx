import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Trash2, Calendar as CalendarIcon, AlertTriangle, Repeat, MapPin, CalendarCheck, UserX, ChevronDown, MoreVertical, User, Phone, Mail, Percent } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SkeletonRow } from '@/components/ui/SkeletonRow';
import { useDelayedVisible } from '@/hooks/useDelayedVisible';
import { CatalogSectionCard } from '@/components/ui/CatalogSectionCard';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DrawerForm } from '@/components/ui/drawer-form';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  useBarberosSucursales,
  pickVigenteHoy,
  todayLocalIso,
  type BarberoSucursalRow,
} from '@/hooks/useBarberosSucursales';
import { WeekdayPicker, formatDiasSemana } from './WeekdayPicker';
import { useBarberosSucursalesRealtime } from '@/hooks/useBarberosSucursalesRealtime';

interface Props {
  sucursalId: string;
  sucursalNombre: string;
  organizationId: string;
  /** Id de barbero a resaltar al montar (navegación desde Equipo General). */
  highlightBarberoId?: string;
}

interface BarberoMini {
  id: string;
  nombre: string;
  apellido: string;
  rol_equipo: string | null;
  activo: boolean;
  telefono: string | null;
  comision: number;
  access_email: string | null;
}

const ROLE_LABELS: Record<string, string> = {
  owner: 'Dueño',
  general_manager: 'Encargado General',
  manager: 'Encargado de Sucursal',
  barbero: 'Barbero',
  otros: 'Otros',
};

/**
 * Panel de "Equipo de la sucursal" — solo gestiona disponibilidad operativa.
 * NO administra payroll, cargos, acceso, ni PIN (eso vive en Equipo General).
 */
export function EquipoSucursalPanel({ sucursalId, sucursalNombre, organizationId, highlightBarberoId }: Props) {
  const { isOwner, isGeneralManager, isManager } = useAuth();
  const canCreateRecurrente = isOwner || isGeneralManager;
  const canCreateTemporal = isOwner || isGeneralManager || isManager;
  const canDeleteRecurrente = isOwner || isGeneralManager;

  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const flagKey = `vittro:miNegocio:highlightBarbero:${organizationId}`;
    let stored: string | null = null;
    try { stored = localStorage.getItem(flagKey); } catch { /* ignore */ }
    const effectiveId = stored || highlightBarberoId || null;
    if (!effectiveId) return;

    if (stored) {
      try { localStorage.removeItem(flagKey); } catch { /* ignore */ }
    }
    setHighlightedId(effectiveId);

    const el = document.querySelector('[data-onboarding-id="equipo-section"]');
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });

    highlightTimeoutRef.current = setTimeout(() => setHighlightedId(null), 2000);
    return () => {
      if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
    };
  }, [organizationId, highlightBarberoId]);

  const bs = useBarberosSucursales(organizationId);

  const [loading, setLoading] = useState(true);
  const showSkeleton = useDelayedVisible(loading);
  const [rows, setRows] = useState<BarberoSucursalRow[]>([]);
  const [barberos, setBarberos] = useState<Record<string, BarberoMini>>({});

  const fetchAll = useCallback(async () => {
    if (!organizationId || !sucursalId) return;
    setLoading(true);
    try {
      const list = await bs.listBySucursal(sucursalId);
      setRows(list);
      const ids = Array.from(new Set(list.map(r => r.barbero_id)));
      if (ids.length > 0) {
        const { data, error } = await supabase
          .from('barberos')
          .select('id, nombre, apellido, rol_equipo, activo, telefono, comision, access_email')
          .eq('organization_id', organizationId)
          .eq('activo', true)
          .in('id', ids);
        if (error) throw error;
        const map: Record<string, BarberoMini> = {};
        (data ?? []).forEach((b: any) => { map[b.id] = b as BarberoMini; });
        setBarberos(map);
      } else {
        setBarberos({});
      }

    } catch (e: any) {
      console.error('EquipoSucursalPanel fetch error', e);
      toast.error('No se pudo cargar el equipo de la sucursal');
    } finally {
      setLoading(false);
    }
  }, [bs, organizationId, sucursalId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Realtime: invalidar cuando cambia disponibilidad en esta sucursal.
  useBarberosSucursalesRealtime({
    orgId: organizationId,
    sucursalId,
    onChange: () => { void fetchAll(); },
  });

  // Agrupar filas por barbero.
  const grouped = useMemo(() => {
    const g: Record<string, BarberoSucursalRow[]> = {};
    for (const r of rows) {
      (g[r.barbero_id] ??= []).push(r);
    }
    return g;
  }, [rows]);

  const orderedBarberoIds = useMemo(() => {
    return Object.keys(grouped)
      .filter(id => barberos[id])
      .sort((a, b) => {
        const A = barberos[a], B = barberos[b];
        return `${A.nombre} ${A.apellido}`.localeCompare(`${B.nombre} ${B.apellido}`);
      });
  }, [grouped, barberos]);

  // --- Sub-tab Activos/Inactivos ---
  const [activeSubTab, setActiveSubTab] = useState<'active' | 'inactive'>('active');

  const isActivoBarbero = (list: BarberoSucursalRow[]) => {
    const v = pickVigenteHoy(list);
    return !!v && v.disponible;
  };
  const activeIds = useMemo(
    () => orderedBarberoIds.filter(id => isActivoBarbero(grouped[id] ?? [])),
    [orderedBarberoIds, grouped]
  );
  const inactiveIds = useMemo(
    () => orderedBarberoIds.filter(id => !isActivoBarbero(grouped[id] ?? [])),
    [orderedBarberoIds, grouped]
  );

  // --- Desactivar (set disponible = false sobre la fila vigente) ---
  const [deactivateTarget, setDeactivateTarget] = useState<{ barbero: BarberoMini; row: BarberoSucursalRow } | null>(null);
  const [deactivateFutureCount, setDeactivateFutureCount] = useState<number | null>(null);
  const [deactivating, setDeactivating] = useState(false);

  // --- Activar: abre Sheet con barbero preseleccionado ---
  const [activateBarberoId, setActivateBarberoId] = useState<string | null>(null);
  const [activatingId, setActivatingId] = useState<string | null>(null);
  const [drawerBarberoId, setDrawerBarberoId] = useState<string | null>(null);

  const activatePrincipal = async (row: BarberoSucursalRow) => {
    setActivatingId(row.id);
    try {
      await bs.setDisponible(row.id, true);
      toast.success('Barbero activado en esta sucursal');
      await fetchAll();
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo activar');
    } finally {
      setActivatingId(null);
    }
  };

  const openDeactivate = async (barbero: BarberoMini, row: BarberoSucursalRow) => {
    setDeactivateTarget({ barbero, row });
    setDeactivateFutureCount(null);
    try {
      const today = todayLocalIso();
      const { count, error } = await supabase
        .from('turnos')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .eq('sucursal_id', sucursalId)
        .eq('barbero_id', row.barbero_id)
        .gte('fecha', today);
      if (error) setDeactivateFutureCount(0);
      else setDeactivateFutureCount(count ?? 0);
    } catch {
      setDeactivateFutureCount(0);
    }
  };

  const confirmDeactivate = async () => {
    if (!deactivateTarget) return;
    setDeactivating(true);
    try {
      await bs.setDisponible(deactivateTarget.row.id, false);
      toast.success('Barbero desactivado en esta sucursal');
      setDeactivateTarget(null);
      await fetchAll();
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo desactivar');
    } finally {
      setDeactivating(false);
    }
  };

  const renderBarberoCard = (barberoId: string, isActive: boolean) => {
    const list = grouped[barberoId] ?? [];
    const barbero = barberos[barberoId];
    const vigente = pickVigenteHoy(list);
    const principal = list.find(r => r.tipo === 'principal');
    const temporales = list.filter(r => r.tipo === 'temporal');
    const recurrentes = list.filter(r => r.tipo === 'recurrente');
    const role = barbero?.rol_equipo ? ROLE_LABELS[barbero.rol_equipo] ?? barbero.rol_equipo : null;

    return (
      <div
        key={barberoId}
        className={cn(
          "rounded-lg border border-border bg-muted/20 p-4 transition-shadow duration-highlight",
          highlightedId === barberoId && "ring-2 ring-primary/40"
        )}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-foreground">
                {barbero?.nombre} {barbero?.apellido}
              </span>
              {role && (
                <Badge variant="outline" className="text-xs">{role}</Badge>
              )}
              {vigente ? (
                <Badge variant="secondary" className="text-xs">
                  {vigente.tipo === 'principal' && 'Principal'}
                  {vigente.tipo === 'recurrente' && `Recurrente (${formatDiasSemana(vigente.dias_semana)})`}
                  {vigente.tipo === 'temporal' && `Temporal hasta ${formatShortDate(vigente.fecha_fin)}`}
                </Badge>
              ) : (
                <Badge variant="outline" className="text-xs text-muted-foreground">Sin asignación vigente hoy</Badge>
              )}
            </div>
          </div>
          <div className="self-start">
            <button
              onClick={() => setDrawerBarberoId(barberoId)}
              className="flex h-7 w-7 items-center justify-center rounded-md bg-transparent hover:bg-muted transition-colors border-[0.5px] border-border"
              title="Opciones"
            >
              <MoreVertical className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
        </div>

        {/* Detalle de asignaciones */}
        <div className="mt-3 space-y-1.5 text-xs text-muted-foreground">
          {principal && (
            <div className="flex items-center justify-between gap-2">
              <span>Principal de esta sucursal.</span>
            </div>
          )}
          {recurrentes.map(r => (
            <div key={r.id} className="flex items-center justify-between gap-2">
              <span>
                Recurrente · {formatDiasSemana(r.dias_semana)}
                {r.fecha_inicio && ` · desde ${formatShortDate(r.fecha_inicio)}`}
                {r.fecha_fin && ` · hasta ${formatShortDate(r.fecha_fin)}`}
              </span>
              {canDeleteRecurrente && (
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openDelete(r)}>
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              )}
            </div>
          ))}
          {temporales.map(r => (
            <div key={r.id} className="flex items-center justify-between gap-2">
              <span>
                Temporal · {formatShortDate(r.fecha_inicio)} → {formatShortDate(r.fecha_fin)}
              </span>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openDelete(r)}>
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </div>
          ))}
        </div>

        <p className="mt-2 text-[11px] text-muted-foreground">
          Se recalcula cada noche automáticamente según las asignaciones.
        </p>
      </div>
    );
  };

  // Computed values for the barbero info drawer
  const drawerBarbero = drawerBarberoId ? barberos[drawerBarberoId] : undefined;
  const drawerList = drawerBarberoId ? (grouped[drawerBarberoId] ?? []) : [];
  const drawerVigente = drawerBarberoId ? pickVigenteHoy(drawerList) : null;
  const drawerPrincipal = drawerList.find(r => r.tipo === 'principal');
  const drawerIsActive = drawerBarberoId ? isActivoBarbero(drawerList) : false;
  const drawerRole = drawerBarbero?.rol_equipo ? ROLE_LABELS[drawerBarbero.rol_equipo] ?? drawerBarbero.rol_equipo : null;

  // --- Sheets / dialogs ---
  const [temporalOpen, setTemporalOpen] = useState(false);
  const [recurrenteOpen, setRecurrenteOpen] = useState(false);

  // --- Delete confirmation (con check de turnos futuros) ---
  const [deleteTarget, setDeleteTarget] = useState<BarberoSucursalRow | null>(null);
  const [deleteFutureCount, setDeleteFutureCount] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  const openDelete = async (row: BarberoSucursalRow) => {
    setDeleteTarget(row);
    setDeleteFutureCount(null);
    // Chequear turnos futuros del barbero en esta sucursal.
    try {
      const today = todayLocalIso();
      const { count, error } = await supabase
        .from('turnos')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .eq('sucursal_id', sucursalId)
        .eq('barbero_id', row.barbero_id)
        .gte('fecha', today);
      if (error) {
        setDeleteFutureCount(0);
      } else {
        setDeleteFutureCount(count ?? 0);
      }
    } catch {
      setDeleteFutureCount(0);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await bs.deleteRow(deleteTarget.id);
      toast.success('Asignación eliminada');
      setDeleteTarget(null);
      await fetchAll();
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo eliminar');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <CatalogSectionCard
        icon={CalendarCheck}
        title="Disponibilidad del equipo"
        description="Quién está disponible hoy y asignaciones temporales o automáticas."
      >
        {loading ? (
          showSkeleton ? (
            <div className="space-y-2">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="p-3 rounded-lg bg-muted/30">
                  <SkeletonRow />
                </div>
              ))}
            </div>
          ) : null
        ) : orderedBarberoIds.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-center">
            <MapPin className="h-5 w-5 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">
              Todavía no hay miembros asignados a esta sucursal.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Asigná un miembro desde <span className="font-medium">Mi Negocio › General › Equipo</span> o creá una asignación temporal/recurrente.
            </p>
          </div>
        ) : (
          <>
            <SegmentedControl
              options={[
                { value: 'active', label: 'Activos', count: activeIds.length },
                { value: 'inactive', label: 'Inactivos', count: inactiveIds.length },
              ]}
              value={activeSubTab}
              onChange={(v) => setActiveSubTab(v as 'active' | 'inactive')}
            />
            <div className="space-y-3" role="tabpanel">
              {activeSubTab === 'active' && (
                activeIds.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border p-6 text-center">
                    <p className="text-sm text-muted-foreground">No hay miembros activos en esta sucursal hoy.</p>
                  </div>
                ) : (
                  activeIds.map(id => renderBarberoCard(id, true))
                )
              )}
              {activeSubTab === 'inactive' && (
                inactiveIds.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border p-6 text-center">
                    <p className="text-sm text-muted-foreground">No hay miembros inactivos en esta sucursal.</p>
                  </div>
                ) : (
                  inactiveIds.map(id => renderBarberoCard(id, false))
                )
              )}
            </div>
          </>
        )}
      </CatalogSectionCard>


      {/* Sheets */}
      <TemporalSheet
        open={temporalOpen}
        onOpenChange={(o) => { setTemporalOpen(o); if (!o) setActivateBarberoId(null); }}
        organizationId={organizationId}
        sucursalId={sucursalId}
        initialBarberoId={activateBarberoId ?? undefined}
        onCreated={async () => { setDrawerBarberoId(null); await fetchAll(); }}
      />
      {canCreateRecurrente && (
        <RecurrenteSheet
          open={recurrenteOpen}
          onOpenChange={(o) => { setRecurrenteOpen(o); if (!o) setActivateBarberoId(null); }}
          organizationId={organizationId}
          sucursalId={sucursalId}
          initialBarberoId={activateBarberoId ?? undefined}
          onCreated={async () => { setDrawerBarberoId(null); await fetchAll(); }}
        />
      )}

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              {deleteFutureCount != null && deleteFutureCount > 0 && (
                <AlertTriangle className="h-4 w-4 text-status-warning" />
              )}
              Eliminar asignación
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteFutureCount == null
                ? 'Verificando turnos futuros…'
                : deleteFutureCount > 0
                  ? `Este barbero tiene ${deleteFutureCount} turno${deleteFutureCount === 1 ? '' : 's'} futuro${deleteFutureCount === 1 ? '' : 's'} en esta sucursal. Si eliminás esta asignación, esos turnos pueden quedar sin barbero disponible. ¿Querés continuar?`
                  : 'No hay turnos futuros que dependan de esta asignación. ¿Confirmás eliminar?'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} disabled={deleting || deleteFutureCount == null} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleting ? 'Eliminando…' : 'Eliminar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Desactivar confirm */}
      <AlertDialog open={!!deactivateTarget} onOpenChange={(o) => { if (!o && !deactivating) setDeactivateTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <UserX className="h-4 w-4 text-destructive" />
              Desactivar de la sucursal
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm text-muted-foreground">
                <p>
                  {deactivateTarget && (
                    <>
                      Vas a desactivar a{' '}
                      <strong className="text-foreground">
                        {deactivateTarget.barbero.nombre} {deactivateTarget.barbero.apellido}
                      </strong>
                      {' '}en esta sucursal. Dejará de aparecer como disponible para recibir turnos hasta que lo actives de nuevo.
                    </>
                  )}
                </p>
                {deactivateFutureCount == null ? (
                  <p className="text-xs">Verificando turnos futuros…</p>
                ) : deactivateFutureCount > 0 ? (
                  <div className="flex items-start gap-2 rounded-md border border-status-warning/40 bg-status-warning/10 p-2 text-xs text-foreground">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-status-warning" />
                    <span>
                      Tiene <strong>{deactivateFutureCount}</strong> turno{deactivateFutureCount === 1 ? '' : 's'} futuro{deactivateFutureCount === 1 ? '' : 's'} en esta sucursal. Esos turnos pueden quedar sin barbero disponible.
                    </span>
                  </div>
                ) : null}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deactivating}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeactivate} disabled={deactivating || deactivateFutureCount == null} className="bg-status-warning text-white hover:bg-status-warning/90">
              {deactivating ? 'Desactivando…' : 'Desactivar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {/* Barbero info drawer */}
      <DrawerForm
        open={drawerBarberoId !== null}
        onOpenChange={(o) => { if (!o) setDrawerBarberoId(null); }}
        title={drawerBarbero ? `${drawerBarbero.nombre} ${drawerBarbero.apellido}` : ''}
        size="sm"
        footer={
          <div className="flex w-full justify-between">
            <Button variant="ghost" onClick={() => setDrawerBarberoId(null)}>Cerrar</Button>
            {drawerIsActive && drawerVigente && drawerBarbero ? (
              <Button
                variant="ghost"
                className="bg-status-warning text-white hover:bg-status-warning/90"
                onClick={() => {
                  void openDeactivate(drawerBarbero!, drawerVigente!);
                  setDrawerBarberoId(null);
                }}
              >
                Desactivar
              </Button>
            ) : !drawerIsActive && drawerPrincipal && drawerPrincipal.sucursal_id === sucursalId ? (
              <Button
                disabled={activatingId === drawerPrincipal.id}
                onClick={() => {
                  void activatePrincipal(drawerPrincipal!);
                  setDrawerBarberoId(null);
                }}
              >
                Activar
              </Button>
            ) : !drawerIsActive && (canCreateTemporal || canCreateRecurrente) ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    Activar <ChevronDown className="h-3.5 w-3.5 ml-1" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {canCreateTemporal && (
                    <DropdownMenuItem onClick={() => {
                      setActivateBarberoId(drawerBarberoId!);
                      setTemporalOpen(true);
                      setDrawerBarberoId(null);
                    }}>
                      <CalendarIcon className="h-4 w-4 mr-2" /> Asignación temporal
                    </DropdownMenuItem>
                  )}
                  {canCreateRecurrente && (
                    <DropdownMenuItem onClick={() => {
                      setActivateBarberoId(drawerBarberoId!);
                      setRecurrenteOpen(true);
                      setDrawerBarberoId(null);
                    }}>
                      <Repeat className="h-4 w-4 mr-2" /> Asignación automática
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        }
      >
        <div className="space-y-5">
          {/* Context card — rol + estado; el nombre está en el título del drawer */}
          <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <User className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                {drawerRole && (
                  <span className="text-sm font-medium text-foreground">{drawerRole}</span>
                )}
                {drawerIsActive ? (
                  <span className="inline-flex items-center gap-1.5 text-xs text-status-success-foreground">
                    <span className="h-1.5 w-1.5 rounded-full bg-status-success" />
                    Activo
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
                    Inactivo
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Campos de contacto — filas horizontales */}
          <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            <div className="flex items-center gap-3 px-3 py-2.5">
              <Phone className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="flex-1 text-sm text-muted-foreground">Teléfono</span>
              <span className="text-sm text-foreground">{drawerBarbero?.telefono ?? '—'}</span>
            </div>
            <div className="flex items-center gap-3 px-3 py-2.5">
              <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="flex-1 text-sm text-muted-foreground">Email</span>
              <span className="max-w-[180px] truncate text-sm text-foreground">
                {drawerBarbero?.access_email ?? '—'}
              </span>
            </div>
            <div className="flex items-center gap-3 px-3 py-2.5">
              <Percent className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="flex-1 text-sm text-muted-foreground">Comisión</span>
              <span className="text-sm text-foreground">
                {drawerBarbero?.comision != null ? `${drawerBarbero.comision}%` : '—'}
              </span>
            </div>
          </div>

          {/* Asignación vigente */}
          <div className="space-y-1.5 border-t border-border pt-4">
            <p className="text-xs font-medium text-muted-foreground">Asignación vigente</p>
            {drawerVigente ? (
              <Badge variant="secondary" className="text-xs">
                {drawerVigente.tipo === 'principal' && 'Principal'}
                {drawerVigente.tipo === 'recurrente' && `Recurrente (${formatDiasSemana(drawerVigente.dias_semana)})`}
                {drawerVigente.tipo === 'temporal' && `Temporal hasta ${formatShortDate(drawerVigente.fecha_fin)}`}
              </Badge>
            ) : (
              <Badge variant="outline" className="text-xs text-muted-foreground">Sin asignación vigente hoy</Badge>
            )}
          </div>
        </div>
      </DrawerForm>
    </>

  );
}

function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}`;
}

// =========================================================================
//  Sheets para crear temporal / recurrente
// =========================================================================

interface SheetBaseProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  organizationId: string;
  sucursalId: string;
  onCreated: () => void | Promise<void>;
  initialBarberoId?: string;

}

const temporalSchema = z.object({
  barberoId: z.string().min(1, 'Elegí un barbero.'),
  fechaInicio: z.string().min(1, 'Elegí la fecha de inicio.'),
  fechaFin: z.string().min(1, 'Elegí la fecha de fin.'),
}).superRefine((data, ctx) => {
  if (data.fechaInicio && data.fechaFin && data.fechaFin < data.fechaInicio) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['fechaFin'], message: 'No puede ser anterior a la fecha de inicio.' });
  }
});
type TemporalFormValues = z.infer<typeof temporalSchema>;

function TemporalSheet({ open, onOpenChange, organizationId, sucursalId, initialBarberoId, onCreated }: SheetBaseProps) {
  const bs = useBarberosSucursales(organizationId);
  const [barberos, setBarberos] = useState<BarberoMini[]>([]);

  const form = useForm<TemporalFormValues>({
    resolver: zodResolver(temporalSchema),
    defaultValues: { barberoId: initialBarberoId ?? '', fechaInicio: todayLocalIso(), fechaFin: '' },
  });
  const saving = form.formState.isSubmitting;
  const fechaInicioWatch = form.watch('fechaInicio');

  useEffect(() => {
    if (!open) return;
    form.reset({ barberoId: initialBarberoId ?? '', fechaInicio: todayLocalIso(), fechaFin: '' });
    (async () => {
      const { data } = await supabase
        .from('barberos')
        .select('id, nombre, apellido, rol_equipo, activo')
        .eq('organization_id', organizationId)
        .eq('activo', true)
        .order('nombre');
      setBarberos((data ?? []) as BarberoMini[]);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, organizationId, initialBarberoId]);

  const handleClose = () => {
    onOpenChange(false);
    form.reset({ barberoId: initialBarberoId ?? '', fechaInicio: todayLocalIso(), fechaFin: '' });
  };

  const onSubmit = async (values: TemporalFormValues) => {
    try {
      await bs.insertTemporal({
        barbero_id: values.barberoId,
        sucursal_id: sucursalId,
        fecha_inicio: values.fechaInicio,
        fecha_fin: values.fechaFin,
      });
      toast.success('Asignación temporal creada');
      handleClose();
      await onCreated();
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo crear la asignación');
    }
  };

  return (
    <DrawerForm
      open={open}
      onOpenChange={(o) => { if (!o) handleClose(); }}
      title="Asignación temporal"
      size="sm"
      isDirty={form.formState.isDirty}
      footer={
        <div className="flex w-full justify-between">
          <Button variant="ghost" disabled={saving} onClick={handleClose}>
            Cancelar
          </Button>
          <Button disabled={saving} onClick={form.handleSubmit(onSubmit)}>
            {saving ? 'Guardando...' : 'Crear asignación'}
          </Button>
        </div>
      }
    >
      <Form {...form}>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Asigná a un barbero a esta sucursal por un período concreto. Al vencer, vuelve solo a su principal.
          </p>
          <FormField
            control={form.control}
            name="barberoId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Barbero</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger><SelectValue placeholder="Elegí un barbero" /></SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {barberos.length === 0 ? (
                      <SelectItem value="__empty__" disabled>Sin barberos disponibles</SelectItem>
                    ) : (
                      barberos.map(b => (
                        <SelectItem key={b.id} value={b.id}>{b.nombre} {b.apellido}</SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="grid grid-cols-2 gap-3">
            <FormField
              control={form.control}
              name="fechaInicio"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Desde</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="fechaFin"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Hasta</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} min={fechaInicioWatch} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>
      </Form>
    </DrawerForm>
  );
}

const recurrenteSchema = z.object({
  barberoId: z.string().min(1, 'Elegí un barbero.'),
  dias: z.array(z.number()).min(1, 'Elegí al menos un día de la semana.'),
  fechaInicio: z.string().optional().default(''),
  fechaFin: z.string().optional().default(''),
}).superRefine((data, ctx) => {
  if (data.fechaInicio && data.fechaFin && data.fechaFin < data.fechaInicio) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['fechaFin'], message: 'No puede ser anterior a la fecha de inicio.' });
  }
});
type RecurrenteFormValues = z.infer<typeof recurrenteSchema>;

function RecurrenteSheet({ open, onOpenChange, organizationId, sucursalId, initialBarberoId, onCreated }: SheetBaseProps) {
  const bs = useBarberosSucursales(organizationId);
  const [barberos, setBarberos] = useState<BarberoMini[]>([]);

  const defaults = (): RecurrenteFormValues => ({ barberoId: initialBarberoId ?? '', dias: [], fechaInicio: '', fechaFin: '' });
  const form = useForm<RecurrenteFormValues>({
    resolver: zodResolver(recurrenteSchema),
    defaultValues: defaults(),
  });
  const saving = form.formState.isSubmitting;
  const fechaInicioWatch = form.watch('fechaInicio');

  useEffect(() => {
    if (!open) return;
    form.reset(defaults());
    (async () => {
      const { data } = await supabase
        .from('barberos')
        .select('id, nombre, apellido, rol_equipo, activo')
        .eq('organization_id', organizationId)
        .eq('activo', true)
        .order('nombre');
      setBarberos((data ?? []) as BarberoMini[]);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, organizationId, initialBarberoId]);

  const handleClose = () => {
    onOpenChange(false);
    form.reset(defaults());
  };

  const onSubmit = async (values: RecurrenteFormValues) => {
    try {
      await bs.insertRecurrente({
        barbero_id: values.barberoId,
        sucursal_id: sucursalId,
        dias_semana: values.dias,
        fecha_inicio: values.fechaInicio || null,
        fecha_fin: values.fechaFin || null,
      });
      toast.success('Asignación recurrente creada');
      handleClose();
      await onCreated();
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo crear la asignación');
    }
  };

  return (
    <DrawerForm
      open={open}
      onOpenChange={(o) => { if (!o) handleClose(); }}
      title="Asignación recurrente"
      size="sm"
      isDirty={form.formState.isDirty}
      footer={
        <div className="flex w-full justify-between">
          <Button variant="ghost" disabled={saving} onClick={handleClose}>
            Cancelar
          </Button>
          <Button disabled={saving} onClick={form.handleSubmit(onSubmit)}>
            {saving ? 'Guardando...' : 'Crear asignación'}
          </Button>
        </div>
      }
    >
      <Form {...form}>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Asigná un barbero a esta sucursal en días fijos de la semana. Sin componente horario.
          </p>
          <FormField
            control={form.control}
            name="barberoId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Barbero</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger><SelectValue placeholder="Elegí un barbero" /></SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {barberos.length === 0 ? (
                      <SelectItem value="__empty__" disabled>Sin barberos disponibles</SelectItem>
                    ) : (
                      barberos.map(b => (
                        <SelectItem key={b.id} value={b.id}>{b.nombre} {b.apellido}</SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="dias"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Días de la semana</FormLabel>
                <WeekdayPicker value={field.value} onChange={field.onChange} />
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="grid grid-cols-2 gap-3">
            <FormField
              control={form.control}
              name="fechaInicio"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs text-muted-foreground">Desde (opcional)</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="fechaFin"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs text-muted-foreground">Hasta (opcional)</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} min={fechaInicioWatch || undefined} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>
      </Form>
    </DrawerForm>
  );
}
