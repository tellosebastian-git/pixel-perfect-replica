import { CalendarClock, Clock, Pause, Play, Repeat } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/ui/StatusPill';
import type { TareaRecurrente } from '@/hooks/useTareasRecurrentes';
import { describePausa } from '@/lib/tareasAutomaticas';
import { describirRepeticion } from '@/lib/tareasRepeticion';
import { formatDiaCorto } from '@/lib/tareasAgenda';
import { cn } from '@/lib/utils';
import { MenuFilaAcciones, MetaResponsable, MetaSucursal, type AccionMenu } from './TareaFila';

/** Estado de la última tarea real que generó, si está entre los datos ya cargados. */
export interface UltimaOcurrencia { fecha: string | null; texto: string }

interface Props {
  receta: TareaRecurrente;
  today: string;
  sucursalNombre?: string | null;
  ultima?: UltimaOcurrencia | null;
  /** Pausar/Reanudar y Editar (cuentas de sucursal: con PIN). */
  puedeGestionar: boolean;
  puedeEliminar: boolean;
  onEditar: () => void;
  onAlternar: () => void;
  onEliminar: () => void;
  alternando?: boolean;
  destacada?: boolean;
}

/** Fila de Tareas → Tareas automáticas. Activa: "Próxima". Pausada: el motivo, nunca una próxima que no va a ocurrir. */
export function RecurrenteFila({
  receta, today, sucursalNombre, ultima, puedeGestionar, puedeEliminar, onEditar, onAlternar, onEliminar, alternando, destacada,
}: Props) {
  const pausa = receta.activo ? null : describePausa(receta.pausa_motivo);
  const equipo = receta.assignment_scope === 'team' || !receta.asignado_a;
  const proxima = receta.proxima_fecha === today ? 'hoy' : formatDiaCorto(receta.proxima_fecha);
  // Una pausa automática se reanuda sola cuando desaparece la causa: no se ofrece reanudar a mano.
  const puedeAlternar = puedeGestionar && !pausa?.automatica;
  const menu: AccionMenu[] = [
    ...(puedeGestionar ? [{ label: 'Editar', onSelect: onEditar }] : []),
    ...(puedeEliminar ? [{ label: 'Eliminar', onSelect: onEliminar, destructive: true }] : []),
  ];

  return (
    <li id={`automatica-${receta.id}`} className={cn('flex items-start gap-2 px-3 py-3 transition-colors duration-200 sm:px-4', destacada && 'bg-primary/5')}>
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground" aria-hidden>
        <Repeat className="h-4 w-4" />
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-56 py-0.5">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-medium text-foreground">{receta.titulo}</span>
            {pausa && <StatusPill status="neutral" icon={Pause} size="sm" label="Pausada" />}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1"><Repeat className="h-3.5 w-3.5" aria-hidden />{describirRepeticion(receta)}</span>
            {receta.hora && <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" aria-hidden />{receta.hora}</span>}
            <MetaResponsable equipo={equipo} nombre={receta.asignado_nombre} />
            {sucursalNombre && <MetaSucursal nombre={sucursalNombre} />}
            {!pausa && (
              <span className="inline-flex items-center gap-1 font-medium text-foreground">
                <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />Próxima: {proxima}
              </span>
            )}
            {ultima && <span>Última: {ultima.texto}</span>}
          </p>
          {pausa && (
            <p className="mt-1.5 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{pausa.label}.</span> {pausa.hint}
            </p>
          )}
        </div>
        {(puedeAlternar || menu.length > 0) && (
          <div className="ml-auto flex shrink-0 items-center gap-3 py-0.5">
            {puedeAlternar && (
              <Button type="button" size="sm" variant="outline" className="hit-area-expand" disabled={alternando} onClick={onAlternar}
                aria-label={`${receta.activo ? 'Pausar' : 'Reanudar'} «${receta.titulo}»`}>
                {receta.activo ? <Pause aria-hidden /> : <Play aria-hidden />}
                {receta.activo ? 'Pausar' : 'Reanudar'}
              </Button>
            )}
            {menu.length > 0 && <MenuFilaAcciones titulo={receta.titulo} acciones={menu} />}
          </div>
        )}
      </div>
    </li>
  );
}
