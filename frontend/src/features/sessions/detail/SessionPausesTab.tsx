import { useQuery } from "@tanstack/react-query";

import type { SessionPause } from "../../../api/schemas/sessions";
import { DataTable, type DataTableColumn } from "../../../app/components/ui/data-table";
import { EmptyState } from "../../../app/components/ui/empty-state";
import { sessionPausesQuery } from "../queries";
import { formatDateTime, formatDurationBetween } from "./format";

const columns: DataTableColumn<SessionPause>[] = [
  {
    id: "pausedAt",
    header: "Pausada en",
    className: "tabular-nums",
    cell: (pause) => formatDateTime(pause.pausedAt),
  },
  {
    id: "resumedAt",
    header: "Reanudada en",
    className: "tabular-nums",
    cell: (pause) =>
      pause.resumedAt ? formatDateTime(pause.resumedAt) : <span className="text-muted-foreground">Sigue pausada</span>,
  },
  {
    id: "reason",
    header: "Motivo",
    cell: (pause) => pause.reason ?? <span className="text-muted-foreground">Sin motivo</span>,
  },
  {
    id: "duration",
    header: "Duración",
    className: "tabular-nums",
    cell: (pause) => formatDurationBetween(pause.pausedAt, pause.resumedAt) ?? <span className="text-muted-foreground">—</span>,
  },
];

export function SessionPausesTab({ sessionId }: { sessionId: number }) {
  const query = useQuery(sessionPausesQuery(sessionId));
  return (
    <DataTable
      columns={columns}
      rows={query.data ?? []}
      getRowId={(pause) => String(pause.id)}
      loading={query.isPending}
      error={query.isError ? query.error : null}
      onRetry={() => void query.refetch()}
      emptyState={
        <EmptyState
          title="Sin pausas registradas"
          description="Esta sesión no se ha pausado."
        />
      }
    />
  );
}
