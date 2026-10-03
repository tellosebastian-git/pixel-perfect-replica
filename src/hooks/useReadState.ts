import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { feedback } from '@/lib/feedback';
import { ReadCancelledError, runReadWithRetry, shortDiagId, type ReadAttempt } from '@/lib/readRetry';

export type ReadPhase = 'loading' | 'ready' | 'refetching' | 'stale' | 'error';

export interface UseReadStateOptions {
  /**
   * Clave del contexto (organización+sucursal, + dimensiones propias como
   * fecha o rango cuando corresponda). Cambia en el mismo render que la
   * selección de la UI — sin esperar ningún efecto.
   */
  contextKey: string;
  /** Copy humano cuando la carga inicial (sin datos previos) se agota. */
  errorMessage: string;
  /** Copy humano del toast cuando un refetch (con datos previos) se agota. Default: errorMessage. */
  staleErrorMessage?: string;
  /** Id estable de la superficie — dedupe de toasts y borrado al recuperarse. */
  surfaceId: string;
  retryDelaysMs?: number[];
  timeoutMs?: number;
}

export interface UseReadStateResult<T> {
  phase: ReadPhase;
  data: T | null;
  /** Mensaje humano de error terminal (sin datos). null salvo `phase === 'error'`. */
  error: string | null;
  /** true cuando hay datos previos pero el último refetch se agotó. */
  isStale: boolean;
  /** Inicia un ciclo de lectura (intento inicial + hasta 2 reintentos silenciosos) para el contextKey actual. */
  run: (fetcher: ReadAttempt<T>) => void;
  /** Repite el último `run()` — usado por los botones/acciones "Reintentar". */
  retry: () => void;
}

/**
 * Generaliza el mecanismo de contexto+request-id+guardas que useSupabaseData
 * probó en C4B.2, y le agrega la política de retry de C4C.1 (1s/5s, timeout
 * 10s, clasificación transitorio/permanente). No decide QUÉ se renderiza —
 * cada consumidor traduce `phase`/`isStale` a su propia UI (skeleton propio,
 * `InlineReadError`, `StaleDataNotice` donde corresponda).
 */
export function useReadState<T>(options: UseReadStateOptions): UseReadStateResult<T> {
  const { contextKey, errorMessage, staleErrorMessage, surfaceId, retryDelaysMs, timeoutMs } = options;

  const [phase, setPhase] = useState<ReadPhase>('loading');
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isStale, setIsStale] = useState(false);

  const dataRef = useRef<T | null>(null);
  const lastFetcherRef = useRef<ReadAttempt<T> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);

  // Ref "siempre fresco" del contexto seleccionado ahora mismo. Actualizada en
  // useLayoutEffect (antes del paint, antes de cualquier efecto pasivo que
  // dispare un nuevo `run()`) para cerrar la ventana entre el render que
  // cambia de contexto y el efecto que reacciona a ese cambio — igual que en
  // useSupabaseData (C4B.2).
  const currentContextKeyRef = useRef(contextKey);
  useLayoutEffect(() => {
    currentContextKeyRef.current = contextKey;
  }, [contextKey]);

  const retryRef = useRef<() => void>(() => {});

  const run = useCallback((fetcher: ReadAttempt<T>) => {
    lastFetcherRef.current = fetcher;
    const myContextKey = contextKey;

    // Un solo ciclo activo por hook: latest-wins. Cubre tanto un cambio de
    // contexto como un retry manual mientras un ciclo previo seguía en curso.
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const myRequestId = ++requestIdRef.current;
    const stillCurrent = () =>
      myContextKey === currentContextKeyRef.current && myRequestId === requestIdRef.current;

    const hadData = dataRef.current !== null;
    setPhase(hadData ? 'refetching' : 'loading');
    if (!hadData) setError(null);

    void (async () => {
      try {
        const result = await runReadWithRetry(fetcher, {
          signal: controller.signal,
          delaysMs: retryDelaysMs,
          timeoutMs,
        });
        if (!stillCurrent()) return;
        dataRef.current = result;
        setData(result);
        setError(null);
        setIsStale(false);
        setPhase('ready');
        feedback.dismiss(surfaceId);
      } catch (err) {
        if (err instanceof ReadCancelledError) return; // abort propio: nunca es un error visible.
        if (!stillCurrent()) return;

        const diagId = shortDiagId();
        console.error(`[read:${surfaceId}] ${diagId}`, err);

        if (hadData) {
          setIsStale(true);
          setPhase('stale');
          feedback.error(staleErrorMessage ?? errorMessage, {
            retry: { id: surfaceId, onRetry: () => retryRef.current() },
          });
        } else {
          setError(errorMessage);
          setPhase('error');
        }
      }
    })();
  }, [contextKey, errorMessage, staleErrorMessage, surfaceId, retryDelaysMs, timeoutMs]);

  const retry = useCallback(() => {
    if (lastFetcherRef.current) run(lastFetcherRef.current);
  }, [run]);
  retryRef.current = retry;

  // Cambio de contexto o desmontaje: cancela el ciclo en curso de inmediato,
  // sin esperar a que el próximo `run()` lo reemplace.
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, [contextKey]);

  return { phase, data, error, isStale, run, retry };
}
