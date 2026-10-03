import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarUI } from '@/components/ui/calendar';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuRadioGroup, DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu';
import { ChevronLeft, ChevronRight, CalendarIcon, Plus, CalendarPlus, Ban, CalendarX, Rows4, Rows3, Rows2, type LucideIcon } from 'lucide-react';
import { format, addDays, startOfWeek, endOfWeek, isSameDay } from 'date-fns';
import { es } from 'date-fns/locale';
import { Barber } from '@/types/barbershop';
import { useAgendaData, Turno } from './hooks/useAgendaData';
import { AgendaDayView } from './AgendaDayView';
import { AgendaMultiDayView } from './AgendaMultiDayView';
import { NewAppointmentDialog } from './NewAppointmentDialog';
import { UnavailableSlotDialog } from './UnavailableSlotDialog';
import { DayOffDialog } from './DayOffDialog';
import { AppointmentDetailDialog } from './AppointmentDetailDialog';
import { MoveConfirmDialog } from './MoveConfirmDialog';
import { TurnoConflictDialog, type TurnoConflictKind } from './TurnoConflictDialog';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { timeToMinutes, minutesToTime, ZOOM_LEVELS, type ZoomLevel } from './lib/timeUtils';
import { callUpdateTurnoInternal, type ConflictTurno } from './lib/updateTurnoInternal';
import { useTurnosRealtime } from '@/hooks/useTurnosRealtime';
import { InlineReadError } from '@/components/ui/InlineReadError';
import { StaleDataNotice } from '@/components/ui/StaleDataNotice';



type ViewMode = 'day' | '3days' | 'week';

// Rows4/Rows3/Rows2: más barras = más filas visibles = más compacto. La
// progresión numérica (4→3→2) mapea directo a compact→normal→wide, y son
// visualmente distintos entre sí por conteo de barras.
const ZOOM_ICONS: Record<ZoomLevel, LucideIcon> = {
  compact: Rows4,
  normal: Rows3,
  wide: Rows2,
};

const ZOOM_LABELS: Record<ZoomLevel, string> = {
  compact: 'Compacto',
  normal: 'Normal',
  wide: 'Amplio',
};

interface AgendaPanelProps {
  sucursalId: string;
  organizationId: string;
  sucursalTimezone?: string | null;
  barbers: Barber[];
}

