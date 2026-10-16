import type { ReactNode } from 'react';
import {
  AlertTriangle, CalendarClock, Check, CheckCircle2, Clock, Loader2, MapPin, MoreHorizontal, Play, Repeat, User, Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/ui/StatusPill';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

/** Acción del menú secundario. Solo se pasan las que el usuario puede usar. */
export interface AccionMenu {
  label: string;
  onSelect: () => void;
  destructive?: boolean;
}

export type EstadoFila = 'pendiente' | 'en_progreso' | 'vencida' | 'en_progreso_vencida' | 'programada' | 'completada';

export interface TareaFilaProps {
  titulo: string;
  descripcion?: string | null;
  estado: EstadoFila;
  /** Metadatos ya decididos por el contenedor (sin repetir lo que la sección ya dice). */
  meta: ReactNode[];
  automatica?: boolean;
  onAbrir: () => void;
  /** Un toque. Ausente = el usuario no puede completarla (o es Programada / completada). */
  onCompletar?: () => void;
  onIniciar?: () => void;
  /** Acción en curso sobre esta fila. */
  enCurso?: 'completar' | 'iniciar' | null;
  /** Otra acción de Tareas está en curso: evita doble envío. */
  bloqueada?: boolean;
  menu?: AccionMenu[];
  /** Id de la tarea: permite llegar a la fila desde la campana o el aviso semanal. */
  domId?: string;
  /** Orientación breve al llegar desde otro lugar (se apaga sola). */
  resaltada?: boolean;
}

/**
 * Fila operativa de Principal → Tareas. Misma fila para manuales y automáticas (solo cambia un indicador
 * discreto); el estado excepcional se comunica con ícono + texto, nunca solo con color.
 */
export function TareaFila({
  titulo, descripcion, estado, meta, automatica, onAbrir, onCompletar, onIniciar, enCurso = null, bloqueada = false, menu = [],
  domId, resaltada = false,
}: TareaFilaProps) {
  const vencida = estado === 'vencida' || estado === 'en_progreso_vencida';
  const enProgreso = estado === 'en_progreso' || estado === 'en_progreso_vencida';
  const ocupada = bloqueada || !!enCurso;

  return (
    <li id={domId ? `tarea-${domId}` : undefined}
      className={cn('flex items-start gap-1.5 px-2 py-2.5 transition-colors duration-700 sm:gap-2 sm:px-3', resaltada && 'bg-primary/5')}>
      <Indicador estado={estado} titulo={titulo} onCompletar={onCompletar} completando={enCurso === 'completar'} deshabilitado={ocupada} />

      <div className="flex min-w-0 flex-1 flex-wrap items-start gap-x-4 gap-y-2">
        <button
          type="button"
          onClick={onAbrir}
          className="min-w-0 flex-1 basis-56 rounded-md px-1 py-1 text-left transition-colors duration-150 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-medium text-foreground">{titulo}</span>
            {enProgreso && <StatusPill status="info" icon={Play} size="sm" label="En progreso" />}
            {vencida && <StatusPill status="error" icon={AlertTriangle} size="sm" label="Vencida" />}
            {estado === 'programada' && <StatusPill status="neutral" icon={CalendarClock} size="sm" label="Programada" />}
          </span>
          {descripcion && <span className="mt-0.5 block truncate text-sm text-muted-foreground">{descripcion}</span>}
          {(meta.length > 0 || automatica) && (
            <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {meta}
              {automatica && <span className="inline-flex items-center gap-1"><Repeat className="h-3.5 w-3.5" aria-hidden />Automática</span>}
            </span>
          )}
        </button>

        {(onIniciar || menu.length > 0) && (
          <div className="ml-auto flex shrink-0 items-center gap-3 py-0.5">
            {onIniciar && (
              <Button type="button" size="sm" variant="outline" className="hit-area-expand" disabled={ocupada} onClick={onIniciar}
                aria-label={`Iniciar «${titulo}»`}>
                {enCurso === 'iniciar' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
                {enCurso === 'iniciar' ? 'Iniciando…' : 'Iniciar'}
              </Button>
            )}
            {menu.length > 0 && <MenuFilaAcciones titulo={titulo} acciones={menu} />}
          </div>
        )}
      </div>
    </li>
  );
}

function Indicador({ estado, titulo, onCompletar, completando, deshabilitado }: {
  estado: EstadoFila; titulo: string; onCompletar?: () => void; completando: boolean; deshabilitado: boolean;
}) {
  const vencida = estado === 'vencida' || estado === 'en_progreso_vencida';
  if (estado === 'completada') {
    return <span className="grid h-10 w-10 shrink-0 place-items-center" aria-hidden><CheckCircle2 className="h-6 w-6 text-status-success" /></span>;
  }
  if (estado === 'programada' || !onCompletar) {
    // Programada: todavía no existe como tarea. Sin permiso: no hay acción que ofrecer.
    return (
      <span className="grid h-10 w-10 shrink-0 place-items-center" aria-hidden>
        <span className={cn('h-6 w-6 rounded-full border-2', estado === 'programada' ? 'border-dashed border-muted-foreground/50' : 'border-muted-foreground/40')} />
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onCompletar}
      disabled={deshabilitado}
      aria-label={`Completar «${titulo}»`}
      title="Completar"
      className="group hit-area-expand grid h-10 w-10 shrink-0 place-items-center rounded-full transition-transform duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97] disabled:cursor-not-allowed"
    >
      <span
        className={cn(
          'grid h-6 w-6 place-items-center rounded-full border-2 transition-colors duration-150',
          completando ? 'border-primary bg-primary text-primary-foreground'
            : vencida ? 'border-status-error text-status-error group-hover:bg-status-error-bg'
              : 'border-muted-foreground/60 text-primary group-hover:border-primary group-hover:bg-primary/10',
          deshabilitado && !completando && 'opacity-60',
        )}
      >
        {completando
          ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          : <Check className="h-3.5 w-3.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden />}
      </span>
    </button>
  );
}

/** Menú secundario `⋯` (kebab canónico): Editar/Eliminar no compiten con Iniciar/Completar. */
export function MenuFilaAcciones({ titulo, acciones }: { titulo: string; acciones: AccionMenu[] }) {
  const comunes = acciones.filter(a => !a.destructive);
  const destructivas = acciones.filter(a => a.destructive);
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Más acciones para «${titulo}»`}
          className="hit-area-expand grid h-7 w-7 place-items-center rounded-md border-[0.5px] border-border text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        {comunes.map(a => <DropdownMenuItem key={a.label} onSelect={a.onSelect}>{a.label}</DropdownMenuItem>)}
        {comunes.length > 0 && destructivas.length > 0 && <DropdownMenuSeparator />}
        {destructivas.map(a => (
          <DropdownMenuItem key={a.label} onSelect={a.onSelect} className="text-destructive focus:text-destructive">{a.label}</DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Piezas de metadatos con ícono, para que todas las filas hablen igual. */
export const MetaResponsable = ({ equipo, nombre }: { equipo: boolean; nombre?: string | null }) => (
  <span className="inline-flex items-center gap-1">
    {equipo ? <Users className="h-3.5 w-3.5" aria-hidden /> : <User className="h-3.5 w-3.5" aria-hidden />}
    {equipo ? 'Todo el equipo' : (nombre || 'Sin asignar')}
  </span>
);
export const MetaSucursal = ({ nombre }: { nombre: string }) => (
  <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" aria-hidden />{nombre}</span>
);
/** `destacar`: texto en negrita y color de texto (contraste AA); el ámbar queda solo en el ícono. */
export const MetaCuando = ({ texto, destacar }: { texto: string; destacar?: boolean }) => (
  <span className={cn('inline-flex items-center gap-1', destacar && 'font-medium text-foreground')}>
    <Clock className={cn('h-3.5 w-3.5', destacar && 'text-status-warning-foreground')} aria-hidden />{texto}
  </span>
);
