import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, CalendarClock, CheckCircle2, ChevronDown, ClipboardList, History, Inbox, ListChecks, Plus, Repeat, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonRow } from '@/components/ui/SkeletonRow';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { TabBadge } from '@/components/ui/TabBadge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useDelayedVisible } from '@/hooks/useDelayedVisible';
import { useTareas, type Tarea } from '@/hooks/useTareas';
import { useTareasRecurrentes } from '@/hooks/useTareasRecurrentes';
import { useTareasSemana } from '@/hooks/useTareasSemana';
import { useTareaResponsables, useSucursalesDeIntegrante } from '@/hooks/useTareaResponsables';
import { useOrganizationToday } from '@/hooks/useOrganizationToday';
import { useTareasAlcance } from '@/hooks/useTareasAlcance';
import { useAccionesTarea } from '@/hooks/useAccionesTarea';
import { useAgendaSemanal } from '@/hooks/useAgendaSemanal';
import { useAuth } from '@/contexts/AuthContext';
import { useOrganization } from '@/contexts/OrganizationContext';
import { useSucursal } from '@/contexts/SucursalContext';
import { useRequirePinForAction } from '@/components/ActionPinGate';
import { Barber } from '@/types/barbershop';
import { feedback } from '@/lib/feedback';
import { formatTimestampInTimezone } from '@/lib/dateUtils';
import { fetchTareaPorId, mensajeTareas } from '@/lib/tareasData';
import { consumirDestinoTareas, useDestinoTareas } from '@/lib/tareasNavegacion';
import {
  agruparTareas, coincideFiltro, esVencida, fechaDeTarea, formatDiaCorto, formatDiaLargo, formatDiaSemana, formatRangoSemana,
  puedeOperarTarea, type AlcanceTareas, type ItemAgenda, type ItemTarea, type TareaPrevista,
} from '@/lib/tareasAgenda';
import { TareasLoadError } from './tareas/TareasLoadError';
import { TareaFila, MetaCuando, MetaResponsable, MetaSucursal, type AccionMenu, type EstadoFila } from './tareas/TareaFila';
import { TareasSeccion, ListaTareas } from './tareas/TareasSeccion';
import { TareasProgresoSemanal } from './tareas/TareasProgresoSemanal';
import { TareasFiltros } from './tareas/TareasFiltros';
import { TareaDetalleDrawer, type DetalleTarea } from './tareas/TareaDetalleDrawer';
import { TareaFormDrawer, type TareaFormModo } from './tareas/TareaFormDrawer';
import { PeticionFormDrawer } from './tareas/PeticionFormDrawer';
import { TareaEliminarDialog } from './tareas/TareaEliminarDialog';
import { PeticionesLista } from './tareas/PeticionesLista';
import { RecurrentesPanel } from './tareas/RecurrentesPanel';
import { TareasHistorial } from './tareas/TareasHistorial';
import type { UltimaOcurrencia } from './tareas/RecurrenteFila';

interface TareasPanelProps {
  /** Se conserva por compatibilidad con Index; los responsables salen de la pertenencia estructural (4A). */
  barbers: Barber[];
}

type Vista = 'lista' | 'automaticas' | 'historial';

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Principal → Tareas. Responde de un vistazo: cómo viene la semana, qué está atrasado, qué hay que
 * hacer hoy, qué viene y qué quedó sin fecha. Lista vertical de filas, igual en mobile, tablet y desktop.
 */
