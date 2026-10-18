import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowRight, ArrowLeft, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PartnerLevelExplorer } from "@/components/partners/PartnerLevels";
import { PARTNER_TERMS_VERSION } from "../../supabase/functions/_shared/partner-domain";
import { useCanonical } from "@/hooks/useCanonical";

export default function Partners() {
  useCanonical("/aliados");
  const location = useLocation();
  const [conditionsOpen, setConditionsOpen] = useState(
    location.hash === "#condiciones",
  );
  const conditions = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (location.hash !== "#condiciones") return;
    setConditionsOpen(true);
    const frame = requestAnimationFrame(() =>
      conditions.current?.scrollIntoView({ block: "start" }),
    );
    return () => cancelAnimationFrame(frame);
  }, [location.hash]);
  return (
    <div className="min-h-[100svh] bg-background text-foreground">
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-5">
          <Link to="/" aria-label="Vittro, inicio">
            <img src="/MagotipoAzul.png" alt="Vittro" className="h-9 w-auto" />
          </Link>
          <Button variant="ghost" asChild>
            <Link to="/aliados/panel">
              Mi código <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-5 py-12 sm:py-20">
        <Link
          to="/"
          className="mb-10 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver a Vittro
        </Link>
        <section className="grid items-start gap-12 lg:grid-cols-[1.15fr_1fr]">
          <div>
            <h1 className="max-w-xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
              Generá ingresos con tu código de referidos.
            </h1>
            <p className="mt-6 max-w-lg text-lg leading-relaxed text-muted-foreground">
              Compartí Vittro con amigos que tengan una barbería o con tu
              comunidad. Por cada barbería que se registra con tu código y
              empieza a pagar, recibís una comisión.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button size="lg" asChild>
                <Link to="/aliados/panel?mode=register">
                  Crear mi código <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link to="/aliados/panel">Ya tengo cuenta</Link>
              </Button>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
              Programa de aliados Vittro. Disponible en Argentina, con pagos en
              pesos.
            </p>
          </div>
          <div className="rounded-container border">
            <div className="border-b p-6">
              <h2 className="text-lg font-medium">
                Vos ganás. La barbería ahorra.
              </h2>
            </div>
            <dl className="divide-y">
              <div className="p-6">
                <dt className="text-sm text-muted-foreground">
                  Tu ingreso por cada referido
                </dt>
                <dd className="mt-2 text-3xl font-semibold tabular-nums">
                  10% a 30% de comisión
                </dd>
                <p className="mt-2 text-sm text-muted-foreground">
                  Del primer pago después del descuento. Subís de nivel a medida
                  que más barberías se califican.
                </p>
              </div>
              <div className="p-6">
                <dt className="text-sm text-muted-foreground">
                  El beneficio que compartís
                </dt>
                <dd className="mt-2 text-3xl font-semibold tabular-nums">
                  10% de descuento
                </dd>
                <p className="mt-2 text-sm text-muted-foreground">
                  En el primer mes pagado de la barbería, después de sus 15 días
                  de prueba.
                </p>
              </div>
            </dl>
          </div>
        </section>
        <section className="mt-16 border-t pt-10">
          <h2 className="text-2xl font-semibold">
            Subí de nivel. Ganá más por cada referido.
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Tu nivel depende de las barberías que traés. Cada una cuenta una
            vez, cuando pagó dos mensualidades distintas sin devoluciones. El
            progreso es acumulativo.
          </p>
          <PartnerLevelExplorer />
        </section>
        <section className="mt-12 border-t pt-8">
          <h2 className="text-2xl font-semibold">
            De tu recomendación a tu ingreso
          </h2>
          <ol className="mt-6 grid gap-6 sm:grid-cols-3">
            {[
              [
                "Creá tu código",
                "Confirmá tu email y elegí un código personal para compartir.",
              ],
              [
                "Compartilo con tu gente",
                "Tus amigos o tu comunidad lo usan al registrar una barbería nueva.",
              ],
              [
                "Recibí tu comisión",
                "El primer pago genera tu comisión. Vittro revisa y liquida los saldos disponibles cada mes.",
              ],
            ].map(([title, description], index) => (
              <li key={title}>
                <h3 className="text-lg font-medium">
                  <span className="mr-2 text-muted-foreground">
                    {index + 1}.
                  </span>
                  {title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {description}
                </p>
              </li>
            ))}
          </ol>
        </section>
        <details
          ref={conditions}
          id="condiciones"
          open={conditionsOpen}
          onToggle={(event) => setConditionsOpen(event.currentTarget.open)}
          className="group mt-12 scroll-mt-6 rounded-container border"
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-5 text-base font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            Condiciones del programa
            <ChevronDown className="h-5 w-5 shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none" />
          </summary>
          <div className="border-t p-5">
            <ul className="max-w-3xl list-disc space-y-3 pl-5 text-sm leading-relaxed text-muted-foreground">
              <li>
                El código se incorpora únicamente al registrar una barbería
                nueva. No se aplica a altas anteriores ni a tu propia barbería.
              </li>
              <li>
                El descuento es del 10% en la primera mensualidad pagada. Las
                siguientes se cobran al precio vigente del plan.
              </li>
              <li>
                Los niveles automáticos son 10% al crear tu código, 20% con 5
                barberías calificadas y 30% con 20. Se califica cada barbería
                una sola vez tras dos mensualidades distintas pagadas, sin
                reversión. El progreso se conserva salvo fraude o reversión.
              </li>
              <li>
                Tu porcentaje se fija al crear el primer checkout y se calcula
                sobre ese primer pago después del descuento, antes de los costos
                del procesador. No es una comisión recurrente.
              </li>
              <li>
                La comisión queda disponible 30 días después del cobro, si no
                hay devolución, contracargo o incidencia pendiente. Las
                devoluciones posteriores se ajustan en el saldo.
              </li>
              <li>
                Los pagos son mensuales, revisados por Vittro y en pesos
                argentinos a una cuenta de titularidad comprobada.
              </li>
              <li>
                Los convenios personalizados pueden llegar al 100% y requieren
                aprobación de Vittro, con porcentaje y vigencia propios.
              </li>
            </ul>
            <p className="mt-5 text-xs text-muted-foreground">
              Versión {PARTNER_TERMS_VERSION}
            </p>
          </div>
        </details>
      </main>
    </div>
  );
}
