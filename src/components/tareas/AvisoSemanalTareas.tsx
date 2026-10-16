import { useEffect, type ReactNode } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { AlertTriangle, CheckCircle2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogOverlay, DialogPortal } from '@/components/ui/dialog';
import { useAvisoGlobal } from '@/components/avisos/AvisosGlobales';
import { useAvisoSemanalTareas, type EleccionAviso } from '@/hooks/useAvisoSemanalTareas';
import { useAccionesTarea } from '@/hooks/useAccionesTarea';
import { useSucursal } from '@/contexts/SucursalContext';
import { feedback } from '@/lib/feedback';
import { fechaDeTarea, formatDiaCorto, formatDiaSemana, formatRangoSemana, puedeOperarTarea } from '@/lib/tareasAgenda';
import { TITULO_AVISO, type ItemAviso, type MomentoAviso, type SeccionAviso } from '@/lib/tareasAvisoSemanal';
import { irATareas, type DestinoTareas } from '@/lib/tareasNavegacion';
import { TareaFila, MetaCuando, MetaResponsable, MetaSucursal, type EstadoFila } from './TareaFila';
import { ListaTareas } from './TareasSeccion';
import { TareasProgresoSemanal } from './TareasProgresoSemanal';

const BAJADA: Record<MomentoAviso, string> = {
  lunes: 'Esto es lo que tenés por delante esta semana.',
  jueves: 'Así viene la semana. Esto todavía falta.',
  sabado: 'Así termina la semana.',
};
const TITULO_LISTA: Record<MomentoAviso, string> = { lunes: 'Lo próximo', jueves: 'Lo que falta', sabado: 'Lo que queda' };

const plural = (n: number, uno: string, varios: string) => (n === 1 ? uno : varios);

/** Un clic o foco sobre un toast (p. ej. "Deshacer") no es un "clic afuera": no cierra el aviso. */
const ignorarToasts = (e: Event) => {
  if (e.target instanceof Element && e.target.closest('[data-sonner-toaster]')) e.preventDefault();
};

/**
 * Aviso semanal de Tareas: al entrar a Vittro, lunes (a miércoles), jueves (y viernes) y sábado (y domingo), según el
 * día de la organización. Montado siempre en la app principal; se abre solo cuando el coordinador de avisos globales
 * se lo asigna a esta entrada (onboarding y resumen mensual van primero; nunca dos a la vez).
 */
export function AvisoSemanalTareas({ disponible }: { disponible: boolean | null }) {
  const aviso = useAvisoSemanalTareas({ disponible });
  const { abierto, cerrar } = useAvisoGlobal('tareas', aviso.estado);
  // Vive con la app (no con el diálogo): el "Deshacer" del toast sigue funcionando después de cerrar el aviso.
  const acciones = useAccionesTarea({ onCompletada: aviso.marcarCompletada, onDeshecha: aviso.desmarcarCompletada });

  const elegir = (eleccion: EleccionAviso) => {
    cerrar();
    aviso.guardar(eleccion).catch(() => {
      feedback.error('No pudimos guardar tu elección', { description: 'Es posible que el aviso vuelva a aparecer la próxima vez.' });
    });
  };
  // Ir a Principal → Tareas no da el aviso por resuelto: cuenta como "Más tarde".
  const irA = (destino: DestinoTareas) => {
    elegir('pospuesto');
    irATareas(destino);
  };

  return (
    <>
      {abierto && (
        <AvisoSemanalDialog aviso={aviso} acciones={acciones} onListo={() => elegir('listo')} onMasTarde={() => elegir('pospuesto')} onIr={irA} />
      )}
      {acciones.pinDialog}
    </>
  );
}

interface DialogProps {
  aviso: ReturnType<typeof useAvisoSemanalTareas>;
  acciones: ReturnType<typeof useAccionesTarea>;
  onListo: () => void;
  onMasTarde: () => void;
  onIr: (destino: DestinoTareas) => void;
}