export function TareasPanel(_props: TareasPanelProps) {
  const { isOwner, isGeneralManager, isManager, isBarber, isSucursalAccount, canManageConfig, profile, user } = useAuth();
  const { organization } = useOrganization();
  const { currentSucursal, sucursales } = useSucursal();
  const requirePinForAction = useRequirePinForAction();
  const today = useOrganizationToday();
  const timezone = organization?.timezone;

  const canManageTareas = isOwner || isGeneralManager || isManager;
  const canViewRecurrentes = canManageTareas || isSucursalAccount;
  const diasVencimiento = organization?.tareas_vencimiento_dias_default ?? 1;
  const diasPeticion = organization?.peticiones_vencimiento_dias ?? 60;
  const multiSucursal = !currentSucursal && sucursales.length > 1;
  const miBarberoId = profile?.barbero_id ?? null;

  // Barbero: sus tareas, sin selector. Cuenta de sucursal: Negocio de su sucursal, sin selector.
  // Supervisor: "Mis tareas | Negocio" solo si además trabaja como integrante (tiene barbero vinculado).
  const tieneMisTareas = canManageTareas && !!miBarberoId;
  const [alcanceElegido, elegirAlcance] = useTareasAlcance(user?.id, organization?.id);
  const alcance: AlcanceTareas = tieneMisTareas ? alcanceElegido : 'negocio';
  const personal = alcance === 'mias' || (isBarber && !canManageTareas && !isSucursalAccount);
  const usaFiltros = canManageTareas && alcance === 'negocio';

  const [activeTab, setActiveTab] = useState('tareas');
  const [vista, setVista] = useState<Vista>('lista');
  const [focoAutomatica, setFocoAutomatica] = useState<string | null>(null);
  const [filtroResp, setFiltroResp] = useState('todos');
  const [filtroSucursal, setFiltroSucursal] = useState('todas');
  const [resueltasAbiertas, setResueltasAbiertas] = useState(false);
  const [form, setForm] = useState<TareaFormModo | null>(null);
  const [peticionForm, setPeticionForm] = useState<{ creador?: string } | null>(null);
  const [detalle, setDetalle] = useState<DetalleTarea | null>(null);
  const [eliminar, setEliminar] = useState<Tarea | null>(null);
  const [resolviendoPeticion, setResolviendoPeticion] = useState<string | null>(null);
  const atencionRef = useRef<HTMLElement>(null);

  const { tareas, hasData, isLoading, error, refetch, isFetching, dataUpdatedAt, addTarea, updateTarea, deleteTarea } = useTareas();
  const recurrentes = useTareasRecurrentes(canViewRecurrentes);
  const misSucursales = useSucursalesDeIntegrante(miBarberoId, alcance === 'mias');
  const responsables = useTareaResponsables(currentSucursal?.id ?? (filtroSucursal === 'todas' ? null : filtroSucursal), usaFiltros);

  const filtrosActivos = usaFiltros && (filtroResp !== 'todos' || filtroSucursal !== 'todas');
  const filtro = {
    alcance, miBarberoId, misSucursales: misSucursales.data ?? [],
    responsable: usaFiltros ? filtroResp : 'todos', sucursal: usaFiltros && multiSucursal ? filtroSucursal : 'todas',
  };

  const peticiones = tareas.filter(t => t.tipo === 'peticion');
  const semanaQuery = useTareasSemana(today, { necesitaExistencia: hasData && !tareas.some(t => t.tipo === 'tarea') });
  const { week } = semanaQuery;
  const resueltasServidor = semanaQuery.resueltas.data;
  const previstasServidor = semanaQuery.previstas.data;
  const semanaLista = resueltasServidor !== undefined && previstasServidor !== undefined;
  const ctx = { today, week, diasVencimiento };
  // Misma definición de la semana que el aviso semanal: abiertas, Programadas, resueltas y progreso.
  const vistaSemana = useAgendaSemanal({
    tareas, tareasActualizadas: dataUpdatedAt, resueltasServidor, resueltasActualizadas: semanaQuery.resueltas.dataUpdatedAt,
    previstasServidor, filtro, ctx, timezone,
  });
  const { tareasInternas, ocultas, agenda, progreso, resueltas, resueltasSemana } = vistaSemana;
  const abiertasSinFiltro = tareasInternas.filter(t => !ocultas.has(t.id) && coincideFiltro(t, { ...filtro, responsable: 'todos', sucursal: 'todas' }));

  // Cambiar de organización, sucursal o persona descarta cualquier estado de la anterior.
  useEffect(() => {
    setDetalle(null); setEliminar(null); setForm(null); setPeticionForm(null);
    vistaSemana.reiniciar(); setFiltroResp('todos'); setFiltroSucursal('todas'); setVista('lista');
  }, [organization?.id, currentSucursal?.id, profile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Refetch fallido con datos en pantalla: se conservan y se ofrece reintentar (DESIGN → Feedback).
  useEffect(() => {
    if (error && hasData) feedback.error('No pudimos actualizar las tareas.', { retry: { id: 'tareas-lista', onRetry: () => void refetch() } });
  }, [error, hasData]); // eslint-disable-line react-hooks/exhaustive-deps
  const errorSemana = semanaQuery.resueltas.error ?? semanaQuery.previstas.error;
  useEffect(() => {
    if (errorSemana && semanaLista) feedback.error('No pudimos actualizar el progreso de la semana.', {
      retry: { id: 'tareas-semana', onRetry: () => { void semanaQuery.resueltas.refetch(); void semanaQuery.previstas.refetch(); } },
    });
  }, [errorSemana, semanaLista]); // eslint-disable-line react-hooks/exhaustive-deps

  const showSkeleton = useDelayedVisible(isLoading && !hasData);
  const sucursalNombre = (id: string | null) => (id ? sucursales.find(s => s.id === id)?.nombre ?? null : null);
  const recetaPorId = (id: string | null) => (id ? recurrentes.recetas.find(r => r.id === id) ?? null : null);
  const automaticaTitulo = (id: string | null) => recetaPorId(id)?.titulo ?? null;

  // ---------- Acciones de servidor (4A): iniciar / completar / deshacer ----------
  // Misma lógica que el aviso semanal (useAccionesTarea): el servidor decide; acá se refleja el resultado.
  const { solicitar, enCurso, pendiente: accionPendiente, pinDialog } = useAccionesTarea({
    onCompletada: (tarea, completada) => {
      vistaSemana.marcarCompletada(tarea, completada);
      setDetalle(d => (d?.kind === 'tarea' && d.tarea.id === tarea.id ? null : d));
    },
    onDeshecha: vistaSemana.desmarcarCompletada,
  });

  const operador = { supervisor: canManageTareas, cuentaSucursal: isSucursalAccount, barbero: isBarber, miBarberoId };
  const abrirAutomatica = (id: string) => {
    setDetalle(null);
    setActiveTab('tareas'); setFocoAutomatica(id); setVista('automaticas');
  };
  const editarAutomatica = (id: string) => {
    const receta = recetaPorId(id);
    if (receta && canManageTareas) setForm({ tipo: 'editar-automatica', receta });
    else abrirAutomatica(id);
  };

  // ---------- Llegada desde la campana o el aviso semanal: abrir esa tarea concreta ----------
  const [resaltada, setResaltada] = useState<string | null>(null);
  const destino = useDestinoTareas();
  const volverALista = () => { setActiveTab('tareas'); setVista('lista'); };
  const abrirTareaPuntual = async (id: string) => {
    setDetalle(null);
    let tarea: Tarea | null = tareas.find(t => t.id === id) ?? (resueltasServidor ?? []).find(t => t.id === id) ?? null;
    if (!tarea && organization?.id) {
      try {
        tarea = await fetchTareaPorId(organization.id, id);
      } catch {
        volverALista();
        feedback.error('No pudimos abrir la tarea. Buscala en la lista o reintentá.');
        return;
      }
    }
    if (!tarea) {
      // Igual si la eliminaron o si ya no es visible para este usuario: no se revela nada de ella.
      volverALista();
      feedback.info('Esa tarea ya no está disponible.', { description: 'Puede que la hayan eliminado o que ya no tengas acceso.' });
      return;
    }
    if (tarea.tipo === 'peticion') { setActiveTab('peticiones'); setResaltada(tarea.id); return; }
    volverALista();
    setDetalle({ kind: 'tarea', tarea, vencida: esVencida(tarea, diasVencimiento, today) });
    setResaltada(tarea.id);
  };
  // Programada (R1): si la ocurrencia ya existe como tarea, se abre la real; nunca ambas.
  const abrirPrevista = (recurrenciaId: string, fecha: string) => {
    const real = [...tareas, ...(resueltasServidor ?? [])].find(t => t.recurrencia_id === recurrenciaId && fechaDeTarea(t) === fecha);
    if (real) { void abrirTareaPuntual(real.id); return; }
    volverALista();
    const prevista = (previstasServidor ?? []).find(p => p.recurrencia_id === recurrenciaId && p.fecha === fecha);
    if (prevista) setDetalle({ kind: 'prevista', prevista });
    else feedback.info('Esa tarea ya no está programada.', { description: 'Puede que la Tarea automática se haya pausado o cambiado.' });
  };
  useEffect(() => {
    if (!destino || !organization?.id) return;
    // Una Programada se busca en la semana ya leída: se espera esa lectura (si falla, queda la lista).
    if (destino.tipo === 'prevista' && !semanaLista && !errorSemana) return;
    const pedido = consumirDestinoTareas();
    if (!pedido) return;
    setForm(null); setEliminar(null);
    if (pedido.tipo === 'tarea') void abrirTareaPuntual(pedido.id);
    else if (pedido.tipo === 'prevista' && semanaLista) abrirPrevista(pedido.recurrenciaId, pedido.fecha);
    else if (pedido.tipo === 'automatica' && canViewRecurrentes) abrirAutomatica(pedido.id);
    else volverALista();
  }, [destino, organization?.id, semanaLista, errorSemana]); // eslint-disable-line react-hooks/exhaustive-deps
  // Orientación breve sobre la fila (si está en la vista actual); sin movimiento si así lo pide el sistema.
  useEffect(() => {
    if (!resaltada) return;
    const reducir = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    document.getElementById(`tarea-${resaltada}`)?.scrollIntoView({ block: 'center', behavior: reducir ? 'auto' : 'smooth' });
    const t = window.setTimeout(() => setResaltada(null), 2600);
    return () => window.clearTimeout(t);
  }, [resaltada, hasData]);

  // ---------- Construcción de filas ----------
  const metaComun = (scope: string, asignadoId: string | null, nombre: string | null, sucursalId: string | null): ReactNode[] => {
    const meta: ReactNode[] = [];
    const propia = personal && scope !== 'team' && !!miBarberoId && asignadoId === miBarberoId;
    if (!propia) meta.push(<MetaResponsable key="resp" equipo={scope === 'team'} nombre={nombre} />);
    const suc = multiSucursal && !(usaFiltros && filtroSucursal !== 'todas') ? sucursalNombre(sucursalId) : null;
    if (suc) meta.push(<MetaSucursal key="suc" nombre={suc} />);
    return meta;
  };
  const conHora = (texto: string, hora: string | null) => (hora ? `${texto} · ${hora}` : texto);

  const menuTarea = (t: Tarea, abrir: () => void): AccionMenu[] => [
    { label: 'Ver detalle', onSelect: abrir },
    ...(canManageTareas && t.estado !== 'completada' ? [{ label: 'Editar', onSelect: () => setForm({ tipo: 'editar-tarea', tarea: t }) }] : []),
    ...(t.recurrencia_id && canViewRecurrentes ? [{ label: 'Ver Tarea automática', onSelect: () => abrirAutomatica(t.recurrencia_id!) }] : []),
    ...(canManageTareas ? [{ label: 'Eliminar', onSelect: () => setEliminar(t), destructive: true }] : []),
  ];

  const filaPrevista = (p: TareaPrevista, seccion: 'hoy' | 'proximas') => (
    <TareaFila key={`prevista:${p.recurrencia_id}:${p.fecha}`} titulo={p.titulo} descripcion={p.descripcion} estado="programada" automatica
      meta={[
        ...(seccion === 'proximas' ? [<MetaCuando key="cuando" texto={conHora(formatDiaCorto(p.fecha), p.hora)} />] : p.hora ? [<MetaCuando key="cuando" texto={p.hora} />] : []),
        ...metaComun(p.assignment_scope, p.asignado_a_id, p.asignado_a_nombre, p.sucursal_id),
      ]}
      onAbrir={() => setDetalle({ kind: 'prevista', prevista: p })}
      menu={canViewRecurrentes ? [{ label: 'Ver Tarea automática', onSelect: () => abrirAutomatica(p.recurrencia_id) }] : []} />
  );

  const filaTarea = (item: ItemTarea, seccion: 'atencion' | 'hoy' | 'proximas' | 'sinFecha') => {
    const t = item.tarea;
    const enProgreso = t.estado === 'en_progreso';
    const estado: EstadoFila = item.vencida ? (enProgreso ? 'en_progreso_vencida' : 'vencida') : enProgreso ? 'en_progreso' : 'pendiente';
    const fecha = fechaDeTarea(t);
    const meta: ReactNode[] = [];
    if (seccion === 'atencion' && fecha) meta.push(<MetaCuando key="cuando" texto={conHora(formatDiaCorto(fecha), t.hora)} />);
    if (seccion === 'proximas' && fecha) meta.push(<MetaCuando key="cuando" texto={conHora(formatDiaCorto(fecha), t.hora)} />);
    if (seccion === 'hoy') {
      if (item.desde) meta.push(<MetaCuando key="cuando" texto={conHora(`Desde el ${formatDiaSemana(item.desde)}`, t.hora)} />);
      else if (t.hora) meta.push(<MetaCuando key="cuando" texto={t.hora} />);
      if (item.diasParaVencer === 0) meta.push(<MetaCuando key="vence" texto="Vence hoy" destacar />);
    }
    if (seccion === 'sinFecha') meta.push(<span key="creada">Creada el {formatTimestampInTimezone(t.created_at, timezone, false)}</span>);
    meta.push(...metaComun(t.assignment_scope, t.asignado_a_id, t.asignado_a_nombre, t.sucursal_id));
    const abrir = () => setDetalle({ kind: 'tarea', tarea: t, vencida: item.vencida });
    const actua = puedeOperarTarea(t, operador);
    return (
      <TareaFila key={t.id} titulo={t.titulo} descripcion={t.descripcion} estado={estado} meta={meta} automatica={!!t.recurrencia_id}
        onAbrir={abrir}
        onCompletar={actua ? () => solicitar({ id: t.id, version: t.accion_version!, accion: 'completar' }, t) : undefined}
        onIniciar={actua && !enProgreso ? () => solicitar({ id: t.id, version: t.accion_version!, accion: 'iniciar' }, t) : undefined}
        enCurso={enCurso(t.id)} bloqueada={accionPendiente} menu={menuTarea(t, abrir)} domId={t.id} resaltada={resaltada === t.id} />
    );
  };
  const fila = (item: ItemAgenda, seccion: 'hoy' | 'proximas') =>
    (item.kind === 'prevista' ? filaPrevista(item.prevista, seccion) : filaTarea(item, seccion));

  const metaCompletada = (t: Tarea): ReactNode[] => [
    <span key="por" className="inline-flex items-center gap-1">
      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
      {t.completada_por_nombre || 'Alguien del equipo'}{t.completada_at ? ` · ${formatTimestampInTimezone(t.completada_at, timezone)}` : ''}
    </span>,
    ...metaComun(t.assignment_scope, t.asignado_a_id, t.asignado_a_nombre, t.sucursal_id),
  ];
  const filaCompletada = (t: Tarea) => {
    const abrir = () => setDetalle({ kind: 'tarea', tarea: t, vencida: false });
    return <TareaFila key={t.id} titulo={t.titulo} descripcion={t.descripcion} estado="completada" automatica={!!t.recurrencia_id}
      meta={metaCompletada(t)} onAbrir={abrir} menu={menuTarea(t, abrir)} domId={t.id} resaltada={resaltada === t.id} />;
  };

  // ---------- Peticiones ----------
  const handleNuevaPeticion = async () => {
    const gate = await requirePinForAction('crear_tarea', currentSucursal?.id ?? null);
    if (gate.ok !== true) return;
    setPeticionForm({ creador: gate.userName ?? profile?.full_name ?? profile?.email ?? undefined });
  };
  const resolverPeticion = async (t: Tarea, estado: 'completada' | 'rechazada') => {
    const gate = await requirePinForAction(estado === 'completada' ? 'completar_tarea' : 'editar_tarea', currentSucursal?.id ?? null);
    if (gate.ok !== true) return;
    setResolviendoPeticion(t.id);
    try {
      await updateTarea.mutateAsync({ id: t.id, estado });
      // Solo después de confirmar el guardado, con quien la resolvió si validó PIN.
      feedback.success(`${estado === 'completada' ? 'Petición resuelta' : 'Petición rechazada'}${gate.userName ? ` por ${gate.userName}` : ''}`);
    } catch (e) {
      feedback.error(mensajeTareas(e, 'No pudimos actualizar la petición. Reintentá.'));
    } finally {
      setResolviendoPeticion(null);
    }
  };
  const confirmarEliminar = async () => {
    if (!eliminar) return;
    const esPeticion = eliminar.tipo === 'peticion';
    if (esPeticion) {
      const gate = await requirePinForAction('editar_tarea', currentSucursal?.id ?? null);
      if (gate.ok !== true) return;
    }
    try {
      await deleteTarea.mutateAsync(eliminar.id);
      feedback.success(esPeticion ? 'Petición eliminada' : 'Tarea eliminada');
      setDetalle(d => (d?.kind === 'tarea' && d.tarea.id === eliminar.id ? null : d));
      setEliminar(null);
    } catch (e) {
      feedback.error(mensajeTareas(e, esPeticion ? 'No pudimos eliminar la petición. Reintentá.' : 'No pudimos eliminar la tarea. Reintentá.'));
    }
  };

  // ---------- Detalle con datos frescos ----------
  const detalleVigente: DetalleTarea | null = (() => {
    if (detalle?.kind !== 'tarea') return detalle;
    const fresca = tareas.find(t => t.id === detalle.tarea.id) ?? resueltas.find(t => t.id === detalle.tarea.id);
    if (!fresca) return detalle;
    const item = agenda.atencion.find(i => i.tarea.id === fresca.id);
    return { kind: 'tarea', tarea: fresca, vencida: item?.vencida ?? detalle.vencida };
  })();
  const tareaDetalle = detalleVigente?.kind === 'tarea' ? detalleVigente.tarea : null;
  const detalleAbierta = !!tareaDetalle && tareaDetalle.tipo === 'tarea' && ['pendiente', 'en_progreso', 'vencida'].includes(tareaDetalle.estado);
  const detalleActua = !!tareaDetalle && detalleAbierta && puedeOperarTarea(tareaDetalle, operador);
  const recurrenciaDetalle = tareaDetalle?.recurrencia_id ?? (detalleVigente?.kind === 'prevista' ? detalleVigente.prevista.recurrencia_id : null);

  const ultimaOcurrencia = (recurrenciaId: string): UltimaOcurrencia | null => {
    const candidatas = [...tareasInternas, ...resueltas].filter(t => t.recurrencia_id === recurrenciaId);
    if (!candidatas.length) return null;
    const ultima = candidatas.sort((a, b) => (fechaDeTarea(b) ?? '').localeCompare(fechaDeTarea(a) ?? ''))[0];
    const fecha = fechaDeTarea(ultima);
    const vencida = agruparTareas([ultima], [], ctx).atencion.some(i => i.vencida);
    const estado = ultima.estado === 'completada' ? 'completada' : vencida ? 'vencida' : ultima.estado === 'en_progreso' ? 'en progreso' : 'pendiente';
    return { fecha, texto: `${estado}${fecha ? ` (${formatDiaCorto(fecha)})` : ''}` };
  };

  // ---------- Render ----------
  if (isLoading && !hasData) {
    if (!showSkeleton) return null;
    return (
      <div className="w-full space-y-6" aria-busy="true">
        <div className="flex items-start gap-3">
          <Skeleton className="h-10 w-10 shrink-0 rounded-[10px]" />
          <div className="space-y-2"><Skeleton className="h-6 w-28" /><Skeleton className="h-4 w-64 max-w-full" /></div>
        </div>
        <Skeleton className="h-9 w-56" />
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <Skeleton className="h-[5.25rem] w-full rounded-xl xl:col-start-2 xl:row-start-1" />
          <div className="space-y-2 xl:col-start-1 xl:row-start-1">
            <Skeleton className="h-4 w-24" />
            <ListaTareas>{Array.from({ length: 5 }).map((_, i) => <li key={i} className="px-3 py-3 sm:px-4"><SkeletonRow /></li>)}</ListaTareas>
          </div>
        </div>
      </div>
    );
  }

  const isTareasTab = activeTab === 'tareas';
  const peticionesAbiertas = peticiones.filter(p => p.estado === 'pendiente' || p.estado === 'vencida').length;
  const hayAgenda = agenda.atencion.length + agenda.hoy.length + agenda.proximas.length + agenda.sinFecha.length > 0;
  const hayAlgoEstaSemana = hayAgenda || resueltasSemana.length > 0;
  const existeHistorial = semanaQuery.existeHistorial.data === true || recurrentes.recetas.length > 0;

  const accionesHeader = isTareasTab ? (vista === 'lista' && (
    <>
      {canViewRecurrentes && (
        <Button type="button" variant="outline" onClick={() => { setFocoAutomatica(null); setVista('automaticas'); }}>
          <Repeat aria-hidden />Tareas automáticas
        </Button>
      )}
      {canManageTareas && <Button type="button" onClick={() => setForm({ tipo: 'nueva' })}><Plus aria-hidden />Nueva tarea</Button>}
    </>
  )) : !isBarber && <Button type="button" onClick={() => void handleNuevaPeticion()}><Plus aria-hidden />Nueva petición</Button>;

  const barraAlcance = (tieneMisTareas || usaFiltros) && (
    <div className="flex flex-wrap items-center gap-2">
      {tieneMisTareas && (
        <SegmentedControl ariaLabel="Qué tareas ver" className="w-auto min-w-[14rem] flex-1 sm:flex-none" value={alcance}
          onChange={v => elegirAlcance(v as AlcanceTareas)}
          options={[{ value: 'mias', label: 'Mis tareas' }, { value: 'negocio', label: 'Negocio' }]} />
      )}
      {usaFiltros && (
        <TareasFiltros responsable={filtroResp} onResponsable={setFiltroResp} responsables={responsables.data ?? []}
          sucursales={multiSucursal ? sucursales.map(s => ({ id: s.id, nombre: s.nombre })) : null}
          sucursal={filtroSucursal} onSucursal={v => { setFiltroSucursal(v); setFiltroResp('todos'); }}
          onQuitar={() => { setFiltroResp('todos'); setFiltroSucursal('todas'); }} />
      )}
    </div>
  );

  let listaTareas: ReactNode;
  if (!hasData) {
    listaTareas = error ? <TareasLoadError subject="las tareas" retry={refetch} pending={isFetching} /> : null;
  } else if (!hayAgenda && !semanaLista) {
    listaTareas = null; // espera la semana para no confundir "todo al día" con "sin tareas".
  } else if (!hayAgenda) {
    if (filtrosActivos) {
      listaTareas = <FiltroVacio onQuitar={() => { setFiltroResp('todos'); setFiltroSucursal('todas'); }} />;
    } else if (alcance === 'mias') {
      listaTareas = (
        <p className="px-1 py-2 text-sm text-muted-foreground">
          No tenés tareas pendientes.{' '}
          <Button type="button" variant="link" className="h-auto p-0" onClick={() => elegirAlcance('negocio')}>Ver Negocio</Button>
        </p>
      );
    } else if (abiertasSinFiltro.length > 0 || resueltasSemana.length > 0 || existeHistorial || semanaQuery.existeHistorial.isLoading) {
      listaTareas = semanaQuery.existeHistorial.isLoading && !existeHistorial && resueltasSemana.length === 0 ? null : (
        <div className="rounded-xl border border-border bg-card py-10 shadow-sm">
          <EmptyState icon={Sun} title="Todo al día" description="No hay nada pendiente. Cuando haya una tarea nueva, aparece acá." />
        </div>
      );
    } else {
      listaTareas = (
        <div className="rounded-xl border border-border bg-card py-12 shadow-sm">
          {canManageTareas ? (
            <EmptyState icon={ClipboardList} title="Organizá el trabajo del local"
              description="Asigná pendientes a una persona o a todo el equipo, y dejá como Tareas automáticas las que se repiten: Vittro las crea solas en cada fecha."
              action={(
                <div className="flex flex-wrap justify-center gap-2">
                  <Button type="button" onClick={() => setForm({ tipo: 'nueva' })}><Plus aria-hidden />Nueva tarea</Button>
                  <Button type="button" variant="outline" onClick={() => setForm({ tipo: 'nueva', automatica: true })}><Repeat aria-hidden />Nueva Tarea automática</Button>
                </div>
              )} />
          ) : (
            <EmptyState icon={ClipboardList} title="Todavía no hay tareas" description="Cuando te asignen una tarea, la vas a ver acá." />
          )}
        </div>
      );
    }
  } else {
    listaTareas = (
      <div className="space-y-6">
        {agenda.atencion.length > 0 && (
          <TareasSeccion ref={atencionRef} id="tareas-atencion" titulo="Necesitan atención" cantidad={agenda.atencion.length} icon={AlertTriangle} tono="atencion">
            <ListaTareas>{agenda.atencion.map(i => filaTarea(i, 'atencion'))}</ListaTareas>
          </TareasSeccion>
        )}
        <TareasSeccion id="tareas-hoy" titulo="Hoy" contexto={capital(formatDiaLargo(today))} cantidad={agenda.hoy.length || undefined}>
          {agenda.hoy.length > 0 ? <ListaTareas>{agenda.hoy.map(i => fila(i, 'hoy'))}</ListaTareas> : (
            <p className="px-1 py-2 text-sm text-muted-foreground">Nada pendiente para hoy.</p>
          )}
        </TareasSeccion>
        {agenda.proximas.length > 0 && (
          <TareasSeccion id="tareas-proximas" titulo="Próximas" cantidad={agenda.proximas.length} icon={CalendarClock}>
            <ListaTareas>{agenda.proximas.map(i => fila(i, 'proximas'))}</ListaTareas>
          </TareasSeccion>
        )}
        {agenda.sinFecha.length > 0 && (
          <TareasSeccion id="tareas-sin-fecha" titulo="Sin fecha" contexto="Las más antiguas primero" cantidad={agenda.sinFecha.length}>
            <ListaTareas>{agenda.sinFecha.map(i => filaTarea(i, 'sinFecha'))}</ListaTareas>
          </TareasSeccion>
        )}
      </div>
    );
  }

  // En el primer uso (sin historial ni nada esta semana) no suma: el vacío ya explica qué hacer.
  const seccionResueltas = hasData && (hayAlgoEstaSemana || existeHistorial) && (
    <Collapsible open={resueltasAbiertas} onOpenChange={setResueltasAbiertas} className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <h2 className="text-sm font-semibold text-foreground">
          <CollapsibleTrigger asChild>
            <button type="button" className="hit-area-expand inline-flex items-center gap-1.5 rounded-md py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${resueltasAbiertas ? 'rotate-180' : ''}`} aria-hidden />
              Resueltas esta semana
              <span className="font-normal tabular-nums text-muted-foreground">· {resueltasSemana.length}</span>
            </button>
          </CollapsibleTrigger>
        </h2>
        <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setVista('historial')}>
          <History aria-hidden />Ver historial
        </Button>
      </div>
      <CollapsibleContent>
        {resueltasSemana.length > 0 ? <ListaTareas>{resueltasSemana.map(filaCompletada)}</ListaTareas> : (
          <p className="px-1 py-2 text-sm text-muted-foreground">Todavía no se completó ninguna tarea esta semana.</p>
        )}
      </CollapsibleContent>
    </Collapsible>
  );

  const bloqueProgreso = hasData && (hayAlgoEstaSemana || progreso.anteriores > 0) && (
    semanaLista ? (
      <TareasProgresoSemanal progreso={progreso} rango={formatRangoSemana(week)}
        onVerAtencion={agenda.atencion.length ? () => atencionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) : undefined} />
    ) : errorSemana ? (
      <TareasLoadError subject="el progreso de la semana" compact
        retry={() => { void semanaQuery.resueltas.refetch(); void semanaQuery.previstas.refetch(); }} />
    ) : <Skeleton className="h-[5.25rem] w-full rounded-xl" />
  );

  return (
    <div className="w-full space-y-6 animate-fade-in">
      <PageHeader title="Tareas" icon={ClipboardList} actionsLayout="inline" actions={accionesHeader || undefined}
        subtitle="El trabajo del local, día a día." />

      <Tabs value={activeTab} onValueChange={v => { setActiveTab(v); setVista('lista'); }}>
        <TabsList variant="underline">
          <TabsTrigger value="tareas" variant="underline" className="group">
            <ListChecks className="h-4 w-4" aria-hidden />Tareas<TabBadge count={tareasInternas.filter(t => !ocultas.has(t.id) && coincideFiltro(t, filtro)).length} />
          </TabsTrigger>
          <TabsTrigger value="peticiones" variant="underline" className="group">
            <Inbox className="h-4 w-4" aria-hidden />Peticiones<TabBadge count={peticionesAbiertas} />
          </TabsTrigger>
        </TabsList>

        <TabsContent value="tareas" className="mt-5">
          {vista === 'automaticas' ? (
            <RecurrentesPanel recurrentes={recurrentes} today={today} focoId={focoAutomatica} ultimaOcurrencia={ultimaOcurrencia}
              onVolver={() => { setVista('lista'); setFocoAutomatica(null); }}
              onNueva={canManageTareas ? () => setForm({ tipo: 'nueva', automatica: true }) : undefined}
              onEditar={receta => setForm({ tipo: 'editar-automatica', receta })} />
          ) : vista === 'historial' ? (
            <TareasHistorial onVolver={() => setVista('lista')}
              filtros={canManageTareas ? { responsables: responsables.data ?? [], sucursales: multiSucursal ? sucursales.map(s => ({ id: s.id, nombre: s.nombre })) : null } : null}
              metaDe={metaCompletada} onAbrir={t => setDetalle({ kind: 'tarea', tarea: t, vencida: false })}
              menuDe={t => menuTarea(t, () => setDetalle({ kind: 'tarea', tarea: t, vencida: false }))} />
          ) : (
            <div className="space-y-5">
              {barraAlcance}
              <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
                {bloqueProgreso && <div className="xl:sticky xl:top-4 xl:col-start-2 xl:row-start-1">{bloqueProgreso}</div>}
                <div className="min-w-0 space-y-6 xl:col-start-1 xl:row-start-1">
                  {listaTareas}
                  {seccionResueltas}
                </div>
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="peticiones" className="mt-5">
          <PeticionesLista peticiones={peticiones} hasData={hasData} error={error} onReintentar={() => void refetch()} timezone={timezone}
            diasDefault={diasPeticion} sucursales={multiSucursal ? sucursales.map(s => ({ id: s.id, nombre: s.nombre })) : null}
            sucursalNombre={id => (multiSucursal ? sucursalNombre(id) : null)} puedeEliminar={canManageConfig}
            onResolver={resolverPeticion} onEliminar={setEliminar} resolviendo={resolviendoPeticion} resaltadaId={resaltada} />
        </TabsContent>
      </Tabs>

      <TareaDetalleDrawer detalle={detalleVigente} onClose={() => setDetalle(null)} sucursalNombre={sucursalNombre} timezone={timezone}
        diasVencimiento={diasVencimiento} automaticaTitulo={automaticaTitulo(recurrenciaDetalle)}
        enCurso={tareaDetalle ? enCurso(tareaDetalle.id) : null} bloqueada={accionPendiente}
        onCompletar={detalleActua ? () => solicitar({ id: tareaDetalle!.id, version: tareaDetalle!.accion_version!, accion: 'completar' }, tareaDetalle!) : undefined}
        onIniciar={detalleActua && tareaDetalle!.estado !== 'en_progreso' ? () => solicitar({ id: tareaDetalle!.id, version: tareaDetalle!.accion_version!, accion: 'iniciar' }, tareaDetalle!) : undefined}
        onEditar={canManageTareas && tareaDetalle && detalleAbierta ? () => { setForm({ tipo: 'editar-tarea', tarea: tareaDetalle }); setDetalle(null); } : undefined}
        onVerAutomatica={recurrenciaDetalle && canViewRecurrentes ? () => abrirAutomatica(recurrenciaDetalle) : undefined} />

      <TareaFormDrawer modo={form} onClose={() => setForm(null)}
        onCrear={payload => addTarea.mutateAsync(payload)}
        onActualizarTarea={async (id, patch) => { await updateTarea.mutateAsync({ id, ...patch }); feedback.success('Tarea actualizada'); }}
        onActualizarAutomatica={patch => recurrentes.updateReceta.mutateAsync(patch)}
        automaticaTitulo={id => automaticaTitulo(id)}
        onEditarAutomatica={canViewRecurrentes ? id => { setForm(null); editarAutomatica(id); } : undefined} />

      <PeticionFormDrawer open={!!peticionForm} onClose={() => setPeticionForm(null)} creadorNombre={peticionForm?.creador}
        onCrear={payload => addTarea.mutateAsync(payload)} />

      <TareaEliminarDialog onCancelar={() => setEliminar(null)} onConfirmar={confirmarEliminar}
        objetivo={eliminar ? { titulo: eliminar.titulo, tipo: eliminar.tipo, automatica: !!eliminar.recurrencia_id, automaticaTitulo: automaticaTitulo(eliminar.recurrencia_id) } : null} />

      {pinDialog}
    </div>
  );
}

function FiltroVacio({ onQuitar }: { onQuitar: () => void }) {
  return (
    <p className="px-1 py-2 text-sm text-muted-foreground">
      Ninguna tarea coincide con los filtros.{' '}
      <Button type="button" variant="link" className="h-auto p-0" onClick={onQuitar}>Quitar filtros</Button>
    </p>
  );
}

