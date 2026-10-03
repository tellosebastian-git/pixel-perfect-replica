import { useMemo, useEffect, useLayoutEffect, useState, useCallback, useRef } from 'react';
import { format, isSameDay } from 'date-fns';
import { Barber } from '@/types/barbershop';
import { Turno, Bloqueo, Servicio, Horario } from './hooks/useAgendaData';
import { useBarberColors } from './hooks/useBarberColors';
import { usePointerDragDrop, usePointerTap } from './hooks/usePointerDragDrop';
import { timeToMinutes, minutesToTime, formatHHMM, ZOOM_PX_PER_MIN, pickAutoZoomLevel, type ZoomLevel } from './lib/timeUtils';
import { cn } from '@/lib/utils';

interface AgendaDayViewProps {
  date: Date;
  barbers: Barber[];
  turnos: Turno[];
  bloqueos: Bloqueo[];
  servicios: Servicio[];
  horarios: Horario[];
  onTurnoClick: (turno: Turno) => void;
  onSlotClick: (barberoId: string, horaInicio: string) => void;
  onMoveTurno: (turno: Turno, newBarberoId: string, newHoraInicio: string, newFecha: string) => void;
  canDrag: boolean;
  /** Nivel de zoom aplicado — controlado desde AgendaPanel (dueño del
   *  ToggleGroup). AgendaDayView calcula la sugerencia automática (tiene
   *  el ResizeObserver y generalWorkRanges) pero no decide si se aplica:
   *  eso lo resuelve el padre vía onAutoZoomSuggested, respetando un
   *  override manual del usuario para el día actual. */
  zoomLevel: ZoomLevel;
  onAutoZoomSuggested: (level: ZoomLevel) => void;
}

interface MinuteRange {
  start: number;
  end: number;
}

function mergeRanges(ranges: MinuteRange[]): MinuteRange[] {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged: MinuteRange[] = [];

  for (const current of sorted) {
    if (merged.length === 0) {
      merged.push({ ...current });
      continue;
    }
    const last = merged[merged.length - 1];
    if (current.start <= last.end) {
      last.end = Math.max(last.end, current.end);
    } else {
      merged.push({ ...current });
    }
  }
  return merged;
}

function complementRanges(start: number, end: number, included: MinuteRange[]): MinuteRange[] {
  if (included.length === 0) return [];
  const out: MinuteRange[] = [];
  let cursor = start;

  for (const seg of included) {
    if (seg.start > cursor) out.push({ start: cursor, end: seg.start });
    cursor = Math.max(cursor, seg.end);
  }

  if (cursor < end) out.push({ start: cursor, end });
  return out;
}

