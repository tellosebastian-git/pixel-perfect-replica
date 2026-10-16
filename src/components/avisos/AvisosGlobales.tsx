import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useIsMutating } from '@tanstack/react-query';
import {
  actualizarEntrada, elegirAviso, ENTRADA_VACIA, leerEntrada, suscribirEntradas, superficieDisponible,
  type AvisoGlobal, type EstadoAviso,
} from '@/lib/avisosGlobales';

/** Respiro antes de abrir: deja que todos informen su estado y no aparece en el mismo instante que la pantalla. */
const ESPERA_MS = 600;

interface ContextoAvisos {
  /** El aviso que puede estar abierto ahora (`null`: ninguno). */
  activo: AvisoGlobal | null;
  reportar: (id: AvisoGlobal, estado: EstadoAviso) => void;
  cerrar: (id: AvisoGlobal) => void;
}
const Contexto = createContext<ContextoAvisos | null>(null);

/**
 * Coordinador de los avisos globales al entrar (reglas en `src/lib/avisosGlobales.ts`): decide cuál se abre en esta
 * entrada, cuándo la superficie está libre y que no se encadene otro. `entrada`: usuario + organización ya cargados
 * (con `null` no se decide nada).
 */
export function AvisosGlobalesProvider({ entrada, children }: { entrada: string | null; children: ReactNode }) {
  const [estados, setEstados] = useState<Partial<Record<AvisoGlobal, EstadoAviso>>>({});
  const actual = useSyncExternalStore(suscribirEntradas, () => leerEntrada(entrada), () => ENTRADA_VACIA);
  const mutando = useIsMutating();
  const [reintento, setReintento] = useState(0);
  const estadosRef = useRef(estados);
  estadosRef.current = estados;
  const mutandoRef = useRef(mutando);
  mutandoRef.current = mutando;

  const reportar = useCallback((id: AvisoGlobal, estado: EstadoAviso) =>
    setEstados(prev => (prev[id] === estado ? prev : { ...prev, [id]: estado })), []);
  const cerrar = useCallback((id: AvisoGlobal) => {
    if (entrada && leerEntrada(entrada).elegido === id) actualizarEntrada(entrada, { cerrado: true });
  }, [entrada]);

  // Tocar o escribir en el contenido principal = ya está trabajando (la barra lateral y la campana no cuentan).
  useEffect(() => {
    if (!entrada) return;
    const marcar = (e: Event) => {
      if (e.target instanceof Element && e.target.closest('main') && !leerEntrada(entrada).enUso) actualizarEntrada(entrada, { enUso: true });
    };
    document.addEventListener('pointerdown', marcar, true);
    document.addEventListener('keydown', marcar, true);
    return () => {
      document.removeEventListener('pointerdown', marcar, true);
      document.removeEventListener('keydown', marcar, true);
    };
  }, [entrada]);

  const eleccion = elegirAviso(estados);
  useEffect(() => {
    if (!entrada || actual.elegido !== null || eleccion === 'esperar') return;
    if (eleccion === 'onboarding') { actualizarEntrada(entrada, { elegido: 'onboarding' }); return; }
    const t = window.setTimeout(() => {
      // Se vuelve a elegir con lo último informado: un aviso de mayor prioridad pudo cambiar mientras tanto.
      const ahora = elegirAviso(estadosRef.current);
      if (ahora !== eleccion) return;
      if (ahora === 'ninguno') { actualizarEntrada(entrada, { elegido: 'ninguno' }); return; }
      if (leerEntrada(entrada).enUso) { actualizarEntrada(entrada, { elegido: 'ninguno' }); return; }
      if (mutandoRef.current === 0 && superficieDisponible()) actualizarEntrada(entrada, { elegido: ahora });
      else setReintento(n => n + 1);
    }, ESPERA_MS);
    return () => window.clearTimeout(t);
  }, [entrada, actual.elegido, eleccion, reintento]);

  const activo = !actual.cerrado && actual.elegido && actual.elegido !== 'ninguno' ? actual.elegido : null;
  const valor = useMemo(() => ({ activo, reportar, cerrar }), [activo, reportar, cerrar]);
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

/**
 * Un aviso informa si quiere mostrarse; recibe si le toca estar abierto. Sin coordinador (fuera de la app
 * principal) nunca se abre solo.
 */
export function useAvisoGlobal(id: AvisoGlobal, estado: EstadoAviso) {
  const ctx = useContext(Contexto);
  const reportar = ctx?.reportar;
  const cerrarCtx = ctx?.cerrar;
  useEffect(() => { reportar?.(id, estado); }, [reportar, id, estado]);
  const cerrar = useCallback(() => cerrarCtx?.(id), [cerrarCtx, id]);
  return { abierto: ctx?.activo === id, cerrar };
}
