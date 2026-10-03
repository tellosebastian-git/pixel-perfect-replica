import { useState, useEffect, useCallback } from 'react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { History, Calendar as CalendarIcon, User, Banknote, CreditCard, Filter, X, MoreVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DrawerForm } from '@/components/ui/drawer-form';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StatusPill } from '@/components/ui/StatusPill';
import { SkeletonRow } from '@/components/ui/SkeletonRow';
import { InlineReadError } from '@/components/ui/InlineReadError';
import { useDelayedVisible } from '@/hooks/useDelayedVisible';
import { useReadState } from '@/hooks/useReadState';
import { supabase } from '@/integrations/supabase/client';
import { Barber } from '@/types/barbershop';
import { useAuth } from '@/contexts/AuthContext';
import { useOrganization } from '@/contexts/OrganizationContext';
import { useSucursal } from '@/contexts/SucursalContext';
import { useVoidClosure } from '@/hooks/useVoidClosure';
import { VoidClosureDialog } from './VoidClosureDialog';

interface CashClosingRecord {
  id: number;
  created_at: string;
  closed_at: string | null;
  barbero: string | null;
  barbero_id: string | null;
  mp: number | null;
  efectivo: number | null;
  total_facturado: number | null;
  cantidad_de_servicios: number | null;
  sueldo: number | null;
  dia: string | null;
  estado: string | null;
  entry_mode: string | null;
  backfilled_at: string | null;
  backfill_reason: string | null;
}

interface CashClosingHistoryProps {
  barbers: Barber[];
  externalOpen?: boolean;
  onExternalOpenChange?: (open: boolean) => void;
}

