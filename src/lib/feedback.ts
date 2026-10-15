import { toast } from 'sonner';

interface FeedbackOptions {
  description?: string;
}

interface FeedbackErrorOptions extends FeedbackOptions {
  /**
   * Acción "Reintentar" sobre el toast. `id` debe ser estable por superficie
   * (ej. el nombre del hook o pantalla que lo emite): Sonner reemplaza un
   * toast existente con el mismo `id` en vez de apilarlo, así que un refetch
   * fallido repetido de la misma superficie nunca duplica el toast.
   */
  retry?: { id: string; onRetry: () => void; label?: string };
}

interface FeedbackSuccessOptions extends FeedbackOptions {
  /** Acción inmediata sobre lo que se acaba de hacer (ej. "Deshacer"). */
  action?: { label: string; onClick: () => void };
  /** Debe cubrir la ventana que permite el servidor para esa acción; el servidor sigue siendo quien decide. */
  duration?: number;
  id?: string;
}

/** Punto único de invocación de feedback transitorio sobre Sonner (único sistema visual de toasts). */
export const feedback = {
  success: (message: string, options?: FeedbackSuccessOptions) => toast.success(message, options),
  error: (message: string, options?: FeedbackErrorOptions) => {
    const { retry, ...rest } = options ?? {};
    toast.error(message, {
      ...rest,
      id: retry?.id,
      action: retry ? { label: retry.label ?? 'Reintentar', onClick: retry.onRetry } : undefined,
    });
  },
  info: (message: string, options?: FeedbackOptions) => toast.message(message, options),
  /** Descarta el toast de una superficie (ej. al recuperarse un refetch antes fallido). */
  dismiss: (id: string) => toast.dismiss(id),
};
