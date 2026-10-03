import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2 } from 'lucide-react';
import { CreditCard, Banknote, Check, Percent, ArrowLeft, ArrowRight, User, Sparkles, Wallet, Tag, Scissors, DollarSign, X, Split, Package, Plus, Trash2, MonitorSmartphone, Keyboard, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { InlineReadError } from '@/components/ui/InlineReadError';
import { Skeleton } from '@/components/ui/skeleton';
import { useDelayedVisible } from '@/hooks/useDelayedVisible';
import { feedback } from '@/lib/feedback';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Service, Extra, Barber, Discount, PaymentMethod, DiscountType, Line, getMethodLabel } from '@/types/barbershop';
import { useTareas } from '@/hooks/useTareas';
import { DailyTurnosViewer } from '@/components/DailyTurnosViewer';
import { PlanLockedFeature } from '@/components/billing/PlanLockedFeature';
import { CurrencyInput } from '@/components/ui/currency-input';
import { usePaymentMethodsConfig } from '@/hooks/usePaymentMethodsConfig';
import { useAuth } from '@/contexts/AuthContext';
import { useMercadoPago } from '@/hooks/useMercadoPago';
import { useSucursal } from '@/contexts/SucursalContext';
import { useOrganization } from '@/contexts/OrganizationContext';
import { MpTerminalPaymentDialog } from '@/components/MpTerminalPaymentDialog';
import { ProductoPickerDialog, CartItem } from '@/components/productos/ProductoPickerDialog';
import { ProductoCartInput } from '@/hooks/useTransactions';
import { Badge } from '@/components/ui/badge';
import { EntityColorBar } from '@/components/ui/EntityColorBar';
import { SelectableCard } from '@/components/ui/SelectableCard';
import { ClienteSearchPicker } from '@/components/agenda/ClienteSearchPicker';
import { useClienteSearch, clienteFullName, type ClienteLite } from '@/components/agenda/hooks/useClienteSearch';
import { NuevoClienteDialog } from '@/components/clientes/NuevoClienteDialog';
import type { BillingPlanCode } from '@/hooks/useSubscriptionAccess';

const isPriceMissing = (p: number | null | undefined) => !p || p <= 0;

/**
 * `getTotal` se resuelve vía ref (ver `totalRef` en el componente): el total a
 * cobrar depende de servicio/extras/descuento/productos, que viven fuera del
 * form. El schema se crea una sola vez por instancia del componente y siempre
 * lee el total vigente al momento de validar.
 */
function buildCobroSchema(getTotal: () => number) {
  return z
    .object({
      barberId: z.string().optional().default(''),
      serviceId: z.string().optional().default(''),
      extraIds: z.array(z.string()).optional().default([]),
      discountId: z.string().optional().default('none'),
      paymentMethod: z.string().optional().default(''),
      cart: z.array(z.any()).optional().default([]),
      split: z
        .object({
          enabled: z.boolean().default(false),
          efectivo: z.string().optional().default(''),
          digital: z.string().optional().default(''),
          digitalMethod: z.string().optional().default(''),
        })
        .default({ enabled: false, efectivo: '', digital: '', digitalMethod: '' }),
    })
    .superRefine((data, ctx) => {
      const hasService = !!data.serviceId;
      const hasProducts = data.cart.length > 0;

      if (!hasService && !hasProducts) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Agregá al menos un servicio o un producto.',
          path: ['root'],
        });
      }
      if (hasService && !data.barberId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Seleccioná el barbero que atendió el servicio.',
          path: ['barberId'],
        });
      }
      if (!data.paymentMethod) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Seleccioná cómo paga el cliente.',
          path: ['paymentMethod'],
        });
      }
      if (data.split.enabled) {
        const total = getTotal();
        const efectivoNum = parseFloat(data.split.efectivo) || 0;
        const digitalNum = parseFloat(data.split.digital) || 0;
        const sum = efectivoNum + digitalNum;
        const valid = efectivoNum > 0 && digitalNum > 0 && Math.abs(sum - total) < 0.01 && efectivoNum <= total && digitalNum <= total;
        if (!valid) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'La suma debe ser igual al total y ambos métodos mayores a cero.',
            path: ['split', 'efectivo'],
          });
        }
        if (!data.split.digitalMethod) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Seleccioná el método electrónico para el split.',
            path: ['split', 'digitalMethod'],
          });
        }
      }
    });
}

type CobroFormValues = z.infer<ReturnType<typeof buildCobroSchema>>;

interface PaymentRegistrationProps {
  services: Service[];
  extras: Extra[];
  barbers: Barber[];
  /** true mientras `useCobrarBarbers` resuelve la primera carga o un refetch. */
  barbersLoading?: boolean;
  /** Mensaje humano cuando la carga de barberos se agota sin datos previos. */
  barbersError?: string | null;
  onRetryBarbers?: () => void;
  discounts: Discount[];
  lines?: Line[];
  sucursalId?: string | null;
  onNavigateToTareas?: () => void;
  onNavigateToTeamSetup?: () => void;
  onNavigateToBilling?: () => void;
  canViewDailyTurnos?: boolean;
  currentPlan?: BillingPlanCode;
  onSubmit: (data: {
    barberId: string;
    barberName: string;
    serviceId: string;
    serviceName: string;
    servicePrice: number;
    extras: { uid: string; name: string; price: number }[];
    discount: number;
    discountType: DiscountType;
    paymentMethod: PaymentMethod;
    payments?: { method: PaymentMethod; amount: number; basePago: number; recargoPct: number; recargoMonto: number }[];
    subtotal: number;
    total: number;
    productos?: ProductoCartInput[];
    mpPaymentIntentId?: string | null;
    mpDeviceId?: string | null;
    clienteId?: string | null;
  }) => Promise<unknown | null>;
}

type Step = 'barber' | 'service' | 'extras' | 'discount' | 'payment';

const STEPS: Step[] = ['barber', 'service', 'extras', 'discount', 'payment'];

const STEP_INFO = {
  barber: { title: 'Barbero', subtitle: 'Elegí quién atendió o sumá productos', icon: User },
  service: { title: 'Servicio', subtitle: 'Elegí el servicio principal', icon: Scissors },
  extras: { title: 'Extras', subtitle: 'Sumá extras opcionales al servicio', icon: Sparkles },
  discount: { title: 'Descuento', subtitle: 'Aplicá un descuento al servicio si corresponde', icon: Tag },
  payment: { title: 'Método de Pago', subtitle: 'Elegí cómo paga el cliente', icon: Wallet },
};

