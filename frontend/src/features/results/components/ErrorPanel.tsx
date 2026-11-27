import { AlertCircle } from "lucide-react";
import { Button } from "../../../app/components/ui/button";
import { errorMessage } from "../format";

/** Estado de error de pantalla completa (ui-style-spec §3.6): mensaje humano + «Reintentar». */
export function ErrorPanel({
  error,
  title = "No se pudo cargar la información",
  onRetry,
}: {
  error: unknown;
  title?: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center rounded-lg border border-danger-border bg-danger-muted/60 p-6 text-center"
    >
      <AlertCircle aria-hidden="true" className="mb-2 size-6 text-danger-foreground" />
      <p className="text-sm font-semibold text-danger-foreground">{title}</p>
      <p className="mt-1 text-sm text-danger-foreground">{errorMessage(error, "Ocurrió un error inesperado.")}</p>
      {onRetry && (
        <Button type="button" variant="outline" size="sm" className="mt-4" onClick={onRetry}>
          Reintentar
        </Button>
      )}
    </div>
  );
}
