import { useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';

export interface OpcionFiltro { id: string; nombre: string }

interface Props {
  responsable: string;
  onResponsable: (value: string) => void;
  responsables: OpcionFiltro[];
  /** `null` = el contexto ya fija la sucursal: no se muestra. */
  sucursales: OpcionFiltro[] | null;
  sucursal: string;
  onSucursal: (value: string) => void;
  onQuitar: () => void;
}

/**
 * Filtros de Principal → Tareas → Negocio (y del Historial). La estructura temporal reemplaza a los
 * filtros de estado y fecha; quedan Responsable y, si el contexto abarca varias, Sucursal.
 * Tablet y desktop: en línea. Mobile: un solo "Filtrar · N" que abre el drawer inferior.
 */
export function TareasFiltros({ responsable, onResponsable, responsables, sucursales, sucursal, onSucursal, onQuitar }: Props) {
  const [abierto, setAbierto] = useState(false);
  const activos = (responsable !== 'todos' ? 1 : 0) + (sucursales && sucursal !== 'todas' ? 1 : 0);

  const campos = (prefijo: string) => (
    <>
      <div className="space-y-1.5 sm:space-y-0">
        <Label htmlFor={`${prefijo}-responsable`} className="sm:sr-only">Responsable</Label>
        <Select value={responsable} onValueChange={onResponsable}>
          <SelectTrigger id={`${prefijo}-responsable`} className="sm:h-9 sm:w-[13rem]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos los responsables</SelectItem>
            <SelectItem value="__team__">Todo el equipo</SelectItem>
            {responsables.map(r => <SelectItem key={r.id} value={r.id}>{r.nombre}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {sucursales && (
        <div className="space-y-1.5 sm:space-y-0">
          <Label htmlFor={`${prefijo}-sucursal`} className="sm:sr-only">Sucursal</Label>
          <Select value={sucursal} onValueChange={onSucursal}>
            <SelectTrigger id={`${prefijo}-sucursal`} className="sm:h-9 sm:w-[12rem]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas las sucursales</SelectItem>
              {sucursales.map(s => <SelectItem key={s.id} value={s.id}>{s.nombre}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}
    </>
  );

  return (
    <>
      <div className="hidden flex-wrap items-center gap-2 sm:flex" role="group" aria-label="Filtros de tareas">
        {campos('filtro')}
        {activos > 0 && <Button type="button" variant="ghost" size="sm" onClick={onQuitar}>Quitar filtros</Button>}
      </div>

      <div className="sm:hidden">
        <Button type="button" variant="outline" size="sm" className="hit-area-expand" onClick={() => setAbierto(true)}>
          <SlidersHorizontal aria-hidden />
          {activos > 0 ? `Filtrar · ${activos}` : 'Filtrar'}
        </Button>
        <Drawer open={abierto} onOpenChange={setAbierto}>
          <DrawerContent>
            <DrawerHeader className="text-left">
              <DrawerTitle>Filtrar tareas</DrawerTitle>
              <DrawerDescription>Mostrá solo las de una persona o una sucursal.</DrawerDescription>
            </DrawerHeader>
            <div className="space-y-4 px-4">{campos('filtro-movil')}</div>
            <DrawerFooter className="flex-row justify-end gap-2 pb-[calc(1rem+env(safe-area-inset-bottom))]">
              {activos > 0 && <Button type="button" variant="ghost" onClick={() => { onQuitar(); setAbierto(false); }}>Quitar filtros</Button>}
              <Button type="button" onClick={() => setAbierto(false)}>Listo</Button>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
      </div>
    </>
  );
}
