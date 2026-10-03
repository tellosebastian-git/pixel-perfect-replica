import { Banknote, CreditCard, Receipt, TrendingUp, Clock, User, ChevronLeft, ChevronRight, CalendarIcon, Percent, CheckCircle, Loader2, MoreVertical, Ban, XCircle, CalendarClock, AlertTriangle, RefreshCw, BarChart3 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/PageHeader';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Transaction, Barber, Service, Line, isDigitalMethod } from '@/types/barbershop';
import { format, addDays, subDays, isToday, isBefore, startOfDay } from 'date-fns';
import { es } from 'date-fns/locale';
import { useMemo, useState, useCallback, useEffect } from 'react';
import { useCashClosing } from '@/hooks/useCashClosing';
import { calcComisionProductos, ProductoCfg } from '@/lib/comisionProductos';
import { CashClosingHistory } from './CashClosingHistory';
import { AnulacionesCierreHistory } from './AnulacionesCierreHistory';
import { VoidTransactionDialog } from './VoidTransactionDialog';
import { VoidClosureDialog } from './VoidClosureDialog';
import { useVoidClosure } from '@/hooks/useVoidClosure';
import { BackfillWizard } from './BackfillWizard';
import { MultiDayClosingSummary } from './MultiDayClosingSummary';
import { TransactionDetailDrawer } from './TransactionDetailDrawer';

import { Badge } from '@/components/ui/badge';
import { StatusPill } from '@/components/ui/StatusPill';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useOrganization } from '@/contexts/OrganizationContext';
import { useSucursal } from '@/contexts/SucursalContext';
import { useRequirePinForAction } from '@/components/ActionPinGate';

import { toast } from 'sonner';
import { getStartOfDayLocal, getEndOfDayLocal } from '@/lib/dateUtils';

interface DailySummaryProps {
  summary: {
    count: number;
    totalEfectivo: number;
    totalMercadoPago: number;
    total: number;
    totalEfectivoCobrado: number;
    totalDigitalCobrado: number;
    totalCobrado: number;
    transactions: Transaction[];
  };
  barbers: Barber[];
  services: Service[];
  lines: Line[];
  selectedDate: Date;
  onDateChange: (date: Date) => void;
  onVoidTransaction?: (transactionId: string, voidedBy: string, voidedById: string) => Promise<boolean>;
}

interface BarberSummary {
  barberId: string;
  barberName: string;
  count: number;
  totalEfectivo: number;
  totalMercadoPago: number;
  total: number;
  productosTotal: number;
  serviciosBase: number;
  commissionPct: number;
  commissionAmount: number;
  comisionProductos: number;
}

