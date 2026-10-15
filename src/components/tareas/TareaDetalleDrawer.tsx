import { useRef, type ReactNode } from 'react';
import { AlertTriangle, CalendarClock, CheckCircle2, Clock, Loader2, Pencil, Play, Repeat } from 'lucide-react';
import { DrawerForm } from '@/components/ui/drawer-form';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/ui/StatusPill';
import type { Tarea } from '@/hooks/useTareas';
import { formatTimestampInTimezone } from '@/lib/dateUtils';
import { addCivilDays } from '@/lib/tareasData';
import { fechaDeTarea, formatDiaLargo, type TareaPrevista } from '@/lib/tareasAgenda';

export type DetalleTarea =
  | { kind: 'tarea'; tarea: Tarea; vencida: boolean }
  | { kind: 'prevista'; prevista: TareaPrevista };

interface Props {
  detalle: DetalleTarea | null;
  onClose: () => void;
  sucursalNombre: (id: string | null) => string | null;
  timezone?: string | null;
  diasVencimiento: number;
  /** Título de la Tarea automática de origen, si se conoce. */
  automaticaTitulo?: string | null;
  onIniciar?: () => void;
  onCompletar?: () => void;
  onEditar?: () => void;
  onVerAutomatica?: () => void;
  enCurso?: 'completar' | 'iniciar' | null;
  bloqueada?: boolean;
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Principal → Tareas → seleccionar una tarea. Lectura completa + acciones que el usuario puede usar. */
export function TareaDetalleDrawer({
  detalle: abierto, onClose, sucursalNombre, timezone, diasVencimiento, automaticaTitulo, onIniciar, onCompletar, onEditar, onVerAutomatica,
  enCurso = null, bloqueada = false,
}: Props) {
  // Conserva el contenido durante la animación de cierre.
  const ultimo = useRef(abierto);
  if (abierto) ultimo.current = abierto;
  const detalle = abierto ?? ultimo.current;
  const tarea = detalle?.kind === 'tarea' ? detalle.tarea : null;
  const prevista = detalle?.kind === 'prevista' ? detalle.prevista : null;
  const titulo = tarea?.titulo ?? prevista?.titulo ?? '';
  const descripcion = tarea?.descripcion ?? prevista?.descripcion ?? null;
  const fecha = tarea ? fechaDeTarea(tarea) : prevista?.fecha ?? null;
  const hora = tarea?.hora ?? prevista?.hora ?? null;
  const equipo = (tarea?.assignment_scope ?? prevista?.assignment_scope) === 'team';
  const responsable = equipo ? 'Todo el equipo' : (tarea?.asignado_a_nombre ?? prevista?.asignado_a_nombre ?? 'Sin asignar');
  const sucursal = sucursalNombre(tarea?.sucursal_id ?? prevista?.sucursal_id ?? null);
  const recurrenciaId = tarea?.recurrencia_id ?? prevista?.recurrencia_id ?? null;
  const vencida = detalle?.kind === 'tarea' && detalle.vencida;
  const ocupada = bloqueada || !!enCurso;

  const footer = (onIniciar || onCompletar || onEditar) ? (
    <div className="flex flex-wrap justify-end gap-2">
      {onEditar && <Button type="button" variant="outline" onClick={onEditar}><Pencil aria-hidden />Editar</Button>}
      {onIniciar && (
        <Button type="button" variant="outline" disabled={ocupada} onClick={onIniciar}>
          {enCurso === 'iniciar' ? <Loader2 className="animate-spin" aria-hidden /> : <Play aria-hidden />}
          {enCurso === 'iniciar' ? 'Iniciando…' : 'Iniciar'}
        </Button>
      )}
      {onCompletar && (
        <Button type="button" disabled={ocupada} onClick={onCompletar}>
          {enCurso === 'completar' ? <Loader2 className="animate-spin" aria-hidden /> : <CheckCircle2 aria-hidden />}
          {enCurso === 'completar' ? 'Completando…' : 'Completar'}
        </Button>
      )}
    </div>
  ) : undefined;

  return (
    <DrawerForm open={!!abierto} onOpenChange={open => { if (!open) onClose(); }} size="sm" title={titulo || 'Tarea'}
      description="Detalle de la tarea: estado, fechas, responsable y actividad." footer={footer}>
      {detalle && (
        <div className="space-y-5">
          <div className="flex flex-wrap gap-1.5">
            {prevista && <StatusPill status="neutral" icon={CalendarClock} label="Programada" />}
            {tarea?.estado === 'completada' && <StatusPill status="success" icon={CheckCircle2} label="Completada" />}
            {tarea?.estado === 'en_progreso' && <StatusPill status="info" icon={Play} label="En progreso" />}
            {vencida && <StatusPill status="error" icon={AlertTriangle} label="Vencida" />}
            {tarea && !vencida && (tarea.estado === 'pendiente') && <StatusPill status="neutral" icon={Clock} label="Pendiente" />}
            {recurrenciaId && <StatusPill status="neutral" icon={Repeat} label="Automática" />}
          </div>

          {prevista && (
            <p className="text-sm text-muted-foreground">
              Todavía no existe como tarea: Vittro la crea en su fecha. Hasta entonces no se puede iniciar ni completar.
            </p>
          )}

          <p className="whitespace-pre-line break-words text-sm text-foreground">
            {descripcion || <span className="text-muted-foreground">Sin descripción.</span>}
          </p>

          <dl className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-x-3 gap-y-2.5 text-sm">
            <Dato label="Fecha">{fecha ? capital(formatDiaLargo(fecha)) : 'Sin fecha'}</Dato>
            <Dato label="Hora">{hora ?? 'Sin hora'}</Dato>
            {tarea && tarea.estado !== 'completada' && fecha && (
              <Dato label="Vence">
                <span className={vencida ? 'font-medium text-status-error-foreground' : undefined}>
                  {capital(formatDiaLargo(addCivilDays(fecha, Math.max(0, diasVencimiento))))}{vencida ? ' · vencida' : ''}
                </span>
              </Dato>
            )}
            <Dato label="Responsable">{responsable}</Dato>
            {sucursal && <Dato label="Sucursal">{sucursal}</Dato>}
            <Dato label="Origen">
              {recurrenciaId ? (
                <span className="flex flex-col items-start gap-1">
                  <span>{automaticaTitulo ? <>Tarea automática «{automaticaTitulo}»</> : 'Una Tarea automática'}</span>
                  {onVerAutomatica && (
                    <Button type="button" variant="link" className="h-auto p-0" onClick={onVerAutomatica}>Ver Tarea automática</Button>
                  )}
                </span>
              ) : (
                <>Creada por {tarea?.creado_por_nombre || 'el equipo'}{tarea ? ` · ${formatTimestampInTimezone(tarea.created_at, timezone, false)}` : ''}</>
              )}
            </Dato>
            {tarea?.iniciada_at && (
              <Dato label="Iniciada">{tarea.iniciada_por_nombre || 'Alguien del equipo'} · {formatTimestampInTimezone(tarea.iniciada_at, timezone)}</Dato>
            )}
            {tarea?.estado === 'completada' && (
              <Dato label="Completada">
                {tarea.completada_por_nombre || 'Alguien del equipo'}
                {tarea.completada_at ? ` · ${formatTimestampInTimezone(tarea.completada_at, timezone)}` : ''}
              </Dato>
            )}
          </dl>
        </div>
      )}
    </DrawerForm>
  );
}

function Dato({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-xs font-medium text-muted-foreground pt-0.5">{label}</dt>
      <dd className="min-w-0 break-words text-foreground">{children}</dd>
    </>
  );
}
