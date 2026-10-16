import { AlertTriangle } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import type { ProgresoSemanal } from '@/lib/tareasAgenda';

interface Props {
  progreso: ProgresoSemanal;
  /** "13 al 19 oct" */
  rango: string;
  /** Lleva a "Necesitan atención" cuando hay pendientes de semanas anteriores. */
  onVerAtencion?: () => void;
  className?: string;
  /** Id del título: el aviso semanal puede abrirse con Principal → Tareas montado detrás. */
  idTitulo?: string;
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/**
 * Principal → Tareas → parte superior. Cuánto de lo previsto para esta semana (lunes a domingo de la
 * organización) ya se resolvió. Unidad reutilizable: recibe números ya calculados, no consulta nada.
 */
export function TareasProgresoSemanal({ progreso, rango, onVerAtencion, className, idTitulo = 'tareas-progreso-titulo' }: Props) {
  const { completadas, total, vencidas, pendientes, programadas, anteriores } = progreso;
  const porcentaje = total > 0 ? Math.round((completadas / total) * 100) : 0;
  const detalle = [
    vencidas > 0 && plural(vencidas, 'vencida', 'vencidas'),
    pendientes > 0 && plural(pendientes, 'pendiente', 'pendientes'),
    programadas > 0 && plural(programadas, 'programada', 'programadas'),
  ].filter(Boolean) as string[];

  return (
    <section aria-labelledby={idTitulo} className={cn('rounded-xl border border-border bg-card px-4 py-3.5 shadow-sm', className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id={idTitulo} className="text-sm font-medium text-foreground">
          Esta semana <span className="font-normal text-muted-foreground">· {rango}</span>
        </h2>
        {total > 0 ? (
          <p className="text-sm text-foreground">
            <span className="font-semibold tabular-nums">{completadas}</span> de <span className="font-semibold tabular-nums">{total}</span> completadas
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Sin tareas con fecha esta semana</p>
        )}
      </div>

      {total > 0 && (
        <Progress value={porcentaje} className="mt-2.5 h-1.5" aria-label={`${completadas} de ${total} tareas de esta semana completadas`} />
      )}

      {(detalle.length > 0 || anteriores > 0) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {detalle.length > 0 && <span className="tabular-nums">{detalle.join(' · ')}</span>}
          {anteriores > 0 && (
            onVerAtencion ? (
              <button type="button" onClick={onVerAtencion}
                className="inline-flex items-center gap-1 rounded-sm font-medium text-status-error-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                {plural(anteriores, 'pendiente de semanas anteriores', 'pendientes de semanas anteriores')}
              </button>
            ) : (
              <span className="inline-flex items-center gap-1 font-medium text-status-error-foreground">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                {plural(anteriores, 'pendiente de semanas anteriores', 'pendientes de semanas anteriores')}
              </span>
            )
          )}
        </div>
      )}
    </section>
  );
}
