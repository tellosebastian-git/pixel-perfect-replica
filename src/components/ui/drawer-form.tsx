import * as SheetPrimitive from "@radix-ui/react-dialog";
import { X, type LucideIcon } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";
import { Sheet, SheetOverlay, SheetPortal } from "@/components/ui/sheet";
import { useSwipeToClose } from "@/hooks/use-swipe-to-close";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface DrawerFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  size: "sm" | "md" | "lg";
  children: React.ReactNode;
  /** Omitilo cuando el formulario no necesita acciones fijas al pie (ej. edición inline dentro del body). */
  footer?: React.ReactNode;
  /**
   * Si es true, cerrar vía X, click afuera o Escape pide confirmación
   * ("¿Descartar cambios?") antes de cerrar. Pasale `form.formState.isDirty`.
   * El botón Cancelar de cada consumidor no pasa por acá — sigue cerrando
   * directo, llamando su propia función de cierre en vez de esto.
   */
  isDirty?: boolean;
}

export function DrawerForm({ open, onOpenChange, title, size, children, footer, isDirty = false }: DrawerFormProps) {
  const [confirmDiscardOpen, setConfirmDiscardOpen] = React.useState(false);

  const handleOpenChange = (next: boolean) => {
    if (!next && isDirty) {
      setConfirmDiscardOpen(true);
      return;
    }
    onOpenChange(next);
  };

  const swipeRef = useSwipeToClose({
    open,
    isDirty,
    onAttemptClose: () => handleOpenChange(false),
  });

  return (
    <>
      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetPortal>
          <SheetOverlay />
          <SheetPrimitive.Content
            ref={swipeRef}
            className={cn(
              "fixed right-0 top-0 z-50 flex h-[100svh] flex-col overscroll-contain",
              "bg-card border-l shadow-lg",
              "data-[state=open]:animate-in data-[state=closed]:animate-out",
              "data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right",
              "data-[state=closed]:duration-200 data-[state=open]:duration-300",
              "[animation-timing-function:cubic-bezier(0.23,1,0.32,1)]",
              "w-[calc(100%-48px)]",
              size === "sm" ? "sm:w-[380px]" : size === "md" ? "sm:w-[520px]" : "sm:w-[680px]",
            )}
          >
            {/* Header — zona de swipe-to-close incondicional (no tiene scroll propio) */}
            <div className="flex shrink-0 items-center justify-between border-b px-6 py-4">
              <SheetPrimitive.Title className="text-lg font-semibold text-foreground">
                {title}
              </SheetPrimitive.Title>
              <SheetPrimitive.Close className="rounded-md opacity-70 ring-offset-background transition-opacity duration-150 hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-0 disabled:pointer-events-none">
                <X className="h-4 w-4" />
                <span className="sr-only">Cerrar</span>
              </SheetPrimitive.Close>
            </div>

            {/* Body — scrolleable. Swipe-to-close solo arma acá si scrollTop === 0 */}
            <div className="flex-1 overflow-y-auto overscroll-contain px-6 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
              {children}
            </div>

            {/* Footer — siempre fijo en la parte inferior, si se provee */}
            {footer && (
              <div className="shrink-0 border-t px-6 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
                {footer}
              </div>
            )}
          </SheetPrimitive.Content>
        </SheetPortal>
      </Sheet>

      <AlertDialog open={confirmDiscardOpen} onOpenChange={setConfirmDiscardOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Descartar cambios?</AlertDialogTitle>
            <AlertDialogDescription>
              Tenés cambios sin guardar en este formulario. Si cerrás ahora, se van a perder.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Seguir editando</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                setConfirmDiscardOpen(false);
                onOpenChange(false);
              }}
            >
              Descartar cambios
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

interface DrawerFormSectionProps {
  icon: LucideIcon;
  title: string;
  /** Texto de ayuda bajo el título. Estilo idéntico al de FormDescription
   *  (text-xs text-muted-foreground), pero no puede reusar ese componente:
   *  FormDescription depende de useFormField() y requiere vivir dentro de
   *  un <FormField>, mientras que una sección agrupa varios campos (o
   *  ninguno con nombre propio). */
  description?: string;
  children: React.ReactNode;
}

/**
 * Bloque de sección dentro del body de un DrawerForm: chip de ícono +
 * título + descripción opcional, con el ritmo vertical resuelto adentro.
 * Chip visual idéntico al de BloqueosSection.tsx — ver la regla de color
 * de chip en CRITERIOS_DISEÑO.md §1.9 (bg-primary/10 = "se edita acá").
 */
export function DrawerFormSection({ icon: Icon, title, description, children }: DrawerFormSectionProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Icon className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0">
          <h3 className="truncate text-sm font-medium text-foreground leading-tight">{title}</h3>
          {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
        </div>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}
