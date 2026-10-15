import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@/components/ui/form";
import { supabase } from "@/integrations/supabase/client";
import { callPartner, PartnerApiError } from "@/lib/partnerApi";
import { PARTNER_TERMS_VERSION } from "../../../supabase/functions/_shared/partner-domain";

export function PartnerAuthForm({
  initialMode = "login",
  enabled,
  recovery = false,
  onRecovered,
}: {
  initialMode?: "login" | "register" | "reset";
  enabled: boolean;
  recovery?: boolean;
  onRecovered?: () => void;
}) {
  const [mode, setMode] = useState<"login" | "register" | "reset">(initialMode);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const schema = z
    .object({
      name: z.string().max(80),
      email: z.string().max(254),
      password: z.string().max(128),
      accepted: z.boolean(),
    })
    .superRefine((value, ctx) => {
      if (!recovery && !z.string().email().safeParse(value.email).success)
        ctx.addIssue({
          code: "custom",
          path: ["email"],
          message: "Ingresá un email válido.",
        });
      if (mode === "register" && value.name.trim().length < 2)
        ctx.addIssue({
          code: "custom",
          path: ["name"],
          message: "Ingresá tu nombre.",
        });
      if (
        (mode !== "reset" || recovery) &&
        value.password.length < (mode === "register" || recovery ? 12 : 1)
      )
        ctx.addIssue({
          code: "custom",
          path: ["password"],
          message:
            "Ingresá una contraseña de al menos " +
            (mode === "register" || recovery ? 12 : 1) +
            " caracteres.",
        });
      if (mode === "register" && !value.accepted)
        ctx.addIssue({
          code: "custom",
          path: ["accepted"],
          message: "Aceptá las condiciones para registrarte.",
        });
    });
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", email: "", password: "", accepted: false },
  });
  const title = recovery
    ? "Elegí una nueva contraseña"
    : sent
      ? "Revisá tu email"
      : mode === "register"
        ? "Creá tu cuenta de referidos"
        : mode === "reset"
          ? "Recuperá tu acceso"
          : "Ingresá al programa";
  return (
    <section className="mx-auto max-w-md rounded-container border bg-card p-6 sm:p-8">
      <h2 className="text-2xl font-semibold">{title}</h2>
      {sent ? (
        <div className="mt-5 space-y-4">
          <p className="text-sm leading-relaxed text-muted-foreground">
            Te enviamos un enlace para continuar. Revisá también la carpeta de
            spam.
          </p>
          <Button
            variant="outline"
            onClick={() => {
              setSent(false);
              setMode("login");
            }}
          >
            Volver al ingreso
          </Button>
        </div>
      ) : (
        <>
          <p className="mt-3 text-sm text-muted-foreground">
            {mode === "register"
              ? "Generá ingresos recomendando Vittro a tus amigos o a tu comunidad. Después de confirmar tu email, vas a poder elegir tu código."
              : "Si ya usás Vittro, ingresá con el mismo email y contraseña."}
          </p>
          <Form {...form}>
            <form
              className="mt-6 space-y-5"
              onSubmit={form.handleSubmit(async (values) => {
                setBusy(true);
                setMessage("");
                try {
                  if (recovery) {
                    const { error } = await supabase.auth.updateUser({
                      password: values.password,
                    });
                    if (error) throw new Error();
                    onRecovered?.();
                  } else if (mode === "register") {
                    await callPartner("register", {
                      ...values,
                      country: "AR",
                      termsVersion: PARTNER_TERMS_VERSION,
                    });
                    setSent(true);
                  } else if (mode === "reset") {
                    const { error } = await supabase.auth.resetPasswordForEmail(
                      values.email,
                      {
                        redirectTo: `${window.location.origin}/aliados/panel?mode=reset`,
                      },
                    );
                    if (error) throw new Error();
                    setSent(true);
                  } else {
                    const { error } = await supabase.auth.signInWithPassword({
                      email: values.email,
                      password: values.password,
                    });
                    if (error) {
                      setMessage(
                        "Email o contraseña incorrectos. Si todavía no confirmaste tu email, usá el enlace que recibiste.",
                      );
                      return;
                    }
                  }
                } catch (error) {
                  setMessage(
                    error instanceof PartnerApiError
                      ? error.message
                      : "No pudimos completar la operación. Probá nuevamente.",
                  );
                } finally {
                  form.setValue("password", "");
                  setBusy(false);
                }
              })}
            >
              {mode === "register" && !recovery && (
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nombre</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          autoComplete="name"
                          maxLength={80}
                          disabled={busy}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
              {!recovery && (
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="email"
                          autoComplete="email"
                          maxLength={254}
                          disabled={busy}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
              {(mode !== "reset" || recovery) && (
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {recovery ? "Nueva contraseña" : "Contraseña"}
                      </FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="password"
                          autoComplete={
                            mode === "register" || recovery
                              ? "new-password"
                              : "current-password"
                          }
                          maxLength={128}
                          disabled={busy}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
              {mode === "register" && !recovery && (
                <FormField
                  control={form.control}
                  name="accepted"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-start gap-3">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={(value) =>
                              field.onChange(value === true)
                            }
                            disabled={busy}
                          />
                        </FormControl>
                        <FormLabel className="leading-relaxed">
                          Acepto las{" "}
                          <a
                            className="underline underline-offset-4"
                            href="/aliados#condiciones"
                          >
                            condiciones del programa
                          </a>
                          . País: Argentina.
                        </FormLabel>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
              {message && (
                <p role="alert" className="text-sm text-destructive">
                  {message}
                </p>
              )}
              <Button
                className="w-full"
                disabled={busy || (mode === "register" && !enabled)}
                type="submit"
              >
                {busy
                  ? "Procesando…"
                  : recovery
                    ? "Guardar contraseña"
                    : mode === "register"
                      ? "Crear mi cuenta"
                      : mode === "reset"
                        ? "Enviar enlace"
                        : "Ingresar"}
              </Button>
            </form>
          </Form>
          {!recovery && (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                variant="link"
                className="px-0"
                onClick={() => {
                  setMode(mode === "register" ? "login" : "register");
                  setMessage("");
                }}
              >
                {mode === "register"
                  ? "Ya tengo cuenta"
                  : "Quiero crear mi código"}
              </Button>
              {mode === "login" && (
                <Button
                  variant="link"
                  className="px-0"
                  onClick={() => setMode("reset")}
                >
                  Olvidé mi contraseña
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
