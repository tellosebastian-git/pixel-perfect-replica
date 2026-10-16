import { useEffect, useState } from 'react';
import { AlertTriangle, CalendarDays, CheckCircle2, Clock, Inbox, User, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusPill } from '@/components/ui/StatusPill';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { Tarea } from '@/hooks/useTareas';
import { formatTimestampInTimezone } from '@/lib/dateUtils';
import { cn } from '@/lib/utils';
import { getPeticionVencimiento } from '@/lib/tareasVencimiento';
import { MenuFilaAcciones, MetaSucursal } from './TareaFila';
import { ListaTareas } from './TareasSeccion';
import { TareasLoadError } from './TareasLoadError';

const ESTADOS = [
  { value: 'todos', label: 'Todos los estados' },
  { value: 'pendiente', label: 'Pendientes' },
  { value: 'completada', label: 'Completadas' },
  { value: 'rechazada', label: 'Rechazadas' },
  { value: 'vencida', label: 'Vencidas' },
];

interface Props {
  peticiones: Tarea[];
  hasData: boolean;
  error: unknown;
  onReintentar: () => void;
  timezone?: string | null;
  diasDefault: number;
  /** `null` = el contexto ya fija la sucursal. */
  sucursales: { id: string; nombre: string }[] | null;
  sucursalNombre: (id: string | null) => string | null;
  puedeEliminar: boolean;
  onResolver: (t: Tarea, estado: 'completada' | 'rechazada') => Promise<void>;
  onEliminar: (t: Tarea) => void;
  /** Acción en curso: id de la petición. */
  resolviendo: string | null;
  /** Petición a la que se llegó desde la campana: se muestra (sin filtros) y se resalta un momento. */
  resaltadaId?: string | null;
}

/**
 * Principal → Tareas → Peticiones. Misma funcionalidad que antes (estados, completar/aprobar, rechazar,
 * eliminar con PIN), con la lista vertical y los estados de carga compartidos con Tareas.
 */
