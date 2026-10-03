import { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/skeleton';
import { useDelayedVisible } from '@/hooks/useDelayedVisible';
import { TabBadge } from '@/components/ui/TabBadge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useTareas } from '@/hooks/useTareas';
import {
  Plus, Trash2, CheckCircle, Clock, XCircle, RefreshCw, AlertTriangle,
  Users, User, MapPin, CalendarDays, Repeat, Inbox, ChartSpline, ArrowLeft, Pencil, ListChecks, ClipboardList,
} from 'lucide-react';
import { format, differenceInDays } from 'date-fns';
import { es } from 'date-fns/locale';
import { Barber, getBarberDisplayName } from '@/types/barbershop';
import { TareaFormDialog } from './tareas/TareaFormDialog';
import { RecurrentesPanel } from './tareas/RecurrentesPanel';
import { getRepeatLabel } from './tareas/RepeatPicker';
import { getCustomRepeatLabel } from './tareas/CustomRepeatSheet';
import { useAuth } from '@/contexts/AuthContext';
import { useOrganization } from '@/contexts/OrganizationContext';
import { useRequirePinForAction } from '@/components/ActionPinGate';
import { useSucursal } from '@/contexts/SucursalContext';

import { getTareaVencimiento as getTareaVencHelper, getPeticionVencimiento as getPeticionVencHelper } from '@/lib/tareasVencimiento';
import { toast } from 'sonner';


interface TareasPanelProps {
  barbers: Barber[];
}

type TareaItem = ReturnType<typeof useTareas>['tareas'][number];

const ESTADO_OPTIONS_TAREA = [
  { value: 'todos', label: 'Todos los estados' },
  { value: 'pendiente', label: 'Pendiente' },
  { value: 'en_progreso', label: 'En progreso' },
  { value: 'vencida', label: 'Vencida' },
];

const ESTADO_OPTIONS_PETICION = [
  { value: 'todos', label: 'Todos los estados' },
  { value: 'pendiente', label: 'Pendiente' },
  { value: 'completada', label: 'Completada' },
  { value: 'rechazada', label: 'Rechazada' },
  { value: 'vencida', label: 'Vencida' },
];

const FECHA_OPTIONS = [
  { value: 'todas', label: 'Todas las fechas' },
  { value: 'hoy', label: 'Hoy' },
  { value: 'semana', label: 'Próximos 7 días' },
  { value: 'mes', label: 'Próximos 30 días' },
  { value: 'vencida', label: 'Vencidas' },
];

export function TareasPanel({ barbers }: TareasPanelProps) {
  const { tareas, isLoading, addTarea, updateTarea, deleteTarea } = useTareas();
  const showSkeleton = useDelayedVisible(isLoading);
  const { canManageConfig, isOwner, isGeneralManager, isManager, isBarber, isSucursalAccount, profile } = useAuth();
  const { organization } = useOrganization();
  const { currentSucursal, sucursales } = useSucursal();
  const requirePinForAction = useRequirePinForAction();

  const canManageTareas = isOwner || isGeneralManager || isManager;
  const canViewRecurrentes = canManageTareas || isSucursalAccount;
  const tareasDiasDefault = organization?.tareas_vencimiento_dias_default ?? 1;
  const peticionesDiasDefault = organization?.peticiones_vencimiento_dias ?? 60;


  const [showForm, setShowForm] = useState(false);
  const [editingTarea, setEditingTarea] = useState<TareaItem | null>(null);
  const [activeTab, setActiveTab] = useState('tareas');
  const [filtroEstado, setFiltroEstado] = useState('todos');
  const [filtroResp, setFiltroResp] = useState('todos');
  const [filtroFecha, setFiltroFecha] = useState('todas');
  const [filtroSucursal, setFiltroSucursal] = useState('todas');
  const [showCompletedHistory, setShowCompletedHistory] = useState(false);
  const [showRecurrencias, setShowRecurrencias] = useState(false);

  const [peticionCreador, setPeticionCreador] = useState<{ nombre: string; barberoId: string } | null>(null);

  const isTareasTab = activeTab === 'tareas';

  const showSucursalFilter = !currentSucursal && sucursales.length > 1;
  const activeBarbers = barbers.filter(b => b.active);
  const myBarberoId = profile?.barbero_id ?? null;

  const getPeticionVencimiento = (t: TareaItem) =>
    getPeticionVencHelper(t, peticionesDiasDefault);

  const getTareaVencimiento = (t: TareaItem) =>
    getTareaVencHelper(t, tareasDiasDefault);

  const matchesFecha = (t: TareaItem) => {
    if (filtroFecha === 'todas') return true;
    const fechaRef = t.fecha_inicio ?? t.fecha_limite;
    if (filtroFecha === 'vencida') {
      // Estado persistido por backend (process_vencimientos_tareas).
      if (t.estado === 'vencida') return true;
      // Fallback visual durante la ventana <1h entre vencimiento real y cron.
      if (t.tipo === 'peticion' && t.estado === 'pendiente') {
        return getPeticionVencimiento(t).vencida;
      }
      if (t.tipo === 'tarea' && t.estado === 'pendiente') {
        return getTareaVencimiento(t).vencida;
      }
      return false;
    }
    if (!fechaRef) return false;
    const diff = differenceInDays(new Date(fechaRef), new Date());
    if (filtroFecha === 'hoy') return diff === 0;
    if (filtroFecha === 'semana') return diff >= 0 && diff <= 7;
    if (filtroFecha === 'mes') return diff >= 0 && diff <= 30;
    return true;
  };

  const matchesResp = (t: TareaItem) => {
    if (filtroResp === 'todos') return true;
    if (filtroResp === '__team__') return t.assignment_scope === 'team';
    return t.asignado_a_id === filtroResp;
  };

  const matchesSucursal = (t: TareaItem) => {
    if (!showSucursalFilter || filtroSucursal === 'todas') return true;
    return t.sucursal_id === filtroSucursal;
  };

  const tareasFiltradas = useMemo(() => tareas.filter(t => {
    // Excluir SIEMPRE completadas de la vista operativa de tareas (las peticiones se filtran abajo).
    if (t.tipo === 'tarea' && t.estado === 'completada') return false;
    if (filtroEstado !== 'todos') {
      if (filtroEstado === 'vencida') {
        if (t.estado === 'vencida') {
          // ok
        } else {
          const peticionVencida = t.tipo === 'peticion' && t.estado === 'pendiente' && getPeticionVencimiento(t).vencida;
          const tareaVencida = t.tipo === 'tarea' && t.estado === 'pendiente' && getTareaVencimiento(t).vencida;
          if (!peticionVencida && !tareaVencida) return false;
        }
      } else if (t.estado !== filtroEstado) return false;
    }
    return matchesFecha(t) && matchesSucursal(t) && (t.tipo === 'peticion' || matchesResp(t));
  }), [tareas, filtroEstado, filtroFecha, filtroResp, filtroSucursal]);

  const tareasAdmin = tareasFiltradas.filter(t => t.tipo === 'tarea');
  const peticiones = tareasFiltradas.filter(t => t.tipo === 'peticion');

  const tareasCompletadas = useMemo(() => tareas.filter(t => {
    if (t.tipo !== 'tarea' || t.estado !== 'completada') return false;
    return matchesSucursal(t) && matchesResp(t);
  }), [tareas, filtroResp, filtroSucursal]);

  const getRepeatDisplay = (t: TareaItem) => {
    if (!t.recurrente) return null;
    if (t.repeat_preset === 'custom') {
      return getCustomRepeatLabel(t.repeat_frequency, t.repeat_interval, t.repeat_byweekday);
    }
    if (t.repeat_preset) return getRepeatLabel(t.repeat_preset);
    return 'Recurrente';
  };

  const sucursalNombre = (id: string | null) =>
    id ? (sucursales.find(s => s.id === id)?.nombre ?? null) : null;

  const renderEstadoBadge = (t: TareaItem) => {
    // Estado persistido por backend tiene prioridad sobre el cálculo visual.
    if (t.estado === 'vencida') {
      return <Badge variant="outline" className="text-status-warning-foreground border-status-warning bg-status-warning-bg gap-1"><AlertTriangle className="w-3 h-3" />Vencida</Badge>;
    }
    if (t.tipo === 'peticion' && t.estado === 'pendiente') {
      const { vencida, diasRestantes } = getPeticionVencimiento(t);
      if (vencida) return <Badge variant="outline" className="text-status-warning-foreground border-status-warning bg-status-warning-bg gap-1"><AlertTriangle className="w-3 h-3" />Vencida</Badge>;
      if (diasRestantes !== null && diasRestantes <= 7) return <Badge variant="outline" className="text-status-warning-foreground border-status-warning bg-status-warning-bg gap-1"><Clock className="w-3 h-3" />Vence en {diasRestantes}d</Badge>;
    }
    if (t.tipo === 'tarea' && t.estado === 'pendiente' && getTareaVencimiento(t).vencida) {
      return <Badge variant="outline" className="text-status-warning-foreground border-status-warning bg-status-warning-bg gap-1"><AlertTriangle className="w-3 h-3" />Vencida</Badge>;
    }
    switch (t.estado) {
      case 'pendiente': return <Badge variant="outline" className="text-status-warning-foreground border-status-warning bg-status-warning-bg gap-1"><Clock className="w-3 h-3" />Pendiente</Badge>;
      case 'en_progreso': return <Badge variant="outline" className="text-status-info-foreground border-status-info bg-status-info-bg gap-1"><RefreshCw className="w-3 h-3" />En progreso</Badge>;
      case 'completada': return <Badge variant="outline" className="text-status-success-foreground border-status-success bg-status-success-bg gap-1"><CheckCircle className="w-3 h-3" />Completada</Badge>;
      case 'rechazada': return <Badge variant="outline" className="text-status-error-foreground border-status-error bg-status-error-bg gap-1"><XCircle className="w-3 h-3" />Rechazada</Badge>;
      default: return <Badge variant="outline">{t.estado}</Badge>;
    }
  };

  // PIN flows: delegados a requirePinForAction (bypass automático para cuentas personales).
  const handleNuevaTarea = () => { setEditingTarea(null); setPeticionCreador(null); setShowForm(true); };
  const handleEditTarea = (t: TareaItem) => { setEditingTarea(t); setPeticionCreador(null); setShowForm(true); };

  const handleNuevaPeticion = async () => {
    const gate = await requirePinForAction('crear_tarea', currentSucursal?.id ?? null);
    if (gate.ok !== true) return;
    const nombre = gate.userName ?? profile?.full_name ?? profile?.email ?? '';
    const barberoId = gate.validatedByUserId ?? profile?.barbero_id ?? '';
    setPeticionCreador({ nombre, barberoId });
    setShowForm(true);
  };

  const requestPeticionAction = async (tareaId: string, action: string) => {
    const actionKey = action === 'completada' ? 'completar_tarea' : 'editar_tarea';
    const gate = await requirePinForAction(actionKey, currentSucursal?.id ?? null);
    if (gate.ok !== true) return;
    if (action === 'delete') deleteTarea.mutate(tareaId);
    else updateTarea.mutate({ id: tareaId, estado: action });
    if (gate.userName) toast.success(`Acción realizada por ${gate.userName}`);
  };

  // Card renderers
  const TareaCard = ({ t }: { t: TareaItem }) => {
    const isTeam = t.assignment_scope === 'team';
    const isMine = !!myBarberoId && t.asignado_a_id === myBarberoId;
    const canComplete = canManageTareas || (isBarber && !isTeam && isMine);
    const canStart = canComplete;
    const canDelete = canManageTareas;
    const sNombre = sucursalNombre(t.sucursal_id);
    const repeatTxt = getRepeatDisplay(t);

    return (
      <Card className="flex flex-col">
        <CardContent className="p-4 flex flex-col gap-3 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-medium text-sm leading-snug text-foreground line-clamp-2">{t.titulo}</h3>
            {renderEstadoBadge(t)}
          </div>

          {t.descripcion && (
            <p className="text-xs text-muted-foreground line-clamp-2">{t.descripcion}</p>
          )}

          <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-xs text-muted-foreground mt-auto">
            <span className="inline-flex items-center gap-1">
              {isTeam ? <Users className="h-3.5 w-3.5" /> : <User className="h-3.5 w-3.5" />}
              {isTeam ? 'Todo el equipo' : (t.asignado_a_nombre || 'Sin asignar')}
            </span>
            {sNombre && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" />{sNombre}
              </span>
            )}
            {(t.fecha_inicio ?? t.fecha_limite) && (
              <span className="inline-flex items-center gap-1">
                <CalendarDays className="h-3.5 w-3.5" />
                <span className="text-foreground/80">Inicio:</span>{' '}
                {format(new Date((t.fecha_inicio ?? t.fecha_limite)!), 'dd MMM', { locale: es })}
                {t.hora && <span>· {t.hora}</span>}
              </span>
            )}
            {repeatTxt && (
              <span className="inline-flex items-center gap-1">
                <Repeat className="h-3.5 w-3.5" />{repeatTxt}
              </span>
            )}
          </div>

          {(canStart || canComplete || canDelete || canManageTareas) && (
            <div className="flex items-center justify-end gap-1 pt-2 border-t border-border">
              {canStart && t.estado === 'pendiente' && (
                <Button size="sm" variant="ghost" onClick={() => updateTarea.mutate({ id: t.id, estado: 'en_progreso' })}>
                  <RefreshCw className="h-4 w-4 mr-1" />Iniciar
                </Button>
              )}
              {canComplete && (t.estado === 'pendiente' || t.estado === 'en_progreso' || t.estado === 'vencida') && (
                <Button size="sm" variant="ghost" className="text-status-success-foreground" onClick={() => updateTarea.mutate({ id: t.id, estado: 'completada' })}>
                  <CheckCircle className="h-4 w-4 mr-1" />Completar
                </Button>
              )}
              {canManageTareas && (
                <Button size="sm" variant="ghost" onClick={() => handleEditTarea(t)}>
                  <Pencil className="h-4 w-4" />
                </Button>
              )}
              {canDelete && (
                <Button size="sm" variant="ghost" className="text-destructive" onClick={() => deleteTarea.mutate(t.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  const PeticionCard = ({ t }: { t: TareaItem }) => {
    const isVencida = t.estado === 'vencida';
    const venc = t.estado === 'pendiente' ? getPeticionVencimiento(t) : null;
    const sNombre = sucursalNombre(t.sucursal_id);
    const canAct = t.estado === 'pendiente' || isVencida;
    return (
      <Card className={`flex flex-col ${venc?.vencida || isVencida ? 'opacity-70' : ''}`}>
        <CardContent className="p-4 flex flex-col gap-3 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-medium text-sm leading-snug text-foreground line-clamp-2">{t.titulo}</h3>
            {renderEstadoBadge(t)}
          </div>

          {t.descripcion && (
            <p className="text-xs text-muted-foreground line-clamp-2">{t.descripcion}</p>
          )}

          <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-xs text-muted-foreground mt-auto">
            <span className="inline-flex items-center gap-1">
              <User className="h-3.5 w-3.5" />{t.creado_por_nombre || '—'}
            </span>
            {sNombre && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" />{sNombre}
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="h-3.5 w-3.5" />
              {format(new Date(t.created_at), 'dd MMM yyyy', { locale: es })}
            </span>
            {venc && !venc.vencida && (
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />{venc.diasRestantes}d restantes
              </span>
            )}
          </div>

          {canAct && (
            <div className="flex items-center justify-end gap-1 pt-2 border-t border-border">
              <Button size="sm" variant="ghost" className="text-status-success-foreground" onClick={() => requestPeticionAction(t.id, 'completada')}>
                <CheckCircle className="h-4 w-4 mr-1" />{isVencida ? 'Aprobar' : 'Completar'}
              </Button>
              <Button size="sm" variant="ghost" className="text-destructive" onClick={() => requestPeticionAction(t.id, 'rechazada')}>
                <XCircle className="h-4 w-4 mr-1" />Rechazar
              </Button>
              {canManageConfig && (
                <Button size="sm" variant="ghost" className="text-destructive" onClick={() => requestPeticionAction(t.id, 'delete')}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  const CompletadaCard = ({ t }: { t: TareaItem }) => {
    const isTeam = t.assignment_scope === 'team';
    const sNombre = sucursalNombre(t.sucursal_id);
    const completadaAt = (t as TareaItem & { completada_at: string | null }).completada_at;
    const completadaPor = (t as TareaItem & { completada_por_nombre: string | null }).completada_por_nombre;
    return (
      <Card className="flex flex-col">
        <CardContent className="p-4 flex flex-col gap-3 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-medium text-sm leading-snug text-foreground line-clamp-2">{t.titulo}</h3>
            <Badge variant="outline" className="text-status-success-foreground border-status-success bg-status-success-bg gap-1">
              <CheckCircle className="w-3 h-3" />Completada
            </Badge>
          </div>

          {t.descripcion && (
            <p className="text-xs text-muted-foreground line-clamp-2">{t.descripcion}</p>
          )}

          <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              {isTeam ? <Users className="h-3.5 w-3.5" /> : <User className="h-3.5 w-3.5" />}
              {isTeam ? 'Todo el equipo' : (t.asignado_a_nombre || '—')}
            </span>
            {sNombre && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" />{sNombre}
              </span>
            )}
            {(t.fecha_inicio ?? t.fecha_limite) && (
              <span className="inline-flex items-center gap-1">
                <CalendarDays className="h-3.5 w-3.5" />
                {format(new Date((t.fecha_inicio ?? t.fecha_limite)!), 'dd MMM', { locale: es })}
                {t.hora && <span>· {t.hora}</span>}
              </span>
            )}
          </div>

          <div className="text-xs text-muted-foreground border-t border-border pt-2 mt-auto space-y-0.5">
            {completadaAt || completadaPor ? (
              <>
                <div className="inline-flex items-center gap-1">
                  <CheckCircle className="h-3.5 w-3.5" />
                  Completada por <span className="text-foreground font-medium">{completadaPor || '—'}</span>
                </div>
                {completadaAt && (
                  <div className="inline-flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" />
                    {format(new Date(completadaAt), "dd MMM yyyy 'a las' HH:mm", { locale: es })}
                  </div>
                )}
              </>
            ) : (
              <span className="italic">Sin registro de completado</span>
            )}
          </div>

          {canManageTareas && (
            <div className="flex items-center justify-end gap-1">
              <Button size="sm" variant="ghost" className="text-destructive" onClick={() => deleteTarea.mutate(t.id)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  if (isLoading) {
    if (!showSkeleton) return null;
    return (
      <div className="w-full max-w-4xl lg:max-w-6xl mx-auto space-y-6">
        <div className="flex items-start gap-3">
          <Skeleton className="h-10 w-10 rounded-[10px] shrink-0" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-4 w-72 max-w-full" />
          </div>
        </div>
        <Skeleton className="h-9 w-56" />
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-5 w-16 rounded-full shrink-0" />
                </div>
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-1/3" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  const estadoOptions = isTareasTab ? ESTADO_OPTIONS_TAREA : ESTADO_OPTIONS_PETICION;

  return (
    <div className="w-full max-w-4xl lg:max-w-6xl mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <PageHeader
        title="Tareas"
        icon={ClipboardList}
        subtitle={(
          <span className="block max-w-2xl">
            Gestioná las tareas internas del equipo, asigná responsables y revisá el estado de cada pendiente operativo.
          </span>
        )}
        actions={isTareasTab ? (
          <>
            {canManageTareas && !showCompletedHistory && !showRecurrencias && (
              <Button onClick={handleNuevaTarea}>
                <Plus className="h-4 w-4 mr-2" />Nueva tarea
              </Button>
            )}
            {!showRecurrencias && (showCompletedHistory ? (
              <Button variant="outline" onClick={() => setShowCompletedHistory(false)}>
                <ArrowLeft className="h-4 w-4 mr-2" />Volver a tareas activas
              </Button>
            ) : (
              <Button variant="outline" onClick={() => setShowCompletedHistory(true)}>
                <ChartSpline className="h-4 w-4 mr-2" />Historial ({tareasCompletadas.length})
              </Button>
            ))}
          </>
        ) : (
          !isBarber && (
            <Button onClick={handleNuevaPeticion}>
              <Plus className="h-4 w-4 mr-2" />Nueva petición
            </Button>
          )
        )}
        actionsLayout="inline"
      />


      <TareaFormDialog
        open={showForm}
        onOpenChange={(o) => { setShowForm(o); if (!o) setEditingTarea(null); }}
        barbers={barbers}
        onSubmit={tarea => addTarea.mutate(tarea)}
        onUpdate={(id, patch) => {
          const { id: _omit, ...rest } = patch;
          updateTarea.mutate({ id, ...rest });
        }}
        isPending={addTarea.isPending || updateTarea.isPending}
        tipo={isTareasTab ? 'tarea' : 'peticion'}
        creadorNombre={peticionCreador?.nombre}
        tarea={editingTarea}
      />

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v); setFiltroEstado('todos'); setShowCompletedHistory(false); setShowRecurrencias(false); }}>
        <TabsList variant="underline">
          <TabsTrigger value="tareas" variant="underline" className="group">
            <ListChecks className="h-4 w-4" />
            Tareas
            <TabBadge count={tareasAdmin.length} />
          </TabsTrigger>
          <TabsTrigger value="peticiones" variant="underline" className="group">
            <Inbox className="h-4 w-4" />
            Peticiones
            <TabBadge count={peticiones.length} />
          </TabsTrigger>
        </TabsList>

        {/* Filters bar */}
        <div className="flex flex-wrap gap-2 mt-4">
          {!showRecurrencias && !(isTareasTab && showCompletedHistory) && (
            <Select value={filtroEstado} onValueChange={setFiltroEstado}>
              <SelectTrigger className="w-[180px] h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {estadoOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          )}

          {!showRecurrencias && isTareasTab && (
            <Select value={filtroResp} onValueChange={setFiltroResp}>
              <SelectTrigger className="w-[200px] h-9"><SelectValue placeholder="Responsable" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos los responsables</SelectItem>
                <SelectItem value="__team__">Todo el equipo</SelectItem>
                {activeBarbers.map(b => (
                  <SelectItem key={b.id} value={b.id}>{getBarberDisplayName(b)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {!showRecurrencias && !(isTareasTab && showCompletedHistory) && (
            <Select value={filtroFecha} onValueChange={setFiltroFecha}>
              <SelectTrigger className="w-[180px] h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {FECHA_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          )}

          {!showRecurrencias && showSucursalFilter && (
            <Select value={filtroSucursal} onValueChange={setFiltroSucursal}>
              <SelectTrigger className="w-[180px] h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas las sucursales</SelectItem>
                {sucursales.map(s => <SelectItem key={s.id} value={s.id}>{s.nombre}</SelectItem>)}
              </SelectContent>
            </Select>
          )}

          {isTareasTab && canViewRecurrentes && (
            <Button
              variant={showRecurrencias ? 'secondary' : 'outline'}
              size="sm"
              className="h-9"
              onClick={() => setShowRecurrencias(v => !v)}
            >
              <Repeat className="h-4 w-4 mr-2" />Recurrencias
            </Button>
          )}
        </div>


        <TabsContent value="tareas" className="mt-4">
          {showRecurrencias ? (
            <RecurrentesPanel barbers={barbers} onClose={() => setShowRecurrencias(false)} />
          ) : showCompletedHistory ? (
            <div className="space-y-3">
              <div className="flex items-baseline justify-between">
                <h2 className="text-lg font-semibold text-foreground">Tareas completadas</h2>
                <span className="text-xs text-muted-foreground">{tareasCompletadas.length} tarea{tareasCompletadas.length === 1 ? '' : 's'}</span>
              </div>
              {tareasCompletadas.length === 0 ? (
                <Card>
                  <CardContent className="py-12">
                    <EmptyState
                      icon={Inbox}
                      title="Sin tareas completadas"
                      description="Cuando se completen tareas, vas a poder revisarlas acá con el detalle de quién y cuándo."
                    />
                  </CardContent>
                </Card>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
                  {tareasCompletadas.map(t => <CompletadaCard key={t.id} t={t} />)}
                </div>
              )}
            </div>
          ) : tareasAdmin.length === 0 ? (
            <Card>
              <CardContent className="py-12">
                <EmptyState
                  icon={Inbox}
                  title="No hay tareas activas"
                  description={canManageTareas ? 'Creá una tarea para asignarla a un barbero o a todo el equipo.' : 'Aún no tenés tareas asignadas.'}
                />
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
              {tareasAdmin.map(t => <TareaCard key={t.id} t={t} />)}
            </div>
          )}
        </TabsContent>

        <TabsContent value="peticiones" className="mt-4">
          {peticiones.length === 0 ? (
            <Card>
              <CardContent className="py-12">
                <EmptyState
                  icon={Inbox}
                  title="No hay peticiones"
                  description="Las peticiones del equipo aparecerán acá para que las gestiones."
                />
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
              {peticiones.map(t => <PeticionCard key={t.id} t={t} />)}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