export function CashClosingHistory({ barbers, externalOpen, onExternalOpenChange }: CashClosingHistoryProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = externalOpen !== undefined ? externalOpen : internalOpen;
  const setOpen = onExternalOpenChange || setInternalOpen;
  const [selectedBarber, setSelectedBarber] = useState<string>('all');
  const [startDate, setStartDate] = useState<Date | undefined>(undefined);
  const [endDate, setEndDate] = useState<Date | undefined>(undefined);

  const { user, profile } = useAuth();
  const { organization } = useOrganization();
  const { currentSucursal } = useSucursal();

  const contextKey = [
    organization?.id ?? 'none',
    selectedBarber,
    startDate ? format(startDate, 'yyyy-MM-dd') : 'none',
    endDate ? format(endDate, 'yyyy-MM-dd') : 'none',
    open ? 'open' : 'closed',
  ].join('::');

  const readState = useReadState<CashClosingRecord[]>({
    contextKey,
    errorMessage: 'No pudimos cargar el historial.',
    staleErrorMessage: 'No pudimos actualizar el historial.',
    surfaceId: 'caja-historial-cierres',
  });

  const fetchRecords = useCallback(() => {
    readState.run(async (signal) => {
      let query = supabase
        .from('ingresos')
        .select('id, created_at, closed_at, barbero, barbero_id, mp, efectivo, total_facturado, cantidad_de_servicios, sueldo, dia, estado, entry_mode, backfilled_at, backfill_reason')
        .order('created_at', { ascending: false });

      if (selectedBarber !== 'all') {
        query = query.eq('barbero_id', selectedBarber);
      }

      if (startDate) {
        query = query.gte('created_at', format(startDate, 'yyyy-MM-dd') + 'T00:00:00.000Z');
      }

      if (endDate) {
        query = query.lte('created_at', format(endDate, 'yyyy-MM-dd') + 'T23:59:59.999Z');
      }

      const { data, error, status } = await query.limit(100).abortSignal(signal);
      if (error) return { data: null, error, status };
      return { data: (data as CashClosingRecord[]) || [], error: null };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBarber, startDate, endDate, readState.run]);

  const {
    voidingClosure,
    setVoidingClosure,
    voidReason,
    setVoidReason,
    handleVoidClosure,
    isVoiding,
  } = useVoidClosure({
    currentSucursalId: currentSucursal?.id ?? null,
    organizationId: organization?.id ?? '',
    userId: user?.id ?? '',
    userFullName: profile?.full_name || user?.email || 'Usuario',
    userEmail: user?.email || '',
    onSuccess: () => fetchRecords(),
  });

  useEffect(() => {
    if (open) {
      fetchRecords();
    }
  }, [open, fetchRecords]);

  const records = readState.data ?? [];
  const loading = readState.phase === 'loading';
  const loadFailed = readState.phase === 'error';
  const showSkeleton = useDelayedVisible(loading);

  const clearFilters = () => {
    setSelectedBarber('all');
    setStartDate(undefined);
    setEndDate(undefined);
  };

  const hasFilters = selectedBarber !== 'all' || startDate || endDate;

  const barberOptions = barbers.map(b => ({
    id: b.id,
    name: `${b.firstName} ${b.lastName}`
  }));

  return (
    <>
      {externalOpen === undefined && (
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <History className="h-4 w-4 mr-2" />
          Historial
        </Button>
      )}

      <DrawerForm
        open={open}
        onOpenChange={setOpen}
        title="Historial de cierres de caja"
        size="lg"
        footer={
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cerrar
          </Button>
        }
      >
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 pb-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Filtros:</span>
          </div>

          <Select value={selectedBarber} onValueChange={setSelectedBarber}>
            <SelectTrigger className="w-[180px]">
              <User className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Todos los barberos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los barberos</SelectItem>
              {barberOptions.map((barber) => (
                <SelectItem key={barber.id} value={barber.id}>{barber.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="min-w-[130px]">
                <CalendarIcon className="h-4 w-4 mr-2" />
                {startDate ? format(startDate, 'dd/MM/yy') : 'Desde'}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={startDate}
                onSelect={setStartDate}
                locale={es}
                initialFocus
              />
            </PopoverContent>
          </Popover>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="min-w-[130px]">
                <CalendarIcon className="h-4 w-4 mr-2" />
                {endDate ? format(endDate, 'dd/MM/yy') : 'Hasta'}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={endDate}
                onSelect={setEndDate}
                locale={es}
                initialFocus
              />
            </PopoverContent>
          </Popover>

          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <X className="h-4 w-4 mr-1" />
              Limpiar
            </Button>
          )}
        </div>

        {/* Records List */}
        <div className="space-y-3 pt-4">
          {loading ? (
            showSkeleton ? (
              <>
                {Array.from({ length: 3 }).map((_, i) => (
                  <Card key={i} className="border border-border">
                    <CardContent className="p-4">
                      <SkeletonRow />
                    </CardContent>
                  </Card>
                ))}
              </>
            ) : null
          ) : loadFailed ? (
            <InlineReadError message="No pudimos cargar el historial." onRetry={readState.retry} />
          ) : records.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-8 text-center">
              <History className="h-8 w-8 text-muted-foreground/50" />
              <div>
                <p className="text-sm font-medium">Todavía no hay cierres de caja.</p>
                <p className="text-xs text-muted-foreground mt-1">Los cierres registrados aparecerán aquí.</p>
              </div>
            </div>
          ) : (
            records.map((record) => (
              <Card key={record.id} className="border border-border">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                        <span className="text-sm font-bold text-primary">
                          {record.barbero?.charAt(0).toUpperCase() || '?'}
                        </span>
                      </div>
                      <div>
                        <p className="font-medium text-foreground">{record.barbero || 'Sin barbero'}</p>
                        <p className="text-sm text-muted-foreground capitalize">
                          {record.dia} • {format(new Date(record.created_at), "d 'de' MMMM yyyy", { locale: es })}
                        </p>
                        {record.closed_at && record.closed_at !== record.created_at && (
                          <p className="text-xs text-muted-foreground/70">
                            Registrado el {format(new Date(record.closed_at), "d 'de' MMMM yyyy 'a las' HH:mm", { locale: es })}
                          </p>
                        )}
                        {record.entry_mode === 'diferido' && record.backfilled_at && (
                          <p className="text-xs text-primary/70">
                            Diferido el {format(new Date(record.backfilled_at), "d 'de' MMMM yyyy 'a las' HH:mm", { locale: es })}
                            {record.backfill_reason && ` • ${record.backfill_reason}`}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {record.entry_mode === 'diferido' && (
                        <Badge variant="outline" className="text-xs border-primary/30 text-primary">
                          Diferido
                        </Badge>
                      )}
                      <StatusPill
                        status={record.estado === 'activo' ? 'success' : 'neutral'}
                        label={record.estado || 'activo'}
                      />
                      {record.estado !== 'eliminado' && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              className="flex h-7 w-7 items-center justify-center rounded-md bg-transparent hover:bg-muted border-[0.5px] border-border"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <MoreVertical className="h-4 w-4" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={(e) => {
                                e.stopPropagation();
                                setVoidingClosure({
                                  id: record.id,
                                  barberName: record.barbero || 'Sin barbero',
                                  fechaCierre: format(new Date(record.created_at), 'yyyy-MM-dd'),
                                });
                              }}
                            >
                              Anular cierre
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-4 gap-4 mt-4 pt-4 border-t border-border">
                    <div>
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Banknote className="h-3 w-3" />
                        Efectivo
                      </p>
                      <p className="font-semibold text-success">${(record.efectivo || 0).toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <CreditCard className="h-3 w-3" />
                        Digital
                      </p>
                      <p className="font-semibold text-status-info-foreground">${(record.mp || 0).toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Total</p>
                      <p className="font-semibold text-foreground">${(record.total_facturado || 0).toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Comisión</p>
                      <p className="font-semibold text-primary">${(record.sueldo || 0).toLocaleString()}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </DrawerForm>

      <VoidClosureDialog
        open={!!voidingClosure}
        voidingClosure={voidingClosure}
        voidReason={voidReason}
        onVoidReasonChange={setVoidReason}
        onConfirm={handleVoidClosure}
        onCancel={() => { setVoidingClosure(null); setVoidReason(''); }}
        isLoading={isVoiding}
      />
    </>
  );
}
