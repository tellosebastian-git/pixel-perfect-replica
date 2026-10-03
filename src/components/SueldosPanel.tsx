import { useState, useEffect, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Textarea } from '@/components/ui/textarea';
import { DrawerForm } from '@/components/ui/drawer-form';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonRow } from '@/components/ui/SkeletonRow';
import { useDelayedVisible } from '@/hooks/useDelayedVisible';
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form';
import { EmptySelectHint } from '@/components/agenda/EmptySelectHint';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { StatusPill } from '@/components/ui/StatusPill';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Plus, CalendarIcon, ChevronDown, ChevronRight, Wallet } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/contexts/OrganizationContext';
import { useSucursal } from '@/contexts/SucursalContext';
import { Barber } from '@/types/barbershop';
import { toast } from 'sonner';
import { format, startOfMonth, differenceInCalendarDays, getDaysInMonth, addMonths, startOfDay, endOfMonth, isBefore, isSameMonth, addDays, addWeeks, addYears } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { useRequirePinForAction } from '@/components/ActionPinGate';
import { useAuth } from '@/contexts/AuthContext';

const pagoSueldoSchema = z.object({
  barberoId: z.string().min(1, 'Seleccioná un empleado.'),
  monto: z.string().refine((v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) && n > 0;
  }, 'Ingresá un monto válido.'),
  concepto: z.string().max(240, 'El concepto no puede superar los 240 caracteres.').optional().default(''),
});

type PagoSueldoFormValues = z.infer<typeof pagoSueldoSchema>;

const pagoSueldoDefaults: PagoSueldoFormValues = { barberoId: '', monto: '', concepto: '' };



/**
 * Calcula el devengado de sueldo fijo usando meses calendario reales.
 * Meses completos = sueldoFijo exacto. Meses parciales = prorrateo por días reales del mes.
 */
function calcularDevengadoFijo(sueldoFijo: number, desde: Date, hasta: Date): number {
  if (isBefore(hasta, desde)) return 0;
  
  // Si están en el mismo mes, prorratear
  if (isSameMonth(desde, hasta)) {
    const diasMes = getDaysInMonth(desde);
    const dias = differenceInCalendarDays(hasta, desde);
    return sueldoFijo * (dias / diasMes);
  }
  
  let total = 0;
  
  // Primer mes parcial: desde el día de inicio hasta fin del mes
  const finPrimerMes = endOfMonth(desde);
  const diasPrimerMes = getDaysInMonth(desde);
  const diasEnPrimerMes = differenceInCalendarDays(finPrimerMes, desde) + 1; // +1 para incluir el último día
  total += sueldoFijo * (diasEnPrimerMes / diasPrimerMes);
  
  // Meses completos intermedios
  let cursor = startOfDay(addMonths(startOfMonth(desde), 1));
  while (cursor.getFullYear() < hasta.getFullYear() || 
         (cursor.getFullYear() === hasta.getFullYear() && cursor.getMonth() < hasta.getMonth())) {
    total += sueldoFijo;
    cursor = addMonths(cursor, 1);
  }
  
  // Último mes parcial (si estamos en un mes diferente al primero)
  const inicioUltimoMes = startOfMonth(hasta);
  const diasUltimoMes = getDaysInMonth(hasta);
  const diasEnUltimoMes = differenceInCalendarDays(hasta, inicioUltimoMes);
  if (diasEnUltimoMes > 0) {
    total += sueldoFijo * (diasEnUltimoMes / diasUltimoMes);
  }
  
  return total;
}

function calcNextDate(current: Date, preset: string, frequency?: string | null, interval?: number | null, byweekday?: number[] | null): Date {
  const n = interval || 1;
  switch (preset) {
    case 'daily': return addDays(current, 1);
    case 'weekdays': { let next = addDays(current, 1); while (next.getDay() === 0 || next.getDay() === 6) next = addDays(next, 1); return next; }
    case 'weekends': { let next = addDays(current, 1); while (next.getDay() !== 0 && next.getDay() !== 6) next = addDays(next, 1); return next; }
    case 'weekly': return addWeeks(current, 1);
    case 'biweekly': return addWeeks(current, 2);
    case 'monthly': return addMonths(current, 1);
    case 'quarterly': return addMonths(current, 3);
    case 'semiannual': return addMonths(current, 6);
    case 'yearly': return addYears(current, 1);
    case 'custom': {
      const freq = frequency || 'monthly';
      switch (freq) {
        case 'daily': return addDays(current, n);
        case 'weekly': {
          if (byweekday?.length) {
            const sorted = [...byweekday].sort((a, b) => a - b);
            const currentDay = current.getDay();
            const nextDay = sorted.find(d => d > currentDay);
            if (nextDay !== undefined) return addDays(current, nextDay - currentDay);
            return addDays(current, 7 * (n - 1) + (7 - currentDay + sorted[0]));
          }
          return addWeeks(current, n);
        }
        case 'monthly': return addMonths(current, n);
        case 'yearly': return addYears(current, n);
        default: return addMonths(current, n);
      }
    }
    default: return addMonths(current, 1);
  }
}

// Define interface for raw ingresos data from Supabase
interface IngresoRaw {
  id: number;
  barbero: string | null;
  barbero_id: string | null;
  sueldo: number | null;
  total_facturado: number | null;
  efectivo: number | null;
  mp: number | null;
  dia: string | null;
  created_at: string;
}

interface ComisionEquipoDetalle {
  barberoOrigenId: string;
  barberoOrigenNombre: string;
  porcentajeActual: number;
  montoTotal: number;
}

interface BonoFijoOcurrencia {
  fecha: string;
  monto: number;
}

