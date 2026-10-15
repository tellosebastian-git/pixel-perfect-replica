import { useState, type ReactNode } from 'react';
import { ArrowLeft, CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SkeletonRow } from '@/components/ui/SkeletonRow';
import { useDelayedVisible } from '@/hooks/useDelayedVisible';
import { useTareasHistorial } from '@/hooks/useTareasHistorial';
import type { Tarea } from '@/hooks/useTareas';
import { TareaFila, type AccionMenu } from './TareaFila';
import { ListaTareas } from './TareasSeccion';
import { TareasFiltros, type OpcionFiltro } from './TareasFiltros';
import { TareasLoadError } from './TareasLoadError';

interface Props {
  onVolver: () => void;
  /** `null` = sin filtros (barbero, cuenta de sucursal). */
  filtros: { responsables: OpcionFiltro[]; sucursales: OpcionFiltro[] | null } | null;
  metaDe: (t: Tarea) => ReactNode[];
  menuDe: (t: Tarea) => AccionMenu[];
  onAbrir: (t: Tarea) => void;
}

/** Tareas → Historial: completadas, de la más reciente a la más antigua, 50 por página y solo al abrirlo. */
export function TareasHistorial({ onVolver, filtros, metaDe, menuDe, onAbrir }: Props) {
  const [responsable, setResponsable] = useState('todos');
  const [sucursal, setSucursal] = useState('todas');
  const historial = useTareasHistorial(true, sucursal, responsable);
  const tareas = historial.data?.pages.flat() ?? [];
  const showSkeleton = useDelayedVisible(historial.isLoading);
  const filtrado = responsable !== 'todos' || sucursal !== 'todas';

  let contenido: ReactNode;
  if (historial.isLoading) {
    contenido = showSkeleton ? (
      <ListaTareas>{Array.from({ length: 5 }).map((_, i) => <li key={i} className="px-3 py-3 sm:px-4"><SkeletonRow /></li>)}</ListaTareas>
    ) : null;
  } else if (historial.isError && tareas.length === 0) {
    contenido = <TareasLoadError subject="el historial" retry={() => historial.refetch()} pending={historial.isFetching} />;
  } else if (tareas.length === 0) {
    contenido = filtrado ? (
      <p className="px-1 py-2 text-sm text-muted-foreground">
        Ninguna tarea completada coincide con los filtros.{' '}
        <Button type="button" variant="link" className="h-auto p-0" onClick={() => { setResponsable('todos'); setSucursal('todas'); }}>Quitar filtros</Button>
      </p>
    ) : (
      <p className="px-1 py-2 text-sm text-muted-foreground">
        Todavía no hay tareas completadas. Cuando se completen, vas a ver acá quién lo hizo y cuándo.
      </p>
    );
  } else {
    contenido = (
      <div className="space-y-3">
        <ListaTareas>
          {tareas.map(t => (
            <TareaFila key={t.id} titulo={t.titulo} descripcion={t.descripcion} estado="completada" meta={metaDe(t)}
              automatica={!!t.recurrencia_id} onAbrir={() => onAbrir(t)} menu={menuDe(t)} />
          ))}
        </ListaTareas>
        {historial.isFetchNextPageError && (
          <TareasLoadError subject="más tareas del historial" retry={() => historial.fetchNextPage()} compact />
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 px-1">
          <span className="text-xs tabular-nums text-muted-foreground">{tareas.length} {tareas.length === 1 ? 'cargada' : 'cargadas'}</span>
          {historial.hasNextPage && !historial.isFetchNextPageError && (
            <Button type="button" variant="outline" disabled={historial.isFetchingNextPage} onClick={() => void historial.fetchNextPage()}>
              {historial.isFetchingNextPage && <Loader2 className="animate-spin" aria-hidden />}
              {historial.isFetchingNextPage ? 'Cargando…' : 'Cargar más'}
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <Button type="button" variant="ghost" size="sm" className="-ml-2 text-muted-foreground" onClick={onVolver}>
          <ArrowLeft aria-hidden />Volver a Tareas
        </Button>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h2 className="inline-flex items-center gap-2 text-lg font-medium text-foreground">
              <CheckCircle2 className="h-5 w-5 text-status-success" aria-hidden />Historial
            </h2>
            <p className="text-sm text-muted-foreground">Tareas completadas, de la más reciente a la más antigua.</p>
          </div>
          {filtros && (
            <TareasFiltros responsable={responsable} onResponsable={setResponsable} responsables={filtros.responsables}
              sucursales={filtros.sucursales} sucursal={sucursal} onSucursal={setSucursal}
              onQuitar={() => { setResponsable('todos'); setSucursal('todas'); }} />
          )}
        </div>
      </div>
      {contenido}
    </div>
  );
}
