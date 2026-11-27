import { ReactNode } from "react";
import { FolderOpen } from "lucide-react";

interface EmptyStateProps {
  icon?: ReactNode;
  title?: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({
  icon = <FolderOpen className="size-6 text-muted-foreground" aria-hidden="true" />,
  title = "No se encontraron datos",
  description = "No hay registros disponibles para mostrar en este momento.",
  action,
}: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      className="flex min-h-[260px] flex-col items-center justify-center rounded-lg border border-border bg-card px-6 py-10 text-center shadow-[var(--shadow-xs)]"
    >
      <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        {icon}
      </div>
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
        {description}
      </p>
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}
