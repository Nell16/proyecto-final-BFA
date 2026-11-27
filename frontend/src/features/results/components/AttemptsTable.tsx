import type { ReactNode } from "react";
import { DataTable, type DataTableColumn, type DataTablePagination } from "../../../app/components/ui/data-table";
import { StatusBadge } from "../../../app/components/ui/status-badge";
import type { AttemptSummary } from "../attempts-source";
import { errorMessage } from "../format";
import { ScoreBadge } from "./ScoreBadge";
import { ToneBadge } from "./ToneBadge";

export interface AttemptsTableProps {
  rows: AttemptSummary[];
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  emptyState: ReactNode;
  toolbar?: ReactNode;
  pagination?: DataTablePagination;
  showSession?: boolean;
  /** Intento pedido por deep link: se destaca la fila. */
  highlightedAttemptId?: number;
  renderActions: (attempt: AttemptSummary) => ReactNode;
  label: string;
}

/** Tabla de intentos compartida por Calificaciones y Resultados (consume solo `AttemptSummary`). */
export function AttemptsTable({
  rows,
  loading,
  error,
  onRetry,
  emptyState,
  toolbar,
  pagination,
  showSession = false,
  highlightedAttemptId,
  renderActions,
  label,
}: AttemptsTableProps) {
  const columns: DataTableColumn<AttemptSummary>[] = [
    {
      id: "participant",
      header: "Participante",
      cell: (a) => (
        <div
          className="flex flex-col"
          data-highlighted={a.attemptId === highlightedAttemptId ? "true" : undefined}
          aria-current={a.attemptId === highlightedAttemptId ? "true" : undefined}
        >
          <span className="font-medium text-foreground">{a.participant.fullName}</span>
          {a.participant.code && <span className="font-mono text-xs text-muted-foreground">{a.participant.code}</span>}
          {a.attemptId === highlightedAttemptId && (
            <ToneBadge tone="info" className="mt-1 w-fit">
              Intento solicitado
            </ToneBadge>
          )}
        </div>
      ),
    },
    ...(showSession
      ? [
          {
            id: "session",
            header: "Sesión",
            cell: (a: AttemptSummary) => (
              <div className="flex flex-col">
                <span>{a.session.name}</span>
                <span className="font-mono text-xs text-muted-foreground">{a.session.code}</span>
              </div>
            ),
          } satisfies DataTableColumn<AttemptSummary>,
        ]
      : []),
    {
      id: "attempt",
      header: "Intento",
      className: "tabular-nums",
      cell: (a) => <span className="font-mono text-xs">#{a.attemptId}</span>,
    },
    {
      id: "status",
      header: "Estado",
      cell: (a) => (a.status === "DESCONOCIDO" ? <ToneBadge tone="neutral">Desconocido</ToneBadge> : <StatusBadge domain="attempt" status={a.status} />),
    },
    { id: "score", header: "Calificación", cell: (a) => <ScoreBadge attempt={a} /> },
    {
      id: "actions",
      header: <span className="sr-only">Acciones</span>,
      className: "text-right",
      cell: (a) => <div className="flex flex-wrap items-center justify-end gap-1">{renderActions(a)}</div>,
    },
  ];

  return (
    <section aria-label={label}>
      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(a) => String(a.attemptId)}
        primaryColumnId="participant"
        loading={loading}
        error={error == null ? null : errorMessage(error, "No se pudieron cargar los intentos.")}
        onRetry={onRetry}
        emptyState={emptyState}
        toolbar={toolbar}
        pagination={pagination}
        density="comfortable"
        rowClassName={(a) => (a.attemptId === highlightedAttemptId ? "bg-info-muted/40 ring-2 ring-inset ring-info-border" : undefined)}
      />
    </section>
  );
}
