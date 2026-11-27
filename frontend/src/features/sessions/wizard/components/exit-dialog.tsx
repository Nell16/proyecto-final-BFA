import { Button } from "../../../../app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../../app/components/ui/dialog";

interface ExitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionCode: string;
  /** Solo con SESION_APLICAR y si la máquina de estados permite cancelar la sesión. */
  canCancel: boolean;
  onKeepScheduled: () => void;
  onCancelSession: () => void;
}

/** Salida del wizard con la sesión ya creada en el servidor: dejarla programada o cancelarla. */
export function ExitDialog({ open, onOpenChange, sessionCode, canCancel, onKeepScheduled, onCancelSession }: ExitDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Salir del asistente</DialogTitle>
          <DialogDescription>
            La sesión <span className="font-mono">{sessionCode}</span> ya fue creada. ¿Qué desea hacer con ella?
          </DialogDescription>
        </DialogHeader>
        {!canCancel && (
          <p className="text-sm text-muted-foreground">
            Su rol no puede cancelar la sesión desde aquí; puede dejarla programada y retomarla después.
          </p>
        )}
        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Seguir editando
          </Button>
          <Button type="button" variant="outline" onClick={onKeepScheduled}>
            Dejar como programada
          </Button>
          {canCancel && (
            <Button type="button" variant="destructive" onClick={onCancelSession}>
              Cancelar sesión creada
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
