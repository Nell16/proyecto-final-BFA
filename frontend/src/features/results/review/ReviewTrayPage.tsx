import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ClipboardCheck, FileText, RefreshCw } from "lucide-react";

import type { PendingReview } from "../../../api/schemas/results";
import { Button } from "../../../app/components/ui/button";
import { DataTable, type DataTableColumn } from "../../../app/components/ui/data-table";
import { EmptyState } from "../../../app/components/ui/empty-state";
import { PageHeader } from "../../../app/components/ui/page-header";
import { InlineNotice } from "../components/InlineNotice";
import { PendingServerSupportNotice } from "../components/PendingServerSupportNotice";
import { errorMessage, formatDateTime } from "../format";
import { useCanGradeAttempts, useCanViewAttemptResults } from "../permissions";
import { pendingReviewsQuery } from "../queries";
import { ResolveReviewDialog } from "./ResolveReviewDialog";

/** Texto de la respuesta (abierta o numérica) para la tabla. */
const answerText = (review: PendingReview): string =>
  review.textAnswer ?? (review.numericAnswer === null ? "Sin respuesta" : String(review.numericAnswer));

/**
 * Bandeja de revisión manual. `GET /manual-review/pending` admite CALIFICACION_EJECUTAR o RESULTADO_VER;
 * resolver (`PUT /manual-review/{id}`) exige CALIFICACION_EJECUTAR: sin él la bandeja es de solo lectura.
 */
export function ReviewTrayPage() {
  const canGrade = useCanGradeAttempts();
  const canView = useCanViewAttemptResults();
  const query = useQuery(pendingReviewsQuery());
  const [target, setTarget] = useState<PendingReview | null>(null);

  const rows = useMemo(() => [...(query.data ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt)), [query.data]);

  const columns: DataTableColumn<PendingReview>[] = [
    {
      id: "participant",
      header: "Participante",
      cell: (r) => <span className="font-medium text-foreground">{r.participantName}</span>,
    },
    { id: "attempt", header: "Intento", className: "tabular-nums", cell: (r) => <span className="font-mono text-xs">#{r.attemptId}</span> },
    {
      id: "item",
      header: "Ítem",
      cell: (r) => (
        <div className="flex max-w-xs flex-col">
          <span className="font-mono text-xs">{r.itemCode}</span>
          <span className="line-clamp-2 text-xs text-muted-foreground">{r.prompt}</span>
        </div>
      ),
    },
    {
      id: "answer",
      header: "Respuesta",
      cell: (r) => <span className="line-clamp-3 max-w-sm whitespace-pre-wrap text-sm">{answerText(r)}</span>,
    },
    { id: "createdAt", header: "Registrada", className: "tabular-nums", cell: (r) => formatDateTime(r.createdAt) },
    {
      id: "actions",
      header: <span className="sr-only">Acciones</span>,
      className: "text-right",
      cell: (r) => (
        <div className="flex items-center justify-end gap-1">
          {canView && (
            <Button asChild variant="ghost" size="sm">
              <Link
                to="/app/resultados/intento/$attemptId"
                params={{ attemptId: String(r.attemptId) }}
                aria-label={`Ver intento de ${r.participantName}`}
              >
                <FileText className="size-4" aria-hidden="true" />
                Intento
              </Link>
            </Button>
          )}
          {canGrade && (
            <Button type="button" size="sm" onClick={() => setTarget(r)} aria-label={`Revisar respuesta de ${r.participantName} en ${r.itemCode}`}>
              <ClipboardCheck className="size-4" aria-hidden="true" />
              Revisar
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bandeja de revisión manual"
        subtitle="Respuestas abiertas o numéricas que requieren calificación humana."
        actions={
          <Button type="button" variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>
            <RefreshCw className="size-4" aria-hidden="true" />
            Actualizar
          </Button>
        }
      />

      {!canGrade && (
        <InlineNotice tone="info" title="Solo lectura">
          Tu cuenta puede consultar la bandeja, pero no resolver revisiones (requiere permiso de calificación).
        </InlineNotice>
      )}

      <section aria-label="Revisiones pendientes">
        <DataTable
          columns={columns}
          rows={rows}
          getRowId={(r) => String(r.reviewId)}
          primaryColumnId="participant"
          loading={query.isPending}
          error={query.isError ? errorMessage(query.error, "No se pudo cargar la bandeja de revisión.") : null}
          onRetry={() => void query.refetch()}
          emptyState={
            <div className="space-y-4">
              <EmptyState
                title="No hay revisiones disponibles en la bandeja"
                description="Los ítems marcados «Requiere revisión» no aparecen aquí por ahora."
              />
              <PendingServerSupportNotice />
            </div>
          }
          toolbar={
            <p className="text-xs tabular-nums text-muted-foreground" aria-live="polite">
              {query.isSuccess ? `${rows.length} ${rows.length === 1 ? "revisión en la bandeja" : "revisiones en la bandeja"}` : ""}
            </p>
          }
        />
      </section>

      <ResolveReviewDialog review={target} onClose={() => setTarget(null)} />
    </div>
  );
}
