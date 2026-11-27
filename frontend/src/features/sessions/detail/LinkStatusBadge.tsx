import { Badge } from "../../../app/components/ui/badge";
import { cn } from "../../../app/components/ui/utils";
import type { AssignmentLinkStatus } from "../../../api/schemas/sessions";

const META: Record<AssignmentLinkStatus, { label: string; classes: string }> = {
  GENERADO: { label: "Generado", classes: "bg-neutral-muted text-neutral-foreground border-neutral-border" },
  ACTIVO: { label: "Activo", classes: "bg-info-muted text-info-foreground border-info-border" },
  VENCIDO: { label: "Vencido", classes: "bg-warning-muted text-warning-foreground border-warning-border" },
  REVOCADO: { label: "Revocado", classes: "bg-danger-muted text-danger-foreground border-danger-border" },
  DESCONOCIDO: { label: "Desconocido", classes: "bg-neutral-muted text-neutral-foreground border-neutral-border" },
};

/** Estado del enlace de acceso (`GENERADO|ACTIVO|VENCIDO|REVOCADO`), con los mismos tonos que `StatusBadge`. */
export function LinkStatusBadge({ status }: { status: AssignmentLinkStatus }) {
  const meta = META[status];
  return (
    <Badge
      data-link-status={status}
      className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium", meta.classes)}
    >
      {meta.label}
    </Badge>
  );
}
