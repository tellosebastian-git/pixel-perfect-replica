import { Building2, MapPin } from 'lucide-react';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useSucursal } from '@/contexts/SucursalContext';
import { useAuth } from '@/contexts/AuthContext';

interface SucursalSelectorProps {
  collapsed?: boolean;
}

export function SucursalSelector({ collapsed = false }: SucursalSelectorProps) {
  const { sucursales, currentSucursal, setCurrentSucursal, isAllMode } = useSucursal();
  const { isOwner, isGeneralManager, isManager } = useAuth();

  const canSwitch = isOwner || isGeneralManager;

  // Rail (collapsed), non-interactive case only (fixed sucursal, no menu to
  // open): a single location glyph on the navy header, same footprint/radius
  // as the nav rail icons.
  const collapsedGlyph = (title: string) => (
    <div className="px-2 py-2">
      <div
        className="mx-auto flex h-10 w-10 items-center justify-center rounded-[10px] text-primary-foreground"
        title={title}
      >
        <MapPin className="h-5 w-5" />
      </div>
    </div>
  );

  // For managers/barbers: show their fixed sucursal as a static pill on the navy card.
  if (!canSwitch) {
    if (!currentSucursal) return null;
    if (collapsed) return collapsedGlyph(currentSucursal.nombre);

    return (
      <div className="flex items-center gap-2 h-9 px-3 rounded-lg bg-white/10 text-white text-xs ring-1 ring-inset ring-white/10">
        <span className="h-2 w-2 shrink-0 rounded-full bg-[hsl(var(--status-success))] ring-2 ring-status-success/25" />
        <span className="font-medium truncate">{currentSucursal.nombre}</span>
      </div>
    );
  }

  // Don't show if only 1 sucursal and is owner (still show dropdown so they can see it)
  if (sucursales.length <= 1 && !isOwner && !isGeneralManager) return null;

  const triggerLabel = isAllMode
    ? 'Todas las sucursales'
    : (currentSucursal?.nombre || 'Seleccionar sucursal');

  // Single Select — same state, options and onValueChange for both rail and
  // expanded. Only the trigger's visual (icon-only pin vs. full label pill)
  // and the menu's width change with `collapsed`.
  const select = (
    <Select
      value={isAllMode ? '__all__' : (currentSucursal?.id || '')}
      onValueChange={(val) => {
        if (val === '__all__') {
          setCurrentSucursal(null);
        } else {
          setCurrentSucursal(val);
        }
      }}
    >
      <SelectTrigger
        title={collapsed ? `Cambiar de sucursal — ${triggerLabel}` : undefined}
        className={cn(
          'transition-colors',
          collapsed
            ? 'mx-auto flex h-10 w-10 items-center justify-center rounded-[10px] border-0 bg-transparent p-0 text-primary-foreground hover:bg-primary-foreground/15 focus:ring-offset-0 [&>svg]:hidden'
            : 'h-9 rounded-lg border border-white/10 bg-white/10 px-3 text-xs font-medium text-white hover:bg-white/[0.15] focus:ring-white/30 focus:ring-offset-0 [&>svg]:text-white [&>svg]:transition-transform [&>svg]:duration-200 [&>svg]:[transition-timing-function:var(--ease-out-quint)] [&[data-state=open]>svg]:rotate-180',
        )}
      >
        {collapsed ? (
          <span className="grid place-items-center">
            <MapPin className="h-5 w-5" />
          </span>
        ) : (
          <span className="flex items-center gap-2 min-w-0">
            <span
              className={cn(
                'h-2 w-2 shrink-0 rounded-full',
                isAllMode
                  ? 'bg-white/50'
                  : 'bg-[hsl(var(--status-success))] ring-2 ring-status-success/25',
              )}
            />
            <span className="truncate">{triggerLabel}</span>
          </span>
        )}
      </SelectTrigger>
      <SelectContent
        className={cn(
          collapsed ? 'min-w-[10rem]' : 'w-[var(--radix-select-trigger-width)]',
          '[animation-duration:200ms] [animation-timing-function:var(--ease-out-quint)]',
        )}
      >
        <SelectGroup>
          <SelectLabel className="pl-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Sucursales
          </SelectLabel>
          {(isOwner || isGeneralManager) && sucursales.length > 1 && (
            <SelectItem value="__all__" className="data-[highlighted]:bg-muted">
              <span className="flex min-w-0 items-center gap-1.5">
                <Building2 className="h-3 w-3 shrink-0" />
                <span className="truncate">Todas las sucursales</span>
              </span>
            </SelectItem>
          )}
          {sucursales.map((s) => (
            <SelectItem key={s.id} value={s.id} className="data-[highlighted]:bg-muted">
              <span className="flex min-w-0 items-center gap-1.5">
                <MapPin className="h-3 w-3 shrink-0" />
                <span className="truncate">{s.nombre}</span>
              </span>
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );

  // Rail spacing parity with the previous static glyph (which had its own
  // px-2 py-2 wrapper); the expanded case keeps returning the bare Select,
  // untouched, since AppSidebar already wraps it.
  return collapsed ? <div className="px-2 py-2">{select}</div> : select;
}
