import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { COUNTRIES, buildPhone } from "./lib/phone";
import { supabase } from "@/integrations/supabase/client";
import { UserCheck, Search } from "lucide-react";

export interface ClienteData {
  nombre: string;
  apellido: string;
  telefono: string; // already normalized like +54..
  phone_country: string;
  email: string | null;
  birth_date: string | null;
}

interface Props {
  organizationId: string;
  initial?: Partial<ClienteData>;
  onSubmit: (cliente: ClienteData) => void;
}

export const DatosClienteStep = ({ organizationId, initial, onSubmit }: Props) => {
  // ===== Lookup state =====
  const [lookupCountry, setLookupCountry] = useState("AR");
  const [lookupPhone, setLookupPhone] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [matched, setMatched] = useState<ClienteData | null>(null);
  const [notFound, setNotFound] = useState(false);

  const lookupCountryObj = useMemo(
    () => COUNTRIES.find((c) => c.code === lookupCountry) ?? COUNTRIES[0],
    [lookupCountry],
  );

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    const fullPhone = buildPhone(lookupCountryObj.dial, lookupPhone);
    if (!fullPhone) {
      toast.error(
        lookupCountryObj.code === "AR"
          ? "Teléfono inválido. Ejemplo: 11 2516-2528."
          : "Ingresá un teléfono válido.",
      );
      return;
    }
    setLookupLoading(true);
    setNotFound(false);
    setMatched(null);
    try {
      const { data, error } = await supabase.functions.invoke("lookup-cliente-by-phone", {
        body: { organization_id: organizationId, telefono: fullPhone },
      });
      if (error || data?.error) {
        toast.error("No pudimos buscar tus datos. Intentá de nuevo.");
        return;
      }
      if (data?.found) {
        setMatched({
          nombre: data.cliente.nombre || "",
          apellido: data.cliente.apellido || "",
          telefono: data.cliente.telefono || fullPhone,
          phone_country: lookupCountryObj.code,
          email: data.cliente.email || null,
          birth_date: data.cliente.birth_date || null,
        });
      } else {
        setNotFound(true);
      }
    } catch {
      toast.error("Error de conexión.");
    } finally {
      setLookupLoading(false);
    }
  };

  const handleConfirmMatch = () => {
    if (!matched) return;
    onSubmit(matched);
  };

  // ===== Register form state =====
  const [countryCode, setCountryCode] = useState(initial?.phone_country || "AR");
  const [nombre, setNombre] = useState(initial?.nombre || "");
  const [apellido, setApellido] = useState(initial?.apellido || "");
  const [phoneLocal, setPhoneLocal] = useState("");
  const [email, setEmail] = useState(initial?.email || "");
  const [birthDate, setBirthDate] = useState(initial?.birth_date || "");

  const country = useMemo(
    () => COUNTRIES.find((c) => c.code === countryCode) ?? COUNTRIES[0],
    [countryCode],
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const n = nombre.trim();
    const a = apellido.trim();
    const mail = email.trim();

    if (!n) return toast.error("Ingresá tu nombre");
    if (!a) return toast.error("Ingresá tu apellido");
    const fullPhone = buildPhone(country.dial, phoneLocal);
    if (!fullPhone) {
      return toast.error(
        country.code === "AR"
          ? "Teléfono inválido. Ejemplo: 11 2516-2528."
          : "Ingresá un teléfono válido.",
      );
    }
    if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return toast.error("Ingresá un email válido");

    onSubmit({
      nombre: n,
      apellido: a,
      telefono: fullPhone,
      phone_country: country.code,
      email: mail ? mail.toLowerCase() : null,
      birth_date: birthDate || null,
    });
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-foreground">Tus datos</h2>
        <p className="text-sm text-muted-foreground">
          Si ya reservaste antes, buscá tus datos por teléfono. Si no, registrate abajo.
        </p>
      </div>

      {/* ===== Lookup block ===== */}
      <div className="rounded-xl border border-border/60 bg-muted/30 p-4 space-y-3">
        <div className="space-y-0.5">
          <h3 className="text-sm font-semibold text-foreground">¿Ya estás registrado?</h3>
          <p className="text-xs text-muted-foreground">
            Ingresá tu teléfono y te identificamos al instante.
          </p>
        </div>

        {!matched ? (
          <form onSubmit={handleLookup} className="space-y-3">
            <div className="flex gap-2">
              <Select value={lookupCountry} onValueChange={setLookupCountry}>
                <SelectTrigger className="h-11 w-[100px] text-sm">
                  <SelectValue>{lookupCountryObj.dial}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {COUNTRIES.map((c) => (
                    <SelectItem key={c.code} value={c.code}>
                      {c.name} ({c.dial})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="tel"
                inputMode="tel"
                className="h-11 text-base flex-1"
                value={lookupPhone}
                onChange={(e) => {
                  setLookupPhone(e.target.value.replace(/[^\d\s-]/g, ""));
                  setNotFound(false);
                }}
                placeholder={lookupCountryObj.placeholder}
                autoComplete="tel-national"
                maxLength={20}
              />
            </div>
            <Button
              type="submit"
              variant="outline"
              className="w-full h-11 gap-2"
              disabled={lookupLoading}
            >
              <Search className="h-4 w-4" />
              {lookupLoading ? "Buscando..." : "Buscar mis datos"}
            </Button>
            {notFound && (
              <p className="text-xs text-muted-foreground">
                No encontramos ese teléfono. Registrate abajo para reservar.
              </p>
            )}
          </form>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-card p-3">
              <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <UserCheck className="h-4 w-4 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Encontramos tu cuenta</p>
                <p className="text-sm font-medium text-foreground truncate">
                  {[matched.nombre, matched.apellido].filter(Boolean).join(" ")}
                </p>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <Button className="flex-1 h-11" onClick={handleConfirmMatch}>
                Sí, soy yo. Continuar
              </Button>
              <Button
                variant="ghost"
                className="flex-1 h-11"
                onClick={() => {
                  setMatched(null);
                  setLookupPhone("");
                }}
              >
                No soy yo
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ===== Separator ===== */}
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t border-border/60" />
        </div>
        <div className="relative flex justify-center">
          <span className="bg-card px-3 text-xs uppercase tracking-wide text-muted-foreground">
            o registrate por primera vez
          </span>
        </div>
      </div>

      {/* ===== Register form ===== */}
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="nombre">Nombre *</Label>
          <Input
            id="nombre"
            className="h-12 text-base"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Tu nombre"
            autoComplete="given-name"
            maxLength={80}
            required
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="apellido">Apellido *</Label>
          <Input
            id="apellido"
            className="h-12 text-base"
            value={apellido}
            onChange={(e) => setApellido(e.target.value)}
            placeholder="Tu apellido"
            autoComplete="family-name"
            maxLength={80}
            required
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="phone">Teléfono *</Label>
          <div className="flex gap-2">
            <Select value={countryCode} onValueChange={setCountryCode}>
              <SelectTrigger className="h-12 w-[110px] text-base">
                <SelectValue>{country.dial}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {COUNTRIES.map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    {c.name} ({c.dial})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              id="phone"
              type="tel"
              inputMode="tel"
              className="h-12 text-base flex-1"
              value={phoneLocal}
              onChange={(e) => setPhoneLocal(e.target.value.replace(/[^\d\s-]/g, ""))}
              placeholder={country.placeholder}
              autoComplete="tel-national"
              maxLength={20}
              required
            />
          </div>
        </div>

        <div className="space-y-1">
          <Label htmlFor="email">Email (opcional)</Label>
          <Input
            id="email"
            type="email"
            inputMode="email"
            className="h-12 text-base"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="tu@email.com"
            autoComplete="email"
            maxLength={120}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="birthDate">Fecha de nacimiento (opcional)</Label>
          <Input
            id="birthDate"
            type="date"
            className="h-12 text-base"
            value={birthDate}
            onChange={(e) => setBirthDate(e.target.value)}
            autoComplete="bday"
          />
        </div>

        <Button type="submit" className="w-full h-12 text-base">
          Continuar
        </Button>
      </form>
    </div>
  );
};