export function PeticionesLista({
  peticiones, hasData, error, onReintentar, timezone, diasDefault, sucursales, sucursalNombre, puedeEliminar, onResolver, onEliminar, resolviendo,
  resaltadaId = null,
}: Props) {
  const [estado, setEstado] = useState('todos');
  const [sucursal, setSucursal] = useState('todas');
  // Que un filtro no esconda justo la petición a la que se llegó.
  useEffect(() => {
    if (resaltadaId) { setEstado('todos'); setSucursal('todas'); }
  }, [resaltadaId]);

  if (!hasData) return error ? <TareasLoadError subject="las peticiones" retry={onReintentar} /> : null;
  if (peticiones.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card py-12 shadow-sm">
        <EmptyState icon={Inbox} title="No hay peticiones" description="Cuando alguien del equipo pida algo, aparece acá para que lo resuelvas." />
      </div>
    );
  }

  const vencidaVisual = (t: Tarea) => t.estado === 'vencida' || (t.estado === 'pendiente' && getPeticionVencimiento(t, diasDefault, timezone).vencida);
  const visibles = peticiones.filter(t => {
    if (sucursales && sucursal !== 'todas' && t.sucursal_id !== sucursal) return false;
    if (estado === 'todos') return true;
    if (estado === 'vencida') return vencidaVisual(t);
    return t.estado === estado;
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filtros de peticiones">
        <Select value={estado} onValueChange={setEstado}>
          <SelectTrigger className="h-9 w-full sm:w-[12rem]" aria-label="Estado"><SelectValue /></SelectTrigger>
          <SelectContent>{ESTADOS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
        </Select>
        {sucursales && (
          <Select value={sucursal} onValueChange={setSucursal}>
            <SelectTrigger className="h-9 w-full sm:w-[12rem]" aria-label="Sucursal"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas las sucursales</SelectItem>
              {sucursales.map(s => <SelectItem key={s.id} value={s.id}>{s.nombre}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>

      {visibles.length === 0 ? (
        <p className="px-1 py-2 text-sm text-muted-foreground">
          Ninguna petición coincide con los filtros.{' '}
          <Button type="button" variant="link" className="h-auto p-0" onClick={() => { setEstado('todos'); setSucursal('todas'); }}>Quitar filtros</Button>
        </p>
      ) : (
        <ListaTareas>
          {visibles.map(t => {
            const vencida = vencidaVisual(t);
            const venc = t.estado === 'pendiente' && !vencida ? getPeticionVencimiento(t, diasDefault, timezone) : null;
            const abierta = t.estado === 'pendiente' || t.estado === 'vencida';
            const ocupada = !!resolviendo;
            const sNombre = sucursalNombre(t.sucursal_id);
            return (
              <li key={t.id} id={`tarea-${t.id}`}
                className={cn('flex min-w-0 flex-wrap items-start gap-x-4 gap-y-2 px-3 py-3 transition-colors duration-700 sm:px-4', resaltadaId === t.id && 'bg-primary/5')}>
                <div className="min-w-0 flex-1 basis-56">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-sm font-medium text-foreground">{t.titulo}</span>
                    {vencida && <StatusPill status="error" icon={AlertTriangle} size="sm" label="Vencida" />}
                    {t.estado === 'completada' && <StatusPill status="success" icon={CheckCircle2} size="sm" label="Completada" />}
                    {t.estado === 'rechazada' && <StatusPill status="neutral" icon={XCircle} size="sm" label="Rechazada" />}
                  </p>
                  {t.descripcion && <p className="mt-0.5 whitespace-pre-line break-words text-sm text-muted-foreground">{t.descripcion}</p>}
                  <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1"><User className="h-3.5 w-3.5" aria-hidden />{t.creado_por_nombre || 'Sin nombre'}</span>
                    {sNombre && <MetaSucursal nombre={sNombre} />}
                    <span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" aria-hidden />{formatTimestampInTimezone(t.created_at, timezone, false)}</span>
                    {venc?.diasRestantes !== null && venc?.diasRestantes !== undefined && (
                      <span className={venc.diasRestantes <= 7 ? 'inline-flex items-center gap-1 font-medium text-foreground' : 'inline-flex items-center gap-1'}>
                        <Clock className={venc.diasRestantes <= 7 ? 'h-3.5 w-3.5 text-status-warning-foreground' : 'h-3.5 w-3.5'} aria-hidden />
                        {venc.diasRestantes === 0 ? 'Vence hoy' : `Vence en ${venc.diasRestantes} ${venc.diasRestantes === 1 ? 'día' : 'días'}`}
                      </span>
                    )}
                  </p>
                </div>
                {(abierta || puedeEliminar) && (
                  <div className="ml-auto flex shrink-0 items-center gap-3 py-0.5">
                    {abierta && (
                      <>
                        <Button type="button" size="sm" variant="outline" className="hit-area-expand" disabled={ocupada}
                          onClick={() => void onResolver(t, 'rechazada')} aria-label={`Rechazar «${t.titulo}»`}>
                          <XCircle aria-hidden />Rechazar
                        </Button>
                        <Button type="button" size="sm" variant="outline" className="hit-area-expand" disabled={ocupada}
                          onClick={() => void onResolver(t, 'completada')} aria-label={`${t.estado === 'vencida' ? 'Aprobar' : 'Completar'} «${t.titulo}»`}>
                          <CheckCircle2 aria-hidden />{t.estado === 'vencida' ? 'Aprobar' : 'Completar'}
                        </Button>
                      </>
                    )}
                    {puedeEliminar && <MenuFilaAcciones titulo={t.titulo} acciones={[{ label: 'Eliminar', onSelect: () => onEliminar(t), destructive: true }]} />}
                  </div>
                )}
              </li>
            );
          })}
        </ListaTareas>
      )}
    </div>
  );
}