interface BarberSalaryData {
  barberId: string;
  barberName: string;
  compensationType: string;
  totalDevengado: number;
  totalPagado: number;
  saldo: number;
  detalleIngresos: IngresoDetalle[];
  detallePagos: PagoDetalle[];
  fixedSalaryInfo?: { sueldoFijo: number; dias: number; devengado: number };
  comisionExtraEquipo?: ComisionEquipoDetalle[];
  bonoFijoOcurrencias?: BonoFijoOcurrencia[];
  bonoFijoTotal?: number;
  comisionProductosTotal?: number;
}

interface IngresoDetalle {
  id: number;
  fecha: string;
  dia: string;
  totalFacturado: number;
  sueldo: number;
  efectivo: number;
  mp: number;
}

interface PagoDetalle {
  id: string;
  fecha: string;
  monto: number;
  concepto: string | null;
}

interface PagoSueldo {
  id: string;
  barbero_id: string;
  barbero_nombre: string;
  monto: number;
  fecha: string;
  concepto: string | null;
  created_at: string;
}

interface SueldosPanelProps {
  barbers: Barber[];
}

// Subcomponent for expandable barber detail row
function BarberDetailRow({ 
  barber, 
  formatCurrency, 
  getSaldoBadge 
}: { 
  barber: BarberSalaryData; 
  formatCurrency: (amount: number) => string;
  getSaldoBadge: (saldo: number) => React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <div className="flex items-center justify-between p-4 rounded-lg border hover:bg-muted/50 cursor-pointer transition-colors">
          <div className="flex items-center gap-3">
            {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            <span className="font-medium">{barber.barberName}</span>
            <Badge variant={barber.compensationType === 'fijo' ? 'secondary' : 'outline'} className="text-xs">
              {barber.compensationType === 'fijo' ? 'Fijo' : 'Comisión'}
            </Badge>
          </div>
          <div className="flex items-center gap-6">
            <div className="text-right">
              <p className="text-xs text-muted-foreground">A pagar</p>
              <p className="font-medium">{formatCurrency(barber.totalDevengado)}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Pagado</p>
              <p className="font-medium text-status-success-foreground">{formatCurrency(barber.totalPagado)}</p>
            </div>
            <div className="text-right min-w-[140px]">
              <p className="text-xs text-muted-foreground">Saldo (histórico)</p>
              {getSaldoBadge(barber.saldo)}
            </div>
          </div>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="pl-8 pr-4 pb-4 space-y-4">
          {/* Fixed salary explanation */}
          {barber.fixedSalaryInfo && (
            <div className="p-3 rounded-md bg-accent/30 border border-accent/50 text-sm">
              <span className="font-medium">Sueldo fijo:</span> {formatCurrency(barber.fixedSalaryInfo.sueldoFijo)}/mes — {barber.fixedSalaryInfo.dias} días → {formatCurrency(barber.fixedSalaryInfo.devengado)} a pagar
            </div>
          )}
          {/* Comision extra por equipo */}
          {barber.comisionExtraEquipo && barber.comisionExtraEquipo.length > 0 && (
            <div className="p-3 rounded-md bg-primary/5 border border-primary/20 text-sm space-y-1">
              <span className="font-medium">Comisión extra por equipo</span>
              {barber.comisionExtraEquipo.map(ce => (
                <div key={ce.barberoOrigenId} className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{ce.barberoOrigenNombre} ({ce.porcentajeActual}%)</span>
                  <span className="font-medium">{formatCurrency(ce.montoTotal)}</span>
                </div>
              ))}
              <div className="flex justify-between pt-1 border-t border-primary/10 font-medium">
                <span>Total</span>
                <span>{formatCurrency(barber.comisionExtraEquipo.reduce((s, c) => s + c.montoTotal, 0))}</span>
              </div>
            </div>
          )}
          {/* Bono fijo */}
          {barber.bonoFijoOcurrencias && barber.bonoFijoOcurrencias.length > 0 && (
            <div className="p-3 rounded-md bg-primary/5 border border-primary/20 text-sm space-y-1">
              <span className="font-medium">Bono fijo</span>
              {barber.bonoFijoOcurrencias.map((o, i) => (
                <div key={i} className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{format(new Date(o.fecha + 'T12:00:00'), "dd/MM", { locale: es })}</span>
                  <span className="font-medium">+{formatCurrency(o.monto)}</span>
                </div>
              ))}
              <div className="flex justify-between pt-1 border-t border-primary/10 font-medium">
                <span>Total</span>
                <span>{formatCurrency(barber.bonoFijoTotal || 0)}</span>
              </div>
            </div>
          )}
          {/* Comisión por productos vendidos */}
          {barber.comisionProductosTotal != null && barber.comisionProductosTotal > 0 && (
            <div className="p-3 rounded-md bg-primary/5 border border-primary/20 text-sm">
              <div className="flex justify-between font-medium">
                <span>Comisión por productos vendidos</span>
                <span>{formatCurrency(barber.comisionProductosTotal)}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Calculada sobre la ganancia de los productos vendidos por este barbero.
              </p>
            </div>
          )}
          {/* Ingresos Detail */}
          {barber.detalleIngresos.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-muted-foreground">Cierres de Caja</h4>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Día</TableHead>
                      <TableHead className="text-right">Efectivo</TableHead>
                      <TableHead className="text-right">MP</TableHead>
                      <TableHead className="text-right">Total Facturado</TableHead>
                      <TableHead className="text-right">Comisión</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {barber.detalleIngresos.map(ingreso => (
                      <TableRow key={ingreso.id}>
                        <TableCell>{format(new Date(ingreso.fecha), "dd/MM/yyyy", { locale: es })}</TableCell>
                        <TableCell className="capitalize">{ingreso.dia}</TableCell>
                        <TableCell className="text-right">{formatCurrency(ingreso.efectivo)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(ingreso.mp)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(ingreso.totalFacturado)}</TableCell>
                        <TableCell className="text-right font-medium">{formatCurrency(ingreso.sueldo)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {/* Pagos Detail */}
          {barber.detallePagos.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-muted-foreground">Pagos Realizados</h4>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Concepto</TableHead>
                      <TableHead className="text-right">Monto</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {barber.detallePagos.map(pago => (
                      <TableRow key={pago.id}>
                        <TableCell>{format(new Date(pago.fecha), "dd/MM/yyyy", { locale: es })}</TableCell>
                        <TableCell className="text-muted-foreground">{pago.concepto || '-'}</TableCell>
                        <TableCell className="text-right font-medium text-status-success-foreground">{formatCurrency(pago.monto)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {barber.detalleIngresos.length === 0 && barber.detallePagos.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">
              No hay registros en el período seleccionado
            </p>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function SueldosPanel({ barbers }: SueldosPanelProps) {
  const { organization } = useOrganization();
  const { currentSucursal } = useSucursal();
  
  const requirePinForAction = useRequirePinForAction();
  const { isSucursalAccount } = useAuth();
  const [sueldosViewUnlocked, setSueldosViewUnlocked] = useState(false);
  const shouldGateSueldosView = isSucursalAccount && !sueldosViewUnlocked;

  const handleUnlockSueldosView = async () => {
    const gate = await requirePinForAction('ver_sueldos', currentSucursal?.id ?? null);
    if (!gate.ok) return;
    setSueldosViewUnlocked(true);
    if (isSucursalAccount && currentSucursal?.id) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase as any).rpc('notif_emit_view_event', {
          _module: 'sueldos',
          _sucursal_id: currentSucursal.id,
        });
      } catch (e) { console.warn('[notif] view event error', e); }
    }
  };
  const [salaryData, setSalaryData] = useState<BarberSalaryData[]>([]);
  const [pagos, setPagos] = useState<PagoSueldo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // Distingue primera carga (sin contenido utilizable → skeleton) de refetch
  // posterior (cambio de período, pago registrado → mantener contenido visible).
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [isPagoDrawerOpen, setIsPagoDrawerOpen] = useState(false);

  const pagoForm = useForm<PagoSueldoFormValues>({
    resolver: zodResolver(pagoSueldoSchema),
    defaultValues: pagoSueldoDefaults,
  });

  // Resync el formulario en cada apertura — antes se quedaba con los datos del pago anterior.
  useEffect(() => {
    if (isPagoDrawerOpen) {
      pagoForm.reset(pagoSueldoDefaults);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPagoDrawerOpen]);

  // Date filter for devengado: rango personalizado [start, end]
  const [periodStartDate, setPeriodStartDate] = useState<Date | undefined>(startOfMonth(new Date()));
  const [periodEndDate, setPeriodEndDate] = useState<Date | undefined>(undefined);

  const fetchData = useCallback(async () => {
    if (!organization) return;
    
    setIsLoading(true);
    try {
      // Fetch created_at for barbers with fixed salary (for historical accrual)
      const fixedBarberIds = barbers.filter(b => b.compensationType === 'fijo' && b.fixedSalary).map(b => b.id);
      let barberCreatedAtMap: Record<string, string> = {};
      if (fixedBarberIds.length > 0) {
        const { data: barberDates } = await supabase
          .from('barberos')
          .select('id, created_at')
          .in('id', fixedBarberIds);
        barberDates?.forEach(b => { barberCreatedAtMap[b.id] = b.created_at; });
      }

      // ALWAYS fetch ALL data for saldo calculation (historical)
      let ingHistQuery = supabase
        .from('ingresos')
        .select('barbero_id, sueldo, comision_productos')
        .eq('organization_id', organization.id)
        .eq('estado', 'activo');
      if (currentSucursal) ingHistQuery = ingHistQuery.eq('sucursal_id', currentSucursal.id);

      const { data: ingresosHistoricos, error: ingresosHistoricosError } = await ingHistQuery;
      if (ingresosHistoricosError) throw ingresosHistoricosError;

      let pagHistQuery = supabase
        .from('pagos_sueldos')
        .select('barbero_id, monto')
        .eq('organization_id', organization.id);
      if (currentSucursal) pagHistQuery = pagHistQuery.eq('sucursal_id', currentSucursal.id);

      const { data: pagosHistoricos, error: pagosHistoricosError } = await pagHistQuery;
      if (pagosHistoricosError) throw pagosHistoricosError;

      // Calculate HISTORICAL totals for saldo (real debt - never changes with filter)
      const devengadoHistoricoPorId: Record<string, number> = {};
      const comisionProdHistoricoPorId: Record<string, number> = {};
      ingresosHistoricos?.forEach((ingreso: any) => {
        const barberoId = ingreso.barbero_id;
        if (barberoId) {
          devengadoHistoricoPorId[barberoId] = (devengadoHistoricoPorId[barberoId] || 0) + (ingreso.sueldo || 0);
          const cp = Number(ingreso.comision_productos) || 0;
          devengadoHistoricoPorId[barberoId] += cp;
          comisionProdHistoricoPorId[barberoId] = (comisionProdHistoricoPorId[barberoId] || 0) + cp;
        }
      });

      const pagadoHistoricoPorId: Record<string, number> = {};
      pagosHistoricos?.forEach(pago => {
        const barberoId = pago.barbero_id;
        if (barberoId) {
          pagadoHistoricoPorId[barberoId] = (pagadoHistoricoPorId[barberoId] || 0) + pago.monto;
        }
      });

      // Build query for ingresos - filtered by period if set (for display)
      let ingresosQuery = supabase
        .from('ingresos')
        .select('id, barbero, barbero_id, sueldo, total_facturado, efectivo, mp, dia, created_at, comision_productos')
        .eq('organization_id', organization.id)
        .eq('estado', 'activo')
        .order('created_at', { ascending: false });
      
      if (currentSucursal) {
        ingresosQuery = ingresosQuery.eq('sucursal_id', currentSucursal.id);
      }
      
      if (periodStartDate) {
        const startDateStr = format(periodStartDate, 'yyyy-MM-dd');
        ingresosQuery = ingresosQuery.gte('created_at', `${startDateStr}T00:00:00`);
      }
      if (periodEndDate) {
        const endDateStr = format(periodEndDate, 'yyyy-MM-dd');
        ingresosQuery = ingresosQuery.lte('created_at', `${endDateStr}T23:59:59`);
      }

      const { data: ingresosFiltrados, error: ingresosFiltradosError } = await ingresosQuery;
      if (ingresosFiltradosError) throw ingresosFiltradosError;

      // Fetch pagos filtered by period (for display)
      let pagosQuery = supabase
        .from('pagos_sueldos')
        .select('*')
        .eq('organization_id', organization.id)
        .order('created_at', { ascending: false });
      
      if (currentSucursal) {
        pagosQuery = pagosQuery.eq('sucursal_id', currentSucursal.id);
      }
      
      if (periodStartDate) {
        const startDateStr = format(periodStartDate, 'yyyy-MM-dd');
        pagosQuery = pagosQuery.gte('created_at', `${startDateStr}T00:00:00`);
      }
      if (periodEndDate) {
        const endDateStr = format(periodEndDate, 'yyyy-MM-dd');
        pagosQuery = pagosQuery.lte('created_at', `${endDateStr}T23:59:59`);
      }

      const { data: pagosFiltrados, error: pagosFiltradosError } = await pagosQuery;
      if (pagosFiltradosError) throw pagosFiltradosError;

      setPagos(pagosFiltrados || []);

      // Calculate FILTERED devengado per barber (for display)
      const devengadoFiltradoPorId: Record<string, number> = {};
      const comisionProdFiltradoPorId: Record<string, number> = {};
      (ingresosFiltrados as any[] | null)?.forEach(ingreso => {
        const barberoId = ingreso.barbero_id;
        if (barberoId) {
          devengadoFiltradoPorId[barberoId] = (devengadoFiltradoPorId[barberoId] || 0) + (ingreso.sueldo || 0);
          const cp = Number(ingreso.comision_productos) || 0;
          comisionProdFiltradoPorId[barberoId] = (comisionProdFiltradoPorId[barberoId] || 0) + cp;
        }
      });

      // Calculate FILTERED pagado per barber (for display)
      const pagadoFiltradoPorId: Record<string, number> = {};
      pagosFiltrados?.forEach(pago => {
        const barberoId = pago.barbero_id;
        if (barberoId) {
          pagadoFiltradoPorId[barberoId] = (pagadoFiltradoPorId[barberoId] || 0) + pago.monto;
        }
      });

      // === Comision Extra por Equipo: fetch configs + rules ===
      const { data: comisionConfigs } = await supabase
        .from('comision_equipo_config')
        .select('id, encargado_id, activa, scope_type, sucursal_id')
        .eq('organization_id', organization.id)
        .eq('activa', true);

      // For each active config, fetch ALL rules that overlap with the period (for filtered view)
      // and ALL rules (for historical saldo)
      let allComisionReglas: { config_id: string; barbero_origen_id: string; porcentaje: number; vigencia_desde: string; vigencia_hasta: string | null }[] = [];
      if (comisionConfigs && comisionConfigs.length > 0) {
        const configIds = comisionConfigs.map(c => c.id);
        const { data: reglasData } = await supabase
          .from('comision_equipo_reglas')
          .select('config_id, barbero_origen_id, porcentaje, vigencia_desde, vigencia_hasta')
          .in('config_id', configIds)
          .eq('activa', true);
        allComisionReglas = reglasData || [];
      }

      // Helper: find applicable rule for a given date
      const findRegla = (configId: string, barberoOrigenId: string, fechaCierre: string) => {
        return allComisionReglas.find(r =>
          r.config_id === configId &&
          r.barbero_origen_id === barberoOrigenId &&
          r.vigencia_desde <= fechaCierre &&
          (r.vigencia_hasta === null || r.vigencia_hasta >= fechaCierre)
        );
      };

      // Pre-compute comision extra per encargado using ALL ingresos (historical) and filtered ingresos
      // We need ALL active ingresos for historical calc, and filtered ones for display
      // The historical ingresos are already fetched (ingresosHistoricos) but without full detail
      // We need total_facturado + created_at per barbero_id for commission calc
      // Fetch these separately for commission
      let comisionIngresosForCalc: { barbero_id: string; total_facturado: number; created_at: string }[] = [];
      if (comisionConfigs && comisionConfigs.length > 0) {
        // Get all unique barbero_origen_ids from rules
        const origenIds = [...new Set(allComisionReglas.map(r => r.barbero_origen_id))];
        if (origenIds.length > 0) {
          let comIngQuery = supabase
            .from('ingresos')
            .select('barbero_id, total_facturado, created_at')
            .eq('organization_id', organization.id)
            .eq('estado', 'activo')
            .in('barbero_id', origenIds);
          if (currentSucursal) comIngQuery = comIngQuery.eq('sucursal_id', currentSucursal.id);
          const { data: comIngData } = await comIngQuery;
          comisionIngresosForCalc = (comIngData || []).map(i => ({
            barbero_id: i.barbero_id || '',
            total_facturado: Number(i.total_facturado) || 0,
            created_at: i.created_at,
          }));
        }
      }

      // Calculate per-encargado commission (historical and filtered)
      type ComisionResult = { historico: Record<string, { nombre: string; porcentaje: number; monto: number }>; filtrado: Record<string, { nombre: string; porcentaje: number; monto: number }> };
      const comisionPorEncargado: Record<string, ComisionResult> = {};

      if (comisionConfigs) {
        for (const cfg of comisionConfigs) {
          const encargadoId = cfg.encargado_id;
          const configId = cfg.id;
          const result: ComisionResult = { historico: {}, filtrado: {} };

          for (const ingreso of comisionIngresosForCalc) {
            const fechaCierre = format(new Date(ingreso.created_at), 'yyyy-MM-dd');
            const regla = findRegla(configId, ingreso.barbero_id, fechaCierre);
            if (!regla) continue;

            const comision = ingreso.total_facturado * regla.porcentaje / 100;
            const barberOrigen = barbers.find(b => b.id === ingreso.barbero_id);
            const nombre = barberOrigen ? `${barberOrigen.firstName} ${barberOrigen.lastName}`.trim() : 'Barbero';

            // Historical
            if (!result.historico[ingreso.barbero_id]) {
              result.historico[ingreso.barbero_id] = { nombre, porcentaje: regla.porcentaje, monto: 0 };
            }
            result.historico[ingreso.barbero_id].monto += comision;
            result.historico[ingreso.barbero_id].porcentaje = regla.porcentaje; // last one wins

            // Filtered (only if within period)
            const inPeriod = (!periodStartDate || fechaCierre >= format(periodStartDate, 'yyyy-MM-dd')) &&
              (!periodEndDate || fechaCierre <= format(periodEndDate, 'yyyy-MM-dd'));
            if (inPeriod) {
              if (!result.filtrado[ingreso.barbero_id]) {
                result.filtrado[ingreso.barbero_id] = { nombre, porcentaje: regla.porcentaje, monto: 0 };
              }
              result.filtrado[ingreso.barbero_id].monto += comision;
              result.filtrado[ingreso.barbero_id].porcentaje = regla.porcentaje;
            }
          }

          comisionPorEncargado[encargadoId] = result;
        }
      }

      // === Bono Fijo: sync pending occurrences ===
      const hoyStr = format(new Date(), 'yyyy-MM-dd');
      let bonoQuery = supabase
        .from('bono_fijo_config')
        .select('*')
        .eq('organization_id', organization.id)
        .eq('activa', true)
        .lte('proxima_fecha', hoyStr);
      
      const { data: bonosPendientes } = await bonoQuery;
      if (bonosPendientes && bonosPendientes.length > 0) {
        const today = new Date();
        today.setHours(23, 59, 59, 999);

        for (const bono of bonosPendientes) {
          let nextDate = new Date(bono.proxima_fecha + 'T12:00:00');
          const endDate = bono.fecha_fin ? new Date(bono.fecha_fin + 'T12:00:00') : new Date('9999-12-31T12:00:00');

          while (nextDate <= today && nextDate <= endDate) {
            const fechaStr = format(nextDate, 'yyyy-MM-dd');
            // Insert with ON CONFLICT DO NOTHING (upsert-safe)
            await supabase
              .from('bono_fijo_ocurrencias')
              .upsert({
                organization_id: bono.organization_id,
                sucursal_id: bono.sucursal_id,
                config_id: bono.id,
                barbero_id: bono.barbero_id,
                monto: bono.monto,
                fecha: fechaStr,
              }, { onConflict: 'config_id,fecha', ignoreDuplicates: true });

            nextDate = calcNextDate(
              nextDate,
              bono.repeat_preset,
              bono.repeat_frequency,
              bono.repeat_interval,
              bono.repeat_byweekday,
            );
          }

          // Update proxima_fecha
          await supabase
            .from('bono_fijo_config')
            .update({ proxima_fecha: format(nextDate, 'yyyy-MM-dd') })
            .eq('id', bono.id);
        }
      }

      // Fetch ALL bono fijo ocurrencias for the org (historical)
      let bonoOcurrenciasQuery = supabase
        .from('bono_fijo_ocurrencias')
        .select('barbero_id, monto, fecha')
        .eq('organization_id', organization.id);
      if (currentSucursal) bonoOcurrenciasQuery = bonoOcurrenciasQuery.eq('sucursal_id', currentSucursal.id);
      const { data: allBonoOcurrencias } = await bonoOcurrenciasQuery;

      // Group by barbero_id
      const bonoHistoricoPorId: Record<string, number> = {};
      const bonoOcurrenciasPorId: Record<string, BonoFijoOcurrencia[]> = {};
      const bonoFiltradoPorId: Record<string, { total: number; ocurrencias: BonoFijoOcurrencia[] }> = {};

      (allBonoOcurrencias || []).forEach((o: any) => {
        const bid = o.barbero_id;
        const m = Number(o.monto) || 0;
        // Historical total
        bonoHistoricoPorId[bid] = (bonoHistoricoPorId[bid] || 0) + m;
        if (!bonoOcurrenciasPorId[bid]) bonoOcurrenciasPorId[bid] = [];
        bonoOcurrenciasPorId[bid].push({ fecha: o.fecha, monto: m });

        // Filtered
        const inPeriod = (!periodStartDate || o.fecha >= format(periodStartDate, 'yyyy-MM-dd')) &&
          (!periodEndDate || o.fecha <= format(periodEndDate, 'yyyy-MM-dd'));
        if (inPeriod) {
          if (!bonoFiltradoPorId[bid]) bonoFiltradoPorId[bid] = { total: 0, ocurrencias: [] };
          bonoFiltradoPorId[bid].total += m;
          bonoFiltradoPorId[bid].ocurrencias.push({ fecha: o.fecha, monto: m });
        }
      });

      // Build salary data for active barbers
      const now = new Date();
      const data: BarberSalaryData[] = barbers.map(barber => {
        const isFijo = barber.compensationType === 'fijo';
        
        // FILTERED values for display (change with period filter)
        let totalDevengado = devengadoFiltradoPorId[barber.id] || 0;
        const totalPagado = pagadoFiltradoPorId[barber.id] || 0;
        
        // For fixed salary: calculate proportional daily accrual
        let fixedSalaryInfo: BarberSalaryData['fixedSalaryInfo'] = undefined;
        if (isFijo && barber.fixedSalary) {
          const createdAt = barberCreatedAtMap[barber.id] ? new Date(barberCreatedAtMap[barber.id]) : now;
          const periodStart = periodStartDate || createdAt;
          const efectiveStart = isBefore(createdAt, periodStart) ? periodStart : createdAt;
          const efectiveEnd = periodEndDate ?? now;
          const devengadoFijo = calcularDevengadoFijo(barber.fixedSalary, efectiveStart, efectiveEnd);
          const dias = differenceInCalendarDays(efectiveEnd, efectiveStart);
          totalDevengado += devengadoFijo;
          fixedSalaryInfo = { sueldoFijo: barber.fixedSalary, dias: Math.max(0, dias), devengado: devengadoFijo };
        }

        // Comision extra por equipo (filtered)
        let comisionExtraEquipo: ComisionEquipoDetalle[] | undefined;
        const comisionData = comisionPorEncargado[barber.id];
        if (comisionData) {
          const filtrado = comisionData.filtrado;
          const entries = Object.entries(filtrado).filter(([, v]) => v.monto > 0);
          if (entries.length > 0) {
            comisionExtraEquipo = entries.map(([barberoOrigenId, v]) => ({
              barberoOrigenId,
              barberoOrigenNombre: v.nombre,
              porcentajeActual: v.porcentaje,
              montoTotal: v.monto,
            }));
            const totalComisionExtra = entries.reduce((sum, [, v]) => sum + v.monto, 0);
            totalDevengado += totalComisionExtra;
          }
        }

        // Bono fijo (filtered)
        let bonoFijoOcurrencias: BonoFijoOcurrencia[] | undefined;
        let bonoFijoTotal: number | undefined;
        const bonoFiltrado = bonoFiltradoPorId[barber.id];
        if (bonoFiltrado && bonoFiltrado.total > 0) {
          bonoFijoOcurrencias = bonoFiltrado.ocurrencias.sort((a, b) => a.fecha.localeCompare(b.fecha));
          bonoFijoTotal = bonoFiltrado.total;
          totalDevengado += bonoFijoTotal;
        }

        // Comisión por productos vendidos (filtered)
        const comisionProductosTotal = comisionProdFiltradoPorId[barber.id] || 0;
        if (comisionProductosTotal > 0) {
          totalDevengado += comisionProductosTotal;
        }
        // HISTORICAL saldo - real debt that NEVER changes with filter
        let saldoHistorico = (devengadoHistoricoPorId[barber.id] || 0) - (pagadoHistoricoPorId[barber.id] || 0);
        // For fixed salary: add historical accrual from created_at to now
        if (isFijo && barber.fixedSalary) {
          const createdAt = barberCreatedAtMap[barber.id] ? new Date(barberCreatedAtMap[barber.id]) : now;
          const devengadoHistoricoFijo = calcularDevengadoFijo(barber.fixedSalary, createdAt, now);
          saldoHistorico += devengadoHistoricoFijo;
        }
        // Add historical comision extra to saldo
        if (comisionData) {
          const totalHistorico = Object.values(comisionData.historico).reduce((sum, v) => sum + v.monto, 0);
          saldoHistorico += totalHistorico;
        }
        // Add historical comisión productos to saldo
        saldoHistorico += (comisionProdHistoricoPorId[barber.id] || 0);
        // Add historical bono fijo to saldo
        saldoHistorico += (bonoHistoricoPorId[barber.id] || 0);
        
        // Get detailed ingresos for this barber by barbero_id
        const detalleIngresos: IngresoDetalle[] = ((ingresosFiltrados || []) as IngresoRaw[])
          .filter(i => i.barbero_id === barber.id)
          .map(i => ({
            id: i.id,
            fecha: i.created_at,
            dia: i.dia || '',
            totalFacturado: Number(i.total_facturado) || 0,
            sueldo: Number(i.sueldo) || 0,
            efectivo: Number(i.efectivo) || 0,
            mp: Number(i.mp) || 0,
          }));

        // Get detailed pagos for this barber by barbero_id
        const detallePagos: PagoDetalle[] = (pagosFiltrados || [])
          .filter(p => p.barbero_id === barber.id)
          .map(p => ({
            id: p.id,
            fecha: p.created_at,
            monto: Number(p.monto) || 0,
            concepto: p.concepto,
          }));

        // Build display name for UI
        const nombreCompleto = `${barber.firstName.trim()} ${barber.lastName.trim()}`.replace(/\s+/g, ' ').trim();

        return {
          barberId: barber.id,
          barberName: nombreCompleto || barber.firstName.trim(),
          compensationType: barber.compensationType || 'comision',
          totalDevengado,
          totalPagado,
          saldo: saldoHistorico,  // Always historical
          detalleIngresos,
          detallePagos,
          fixedSalaryInfo,
          comisionExtraEquipo,
          bonoFijoOcurrencias,
          bonoFijoTotal,
          comisionProductosTotal,
        };
      });

      setSalaryData(data);
    } catch (error) {
      console.error('Error fetching salary data:', error);
      toast.error('Error al cargar datos de sueldos');
    } finally {
      setIsLoading(false);
      setHasLoadedOnce(true);
    }
  }, [organization, barbers, periodStartDate, periodEndDate, currentSucursal]);

  useEffect(() => {
    fetchData();
  }, [fetchData, periodStartDate, periodEndDate]);

  const onSubmitPago = async (values: PagoSueldoFormValues) => {
    if (!organization) return;

    const montoNum = parseFloat(values.monto);

    const barber = barbers.find(b => b.id === values.barberoId);
    if (!barber) {
      toast.error('Barbero no encontrado');
      return;
    }

    const gate = await requirePinForAction('registrar_pago_sueldo', currentSucursal?.id ?? null);
    if (!gate.ok) return;

    try {
      // Normalize name to avoid spacing issues
      const nombreNormalizado = `${barber.firstName.trim()} ${barber.lastName.trim()}`.replace(/\s+/g, ' ').trim();

      // 1. Insert pago_sueldos y obtener el id
      const { data: pagoInsertado, error } = await supabase
        .from('pagos_sueldos')
        .insert({
          barbero_id: values.barberoId,
          barbero_nombre: nombreNormalizado,
          monto: montoNum,
          concepto: values.concepto || null,
          organization_id: organization.id,
          sucursal_id: currentSucursal?.id || null,
        })
        .select('id, fecha')
        .single();

      if (error || !pagoInsertado) throw error ?? new Error('No se pudo registrar el pago');

      const pagoSueldoId = pagoInsertado.id as string;

      // 2. Generar egreso automático según modalidad del barbero
      const esFijo = barber.compensationType === 'fijo';
      const periodoRef = periodStartDate ?? new Date();
      const mesAnio = format(periodoRef, "MMMM yyyy", { locale: es });
      const fechaEgreso = (pagoInsertado.fecha as string) ?? new Date().toISOString();

      const categoriaEgreso = esFijo ? 'Sueldos fijos del personal' : 'Comisiones del personal';
      const tipoCostoEgreso: 'fijo' | 'variable' = esFijo ? 'fijo' : 'variable';
      const prefijo = esFijo ? 'Sueldo' : 'Comisión';
      const descripcionEgreso = `${prefijo} — ${nombreNormalizado} — ${mesAnio}`;

      const { error: egresoError } = await supabase.from('Egresos').insert({
        Fecha: fechaEgreso,
        Categoria: categoriaEgreso,
        Monto: montoNum,
        Descripcion: descripcionEgreso,
        tipo_costo: tipoCostoEgreso,
        pago_sueldo_id: pagoSueldoId,
        organization_id: organization.id,
        sucursal_id: currentSucursal?.id || null,
        estado: 'activo',
      });

      if (egresoError) {
        // Rollback: borrar el pago para que no quede huérfano
        await supabase.from('pagos_sueldos').delete().eq('id', pagoSueldoId);
        throw egresoError;
      }

      toast.success('Pago registrado correctamente');
      setIsPagoDrawerOpen(false);
      fetchData();
    } catch (error) {
      console.error('Error registering payment:', error);
      toast.error('Error al registrar el pago');
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'ARS',
      minimumFractionDigits: 0,
    }).format(amount);
  };

  const getSaldoBadge = (saldo: number) => {
    if (saldo > 0) {
      return <StatusPill status="error" label={`Debe: ${formatCurrency(saldo)}`} />;
    } else if (saldo < 0) {
      return <StatusPill status="warning" label={`A favor: ${formatCurrency(Math.abs(saldo))}`} icon={false} />;
    } else {
      return <StatusPill status="neutral" label="Al día" />;
    }
  };

  // Primera carga real: sin datos utilizables todavía. Un refetch posterior
  // (cambio de período, pago registrado) ya tiene contenido en pantalla y no
  // vuelve a este estado — ver Silent-Refetch Rule en DESIGN.md → Loading.
  const skeletonDelayed = useDelayedVisible(isLoading);
  const showSkeleton = !hasLoadedOnce && skeletonDelayed;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Sueldos"
        icon={Wallet}
        subtitle="Pagos al equipo, fijos y variables."
        className="pl-0"
        actions={(
          <Button onClick={() => setIsPagoDrawerOpen(true)} className="w-full sm:w-auto">
            <Plus className="h-4 w-4 mr-2" />
            Registrar Pago
          </Button>
        )}
      />

      {/* Filtros de período — fila propia, separada del header (Opción A) */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button
            variant={!periodStartDate && !periodEndDate ? "default" : "outline"}
            size="sm"
            onClick={() => { setPeriodStartDate(undefined); setPeriodEndDate(undefined); }}
          >
            Todo
          </Button>
          <Button
            variant={
              !periodEndDate &&
              periodStartDate &&
              format(periodStartDate, 'yyyy-MM-dd') === format(startOfMonth(new Date()), 'yyyy-MM-dd')
                ? "default"
                : "outline"
            }
            size="sm"
            onClick={() => { setPeriodStartDate(startOfMonth(new Date())); setPeriodEndDate(undefined); }}
          >
            Este mes
          </Button>
        </div>

        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={cn(
                "min-w-[180px] justify-start text-left font-normal",
                periodEndDate && "border-primary"
              )}
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              {periodStartDate && periodEndDate
                ? `${format(periodStartDate, "dd/MM/yyyy")} – ${format(periodEndDate, "dd/MM/yyyy")}`
                : 'Personalizado'}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="range"
              selected={{ from: periodStartDate, to: periodEndDate }}
              onSelect={(range) => {
                setPeriodStartDate(range?.from);
                setPeriodEndDate(range?.to);
              }}
              locale={es}
              numberOfMonths={2}
              initialFocus
              className="pointer-events-auto"
            />
          </PopoverContent>
        </Popover>
      </div>

      <DrawerForm
        open={isPagoDrawerOpen}
        onOpenChange={setIsPagoDrawerOpen}
        title="Registrar Pago de Sueldo"
        size="sm"
        isDirty={pagoForm.formState.isDirty}
        footer={
          <div className="flex w-full justify-end gap-2">
            <Button variant="outline" onClick={() => setIsPagoDrawerOpen(false)} disabled={pagoForm.formState.isSubmitting}>
              Cancelar
            </Button>
            <Button type="submit" form="pago-sueldo-form" disabled={pagoForm.formState.isSubmitting || barbers.length === 0}>
              {pagoForm.formState.isSubmitting ? 'Registrando...' : 'Registrar Pago'}
            </Button>
          </div>
        }
      >
        <Form {...pagoForm}>
          <form id="pago-sueldo-form" onSubmit={pagoForm.handleSubmit(onSubmitPago)} className="space-y-4">
            {barbers.length === 0 ? (
              <EmptySelectHint
                message="No hay empleados activos."
                ctaLabel="Añadir miembro del equipo"
                onCta={() => toast.message('Abrí Mi Negocio y entrá en Equipo para añadir o activar empleados.')}
              />
            ) : (
              <FormField
                control={pagoForm.control}
                name="barberoId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Empleado</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger><SelectValue placeholder="Seleccionar empleado" /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {barbers.map(barber => (
                          <SelectItem key={barber.id} value={barber.id}>
                            {barber.firstName} {barber.lastName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={pagoForm.control}
              name="monto"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Monto</FormLabel>
                  <FormControl>
                    <CurrencyInput placeholder="0" value={field.value} onChange={field.onChange} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={pagoForm.control}
              name="concepto"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Concepto (opcional)</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      maxLength={240}
                      placeholder="Ej: Adelanto de sueldo, Pago quincenal..."
                    />
                  </FormControl>
                  <p className="text-xs text-muted-foreground text-right">{(field.value ?? '').length}/240</p>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>
      </DrawerForm>

      {shouldGateSueldosView ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-10 gap-3 text-center">
            <p className="text-sm text-muted-foreground max-w-sm">
              El detalle de sueldos puede requerir autorización.
            </p>
            <Button onClick={handleUnlockSueldosView}>Ver sueldos</Button>
          </CardContent>
        </Card>
      ) : showSkeleton ? (
        <>
          {/* Summary Cards — skeleton */}
          <div className="grid gap-4 md:grid-cols-3">
            {[0, 1, 2].map(i => (
              <Card key={i}>
                <CardHeader className="pb-2">
                  <Skeleton className="h-4 w-32" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-7 w-40" />
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Resumen por Empleado — skeleton */}
          <Card>
            <CardHeader>
              <CardTitle>Resumen por Empleado</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {[0, 1, 2].map(i => (
                <div key={i} className="rounded-lg border p-4">
                  <SkeletonRow leading={false} lines={2} />
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Historial de Pagos — skeleton */}
          <Card>
            <CardHeader>
              <CardTitle>Historial de Pagos</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Empleado</TableHead>
                    <TableHead>Concepto</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[0, 1, 2].map(i => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                      <TableCell className="text-right"><Skeleton className="ml-auto h-4 w-16" /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  A pagar {periodStartDate && periodEndDate ? `(${format(periodStartDate, "dd/MM/yyyy")} – ${format(periodEndDate, "dd/MM/yyyy")})` : periodStartDate ? `(desde ${format(periodStartDate, "dd/MM/yyyy")})` : '(total)'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">
                  {formatCurrency(salaryData.reduce((acc, b) => acc + b.totalDevengado, 0))}
                </p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Pagado {periodStartDate && periodEndDate ? `(${format(periodStartDate, "dd/MM/yyyy")} – ${format(periodEndDate, "dd/MM/yyyy")})` : periodStartDate ? `(desde ${format(periodStartDate, "dd/MM/yyyy")})` : '(total)'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-status-success-foreground">
                  {formatCurrency(salaryData.reduce((acc, b) => acc + b.totalPagado, 0))}
                </p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Saldo Pendiente (histórico)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className={cn(
                  "text-2xl font-bold",
                  salaryData.reduce((acc, b) => acc + b.saldo, 0) > 0 ? "text-destructive" : 
                  salaryData.reduce((acc, b) => acc + b.saldo, 0) < 0 ? "text-status-warning-foreground" : "text-muted-foreground"
                )}>
                  {formatCurrency(salaryData.reduce((acc, b) => acc + b.saldo, 0))}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Salary Table per Barber with expandable details */}
          <Card>
            <CardHeader>
              <CardTitle>Resumen por Empleado</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {salaryData.map(barber => (
                <BarberDetailRow 
                  key={barber.barberId} 
                  barber={barber} 
                  formatCurrency={formatCurrency}
                  getSaldoBadge={getSaldoBadge}
                />
              ))}
              {salaryData.length === 0 && (
                <p className="text-center text-muted-foreground py-8">
                  No hay datos de sueldos registrados
                </p>
              )}
            </CardContent>
          </Card>

          {/* Payment History */}
          <Card>
            <CardHeader>
              <CardTitle>Historial de Pagos</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Empleado</TableHead>
                    <TableHead>Concepto</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagos.map(pago => (
                    <TableRow key={pago.id}>
                      <TableCell>
                        {format(new Date(pago.created_at), "dd/MM/yyyy HH:mm", { locale: es })}
                      </TableCell>
                      <TableCell className="font-medium">{pago.barbero_nombre}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {pago.concepto || '-'}
                      </TableCell>
                      <TableCell className="text-right font-medium text-status-success-foreground">
                        {formatCurrency(pago.monto)}
                      </TableCell>
                    </TableRow>
                  ))}
                  {pagos.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                        No hay pagos registrados
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
