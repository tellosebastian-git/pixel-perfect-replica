import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowLeft, Plus, Repeat } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonRow } from '@/components/ui/SkeletonRow';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useDelayedVisible } from '@/hooks/useDelayedVisible';
import { useAuth } from '@/contexts/AuthContext';
import { useSucursal } from '@/contexts/SucursalContext';
import { useRequirePinForAction } from '@/components/ActionPinGate';
import type { TareaRecurrente, useTareasRecurrentes } from '@/hooks/useTareasRecurrentes';
import { CountdownConfirm } from '@/components/CountdownConfirm';
import { RecurrenteFila, type UltimaOcurrencia } from './RecurrenteFila';
import { ListaTareas } from './TareasSeccion';
import { TareasLoadError } from './TareasLoadError';

interface Props {
  recurrentes: ReturnType<typeof useTareasRecurrentes>;
  today: string;
  onVolver: () => void;
  /** Abre el formulario compartido directamente en modo Tarea automática. */
  onNueva?: () => void;
  onEditar: (receta: TareaRecurrente) => void;
  /** Tarea automática a mostrar (desde "Ver Tarea automática" de una tarea). */
  focoId?: string | null;
  ultimaOcurrencia?: (recurrenciaId: string) => UltimaOcurrencia | null;
}

/**
 * Tareas → Tareas automáticas: subvista de configuración. Las automáticas generan tareas comunes en la
 * lista de Tareas; acá se crean, se pausan, se editan y se eliminan.
 */
