import { useCallback, useEffect, useState } from 'react';
import { useOnboarding } from './onboarding/OnboardingProvider';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Loader2, ChevronDown, Info } from 'lucide-react';
import { Service, Extra, Discount, Line, Barber } from '@/types/barbershop';
import { ServicesConfig } from './config/ServicesConfig';
import { ExtrasConfig } from './config/ExtrasConfig';
import { DiscountsConfig } from './config/DiscountsConfig';
import { LinesConfig } from './config/LinesConfig';
import { ProductosGlobalConfig } from './productos/ProductosGlobalConfig';
import { PaymentMethodsConfig } from './config/PaymentMethodsConfig';
import { CuentasSucursalConfig } from './config/CuentasSucursalConfig';
import { EquipoGeneralConfig } from './config/EquipoGeneralConfig';
import { SucursalesInactivasCollapsible } from './config/SucursalesInactivasCollapsible';
import type { Sucursal } from '@/contexts/SucursalContext';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

interface MiNegocioGeneralTabContentProps {
  /** true cuando la tab "General" está activa. Los handlers que reciba deben ser globales. */
  isReady: boolean;
  services: Service[];
  extras: Extra[];
  discounts: Discount[];
  lines: Line[];
  onAddService: (service: Omit<Service, 'id' | 'uid'>) => Promise<Service | null>;
  onUpdateService: (id: string, updates: Partial<Service>) => Promise<void>;
  onAddExtra: (extra: Omit<Extra, 'id' | 'uid'>) => Promise<Extra | null>;
  onUpdateExtra: (id: string, updates: Partial<Extra>) => Promise<void>;
  onAddDiscount: (discount: Omit<Discount, 'id'>) => Promise<Discount | null>;
  onUpdateDiscount: (id: string, updates: Partial<Discount>) => Promise<void>;
  onDeleteDiscount: (id: string) => void;
  onToggleDiscountActive?: (id: string, activo: boolean) => void;
  onAddLine: (line: Omit<Line, 'id'>) => Promise<Line | null>;
  onUpdateLine: (id: string, updates: Partial<Line>) => Promise<void>;
  onReorderLines?: (ids: string[]) => Promise<void>;
  onDeleteService: (id: string) => void;
  onDeleteExtra: (id: string) => void;
  onDeleteLine: (id: string) => void;
  // Equipo General
  organizationId: string;
  allBarbers: Barber[];
  allSucursales: { id: string; nombre: string; activa: boolean }[];
  onAddBarberToSucursal: (barber: Omit<Barber, 'id' | 'uid'>, sucursalId: string) => void;
  onUpdateBarber: (id: string, updates: Partial<Barber>) => void | Promise<void>;
  onRefreshBarbers?: () => Promise<void> | void;
  onNavigateToMiNegocio?: (sucursalId: string, barberoId: string) => void;
  /** Sucursales desactivadas (activa=false, deleted_at IS NULL) que se muestran en el bloque colapsable al final. */
  sucursalesInactivas?: Array<Sucursal & { fecha_desactivacion: string | null }>;
  /** Callback para "Ver" — navega a la tab de esa sucursal. */
  onVerSucursalInactiva?: (sucursalId: string) => void;
  /** Callback luego de eliminar una sucursal — refresca la lista en el padre. */
  onAfterDeleteSucursal?: () => Promise<void> | void;
}

/**
 * Contenido de la tab "General" de Mi Negocio.
 * Edita configuración global del negocio: catálogo (servicios/extras/productos/descuentos)
 * y métodos de pago generales. NO incluye equipo ni datos por sucursal.
 *
 * Guard: bloquea mutaciones si el SucursalContext aún no está en modo global,
 * para evitar escribir accidentalmente sobre la sucursal anterior.
 */
