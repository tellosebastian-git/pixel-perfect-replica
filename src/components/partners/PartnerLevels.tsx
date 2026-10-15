import { useId, useState } from "react";
import { Check, ArrowUp } from "lucide-react";
import { partnerTier } from "../../../supabase/functions/_shared/partner-domain";

const levels = [
  { level: 1, percent: 10, condition: "Al crear tu código" },
  { level: 2, percent: 20, condition: "5 barberías calificadas" },
  { level: 3, percent: 30, condition: "20 barberías calificadas" },
] as const;
const bottle =
  "M84 58H124V74C124 84 157 89 162 109C164 114 164 118 164 123V238C164 251 155 260 142 260H66C53 260 44 251 44 238V123C44 118 44 114 46 109C51 89 84 84 84 74Z";

/** Redundant visual meter: percentages and requirements are always written. */
function LevelBottle({
  fill,
  className = "",
}: {
  fill: number;
  className?: string;
}) {
  const clipId = useId().replace(/:/g, "");
  const height = 186 * Math.min(1, Math.max(0, fill));
  return (
    <svg viewBox="0 0 208 284" aria-hidden="true" className={className}>
      <defs>
        <clipPath id={clipId}>
          <path d={bottle} />
        </clipPath>
      </defs>
      <path
        d={bottle}
        className="fill-muted stroke-primary/40"
        strokeWidth="2"
      />
      <g clipPath={`url(#${clipId})`}>
        <rect
          x="44"
          y={260 - height}
          width="120"
          height={height}
          className="fill-primary motion-safe:transition-[y,height] motion-safe:duration-200"
          style={{ transitionTimingFunction: "var(--ease-out-quint)" }}
        />
        {[1, 2, 3].map((step) => (
          <line
            key={step}
            x1="48"
            x2="68"
            y1={260 - 62 * step}
            y2={260 - 62 * step}
            className="stroke-background/70"
            strokeWidth="2"
          />
        ))}
      </g>
      <path
        d={bottle}
        className="fill-none stroke-primary/50"
        strokeWidth="2"
      />
      <rect
        x="84"
        y="45"
        width="40"
        height="13"
        className="fill-secondary stroke-primary/40"
        strokeWidth="2"
      />
      <rect
        x="72"
        y="22"
        width="64"
        height="23"
        rx="4"
        className="fill-primary"
      />
      <path
        d="M83 28V39M94 28V39M105 28V39M116 28V39M127 28V39"
        className="stroke-background/40"
        strokeWidth="2"
      />
      <path
        d="M55 118V146"
        className="stroke-background/50"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function PartnerLevelExplorer() {
  const [selected, setSelected] = useState(0);
  const active = levels[selected];
  return (
    <div className="mt-8 grid items-center gap-8 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <figure className="flex items-center justify-center gap-5 rounded-container bg-muted/60 p-6 sm:flex-col sm:gap-0">
        <LevelBottle
          fill={active.level / 3}
          className="h-52 w-36 shrink-0 sm:h-64 sm:w-44"
        />
        <figcaption className="min-w-0 text-left sm:text-center">
          <p className="text-base font-medium">Nivel {active.level}</p>
          <p className="mt-1 text-4xl font-semibold tabular-nums">
            {active.percent}%
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            del primer pago de cada referido
          </p>
        </figcaption>
      </figure>
      <div>
        <p className="mb-4 text-sm text-muted-foreground">
          Elegí un nivel para conocerlo.
        </p>
        <div className="divide-y border-y">
          {levels.map((item, index) => (
            <button
              key={item.level}
              type="button"
              aria-pressed={selected === index}
              onClick={() => setSelected(index)}
              className={`flex w-full items-center justify-between gap-4 px-3 py-5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected === index ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-muted/50"}`}
            >
              <span className="min-w-0">
                <span className="block text-lg font-medium">
                  Nivel {item.level}
                </span>
                <span className="mt-1 block text-sm">{item.condition}</span>
              </span>
              <span className="flex shrink-0 items-center gap-3 text-2xl font-semibold tabular-nums">
                {item.percent}%
                {selected === index ? (
                  <Check className="h-5 w-5" />
                ) : (
                  <ArrowUp className="h-5 w-5" />
                )}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function PartnerLevelProgress({
  qualified,
  registrations,
  agreementPercent,
}: {
  qualified: number;
  registrations: number;
  agreementPercent?: number;
}) {
  const tier = partnerTier({ qualifiedOrganizations: qualified }, Date.now());
  const level = tier.percent / 10;
  const fill =
    qualified >= 20
      ? 1
      : qualified >= 5
        ? 2 / 3 + (qualified - 5) / 45
        : 1 / 3 + qualified / 15;
  const remaining = tier.nextGoal ? tier.nextGoal - qualified : 0;
  return (
    <section className="mt-8 rounded-container border bg-card">
      <div className="border-b p-5">
        <h2 className="text-lg font-medium">Tu nivel por referidos</h2>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_6rem] items-center gap-4 p-5 sm:grid-cols-[minmax(0,1fr)_8rem]">
        <div className="min-w-0">
          <p className="text-2xl font-semibold">
            Nivel {level} <span className="text-muted-foreground">·</span>{" "}
            <span className="tabular-nums">{tier.percent}%</span>
          </p>
          <p className="mt-3 text-sm text-muted-foreground">
            <span className="font-medium text-foreground tabular-nums">
              {qualified}
            </span>{" "}
            barberías calificadas de{" "}
            <span className="tabular-nums">{registrations}</span> registros con
            tu código.
          </p>
          <p className="mt-3 text-sm">
            {remaining
              ? `Te ${remaining === 1 ? "falta 1 barbería calificada" : `faltan ${remaining} barberías calificadas`} para el nivel ${level + 1} y una comisión del ${level === 1 ? 20 : 30}%.`
              : "Alcanzaste el nivel 3, el máximo del programa automático."}
          </p>
          {agreementPercent !== undefined && (
            <p className="mt-3 text-sm text-muted-foreground">
              Tu convenio vigente establece una comisión del{" "}
              <span className="tabular-nums">{agreementPercent}%</span>. Este
              progreso muestra tu nivel por referidos.
            </p>
          )}
          <p className="mt-4 text-sm text-muted-foreground">
            Una barbería se califica después de dos mensualidades distintas
            pagadas, sin devoluciones.
          </p>
        </div>
        <LevelBottle fill={fill} className="w-full" />
      </div>
    </section>
  );
}