export function RecurrentesPanel({ recurrentes, today, onVolver, onNueva, onEditar, focoId, ultimaOcurrencia }: Props) {
  const { isOwner, isGeneralManager, isManager, isSucursalAccount } = useAuth();
  const { currentSucursal, sucursales } = useSucursal();
  const requirePinForAction = useRequirePinForAction();
  const { recetas, hasData, isLoading, error, refetch, isFetching, toggleActivo, deleteReceta } = recurrentes;
  const showSkeleton = useDelayedVisible(isLoading && !hasData);

  const canManageTareas = isOwner || isGeneralManager || isManager;
  const puedeGestionar = canManageTareas || isSucursalAccount;
  const multiSucursal = !currentSucursal && sucursales.length > 1;

  const foco = focoId ? recetas.find(r => r.id === focoId) : undefined;
  const [segmento, setSegmento] = useState<'active' | 'inactive'>(foco && !foco.activo ? 'inactive' : 'active');
  const [filtroSucursal, setFiltroSucursal] = useState('todas');
  const [confirmarEliminar, setConfirmarEliminar] = useState<TareaRecurrente | null>(null);

  useEffect(() => {
    if (!foco) return;
    setSegmento(foco.activo ? 'active' : 'inactive');
    setFiltroSucursal('todas');
    requestAnimationFrame(() => document.getElementById(`automatica-${foco.id}`)?.scrollIntoView({ block: 'center' }));
  }, [foco?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const sucursalesConAutomaticas = useMemo(() => new Set(recetas.map(r => r.sucursal_id)), [recetas]);
  // El filtro de sucursal solo aporta si el contexto abarca varias y hay automáticas en más de una.
  const muestraFiltro = multiSucursal && sucursalesConAutomaticas.size > 1;
  const visibles = recetas.filter(r => !muestraFiltro || filtroSucursal === 'todas' || r.sucursal_id === filtroSucursal);
  const activas = visibles.filter(r => r.activo);
  const pausadas = visibles.filter(r => !r.activo);
  const lista = segmento === 'active' ? activas : pausadas;
  const sucursalNombre = (id: string) => (multiSucursal ? sucursales.find(s => s.id === id)?.nombre ?? null : null);

  const conPin = async (receta: TareaRecurrente, run: () => void) => {
    if (isSucursalAccount) {
      const gate = await requirePinForAction('editar_tarea', receta.sucursal_id ?? null);
      if (gate.ok !== true) return;
    }
    run();
  };

  const cabecera = (
    <div className="space-y-3">
      <Button type="button" variant="ghost" size="sm" className="-ml-2 text-muted-foreground" onClick={onVolver}>
        <ArrowLeft aria-hidden />Volver a Tareas
      </Button>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 className="text-lg font-medium text-foreground">Tareas automáticas</h2>
          <p className="text-sm text-muted-foreground">Configuralas una vez y Vittro crea cada tarea en su fecha.</p>
        </div>
        {onNueva && <Button type="button" onClick={onNueva}><Plus aria-hidden />Nueva Tarea automática</Button>}
      </div>
    </div>
  );

  let contenido: ReactNode;
  if (isLoading && !hasData) {
    contenido = showSkeleton ? (
      <ListaTareas>
        {Array.from({ length: 4 }).map((_, i) => <li key={i} className="px-3 py-3 sm:px-4"><SkeletonRow /></li>)}
      </ListaTareas>
    ) : null;
  } else if (error && !hasData) {
    contenido = <TareasLoadError subject="las Tareas automáticas" retry={refetch} pending={isFetching} />;
  } else if (recetas.length === 0) {
    contenido = (
      <div className="rounded-xl border border-border bg-card py-12 shadow-sm">
        <EmptyState icon={Repeat} title="Todavía no hay Tareas automáticas"
          description="Configurala una vez y Vittro la vuelve a crear en cada fecha: la limpieza del local, la reposición de insumos o el cierre del día."
          action={onNueva ? <Button type="button" onClick={onNueva}><Plus aria-hidden />Nueva Tarea automática</Button> : undefined} />
      </div>
    );
  } else {
    contenido = (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedControl ariaLabel="Estado de las Tareas automáticas" className="sm:max-w-xs" value={segmento}
            onChange={v => setSegmento(v as 'active' | 'inactive')}
            options={[{ value: 'active', label: 'Activas', count: activas.length }, { value: 'inactive', label: 'Pausadas', count: pausadas.length }]} />
          {muestraFiltro && (
            <Select value={filtroSucursal} onValueChange={setFiltroSucursal}>
              <SelectTrigger className="h-9 w-full sm:w-[12rem]" aria-label="Sucursal"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas las sucursales</SelectItem>
                {sucursales.filter(s => sucursalesConAutomaticas.has(s.id)).map(s => <SelectItem key={s.id} value={s.id}>{s.nombre}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
        </div>
        <div role="tabpanel" aria-label={segmento === 'active' ? 'Tareas automáticas activas' : 'Tareas automáticas pausadas'}>
          {lista.length === 0 ? (
            <p className="px-1 py-2 text-sm text-muted-foreground">
              {segmento === 'active' ? 'No hay Tareas automáticas activas.' : 'No hay Tareas automáticas pausadas.'}
            </p>
          ) : (
            <ListaTareas>
              {lista.map(r => (
                <RecurrenteFila key={r.id} receta={r} today={today} sucursalNombre={sucursalNombre(r.sucursal_id)} ultima={ultimaOcurrencia?.(r.id)}
                  puedeGestionar={puedeGestionar} puedeEliminar={canManageTareas} destacada={r.id === focoId}
                  alternando={toggleActivo.isPending && toggleActivo.variables?.id === r.id}
                  onEditar={() => void conPin(r, () => onEditar(r))}
                  onAlternar={() => void conPin(r, () => toggleActivo.mutate({ id: r.id, activo: !r.activo }))}
                  onEliminar={() => setConfirmarEliminar(r)} />
              ))}
            </ListaTareas>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {cabecera}
      {contenido}
      <CountdownConfirm
        open={!!confirmarEliminar}
        onOpenChange={open => { if (!open) setConfirmarEliminar(null); }}
        onConfirm={() => { if (confirmarEliminar) deleteReceta.mutate(confirmarEliminar.id); setConfirmarEliminar(null); }}
        title={`Eliminar «${confirmarEliminar?.titulo ?? 'Tarea automática'}»`}
        description="Vittro deja de crear esta tarea. Si hoy ya creó la tarea del día y sigue pendiente, también se elimina. Las tareas de días anteriores, las iniciadas y las completadas se conservan. No se puede deshacer."
      />
    </div>
  );
}
