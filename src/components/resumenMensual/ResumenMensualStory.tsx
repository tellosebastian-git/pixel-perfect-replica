import { useResumenesMensuales } from '@/hooks/useResumenesMensuales';
import { useAvisoGlobal } from '@/components/avisos/AvisosGlobales';
import type { EstadoAviso } from '@/lib/avisosGlobales';
import { ResumenMensualDialog } from './ResumenMensualDialog';

/**
 * Punto de montaje del resumen mensual automático.
 *
 * No renderiza nada salvo que el usuario sea owner/general_manager Y tenga al
 * menos un resumen sin leer y sin descartar. La carga es asincrónica y no
 * bloquea nada: la app se monta igual mientras se resuelve la consulta.
 *
 * Es uno de los avisos globales al entrar (ver `AvisosGlobales`): el onboarding
 * tiene prioridad (enseñar la app antes que resumirla) y el resumen la tiene
 * sobre el aviso semanal de Tareas. Si le toca a otro, queda para una entrada
 * posterior; nunca se encadena después de otro aviso.
 */
export function ResumenMensualStory() {
  const { pendientes, isLoading, habilitado, marcarLeido, posponerTodos, descartarTodos } =
    useResumenesMensuales();

  const estado: EstadoAviso = !habilitado ? 'no' : isLoading ? 'pendiente' : pendientes.length > 0 ? 'listo' : 'no';
  const { abierto, cerrar } = useAvisoGlobal('resumen', estado);

  if (!abierto || pendientes.length === 0) return null;

  return (
    <ResumenMensualDialog
      open
      onOpenChange={next => { if (!next) cerrar(); }}
      resumenes={pendientes}
      onMarcarLeido={marcarLeido}
      onPosponerTodos={posponerTodos}
      onDescartarTodos={descartarTodos}
    />
  );
}
