import { useState, useCallback, useEffect, useRef } from 'react';
import { Transaction, PaymentMethod } from '@/types/barbershop';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useOrganization } from '@/contexts/OrganizationContext';
import { useSucursal } from '@/contexts/SucursalContext';
import { format } from 'date-fns';
import { getStartOfDayLocal, getEndOfDayLocal, formatDateForQuery } from '@/lib/dateUtils';

// Devuelve la clave de día calendario (YYYY-MM-DD) para una fecha en un timezone dado.
// Se usa para detectar el cruce de medianoche en el timezone de la organización
// cuando la app permanece abierta de un día para el otro.
function getLocalDayKey(date: Date, timezone?: string | null): string {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone || undefined,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return fmt.format(date);
  } catch {
    return format(date, 'yyyy-MM-dd');
  }
}

interface VentaInsert {
  barbero_id: string | null;
  barbero_nombre: string | null;
  servicio_id: string | null;
  servicio_nombre: string | null;
  precio_servicio: number | null;
  descuento_pct: number;
  metodo_pago: PaymentMethod;
  total_final: number;
  recargo_total: number;
  total_cobrado: number;
  organization_id: string;
  sucursal_id?: string | null;
  tipo_venta: 'servicio' | 'productos' | 'mixta';
  cliente_id?: string | null;
  mp_payment_intent_id?: string | null;
  mp_device_id?: string | null;
  mp_status?: string | null;
}

export interface ProductoCartInput {
  producto_id: string;
  producto_sucursal_id: string;
  producto_nombre: string;
  marca_id: string | null;
  marca_nombre: string | null;
  precio_unitario: number;
  cantidad: number;
}

interface VentaExtraInsert {
  venta_id: string;
  extra_id: string;
  extra_nombre: string;
  precio_extra: number;
  cantidad: number;
}

