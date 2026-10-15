import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

interface Props {
  /** `null` = cerrado. */
  objetivo: { titulo: string; tipo: 'tarea' | 'peticion'; automaticaTitulo?: string | null; automatica?: boolean } | null;
  onCancelar: () => void;
  /** Resuelve al terminar; si falla, el diálogo queda abierto y quien llama muestra el error. */
  onConfirmar: () => Promise<void>;
}

/**
 * Eliminar una tarea o una petición: confirmación segura, sin la cuenta regresiva que se reserva para
 * borrar una Tarea automática completa. Si la tarea la generó una automática, aclara que esa sigue.
 */
export function TareaEliminarDialog({ objetivo, onCancelar, onConfirmar }: Props) {
  const [eliminando, setEliminando] = useState(false);
  const descripcion = objetivo?.tipo === 'peticion'
    ? 'La petición se elimina para todo el equipo. No se puede deshacer.'
    : objetivo?.automatica
      ? `Se elimina solo esta tarea. La Tarea automática${objetivo.automaticaTitulo ? ` «${objetivo.automaticaTitulo}»` : ''} no se elimina: sigue creando las próximas.`
      : 'La tarea se elimina para todo el equipo. No se puede deshacer.';

  return (
    <AlertDialog open={!!objetivo} onOpenChange={open => { if (!open && !eliminando) onCancelar(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Eliminar «{objetivo?.titulo}»?</AlertDialogTitle>
          <AlertDialogDescription>{descripcion}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={eliminando}>Cancelar</AlertDialogCancel>
          <Button type="button" variant="destructive" disabled={eliminando} onClick={async () => {
            setEliminando(true);
            try { await onConfirmar(); } finally { setEliminando(false); }
          }}>
            {eliminando && <Loader2 className="animate-spin" aria-hidden />}
            {eliminando ? 'Eliminando…' : 'Eliminar'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
