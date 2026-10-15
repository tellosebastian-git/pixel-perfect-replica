import { useEffect, useState } from 'react';
import type { AlcanceTareas } from '@/lib/tareasAgenda';

const clave = (userId: string, orgId: string) => `vittro:tareas:alcance:${userId}:${orgId}`;

function leer(userId?: string | null, orgId?: string | null): AlcanceTareas {
  if (!userId || !orgId) return 'negocio';
  try {
    return window.localStorage.getItem(clave(userId, orgId)) === 'mias' ? 'mias' : 'negocio';
  } catch {
    return 'negocio';
  }
}

/**
 * Última elección "Mis tareas | Negocio" de un supervisor, aislada por usuario + organización: en un
 * dispositivo compartido nunca se cruza entre personas ni entre organizaciones. Es una comodidad local;
 * si el almacenamiento no está disponible, arranca en Negocio.
 */
export function useTareasAlcance(userId?: string | null, orgId?: string | null) {
  const [alcance, setAlcance] = useState<AlcanceTareas>(() => leer(userId, orgId));
  useEffect(() => { setAlcance(leer(userId, orgId)); }, [userId, orgId]);
  const elegir = (valor: AlcanceTareas) => {
    setAlcance(valor);
    if (!userId || !orgId) return;
    try { window.localStorage.setItem(clave(userId, orgId), valor); } catch { /* sin almacenamiento: solo esta sesión */ }
  };
  return [alcance, elegir] as const;
}
