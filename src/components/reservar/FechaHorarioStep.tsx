import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar } from "@/components/ui/calendar";
import { AlertCircle, UserRound, Check, CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { format, addDays } from "date-fns";
import { es } from "date-fns/locale";

interface Slot {
  hora_inicio: string;
  hora_fin: string;
  barberos: { id: string; nombre?: string }[];
}

interface DayItem {
  date: Date;
  dateStr: string;
  dayNum: number;
  dayName: string;
}

interface Props {
  organizationId: string;
  sucursalId: string;
  servicioId: string;
  barberoId: string | null;
  onSelect: (horaInicio: string, horaFin: string, fecha: string, barberoId?: string, barberoNombre?: string) => void;
  onChangeBarbero: () => void;
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function buildDays(count: number): DayItem[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Array.from({ length: count }, (_, i) => {
    const d = addDays(today, i);
    return {
      date: d,
      dateStr: toDateStr(d),
      dayNum: d.getDate(),
      dayName: format(d, "EEE", { locale: es }),
    };
  });
}

export const FechaHorarioStep = ({
  organizationId, sucursalId, servicioId, barberoId,
  onSelect, onChangeBarbero,
}: Props) => {
  const allDays = useRef(buildDays(30)).current;
  const todayDate = useRef((() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })()).current;

  // Strip state
  const [stripDays, setStripDays] = useState<DayItem[]>([]);
  const [dayStatusMap, setDayStatusMap] = useState<Map<string, boolean>>(new Map());
  const [maxDate, setMaxDate] = useState<Date | null>(null);
  const [loadingStrip, setLoadingStrip] = useState(true);
  const [showCalendar, setShowCalendar] = useState(false);

  // Selected date & slot state
  const [fecha, setFecha] = useState<string | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);

  const slotsRef = useRef<HTMLDivElement>(null);

  const selectedDay = fecha ? (allDays.find((d) => d.dateStr === fecha) ?? stripDays.find((d) => d.dateStr === fecha)) : null;
  const monthLabel = selectedDay ? format(selectedDay.date, "MMMM 'de' yyyy", { locale: es }) : "";

  // ── Load available dates from backend ──────────────────────────────────────
  useEffect(() => {
    const fetchAvailableDates = async () => {
      setLoadingStrip(true);
      setFecha(null);
      setStripDays([]);
      setDayStatusMap(new Map());
      setShowCalendar(false);
      setSlots([]);
      setError(null);

      try {
        const { data, error: fnError } = await supabase.functions.invoke("get-available-dates", {
          body: {
            organization_id: organizationId,
            sucursal_id: sucursalId,
            servicio_id: servicioId,
            barbero_id: barberoId,
            from_date: allDays[0].dateStr,
            to_date: allDays[allDays.length - 1].dateStr,
          },
        });

        if (fnError || data?.error) {
          setStripDays([]);
          return;
        }

        const availableDates: string[] = data.available_dates || [];
        const maxDateStr: string | undefined = data.max_date;

        // Build status map for all days in the pool
        const newMap = new Map<string, boolean>();
        const availableSet = new Set(availableDates);
        for (const d of allDays) {
          newMap.set(d.dateStr, availableSet.has(d.dateStr));
        }
        setDayStatusMap(newMap);

        // First 5 available days for the ribbon
        const strip = allDays.filter((d) => availableSet.has(d.dateStr)).slice(0, 5);
        setStripDays(strip);

        if (strip.length > 0) setFecha(strip[0].dateStr);

        if (maxDateStr) setMaxDate(new Date(maxDateStr + "T12:00:00"));
      } catch {
        setStripDays([]);
      } finally {
        setLoadingStrip(false);
      }
    };

    fetchAvailableDates();
  }, [organizationId, sucursalId, servicioId, barberoId]);

  // ── Fetch slots for selected date ──────────────────────────────────────────
  useEffect(() => {
    if (!fecha) return;

    const fetchSlots = async () => {
      setLoading(true);
      setError(null);
      setSelectedSlot(null);
      try {
        const { data, error: fnError } = await supabase.functions.invoke("get-availability", {
          body: {
            organization_id: organizationId,
            sucursal_id: sucursalId,
            servicio_id: servicioId,
            fecha,
            barbero_id: barberoId,
          },
        });
        if (fnError || data?.error) {
          setError(data?.error || "Error al consultar disponibilidad");
          return;
        }
        setSlots(data.slots || []);
      } catch {
        setError("Error de conexión");
      } finally {
        setLoading(false);
      }
    };
    fetchSlots();
  }, [organizationId, sucursalId, servicioId, barberoId, fecha]);

  useEffect(() => {
    if (!loading && slots.length > 0 && slotsRef.current) {
      slotsRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [loading, slots]);

  // ── Calendar selection handler ─────────────────────────────────────────────
  const handleCalendarSelect = (date: Date | undefined) => {
    if (!date) return;
    const ds = toDateStr(date);
    setShowCalendar(false);
    setStripDays((prev) => {
      if (prev.find((d) => d.dateStr === ds)) return prev;
      const dayObj = allDays.find((d) => d.dateStr === ds) ?? {
        date,
        dateStr: ds,
        dayNum: date.getDate(),
        dayName: format(date, "EEE", { locale: es }),
      };
      if (prev.length < 5) return [...prev, dayObj];
      return [...prev.slice(0, 4), dayObj];
    });
    setFecha(ds);
  };

  // ── Render slots ───────────────────────────────────────────────────────────
  const renderSlots = () => {
    if (!fecha) return null;

    if (loading) {
      return (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-md" />
          ))}
        </div>
      );
    }

    if (error) {
      return (
        <div className="text-center space-y-3 py-4">
          <AlertCircle className="h-10 w-10 text-destructive mx-auto" />
          <p className="text-foreground font-medium">{error}</p>
        </div>
      );
    }

    if (slots.length === 0) {
      return (
        <div className="space-y-4 py-4">
          <div className="text-center space-y-2">
            <AlertCircle className="h-10 w-10 text-muted-foreground mx-auto" />
            <h3 className="text-base font-semibold text-foreground">
              No hay turnos disponibles para esta fecha
            </h3>
            <p className="text-sm text-muted-foreground">
              Probá con otro día o cambiá de barbero.
            </p>
          </div>
          <Button variant="outline" className="w-full gap-2 h-12" onClick={onChangeBarbero}>
            <UserRound className="h-4 w-4" /> Elegir otro barbero
          </Button>
        </div>
      );
    }

    return (
      <div ref={slotsRef} className="space-y-2">
        <p className="text-sm text-muted-foreground">
          {slots.length} {slots.length === 1 ? "turno disponible" : "turnos disponibles"}
        </p>
        {slots.map((slot) => {
          const isSelected = selectedSlot === slot.hora_inicio;
          return (
            <Button
              key={slot.hora_inicio}
              variant={isSelected ? "default" : "outline"}
              className={cn(
                "w-full h-12 text-base font-medium justify-start transition-colors",
                isSelected && "ring-2 ring-primary ring-offset-2 ring-offset-background"
              )}
              onClick={() => {
                setSelectedSlot(slot.hora_inicio);
                const b = slot.barberos[0];
                onSelect(slot.hora_inicio, slot.hora_fin, fecha, b?.id, b?.nombre);
              }}
            >
              {isSelected && <Check className="h-4 w-4 mr-2" />}
              {slot.hora_inicio}
            </Button>
          );
        })}
      </div>
    );
  };

  // ── No available days at all ───────────────────────────────────────────────
  if (!loadingStrip && stripDays.length === 0) {
    return (
      <div className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-foreground">Elegí fecha y horario</h2>
        </div>
        <div className="space-y-4 py-4">
          <div className="text-center space-y-2">
            <AlertCircle className="h-10 w-10 text-muted-foreground mx-auto" />
            <h3 className="text-base font-semibold text-foreground">
              No hay turnos próximos disponibles
            </h3>
            <p className="text-sm text-muted-foreground">
              Intentá con otro barbero o volvé más tarde.
            </p>
          </div>
          <Button variant="outline" className="w-full gap-2 h-12" onClick={onChangeBarbero}>
            <UserRound className="h-4 w-4" /> Elegir otro barbero
          </Button>
        </div>
      </div>
    );
  }

  // ── Main render ────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1 min-w-0">
          <h2 className="text-base font-semibold text-foreground">Elegí fecha y horario</h2>
          {monthLabel && (
            <p className="text-xs text-muted-foreground capitalize">{monthLabel}</p>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 gap-1.5"
          onClick={() => setShowCalendar((v) => !v)}
        >
          <CalendarIcon className="h-3.5 w-3.5" />
          Ver más
        </Button>
      </div>

      {/* Short ribbon — max 5 days */}
      <div className="flex gap-2">
        {loadingStrip
          ? [...Array(5)].map((_, i) => (
              <Skeleton key={i} className="shrink-0 w-12 h-16 rounded-xl" />
            ))
          : stripDays.map((d) => {
              const active = d.dateStr === fecha;
              return (
                <button
                  key={d.dateStr}
                  onClick={() => setFecha(d.dateStr)}
                  className={cn(
                    "flex flex-col items-center justify-center shrink-0 w-12 h-16 rounded-xl text-sm font-medium transition-colors",
                    active
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "bg-muted/50 text-foreground hover:bg-accent"
                  )}
                >
                  <span className="text-base font-semibold leading-tight">{d.dayNum}</span>
                  <span className="text-[11px] capitalize leading-tight mt-0.5">{d.dayName}</span>
                </button>
              );
            })}
      </div>

      {/* Calendar inline */}
      {showCalendar && (
        <div className="rounded-xl border border-border bg-card p-2">
          <Calendar
            mode="single"
            selected={fecha ? new Date(fecha + "T12:00:00") : undefined}
            onSelect={handleCalendarSelect}
            disabled={(date) =>
              date < todayDate ||
              (maxDate ? date > maxDate : false) ||
              dayStatusMap.get(toDateStr(date)) === false
            }
            locale={es}
          />
        </div>
      )}

      {/* Time slots */}
      {renderSlots()}
    </div>
  );
};