export function MiNegocioGeneralTabContent({
  isReady,
  services, extras, discounts, lines,
  onAddService, onUpdateService,
  onAddExtra, onUpdateExtra,
  onAddDiscount, onUpdateDiscount, onDeleteDiscount, onToggleDiscountActive,
  onAddLine, onUpdateLine, onReorderLines,
  onDeleteService, onDeleteExtra, onDeleteLine,
  organizationId, allBarbers, allSucursales,
  onAddBarberToSucursal, onUpdateBarber, onRefreshBarbers, onNavigateToMiNegocio,
  sucursalesInactivas, onVerSucursalInactiva, onAfterDeleteSucursal,
}: MiNegocioGeneralTabContentProps) {
  const { isOwner, isGeneralManager } = useAuth();
  const canManageEquipo = isOwner || isGeneralManager;
  const [cuentasOpen, setCuentasOpen] = useState(false);
  const [serviciosTab, setServiciosTab] = useState<'services' | 'lines' | 'extras'>('services');

  // El onboarding necesita poder abrir esta sección antes de mostrar su paso.
  const { registerSectionOpener } = useOnboarding();
  useEffect(() => {
    registerSectionOpener('cuentas-sucursal', () => setCuentasOpen(true));
    return () => registerSectionOpener('cuentas-sucursal', null);
  }, [registerSectionOpener]);



  const guarded = useCallback(<TArgs extends unknown[], TReturn>(fn: (...args: TArgs) => TReturn) => {
    return (...args: TArgs): TReturn | undefined => {
      if (!isReady) {
        toast.warning('Sincronizando vista general… probá de nuevo en un instante.');
        return undefined;
      }
      return fn(...args);
    };
  }, [isReady]);

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="mt-4 space-y-6 sm:mt-6">
      <div className="flex items-start gap-3 rounded-lg border border-secondary bg-secondary px-4 py-3 text-sm text-primary shadow-sm">
        <Info className="h-4 w-4 mt-0.5 shrink-0 text-primary/60" />
        <p>
          Acá definís la base de tu negocio: el catálogo de servicios, el equipo, los descuentos y los métodos de pago que aplican a todas las sucursales. Cada sucursal puede después activar y ajustar lo que necesite por su cuenta.
        </p>
      </div>

      <div className={`flex items-center gap-2 rounded-md border border-border bg-muted/60 px-3 text-sm text-muted-foreground transition-all duration-300 ease-out ${isReady ? 'max-h-0 opacity-0 overflow-hidden py-0 border-0' : 'max-h-16 py-2'}`}>
        <Loader2 className="h-4 w-4 animate-spin shrink-0" />
        <span>Cargando configuración…</span>
      </div>

      {/* Anchor nav — solo desktop */}
      <nav className="hidden md:block sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border/60 py-2 shadow-sm">
        <div className="flex items-center gap-1 overflow-x-auto">
          <button onClick={() => { setCuentasOpen(true); scrollTo('seccion-cuentas'); }} className="shrink-0 rounded px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            Cuentas de sucursal
          </button>
          <button onClick={() => scrollTo('seccion-equipo')} className="shrink-0 rounded px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            Equipo
          </button>
          <button onClick={() => scrollTo('seccion-servicios')} className="shrink-0 rounded px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            Servicios
          </button>
          <button onClick={() => scrollTo('seccion-productos')} className="shrink-0 rounded px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            Productos
          </button>
          <button onClick={() => scrollTo('seccion-descuentos')} className="shrink-0 rounded px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            Descuentos
          </button>
          <button onClick={() => scrollTo('seccion-metodos-pago')} className="shrink-0 rounded px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            Métodos de pago
          </button>
        </div>
      </nav>

      <div className={!isReady ? 'opacity-80 pointer-events-none select-none' : ''} aria-disabled={!isReady || undefined}>
        {/* Cuentas de sucursal — colapsado por defecto */}
        <div id="seccion-cuentas">
          <Collapsible open={cuentasOpen} onOpenChange={setCuentasOpen}>
            <CollapsibleTrigger asChild>
              <button className="flex items-center justify-between w-full rounded-lg border border-border bg-muted/20 px-4 py-3 hover:bg-muted/40 transition-colors text-left">
                <div>
                  <p className="text-sm font-medium">Cuentas de sucursal</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Accesos operativos generados automáticamente para operar desde caja o recepción.</p>
                </div>
                <ChevronDown className={`h-4 w-4 text-muted-foreground shrink-0 ml-3 transition-transform duration-200 ${cuentasOpen ? 'rotate-180' : ''}`} />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-3">
              <CuentasSucursalConfig />
            </CollapsibleContent>
          </Collapsible>
        </div>

        {/* Equipo General (solo owner/GM) */}
        {canManageEquipo && (
          <div id="seccion-equipo" data-onboarding-id="equipo-general-section" className="mt-8 space-y-4">
            <h3 className="text-base font-medium text-foreground">Equipo</h3>
            <EquipoGeneralConfig
              organizationId={organizationId}
              allBarbers={allBarbers}
              allSucursales={allSucursales}
              onAddBarberToSucursal={onAddBarberToSucursal}
              onUpdateBarber={onUpdateBarber}
              onRefreshBarbers={onRefreshBarbers}
              onNavigateToMiNegocio={onNavigateToMiNegocio}
            />
          </div>
        )}

        {/* Servicios */}
        <section id="seccion-servicios" className="border-t pt-6 mt-8">
          <h3 className="text-base font-medium text-foreground mb-4">Servicios</h3>
          <div className="space-y-4">
            <SegmentedControl
              options={[
                { value: 'services', label: 'Servicios' },
                { value: 'lines', label: 'Categorías' },
                { value: 'extras', label: 'Extras' },
              ]}
              value={serviciosTab}
              onChange={(v) => setServiciosTab(v as 'services' | 'lines' | 'extras')}
            />

            {serviciosTab === 'services' && (
              <div role="tabpanel" className="animate-fade-in">
                <ServicesConfig
                  mode="global"
                  services={services}
                  lines={lines}
                  onAdd={guarded(onAddService)}
                  onUpdate={guarded(onUpdateService)}
                  onAddLine={onAddLine}
                  onUpdateLine={guarded(onUpdateLine)}
                  onDeleteLine={guarded(onDeleteLine)}
                  onDelete={guarded(onDeleteService)}
                />
              </div>
            )}

            {serviciosTab === 'lines' && (
              <div role="tabpanel" className="animate-fade-in">
                <LinesConfig
                  lines={lines}
                  onAdd={onAddLine}
                  onUpdate={guarded(onUpdateLine)}
                  onDelete={guarded(onDeleteLine)}
                  onReorder={onReorderLines}
                />
              </div>
            )}

            {serviciosTab === 'extras' && (
              <div role="tabpanel" className="animate-fade-in">
                <ExtrasConfig
                  mode="global"
                  extras={extras}
                  onAdd={guarded(onAddExtra)}
                  onUpdate={guarded(onUpdateExtra)}
                  onDelete={guarded(onDeleteExtra)}
                />
              </div>
            )}
          </div>
        </section>

        {/* Productos */}
        <section id="seccion-productos" className="border-t pt-6 mt-8">
          <h3 className="text-base font-medium text-foreground mb-4">Productos</h3>
          <ProductosGlobalConfig />
        </section>

        {/* Descuentos */}
        <section id="seccion-descuentos" className="border-t pt-6 mt-8">
          <h3 className="text-base font-medium text-foreground mb-4">Descuentos</h3>
          <DiscountsConfig
            mode="global"
            discounts={discounts}
            onAdd={guarded(onAddDiscount)}
            onUpdate={guarded(onUpdateDiscount)}
            onDelete={guarded(onDeleteDiscount)}
            onToggleActive={onToggleDiscountActive ? guarded(onToggleDiscountActive) : undefined}
          />
        </section>

        {/* Métodos de pago generales */}
        <div id="seccion-metodos-pago" className="mt-8 space-y-4">
          <h3 className="text-base font-medium text-foreground">Métodos de pago</h3>
          <PaymentMethodsConfig sucursalId={null} />
        </div>

        {/* Sucursales desactivadas — siempre como último bloque de la pestaña General */}
        {sucursalesInactivas && sucursalesInactivas.length > 0 && (
          <SucursalesInactivasCollapsible
            sucursalesInactivas={sucursalesInactivas}
            onVerSucursal={(id) => onVerSucursalInactiva?.(id)}
            onAfterDelete={async () => { await onAfterDeleteSucursal?.(); }}
          />
        )}
      </div>
    </div>
  );
}
