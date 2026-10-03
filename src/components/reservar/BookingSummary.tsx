import { Fragment, useLayoutEffect, useRef } from "react";
import { MapPin, Scissors, User, CalendarDays, Clock, Sparkles } from "lucide-react";
import type { BookingState } from "./BookingStepper";
import { formatFechaLegible } from "@/lib/dateUtils";

interface Props {
  booking: BookingState;
  stepLabel?: string;
  variant?: "chip" | "full";
  className?: string;
}

interface RowProps {
  icon: React.ReactNode;
  label: string;
  value: string | null;
  accent?: boolean;
}

const Row = ({ icon, label, value, accent }: RowProps) => (
  <div className="flex items-start gap-3">
    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground">
      {icon}
    </div>
    <div className="min-w-0 flex-1">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p
        className={
          value
            ? `truncate text-sm font-medium ${accent ? "text-primary" : "text-foreground"}`
            : "truncate text-sm text-muted-foreground/70"
        }
      >
        {value || "—"}
      </p>
    </div>
  </div>
);

const FullSummary = ({ booking, stepLabel }: { booking: BookingState; stepLabel?: string }) => {
  const hasAny =
    booking.sucursalNombre ||
    booking.servicioNombre ||
    booking.barberoNombre ||
    booking.fecha ||
    booking.horaInicio;

  return (
    <aside className="rounded-2xl border border-border/60 bg-muted/40 p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Tu reserva</h3>
        {stepLabel && (
          <span className="rounded-full border border-border/60 bg-background px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            {stepLabel}
          </span>
        )}
      </div>

      <div className="space-y-3.5">
        <Row icon={<MapPin className="h-3.5 w-3.5" />} label="Sucursal" value={booking.sucursalNombre || null} />
        <Row icon={<Scissors className="h-3.5 w-3.5" />} label="Servicio" value={booking.servicioNombre || null} />
        <Row icon={<User className="h-3.5 w-3.5" />} label="Barbero" value={booking.barberoNombre || null} />
        <Row icon={<CalendarDays className="h-3.5 w-3.5" />} label="Fecha" value={booking.fecha ? formatFechaLegible(booking.fecha) : null} />
        <Row
          icon={<Clock className="h-3.5 w-3.5" />}
          label="Hora"
          value={booking.horaInicio ? `${booking.horaInicio}${booking.horaFin ? ` – ${booking.horaFin}` : ""}` : null}
        />
        {booking.servicioPrecio > 0 && (
          <div className="mt-3 flex items-center justify-between rounded-lg border border-border/60 bg-background px-3 py-2">
            <span className="text-xs font-medium text-muted-foreground">Total</span>
            <span className="text-sm font-semibold text-primary">
              ${booking.servicioPrecio.toLocaleString("es-AR")}
            </span>
          </div>
        )}
      </div>

      {!hasAny && (
        <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
          <Sparkles className="h-3 w-3" />
          Empezá eligiendo una sucursal.
        </p>
      )}
    </aside>
  );
};

const ChipSummary = ({ booking }: { booking: BookingState }) => {
  const parts: string[] = [];
  if (booking.sucursalNombre) parts.push(booking.sucursalNombre);
  if (booking.servicioNombre) parts.push(booking.servicioNombre);
  if (booking.barberoNombre) parts.push(booking.barberoNombre);
  if (booking.fecha) {
    parts.push(
      `${formatFechaLegible(booking.fecha)}${booking.horaInicio ? ` · ${booking.horaInicio}` : ""}`
    );
  }

  if (parts.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-dashed border-border/60 bg-muted/40 px-3.5 py-3 text-xs text-muted-foreground">
        <Sparkles className="h-3.5 w-3.5 shrink-0" />
        Elegí una sucursal para empezar.
      </div>
    );
  }

  return (
    <p
      aria-label={`Tu reserva: ${parts.join(", ")}`}
      className="overflow-hidden rounded-xl border border-border/60 bg-muted/40 px-3.5 py-3 text-sm leading-snug break-words"
    >
      {parts.map((value, i) => {
        const isLast = i === parts.length - 1;
        return (
          <Fragment key={i}>
            {i > 0 && (
              <span aria-hidden className="text-muted-foreground/40">
                {" › "}
              </span>
            )}
            <span className={isLast ? "font-medium text-foreground" : "text-muted-foreground"}>
              {value}
            </span>
          </Fragment>
        );
      })}
    </p>
  );
};

export const BookingSummary = ({ booking, stepLabel, variant = "full", className }: Props) => {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const lastHeight = useRef<number | null>(null);
  const prevVariant = useRef(variant);

  // Anima la altura solo cuando cambia el modo (chip <-> full). Los cambios
  // incidentales de contenido (ej: aparece el total) no disparan animación, así
  // la instancia desktop —que nunca cambia de variant— queda idéntica a antes.
  useLayoutEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;

    const newHeight = el.offsetHeight;
    const variantChanged = prevVariant.current !== variant;
    const from = lastHeight.current;
    prevVariant.current = variant;
    lastHeight.current = newHeight;

    if (!variantChanged || from === null || from === newHeight) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    el.style.overflow = "hidden";
    el.style.height = `${from}px`;
    el.style.opacity = "0.35";
    void el.offsetHeight; // reflow para fijar el punto de partida
    el.style.transition = "height 220ms var(--ease-out-quint), opacity 200ms ease-out";
    el.style.height = `${newHeight}px`;
    el.style.opacity = "1";

    const cleanup = () => {
      el.style.height = "";
      el.style.transition = "";
      el.style.overflow = "";
      el.style.opacity = "";
      el.removeEventListener("transitionend", onEnd);
    };
    const onEnd = (e: TransitionEvent) => {
      if (e.propertyName === "height") cleanup();
    };
    el.addEventListener("transitionend", onEnd);
  });

  return (
    <div ref={wrapperRef} className={className}>
      {variant === "chip" ? (
        <ChipSummary booking={booking} />
      ) : (
        <FullSummary booking={booking} stepLabel={stepLabel} />
      )}
    </div>
  );
};
