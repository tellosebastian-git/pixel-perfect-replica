/**
 * Política de retry para LECTURAS (nunca escrituras): intento inicial + hasta
 * 2 reintentos silenciosos (1s, 5s), cada intento con timeout propio. Solo
 * fallos transitorios demostrables se reintentan; todo lo demás se propaga
 * de inmediato. Ver DESIGN.md → Components → Feedback (C4C.1).
 */

export type ReadErrorClass = 'transient' | 'permanent';

// Códigos de error de Postgres/PostgREST que representan una falla temporal
// de conexión o de capacidad del servidor — nunca un problema con el request.
const TRANSIENT_POSTGRES_CODES = new Set([
  '57014', // query_canceled (statement_timeout del lado servidor)
  '53300', // too_many_connections
  '53400', // configuration_limit_exceeded
  '08000', '08003', '08006', // connection_exception / connection_does_not_exist / connection_failure
  'PGRST504', // PostgREST: gateway timeout
]);

const TRANSIENT_HTTP_STATUS = new Set([408, 429, 500, 502, 503, 504]);

interface ClassifyMeta {
  status?: number;
}

/**
 * Clasifica un error de lectura. Un error desconocido es SIEMPRE 'permanent'
 * (fail-fast) — martillar un error que no entendemos empeora la latencia y
 * puede amplificar un incidente real del backend.
 *
 * Nota sobre PGRST116: no se trata como "ausencia válida" acá. Con
 * `.maybeSingle()`, postgrest-js ya resuelve 0 filas como `{data: null,
 * error: null}` — nunca llega a este clasificador. Si SÍ llega un PGRST116
 * (>1 fila con `.maybeSingle()`, o 0/>1 con `.single()`), es una violación de
 * cardinalidad — se clasifica 'permanent' y se propaga como error real; el
 * consumidor decide qué copy mostrar según su propio contrato, esta función
 * nunca lo oculta.
 */
export function classifyReadError(error: unknown, meta: ClassifyMeta = {}): ReadErrorClass {
  if (!error) return 'permanent';

  // status === 0: fetch nunca completó (red caída, DNS, CORS) — postgrest-js
  // normaliza cualquier rechazo de `fetch()` a esta forma en vez de lanzar.
  if (meta.status === 0) return 'transient';

  if (typeof meta.status === 'number' && TRANSIENT_HTTP_STATUS.has(meta.status)) {
    return 'transient';
  }

  const code = typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : undefined;
  if (code && TRANSIENT_POSTGRES_CODES.has(code)) return 'transient';

  // Defensivo: si algo lanzó un error de fetch nativo en vez de resolver con
  // la forma {data, error, status} (no debería ocurrir a través de
  // supabase-js, pero cubre un `throw` inesperado en el propio `attempt`).
  if (error instanceof TypeError && /failed to fetch|network|load failed/i.test(error.message)) {
    return 'transient';
  }

  return 'permanent';
}

/**
 * Respeta `Retry-After` cuando el error lo expone. En este build, ninguna de
 * las lecturas migradas puede poblar esto: pasan por el query builder de
 * supabase-js (`.from(...).select(...)`), que normaliza la respuesta a
 * `{data, error, count, status, statusText}` SIN exponer headers de
 * respuesta al llamador (verificado contra
 * node_modules/@supabase/postgrest-js — no hay forma de leer `Retry-After`
 * sin reemplazar el builder por un `fetch` manual, fuera de alcance). Queda
 * implementado para consumidores futuros que sí expongan headers (ej. una
 * `FunctionsHttpError` de `supabase.functions.invoke`, que carga `context`
 * como `Response`).
 */
export function getRetryAfterMs(error: unknown, opts: { min?: number; max?: number } = {}): number | null {
  const min = opts.min ?? 1000;
  const max = opts.max ?? 10_000;
  const headers = (error as { context?: { headers?: Headers } })?.context?.headers;
  const raw = headers?.get?.('Retry-After') ?? headers?.get?.('retry-after');
  if (raw == null) return null;

  let ms: number | null = null;
  const asSeconds = Number(raw);
  if (!Number.isNaN(asSeconds)) {
    ms = asSeconds * 1000;
  } else {
    const asDate = Date.parse(raw);
    if (!Number.isNaN(asDate)) ms = asDate - Date.now();
  }
  if (ms == null || Number.isNaN(ms) || ms < 0) return null;
  return Math.min(Math.max(ms, min), max);
}

