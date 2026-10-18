import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { formatMinutesToText } from "../_shared/formatMinutes.ts";
import { canonicalPhoneOrNull } from "../_shared/phone.ts";
import {
  findConflictingTurnos,
  isBlockedByBloqueo,
  isWithinWorkingHours,
} from "../_shared/availability.ts";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function minutesToTime(m: number): string {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function slotInstantMs(fecha: string, hora: string, tz: string): number {
  const [Y, M, D] = fecha.split("-").map(Number);
  const [h, m] = hora.split(":").map(Number);
  const utcGuess = Date.UTC(Y, M - 1, D, h, m);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date(utcGuess)).map((p) => [p.type, p.value]));
  let hh = +parts.hour;
  if (hh === 24) hh = 0;
  const asTzMs = Date.UTC(+parts.year, +parts.month - 1, +parts.day, hh, +parts.minute);
  const offset = asTzMs - utcGuess;
  return utcGuess - offset;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { turno_id, nueva_fecha, nueva_hora_inicio, telefono } = body;

    if (!turno_id || !nueva_fecha || !nueva_hora_inicio || !telefono) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const phone = canonicalPhoneOrNull(telefono);
    if (!phone) {
      return new Response(JSON.stringify({ error: "Invalid phone" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: turno, error: turnoError } = await supabase
      .from("turnos")
      .select("id, cliente_telefono, estado, fecha, hora_inicio, hora_fin, organization_id, sucursal_id, barbero_id, servicio_id")
      .eq("id", turno_id)
      .single();

    if (turnoError || !turno) {
      return new Response(JSON.stringify({ error: "Turno not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (turno.cliente_telefono !== phone) {
      return new Response(JSON.stringify({ error: "Not authorized" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!["pendiente", "confirmado"].includes(turno.estado)) {
      return new Response(JSON.stringify({ error: "Turno cannot be rescheduled" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const [configRes, servicioRes, orgRes, sucRes] = await Promise.all([
      supabase.from("agenda_config").select("modificacion_limite_min, buffer_antes_min, buffer_despues_min, duracion_base_min, anticipacion_minima_reserva_min")
        .eq("organization_id", turno.organization_id).eq("sucursal_id", turno.sucursal_id).single(),
      supabase.from("servicios").select("duracion_min").eq("id", turno.servicio_id).single(),
      supabase.from("organizations").select("timezone").eq("id", turno.organization_id).single(),
      supabase.from("sucursales").select("timezone, deleted_at, activa").eq("id", turno.sucursal_id).single(),
    ]);

    if (!sucRes.data || (sucRes.data as any).deleted_at || (sucRes.data as any).activa === false) {
      return new Response(JSON.stringify({ error: "Sucursal no disponible" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const timezone = sucRes.data?.timezone || orgRes.data?.timezone || "America/Argentina/Buenos_Aires";
    const limiteMin = (configRes.data as any)?.modificacion_limite_min ?? 120;
    const duracion = servicioRes.data?.duracion_min || configRes.data?.duracion_base_min || 30;

    const nowInTz = new Date().toLocaleString("en-US", { timeZone: timezone });
    const nowDate = new Date(nowInTz);
    const originalDateTime = new Date(`${turno.fecha}T${turno.hora_inicio}`);
    const minutesUntilOriginal = (originalDateTime.getTime() - nowDate.getTime()) / 60000;

    if (minutesUntilOriginal <= 0) {
      return new Response(JSON.stringify({ error: "Cannot reschedule a past turno" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (minutesUntilOriginal < limiteMin) {
      return new Response(JSON.stringify({
        error: "modify_limit",
        message: `Solo podés reprogramar con al menos ${formatMinutesToText(limiteMin)} de anticipación.`,
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const antMin = Number((configRes.data as any)?.anticipacion_minima_reserva_min ?? 30);
    const newSlotMs = slotInstantMs(nueva_fecha, nueva_hora_inicio, timezone);
    const cutoffMs = Date.now() + antMin * 60000;
    if (newSlotMs < cutoffMs) {
      return new Response(JSON.stringify({
        error: "slot_too_soon",
        message: "Este horario ya no está disponible. Elegí un turno con mayor anticipación.",
        antMin,
      }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const nueva_hora_fin = minutesToTime(timeToMinutes(nueva_hora_inicio) + duracion);
    const slotStartMin = timeToMinutes(nueva_hora_inicio);
    const slotEndMin = timeToMinutes(nueva_hora_fin);

    const inWorkingHours = await isWithinWorkingHours(supabase, {
      orgId: turno.organization_id,
      sucursalId: turno.sucursal_id,
      barberoId: turno.barbero_id,
      fecha: nueva_fecha,
      slotStartMin,
      slotEndMin,
    });

    if (!inWorkingHours) {
      return new Response(JSON.stringify({
        error: "outside_working_hours",
        message: "Ese horario está fuera del horario de atención del barbero.",
      }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const isBlocked = await isBlockedByBloqueo(supabase, {
      orgId: turno.organization_id,
      sucursalId: turno.sucursal_id,
      barberoId: turno.barbero_id,
      fecha: nueva_fecha,
      slotStartMin,
      slotEndMin,
    });

    if (isBlocked) {
      return new Response(JSON.stringify({
        error: "slot_blocked",
        message: "Ese horario está bloqueado en la agenda.",
      }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const bufferBefore = configRes.data?.buffer_antes_min || 0;
    const bufferAfter = configRes.data?.buffer_despues_min || 0;

    const conflicts = await findConflictingTurnos(supabase, {
      organizationId: turno.organization_id,
      sucursalId: turno.sucursal_id,
      barberoId: turno.barbero_id,
      fecha: nueva_fecha,
      hora_inicio: nueva_hora_inicio,
      hora_fin: nueva_hora_fin,
      bufferBefore,
      bufferAfter,
      excludeTurnoId: turno_id,
    });

    if (conflicts.length > 0) {
      return new Response(JSON.stringify({
        error: "slot_taken",
        message: "Este horario ya fue reservado. Por favor elegí otro.",
      }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }



    const { error: updateError } = await supabase
      .from("turnos")
      .update({
        fecha: nueva_fecha,
        hora_inicio: nueva_hora_inicio,
        hora_fin: nueva_hora_fin,
      })
      .eq("id", turno_id);

    if (updateError) {
      console.error("reschedule update error:", updateError);
      if (updateError.code === "23P01") {
        return new Response(JSON.stringify({
          error: "slot_taken",
          message: "Este horario ya fue reservado. Por favor elegí otro.",
        }), {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "Failed to reschedule" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true, fecha: nueva_fecha, hora_inicio: nueva_hora_inicio, hora_fin: nueva_hora_fin }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("reschedule-turno error:", e);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
