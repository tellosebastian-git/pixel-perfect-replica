import { forwardRef, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  id: string;
  titulo: string;
  /** Contexto a la derecha del título ("martes 14 de octubre"). */
  contexto?: string;
  cantidad?: number;
  icon?: LucideIcon;
  /** `atencion` refuerza la sección con ícono y color de error del sistema (además de su posición). */
  tono?: 'normal' | 'atencion';
  children: ReactNode;
}

/** Bloque temporal de Principal → Tareas: encabezado + lista vertical de filas. */
export const TareasSeccion = forwardRef<HTMLElement, Props>(function TareasSeccion(
  { id, titulo, contexto, cantidad, icon: Icon, tono = 'normal', children }, ref,
) {
  return (
    <section ref={ref} aria-labelledby={`${id}-titulo`} className="scroll-mt-4 space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-1">
        <h2 id={`${id}-titulo`} className={cn('inline-flex items-center gap-1.5 text-sm font-semibold', tono === 'atencion' ? 'text-status-error-foreground' : 'text-foreground')}>
          {Icon && <Icon className="h-4 w-4 self-center" aria-hidden />}
          {titulo}
          {cantidad !== undefined && <span className="font-normal tabular-nums text-muted-foreground">· {cantidad}</span>}
        </h2>
        {contexto && <span className="text-xs text-muted-foreground">{contexto}</span>}
      </div>
      {children}
    </section>
  );
});

/** Contenedor de filas: un solo card, filas separadas por hairline. */
export function ListaTareas({ children, className }: { children: ReactNode; className?: string }) {
  return <ul className={cn('divide-y divide-border rounded-xl border border-border bg-card shadow-sm', className)}>{children}</ul>;
}