export class ReadFailure extends Error {
  readonly cause: unknown;
  readonly classification: ReadErrorClass;
  constructor(message: string, cause: unknown, classification: ReadErrorClass) {
    super(message);
    this.name = 'ReadFailure';
    this.cause = cause;
    this.classification = classification;
  }
}

/** Ciclo cancelado por nosotros mismos (desmontaje / cambio de contexto) — nunca es un error visible. */
export class ReadCancelledError extends Error {
  constructor() {
    super('read_cancelled');
    this.name = 'ReadCancelledError';
  }
}

export interface ReadAttemptResult<T> {
  data: T | null;
  error: unknown | null;
  status?: number;
}

export type ReadAttempt<T> = (signal: AbortSignal) => Promise<ReadAttemptResult<T>>;

export interface RunReadOptions {
  /** Señal externa: desmontaje o cambio de contexto. Al abortar, el ciclo entero se descarta en silencio. */
  signal: AbortSignal;
  /** Demoras entre intentos. Default: [1000, 5000] → intento inicial + 2 reintentos. */
  delaysMs?: number[];
  /** Timeout por intento individual. Default: 10000ms. */
  timeoutMs?: number;
  classify?: (error: unknown, meta: ClassifyMeta) => ReadErrorClass;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new ReadCancelledError());
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      cleanup();
      reject(new ReadCancelledError());
    };
    function cleanup() {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    }
    signal.addEventListener('abort', onAbort);
  });
}

type AttemptOutcome<T> =
  | { outcome: 'success'; data: T }
  | { outcome: 'cancelled' }
  | { outcome: 'timeout' }
  | { outcome: 'failed'; error: unknown; status?: number };

async function runOneAttempt<T>(
  attempt: ReadAttempt<T>,
  externalSignal: AbortSignal,
  timeoutMs: number,
): Promise<AttemptOutcome<T>> {
  if (externalSignal.aborted) return { outcome: 'cancelled' };

  const controller = new AbortController();
  let timedOut = false;
  const onExternalAbort = () => controller.abort();
  externalSignal.addEventListener('abort', onExternalAbort);
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const result = await attempt(controller.signal);
    if (externalSignal.aborted) return { outcome: 'cancelled' };
    if (!result.error) return { outcome: 'success', data: result.data as T };
    if (timedOut) return { outcome: 'timeout' };
    return { outcome: 'failed', error: result.error, status: result.status };
  } catch (err) {
    if (externalSignal.aborted) return { outcome: 'cancelled' };
    if (timedOut) return { outcome: 'timeout' };
    return { outcome: 'failed', error: err };
  } finally {
    clearTimeout(timer);
    externalSignal.removeEventListener('abort', onExternalAbort);
  }
}

/**
 * Ejecuta `attempt` con la política aprobada: intento inicial + hasta 2
 * reintentos silenciosos (solo ante fallo transitorio), timeout de 10s por
 * intento, cancelable en cualquier punto vía `signal`. Nunca reintenta
 * escrituras — está pensado exclusivamente para lecturas idempotentes.
 */
export async function runReadWithRetry<T>(attempt: ReadAttempt<T>, options: RunReadOptions): Promise<T> {
  const delaysMs = options.delaysMs ?? [1000, 5000];
  const timeoutMs = options.timeoutMs ?? 10_000;
  const classify = options.classify ?? classifyReadError;
  const totalAttempts = delaysMs.length + 1;

  for (let i = 0; i < totalAttempts; i++) {
    const outcome = await runOneAttempt(attempt, options.signal, timeoutMs);

    if (outcome.outcome === 'cancelled') throw new ReadCancelledError();
    if (outcome.outcome === 'success') return outcome.data;

    const isLastAttempt = i === totalAttempts - 1;

    if (outcome.outcome === 'timeout') {
      if (isLastAttempt) throw new ReadFailure('read_timeout', null, 'transient');
    } else {
      const classification = classify(outcome.error, { status: outcome.status });
      if (classification === 'permanent' || isLastAttempt) {
        throw new ReadFailure('read_failed', outcome.error, classification);
      }
    }

    const retryAfter = outcome.outcome === 'failed' ? getRetryAfterMs(outcome.error) : null;
    const delay = retryAfter ?? delaysMs[i];
    await sleep(delay, options.signal);
  }

  // Inalcanzable: el loop siempre retorna o lanza en su última iteración.
  throw new ReadFailure('read_failed', null, 'permanent');
}

/** Identificador corto de diagnóstico para consola — no es telemetría, no se muestra al usuario. */
export function shortDiagId(): string {
  return Math.random().toString(36).slice(2, 8);
}
