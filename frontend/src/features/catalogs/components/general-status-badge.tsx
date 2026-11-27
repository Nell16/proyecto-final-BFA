import type { GeneralStatus } from "../../../api/schemas/academic";
import { Badge } from "../../../app/components/ui/badge";
import { cn } from "../../../app/components/ui/utils";

const META: Record<GeneralStatus, { label: string; className: string }> = {
  ACTIVO: { label: "Activo", className: "bg-success-muted text-success-foreground border-success-border" },
  INACTIVO: { label: "Inactivo", className: "bg-neutral-muted text-neutral-foreground border-neutral-border" },
  DESCONOCIDO: { label: "Desconocido", className: "bg-neutral-muted text-neutral-foreground border-neutral-border" },
};

/** Badge del estado general (ACTIVO/INACTIVO) de catálogos y participantes. */
export function GeneralStatusBadge({ status }: { status: GeneralStatus }) {
  const meta = META[status];
  return <Badge className={cn(meta.className)}>{meta.label}</Badge>;
}