export function useTransactions() {
  const { organization } = useOrganization();
  const { currentSucursal, isAllMode } = useSucursal();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());

  // Cargar ventas de una fecha específica desde Supabase
  const loadTransactionsByDate = useCallback(async (date: Date) => {
    setIsLoading(true);
    
    // Usar funciones de fecha consistentes con timezone de la organización
    const tz = organization?.timezone || null;
    const startStr = getStartOfDayLocal(date, tz);
    const endStr = getEndOfDayLocal(date, tz);

    let query = supabase
      .from('venta')
      .select('*')
      .gte('fecha_hora', startStr)
      .lte('fecha_hora', endStr)
      .order('fecha_hora', { ascending: false });

    // Filter by sucursal if not in "all" mode
    if (currentSucursal) {
      query = query.eq('sucursal_id', currentSucursal.id);
    }

    const { data: ventas, error } = await query;

    if (error) {
      console.error('Error loading ventas:', error);
      setIsLoading(false);
      return;
    }

    if (!ventas || ventas.length === 0) {
      setTransactions([]);
      setIsLoading(false);
      return;
    }

    // Cargar extras, pagos y productos de cada venta
    const ventaIds = ventas.map(v => v.id);
    const [extrasRes, pagosRes, productosRes] = await Promise.all([
      supabase.from('venta_extra').select('*').in('venta_id', ventaIds),
      supabase.from('venta_pagos').select('*').in('venta_id', ventaIds).order('orden', { ascending: true }),
      supabase.from('venta_producto').select('*').in('venta_id', ventaIds),
    ]);
    const ventaExtras = extrasRes.data;
    const ventaPagos = pagosRes.data;
    const ventaProductos = productosRes.data;

    const extrasMap = new Map<string, { uid: string; name: string; price: number }[]>();
    ventaExtras?.forEach(ve => {
      const list = extrasMap.get(ve.venta_id) || [];
      list.push({
        uid: ve.extra_id,
        name: ve.extra_nombre,
        price: Number(ve.precio_extra),
      });
      extrasMap.set(ve.venta_id, list);
    });

    const pagosMap = new Map<string, { method: PaymentMethod; amount: number; recargoPct: number; recargoMonto: number; basePago: number }[]>();
    ventaPagos?.forEach((p: any) => {
      const list = pagosMap.get(p.venta_id) || [];
      const monto = Number(p.monto);
      const recargoMonto = Number(p.recargo_monto) || 0;
      const basePago = p.base_pago != null ? Number(p.base_pago) : Math.max(0, monto - recargoMonto);
      list.push({
        method: p.metodo_pago as PaymentMethod,
        amount: monto,
        recargoPct: Number(p.recargo_pct) || 0,
        recargoMonto,
        basePago,
      });
      pagosMap.set(p.venta_id, list);
    });

    const productosMap = new Map<string, import('@/types/barbershop').TransactionProducto[]>();
    ventaProductos?.forEach((vp: any) => {
      const list = productosMap.get(vp.venta_id) || [];
      list.push({
        producto_id: vp.producto_id,
        producto_sucursal_id: vp.producto_sucursal_id ?? null,
        producto_nombre: vp.producto_nombre,
        marca_id: vp.marca_id ?? null,
        marca_nombre: vp.marca_nombre ?? null,
        precio_unitario: Number(vp.precio_unitario) || 0,
        cantidad: Number(vp.cantidad) || 0,
        subtotal: Number(vp.subtotal) || 0,
      });
      productosMap.set(vp.venta_id, list);
    });

    const txs: Transaction[] = ventas.map(v => {
      const pagos = pagosMap.get(v.id);
      const baseTotal = Number(v.total_final);
      const recargoTotal = Number((v as any).recargo_total) || 0;
      const totalCobrado = (v as any).total_cobrado != null ? Number((v as any).total_cobrado) : baseTotal + recargoTotal;
      const payments = pagos && pagos.length > 0
        ? pagos
        : [{
            method: v.metodo_pago as PaymentMethod,
            amount: baseTotal,
            recargoPct: 0,
            recargoMonto: 0,
            basePago: baseTotal,
          }];

      const tipoVentaRaw = (v as any).tipo_venta as string | null;
      const productos = productosMap.get(v.id) || [];
      const productosTotal = productos.reduce((s, p) => s + p.subtotal, 0);
      const tipoVenta: 'servicio' | 'productos' | 'mixta' =
        tipoVentaRaw === 'productos' || tipoVentaRaw === 'servicio' || tipoVentaRaw === 'mixta'
          ? tipoVentaRaw
          : (v.servicio_id ? (productos.length > 0 ? 'mixta' : 'servicio') : 'productos');
      const serviciosBase = tipoVenta === 'productos' ? 0 : Math.max(0, baseTotal - productosTotal);
      const serviceCount = tipoVenta === 'productos' || !v.servicio_id ? 0 : 1;

      return {
        id: v.id,
        barberId: v.barbero_id,
        barberName: v.barbero_nombre,
        serviceId: v.servicio_id,
        serviceName: v.servicio_nombre,
        servicePrice: Number(v.precio_servicio) || 0,
        extras: extrasMap.get(v.id) || [],
        discount: Number(v.descuento_pct) || 0,
        discountType: 'percentage' as const,
        paymentMethod: v.metodo_pago as PaymentMethod,
        payments,
        subtotal: (Number(v.precio_servicio) || 0) + (extrasMap.get(v.id) || []).reduce((s, e) => s + e.price, 0),
        total: baseTotal,
        recargoTotal,
        totalCobrado,
        tipoVenta,
        productosTotal,
        serviciosBase,
        serviceCount,
        productos,
        createdAt: new Date(v.fecha_hora),
        estado: (v as any).estado || 'activo',
        anuladoAt: (v as any).anulado_at ? new Date((v as any).anulado_at) : undefined,
        anuladoPor: (v as any).anulado_por || undefined,
        anuladoPorId: (v as any).anulado_por_id || undefined,
      };
    });

    setTransactions(txs);
    setIsLoading(false);
  }, [currentSucursal, organization?.timezone]);

  useEffect(() => {
    loadTransactionsByDate(selectedDate);
  }, [selectedDate, loadTransactionsByDate, currentSucursal]);

  // Auto-rollover del día activo de Caja cuando la app cruza la medianoche
  // estando abierta. Solo avanza si el usuario seguía viendo "hoy" (no si
  // navegó manualmente a una fecha pasada).
  const selectedDateRef = useRef(selectedDate);
  useEffect(() => {
    selectedDateRef.current = selectedDate;
  }, [selectedDate]);

  useEffect(() => {
    const tz = organization?.timezone || null;
    let lastTodayKey = getLocalDayKey(new Date(), tz);

    const maybeRollover = () => {
      const nowKey = getLocalDayKey(new Date(), tz);
      if (nowKey === lastTodayKey) return;
      const selectedKey = getLocalDayKey(selectedDateRef.current, tz);
      const wasOnToday = selectedKey === lastTodayKey;
      lastTodayKey = nowKey;
      if (wasOnToday) {
        setSelectedDate(new Date());
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') maybeRollover();
    };
    const onFocus = () => maybeRollover();

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    const interval = window.setInterval(maybeRollover, 60_000);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
      window.clearInterval(interval);
    };
  }, [organization?.timezone]);



  const addTransaction = useCallback(async (
    transaction: Omit<Transaction, 'id' | 'createdAt' | 'productos'> & {
      productos?: ProductoCartInput[];
      mpPaymentIntentId?: string | null;
      mpDeviceId?: string | null;
      clienteId?: string | null;
    }
  ) => {
    if (!organization) {
      toast.error('No se encontró la organización');
      return null;
    }

    if (!currentSucursal) {
      toast.error('Seleccioná una sucursal antes de registrar un cobro');
      return null;
    }

    if (!navigator.onLine) {
      toast.error('No hay conexión a Internet. Conectate y volvé a intentar.');
      return null;
    }

    const productos = transaction.productos || [];
    const hasService = !!transaction.serviceId;
    const hasProducts = productos.length > 0;

    if (!hasService && !hasProducts) {
      toast.error('Agregá al menos un servicio o producto');
      return null;
    }

    const tipoVenta: 'servicio' | 'productos' | 'mixta' =
      hasService && hasProducts ? 'mixta' : hasService ? 'servicio' : 'productos';

    if (tipoVenta !== 'productos' && !transaction.barberId) {
      toast.error('Seleccioná un barbero para registrar el servicio');
      return null;
    }

    // Normalize names to avoid spacing issues
    const normalizedBarberName = transaction.barberName ? transaction.barberName.replace(/\s+/g, ' ').trim() : null;
    const normalizedServiceName = transaction.serviceName ? transaction.serviceName.replace(/\s+/g, ' ').trim() : null;

    // BASE = transaction.total. Cada pago trae basePago + recargo (o sólo amount = base si legacy).
    // Normalizar: garantizar basePago, recargoMonto, recargoPct y amount = basePago + recargoMonto.
    const rawPayments = transaction.payments && transaction.payments.length > 0
      ? transaction.payments
      : [{ method: transaction.paymentMethod, amount: transaction.total, basePago: transaction.total, recargoPct: 0, recargoMonto: 0 }];

    const normalizedPayments = rawPayments.map((p) => {
      const recargoPct = Number(p.recargoPct ?? 0) || 0;
      let basePago = p.basePago;
      let recargoMonto = p.recargoMonto;
      if (basePago == null) {
        basePago = Number(p.amount) || 0;
        recargoMonto = recargoMonto ?? 0;
      }
      if (recargoMonto == null) {
        recargoMonto = Math.round((basePago * recargoPct) / 100);
      }
      const amount = basePago + recargoMonto;
      return {
        method: p.method,
        amount,
        basePago,
        recargoMonto,
        recargoPct,
      };
    });

    const sumBase = normalizedPayments.reduce((s, p) => s + p.basePago, 0);
    const sumRecargo = normalizedPayments.reduce((s, p) => s + p.recargoMonto, 0);
    const sumCobrado = sumBase + sumRecargo;

    const baseTotal = sumBase || transaction.total;
    const recargoTotal = sumRecargo;
    const totalCobrado = sumCobrado || baseTotal;

    const primaryMethod = [...normalizedPayments].sort((a, b) => b.amount - a.amount)[0].method;

    // Insertar venta principal
    const ventaData: VentaInsert = {
      barbero_id: transaction.barberId || null,
      barbero_nombre: normalizedBarberName,
      servicio_id: transaction.serviceId || null,
      servicio_nombre: normalizedServiceName,
      precio_servicio: hasService ? transaction.servicePrice : null,
      descuento_pct: transaction.discount,
      metodo_pago: primaryMethod,
      total_final: baseTotal,
      recargo_total: recargoTotal,
      total_cobrado: totalCobrado,
      organization_id: organization.id,
      sucursal_id: currentSucursal.id,
      tipo_venta: tipoVenta,
      cliente_id: transaction.clienteId ?? null,
      mp_payment_intent_id: transaction.mpPaymentIntentId ?? null,
      mp_device_id: transaction.mpDeviceId ?? null,
      mp_status: transaction.mpPaymentIntentId ? 'approved' : null,
    };

    const { data: venta, error: ventaError } = await supabase
      .from('venta')
      .insert(ventaData as any)
      .select()
      .single();

    if (ventaError) {
      console.error('Error inserting venta:', ventaError);
      toast.error('Error al guardar la venta');
      return null;
    }

    // Insertar pagos con desglose recargo / base
    const pagosData = normalizedPayments.map((p, idx) => ({
      venta_id: venta.id,
      organization_id: organization.id,
      sucursal_id: currentSucursal.id,
      metodo_pago: p.method,
      monto: p.amount,
      base_pago: p.basePago,
      recargo_pct: p.recargoPct,
      recargo_monto: p.recargoMonto,
      orden: idx + 1,
    }));

    const { error: pagosError } = await supabase
      .from('venta_pagos')
      .insert(pagosData as any);

    if (pagosError) {
      console.error('Error inserting venta_pagos:', pagosError);
    }

    // Insertar extras si hay
    if (transaction.extras.length > 0) {
      const extrasData: VentaExtraInsert[] = transaction.extras.map(e => ({
        venta_id: venta.id,
        extra_id: e.uid,
        extra_nombre: e.name,
        precio_extra: e.price,
        cantidad: 1,
      }));

      const { error: extrasError } = await supabase
        .from('venta_extra')
        .insert(extrasData);

      if (extrasError) {
        console.error('Error inserting extras:', extrasError);
      }
    }

    // Insertar productos y descontar stock
    if (hasProducts) {
      const productosData = productos.map(p => ({
        venta_id: venta.id,
        organization_id: organization.id,
        sucursal_id: currentSucursal.id,
        producto_id: p.producto_id,
        producto_sucursal_id: p.producto_sucursal_id,
        producto_nombre: p.producto_nombre,
        marca_id: p.marca_id,
        marca_nombre: p.marca_nombre,
        precio_unitario: p.precio_unitario,
        cantidad: p.cantidad,
        subtotal: p.precio_unitario * p.cantidad,
        barbero_id: transaction.barberId || null,
      }));

      const { error: vpError } = await supabase
        .from('venta_producto')
        .insert(productosData as any);

      if (vpError) {
        console.error('Error inserting venta_producto:', vpError);
        toast.error('Error al guardar productos en la venta');
      }

      // Descontar stock con RPC (atomic + audit)
      for (const p of productos) {
        const { error: stockErr } = await supabase.rpc('registrar_movimiento_stock', {
          _producto_sucursal_id: p.producto_sucursal_id,
          _tipo: 'venta',
          _cantidad: -p.cantidad,
          _motivo: null,
          _venta_id: venta.id,
        });
        if (stockErr) {
          console.error('Error registering stock movement:', stockErr);
        }
      }
    }

    // Agregar al estado local
    const productosEnriched = productos.map(p => ({
      producto_id: p.producto_id,
      producto_sucursal_id: p.producto_sucursal_id,
      producto_nombre: p.producto_nombre,
      marca_id: p.marca_id,
      marca_nombre: p.marca_nombre,
      precio_unitario: p.precio_unitario,
      cantidad: p.cantidad,
      subtotal: p.precio_unitario * p.cantidad,
    }));
    const productosTotal = productosEnriched.reduce((s, p) => s + p.subtotal, 0);
    const serviciosBase = tipoVenta === 'productos' ? 0 : Math.max(0, baseTotal - productosTotal);
    const serviceCount = tipoVenta === 'productos' || !transaction.serviceId ? 0 : 1;

    const { productos: _ignored, ...txRest } = transaction;
    const newTransaction: Transaction = {
      ...txRest,
      payments: normalizedPayments,
      paymentMethod: primaryMethod,
      total: baseTotal,
      recargoTotal,
      totalCobrado,
      tipoVenta,
      productosTotal,
      serviciosBase,
      serviceCount,
      productos: productosEnriched,
      id: venta.id,
      createdAt: new Date(venta.fecha_hora),
    };

    setTransactions(prev => [newTransaction, ...prev]);
    return newTransaction;
  }, [organization, currentSucursal]);

  // Anular una transacción (soft delete)
  const voidTransaction = useCallback(async (
    transactionId: string, 
    voidedBy: string, 
    voidedById: string
  ): Promise<boolean> => {
    try {
      const { error } = await supabase
        .from('venta')
        .update({
          estado: 'anulado',
          anulado_at: new Date().toISOString(),
          anulado_por: voidedBy,
          anulado_por_id: voidedById,
        })
        .eq('id', transactionId);

      if (error) {
        console.error('Error voiding transaction:', error);
        toast.error('Error al anular la transacción');
        return false;
      }

      // Actualizar estado local
      setTransactions(prev => prev.map(tx => 
        tx.id === transactionId 
          ? { 
              ...tx, 
              estado: 'anulado' as const, 
              anuladoAt: new Date(), 
              anuladoPor: voidedBy,
              anuladoPorId: voidedById 
            } 
          : tx
      ));

      return true;
    } catch (error) {
      console.error('Error voiding transaction:', error);
      toast.error('Error al anular la transacción');
      return false;
    }
  }, []);

  // Verificar si un barbero tiene la caja cerrada para una fecha
  const isBarberCashClosed = useCallback(async (barberId: string, barberName: string, date: Date): Promise<boolean> => {
    const tz = organization?.timezone || null;
    const startStr = getStartOfDayLocal(date, tz);
    const endStr = getEndOfDayLocal(date, tz);
    
    const { data, error } = await supabase
      .from('ingresos')
      .select('id, estado')
      .eq('barbero', barberName)
      .gte('created_at', startStr)
      .lte('created_at', endStr)
      .neq('estado', 'eliminado')
      .limit(1);

    if (error) {
      console.error('Error checking cash closing:', error);
      return false;
    }

    return data && data.length > 0;
  }, [organization?.timezone]);

  const getTodayTransactions = useCallback(() => {
    return transactions;
  }, [transactions]);

  const getDailySummary = useCallback(() => {
    // Solo contar transacciones activas para el resumen
    const activeTx = transactions.filter(t => t.estado !== 'anulado');
    // BASE legacy (sin recargos) — alimenta lógica de comisiones/sueldos
    let totalEfectivo = 0;
    let totalMercadoPago = 0;
    // Real cobrado (con recargos) — para arqueo
    let totalEfectivoCobrado = 0;
    let totalDigitalCobrado = 0;
    let totalRecargos = 0;

    activeTx.forEach(t => {
      const payments = t.payments && t.payments.length > 0
        ? t.payments
        : [{ method: t.paymentMethod, amount: t.total, basePago: t.total, recargoMonto: 0, recargoPct: 0 }];
      payments.forEach(p => {
        const basePago = p.basePago != null ? p.basePago : p.amount;
        const recargoMonto = p.recargoMonto ?? 0;
        const cobrado = basePago + recargoMonto;
        totalRecargos += recargoMonto;
        if (p.method === 'efectivo') {
          totalEfectivo += basePago;
          totalEfectivoCobrado += cobrado;
        } else {
          // mercado_pago / transferencia / debito / credito → digital
          totalMercadoPago += basePago;
          totalDigitalCobrado += cobrado;
        }
      });
    });

    return {
      count: activeTx.length,
      totalEfectivo,                  // BASE — sin cambios de significado
      totalMercadoPago,               // BASE — sin cambios de significado
      total: totalEfectivo + totalMercadoPago, // BASE total — alimenta comisiones
      totalEfectivoCobrado,           // NUEVO snapshot
      totalDigitalCobrado,            // NUEVO snapshot
      totalRecargos,                  // NUEVO snapshot
      totalCobrado: totalEfectivoCobrado + totalDigitalCobrado, // NUEVO
      transactions: transactions,
    };
  }, [transactions]);

  return {
    transactions,
    isLoading,
    selectedDate,
    setSelectedDate,
    addTransaction,
    voidTransaction,
    isBarberCashClosed,
    getTodayTransactions,
    getDailySummary,
    refetch: () => loadTransactionsByDate(selectedDate),
  };
}