export function AgendaDayView({
  date, barbers, turnos, bloqueos, servicios, horarios,
  onTurnoClick, onSlotClick, onMoveTurno, canDrag,
  zoomLevel, onAutoZoomSuggested,
}: AgendaDayViewProps) {
  const gridScrollRef = useRef<HTMLDivElement | null>(null);
  const lastAutoContextRef = useRef<string | null>(null);
  const isProgrammaticScrollRef = useRef(false);
  const manualScrollBaseContextRef = useRef<string | null>(null);
  const outerRef = useRef<HTMLDivElement | null>(null);
  const headerScrollRef = useRef<HTMLDivElement | null>(null);
  const bodyColumnsScrollRef = useRef<HTMLDivElement | null>(null);
  const isSyncingScrollRef = useRef(false);
  const [containerWidth, setContainerWidth] = useState(0);

  const pxPerMin = ZOOM_PX_PER_MIN[zoomLevel];
  const prevPxPerMinRef = useRef(pxPerMin);

  const dateStr = format(date, 'yyyy-MM-dd');
  const dayOfWeek = ((date.getDay() + 6) % 7) + 1; // ISO: 1=Mon..7=Sun

  const activeBarbers = useMemo(() => barbers.filter((b) => b.active), [barbers]);
  const colors = useBarberColors(activeBarbers.map((b) => b.id));

  const dayTurnos = useMemo(() => turnos.filter((t) => t.fecha === dateStr), [turnos, dateStr]);
  const dayBloqueos = useMemo(
    () => bloqueos.filter((b) => b.fecha_inicio <= dateStr && b.fecha_fin >= dateStr),
    [bloqueos, dateStr],
  );
  const dayOff = dayBloqueos.find((b) => b.barbero_id === null && b.todo_el_dia);

  // Determine visible time range
  const { rangeStart, rangeEnd } = useMemo(() => {
    let start = 8 * 60;
    let end = 22 * 60;

    horarios.forEach((h) => {
      if (h.dia_semana === dayOfWeek) {
        start = Math.min(start, timeToMinutes(h.hora_inicio));
        end = Math.max(end, timeToMinutes(h.hora_fin));
      }
    });

    dayTurnos.forEach((t) => {
      start = Math.min(start, timeToMinutes(t.hora_inicio));
      end = Math.max(end, timeToMinutes(t.hora_fin));
    });

    start = Math.floor(start / 60) * 60;
    end = Math.ceil(end / 60) * 60;
    return { rangeStart: start, rangeEnd: end };
  }, [horarios, dayOfWeek, dayTurnos]);

  const totalMins = rangeEnd - rangeStart;
  const totalHeight = totalMins * pxPerMin;
  const SLOT_MIN = 15;

  const hourRails = useMemo(() => {
    const rails: number[] = [];
    for (let m = rangeStart; m <= rangeEnd; m += 60) rails.push(m);
    return rails;
  }, [rangeStart, rangeEnd]);

  const halfHourRails = useMemo(() => {
    const rails: number[] = [];
    for (let m = rangeStart; m <= rangeEnd; m += 30) {
      if (m % 60 !== 0) rails.push(m);
    }
    return rails;
  }, [rangeStart, rangeEnd]);

  const isToday = isSameDay(date, new Date());
  const [nowMin, setNowMin] = useState(() => {
    const n = new Date();
    return n.getHours() * 60 + n.getMinutes();
  });

  useEffect(() => {
    if (!isToday) return;
    const i = setInterval(() => {
      const n = new Date();
      setNowMin(n.getHours() * 60 + n.getMinutes());
    }, 60_000);
    return () => clearInterval(i);
  }, [isToday]);

  const turnosByBarber: Record<string, Turno[]> = useMemo(() => {
    const map: Record<string, Turno[]> = {};
    activeBarbers.forEach((b) => { map[b.id] = []; });
    dayTurnos.forEach((t) => {
      if (!map[t.barbero_id]) map[t.barbero_id] = [];
      map[t.barbero_id].push(t);
    });
    return map;
  }, [activeBarbers, dayTurnos]);

  function computeLayouts(items: Turno[]) {
    const sorted = [...items].sort((a, b) => a.hora_inicio.localeCompare(b.hora_inicio));
    const groups: Turno[][] = [];

    sorted.forEach((t) => {
      const tStart = timeToMinutes(t.hora_inicio);
      const tEnd = timeToMinutes(t.hora_fin);
      let placed = false;

      for (const g of groups) {
        const overlaps = g.some((x) => {
          const xs = timeToMinutes(x.hora_inicio);
          const xe = timeToMinutes(x.hora_fin);
          return tStart < xe && xs < tEnd;
        });
        if (overlaps) {
          g.push(t);
          placed = true;
          break;
        }
      }

      if (!placed) groups.push([t]);
    });

    const result = new Map<string, { idx: number; count: number }>();
    groups.forEach((g) => {
      g.forEach((t, i) => result.set(t.id, { idx: i, count: g.length }));
    });
    return result;
  }

  const bloqueosByBarber: Record<string, Bloqueo[]> = useMemo(() => {
    const map: Record<string, Bloqueo[]> = {};
    activeBarbers.forEach((b) => { map[b.id] = []; });
    dayBloqueos.forEach((b) => {
      if (b.barbero_id && map[b.barbero_id]) map[b.barbero_id].push(b);
    });
    return map;
  }, [activeBarbers, dayBloqueos]);

  // Horarios resueltos por barbero (override > base)
  const baseHorarios = horarios.filter((h) => h.barbero_id === null && h.dia_semana === dayOfWeek);
  function getBarberHorarios(barberoId: string) {
    const overrides = horarios.filter((h) => h.barbero_id === barberoId && h.dia_semana === dayOfWeek);
    return overrides.length > 0 ? overrides : baseHorarios;
  }

  const generalWorkRanges = useMemo(() => {
    const dayRanges = baseHorarios
      .map((h) => ({
        start: Math.max(rangeStart, timeToMinutes(h.hora_inicio)),
        end: Math.min(rangeEnd, timeToMinutes(h.hora_fin)),
      }))
      .filter((r) => r.end > r.start);
    return mergeRanges(dayRanges);
  }, [baseHorarios, rangeStart, rangeEnd]);

  // Only paint outside-hours when explicit general schedule exists.
  const outsideWorkRanges = useMemo(() => {
    if (generalWorkRanges.length === 0) return [];
    return complementRanges(rangeStart, rangeEnd, generalWorkRanges);
  }, [generalWorkRanges, rangeStart, rangeEnd]);

  const generalWorkRangesSignature = useMemo(
    () => generalWorkRanges.map((r) => `${r.start}-${r.end}`).join('|'),
    [generalWorkRanges],
  );

  const baseAutoContextKey = useMemo(
    () => `${dateStr}|${activeBarbers.map((b) => b.id).join(',')}`,
    [dateStr, activeBarbers],
  );

  const fullAutoContextKey = useMemo(
    () => `${baseAutoContextKey}|${rangeStart}-${rangeEnd}|${generalWorkRangesSignature}`,
    [baseAutoContextKey, rangeStart, rangeEnd, generalWorkRangesSignature],
  );

  // "Rango laboral completo" para el auto-cálculo de zoom: el span entre el
  // primer y último horario general. Sin horario general explícito, se usa
  // el rango visible completo del día como referencia (no hay "horario" al
  // que ajustarse).
  const workSpanMinutes = useMemo(() => {
    if (generalWorkRanges.length === 0) return totalMins;
    const first = generalWorkRanges[0];
    const last = generalWorkRanges[generalWorkRanges.length - 1];
    return last.end - first.start;
  }, [generalWorkRanges, totalMins]);

  const shortestTurnoMin = useMemo(() => {
    if (dayTurnos.length === 0) return null;
    return Math.min(...dayTurnos.map((t) => timeToMinutes(t.hora_fin) - timeToMinutes(t.hora_inicio)));
  }, [dayTurnos]);

  // Auto-sugerencia de zoom: corre al entrar a la vista o cambiar de
  // contexto (día/rango/horario general — mismo disparador que el resto de
  // los efectos de auto-posicionamiento de este archivo). Solo SUGIERE vía
  // callback; quien decide si se aplica (respetando un override manual del
  // usuario para este día) es AgendaPanel, que es dueño del ToggleGroup y
  // del valor de zoomLevel aplicado.
  useLayoutEffect(() => {
    const el = gridScrollRef.current;
    if (!el || el.clientHeight <= 0) return;
    const auto = pickAutoZoomLevel(workSpanMinutes, el.clientHeight, shortestTurnoMin);
    onAutoZoomSuggested(auto);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseAutoContextKey, workSpanMinutes, shortestTurnoMin]);

  const MIN_COL_WIDTH = 160;
  const TIME_RAIL_WIDTH = 56;

  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setContainerWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const colWidth = useMemo(() => {
    if (activeBarbers.length === 0 || containerWidth === 0) return MIN_COL_WIDTH;
    return Math.max(MIN_COL_WIDTH, (containerWidth - TIME_RAIL_WIDTH) / activeBarbers.length);
  }, [containerWidth, activeBarbers.length]);

  const handleHeaderScroll = useCallback(() => {
    if (isSyncingScrollRef.current) return;
    isSyncingScrollRef.current = true;
    if (bodyColumnsScrollRef.current && headerScrollRef.current) {
      bodyColumnsScrollRef.current.scrollLeft = headerScrollRef.current.scrollLeft;
    }
    requestAnimationFrame(() => { isSyncingScrollRef.current = false; });
  }, []);

  const handleBodyColumnsScroll = useCallback(() => {
    if (isSyncingScrollRef.current) return;
    isSyncingScrollRef.current = true;
    if (headerScrollRef.current && bodyColumnsScrollRef.current) {
      headerScrollRef.current.scrollLeft = bodyColumnsScrollRef.current.scrollLeft;
    }
    requestAnimationFrame(() => { isSyncingScrollRef.current = false; });
  }, []);

  // Resolve drop target via DOM hit-test on data-col-root columns.
  // pxPerMin en deps es crítico: sin esto, un drop calcularía la hora con el
  // zoom vigente al momento en que este callback se memoizó por última vez,
  // no el zoom actual — un turno se movería a un horario equivocado sin
  // ningún error visible.
  const resolveDrop = useCallback((x: number, y: number): { barberoId: string; horaInicio: string } | null => {
    if (dayOff) return null;
    const stack = (typeof document !== 'undefined' ? document.elementsFromPoint(x, y) : []) as HTMLElement[];
    const col = stack.find((el) => el?.dataset?.colRoot === 'true') as HTMLElement | undefined;
    if (!col) return null;
    const barberoId = col.dataset.barberoId;
    if (!barberoId) return null;
    const rect = col.getBoundingClientRect();
    const offY = y - rect.top;
    const minRaw = offY / pxPerMin + rangeStart;
    const snapped = Math.round(minRaw / SLOT_MIN) * SLOT_MIN;
    const clamped = Math.max(rangeStart, Math.min(rangeEnd - SLOT_MIN, snapped));
    return { barberoId, horaInicio: minutesToTime(clamped) };
  }, [dayOff, rangeStart, rangeEnd, pxPerMin]);

  const handleTurnoTap = useCallback((t: Turno) => onTurnoClick(t), [onTurnoClick]);
  const handleTurnoDrop = useCallback((t: Turno, x: number, y: number) => {
    const target = resolveDrop(x, y);
    if (!target) return;
    onMoveTurno(t, target.barberoId, target.horaInicio, dateStr);
  }, [resolveDrop, onMoveTurno, dateStr]);

  const ghostLabel = useCallback((t: Turno, x: number, y: number) => {
    const target = resolveDrop(x, y);
    const hora = target?.horaInicio ?? formatHHMM(t.hora_inicio);
    const name = t.cliente_nombre || 'Sin nombre';
    return `${hora} - ${name}`;
  }, [resolveDrop]);

  const { getHandlers: getTurnoHandlers, ghost } = usePointerDragDrop<Turno>({
    enabled: canDrag && !dayOff,
    canDragItem: (t) => ['pendiente', 'confirmado'].includes(t.estado),
    onTap: handleTurnoTap,
    onDrop: handleTurnoDrop,
    buildGhostLabel: ghostLabel,
  });

  const handleGridScroll = useCallback(() => {
    if (isProgrammaticScrollRef.current) {
      isProgrammaticScrollRef.current = false;
      return;
    }
    manualScrollBaseContextRef.current = baseAutoContextKey;
  }, [baseAutoContextKey]);

  // Initial scroll positioning inside the day-grid body only.
  useEffect(() => {
    const el = gridScrollRef.current;
    if (!el) return;
    if (manualScrollBaseContextRef.current === baseAutoContextKey) return;
    if (lastAutoContextRef.current === fullAutoContextKey) return;
    if (el.clientHeight <= 0) return;

    const firstRange = generalWorkRanges[0];
    const lastRange = generalWorkRanges[generalWorkRanges.length - 1];
    let anchorMinute = rangeStart;

    if (generalWorkRanges.length === 0) {
      anchorMinute = isToday ? Math.min(rangeEnd, Math.max(rangeStart, nowMin)) : rangeStart;
    } else if (!isToday) {
      anchorMinute = Math.max(rangeStart, firstRange.start - 30);
    } else if (nowMin < firstRange.start) {
      anchorMinute = Math.max(rangeStart, firstRange.start - 30);
    } else if (nowMin > lastRange.end) {
      anchorMinute = Math.max(rangeStart, lastRange.end - 30);
    } else {
      const inActiveRange = generalWorkRanges.some((r) => nowMin >= r.start && nowMin <= r.end);
      if (inActiveRange) {
        anchorMinute = nowMin;
      } else {
        const nextRange = generalWorkRanges.find((r) => r.start > nowMin);
        anchorMinute = nextRange
          ? Math.max(rangeStart, nextRange.start - 30)
          : Math.max(rangeStart, lastRange.end - 30);
      }
    }

    const anchorY = (anchorMinute - rangeStart) * pxPerMin;
    const desiredScrollTop = anchorY - el.clientHeight / 2;
    const maxScrollTop = Math.max(0, totalHeight - el.clientHeight);
    const finalScrollTop = Math.max(0, Math.min(maxScrollTop, desiredScrollTop));

    requestAnimationFrame(() => {
      isProgrammaticScrollRef.current = true;
      el.scrollTop = finalScrollTop;
      lastAutoContextRef.current = fullAutoContextKey;
    });
  }, [
    baseAutoContextKey,
    fullAutoContextKey,
    generalWorkRanges,
    isToday,
    nowMin,
    pxPerMin,
    rangeEnd,
    rangeStart,
    totalHeight,
  ]);

  // Reanclaje por cambio de zoom (riesgo #2): preserva el minuto que estaba
  // centrado en el viewport antes del cambio de nivel, en vez de dejar que
  // el scroll salte a una hora distinta porque cambió la altura total.
  //
  // Se apoya en lastAutoContextRef (seteado arriba, dentro del rAF del
  // posicionamiento inicial) para saber si el posicionamiento "real" de
  // este día ya se aplicó de verdad. Mientras no se haya aplicado —incluida
  // la cascada de montaje, donde la auto-sugerencia de zoom puede cambiar
  // zoomLevel antes de que el rAF de arriba llegue a correr— este efecto no
  // toca el scroll, para no pelear con esa posición inicial. Una vez
  // asentada, cualquier cambio posterior de pxPerMin (override manual, o
  // una resugerencia automática por cambio de datos en el mismo día) sí
  // reancla en vez de dejar que salte.
  //
  // fullAutoContextKey NO incluye el zoom a propósito: es la identidad de
  // "qué día/rango estoy mirando", y el zoom es ortogonal a eso — meterlo
  // ahí haría que cada cambio de zoom se tratara como "día nuevo" y
  // reactivara el posicionamiento por nowMin/horario en vez del reanclaje
  // por minuto centrado.
  useLayoutEffect(() => {
    const el = gridScrollRef.current;
    const prevPxPerMin = prevPxPerMinRef.current;
    prevPxPerMinRef.current = pxPerMin;

    if (!el || prevPxPerMin === pxPerMin) return;
    if (lastAutoContextRef.current !== fullAutoContextKey) return;

    const centerMinute = (el.scrollTop + el.clientHeight / 2) / prevPxPerMin + rangeStart;
    const newCenterY = (centerMinute - rangeStart) * pxPerMin;
    const maxScrollTop = Math.max(0, totalHeight - el.clientHeight);
    isProgrammaticScrollRef.current = true;
    el.scrollTop = Math.max(0, Math.min(maxScrollTop, newCenterY - el.clientHeight / 2));
  }, [pxPerMin, fullAutoContextKey, rangeStart, totalHeight]);

  return (
    <div ref={outerRef} className="bg-card overflow-clip">
      {/* Header */}
      <div className="flex border-b bg-muted/30 sticky top-0 z-20">
        <div className="shrink-0 border-r" style={{ width: TIME_RAIL_WIDTH }} />
        <div ref={headerScrollRef} className="flex overflow-x-auto scrollbar-hide" onScroll={handleHeaderScroll}>
          {activeBarbers.map((b) => (
            <div
              key={b.id}
              className="shrink-0 px-3 py-2 border-r flex items-center gap-2"
              style={{ width: colWidth, borderLeft: `3px solid ${colors[b.id]}` }}
            >
              <span className="text-sm font-medium truncate">{b.firstName} {b.lastName}</span>
            </div>
          ))}
          {activeBarbers.length === 0 && (
            <div className="px-4 py-2 text-xs text-muted-foreground">No hay barberos activos en esta sucursal.</div>
          )}
        </div>
      </div>

      {/* Body */}
      <div
        ref={gridScrollRef}
        onScroll={handleGridScroll}
        className="overflow-y-auto overscroll-contain"
        style={{ maxHeight: 'clamp(600px, calc(100vh - 180px), 1100px)' }}
      >
        <div className="flex relative" style={{ height: totalHeight }}>
          {/* Time rail */}
          <div className="shrink-0 border-r relative" style={{ width: TIME_RAIL_WIDTH }}>
            {hourRails.map((m) => (
              <div
                key={m}
                className="absolute left-0 right-0 text-[10px] text-muted-foreground px-1 -translate-y-1/2"
                style={{ top: (m - rangeStart) * pxPerMin }}
              >
                {minutesToTime(m)}
              </div>
            ))}
          </div>

          {/* Columns */}
          <div ref={bodyColumnsScrollRef} className="flex overflow-x-auto relative flex-1" onScroll={handleBodyColumnsScroll}>
            {activeBarbers.map((b) => {
              const barberTurnos = turnosByBarber[b.id] || [];
              const layouts = computeLayouts(barberTurnos);
              const barberHorarios = getBarberHorarios(b.id);
              const works = barberHorarios.length > 0;
              const blocks = bloqueosByBarber[b.id] || [];

              return (
                <BarberColumn
                  key={b.id}
                  barberId={b.id}
                  width={colWidth}
                  works={works}
                >
                  {/* Outside-of-hours visual reference (general schedule only) */}
                  {outsideWorkRanges.map((r, idx) => (
                    <div
                      key={`outside-${idx}-${r.start}-${r.end}`}
                      className="absolute left-0 right-0 pointer-events-none"
                      style={{
                        top: (r.start - rangeStart) * pxPerMin,
                        height: (r.end - r.start) * pxPerMin,
                        backgroundColor: 'hsl(var(--muted) / 0.22)',
                        backgroundImage:
                          'repeating-linear-gradient(135deg, hsl(var(--muted-foreground) / 0.10) 0px, hsl(var(--muted-foreground) / 0.10) 1px, transparent 1px, transparent 7px)',
                      }}
                    />
                  ))}

                  {/* Hour grid lines */}
                  {hourRails.slice(0, -1).map((m) => (
                    <div
                      key={m}
                      className="absolute left-0 right-0 border-t border-border/55 pointer-events-none"
                      style={{ top: (m - rangeStart) * pxPerMin }}
                    />
                  ))}

                  {/* Half-hour grid lines */}
                  {halfHourRails.map((m) => (
                    <div
                      key={`half-${m}`}
                      className="absolute left-0 right-0 border-t border-border/30 pointer-events-none"
                      style={{ top: (m - rangeStart) * pxPerMin }}
                    />
                  ))}

                  {/* Working hours tap areas */}
                  {works && barberHorarios.map((h) => (
                    <SlotTapArea
                      key={h.id}
                      top={(timeToMinutes(h.hora_inicio) - rangeStart) * pxPerMin}
                      height={(timeToMinutes(h.hora_fin) - timeToMinutes(h.hora_inicio)) * pxPerMin}
                      onTap={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const offY = e.clientY - rect.top;
                        const min = Math.round(offY / pxPerMin / SLOT_MIN) * SLOT_MIN + timeToMinutes(h.hora_inicio);
                        onSlotClick(b.id, minutesToTime(min));
                      }}
                    />
                  ))}

                  {/* Bloqueos del barbero */}
                  {blocks.map((bl) => {
                    if (bl.todo_el_dia) {
                      return (
                        <div
                          key={bl.id}
                          className="absolute inset-0 z-[4] flex items-center justify-center pointer-events-none"
                          style={{ backgroundColor: 'hsl(var(--muted) / 0.96)' }}
                        >
                          <span className="relative z-30 text-[10px] font-medium text-foreground/80 rotate-90">
                            No disponible
                          </span>
                        </div>
                      );
                    }
                    if (!bl.hora_inicio || !bl.hora_fin) return null;
                    const top = (timeToMinutes(bl.hora_inicio) - rangeStart) * pxPerMin;
                    const height = (timeToMinutes(bl.hora_fin) - timeToMinutes(bl.hora_inicio)) * pxPerMin;
                    return (
                      <div
                        key={bl.id}
                        className="absolute left-0 right-0 z-[4] border-l-2 border-muted-foreground/45 pointer-events-none"
                        style={{
                          top,
                          height,
                          backgroundColor: 'hsl(var(--muted) / 0.96)',
                        }}
                        title={bl.motivo || 'No disponible'}
                      />
                    );
                  })}

                  {/* Turnos */}
                  {barberTurnos.map((t) => {
                    const top = (timeToMinutes(t.hora_inicio) - rangeStart) * pxPerMin;
                    const height = Math.max(20, (timeToMinutes(t.hora_fin) - timeToMinutes(t.hora_inicio)) * pxPerMin);
                    const layout = layouts.get(t.id) || { idx: 0, count: 1 };
                    const widthPct = 100 / layout.count;
                    const leftPct = widthPct * layout.idx;
                    const servicio = servicios.find((s) => s.id === t.servicio_id);
                    const borderColor = servicio?.linea_color ?? 'hsl(var(--border))';
                    const isPending = t.estado === 'pendiente';
                    const turnoHandlers = getTurnoHandlers(t);

                    return (
                      <div
                        key={t.id}
                        {...turnoHandlers}
                        className={cn(
                          'absolute z-[6] hover:z-[8] rounded-md py-1 px-1.5 cursor-pointer hover:shadow-sm transition duration-150 ease-out active:scale-[0.97] overflow-hidden bg-card select-none',
                          isPending ? 'border border-dashed' : 'border',
                        )}
                        style={{
                          top,
                          height,
                          left: `calc(${leftPct}% + 2px)`,
                          width: `calc(${widthPct}% - 4px)`,
                          borderLeft: `3px solid ${borderColor}`,
                          touchAction: 'pan-y',
                          WebkitUserSelect: 'none',
                          WebkitTouchCallout: 'none',
                        }}
                      >
                        {/* Escalera de contenido por altura de tarjeta (Build B):
                            <32px sólo nombre · 32-45px +hora · 45px+ +servicio.
                            Sin "+barbero": en vista Día cada columna ya ES un
                            barbero, agregarlo repetiría el dato. */}
                        {height >= 32 && (
                          <div className="text-[10px] font-mono text-muted-foreground leading-tight">
                            {formatHHMM(t.hora_inicio)} → {formatHHMM(t.hora_fin)}
                          </div>
                        )}
                        <div className="text-xs font-medium text-foreground truncate leading-tight">
                          {t.cliente_nombre || 'Sin nombre'}
                        </div>
                        {height >= 45 && (
                          <div className="text-[10px] text-muted-foreground truncate leading-tight">
                            {servicio?.nombre || 'Servicio'}
                          </div>
                        )}
                        {t.eligio_barbero && (
                          <div
                            title="Eligió barbero específico"
                            style={{
                              position: 'absolute',
                              top: 4,
                              right: 4,
                              width: 14,
                              height: 14,
                              borderRadius: '50%',
                              backgroundColor: colors[t.barbero_id] ?? 'hsl(var(--primary))',
                              boxShadow: '0 0 0 2px hsl(var(--card))',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0,
                              zIndex: 2,
                            }}
                          >
                            <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                              <circle cx="4" cy="2.5" r="1.5" fill="white"/>
                              <path d="M1 7c0-1.657 1.343-3 3-3s3 1.343 3 3" stroke="white" strokeWidth="1"/>
                            </svg>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </BarberColumn>
              );
            })}

            {/* Now line */}
            {isToday && nowMin >= rangeStart && nowMin <= rangeEnd && (
              <div
                className="absolute left-0 right-0 h-px bg-destructive z-[2] pointer-events-none"
                style={{ top: (nowMin - rangeStart) * pxPerMin }}
              >
                <div className="absolute -left-1 -top-1 w-2 h-2 rounded-full bg-destructive" />
              </div>
            )}

            {/* Day off overlay */}
            {dayOff && (
              <div className="absolute inset-0 bg-muted/72 z-[10] flex items-center justify-center">
                <div className="text-center space-y-1 bg-card border rounded-lg px-4 py-3 shadow-sm">
                  <div className="text-sm font-medium text-foreground">Dia cerrado</div>
                  {dayOff.motivo && <div className="text-xs text-muted-foreground">{dayOff.motivo}</div>}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Drag ghost */}
      {ghost && (
        <div
          className="fixed z-[80] pointer-events-none"
          style={{
            left: 0,
            top: 0,
            transform: `translate(${ghost.x + 12}px, ${ghost.y + 12}px)`,
          }}
        >
          <div className="animate-in zoom-in-95 fade-in duration-tooltip ease-out rounded-md border bg-card px-2 py-1 text-xs shadow-md">
            <span className="font-medium text-foreground">{ghost.label}</span>
          </div>
        </div>
      )}
    </div>
  );
}

interface BarberColumnProps {
  barberId: string;
  width: number;
  works: boolean;
  children: React.ReactNode;
}

function BarberColumn({ barberId, width, works, children }: BarberColumnProps) {
  return (
    <div
      data-col-root="true"
      data-barbero-id={barberId}
      className={cn('shrink-0 border-r relative', !works && 'bg-muted/58')}
      style={{ width, touchAction: 'pan-y' }}
    >
      {children}
    </div>
  );
}

interface SlotTapAreaProps {
  top: number;
  height: number;
  onTap: (e: React.PointerEvent<HTMLDivElement>) => void;
}

function SlotTapArea({ top, height, onTap }: SlotTapAreaProps) {
  const handlers = usePointerTap((e) => onTap(e as React.PointerEvent<HTMLDivElement>));
  return (
    <div
      className="absolute left-0 right-0 bg-transparent"
      style={{ top, height, touchAction: 'pan-y' }}
      {...handlers}
    />
  );
}