function AvisoSemanalDialog({ aviso, acciones, onListo, onMasTarde, onIr }: DialogProps) {
  const { currentSucursal, sucursales } = useSucursal();
  const { momento, contenido, progreso, week, today, personal, operador } = aviso;
  const { solicitar, enCurso, pendiente } = acciones;
  const rango = formatRangoSemana(week);
  const contexto = personal ? 'Tus tareas' : `Tareas · ${currentSucursal?.nombre ?? 'Todo el negocio'}`;
  const multiSucursal = !currentSucursal && sucursales.length > 1;

  // Mientras está abierto, los toasts (completar → "Deshacer") siguen siendo tocables.
  useEffect(() => {
    document.body.dataset.avisoTareas = '';
    return () => { delete document.body.dataset.avisoTareas; };
  }, []);

  // Como en Principal → Tareas, pero sin encabezados de sección: cada fila dice su día.
  const cuando = (seccion: SeccionAviso, fecha: string | null, hora: string | null, desde: string | null = null): string | null => {
    if (!fecha) return hora;
    const dia = seccion !== 'hoy' ? formatDiaCorto(fecha) : desde ? `Desde el ${formatDiaSemana(desde)}` : fecha === today ? 'Hoy' : formatDiaCorto(fecha);
    return hora ? `${dia} · ${hora}` : dia;
  };
  const metaComun = (scope: string, asignadoId: string | null, nombre: string | null, sucursalId: string | null): ReactNode[] => {
    const meta: ReactNode[] = [];
    const propia = personal && scope !== 'team' && !!operador.miBarberoId && asignadoId === operador.miBarberoId;
    if (!propia) meta.push(<MetaResponsable key="resp" equipo={scope === 'team'} nombre={nombre} />);
    const suc = multiSucursal && sucursalId ? sucursales.find(s => s.id === sucursalId)?.nombre : null;
    if (suc) meta.push(<MetaSucursal key="suc" nombre={suc} />);
    return meta;
  };

  const fila = (item: ItemAviso) => {
    if (item.kind === 'prevista') {
      const p = item.prevista;
      const texto = cuando(item.seccion, p.fecha, p.hora);
      return (
        <TareaFila key={`prevista:${p.recurrencia_id}:${p.fecha}`} titulo={p.titulo} descripcion={p.descripcion} estado="programada" automatica
          meta={[...(texto ? [<MetaCuando key="cuando" texto={texto} />] : []), ...metaComun(p.assignment_scope, p.asignado_a_id, p.asignado_a_nombre, p.sucursal_id)]}
          onAbrir={() => onIr({ tipo: 'prevista', recurrenciaId: p.recurrencia_id, fecha: p.fecha })} />
      );
    }
    const t = item.tarea;
    const enProgreso = t.estado === 'en_progreso';
    const estado: EstadoFila = item.vencida ? (enProgreso ? 'en_progreso_vencida' : 'vencida') : enProgreso ? 'en_progreso' : 'pendiente';
    const texto = cuando(item.seccion, fechaDeTarea(t), t.hora, item.desde);
    const meta: ReactNode[] = [];
    if (texto) meta.push(<MetaCuando key="cuando" texto={texto} />);
    if (item.seccion !== 'atencion' && item.diasParaVencer === 0) meta.push(<MetaCuando key="vence" texto="Vence hoy" destacar />);
    meta.push(...metaComun(t.assignment_scope, t.asignado_a_id, t.asignado_a_nombre, t.sucursal_id));
    const actua = puedeOperarTarea(t, operador);
    return (
      <TareaFila key={t.id} titulo={t.titulo} descripcion={t.descripcion} estado={estado} meta={meta} automatica={!!t.recurrencia_id}
        onAbrir={() => onIr({ tipo: 'tarea', id: t.id })}
        onCompletar={actua ? () => solicitar({ id: t.id, version: t.accion_version!, accion: 'completar' }, t) : undefined}
        onIniciar={actua && !enProgreso ? () => solicitar({ id: t.id, version: t.accion_version!, accion: 'iniciar' }, t) : undefined}
        enCurso={enCurso(t.id)} bloqueada={pendiente} />
    );
  };

  return (
    <Dialog open onOpenChange={next => { if (!next) onMasTarde(); }}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          className="resumen-sheet flex flex-col overflow-clip border bg-card shadow-lg"
          onPointerDownOutside={ignorarToasts}
          onFocusOutside={ignorarToasts}
        >
          <div className="flex shrink-0 items-start justify-between gap-3 px-5 pb-4 pt-5 sm:px-6">
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-muted-foreground">{contexto}</p>
              <DialogPrimitive.Title className="mt-1 text-base font-semibold text-foreground">{TITULO_AVISO[momento]}</DialogPrimitive.Title>
              <DialogPrimitive.Description className="text-sm text-muted-foreground">
                {BAJADA[momento]}
              </DialogPrimitive.Description>
            </div>
            {/* Cerrar = "Más tarde": un cierre accidental no lo da por resuelto. */}
            <DialogPrimitive.Close
              aria-label="Cerrar y recordar más tarde"
              className="hit-area-expand -mr-1.5 -mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-4 w-4" aria-hidden />
            </DialogPrimitive.Close>
          </div>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto border-t px-5 py-5 sm:px-6">
            {momento === 'lunes' ? (
              <InicioSemana rango={rango} previstas={progreso.total} paraHoy={contenido.paraHoy} anteriores={progreso.anteriores} />
            ) : (
              <TareasProgresoSemanal progreso={progreso} rango={rango} idTitulo="aviso-tareas-progreso" className="shadow-none" />
            )}

            {contenido.todoAlDia && (
              <p className="flex items-center gap-2 px-1 text-sm font-medium text-foreground">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-status-success" aria-hidden />
                Todo al día esta semana.
              </p>
            )}

            {contenido.items.length > 0 ? (
              <section aria-labelledby="aviso-tareas-lista" className="space-y-2">
                <h3 id="aviso-tareas-lista" className="px-1 text-sm font-semibold text-foreground">{TITULO_LISTA[momento]}</h3>
                <ListaTareas className="shadow-none">{contenido.items.map(fila)}</ListaTareas>
                {contenido.restantes > 0 && (
                  <p className="px-1 text-xs text-muted-foreground">
                    Y {contenido.restantes} más esta semana en Tareas.
                  </p>
                )}
              </section>
            ) : !contenido.todoAlDia && (
              <p className="px-1 text-sm text-muted-foreground">Nada pendiente por ahora.</p>
            )}
          </div>

          <div className="shrink-0 border-t px-5 py-4 sm:px-6">
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
              <Button variant="ghost" onClick={onMasTarde}>Más tarde</Button>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1 sm:flex-none" onClick={() => onIr({ tipo: 'lista' })}>Ver todas las tareas</Button>
                <Button className="flex-1 sm:flex-none" onClick={onListo}>Listo</Button>
              </div>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}

/** Inicio de semana: lo previsto, lo de hoy y lo que arrastra de semanas anteriores (mismos números que la agenda). */
function InicioSemana({ rango, previstas, paraHoy, anteriores }: { rango: string; previstas: number; paraHoy: number; anteriores: number }) {
  return (
    <section aria-labelledby="aviso-tareas-semana" className="rounded-xl border border-border bg-card px-4 py-3.5">
      <h3 id="aviso-tareas-semana" className="text-sm font-medium text-foreground">
        Esta semana <span className="font-normal text-muted-foreground">· {rango}</span>
      </h3>
      <dl className="mt-3 grid grid-cols-3 gap-3">
        <Dato valor={previstas} etiqueta={plural(previstas, 'prevista', 'previstas')} />
        <Dato valor={paraHoy} etiqueta="para hoy" />
        <Dato valor={anteriores} etiqueta={plural(anteriores, 'pendiente anterior', 'pendientes anteriores')} atencion={anteriores > 0} />
      </dl>
    </section>
  );
}

function Dato({ valor, etiqueta, atencion }: { valor: number; etiqueta: string; atencion?: boolean }) {
  return (
    // Número arriba (orden visual) y etiqueta abajo; para el lector de pantalla, etiqueta → valor.
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="inline-flex items-start gap-1 text-xs text-muted-foreground">
        {atencion && <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-status-error-foreground" aria-hidden />}
        {etiqueta}
      </dt>
      <dd className="order-first text-xl font-semibold tabular-nums text-foreground">{valor}</dd>
    </div>
  );
}