export function PaymentRegistration({
  services,
  extras,
  barbers,
  barbersLoading = false,
  barbersError = null,
  onRetryBarbers,
  discounts,
  lines = [],
  sucursalId,
  onSubmit,
  onNavigateToTareas,
  onNavigateToTeamSetup,
  onNavigateToBilling,
  canViewDailyTurnos = true,
  currentPlan = 'basico',
}: PaymentRegistrationProps) {
  const { tareas } = useTareas();
  const { isOwner, isGeneralManager, isManager, isSucursalAccount } = useAuth();
  const canEditProductPrice = isOwner || isGeneralManager || isManager;
  const [currentStep, setCurrentStep] = useState<Step>('barber');
  const [selectedBarber, setSelectedBarber] = useState('');
  const [selectedService, setSelectedService] = useState('');
  const [selectedExtras, setSelectedExtras] = useState<string[]>([]);
  const [selectedDiscount, setSelectedDiscount] = useState('none');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | ''>('');
  const [splitMode, setSplitMode] = useState(false);
  const [selectedDigitalMethod, setSelectedDigitalMethod] = useState<PaymentMethod | ''>('');
  // (Notificaciones de tareas se centralizan en la campanita global; se quitó la burbuja inferior.)
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Distingue la primera carga de barberos (sin contenido usable → skeleton)
  // de un refetch posterior (cambio de sucursal → mantener el grid visible).
  // Sin esto, `barbers.length === 0` durante la carga se confunde con el
  // EmptyState real de "sin equipo configurado".
  // Solo se latchea en una carga REALMENTE exitosa — si el intento termina en
  // `barbersError` (nunca hubo datos), un retry manual debe volver a mostrar
  // el skeleton en vez de caer en el EmptyState falso de "sin equipo".
  const [hasLoadedBarbersOnce, setHasLoadedBarbersOnce] = useState(false);
  useEffect(() => {
    if (!barbersLoading && !barbersError) setHasLoadedBarbersOnce(true);
  }, [barbersLoading, barbersError]);
  const barbersSkeletonDelayed = useDelayedVisible(barbersLoading);
  const showBarbersSkeleton = !hasLoadedBarbersOnce && barbersSkeletonDelayed;

  // El total se resuelve vía ref porque el schema (módulo, no re-creado por render)
  // necesita leer el total vigente al momento de validar el split.
  const totalRef = useRef(0);
  const cobroSchemaRef = useRef<ReturnType<typeof buildCobroSchema>>();
  if (!cobroSchemaRef.current) {
    cobroSchemaRef.current = buildCobroSchema(() => totalRef.current);
  }
  const form = useForm<CobroFormValues>({
    resolver: zodResolver(cobroSchemaRef.current),
    defaultValues: {
      barberId: '',
      serviceId: '',
      extraIds: [],
      discountId: 'none',
      paymentMethod: '',
      cart: [],
      split: { enabled: false, efectivo: '', digital: '', digitalMethod: '' },
    },
  });
  type OverlayPhase = 'idle' | 'visible' | 'exiting';
  const [overlayPhase, setOverlayPhase] = useState<OverlayPhase>('idle');
  const overlayTimersRef = useRef<{ hold?: ReturnType<typeof setTimeout>; exit?: ReturnType<typeof setTimeout> }>({});

  const triggerSuccessOverlay = useCallback(() => {
    if (overlayTimersRef.current.hold) clearTimeout(overlayTimersRef.current.hold);
    if (overlayTimersRef.current.exit) clearTimeout(overlayTimersRef.current.exit);

    setOverlayPhase('visible');

    overlayTimersRef.current.hold = setTimeout(() => {
      setOverlayPhase('exiting');
      overlayTimersRef.current.exit = setTimeout(() => {
        setOverlayPhase('idle');
      }, 220);
    }, 2000);
  }, []);

  useEffect(() => {
    return () => {
      if (overlayTimersRef.current.hold) clearTimeout(overlayTimersRef.current.hold);
      if (overlayTimersRef.current.exit) clearTimeout(overlayTimersRef.current.exit);
    };
  }, []);
  // Productos
  const [cart, setCart] = useState<CartItem[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [cartBarberId, setCartBarberId] = useState<string | null>(null);
  const [cartBarberName, setCartBarberName] = useState<string | null>(null);
  // Asignación explícita de la venta de productos: pending | no_barber | barber
  type ProductSaleAssignment = 'pending' | 'no_barber' | 'barber';
  const [productSaleAssignment, setProductSaleAssignment] = useState<ProductSaleAssignment>('pending');

  // MercadoPago terminal flow
  const { currentSucursal } = useSucursal();
  const { isConnected: mpConnected, getDevicesForSucursal, connect: mpConnect } = useMercadoPago();
  const [mpDialogOpen, setMpDialogOpen] = useState(false);
  const [mpConnectModalOpen, setMpConnectModalOpen] = useState(false);
  const [pendingMpPayload, setPendingMpPayload] = useState<{
    payments: { method: PaymentMethod; amount: number; basePago: number; recargoPct: number; recargoMonto: number }[];
    primaryMethod: PaymentMethod;
    productosPayload: ProductoCartInput[];
    finalBarberId: string;
    finalBarberName: string;
    mpAmountPesos: number;
    mpDeviceId: string | null;
  } | null>(null);

  const hasMpDevicesForSucursal = currentSucursal
    ? getDevicesForSucursal(currentSucursal.id).length > 0
    : false;
  // Cancelar venta
  const [cancelOpen, setCancelOpen] = useState(false);

  // Cliente asociado (opcional) — filtrado SOLO a clientes de la sucursal actual.
  const { organization } = useOrganization();
  const [nuevoClienteOpen, setNuevoClienteOpen] = useState(false);
  const clienteSearch = useClienteSearch({
    organizationId: organization?.id || '',
    sucursalId: sucursalId || currentSucursal?.id || '',
    enabled: !!(organization?.id && (sucursalId || currentSucursal?.id)),
  });
  // En Cobrar solo mostramos clientes vinculados a la sucursal activa
  // (a diferencia de Agenda, que permite ver clientes de otras sucursales).
  const clienteResultsInSucursal = useMemo(
    () => clienteSearch.results.filter(c => c.inSucursal),
    [clienteSearch.results],
  );

  const teamSetupDescription = useMemo(() => {
    if (isSucursalAccount) {
      return 'Contactá al dueño, al general manager o al manager para que configure el equipo de esta sucursal.';
    }
    if (isManager) {
      return 'Activá o gestioná barberos de tu sucursal para poder cobrar servicios correctamente.';
    }
    return 'Añadí o activá miembros del equipo para poder cobrar servicios correctamente.';
  }, [isSucursalAccount, isManager]);

  const { methods, getRecargoPct, loading: methodsLoading } = usePaymentMethodsConfig();
  const activeMethods = useMemo(() => methods.filter(m => m.activo), [methods]);
  const electronicMethods = useMemo(
    () => activeMethods.filter(m => m.method !== 'efectivo'),
    [activeMethods],
  );
  const isEfectivoActive = useMemo(
    () => activeMethods.some(m => m.method === 'efectivo'),
    [activeMethods],
  );

  const pendingTasks = useMemo(() => 
    tareas.filter(t => t.estado === 'pendiente' && t.tipo === 'tarea'),
    [tareas]
  );

  const currentStepIndex = STEPS.indexOf(currentStep);

  // Dirección de navegación entre pasos, para la animación de entrada del paso.
  // Se calcula en render comparando con el índice previo (ref estable entre renders
  // del mismo paso, así no se re-dispara la animación al re-renderizar sin cambiar de paso).
  const prevStepIndexRef = useRef(currentStepIndex);
  const stepDirectionRef = useRef<'forward' | 'back'>('forward');
  if (currentStepIndex !== prevStepIndexRef.current) {
    stepDirectionRef.current = currentStepIndex >= prevStepIndexRef.current ? 'forward' : 'back';
    prevStepIndexRef.current = currentStepIndex;
  }
  const stepDirection = stepDirectionRef.current;

  const service = useMemo(() => services.find(s => s.id === selectedService), [services, selectedService]);
  const barber = useMemo(() => barbers.find(b => b.uid === selectedBarber), [barbers, selectedBarber]);
  const selectedExtrasData = useMemo(() =>
    extras.filter(e => selectedExtras.includes(e.id)),
    [extras, selectedExtras]
  );

  // Subtotal de servicios (servicio + extras). NO incluye productos.
  const subtotalServicios = useMemo(() => {
    const servicePrice = service?.price || 0;
    const extrasTotal = selectedExtrasData.reduce((sum, e) => sum + e.price, 0);
    return servicePrice + extrasTotal;
  }, [service, selectedExtrasData]);

  // Subtotal de productos (precio_unitario * cantidad). No se le aplican descuentos.
  const subtotalProductos = useMemo(
    () => cart.reduce((sum, it) => sum + it.precio_unitario * it.cantidad, 0),
    [cart]
  );

  // Subtotal total (servicios + productos)
  const subtotal = subtotalServicios + subtotalProductos;

  const selectedDiscountData = useMemo(() => {
    return discounts.find(d => d.id === selectedDiscount);
  }, [discounts, selectedDiscount]);

  // Evita mantener un descuento seleccionado que ya no está disponible en Cobrar.
  useEffect(() => {
    if (selectedDiscount === 'none') return;
    const stillAvailable = discounts.some(d => d.id === selectedDiscount);
    if (!stillAvailable) {
      setSelectedDiscount('none');
    }
  }, [discounts, selectedDiscount]);

  // Check if selected discount is valid for the payment method
  const isDiscountValidForPayment = useMemo(() => {
    if (!selectedDiscountData || !paymentMethod) return true;
    if (selectedDiscountData.paymentMethod === 'todos') return true;
    return selectedDiscountData.paymentMethod === paymentMethod;
  }, [selectedDiscountData, paymentMethod]);

  // Descuento se aplica SOLO sobre el subtotal de servicios
  const discountAmount = useMemo(() => {
    if (!selectedDiscountData || selectedDiscountData.value === 0) return 0;
    if (!isDiscountValidForPayment) return 0;
    if (subtotalServicios === 0) return 0;

    if (selectedDiscountData.type === 'fixed') {
      return Math.min(selectedDiscountData.value, subtotalServicios);
    }
    const rawDiscount = subtotalServicios * (selectedDiscountData.value / 100);
    const rounding = selectedDiscountData.rounding || 'cliente';
    const unit = selectedDiscountData.roundingUnit || 1;

    let roundedDiscount: number;
    if (unit === 1) {
      switch (rounding) {
        case 'negocio': roundedDiscount = Math.ceil(rawDiscount); break;
        case 'matematico': roundedDiscount = Math.round(rawDiscount); break;
        default: roundedDiscount = Math.floor(rawDiscount); break;
      }
    } else {
      switch (rounding) {
        case 'negocio': roundedDiscount = Math.ceil(rawDiscount / unit) * unit; break;
        case 'matematico': roundedDiscount = Math.round(rawDiscount / unit) * unit; break;
        default: roundedDiscount = Math.floor(rawDiscount / unit) * unit; break;
      }
    }
    return roundedDiscount;
  }, [subtotalServicios, selectedDiscountData, isDiscountValidForPayment]);

  const total = useMemo(() => Math.max(0, subtotal - discountAmount), [subtotal, discountAmount]);
  totalRef.current = total;

  const goToNextStep = useCallback(() => {
    if (currentStepIndex < STEPS.length - 1) {
      setCurrentStep(STEPS[currentStepIndex + 1]);
    }
  }, [currentStepIndex]);

  const goToPrevStep = useCallback(() => {
    if (currentStepIndex > 0) {
      setCurrentStep(STEPS[currentStepIndex - 1]);
    }
  }, [currentStepIndex]);

  const handleSelectBarber = useCallback((barberId: string) => {
    const b = barbers.find(x => x.uid === barberId);
    const fullName = b ? `${b.firstName} ${b.lastName}` : '';

    if (cart.length > 0) {
      // Carrito asignado a otro barbero: bloquear.
      if (productSaleAssignment === 'barber' && cartBarberId && cartBarberId !== barberId) {
        feedback.error('Productos asignados a otro barbero', {
          description: `Los productos están asignados a ${cartBarberName ?? 'otro barbero'}. Cambiá la asignación tocando ese barbero u otra opción, o cancelá la venta para empezar de nuevo.`,
        });
        return;
      }
      // pending | no_barber | mismo barber → asignar/reasignar al barbero tocado.
      setProductSaleAssignment('barber');
      setCartBarberId(barberId);
      setCartBarberName(fullName);
    }

    setSelectedBarber(barberId);
    form.setValue('barberId', barberId);
    form.trigger();
    setTimeout(() => goToNextStep(), 100);
  }, [barbers, cart.length, cartBarberId, cartBarberName, productSaleAssignment, goToNextStep, form]);

  const handleSelectNoBarber = useCallback(() => {
    setProductSaleAssignment('no_barber');
    setCartBarberId(null);
    setCartBarberName(null);
    setSelectedBarber('');
    setSelectedService('');
    setSelectedExtras([]);
    setSelectedDiscount('none');
    form.setValue('barberId', '');
    form.setValue('serviceId', '');
    form.setValue('extraIds', []);
    form.setValue('discountId', 'none');
    form.trigger();
    // Helper: hoy va directo a payment. Encapsulado para que en el futuro pueda enrutar a un step de descuento de productos.
    setCurrentStep('payment');
  }, [form]);

  const handleGoToTeamSetup = useCallback(() => {
    if (isSucursalAccount) {
      feedback.info('Cuenta de sucursal', {
        description: 'Pedile al dueño, al general manager o al manager que configure el equipo para habilitar cobros con servicios.',
      });
      return;
    }

    if (onNavigateToTeamSetup) {
      onNavigateToTeamSetup();
      return;
    }

    feedback.info('Equipo', {
      description: 'Abrí Mi Negocio y entrá en Equipo para añadir o activar miembros.',
    });
  }, [isSucursalAccount, onNavigateToTeamSetup]);

  const handleNavigateToBilling = useCallback(() => {
    if (onNavigateToBilling) {
      onNavigateToBilling();
      return;
    }

    feedback.info('Plan y Suscripcion', {
      description: 'Abrilo desde Configuracion para cambiar el plan del negocio.',
    });
  }, [onNavigateToBilling]);

  const handleSelectService = useCallback((serviceId: string) => {
    if (!selectedBarber) {
      feedback.error('Falta barbero', {
        description: 'Para agregar un servicio, primero seleccioná un barbero.',
      });
      return;
    }
    const svc = services.find(s => s.id === serviceId);
    if (!svc || isPriceMissing(svc.price)) {
      feedback.error('Precio pendiente', {
        description: 'Definí un precio para este ítem antes de cobrarlo.',
      });
      return;
    }
    setSelectedService(serviceId);
    form.setValue('serviceId', serviceId);
    form.trigger();
    setTimeout(() => goToNextStep(), 100);
  }, [selectedBarber, goToNextStep, services, form]);


  const handleToggleExtra = useCallback((extraId: string) => {
    setSelectedExtras(prev => {
      if (prev.includes(extraId)) {
        const next = prev.filter(id => id !== extraId);
        form.setValue('extraIds', next);
        return next;
      }
      const ex = extras.find(e => e.id === extraId);
      if (!ex || isPriceMissing(ex.price)) {
        feedback.error('Precio pendiente', {
          description: 'Definí un precio para este ítem antes de cobrarlo.',
        });
        return prev;
      }
      const next = [...prev, extraId];
      form.setValue('extraIds', next);
      return next;
    });
  }, [extras, form]);

  const handleSelectDiscount = useCallback((discountId: string) => {
    setSelectedDiscount(discountId);
    form.setValue('discountId', discountId);
    setTimeout(() => goToNextStep(), 100);
  }, [goToNextStep, form]);

  const handleSelectPayment = useCallback((method: PaymentMethod) => {
    setSplitMode(false);
    setPaymentMethod(method);
    form.setValue('paymentMethod', method);
    form.setValue('split.enabled', false);
    form.setValue('split.efectivo', '');
    form.setValue('split.digital', '');
    form.trigger();
  }, [form]);

  const enableSplitMode = useCallback(() => {
    setSplitMode(true);
    setPaymentMethod('efectivo');
    form.setValue('paymentMethod', 'efectivo');
    form.setValue('split.enabled', true);
    form.setValue('split.efectivo', '');
    form.setValue('split.digital', '');
    form.trigger();
  }, [form]);

  const cancelSplitMode = useCallback(() => {
    setSplitMode(false);
    setPaymentMethod('');
    form.setValue('paymentMethod', '');
    form.setValue('split.enabled', false);
    form.setValue('split.efectivo', '');
    form.setValue('split.digital', '');
    form.trigger();
  }, [form]);

  const efectivoAmount = form.watch('split.efectivo');
  const mpAmount = form.watch('split.digital');

  const handleEfectivoChange = useCallback((val: string) => {
    form.setValue('split.efectivo', val);
    const num = parseFloat(val);
    if (!isNaN(num) && total > 0) {
      const remainder = Math.max(0, total - num);
      form.setValue('split.digital', remainder > 0 ? remainder.toString() : '');
    } else if (val === '') {
      form.setValue('split.digital', '');
    }
    form.trigger();
  }, [total, form]);

  const handleMpChange = useCallback((val: string) => {
    form.setValue('split.digital', val);
    const num = parseFloat(val);
    if (!isNaN(num) && total > 0) {
      const remainder = Math.max(0, total - num);
      form.setValue('split.efectivo', remainder > 0 ? remainder.toString() : '');
    } else if (val === '') {
      form.setValue('split.efectivo', '');
    }
    form.trigger();
  }, [total, form]);

  const splitEfectivoNum = parseFloat(efectivoAmount) || 0;
  const splitMpNum = parseFloat(mpAmount) || 0;
  const splitSum = splitEfectivoNum + splitMpNum;
  const splitValid = splitMode
    && splitEfectivoNum > 0
    && splitMpNum > 0
    && Math.abs(splitSum - total) < 0.01
    && splitEfectivoNum <= total
    && splitMpNum <= total;

  // Recargos
  const pctSimple = paymentMethod ? getRecargoPct(paymentMethod) : 0;
  const pctEfectivo = getRecargoPct('efectivo');
  const pctDigital = selectedDigitalMethod ? getRecargoPct(selectedDigitalMethod) : 0;

  const recargoTotal = useMemo(() => {
    if (splitMode) {
      return Math.round((splitEfectivoNum * pctEfectivo) / 100)
        + Math.round((splitMpNum * pctDigital) / 100);
    }
    if (!paymentMethod) return 0;
    return Math.round((total * pctSimple) / 100);
  }, [splitMode, splitEfectivoNum, splitMpNum, pctEfectivo, pctDigital, total, pctSimple, paymentMethod]);

  const totalACobrar = total + recargoTotal;

  const recargoLabel = useMemo(() => {
    if (recargoTotal <= 0) return '';
    if (splitMode) {
      const partsActive = [pctEfectivo > 0, pctDigital > 0].filter(Boolean).length;
      if (partsActive > 1) return 'Recargo (mixto)';
      if (pctEfectivo > 0) return `Recargo (Efectivo ${pctEfectivo}%)`;
      if (pctDigital > 0 && selectedDigitalMethod) return `Recargo (${getMethodLabel(selectedDigitalMethod)} ${pctDigital}%)`;
      return 'Recargo';
    }
    if (paymentMethod) return `Recargo (${getMethodLabel(paymentMethod)} ${pctSimple}%)`;
    return 'Recargo';
  }, [recargoTotal, splitMode, pctEfectivo, pctDigital, selectedDigitalMethod, paymentMethod, pctSimple]);

  // Inicializar / sincronizar selectedDigitalMethod con la lista activa
  useEffect(() => {
    if (electronicMethods.length === 0) {
      if (selectedDigitalMethod !== '') {
        setSelectedDigitalMethod('');
        form.setValue('split.digitalMethod', '');
      }
      return;
    }
    const stillActive = selectedDigitalMethod
      && electronicMethods.some(m => m.method === selectedDigitalMethod);
    if (!stillActive) {
      const mp = electronicMethods.find(m => m.method === 'mercado_pago');
      const next = mp ? mp.method : electronicMethods[0].method;
      setSelectedDigitalMethod(next);
      form.setValue('split.digitalMethod', next);
    }
  }, [electronicMethods, selectedDigitalMethod, form]);

  // Self-healing: si el método elegido se desactivó en otra pestaña
  useEffect(() => {
    if (methodsLoading) return;
    const activeSet = new Set(activeMethods.map(m => m.method));
    if (!splitMode && paymentMethod && !activeSet.has(paymentMethod)) {
      setPaymentMethod('');
      form.setValue('paymentMethod', '');
    }
    if (splitMode && !activeSet.has('efectivo')) {
      setSplitMode(false);
      form.setValue('split.enabled', false);
      form.setValue('split.efectivo', '');
      form.setValue('split.digital', '');
      setPaymentMethod('');
      form.setValue('paymentMethod', '');
    }
  }, [methodsLoading, activeMethods, paymentMethod, splitMode, form]);

  const resetForm = useCallback(() => {
    setSelectedBarber('');
    setSelectedService('');
    setSelectedExtras([]);
    setSelectedDiscount('none');
    setPaymentMethod('');
    setSplitMode(false);
    setCart([]);
    setCartBarberId(null);
    setCartBarberName(null);
    setProductSaleAssignment('pending');
    setCurrentStep('barber');
    clienteSearch.reset();
    form.reset({
      barberId: '',
      serviceId: '',
      extraIds: [],
      discountId: 'none',
      paymentMethod: '',
      cart: [],
      split: { enabled: false, efectivo: '', digital: '', digitalMethod: '' },
    });
  }, [form, clienteSearch]);

  const onValidCobro = useCallback(async () => {
    // Guard previo: ítems sin precio (depende de config externa de precios — no es
    // parte del schema porque no es validación de forma, es una regla de negocio
    // sobre datos externos). Se chequea primero, antes del guardado, preservando el
    // mismo orden que tenía el handler imperativo original.
    const hasService = !!selectedService;
    const invalidService = hasService && isPriceMissing(service?.price);
    const invalidExtras = selectedExtrasData.some(e => isPriceMissing(e.price));
    const invalidProducts = cart.some(it => isPriceMissing(it.precio_unitario));
    if (invalidService || invalidExtras || invalidProducts) {
      form.setError('root', {
        type: 'manual',
        message: 'Hay ítems sin precio configurado. Definí el precio antes de cobrar.',
      });
      return;
    }

    setIsSubmitting(true);

    try {
      let payments: { method: PaymentMethod; amount: number; basePago: number; recargoPct: number; recargoMonto: number }[];
      let primaryMethod: PaymentMethod;

      if (splitMode) {
        // selectedDigitalMethod y paymentMethod ya vienen garantizados no-vacíos por
        // el schema (split.digitalMethod / paymentMethod requeridos) al llegar acá.
        const digitalMethod = selectedDigitalMethod as PaymentMethod;
        const recE = Math.round((splitEfectivoNum * pctEfectivo) / 100);
        const recD = Math.round((splitMpNum * pctDigital) / 100);
        payments = [
          { method: 'efectivo', basePago: splitEfectivoNum, recargoPct: pctEfectivo, recargoMonto: recE, amount: splitEfectivoNum + recE },
          { method: digitalMethod, basePago: splitMpNum, recargoPct: pctDigital, recargoMonto: recD, amount: splitMpNum + recD },
        ];
        primaryMethod = splitEfectivoNum >= splitMpNum ? 'efectivo' : digitalMethod;
      } else {
        const finalPaymentMethod = paymentMethod as PaymentMethod;
        const recargoMonto = Math.round((total * pctSimple) / 100);
        payments = [{ method: finalPaymentMethod, basePago: total, recargoPct: pctSimple, recargoMonto, amount: total + recargoMonto }];
        primaryMethod = finalPaymentMethod;
      }

      const productosPayload: ProductoCartInput[] = cart.map(it => ({
        producto_id: it.producto_id,
        producto_sucursal_id: it.producto_sucursal_id,
        producto_nombre: it.nombre,
        marca_id: it.marca_id,
        marca_nombre: it.marca_nombre,
        precio_unitario: it.precio_unitario,
        cantidad: it.cantidad,
      }));

      // Si hay servicio: barbero del servicio. Si solo productos: depende de la asignación.
      const finalBarberId = hasService
        ? (barber?.id || '')
        : (productSaleAssignment === 'barber' ? (cartBarberId || '') : '');
      const finalBarberName = hasService
        ? (barber ? `${barber.firstName} ${barber.lastName}` : '')
        : (productSaleAssignment === 'barber' ? (cartBarberName || '') : '');

      const result = await onSubmit({
        barberId: finalBarberId,
        barberName: finalBarberName,
        serviceId: service?.id || '',
        serviceName: service?.name || '',
        servicePrice: service?.price || 0,
        extras: selectedExtrasData.map(e => ({ uid: e.id, name: e.name, price: e.price })),
        discount: selectedDiscountData?.value || 0,
        discountType: selectedDiscountData?.type || 'percentage',
        paymentMethod: primaryMethod,
        payments,
        subtotal,
        total,
        productos: productosPayload,
        clienteId: clienteSearch.selectedCliente?.id ?? null,
      });

      if (result) {
        triggerSuccessOverlay();
        resetForm();
      } else {
        feedback.error("❌ No se pudo guardar el cobro", {
          description: "Revisá tu conexión a Internet e intentá de nuevo.",
        });
      }
    } catch (error) {
      feedback.error("❌ Error inesperado", {
        description: "Ocurrió un problema al guardar. Intentá de nuevo.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }, [selectedService, paymentMethod, barber, service, selectedExtrasData, selectedDiscountData, subtotal, total, onSubmit, resetForm, splitMode, splitEfectivoNum, splitMpNum, selectedDigitalMethod, pctEfectivo, pctDigital, pctSimple, cart, cartBarberId, cartBarberName, productSaleAssignment, form, clienteSearch.selectedCliente]);

  const handleSubmit = useCallback(async () => {
    await form.handleSubmit(onValidCobro)();
  }, [form, onValidCobro]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const index = parseInt(e.key) - 1;

        if (currentStep === 'barber' && barbers[index]) {
          handleSelectBarber(barbers[index].uid);
        } else if (currentStep === 'barber' && cart.length > 0 && index === barbers.length) {
          handleSelectNoBarber();
        } else if (currentStep === 'service' && services[index]) {
          handleSelectService(services[index].id);
        } else if (currentStep === 'extras' && extras[index]) {
          handleToggleExtra(extras[index].id);
        } else if (currentStep === 'discount' && discounts[index]) {
          handleSelectDiscount(discounts[index].id);
        } else if (currentStep === 'payment' && activeMethods[index]) {
          handleSelectPayment(activeMethods[index].method);
        }
      }

      if (e.key === 'Enter' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        if (currentStep === 'extras') {
          e.preventDefault();
          goToNextStep();
        } else if (currentStep === 'payment' && paymentMethod) {
          e.preventDefault();
          if (isSubmitting) return;
          handleSubmit();
        }
      }

      if (e.key === 'ArrowLeft' && e.altKey) {
        e.preventDefault();
        goToPrevStep();
      }
      if (e.key === 'ArrowRight' && e.altKey) {
        e.preventDefault();
        if (currentStep === 'barber' && selectedBarber) goToNextStep();
        if (currentStep === 'service' && selectedService) goToNextStep();
        if (currentStep === 'extras') goToNextStep();
      }

      if (e.key === 'Escape') {
        goToPrevStep();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentStep, barbers, services, extras, discounts, paymentMethod, selectedBarber, selectedService, activeMethods, handleSelectBarber, handleSelectNoBarber, handleSelectService, handleToggleExtra, handleSelectDiscount, handleSelectPayment, goToNextStep, goToPrevStep, handleSubmit, cart.length, isSubmitting]);

  // ── MP Terminal confirmed callback ──────────────────────────────────────────
  const handleMpTerminalConfirmed = useCallback(async (intentId: string, deviceId: string) => {
    if (!pendingMpPayload) return;
    setMpDialogOpen(false);

    const {
      payments,
      primaryMethod,
      productosPayload,
      finalBarberId,
      finalBarberName,
    } = pendingMpPayload;

    // Determine device_id from the dialog (stored in selectedDevice inside dialog)
    // We pass the intentId so addTransaction can store it on the venta row.
    setIsSubmitting(true);
    try {
      const result = await onSubmit({
        barberId: finalBarberId,
        barberName: finalBarberName,
        serviceId: service?.id || '',
        serviceName: service?.name || '',
        servicePrice: service?.price || 0,
        extras: selectedExtrasData.map(e => ({ uid: e.id, name: e.name, price: e.price })),
        discount: selectedDiscountData?.value || 0,
        discountType: selectedDiscountData?.type || 'percentage',
        paymentMethod: primaryMethod,
        payments,
        subtotal,
        total,
        productos: productosPayload,
        mpPaymentIntentId: intentId,
        mpDeviceId: deviceId,
        clienteId: clienteSearch.selectedCliente?.id ?? null,
      });

      if (result) {
        triggerSuccessOverlay();
        resetForm();
      } else {
        feedback.error('❌ No se pudo guardar el cobro', {
          description: 'El pago fue aprobado en la terminal pero falló al registrarse. Anotalo manualmente.',
        });
      }
    } finally {
      setIsSubmitting(false);
      setPendingMpPayload(null);
    }
  }, [pendingMpPayload, onSubmit, service, selectedExtrasData, selectedDiscountData, subtotal, total, cart.length, recargoTotal, totalACobrar, resetForm, clienteSearch.selectedCliente]);

  // ── "Cobrar con Terminal" explicit handler ───────────────────────────────────
  // Called only when the user explicitly clicks the terminal button.
  const handleCobrarConTerminal = useCallback(() => {
    if (!mpConnected) {
      setMpConnectModalOpen(true);
      return;
    }

    const isMpMethod =
      paymentMethod === 'mercado_pago' ||
      (splitMode && selectedDigitalMethod === 'mercado_pago');

    if (!isMpMethod) return;

    // Build payment lines (same logic as handleSubmit)
    let payments: { method: PaymentMethod; amount: number; basePago: number; recargoPct: number; recargoMonto: number }[];
    let primaryMethod: PaymentMethod;

    if (splitMode && selectedDigitalMethod) {
      const recE = Math.round((splitEfectivoNum * pctEfectivo) / 100);
      const recD = Math.round((splitMpNum * pctDigital) / 100);
      payments = [
        { method: 'efectivo', basePago: splitEfectivoNum, recargoPct: pctEfectivo, recargoMonto: recE, amount: splitEfectivoNum + recE },
        { method: selectedDigitalMethod, basePago: splitMpNum, recargoPct: pctDigital, recargoMonto: recD, amount: splitMpNum + recD },
      ];
      primaryMethod = splitEfectivoNum >= splitMpNum ? 'efectivo' : selectedDigitalMethod;
    } else {
      const recargoMonto = Math.round((total * pctSimple) / 100);
      payments = [{ method: paymentMethod as PaymentMethod, basePago: total, recargoPct: pctSimple, recargoMonto, amount: total + recargoMonto }];
      primaryMethod = paymentMethod as PaymentMethod;
    }

    const mpPaymentLine = payments.find((p) => p.method === 'mercado_pago');
    const mpAmountPesos = mpPaymentLine ? mpPaymentLine.amount : totalACobrar;

    const productosPayload: ProductoCartInput[] = cart.map(it => ({
      producto_id: it.producto_id,
      producto_sucursal_id: it.producto_sucursal_id,
      producto_nombre: it.nombre,
      marca_id: it.marca_id,
      marca_nombre: it.marca_nombre,
      precio_unitario: it.precio_unitario,
      cantidad: it.cantidad,
    }));

    const hasServiceLocal = !!selectedService;
    const finalBarberId = hasServiceLocal
      ? (barber?.id || '')
      : (productSaleAssignment === 'barber' ? (cartBarberId || '') : '');
    const finalBarberName = hasServiceLocal
      ? (barber ? `${barber.firstName} ${barber.lastName}` : '')
      : (productSaleAssignment === 'barber' ? (cartBarberName || '') : '');

    setPendingMpPayload({ payments, primaryMethod, productosPayload, finalBarberId, finalBarberName, mpAmountPesos, mpDeviceId: null });
    setMpDialogOpen(true);
  }, [mpConnected, paymentMethod, splitMode, selectedDigitalMethod, splitEfectivoNum, splitMpNum, pctEfectivo, pctDigital, pctSimple, total, totalACobrar, cart, selectedService, barber, productSaleAssignment, cartBarberId, cartBarberName]);

  const StepIcon = STEP_INFO[currentStep].icon;

  return (
    <div className="space-y-6 animate-fade-in sm:space-y-8">

      {/* MP Terminal Payment Dialog */}
      {pendingMpPayload && (
        <MpTerminalPaymentDialog
          open={mpDialogOpen}
          amountPesos={pendingMpPayload.mpAmountPesos}
          description={service?.name || `${cart.length} producto(s)`}
          onSuccess={handleMpTerminalConfirmed}
          onCancel={() => {
            setMpDialogOpen(false);
            setPendingMpPayload(null);
          }}
        />
      )}

      {/* Conectar MercadoPago modal */}
      <AlertDialog open={mpConnectModalOpen} onOpenChange={setMpConnectModalOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Conectar MercadoPago</AlertDialogTitle>
            <AlertDialogDescription>
              Para cobrar con terminal necesitás conectar tu cuenta de MercadoPago. Vas a ser redirigido a MercadoPago para autorizar la conexión. ¿Querés hacerlo ahora?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Ahora no</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setMpConnectModalOpen(false); mpConnect(); }}>
              Conectar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Header */}
      <PageHeader
        title="Nuevo Cobro"
        icon={CreditCard}
        subtitle={(
          <span className="flex items-center gap-1.5 text-xs">
            <Keyboard className="h-3.5 w-3.5" />
            Ctrl+1-9 para selección rápida
          </span>
        )}
        actionsLayout="inline"
      />

      {/* Progress Steps */}
      <div className="flex gap-1">
        {STEPS.map((step, index) => (
          <div key={step} className="flex flex-col gap-1.5 flex-1 min-w-0">
            <button
              onClick={() => {
                if (index <= currentStepIndex) {
                  setCurrentStep(step);
                }
              }}
              className={`h-1.5 w-full rounded-full transition-colors ${
                index < currentStepIndex
                  ? 'bg-ring/40 cursor-pointer'
                  : index === currentStepIndex
                  ? 'bg-ring'
                  : 'bg-border'
              }`}
            />
          </div>
        ))}
      </div>

      {/* Step Header */}
      <div className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-center sm:gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
          <StepIcon className="h-5 w-5 text-foreground" />
        </div>
        <div className="flex-1">
          <h2 className="text-lg font-medium text-foreground">{STEP_INFO[currentStep].title}</h2>
          <p className="text-sm text-muted-foreground">{STEP_INFO[currentStep].subtitle}</p>
        </div>
      </div>

      {/* Step Content */}
      <div
        key={currentStep}
        className={`min-h-[320px] ${stepDirection === 'back' ? 'animate-step-in-back' : 'animate-step-in-forward'}`}
      >
        {/* Barber Step */}
        {currentStep === 'barber' && (
          <div className="space-y-6">
            {showBarbersSkeleton ? (
              <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 md:grid-cols-3">
                {[0, 1, 2, 3, 4, 5].map(i => (
                  <div key={i} className="rounded-lg border border-border bg-card p-4 sm:p-6">
                    <Skeleton className="h-12 w-12 rounded-full mx-auto mb-3" />
                    <Skeleton className="h-4 w-20 mx-auto" />
                  </div>
                ))}
              </div>
            ) : barbersError ? (
              <InlineReadError message={barbersError} onRetry={onRetryBarbers ?? (() => {})} />
            ) : (
              <>
                {barbers.length === 0 && (
                  <div className="rounded-lg border border-dashed border-border bg-muted/30 p-5">
                    <EmptyState
                      icon={User}
                      title="No tenés ningún barbero asignado"
                      description={teamSetupDescription}
                      action={(
                        <Button type="button" variant="outline" size="sm" onClick={handleGoToTeamSetup}>
                          Añadir miembro del equipo
                        </Button>
                      )}
                    />
                  </div>
                )}

                {(barbers.length > 0 || cart.length > 0) && (
                  <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 md:grid-cols-3">
                    {barbers.map((barber, index) => {
                      const isSelected =
                        selectedBarber === barber.uid ||
                        (productSaleAssignment === 'barber' && cartBarberId === barber.uid);
                      return (
                        <SelectableCard
                          key={barber.uid}
                          number={index + 1}
                          selected={isSelected}
                          onClick={() => handleSelectBarber(barber.uid)}
                        >
                          <div className="w-12 h-12 rounded-full bg-muted mx-auto mb-3 flex items-center justify-center">
                            <User className="h-6 w-6 text-muted-foreground" />
                          </div>
                          <p className="font-medium text-center text-foreground">{`${barber.firstName} ${barber.lastName}`}</p>
                        </SelectableCard>
                      );
                    })}

                    {/* Tarjeta "Sin barbero": solo visible cuando hay carrito */}
                    {cart.length > 0 && (
                      <SelectableCard
                        number={barbers.length + 1}
                        selected={productSaleAssignment === 'no_barber'}
                        onClick={handleSelectNoBarber}
                        className={productSaleAssignment === 'no_barber' ? '' : 'border-dashed'}
                      >
                        <div className="w-12 h-12 rounded-full bg-muted mx-auto mb-3 flex items-center justify-center">
                          <Package className="h-6 w-6 text-muted-foreground" />
                        </div>
                        <p className="font-medium text-center text-foreground">Sin barbero</p>
                        <p className="text-xs text-center text-muted-foreground mt-0.5">Solo productos</p>
                      </SelectableCard>
                    )}
                  </div>
                )}
              </>
            )}

            {form.formState.submitCount > 0 && form.formState.errors.barberId && (
              <p className="text-sm text-destructive">{form.formState.errors.barberId.message}</p>
            )}

            {/* Bloque productos: solo en paso inicial */}
            <div className="rounded-lg border border-border bg-card overflow-hidden">
              <div className="flex flex-col gap-2 border-b border-border px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <Package className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium text-foreground">Productos</span>
                  {cart.length > 0 && (
                    <span className="text-xs text-muted-foreground">
                      {productSaleAssignment === 'barber' && cartBarberName
                        ? `· Asignados a ${cartBarberName}`
                        : productSaleAssignment === 'no_barber'
                        ? '· Sin barbero'
                        : '· Elegí barbero o tocá Sin barbero para continuar'}
                    </span>
                  )}
                </div>
                {cart.length > 0 && (
                  <span className="text-sm font-semibold text-foreground">
                    ${subtotalProductos.toLocaleString('es-AR')}
                  </span>
                )}
              </div>

              {cart.length === 0 ? (
                <div className="px-4 py-5 text-center space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Sumá productos a la venta. Después elegí un barbero o tocá "Sin barbero".
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="transition-transform active:scale-[0.98]"
                    onClick={() => setPickerOpen(true)}
                    disabled={!sucursalId}
                  >
                    <Plus className="h-4 w-4 mr-1" /> Añadir producto
                  </Button>
                </div>
              ) : (
                <div className="p-3 space-y-2">
                  {cart.map((it) => (
                    <div
                      key={it.producto_sucursal_id}
                      className="animate-item-in flex flex-col gap-3 rounded-md border border-border bg-background p-2.5 sm:flex-row sm:items-center"
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted">
                        <Package className="h-3.5 w-3.5 text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{it.nombre}</p>
                        <p className="text-xs text-muted-foreground">
                          {it.marca_nombre ? `${it.marca_nombre} · ` : ''}
                          {it.cantidad} × ${it.precio_unitario.toLocaleString('es-AR')}
                        </p>
                      </div>
                      <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-start">
                        <p className="text-sm font-semibold text-foreground">
                          ${(it.precio_unitario * it.cantidad).toLocaleString('es-AR')}
                        </p>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => {
                            setCart(prev => {
                              const next = prev.filter(x => x.producto_sucursal_id !== it.producto_sucursal_id);
                              if (next.length === 0) {
                                setProductSaleAssignment('pending');
                                setCartBarberId(null);
                                setCartBarberName(null);
                              }
                              form.setValue('cart', next);
                              form.trigger();
                              return next;
                            });
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full transition-transform active:scale-[0.98]"
                    onClick={() => setPickerOpen(true)}
                  >
                    <Plus className="h-4 w-4 mr-1" /> Agregar más productos
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Service Step */}
        {currentStep === 'service' && (() => {
          // Group services by line
          const grouped: { lineId: string | null; lineName: string; lineColor?: string; services: Service[] }[] = [];
          const lineMap = new Map<string | null, Service[]>();
          
          services.forEach(service => {
            const key = service.lineId || null;
            if (!lineMap.has(key)) lineMap.set(key, []);
            lineMap.get(key)!.push(service);
          });

          // Sort services within each group by price ascending
          lineMap.forEach((svcs) => svcs.sort((a, b) => a.price - b.price));

          // Add groups with lines first (sorted by line name), then "Otros"
          const activeLines = lines.filter(l => lineMap.has(l.id));
          activeLines.forEach(line => {
            grouped.push({ lineId: line.id, lineName: line.name, lineColor: line.color, services: lineMap.get(line.id)! });
          });
          const noLine = lineMap.get(null);
          if (noLine) {
            grouped.push({ lineId: null, lineName: 'Otros', lineColor: undefined, services: noLine });
          }

          let globalIndex = 0;

          return (
            <div className="space-y-5">
              {grouped.map((group) => (
                <div key={group.lineId || 'no-line'}>
                  {group.lineName && (
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-3">
                      <EntityColorBar color={group.lineColor} size="sm" />
                      <div className="flex flex-1 items-center gap-2">
                        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">{group.lineName}</h3>
                        <div className="flex-1 h-px bg-border" />
                      </div>
                    </div>
                  )}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {group.services.map((service) => {
                      globalIndex++;
                      const idx = globalIndex;
                      const blocked = isPriceMissing(service.price);
                      return (
                        <SelectableCard
                          key={service.id}
                          number={idx}
                          selected={selectedService === service.id}
                          onClick={() => handleSelectService(service.id)}
                          className={`text-left${blocked ? ' opacity-50 cursor-not-allowed' : ''}`}
                        >
                          <div className="flex flex-col items-start gap-1.5 pl-6 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
                            <span className="font-medium text-foreground">{service.name}</span>
                            {blocked ? (
                              <Badge variant="outline" className="text-xs">Precio pendiente</Badge>
                            ) : (
                              <span className="text-lg font-semibold text-foreground">${service.price.toLocaleString()}</span>
                            )}
                          </div>
                        </SelectableCard>
                      );
                    })}
                  </div>
                </div>
              ))}

              {/* Ir a pago sin servicio: solo si hay productos asignados a este barbero y no se eligió servicio */}
              {cart.length > 0 && selectedBarber && !selectedService && (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full h-12"
                  onClick={() => {
                    setSelectedService('');
                    setSelectedExtras([]);
                    setSelectedDiscount('none');
                    setCurrentStep('payment');
                  }}
                >
                  Ir a pago sin servicio <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              )}
            </div>
          );
        })()}

        {/* Extras Step */}
        {currentStep === 'extras' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 md:grid-cols-3">
              {extras.map((extra, index) => {
                const blocked = isPriceMissing(extra.price);
                return (
                  <SelectableCard
                    key={extra.id}
                    number={index + 1}
                    selected={selectedExtras.includes(extra.id)}
                    onClick={() => handleToggleExtra(extra.id)}
                    className={blocked ? 'opacity-50 cursor-not-allowed' : ''}
                  >
                    {selectedExtras.includes(extra.id) && (
                      <div className="animate-pop-in absolute top-2 right-2 w-5 h-5 rounded-full bg-secondary text-secondary-foreground flex items-center justify-center">
                        <Check className="h-3 w-3" />
                      </div>
                    )}
                    <div className="pt-3">
                      <p className="font-medium text-foreground text-center">{extra.name}</p>
                      {blocked ? (
                        <div className="flex justify-center mt-1">
                          <Badge variant="outline" className="text-xs">Precio pendiente</Badge>
                        </div>
                      ) : (
                        <p className="text-sm font-semibold text-foreground text-center mt-1">+${extra.price.toLocaleString()}</p>
                      )}
                    </div>
                  </SelectableCard>
                );
              })}
            </div>

            <Button onClick={goToNextStep} className="w-full h-12 bg-primary text-primary-foreground hover:bg-primary/90">
              Continuar <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        )}

        {/* Resumen compacto del carrito en pasos posteriores a 'barber' (solo lectura) */}
        {cart.length > 0 && (currentStep === 'service' || currentStep === 'extras' || currentStep === 'discount') && (
          <div className="mt-4 flex flex-col gap-2 rounded-lg border border-border bg-muted/30 px-4 py-2.5 text-xs sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <Package className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
              <span className="text-muted-foreground truncate">
                {cart.length} producto{cart.length > 1 ? 's' : ''} · {productSaleAssignment === 'barber' && cartBarberName ? `Asignados a ${cartBarberName}` : productSaleAssignment === 'no_barber' ? 'Sin barbero' : 'Sin asignar'}
              </span>
            </div>
            <span className="font-semibold text-foreground flex-shrink-0">
              ${subtotalProductos.toLocaleString('es-AR')}
            </span>
          </div>
        )}

        {/* Discount Step */}
        {currentStep === 'discount' && (
          <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 md:grid-cols-3">
            <SelectableCard
              key="none"
              selected={selectedDiscount === 'none'}
              onClick={() => handleSelectDiscount('none')}
              className={selectedDiscount === 'none' ? '' : 'border-dashed'}
            >
              <div className="w-10 h-10 rounded-lg bg-muted mx-auto mb-3 flex items-center justify-center">
                <Check className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="font-medium text-center text-foreground">Sin descuento</p>
            </SelectableCard>
            {discounts.map((discount, index) => {
              const rounding = discount.rounding || 'cliente';
              const rawCalc = discount.type === 'fixed' 
                ? discount.value 
                : subtotal * (discount.value / 100);
              const calcAmount = discount.type === 'fixed' 
                ? rawCalc 
                : rounding === 'cliente' ? Math.floor(rawCalc) : Math.ceil(rawCalc);
              
              const paymentRestriction = discount.paymentMethod !== 'todos' && discount.id !== 'none';
              const paymentLabel = paymentRestriction ? getMethodLabel(discount.paymentMethod as PaymentMethod) : '';
              
              return (
                <SelectableCard
                  key={discount.id}
                  number={index + 1}
                  selected={selectedDiscount === discount.id}
                  onClick={() => handleSelectDiscount(discount.id)}
                >
                  {paymentRestriction && (
                    <span className="absolute top-3 right-3 text-[10px] font-medium px-1.5 py-0.5 rounded bg-accent text-accent-foreground">
                      Solo {paymentLabel}
                    </span>
                  )}
                  <div className="w-10 h-10 rounded-lg bg-muted mx-auto mb-3 flex items-center justify-center">
                    {discount.value === 0 ? (
                      <Check className="h-5 w-5 text-muted-foreground" />
                    ) : discount.type === 'fixed' ? (
                      <DollarSign className="h-5 w-5 text-muted-foreground" />
                    ) : (
                      <Percent className="h-5 w-5 text-muted-foreground" />
                    )}
                  </div>
                  <p className="font-medium text-center text-foreground">{discount.label}</p>
                  {discount.value > 0 && subtotal > 0 && (
                    <p className="text-xs text-center text-muted-foreground mt-1">
                      -${calcAmount.toLocaleString()}
                    </p>
                  )}
                </SelectableCard>
              );
            })}
          </div>
            <Button
              onClick={() => {
                const isValid = selectedDiscount === 'none' || discounts.some(d => d.id === selectedDiscount);
                if (!selectedDiscount || !isValid) {
                  handleSelectDiscount('none');
                  return;
                }
                goToNextStep();
              }}
              className="w-full h-12 bg-primary text-primary-foreground hover:bg-primary/90"
            >
              Continuar <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        )}

        {/* Payment Step */}
        {currentStep === 'payment' && (
          <div className="space-y-6">
            {methodsLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : activeMethods.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border bg-muted/30 p-8">
                <EmptyState
                  icon={Wallet}
                  title="No hay métodos de pago activos."
                  description="Activá al menos uno en Mi Negocio."
                />
              </div>
            ) : !splitMode ? (
              <>
                <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 md:grid-cols-3">
                  {activeMethods.map((m, idx) => {
                    const isEfectivo = m.method === 'efectivo';
                    const isSelected = paymentMethod === m.method;
                    const Icon = isEfectivo ? Banknote : CreditCard;
                    const selectedClass = isEfectivo
                      ? 'border-success bg-success/5 ring-1 ring-success/20'
                      : 'border-primary bg-primary/5 ring-1 ring-primary/20';
                    const hoverClass = isEfectivo ? 'hover:border-success' : 'hover:border-secondary';
                    const iconColor = isSelected
                      ? 'text-primary'
                      : 'text-foreground';
                    return (
                      <button
                        key={m.method}
                        onClick={() => handleSelectPayment(m.method)}
                        style={{
                          animation: `payment-card-in 280ms var(--ease-out-quint) ${idx * 60}ms both`,
                        }}
                        className={`relative p-6 rounded-lg border transition-[transform,colors] active:scale-[0.97] ${hoverClass} ${
                          isSelected ? selectedClass : 'border-border bg-card hover:bg-muted/50'
                        }`}
                      >
                        <span className="absolute top-3 left-3 text-xs font-medium text-muted-foreground">{idx + 1}</span>
                        <Icon className={`h-9 w-9 mx-auto mb-2 ${iconColor}`} />
                        <p className="font-medium text-center text-foreground">{m.label}</p>
                        {m.recargoPct > 0 && (
                          <p className="text-[11px] text-center text-muted-foreground mt-1">+{m.recargoPct}%</p>
                        )}
                      </button>
                    );
                  })}
                </div>

                <button
                  type="button"
                  onClick={enableSplitMode}
                  disabled={!isEfectivoActive || electronicMethods.length === 0}
                  title={!isEfectivoActive || electronicMethods.length === 0 ? 'Activá efectivo y al menos un método electrónico en Mi Negocio' : undefined}
                  className="w-full flex items-center justify-center gap-2 py-3 text-sm font-medium text-muted-foreground hover:text-foreground border border-dashed border-border rounded-lg hover:bg-muted/50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
                >
                  <Split className="h-4 w-4" />
                  Combinar métodos de pago
                </button>

                {form.formState.submitCount > 0 && form.formState.errors.paymentMethod && (
                  <p className="text-sm text-destructive">{form.formState.errors.paymentMethod.message}</p>
                )}
              </>
            ) : (
              <div className="space-y-4 rounded-lg border border-border bg-card p-4 sm:p-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2">
                    <Split className="h-4 w-4 text-foreground" />
                    <span className="font-medium text-foreground">Pago combinado</span>
                  </div>
                  <Button variant="ghost" size="sm" className="w-full sm:w-auto" onClick={cancelSplitMode}>
                    <X className="h-4 w-4 mr-1" /> Cancelar
                  </Button>
                </div>

                {electronicMethods.length > 1 && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Método electrónico</label>
                    <div className="flex flex-wrap gap-2">
                      {electronicMethods.map(m => (
                        <button
                          key={m.method}
                          type="button"
                          onClick={() => {
                            setSelectedDigitalMethod(m.method);
                            form.setValue('split.digitalMethod', m.method);
                            form.trigger();
                          }}
                          className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                            selectedDigitalMethod === m.method
                              ? 'border-secondary bg-secondary/10 text-foreground'
                              : 'border-border text-muted-foreground hover:bg-muted/50'
                          }`}
                        >
                          {getMethodLabel(m.method)}
                          {m.recargoPct > 0 && <span className="ml-1 opacity-70">+{m.recargoPct}%</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {form.formState.submitCount > 0 && form.formState.errors.split?.digitalMethod && (
                  <p className="text-sm text-destructive">{form.formState.errors.split.digitalMethod.message}</p>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium flex items-center gap-2">
                      <Banknote className="h-4 w-4 text-success" /> Efectivo
                      {pctEfectivo > 0 && <span className="text-[11px] text-muted-foreground">+{pctEfectivo}%</span>}
                    </label>
                    <CurrencyInput
                      value={efectivoAmount}
                      onChange={handleEfectivoChange}
                      placeholder="0"
                      className="h-12 text-lg"
                    />
                    {pctEfectivo > 0 && splitEfectivoNum > 0 && (
                      <p className="text-[11px] text-muted-foreground">
                        → ${(splitEfectivoNum + Math.round(splitEfectivoNum * pctEfectivo / 100)).toLocaleString()}
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium flex items-center gap-2">
                      <CreditCard className="h-4 w-4 text-secondary" />
                      {selectedDigitalMethod ? getMethodLabel(selectedDigitalMethod) : 'Electrónico'}
                      {pctDigital > 0 && <span className="text-[11px] text-muted-foreground">+{pctDigital}%</span>}
                    </label>
                    <CurrencyInput
                      value={mpAmount}
                      onChange={handleMpChange}
                      placeholder="0"
                      className="h-12 text-lg"
                    />
                    {pctDigital > 0 && splitMpNum > 0 && (
                      <p className="text-[11px] text-muted-foreground">
                        → ${(splitMpNum + Math.round(splitMpNum * pctDigital / 100)).toLocaleString()}
                      </p>
                    )}
                  </div>
                </div>

                <div className={`flex flex-col gap-2 rounded-lg p-3 text-sm sm:flex-row sm:items-center sm:justify-between ${
                  splitValid ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'
                }`}>
                  <span>Suma: ${splitSum.toLocaleString()} / Total: ${total.toLocaleString()}</span>
                  {splitValid ? <Check className="h-4 w-4" /> : <span className="text-xs">Debe coincidir exacto</span>}
                </div>
              </div>
            )}

            {/* Cliente (opcional) */}
            <div className="rounded-lg border border-border bg-card p-4 sm:p-6 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium text-foreground">Cliente</span>
                  <span className="text-xs text-muted-foreground">(opcional)</span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1 text-xs"
                  onClick={() => setNuevoClienteOpen(true)}
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  Nuevo cliente
                </Button>
              </div>
              <ClienteSearchPicker
                label=""
                selectedCliente={clienteSearch.selectedCliente}
                onSelect={clienteSearch.setSelectedCliente}
                searchOpen={clienteSearch.searchOpen}
                onSearchOpenChange={clienteSearch.setSearchOpen}
                query={clienteSearch.query}
                onQueryChange={clienteSearch.setQuery}
                results={clienteResultsInSucursal}
                searching={clienteSearch.searching}
              />
              <p className="text-xs text-muted-foreground">
                Asociá la venta a un cliente para que quede registrada en su historial. Podés dejarlo vacío.
              </p>
            </div>

            {/* Summary */}
            <div className="rounded-lg border border-border bg-card p-4 sm:p-6">

              <div className="space-y-3 text-sm">
                {(() => {
                  let displayBarberName: string | null = null;
                  if (barber) {
                    displayBarberName = `${barber.firstName} ${barber.lastName}`;
                  } else if (cart.length > 0) {
                    if (productSaleAssignment === 'barber' && cartBarberName) {
                      displayBarberName = cartBarberName;
                    } else if (productSaleAssignment === 'no_barber') {
                      displayBarberName = 'Sin barbero';
                    }
                  }
                  if (!displayBarberName) return null;
                  return (
                    <div className="flex items-start justify-between gap-4">
                      <span className="text-muted-foreground">Barbero</span>
                      <span className="shrink-0 text-right font-medium">{displayBarberName}</span>
                    </div>
                  );
                })()}
                {clienteSearch.selectedCliente && (
                  <div className="flex items-start justify-between gap-4">
                    <span className="text-muted-foreground">Cliente</span>
                    <span className="shrink-0 text-right font-medium">{clienteFullName(clienteSearch.selectedCliente)}</span>
                  </div>
                )}
                {service && (
                  <div className="flex items-start justify-between gap-4">
                    <span className="text-muted-foreground">Servicio</span>
                    <span className="shrink-0 text-right font-medium">{service.name}</span>
                  </div>
                )}
                {selectedExtrasData.length > 0 && (
                  <div className="flex items-start justify-between gap-4">
                    <span className="text-muted-foreground">Extras</span>
                    <span className="max-w-[65%] text-right font-medium">{selectedExtrasData.map(e => e.name).join(', ')}</span>
                  </div>
                )}
                {cart.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="flex items-start justify-between gap-4">
                      <span className="text-muted-foreground">Productos</span>
                      <span className="shrink-0 text-right font-medium">${subtotalProductos.toLocaleString('es-AR')}</span>
                    </div>
                    <div className="text-xs text-muted-foreground pl-2 space-y-0.5">
                      {cart.map(it => (
                        <div key={it.producto_sucursal_id} className="flex items-start justify-between gap-4">
                          <span className="truncate pr-2">{it.cantidad}× {it.nombre}</span>
                          <span className="shrink-0 text-right">${(it.precio_unitario * it.cantidad).toLocaleString('es-AR')}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {subtotalServicios > 0 && (
                  <div className="flex items-start justify-between gap-4 border-t border-border pt-3">
                    <span className="text-muted-foreground">Subtotal servicios</span>
                    <span className="shrink-0 text-right font-medium">${subtotalServicios.toLocaleString('es-AR')}</span>
                  </div>
                )}
                <div className={`flex items-start justify-between gap-4 ${subtotalServicios > 0 ? '' : 'pt-3 border-t border-border'}`}>
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="shrink-0 text-right font-medium">${subtotal.toLocaleString('es-AR')}</span>
                </div>
                {selectedDiscountData && selectedDiscountData.value > 0 && (
                  isDiscountValidForPayment ? (
                    <div className="animate-fade-in flex items-start justify-between gap-4 text-success">
                      <span>Descuento ({selectedDiscountData.type === 'fixed' ? `$${selectedDiscountData.value.toLocaleString()}` : `${selectedDiscountData.value}%`})</span>
                      <span key={discountAmount} className="animate-value-change shrink-0 text-right font-medium">-${discountAmount.toLocaleString()}</span>
                    </div>
                  ) : (
                    <div className="animate-fade-in flex items-start justify-between gap-4 text-destructive">
                      <span className="text-xs">Descuento no aplica a este método</span>
                      <span className="shrink-0 text-right font-medium line-through text-muted-foreground">-${
                        selectedDiscountData.type === 'fixed' 
                          ? selectedDiscountData.value.toLocaleString()
                          : (selectedDiscountData.rounding === 'cliente' 
                              ? Math.floor(subtotal * selectedDiscountData.value / 100) 
                              : Math.ceil(subtotal * selectedDiscountData.value / 100)
                            ).toLocaleString()
                      }</span>
                    </div>
                  )
                )}
                {recargoTotal > 0 && (
                  <div className="flex items-start justify-between gap-4 text-foreground">
                    <span className="text-muted-foreground">{recargoLabel}</span>
                    <span key={recargoTotal} className="animate-value-change shrink-0 text-right font-medium">+${recargoTotal.toLocaleString()}</span>
                  </div>
                )}
              </div>

              <div className="mt-4 flex flex-col gap-1 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-lg font-medium">Total a cobrar</span>
                <span key={totalACobrar} className="animate-value-change self-end text-3xl font-bold text-foreground sm:self-auto">${totalACobrar.toLocaleString()}</span>
              </div>

              {form.formState.submitCount > 0 && form.formState.errors.root && (
                <p className="mt-3 text-sm text-destructive">{form.formState.errors.root.message}</p>
              )}

              <Button
                onClick={handleSubmit}
                className="w-full mt-6 h-14 text-base font-medium bg-secondary text-secondary-foreground hover:bg-secondary/90"
                disabled={!paymentMethod || isSubmitting || (splitMode && !splitValid)}
              >
                {isSubmitting ? (
                  <><Loader2 className="h-5 w-5 mr-2 animate-spin" /> Guardando...</>
                ) : (
                  <><Check className="h-5 w-5 mr-2" /> Registrar Cobro</>
                )}
              </Button>

              {/* Cobrar con Terminal — visible cuando el método incluye MP */}
              {(paymentMethod === 'mercado_pago' || (splitMode && selectedDigitalMethod === 'mercado_pago')) && (
                <Button
                  onClick={handleCobrarConTerminal}
                  className="w-full mt-2 h-14 text-base font-medium gap-2 bg-secondary text-secondary-foreground hover:bg-secondary/90"
                  disabled={isSubmitting || (splitMode && !splitValid)}
                >
                  <MonitorSmartphone className="h-5 w-5" />
                  Cobrar con Terminal
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Navigation */}
      {(currentStepIndex > 0 || cart.length > 0 || !!selectedBarber || !!selectedService) && (
        <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
          {currentStepIndex > 0 ? (
            <Button variant="ghost" onClick={goToPrevStep} className="w-full gap-2 text-muted-foreground hover:text-foreground sm:w-auto">
              <ArrowLeft className="h-4 w-4" /> Volver
            </Button>
          ) : <span />}
          {(cart.length > 0 || !!selectedBarber || !!selectedService || selectedExtras.length > 0 || selectedDiscount !== 'none') && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setCancelOpen(true)}
              className="w-full gap-2 text-muted-foreground hover:text-destructive sm:w-auto"
            >
              <X className="h-4 w-4" /> Cancelar venta
            </Button>
          )}
        </div>
      )}

      {/* Daily Turnos Viewer — solo en el paso inicial */}
      {currentStep === 'barber' && (
        canViewDailyTurnos ? (
          <DailyTurnosViewer barbers={barbers} />
        ) : (
          <PlanLockedFeature
            title="Turnos requiere plan Profesional"
            description="La agenda de turnos del dia se habilita desde el plan Profesional. Podes seguir registrando cobros con tu plan actual."
            requiredPlan="profesional"
            currentPlan={currentPlan}
            onManagePlan={handleNavigateToBilling}
            variant="agenda"
          />
        )
      )}

      {sucursalId && (
        <ProductoPickerDialog
          open={pickerOpen}
          sucursalId={sucursalId}
          canEditPrice={canEditProductPrice}
          initialCart={cart}
          onClose={() => setPickerOpen(false)}
          onConfirm={(items) => {
            setCart(items);
            form.setValue('cart', items);
            form.trigger();
            // Si el carrito quedó vacío tras editar, resetear asignación.
            if (items.length === 0) {
              setProductSaleAssignment('pending');
              setCartBarberId(null);
              setCartBarberName(null);
            }
          }}
        />
      )}

      <NuevoClienteDialog
        open={nuevoClienteOpen}
        onOpenChange={setNuevoClienteOpen}
        onCreated={(id) => {
          // Autoseleccionar el cliente recién creado buscándolo en los resultados.
          // El hook re-fetchea al abrir el popover; acá disparamos una búsqueda por id.
          (async () => {
            const { data } = await import('@/integrations/supabase/client').then(m =>
              m.supabase.from('clientes').select('id, nombre, apellido, telefono, email').eq('id', id).maybeSingle()
            );
            if (data) {
              clienteSearch.setSelectedCliente({ ...(data as any), inSucursal: true } as ClienteLite);
            }
          })();
        }}
      />

      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>

        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Cancelar venta?</AlertDialogTitle>
            <AlertDialogDescription>
              Se va a limpiar el barbero, servicio, extras, descuento, pagos y los productos del carrito. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Volver</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { resetForm(); setCancelOpen(false); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Sí, cancelar venta
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {overlayPhase !== 'idle' && createPortal(
        <div
          className={`fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm ${
            overlayPhase === 'exiting' ? 'animate-overlay-hide' : 'animate-overlay-show'
          }`}
          aria-live="polite"
          aria-label="Cobro registrado exitosamente"
        >
          <div
            className={`flex flex-col items-center gap-5 rounded-2xl bg-primary px-8 py-8 sm:px-12 sm:py-10 text-center ${
              overlayPhase === 'exiting' ? 'animate-confirm-card-out' : 'animate-confirm-card-in'
            }`}
            style={{ maxWidth: '300px', width: '90%' }}
          >
            <div
              className={`${overlayPhase !== 'exiting' ? 'animate-confirm-icon-pop ' : ''}flex items-center justify-center rounded-full bg-primary-foreground/10`}
              style={{ width: 64, height: 64 }}
            >
              <Check className="h-8 w-8 text-primary-foreground" strokeWidth={2.5} />
            </div>
            <div className={overlayPhase !== 'exiting' ? 'animate-confirm-text-in flex flex-col gap-1' : 'flex flex-col gap-1'}>
              <p className="text-xl font-medium text-primary-foreground">Cobro registrado</p>
              <p className="text-sm text-primary-foreground/60">
                El cobro fue registrado con éxito
              </p>
            </div>
          </div>
        </div>,
        document.body
      )}

    </div>
  );
}