export function DailySummary({ summary, barbers, services, lines, selectedDate, onDateChange, onVoidTransaction }: DailySummaryProps) {
  const [closingBarber, setClosingBarber] = useState<BarberSummary | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const { saveCashClosing } = useCashClosing();
  const requirePinForAction = useRequirePinForAction();
  const [voidingTransaction, setVoidingTransaction] = useState<Transaction | null>(null);
  const [detailTransaction, setDetailTransaction] = useState<Transaction | null>(null);
  const [txFilter, setTxFilter] = useState<'todas' | 'efectivo' | 'digital'>('todas');
  const [closedBarbers, setClosedBarbers] = useState<Set<string>>(new Set());
  const [closedBarbersData, setClosedBarbersData] = useState<Map<string, { id: number; barberName: string; closed_at: string | null }>>(new Map());
  const [backfillOpen, setBackfillOpen] = useState(false);
  const [regularizingBarber, setRegularizingBarber] = useState<BarberSummary | null>(null);
  const [isRegularizing, setIsRegularizing] = useState(false);
  const [openStalePopover, setOpenStalePopover] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const { user, profile, isOwner, isManager, isSucursalAccount } = useAuth();
  const canVoidClosure = isOwner || isManager || isSucursalAccount;
  const canBackfill = isOwner || isManager;
  const { organization } = useOrganization();
  const { currentSucursal } = useSucursal();
  const validDate = selectedDate instanceof Date && !isNaN(selectedDate.getTime()) 
    ? selectedDate 
    : new Date();

  // Get transactions for selected barber (only active transactions)
  // Mixed payments: a tx can appear in both lists if it has parts in both methods
  const barberTransactions = useMemo(() => {
    if (!closingBarber) return { efectivo: [] as Transaction[], digital: [] as Transaction[] };
    
    const activeTransactions = summary.transactions.filter(
      tx => tx.estado !== 'anulado' && tx.barberId === closingBarber.barberId
    );
    const hasEfectivo = (tx: Transaction) => {
      const payments = tx.payments && tx.payments.length > 0
        ? tx.payments
        : [{ method: tx.paymentMethod, amount: tx.total }];
      return payments.some(p => p.method === 'efectivo' && p.amount > 0);
    };
    const hasDigital = (tx: Transaction) => {
      const payments = tx.payments && tx.payments.length > 0
        ? tx.payments
        : [{ method: tx.paymentMethod, amount: tx.total }];
      return payments.some(p => isDigitalMethod(p.method) && p.amount > 0);
    };
    return {
      efectivo: activeTransactions.filter(hasEfectivo),
      digital: activeTransactions.filter(hasDigital),
    };
  }, [closingBarber, summary.transactions]);

  // Check which barbers have their cash closed for the selected date
  const checkClosedBarbers = useCallback(async () => {
    const tz = organization?.timezone || null;
    const startStr = getStartOfDayLocal(validDate, tz);
    const endStr = getEndOfDayLocal(validDate, tz);
    
    let query = supabase
      .from('ingresos')
      .select('id, barbero, barbero_id, closed_at')
      .gte('created_at', startStr)
      .lte('created_at', endStr)
      .neq('estado', 'eliminado');

    if (currentSucursal) {
      query = query.eq('sucursal_id', currentSucursal.id);
    }

    const { data } = await query;

    if (data) {
      const closedIds = new Set(data.map(d => d.barbero_id).filter(Boolean));
      setClosedBarbers(closedIds as Set<string>);
      
      // Store the mapping of barbero_id to ingreso id for voiding
      const dataMap = new Map<string, { id: number; barberName: string; closed_at: string | null }>();
      data.forEach(d => {
        if (d.barbero_id) {
          dataMap.set(d.barbero_id, { id: d.id, barberName: d.barbero || '', closed_at: d.closed_at ?? null });
        }
      });
      setClosedBarbersData(dataMap);
    }
  }, [validDate, organization?.timezone, currentSucursal]);

  // Check closed barbers on date change
  useEffect(() => {
    checkClosedBarbers();
  }, [checkClosedBarbers]);

  // Reset transaction filter when the selected date changes
  useEffect(() => {
    setTxFilter('todas');
  }, [selectedDate]);

  const {
    voidingClosure,
    setVoidingClosure,
    voidReason,
    setVoidReason,
    handleVoidClosure,
    handleVoidClosureWithReason,
    isVoiding: isVoidingClosure,
  } = useVoidClosure({
    currentSucursalId: currentSucursal?.id ?? null,
    organizationId: organization?.id ?? '',
    userId: user?.id ?? '',
    userFullName: profile?.full_name || user?.email || 'Usuario',
    userEmail: user?.email || '',
    onSuccess: () => checkClosedBarbers(),
  });

  // Check if a transaction can be voided (barber's cash not closed)
  const canVoidTransaction = useCallback((tx: Transaction): boolean => {
    if (!tx.barberId) return true;
    return !closedBarbers.has(tx.barberId);
  }, [closedBarbers]);

  // Calculate per-barber summaries with commissions (only active transactions)
  const barberSummaries = useMemo(() => {
    const summaryMap = new Map<string, BarberSummary>();

    // Initialize all active barbers with their commission percentage
    // (solo quienes tienen rol 'barber' — 'barbers' incluye a todo el personal activo de la sucursal)
    barbers.filter(b => (b.rolesEquipo ?? []).includes('barber')).forEach(barber => {
      summaryMap.set(barber.id, {
        barberId: barber.id,
        barberName: `${barber.firstName} ${barber.lastName}`,
        count: 0,
        totalEfectivo: 0,
        totalMercadoPago: 0,
        total: 0,
        productosTotal: 0,
        serviciosBase: 0,
        commissionPct: barber.commission,
        commissionAmount: 0,
        comisionProductos: 0,
      });
    });

    // Aggregate only active transactions, splitting amounts by payments array
    const activeTransactions = summary.transactions.filter(
      tx => tx.estado !== 'anulado' && !!tx.barberId
    );
    const txPayments = (tx: Transaction) =>
      tx.payments && tx.payments.length > 0
        ? tx.payments
        : [{ method: tx.paymentMethod, amount: tx.total }];

    activeTransactions.forEach(tx => {
      const barberId = tx.barberId as string;
      let existing = summaryMap.get(barberId);
      if (!existing) {
        const barberData = barbers.find(b => b.id === barberId);
        existing = {
          barberId,
          barberName: tx.barberName || '—',
          count: 0,
          totalEfectivo: 0,
          totalMercadoPago: 0,
          total: 0,
          productosTotal: 0,
          serviciosBase: 0,
          commissionPct: barberData?.commission || 0,
          commissionAmount: 0,
          comisionProductos: 0,
        };
        summaryMap.set(barberId, existing);
      }
      const serviceCount = tx.serviceCount ?? (tx.tipoVenta === 'productos' || !tx.serviceId ? 0 : 1);
      const serviciosBaseTx = tx.serviciosBase ?? (tx.tipoVenta === 'productos' ? 0 : tx.total);
      existing.count += serviceCount;
      existing.total += tx.total;
      existing.productosTotal += tx.productosTotal ?? 0;
      existing.serviciosBase += serviciosBaseTx;
      txPayments(tx).forEach(p => {
        if (p.method === 'efectivo') existing!.totalEfectivo += p.amount;
        else if (isDigitalMethod(p.method)) existing!.totalMercadoPago += p.amount;
      });
    });

    // Calculate commission amounts (sólo sobre serviciosBase)
    summaryMap.forEach(s => {
      s.commissionAmount = Math.round(s.serviciosBase * (s.commissionPct / 100));
    });

    return Array.from(summaryMap.values()).filter(s => s.count > 0 || s.productosTotal > 0);
  }, [summary.transactions, barbers]);

  // Comisión por productos en vivo (mismo helper que useCashClosing)
  const [comisionProductosByBarber, setComisionProductosByBarber] = useState<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!organization) {
        setComisionProductosByBarber({});
        return;
      }
      const activeTxs = summary.transactions.filter(tx => tx.estado !== 'anulado' && !!tx.barberId);
      const productoIds = new Set<string>();
      const barberoIds = new Set<string>();
      activeTxs.forEach(tx => {
        (tx.productos || []).forEach(p => p.producto_id && productoIds.add(p.producto_id));
        if ((tx.productos?.length || 0) > 0 && tx.barberId) barberoIds.add(tx.barberId);
      });
      if (productoIds.size === 0 || barberoIds.size === 0) {
        if (!cancelled) setComisionProductosByBarber({});
        return;
      }
      const [{ data: prodCfgRows }, { data: barberoCfgRows }] = await Promise.all([
        currentSucursal?.id
          ? supabase
              .from('productos_sucursal')
              .select('producto_id, comision_modo, comision_porcentaje, precio_costo')
              .eq('sucursal_id', currentSucursal.id)
              .in('producto_id', Array.from(productoIds))
          : Promise.resolve({ data: [] as any[] }),
        supabase
          .from('comision_productos_config')
          .select('barbero_id, porcentaje, activa')
          .eq('organization_id', organization.id)
          .eq('activa', true)
          .in('barbero_id', Array.from(barberoIds)),
      ]);
      const prodCfgMap: Record<string, ProductoCfg> = {};
      (prodCfgRows || []).forEach((r: any) => {
        prodCfgMap[r.producto_id] = {
          comision_modo: (r.comision_modo as any) || 'barbero',
          comision_porcentaje: r.comision_porcentaje,
          precio_costo: r.precio_costo,
        };
      });
      const barberoCfgMap: Record<string, { porcentaje: number; activa: boolean }> = {};
      (barberoCfgRows || []).forEach((r: any) => {
        barberoCfgMap[r.barbero_id] = { porcentaje: Number(r.porcentaje) || 0, activa: !!r.activa };
      });
      const result: Record<string, number> = {};
      const byBarber = new Map<string, { producto_id: string; cantidad: number; precio_unitario: number }[]>();
      activeTxs.forEach(tx => {
        if (!tx.barberId || !tx.productos?.length) return;
        const arr = byBarber.get(tx.barberId) || [];
        tx.productos.forEach(p => arr.push({
          producto_id: p.producto_id,
          cantidad: p.cantidad,
          precio_unitario: p.precio_unitario,
        }));
        byBarber.set(tx.barberId, arr);
      });
      byBarber.forEach((items, barberoId) => {
        const { total } = calcComisionProductos(items, barberoCfgMap[barberoId] || null, prodCfgMap);
        result[barberoId] = total;
      });
      if (!cancelled) setComisionProductosByBarber(result);
    })();
    return () => { cancelled = true; };
  }, [summary.transactions, organization, currentSucursal]);

  const hayProductosConBarbero = useMemo(
    () => barberSummaries.some(b => (b.productosTotal ?? 0) > 0),
    [barberSummaries]
  );

  // Detección de cierres desactualizados: ventas activas posteriores a closed_at por barbero.
  // Defensa en profundidad: solo cuentan transacciones cuyo createdAt cae dentro del día
  // calendario de validDate en el timezone de la organización. Evita falsos positivos si la
  // app cruza la medianoche con transacciones de otro día aún en memoria.
  const staleByBarber = useMemo(() => {
    const tz = organization?.timezone || null;
    const dayStartMs = new Date(getStartOfDayLocal(validDate, tz)).getTime();
    const dayEndMs = new Date(getEndOfDayLocal(validDate, tz)).getTime();
    const result: Record<string, { count: number; total: number; lastAt: string }> = {};
    closedBarbersData.forEach((data, barberId) => {
      if (!data.closed_at) return;
      const closedAtMs = new Date(data.closed_at).getTime();
      if (Number.isNaN(closedAtMs)) return;
      const posteriores = summary.transactions.filter(tx => {
        if (tx.estado === 'anulado') return false;
        if (tx.barberId !== barberId) return false;
        const txMs = new Date(tx.createdAt).getTime();
        if (Number.isNaN(txMs)) return false;
        // Mismo día calendario que validDate (en TZ de la organización)
        if (txMs < dayStartMs || txMs > dayEndMs) return false;
        return txMs > closedAtMs;
      });
      if (posteriores.length === 0) return;
      const total = posteriores.reduce((s, tx) => s + (tx.total || 0), 0);
      const lastAt = posteriores.reduce((acc, tx) => {
        const t = new Date(tx.createdAt).getTime();
        return t > acc ? t : acc;
      }, 0);
      result[barberId] = {
        count: posteriores.length,
        total,
        lastAt: new Date(lastAt).toISOString(),
      };
    });
    return result;
  }, [closedBarbersData, summary.transactions, validDate, organization?.timezone]);

  // Check if selected date is in the past (for backfill CTA)
  const isPastDate = useMemo(() => isBefore(startOfDay(validDate), startOfDay(new Date())), [validDate]);

  // Check which barbers are missing closings (for backfill)
  // Solo personal con rol 'barber' — 'barbers' incluye a todo el personal activo (dueño, encargados, otros)
  const barbersWithoutClosing = useMemo(() =>
    barbers.filter(b => (b.rolesEquipo ?? []).includes('barber') && !closedBarbers.has(b.id)),
    [barbers, closedBarbers]
  );

  // Transactions filtered by selected method chip
  const txFiltradas = useMemo(
    () =>
      txFilter === 'todas'
        ? summary.transactions
        : summary.transactions.filter(tx =>
            tx.payments?.some(p =>
              txFilter === 'efectivo'
                ? p.method === 'efectivo'
                : isDigitalMethod(p.method)
            ) ?? false
          ),
    [txFilter, summary.transactions]
  );

  // Navegación libre entre fechas: el PIN ya no aplica a navegación.
  // Acciones sensibles (cerrar caja, anular, ver historial) usan requirePinForAction localmente.
  const navigateToDate = useCallback((date: Date) => {
    onDateChange(date);
  }, [onDateChange]);

  const handlePreviousDay = () => navigateToDate(subDays(validDate, 1));
  const handleNextDay = () => {
    const next = addDays(validDate, 1);
    if (isToday(next)) {
      onDateChange(next);
    } else {
      navigateToDate(next);
    }
  };
  const handleToday = () => onDateChange(new Date());

  // Cerrar caja: el PIN se valida en el botón final del diálogo (cerrar_caja).
  const handleClosingClick = useCallback((barber: BarberSummary) => {
    setClosingBarber(barber);
  }, []);

  // Regularizar cierre: abre el AlertDialog directamente.
  const handleRegularizeClick = useCallback((barber: BarberSummary) => {
    setRegularizingBarber(barber);
  }, []);

  // Ver historial de cierres: PIN sólo si la acción ver_historial_caja lo requiere
  // para Cuenta de sucursal. Cuentas personales pasan directo.
  const handleHistoryClick = useCallback(async () => {
    const gate = await requirePinForAction('ver_historial_caja', currentSucursal?.id ?? null);
    if (!gate.ok) return;
    setHistoryOpen(true);
  }, [requirePinForAction, currentSucursal?.id]);

  const REGULARIZE_REASON = 'Se registraron ventas después del cierre. El cierre fue regularizado automáticamente para incluir las ventas posteriores.';

  // Regularizar cierre: anular el cierre actual con auditoría y crear uno nuevo actualizado
  const handleRegularize = async () => {
    if (!regularizingBarber || !user || !organization) return;
    const closure = closedBarbersData.get(regularizingBarber.barberId);
    if (!closure) {
      toast.error('No se encontró el cierre actual');
      return;
    }

    setIsRegularizing(true);
    try {
      // 1) Anular cierre actual via hook (PIN + audit trail con REGULARIZE_REASON)
      const ok = await handleVoidClosureWithReason(
        {
          id: closure.id,
          barberName: closure.barberName || regularizingBarber.barberName,
          fechaCierre: format(validDate, 'yyyy-MM-dd'),
        },
        REGULARIZE_REASON
      );
      if (!ok) return;

      // 2) Crear nuevo cierre actualizado (saveCashClosing filtra internamente por barber.barberId)
      const success = await saveCashClosing({
        barber: regularizingBarber,
        transactions: summary.transactions,
        date: validDate,
        lines,
      });
      if (!success) {
        throw new Error('No se pudo crear el cierre actualizado');
      }

      toast.success('Cierre regularizado correctamente');
      setRegularizingBarber(null);
      await checkClosedBarbers();
    } catch (error) {
      console.error('Error regularizando cierre:', error);
      toast.error('Error al regularizar el cierre');
    } finally {
      setIsRegularizing(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in sm:space-y-8">
      <PageHeader
        title="Cierre de Caja"
        icon={BarChart3}
        subtitle={(
          <span className="font-medium capitalize">
            {format(validDate, "EEEE d 'de' MMMM yyyy", { locale: es })}
          </span>
        )}
        actions={(
          <>
            <div className="flex w-full items-center gap-2 sm:w-auto">
              <Button variant="outline" size="icon" onClick={handlePreviousDay}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="flex-1 sm:min-w-[140px] sm:flex-none">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {format(validDate, 'dd/MM/yyyy')}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="end">
                  <Calendar
                    mode="single"
                    selected={validDate}
                    onSelect={(date) => date && navigateToDate(date)}
                    locale={es}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
              <Button variant="outline" size="icon" onClick={handleNextDay} disabled={isToday(validDate)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
              {!isToday(validDate) && (
                <Button variant="secondary" size="sm" className="sm:w-auto" onClick={handleToday}>
                  Hoy
                </Button>
              )}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <AnulacionesCierreHistory barbers={barbers} />
              <Button variant="outline" size="sm" className="w-full sm:w-auto" onClick={handleHistoryClick}>
                <Clock className="h-4 w-4 mr-2" />
                Historial
              </Button>
              <CashClosingHistory barbers={barbers} externalOpen={historyOpen} onExternalOpenChange={setHistoryOpen} />
            </div>
          </>
        )}
        actionsLayout="row"
      />

      {/* Banner Consultar Período */}
      <div className="rounded-2xl border border-primary/20 bg-primary/5 px-5 py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div>
          <p className="font-semibold text-foreground">Consultar Período</p>
          <p className="text-sm text-muted-foreground">Seleccioná fechas y obtené un resumen completo.</p>
        </div>
        <MultiDayClosingSummary />
      </div>

      {/* General Summary Cards */}
      <div className="grid gap-3 grid-cols-3 md:grid-cols-4">
        <Card className="col-span-3 md:col-span-1 bg-primary border-primary shadow-sm rounded-2xl">
          <CardContent className="p-4 md:pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-primary-foreground/70">Total General</p>
                <p className="text-3xl font-bold text-primary-foreground">${summary.totalCobrado.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="col-span-1 border border-border bg-card rounded-2xl shadow-sm">
          <CardContent className="p-3 md:pt-6">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs md:text-sm text-muted-foreground">Efectivo</p>
                <p className="text-base md:text-xl font-bold text-success">${summary.totalEfectivoCobrado.toLocaleString()}</p>
              </div>
              <div className="w-9 h-9 rounded-lg bg-success/10 flex items-center justify-center shrink-0">
                <Banknote className="h-4 w-4 text-success" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="col-span-1 border border-border bg-card rounded-2xl shadow-sm">
          <CardContent className="p-3 md:pt-6">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs md:text-sm text-muted-foreground">Digital</p>
                <p className="text-base md:text-xl font-bold text-status-info-foreground">${summary.totalDigitalCobrado.toLocaleString()}</p>
              </div>
              <div className="w-9 h-9 rounded-lg bg-status-info-bg flex items-center justify-center shrink-0">
                <CreditCard className="h-4 w-4 text-status-info" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="col-span-1 border border-border bg-card rounded-2xl shadow-sm">
          <CardContent className="p-3 md:pt-6">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs md:text-sm text-muted-foreground">Servicios</p>
                <p className="text-base md:text-xl font-bold text-status-purple">{summary.count}</p>
              </div>
              <div className="w-9 h-9 rounded-lg bg-status-purple-bg flex items-center justify-center shrink-0">
                <Receipt className="h-4 w-4 text-status-purple" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Per-Barber Summaries */}
      <div className="space-y-4">
        <h2 className="text-lg font-medium text-foreground flex items-center gap-2">
          <User className="h-5 w-5 text-muted-foreground" />
          Cierre por barbero
        </h2>

        {barberSummaries.length === 0 ? (
          <Card className="border border-border bg-card rounded-2xl">
            <CardContent className="py-12">
              <div className="text-center text-muted-foreground">
                <User className="h-8 w-8 mx-auto mb-3 opacity-50" />
                <p className="font-medium">Todavía no hay actividad.</p>
                <p className="text-sm mt-1">Los cierres por barbero aparecerán aquí</p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {barberSummaries.map((barber) => (
              <Card key={barber.barberId} className="border border-border bg-card rounded-2xl shadow-sm overflow-hidden">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base font-semibold flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                        <span className="text-sm font-bold text-primary">
                          {barber.barberName.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <span className="truncate">{barber.barberName}</span>
                    </div>
                    {closedBarbers.has(barber.barberId) && staleByBarber[barber.barberId] && (
                      <Popover
                        open={openStalePopover === barber.barberId}
                        onOpenChange={(o) => setOpenStalePopover(o ? barber.barberId : null)}
                      >
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-full border border-destructive/40 bg-destructive/5 px-2 py-0.5 text-[11px] font-medium text-destructive hover:bg-destructive/10 transition-colors shrink-0 max-w-full"
                            aria-label="Cierre desactualizado"
                          >
                            <AlertTriangle className="h-3 w-3 shrink-0" />
                            <span className="hidden sm:inline">Cierre desactualizado</span>
                            <span className="sm:hidden">Desactualizado</span>
                          </button>
                        </PopoverTrigger>
                        <PopoverContent align="end" className="w-72 p-3 space-y-3">
                          <div className="space-y-1">
                            <p className="text-sm font-semibold text-destructive flex items-center gap-1.5">
                              <AlertTriangle className="h-3.5 w-3.5" />
                              Cierre desactualizado
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {staleByBarber[barber.barberId].count} venta{staleByBarber[barber.barberId].count === 1 ? '' : 's'} posterior{staleByBarber[barber.barberId].count === 1 ? '' : 'es'} · ${staleByBarber[barber.barberId].total.toLocaleString()} · Última {format(new Date(staleByBarber[barber.barberId].lastAt), 'HH:mm')}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Esta{staleByBarber[barber.barberId].count === 1 ? '' : 's'} venta{staleByBarber[barber.barberId].count === 1 ? '' : 's'} no está{staleByBarber[barber.barberId].count === 1 ? '' : 'n'} incluida{staleByBarber[barber.barberId].count === 1 ? '' : 's'} en el cierre guardado.
                            </p>
                          </div>
                          {canVoidClosure && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="w-full border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => {
                                setOpenStalePopover(null);
                                handleRegularizeClick(barber);
                              }}
                            >
                              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                              Regularizar
                            </Button>
                          )}
                        </PopoverContent>
                      </Popover>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between py-2 border-b border-border">
                    <span className="text-sm text-muted-foreground flex items-center gap-2">
                      <Receipt className="h-4 w-4" />
                      Servicios
                    </span>
                    <span className="font-semibold text-foreground">{barber.count}</span>
                  </div>
                  <div className="flex items-center justify-between py-2 border-b border-border">
                    <span className="text-sm text-muted-foreground flex items-center gap-2">
                      <Banknote className="h-4 w-4 text-success" />
                      Efectivo
                    </span>
                    <span className="font-semibold text-success">${barber.totalEfectivo.toLocaleString()}</span>
                  </div>
                  <div className="flex items-center justify-between py-2 border-b border-border">
                    <span className="text-sm text-muted-foreground flex items-center gap-2">
                      <CreditCard className="h-4 w-4 text-status-info" />
                      Digital
                    </span>
                    <span className="font-semibold text-status-info-foreground">${barber.totalMercadoPago.toLocaleString()}</span>
                  </div>
                  {hayProductosConBarbero && (
                    <div className="flex items-center justify-between py-2 border-b border-border">
                      <span className="text-sm text-muted-foreground flex items-center gap-2">
                        <Receipt className="h-4 w-4" />
                        Productos
                      </span>
                      <span className="font-semibold text-foreground">${(barber.productosTotal || 0).toLocaleString()}</span>
                    </div>
                  )}
                  {hayProductosConBarbero && (
                    <div className="flex items-center justify-between py-2 border-b border-border">
                      <span className="text-sm text-muted-foreground flex items-center gap-2">
                        <Percent className="h-4 w-4" />
                        Comisión productos
                      </span>
                      <span className="font-semibold text-foreground">${(comisionProductosByBarber[barber.barberId] || 0).toLocaleString()}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between py-2 border-b border-border">
                    <span className="text-sm font-medium text-foreground">Total</span>
                    <span className="text-lg font-bold text-foreground">${barber.total.toLocaleString()}</span>
                  </div>
                  <div className="flex items-center justify-between pt-2 bg-primary/5 -mx-6 px-6 py-3">
                    <span className="text-sm font-medium text-primary flex items-center gap-2">
                      <Percent className="h-4 w-4" />
                      Comisión ({barber.commissionPct}%)
                    </span>
                    <span className="text-lg font-bold text-primary">${barber.commissionAmount.toLocaleString()}</span>
                  </div>
                  <div className="-mx-6 px-6 pb-4 pt-3">
                    {closedBarbers.has(barber.barberId) ? (
                      canVoidClosure ? (
                        <Button
                          variant="destructive"
                          className="w-full"
                          onClick={() => {
                            const closureData = closedBarbersData.get(barber.barberId);
                            if (closureData) {
                              setVoidingClosure({
                                ...closureData,
                                fechaCierre: format(validDate, 'yyyy-MM-dd'),
                              });
                            }
                          }}
                        >
                          <XCircle className="h-4 w-4 mr-2" />
                          Anular cierre
                        </Button>
                      ) : (
                        <div className="flex w-full justify-center py-1">
                          <StatusPill status="success" label="Caja cerrada" icon={CheckCircle} />
                        </div>
                      )
                    ) : isPastDate ? (
                      <Badge variant="outline" className="w-full justify-center py-2 text-muted-foreground">
                        <CalendarClock className="h-4 w-4 mr-2" />
                        Usá "Regularizar día" para cerrar
                      </Badge>
                    ) : (
                      <Button 
                        className="w-full" 
                        onClick={() => handleClosingClick(barber)}
                      >
                        <CheckCircle className="h-4 w-4 mr-2" />
                        Cerrar caja
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Backfill CTA - show when past date and barbers without closing */}
      {isPastDate && canBackfill && barbersWithoutClosing.length > 0 && (
        <Card className="border border-dashed border-primary/40 bg-primary/5 rounded-2xl">
          <CardContent className="py-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <CalendarClock className="h-6 w-6 text-primary" />
                <div>
                  <p className="font-medium text-foreground">
                    {barbersWithoutClosing.length} barbero{barbersWithoutClosing.length > 1 ? 's' : ''} sin cierre de caja
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Podés cargar el cierre de forma diferida para este día
                  </p>
                </div>
              </div>
              <Button className="w-full sm:w-auto" onClick={() => setBackfillOpen(true)}>
                <CalendarClock className="h-4 w-4 mr-2" />
                Regularizar día
                <Badge variant="secondary" className="ml-2 text-xs">Diferido</Badge>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Transactions List */}
      <Card className="border border-border bg-card rounded-2xl shadow-sm">
        <CardHeader>
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            Transacciones del día
          </CardTitle>
        </CardHeader>
        <CardContent>
          {summary.transactions.length > 0 && (
            <div className="flex gap-2 mb-4">
              {(['todas', 'efectivo', 'digital'] as const).map(f => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setTxFilter(f)}
                  className={
                    txFilter === f
                      ? 'px-3 py-1.5 rounded-full text-xs font-semibold bg-primary text-primary-foreground border border-primary transition-colors'
                      : 'px-3 py-1.5 rounded-full text-xs font-semibold bg-background text-muted-foreground border border-border hover:bg-muted transition-colors'
                  }
                >
                  {f === 'todas' ? 'Todas' : f === 'efectivo' ? 'Efectivo' : 'Digital'}
                </button>
              ))}
            </div>
          )}
          {summary.transactions.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Receipt className="h-8 w-8 mx-auto mb-3 opacity-50" />
              <p className="font-medium">Todavía no hay transacciones.</p>
              <p className="text-sm mt-1">Los cobros aparecerán aquí</p>
            </div>
          ) : (
              <div className="space-y-2">
                {txFiltradas.map((tx) => {
                  const isVoided = tx.estado === 'anulado';
                  const canVoid = !isVoided && canVoidTransaction(tx);
                  const txPayments = tx.payments && tx.payments.length > 0
                    ? tx.payments
                    : [{ method: tx.paymentMethod, amount: tx.total }];
                  const isMixed = txPayments.length > 1 && txPayments.every(p => p.amount > 0);
                  const efectivoAmt = txPayments.filter(p => p.method === 'efectivo').reduce((s, p) => s + p.amount, 0);
                  const mpAmt = txPayments.filter(p => isDigitalMethod(p.method)).reduce((s, p) => s + p.amount, 0);

                  return (
                    <div
                      key={tx.id}
                      className={`flex flex-col gap-3 rounded-xl p-4 transition-colors sm:flex-row sm:items-center cursor-pointer ${
                        isVoided
                          ? 'bg-destructive/10 border border-destructive/20 hover:bg-destructive/15'
                          : 'bg-muted/50 hover:bg-muted'
                      }`}
                      onClick={() => setDetailTransaction(tx)}
                    >
                      <div className="flex-shrink-0">
                        {isVoided ? (
                          <div className="w-8 h-8 rounded-lg bg-destructive/10 flex items-center justify-center">
                            <Ban className="h-4 w-4 text-destructive" />
                          </div>
                        ) : isMixed ? (
                          <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center gap-0.5">
                            <Banknote className="h-3 w-3 text-success" />
                            <CreditCard className="h-3 w-3 text-status-info" />
                          </div>
                        ) : tx.paymentMethod === 'efectivo' ? (
                          <div className="w-8 h-8 rounded-lg bg-success/10 flex items-center justify-center">
                            <Banknote className="h-4 w-4 text-success" />
                          </div>
                        ) : (
                          <div className="w-8 h-8 rounded-lg bg-status-info-bg flex items-center justify-center">
                            <CreditCard className="h-4 w-4 text-status-info-foreground" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`font-medium ${isVoided ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                            {tx.serviceName || (tx.productos && tx.productos.length > 0 ? 'Venta de productos' : '—')}
                          </span>
                          {tx.extras.length > 0 && (
                            <Badge variant="secondary">+{tx.extras.length}</Badge>
                          )}
                          {isMixed && !isVoided && (
                            <Badge variant="category" color="default" size="sm">Mixto</Badge>
                          )}
                          {isVoided && (
                            <StatusPill status="error" label="Anulado" />
                          )}
                        </div>
                        <p className={`text-sm ${isVoided ? 'text-muted-foreground/70' : 'text-muted-foreground'}`}>
                          {(tx.barberName || '—')} • {format(new Date(tx.createdAt), 'HH:mm')}
                          {isMixed && !isVoided && (
                            <span className="ml-2">
                              • <span className="text-success">Ef. ${efectivoAmt.toLocaleString()}</span> / <span className="text-status-info-foreground">Dig. ${mpAmt.toLocaleString()}</span>
                            </span>
                          )}
                          {isVoided && tx.anuladoPor && (
                            <span className="ml-2 text-destructive">• Anulado por {tx.anuladoPor}</span>
                          )}
                        </p>
                      </div>
                      <div className="flex w-full items-center justify-between gap-3 sm:w-auto sm:justify-start">
                        <div className="text-right">
                          <p className={`font-semibold ${isVoided ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                            ${(tx.totalCobrado ?? tx.total).toLocaleString()}
                          </p>
                          {tx.discount > 0 && (
                            <p className="text-xs text-muted-foreground">
                              -{tx.discount}%
                            </p>
                          )}
                        </div>
                        {!isVoided && onVoidTransaction ? (
                          <button
                            className="flex h-7 w-7 items-center justify-center rounded-md bg-transparent hover:bg-muted border-[0.5px] border-border"
                            onClick={(e) => { e.stopPropagation(); setDetailTransaction(tx); }}
                          >
                            <MoreVertical className="h-4 w-4" />
                            <span className="sr-only">Ver detalle</span>
                          </button>
                        ) : (
                          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/40" />
                        )}
                      </div>
                    </div>
                  );
                })}
                {txFiltradas.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-6">
                    No hay transacciones con ese medio de pago.
                  </p>
                )}
              </div>
          )}
        </CardContent>
      </Card>

      {/* Void Transaction Dialog (captura motivo + autorización por PIN solo para sucursal_account) */}
      <VoidTransactionDialog
        open={!!voidingTransaction}
        onOpenChange={(open) => !open && setVoidingTransaction(null)}
        transaction={voidingTransaction}
        onConfirm={async (_reason) => {
          if (!voidingTransaction || !onVoidTransaction) return;
          const gate = await requirePinForAction('anular_transaccion', currentSucursal?.id ?? null);
          if (gate.ok !== true) return;
          const voidedBy = gate.userName ?? profile?.full_name ?? profile?.email ?? 'Usuario';
          const voidedById = gate.validatedByUserId ?? profile?.barbero_id ?? user?.id ?? '';
          await onVoidTransaction(voidingTransaction.id, voidedBy, voidedById);
          toast.success(`Transacción anulada por ${voidedBy}`);
          setVoidingTransaction(null);
          setDetailTransaction(null);
          checkClosedBarbers();
        }}
      />

      <TransactionDetailDrawer
        transaction={detailTransaction}
        open={!!detailTransaction}
        onOpenChange={(open) => { if (!open) setDetailTransaction(null); }}
        canVoid={detailTransaction ? canVoidTransaction(detailTransaction) : false}
        onVoidRequest={() => { if (detailTransaction) setVoidingTransaction(detailTransaction); }}
      />

      {/* Cash Closing Dialog */}
      <Dialog open={!!closingBarber} onOpenChange={(open) => !open && setClosingBarber(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-primary" />
              Cierre de caja: {closingBarber?.barberName}
            </DialogTitle>
            <p className="text-sm text-muted-foreground capitalize">
              {format(validDate, "EEEE d 'de' MMMM yyyy", { locale: es })}
            </p>
          </DialogHeader>

          <div className="space-y-6 py-4">
            {/* Summary Cards */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
              <div className="p-4 rounded-lg bg-success/10 border border-success/20">
                <p className="text-sm text-muted-foreground">Efectivo</p>
                <p className="text-xl font-bold text-success">${closingBarber?.totalEfectivo.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground mt-1">{barberTransactions.efectivo.length} servicios</p>
              </div>
              <div className="p-4 rounded-lg bg-status-info-bg border border-status-info/20">
                <p className="text-sm text-muted-foreground">Digital</p>
                <p className="text-xl font-bold text-status-info-foreground">${closingBarber?.totalMercadoPago.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground mt-1">{barberTransactions.digital.length} servicios</p>
              </div>
              <div className="p-4 rounded-lg bg-primary/10 border border-primary/20">
                <p className="text-sm text-muted-foreground">Comisión ({closingBarber?.commissionPct}%)</p>
                <p className="text-xl font-bold text-primary">${closingBarber?.commissionAmount.toLocaleString()}</p>
              </div>
            </div>

            {/* Efectivo Transactions */}
            {barberTransactions.efectivo.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium flex items-center gap-2">
                  <Banknote className="h-4 w-4 text-success" />
                  Efectivo ({barberTransactions.efectivo.length})
                </h4>
                <div className="space-y-2 rounded-lg border border-border p-3 bg-muted/30">
                  {barberTransactions.efectivo.map((tx) => {
                    const pagos = tx.payments && tx.payments.length > 0
                      ? tx.payments
                      : [{ method: tx.paymentMethod, amount: tx.total }];
                    const amt = pagos.filter(p => p.method === 'efectivo').reduce((s, p) => s + p.amount, 0);
                    const isMixed = pagos.length > 1 && pagos.every(p => p.amount > 0);
                    return (
                      <div key={tx.id} className="flex flex-col gap-2 border-b border-border py-2 last:border-0 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <span className="font-medium text-sm">{tx.serviceName || (tx.productos && tx.productos.length > 0 ? "Venta de productos" : "—")}</span>
                          {tx.extras.length > 0 && (
                            <span className="text-xs ml-2 text-muted-foreground">
                              + {tx.extras.map(e => e.name).join(', ')}
                            </span>
                          )}
                          {isMixed && (
                            <Badge variant="outline" className="ml-2 text-[10px] py-0 h-4">Parte de mixto</Badge>
                          )}
                          <p className="text-xs text-muted-foreground">{format(new Date(tx.createdAt), 'HH:mm')}</p>
                        </div>
                        <span className="font-semibold text-success">${amt.toLocaleString()}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Digital Transactions */}
            {barberTransactions.digital.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium flex items-center gap-2">
                  <CreditCard className="h-4 w-4 text-status-info" />
                  Digital ({barberTransactions.digital.length})
                </h4>
                <div className="space-y-2 rounded-lg border border-border p-3 bg-muted/30">
                  {barberTransactions.digital.map((tx) => {
                    const pagos = tx.payments && tx.payments.length > 0
                      ? tx.payments
                      : [{ method: tx.paymentMethod, amount: tx.total }];
                    const amt = pagos.filter(p => isDigitalMethod(p.method)).reduce((s, p) => s + p.amount, 0);
                    const isMixed = pagos.length > 1 && pagos.every(p => p.amount > 0);
                    return (
                      <div key={tx.id} className="flex flex-col gap-2 border-b border-border py-2 last:border-0 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <span className="font-medium text-sm">{tx.serviceName || (tx.productos && tx.productos.length > 0 ? "Venta de productos" : "—")}</span>
                          {tx.extras.length > 0 && (
                            <span className="text-xs ml-2 text-muted-foreground">
                              + {tx.extras.map(e => e.name).join(', ')}
                            </span>
                          )}
                          {isMixed && (
                            <Badge variant="outline" className="ml-2 text-[10px] py-0 h-4">Parte de mixto</Badge>
                          )}
                          <p className="text-xs text-muted-foreground">{format(new Date(tx.createdAt), 'HH:mm')}</p>
                        </div>
                        <span className="font-semibold text-status-info-foreground">${amt.toLocaleString()}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Total Summary */}
            <div className="flex flex-col gap-1 rounded-lg border border-border bg-muted p-4 sm:flex-row sm:items-center sm:justify-between">
              <span className="font-medium">Total General</span>
              <span className="self-end text-2xl font-bold sm:self-auto">${closingBarber?.total.toLocaleString()}</span>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setClosingBarber(null)} disabled={isSaving}>
              Cancelar
            </Button>
            <Button 
              disabled={isSaving}
              onClick={async () => {
                if (!closingBarber) return;
                const gate = await requirePinForAction('cerrar_caja', currentSucursal?.id ?? null);
                if (!gate.ok) return;
                setIsSaving(true);
                const success = await saveCashClosing({
                  barber: closingBarber,
                  transactions: summary.transactions,
                  date: validDate,
                  lines,
                });
                setIsSaving(false);
                if (success) {
                  setClosingBarber(null);
                  checkClosedBarbers(); // Refresh to update button state
                }
              }}
            >
              {isSaving ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <CheckCircle className="h-4 w-4 mr-2" />
              )}
              {isSaving ? 'Guardando...' : 'Confirmar cierre'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <VoidClosureDialog
        open={!!voidingClosure}
        voidingClosure={voidingClosure}
        voidReason={voidReason}
        onVoidReasonChange={setVoidReason}
        onConfirm={handleVoidClosure}
        onCancel={() => { setVoidingClosure(null); setVoidReason(''); }}
        isLoading={isVoidingClosure}
      />

      {/* Backfill Wizard */}
      <BackfillWizard
        open={backfillOpen}
        onOpenChange={setBackfillOpen}
        date={validDate}
        barbers={barbers}
        services={services}
        lines={lines}
        closedBarberIds={closedBarbers}
        onComplete={checkClosedBarbers}
      />

      {/* Regularize Closure Confirmation */}
      <AlertDialog
        open={!!regularizingBarber}
        onOpenChange={(open) => { if (!open && !isRegularizing) setRegularizingBarber(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Regularizar cierre</AlertDialogTitle>
            <AlertDialogDescription>
              Se anulará el cierre actual de <span className="font-semibold">{regularizingBarber?.barberName}</span> y se generará un nuevo cierre actualizado con las ventas registradas después del cierre. El movimiento quedará registrado en el historial de anulaciones.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRegularizing}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={isRegularizing}
              onClick={(e) => { e.preventDefault(); handleRegularize(); }}
              className="bg-status-warning text-white hover:bg-status-warning/90"
            >
              {isRegularizing ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              {isRegularizing ? 'Regularizando...' : 'Regularizar cierre'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}
