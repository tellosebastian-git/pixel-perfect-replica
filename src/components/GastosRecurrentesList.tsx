import { useState } from 'react';
import { Repeat, Trash2, Pause, Play } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StatusPill } from '@/components/ui/StatusPill';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { GastoRecurrente } from '@/hooks/useGastosRecurrentes';
import { getRepeatLabel } from '@/components/tareas/RepeatPicker';
import { getCustomRepeatLabel } from '@/components/tareas/CustomRepeatSheet';

interface Props {
  recurrentes: GastoRecurrente[];
  onToggle: (id: string, activo: boolean) => void;
  onDelete: (id: string) => void;
}

export function GastosRecurrentesList({ recurrentes, onToggle, onDelete }: Props) {
  const [deleteConfirm, setDeleteConfirm] = useState<GastoRecurrente | null>(null);

  if (recurrentes.length === 0) return null;

  const getLabel = (r: GastoRecurrente) => {
    if (r.repeat_preset === 'custom') {
      return getCustomRepeatLabel(r.repeat_frequency, r.repeat_interval, r.repeat_byweekday);
    }
    return getRepeatLabel(r.repeat_preset);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Repeat className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">Gastos recurrentes</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Categoría</TableHead>
              <TableHead>Frecuencia</TableHead>
              <TableHead className="text-right">Monto</TableHead>
              <TableHead>Próxima fecha</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="w-20"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {recurrentes.map((r) => (
              <TableRow key={r.id} className={!r.activo ? 'opacity-50' : ''}>
                <TableCell>
                  <div>
                    <span className="font-medium">{r.categoria}</span>
                    {r.descripcion && (
                      <p className="text-xs text-muted-foreground truncate max-w-[200px]">{r.descripcion}</p>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{getLabel(r)}</Badge>
                </TableCell>
                <TableCell className="text-right font-medium">
                  ${r.monto.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                </TableCell>
                <TableCell className="text-sm">{r.proxima_fecha}</TableCell>
                <TableCell>
                  <StatusPill status={r.activo ? 'success' : 'neutral'} label={r.activo ? 'Activo' : 'Pausado'} />
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => onToggle(r.id, !r.activo)}
                      title={r.activo ? 'Pausar' : 'Activar'}
                    >
                      {r.activo ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => setDeleteConfirm(r)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>

      <AlertDialog open={!!deleteConfirm} onOpenChange={(open) => !open && setDeleteConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar gasto recurrente</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteConfirm && (
                <>Vas a eliminar el gasto recurrente <strong>{deleteConfirm.categoria}</strong>. Esta acción no se puede deshacer.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteConfirm) onDelete(deleteConfirm.id);
                setDeleteConfirm(null);
              }}
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
