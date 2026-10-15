import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Users, LogOut, CreditCard } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { InlineReadError } from "@/components/ui/InlineReadError";
import { StatusPill } from "@/components/ui/StatusPill";
import { usePartnerSession } from "@/hooks/usePartnerSession";
import { PartnerLevelProgress } from "@/components/partners/PartnerLevels";
import { PartnerAuthForm } from "@/components/partners/PartnerAuthForm";
import {
  PartnerEnrollment,
  PartnerPayoutForm,
} from "@/components/partners/PartnerForms";
import { callPartner, partnerMoney, partnerStatus } from "@/lib/partnerApi";
import type { PartnerSummary } from "@/types/partners";
import { supabase } from "@/integrations/supabase/client";

const labels = {
  pending: "En espera",
  available: "Disponible",
  held: "En revisión",
  paid: "Pagada",
  reversed: "Revertida",
} as const;
export default function PartnerPanel() {
  const session = usePartnerSession();
  const [params, setParams] = useSearchParams();
  const cache = useQueryClient();
  const [drawer, setDrawer] = useState<"enroll" | "payout" | null>(null);
  const status = useQuery({
    queryKey: ["partner-status"],
    queryFn: partnerStatus,
    retry: 1,
    staleTime: 20_000,
  });
  const query = useQuery({
    queryKey: ["partners", session.user?.id],
    queryFn: () => callPartner<{ summary: PartnerSummary | null }>("summary"),
    enabled: Boolean(session.user?.email_confirmed_at && !session.recovery),
    retry: 1,
  });
  const summary = query.data?.summary;
  const isRecovering =
    session.recovery || Boolean(session.user && params.get("mode") === "reset");
  const refresh = () => void query.refetch();
  return (
    <div className="min-h-[100svh] bg-muted/30 text-foreground">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-5 py-5">
          <Link to="/aliados">
            <img
              src="/MagotipoAzul.png"
              alt="Vittro, programa de aliados"
              className="h-9 w-auto"
            />
          </Link>
          {session.user && (
            <Button
              variant="ghost"
              onClick={async () => {
                await supabase.auth.signOut({ scope: "local" });
                cache.removeQueries({ queryKey: ["partners"] });
              }}
            >
              <LogOut className="h-4 w-4" />
              Salir
            </Button>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-5 py-8 sm:py-12">
        {session.loading || status.isPending ? (
          <div
            role="status"
            aria-label="Cargando programa"
            className="space-y-5"
          >
            <Skeleton className="h-9 w-56" />
            <Skeleton className="h-64 w-full rounded-container" />
          </div>
        ) : session.error ? (
          <InlineReadError
            message="No pudimos verificar tu sesión."
            onRetry={() => window.location.reload()}
          />
        ) : (
          <>
            {status.isError ? (
              <InlineReadError
                message="No pudimos consultar la disponibilidad del programa."
                onRetry={() => void status.refetch()}
              />
            ) : (
              !status.data?.enabled && (
                <p
                  role="status"
                  className="mb-6 rounded-lg border bg-background p-4 text-sm text-muted-foreground"
                >
                  El programa todavía no está disponible para nuevas altas.
                  Volvé a consultar más adelante.
                </p>
              )
            )}
            {!session.user || isRecovering ? (
              <PartnerAuthForm
                enabled={status.data?.enabled === true}
                initialMode={
                  params.get("mode") === "register"
                    ? "register"
                    : params.get("mode") === "reset"
                      ? "reset"
                      : "login"
                }
                recovery={isRecovering}
                onRecovered={() => {
                  session.finishRecovery();
                  setParams({}, { replace: true });
                  toast.success("Contraseña actualizada.");
                }}
              />
            ) : !session.user.email_confirmed_at ? (
              <EmptyState
                icon={Users}
                title="Confirmá tu email"
                description="Usá el enlace enviado a tu email para activar tu cuenta."
                action={
                  <Button
                    onClick={async () => {
                      try {
                        await callPartner("resend", {
                          email: session.user?.email,
                        });
                        toast.success("Revisá tu email.");
                      } catch {
                        toast.error(
                          "No pudimos reenviar el enlace. Probá más tarde.",
                        );
                      }
                    }}
                  >
                    Reenviar enlace
                  </Button>
                }
              />
            ) : query.isPending ? (
              <Skeleton className="h-72 rounded-container" />
            ) : query.isError ? (
              <InlineReadError
                message="No pudimos cargar tu código y comisiones."
                onRetry={refresh}
              />
            ) : !summary ? (
              <EmptyState
                icon={Users}
                title="Empezá a generar ingresos con tus recomendaciones"
                description="Creá tu código de referidos y compartilo con amigos o con tu comunidad. Recibís una comisión cuando una barbería empieza a pagar."
                action={
                  <Button
                    disabled={!status.data?.enabled}
                    onClick={() => setDrawer("enroll")}
                  >
                    Crear mi código
                  </Button>
                }
              />
            ) : (
              <>
                <div className="flex flex-wrap items-start justify-between gap-5">
                  <div>
                    <h1 className="text-2xl font-semibold">
                      Mi código de referidos
                    </h1>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Compartilo con amigos o con tu comunidad y seguí tus
                      ingresos desde acá.
                    </p>
                  </div>
                  <p className="text-base font-medium tabular-nums">
                    Comisión actual: {summary.tier.percent}%
                  </p>
                </div>
                <section className="mt-6 rounded-container border bg-card">
                  <div className="border-b p-5">
                    <h2 className="text-lg font-medium">Compartí tu código</h2>
                  </div>
                  <div className="space-y-5 p-5">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <p className="break-all text-3xl font-semibold tracking-tight">
                        {summary.code}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {[
                          ["Copiar código", summary.code],
                          [
                            "Copiar enlace",
                            `${window.location.origin}/login?mode=signup&ref=${encodeURIComponent(summary.code)}`,
                          ],
                        ].map(([label, value]) => (
                          <Button
                            variant="outline"
                            key={label}
                            onClick={async () => {
                              try {
                                await navigator.clipboard.writeText(value);
                                toast.success("Copiado.");
                              } catch {
                                toast.error(
                                  "No pudimos copiar. Seleccioná el código y copialo manualmente.",
                                );
                              }
                            }}
                          >
                            <Copy className="h-4 w-4" />
                            {label}
                          </Button>
                        ))}
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      La barbería recibe 10% de descuento en su primer mes
                      pagado. Vos recibís una comisión sobre ese primer pago,
                      después del descuento.
                    </p>
                  </div>
                </section>
                <h2 className="mt-8 text-lg font-medium">Tus ingresos</h2>
                <dl className="mt-4 grid gap-y-5 divide-y rounded-container border bg-card sm:grid-cols-3 sm:divide-x sm:divide-y-0">
                  {[
                    ["En espera", summary.pendingCents],
                    ["Disponible", summary.availableCents],
                    ["Pagado", summary.paidCents],
                  ].map(([label, cents]) => (
                    <div key={label} className="min-w-0 p-5">
                      <dt className="text-sm text-muted-foreground">{label}</dt>
                      <dd className="mt-2 break-words text-2xl font-semibold tabular-nums">
                        {partnerMoney(Number(cents))}
                      </dd>
                    </div>
                  ))}
                </dl>
                {summary.adjustmentsCents !== 0 && (
                  <p className="mt-3 text-sm text-muted-foreground">
                    Ajustes de devoluciones:{" "}
                    <span className="tabular-nums">
                      {partnerMoney(summary.adjustmentsCents)}
                    </span>
                    . Se compensan al liquidar.
                  </p>
                )}
                <PartnerLevelProgress
                  qualified={summary.tier.qualifiedOrganizations}
                  registrations={summary.registrations}
                  agreementPercent={
                    summary.tier.source === "agreement"
                      ? summary.tier.percent
                      : undefined
                  }
                />
                <section className="mt-8 rounded-container border bg-card">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b p-5">
                    <h2 className="text-lg font-medium">
                      Comisiones recientes
                    </h2>
                    <Button
                      variant="outline"
                      onClick={() => setDrawer("payout")}
                    >
                      <CreditCard className="h-4 w-4" />
                      Datos de cobro
                    </Button>
                  </div>
                  <div className="p-5">
                    <p className="mb-5 text-sm text-muted-foreground">
                      {summary.payout.configured
                        ? `Cuenta terminada en ${summary.payout.lastFour}. ${summary.payout.verified ? "Titularidad verificada." : "Titularidad pendiente de revisión."}`
                        : "Agregá tu cuenta cuando tengas comisiones para cobrar."}
                    </p>
                    {!summary.commissions.length ? (
                      <EmptyState
                        icon={CreditCard}
                        title="Todavía no hay comisiones"
                        description="Aparecerán cuando una barbería use tu código y complete su primer pago."
                      />
                    ) : (
                      <ul className="divide-y">
                        {summary.commissions.map((item) => (
                          <li
                            key={item.id}
                            className="flex flex-wrap items-center justify-between gap-3 py-4"
                          >
                            <div>
                              <p className="font-medium tabular-nums">
                                {partnerMoney(item.amountCents)}
                              </p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {new Date(item.createdAt).toLocaleDateString(
                                  "es-AR",
                                )}{" "}
                                · Disponible desde{" "}
                                {new Date(item.availableAt).toLocaleDateString(
                                  "es-AR",
                                )}
                              </p>
                            </div>
                            <StatusPill
                              status={
                                item.status === "paid" ||
                                item.status === "available"
                                  ? "success"
                                  : item.status === "held"
                                    ? "warning"
                                    : "neutral"
                              }
                              label={labels[item.status]}
                            />
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </section>
              </>
            )}
          </>
        )}
      </main>
      {drawer === "enroll" && (
        <PartnerEnrollment onClose={() => setDrawer(null)} onSaved={refresh} />
      )}
      {drawer === "payout" && (
        <PartnerPayoutForm onClose={() => setDrawer(null)} onSaved={refresh} />
      )}
    </div>
  );
}
