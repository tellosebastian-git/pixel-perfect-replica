import { format, isSameDay } from 'date-fns';
import { es } from 'date-fns/locale';
import { Barber } from '@/types/barbershop';
import { Turno, Bloqueo, Servicio } from './hooks/useAgendaData';
import { useBarberColors } from './hooks/useBarberColors';
import { cn } from '@/lib/utils';
import { useMemo } from 'react';
import { MULTI_PX_PER_MIN, MULTI_RANGE_START, MULTI_RANGE_END } from './lib/multiDayLayout';
import { AgendaMultiDayColumn } from './AgendaMultiDayColumn';

interface Props {
  startDate: Date;
  daysCount: number;
  barbers: Barber[];
  turnos: Turno[];
  bloqueos: Bloqueo[];
  servicios: Servicio[];
  onTurnoClick: (t: Turno) => void;
  onDayHeaderClick?: (d: Date) => void;
}

export function AgendaMultiDayView({
  startDate, daysCount, barbers, turnos, bloqueos, servicios, onTurnoClick, onDayHeaderClick,
}: Props) {
  const colors = useBarberColors(barbers.map(b => b.id));
  const days = useMemo(() => Array.from({ length: daysCount }, (_, i) => {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    return d;
  }), [startDate, daysCount]);

  const totalHeight = (MULTI_RANGE_END - MULTI_RANGE_START) * MULTI_PX_PER_MIN;
  const TIME_RAIL_WIDTH = 56;
  const today = new Date();

  const hourRails = useMemo(() => {
    const rails: number[] = [];
    for (let m = MULTI_RANGE_START; m <= MULTI_RANGE_END; m += 60) rails.push(m);
    return rails;
  }, []);

  const halfHourRails = useMemo(() => {
    const rails: number[] = [];
    for (let m = MULTI_RANGE_START; m <= MULTI_RANGE_END; m += 30) {
      if (m % 60 !== 0) rails.push(m);
    }
    return rails;
  }, []);

  return (
    <div className="bg-card overflow-clip">
      {/* Day header row — sticky, outside scroll container */}
      <div
        className="flex border-b bg-muted/30 sticky top-0 z-20"
        style={{ boxShadow: '0 2px 6px rgba(0,0,0,0.05)' }}
      >
        <div className="shrink-0 border-r" style={{ width: TIME_RAIL_WIDTH }} />
        <div className="grid flex-1" style={{ gridTemplateColumns: `repeat(${daysCount}, minmax(0, 1fr))` }}>
          {days.map(d => {
            const isToday = isSameDay(d, today);
            return (
              <button
                key={d.toISOString()}
                onClick={() => onDayHeaderClick?.(d)}
                className={cn(
                  'px-3 py-2 border-r text-left hover:bg-muted/50 transition-colors',
                  isToday && 'bg-primary/5',
                )}
              >
                <div className="text-[10px] uppercase text-muted-foreground">
                  {format(d, 'EEE', { locale: es })}
                </div>
                <div className={cn('text-sm font-medium', isToday && 'text-primary')}>
                  {format(d, 'dd MMM', { locale: es })}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Scrollable calendar body */}
      <div
        className="overflow-y-auto overscroll-contain"
        style={{ maxHeight: 'clamp(600px, calc(100vh - 180px), 1100px)' }}
      >
        <div className="flex" style={{ height: totalHeight }}>
          {/* Time rail */}
          <div className="shrink-0 border-r relative" style={{ width: TIME_RAIL_WIDTH }}>
            {hourRails.map((m) => (
              <div
                key={m}
                className="absolute left-0 right-0 text-[10px] text-muted-foreground px-1 -translate-y-1/2"
                style={{ top: (m - MULTI_RANGE_START) * MULTI_PX_PER_MIN }}
              >
                {`${String(Math.floor(m / 60)).padStart(2, '0')}:00`}
              </div>
            ))}
          </div>

          {/* Day columns */}
          <div className="grid flex-1 relative" style={{ gridTemplateColumns: `repeat(${daysCount}, minmax(0, 1fr))` }}>
            {days.map(d => {
              const dStr = format(d, 'yyyy-MM-dd');
              const dayTurnos = turnos.filter(t => t.fecha === dStr);
              const isToday = isSameDay(d, today);
              const dayOff = bloqueos.find(b =>
                b.barbero_id === null && b.todo_el_dia && b.fecha_inicio <= dStr && b.fecha_fin >= dStr,
              );

              return (
                <AgendaMultiDayColumn
                  key={dStr}
                  isToday={isToday}
                  dayTurnos={dayTurnos}
                  dayOff={dayOff}
                  servicios={servicios}
                  barbers={barbers}
                  colors={colors}
                  hourRails={hourRails}
                  halfHourRails={halfHourRails}
                  onTurnoClick={onTurnoClick}
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
