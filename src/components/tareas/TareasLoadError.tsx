import { InlineReadError } from '@/components/ui/InlineReadError';

/**
 * Lectura fallida de Tareas sin datos previos: nunca un vacío. Usa el patrón canónico (`InlineReadError`)
 * y lo anuncia como alerta. `compact` para usarlo dentro de un formulario o un bloque chico.
 */
export function TareasLoadError({ subject, retry, compact = false }: { subject: string; retry: () => unknown; pending?: boolean; compact?: boolean }) {
  return (
    <div role="alert">
      <InlineReadError
        message={`No pudimos cargar ${subject}.`}
        description="Revisá tu conexión y reintentá para ver la información actualizada."
        onRetry={() => void retry()}
        className={compact ? 'py-4' : undefined}
      />
    </div>
  );
}