export function AgendaPanel({ sucursalId, organizationId, sucursalTimezone, barbers }: AgendaPanelProps) {
  const { isOwner, isGeneralManager, isManager, isBarber, isSucursalAccount } = useAuth();
  const [date, setDate] = useState(new Date());
  const [view, setView] = useState<ViewMode>('day');
  const [calendarOpen, setCalendarOpen] = useState(false);

  // Zoom de la vista Día (Build B). El nivel APLICADO vive acá — AgendaPanel
  // es dueño del ToggleGroup, así que es quien necesita el valor para
  // renderizarlo. AgendaDayView calcula la sugerencia automática (tiene el
  // ResizeObserver y generalWorkRanges) y la sube por callback; zoomManualDateRef
  // recuerda si el usuario ya eligió a mano PARA ESTE DÍA, y en ese caso la
  // sugerencia entrante se ignora. Se resetea solo al cambiar de fecha —
  // sobrevive a ir y volver entre Día/3días/Semana en el mismo día.
  const [zoomLevel, setZoomLevel] = useState<ZoomLevel>('normal');
  const zoomManualDateRef = useRef<string | null>(null);

  const [newApptOpen, setNewApptOpen] = useState(false);
  const [newApptDefaults, setNewApptDefaults] = useState<{ barberId?: string; horaInicio?: string }>({});
  const [unavOpen, setUnavOpen] = useState(false);
  const [dayOffOpen, setDayOffOpen] = useState(false);
  const [detailTurno, setDetailTurno] = useState<Turno | null>(null);

  const [moveDialog, setMoveDialog] = useState<{
    turno: Turno; newBarberoId: string; newHoraInicio: string; newHoraFin: string; newFecha: string;
  } | null>(null);
  const [movingLoading, setMovingLoading] = useState(false);

  const [moveConflict, setMoveConflict] = useState<{
    kind: TurnoConflictKind;
    conflicts?: ConflictTurno[];
  } | null>(null);

  // Cualquier miembro del equipo con acceso a la agenda puede crear/editar/mover
  // turnos y bloquear horarios. La función update-turno-internal aplica los
  // controles finos por sucursal en el servidor.
  const canManageAgenda =
    isOwner || isGeneralManager || isManager || isBarber || isSucursalAccount;
  const canCreateDayOff = canManageAgenda;
  const canDrag = canManageAgenda;


  const { fromDate, toDate } = useMemo(() => {
    if (view === 'day') return { fromDate: date, toDate: date };
    if (view === '3days') return { fromDate: date, toDate: addDays(date, 2) };
    const ws = startOfWeek(date, { weekStartsOn: 1 });
    const we = endOfWeek(date, { weekStartsOn: 1 });
    return { fromDate: ws, toDate: we };
  }, [view, date]);

  const { turnos, bloqueos, servicios, horarios, phase: agendaPhase, error: agendaError, isStale: agendaStale, refetch, retry: retryAgenda } = useAgendaData(
    sucursalId, organizationId, fromDate, toDate,
  );
  const agendaLoadFailed = agendaPhase === 'error';

  // Realtime: refetch silencioso ante cambios en turnos de esta sucursal.
  // Salvaguarda: si hay un movimiento en curso (drag confirmado / diálogo de
  // conflicto abierto), el refetch queda pendiente y se aplica al cerrar.
  const isBusy = !!moveDialog || !!moveConflict || movingLoading;
  const pendingRefetchRef = useRef(false);

  const handleRealtimeChange = useCallback(() => {
    if (!!moveDialog || !!moveConflict || movingLoading) {
      pendingRefetchRef.current = true;
      return;
    }
    refetch();
  }, [moveDialog, moveConflict, movingLoading, refetch]);

  useEffect(() => {
    if (!isBusy && pendingRefetchRef.current) {
      pendingRefetchRef.current = false;
      refetch();
    }
  }, [isBusy, refetch]);

  useTurnosRealtime({ sucursalId, onChange: handleRealtimeChange });



  const handlePrev = () => {
    if (view === 'day') setDate(d => addDays(d, -1));
    else if (view === '3days') setDate(d => addDays(d, -3));
    else setDate(d => addDays(d, -7));
  };
  const handleNext = () => {
    if (view === 'day') setDate(d => addDays(d, 1));
    else if (view === '3days') setDate(d => addDays(d, 3));
    else setDate(d => addDays(d, 7));
  };

  const handleAutoZoomSuggested = useCallback((level: ZoomLevel) => {
    const dStr = format(date, 'yyyy-MM-dd');
    if (zoomManualDateRef.current === dStr) return; // el usuario ya eligió a mano para este día
    setZoomLevel(level);
  }, [date]);

  const handleZoomLevelChange = (level: ZoomLevel) => {
    zoomManualDateRef.current = format(date, 'yyyy-MM-dd');
    setZoomLevel(level);
  };

  const handleSlotClick = (barberoId: string, horaInicio: string) => {
    if (!canManageAgenda) return;
    setNewApptDefaults({ barberId: barberoId, horaInicio });
    setNewApptOpen(true);
  };

  const handleMoveTurno = (turno: Turno, newBarberoId: string, newHoraInicio: string, newFecha: string) => {
    if (!canManageAgenda) return;
    // Validaciones front
    const newBarber = barbers.find(b => b.id === newBarberoId);
    if (!newBarber || !newBarber.active) {
      toast.error('El barbero no es válido');
      return;
    }
    if (!['pendiente', 'confirmado'].includes(turno.estado)) {
      toast.error('Este turno no se puede mover');
      return;
    }
    const dur = timeToMinutes(turno.hora_fin) - timeToMinutes(turno.hora_inicio);
    const newHoraFin = minutesToTime(timeToMinutes(newHoraInicio) + dur);
    setMoveDialog({ turno, newBarberoId, newHoraInicio, newHoraFin, newFecha });
  };

  const performMove = async (opts: { confirmOverlap?: boolean; confirmFueraHorario?: boolean } = {}) => {
    if (!canManageAgenda || !moveDialog) return;
    const { turno, newBarberoId, newHoraInicio, newFecha } = moveDialog;
    setMovingLoading(true);
    const res = await callUpdateTurnoInternal({
      turno_id: turno.id,
      barbero_id: newBarberoId,
      fecha: newFecha,
      hora_inicio: newHoraInicio,
      confirm_overlap: opts.confirmOverlap,
      confirm_fuera_horario: opts.confirmFueraHorario,
    });
    setMovingLoading(false);

    if (res.ok) {
      toast.success('Turno actualizado');
      setMoveDialog(null);
      setMoveConflict(null);
      refetch();
      return;
    }

    const fail = res as Extract<typeof res, { ok: false }>;
    if (fail.status === 409 && fail.error === 'choque_de_horario') {
      setMoveConflict({ kind: 'choque_de_horario', conflicts: fail.conflicts });
      return;
    }
    if (fail.status === 409 && fail.error === 'fuera_de_horario') {
      setMoveConflict({ kind: 'fuera_de_horario' });
      return;
    }
    if (fail.error === 'slot_en_pasado') {
      toast.error('No podés mover el turno a un horario en el pasado');
      return;
    }
    if (fail.error === 'turno_cerrado') {
      toast.error('Este turno ya no se puede modificar');
      return;
    }
    if (fail.error === 'slot_bloqueado') {
      toast.error('Ese horario está bloqueado en la agenda');
      return;
    }
    if (fail.error === 'forbidden') {
      toast.error('No tenés permiso para mover este turno');
      return;
    }
    toast.error(fail.message || 'No se pudo mover el turno');
  };


  const confirmMove = () => performMove();

  const confirmMoveConflictRetry = () => {
    if (!moveConflict) return;
    if (moveConflict.kind === 'choque_de_horario') {
      performMove({ confirmOverlap: true });
    } else if (moveConflict.kind === 'fuera_de_horario') {
      performMove({ confirmFueraHorario: true });
    }
  };


  const titleLabel = useMemo(() => {
    if (view === 'day') return format(date, "EEEE dd 'de' MMMM yyyy", { locale: es });
    if (view === '3days') return `${format(fromDate, 'dd MMM', { locale: es })} – ${format(toDate, 'dd MMM yyyy', { locale: es })}`;
    return `${format(fromDate, 'dd MMM', { locale: es })} – ${format(toDate, 'dd MMM yyyy', { locale: es })}`;
  }, [view, date, fromDate, toDate]);

  return (
    <div className="border rounded-lg overflow-clip">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 flex-wrap border-b bg-muted/30 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setDate(new Date())}>Hoy</Button>
          <div className="flex">
            <Button variant="outline" size="icon" className="h-9 w-9 rounded-r-none" onClick={handlePrev}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" className="h-9 w-9 rounded-l-none border-l-0" onClick={handleNext}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <CalendarIcon className="h-4 w-4" />
                <span className="capitalize">{titleLabel}</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <CalendarUI
                mode="single"
                selected={date}
                onSelect={(d) => { if (d) { setDate(d); setCalendarOpen(false); } }}
                locale={es}
              />
            </PopoverContent>
          </Popover>
        </div>

        <div className="flex items-center gap-2">
          <ToggleGroup type="single" value={view} onValueChange={(v) => v && setView(v as ViewMode)} size="sm">
            <ToggleGroupItem value="day" className="text-xs px-3">Día</ToggleGroupItem>
            <ToggleGroupItem value="3days" className="text-xs px-3">3 días</ToggleGroupItem>
            <ToggleGroupItem value="week" className="text-xs px-3">Semana</ToggleGroupItem>
          </ToggleGroup>

          {view === 'day' && (() => {
            const ZoomIcon = ZOOM_ICONS[zoomLevel];
            return (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" className="h-9 w-9" title={`Zoom: ${ZOOM_LABELS[zoomLevel]}`}>
                    <ZoomIcon className="h-4 w-4" />
                    <span className="sr-only">Zoom: {ZOOM_LABELS[zoomLevel]}</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuRadioGroup value={zoomLevel} onValueChange={(v) => handleZoomLevelChange(v as ZoomLevel)}>
                    {ZOOM_LEVELS.map((level) => {
                      const Icon = ZOOM_ICONS[level];
                      return (
                        <DropdownMenuRadioItem key={level} value={level}>
                          <Icon className="h-4 w-4 mr-2" /> {ZOOM_LABELS[level]}
                        </DropdownMenuRadioItem>
                      );
                    })}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            );
          })()}

          {canManageAgenda && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" className="gap-1">
                  <Plus className="h-4 w-4" /> Añadir
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => { setNewApptDefaults({}); setNewApptOpen(true); }}>
                  <CalendarPlus className="h-4 w-4" /> Cita
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setUnavOpen(true)}>
                  <Ban className="h-4 w-4" /> Horario no disponible
                </DropdownMenuItem>
                {canCreateDayOff && (
                  <DropdownMenuItem onClick={() => setDayOffOpen(true)}>
                    <CalendarX className="h-4 w-4" /> Día off
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {agendaStale && (
        <div className="px-4 pt-2.5">
          <StaleDataNotice onRefresh={retryAgenda} />
        </div>
      )}

      {/* Vista */}
      {agendaLoadFailed ? (
        <InlineReadError
          message={agendaError ?? 'No pudimos cargar la agenda.'}
          onRetry={retryAgenda}
          bordered={false}
        />
      ) : (
        <>
          {view === 'day' && (
            <div className="animate-in fade-in slide-in-from-bottom-1 duration-200 [animation-timing-function:var(--ease-out-quint)]">
              <AgendaDayView
                date={date}
                barbers={barbers}
                turnos={turnos}
                bloqueos={bloqueos}
                servicios={servicios}
                horarios={horarios}
                onTurnoClick={setDetailTurno}
                onSlotClick={handleSlotClick}
                onMoveTurno={handleMoveTurno}
                canDrag={canDrag}
                zoomLevel={zoomLevel}
                onAutoZoomSuggested={handleAutoZoomSuggested}
              />
            </div>
          )}
          {view === '3days' && (
            <div className="animate-in fade-in slide-in-from-bottom-1 duration-200 [animation-timing-function:var(--ease-out-quint)]">
              <AgendaMultiDayView
                startDate={fromDate}
                daysCount={3}
                barbers={barbers}
                turnos={turnos}
                bloqueos={bloqueos}
                servicios={servicios}
                onTurnoClick={setDetailTurno}
                onDayHeaderClick={(d) => { setDate(d); setView('day'); }}
              />
            </div>
          )}
          {view === 'week' && (
            <div className="animate-in fade-in slide-in-from-bottom-1 duration-200 [animation-timing-function:var(--ease-out-quint)]">
              <AgendaMultiDayView
                startDate={fromDate}
                daysCount={7}
                barbers={barbers}
                turnos={turnos}
                bloqueos={bloqueos}
                servicios={servicios}
                onTurnoClick={setDetailTurno}
                onDayHeaderClick={(d) => { setDate(d); setView('day'); }}
              />
            </div>
          )}
        </>
      )}

      <NewAppointmentDialog
        open={newApptOpen}
        onOpenChange={setNewApptOpen}
        organizationId={organizationId}
        sucursalId={sucursalId}
        sucursalTimezone={sucursalTimezone || 'America/Argentina/Buenos_Aires'}
        barbers={barbers}
        servicios={servicios}
        defaultDate={date}
        defaultBarberId={newApptDefaults.barberId}
        defaultHoraInicio={newApptDefaults.horaInicio}
        onCreated={refetch}
      />
      <UnavailableSlotDialog
        open={unavOpen}
        onOpenChange={setUnavOpen}
        organizationId={organizationId}
        sucursalId={sucursalId}
        barbers={barbers}
        defaultDate={date}
        onCreated={refetch}
      />
      <DayOffDialog
        open={dayOffOpen}
        onOpenChange={setDayOffOpen}
        organizationId={organizationId}
        sucursalId={sucursalId}
        defaultDate={date}
        onCreated={refetch}
      />
      <AppointmentDetailDialog
        open={!!detailTurno}
        onOpenChange={(v) => { if (!v) setDetailTurno(null); }}
        turno={detailTurno}
        organizationId={organizationId}
        sucursalId={sucursalId}
        barbers={barbers}
        servicios={servicios}
        onChanged={refetch}
        readOnly={!canManageAgenda}
      />
      <MoveConfirmDialog
        open={!!moveDialog && !moveConflict}
        onOpenChange={(v) => { if (!v) { setMoveDialog(null); setMoveConflict(null); } }}
        turno={moveDialog?.turno || null}
        newBarberId={moveDialog?.newBarberoId || ''}
        newHoraInicio={moveDialog?.newHoraInicio || ''}
        newHoraFin={moveDialog?.newHoraFin || ''}
        newFecha={moveDialog?.newFecha || ''}
        barbers={barbers}
        onConfirm={confirmMove}
        loading={movingLoading}
      />
      <TurnoConflictDialog
        open={!!moveConflict}
        onOpenChange={(v) => { if (!v) setMoveConflict(null); }}
        kind={moveConflict?.kind || null}
        conflicts={moveConflict?.conflicts}
        onConfirm={confirmMoveConflictRetry}
        loading={movingLoading}
      />

    </div>
  );
}
