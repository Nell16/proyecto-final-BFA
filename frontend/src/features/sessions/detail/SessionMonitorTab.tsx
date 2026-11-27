import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ClipboardCheck, Eye, MessageSquare, Search } from "lucide-react";

import type { Assignment } from "../../../api/schemas/sessions";
import { Badge } from "../../../app/components/ui/badge";
import { Button } from "../../../app/components/ui/button";
import { DataTable, type DataTableColumn } from "../../../app/components/ui/data-table";
import { EmptyState } from "../../../app/components/ui/empty-state";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../../app/components/ui/dialog";
import { Input } from "../../../app/components/ui/input";
import { Progress } from "../../../app/components/ui/progress";
import { StatusBadge } from "../../../app/components/ui/status-badge";
import { cn } from "../../../app/components/ui/utils";
import { sessionAssignmentsQuery, sessionDetailQuery } from "../queries";
import { IncidenceForm } from "./IncidenceForm";
import { LinkStatusBadge } from "./LinkStatusBadge";
import { formatDateTime, formatRelative, formatTime } from "./format";
import {
  deriveKpis,
  matchesKpi,
  sortForMonitor,
  toAttemptStatus,
  useCanApplySessions,
  useCanGrade,
  useCanViewResults,
  type KpiKey,
} from "./model";

const KPI_DEFS: ReadonlyArray<{ key: KpiKey; label: string }> = [
  { key: "assigned", label: "Asignados" },
  { key: "inProgress", label: "En curso" },
  { key: "completed", label: "Completados" },
  { key: "interrupted", label: "Interrumpidos" },
  { key: "notStarted", label: "Sin iniciar" },
];

export function SessionMonitorTab({ sessionId }: { sessionId: number }) {
  const canApply = useCanApplySessions();
  const canViewResults = useCanViewResults();
  const canGrade = useCanGrade();

  const sessionQuery = useQuery(sessionDetailQuery(sessionId));
  const query = useQuery(sessionAssignmentsQuery(sessionId, { pollWhile: sessionQuery.data?.status }));
  const [kpiFilter, setKpiFilter] = useState<KpiKey>("assigned");
  const [search, setSearch] = useState("");
  const [noteTarget, setNoteTarget] = useState<Assignment | null>(null);
  const [rejectedTarget, setRejectedTarget] = useState<Assignment | null>(null);

  const assignments = useMemo(() => query.data ?? [], [query.data]);
  const kpis = useMemo(() => deriveKpis(assignments), [assignments]);
  const totalRejectedAnswers = useMemo(
    () => assignments.reduce((sum, a) => sum + a.rejectedAnswersCount, 0),
    [assignments],
  );
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return sortForMonitor(
      assignments.filter(
        (a) =>
          matchesKpi(a, kpiFilter) &&
          (needle === "" ||
            a.participantName.toLowerCase().includes(needle) ||
            (a.participantCode ?? "").toLowerCase().includes(needle)),
      ),
    );
  }, [assignments, kpiFilter, search]);

  const progressPercent = kpis.assigned === 0 ? 0 : Math.round((kpis.completed / kpis.assigned) * 100);

  const columns: DataTableColumn<Assignment>[] = [
    {
      id: "participant",
      header: "Participante",
      cell: (a) => (
        <div className="flex flex-col">
          <span className="font-medium text-foreground">{a.participantName}</span>
          {a.participantCode && (
            <span className="font-mono text-xs text-muted-foreground">{a.participantCode}</span>
          )}
        </div>
      ),
    },
    {
      id: "subtest",
      header: "Subtest actual",
      cell: (a) => a.currentSubtestId ?? <span className="text-muted-foreground">—</span>,
    },
    {
      id: "progress",
      header: "Progreso",
      cell: (a) => (
        <div className="flex items-center gap-2">
          <Progress value={a.progress} className="h-1.5 w-24" aria-label={`Progreso de ${a.participantName}`} />
          <span className="text-xs tabular-nums text-muted-foreground">{Math.round(a.progress)}%</span>
        </div>
      ),
    },
    {
      id: "attemptState",
      header: "Intento",
      cell: (a) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge domain="attempt" status={toAttemptStatus(a.attemptState)} />
          {a.rejectedAnswersCount > 0 &&
            (a.rejectedAnswers.length > 0 ? (
              <button
                type="button"
                onClick={() => setRejectedTarget(a)}
                aria-label={`Ver ${a.rejectedAnswersCount} ${
                  a.rejectedAnswersCount === 1 ? "respuesta rechazada" : "respuestas rechazadas"
                } de ${a.participantName}`}
                className="inline-flex items-center gap-1 rounded-md border border-status-danger-border bg-status-danger-bg px-2 py-0.5 text-xs font-medium text-status-danger-fg hover:opacity-90 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring cursor-pointer"
              >
                <AlertTriangle className="size-3 shrink-0" aria-hidden="true" />
                <span className="tabular-nums">
                  {a.rejectedAnswersCount} {a.rejectedAnswersCount === 1 ? "rechazo" : "rechazos"}
                </span>
              </button>
            ) : (
              <Badge
                variant="outline"
                className="border-status-danger-border bg-status-danger-bg text-status-danger-fg"
              >
                <AlertTriangle className="size-3 shrink-0" aria-hidden="true" />
                <span className="tabular-nums">
                  {a.rejectedAnswersCount} {a.rejectedAnswersCount === 1 ? "rechazo" : "rechazos"}
                </span>
              </Badge>
            ))}
        </div>
      ),
    },
    {
      id: "linkStatus",
      header: "Enlace",
      cell: (a) => <LinkStatusBadge status={a.linkStatus} />,
    },
    {
      id: "lastActivity",
      header: "Última actividad",
      cell: (a) =>
        a.lastActivityAt ? (
          <time dateTime={a.lastActivityAt} title={formatDateTime(a.lastActivityAt)} className="text-sm tabular-nums">
            {formatRelative(a.lastActivityAt)}
          </time>
        ) : (
          <span className="text-muted-foreground">Sin actividad</span>
        ),
    },
    {
      id: "actions",
      header: <span className="sr-only">Acciones</span>,
      className: "text-right",
      cell: (a) => (
        <div className="flex flex-wrap items-center justify-end gap-1">
          {canApply && a.linkStatus !== "REVOCADO" && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setNoteTarget(a)}
              aria-label={`Agregar nota para ${a.participantName}`}
            >
              <MessageSquare className="size-4" aria-hidden="true" />
              Nota
            </Button>
          )}
          {canViewResults && a.attemptId != null && (
            <Button asChild variant="ghost" size="sm">
              <Link
                to="/app/resultados/intento/$attemptId"
                params={{ attemptId: String(a.attemptId) }}
                aria-label={`Ver respuestas de ${a.participantName}`}
              >
                <Eye className="size-4" aria-hidden="true" />
                Ver respuestas
              </Link>
            </Button>
          )}
          {canGrade && a.attemptState === "completado" && (
            <Button asChild variant="ghost" size="sm">
              <Link to="/app/calificaciones" search={{ sessionId, attemptId: a.attemptId ?? undefined }} aria-label={`Calificar a ${a.participantName}`}>
                <ClipboardCheck className="size-4" aria-hidden="true" />
                Calificar
              </Link>
            </Button>
          )}
        </div>
      ),
    },
  ];

  const hasFilters = kpiFilter !== "assigned" || search.trim() !== "";

  return (
    <div className="space-y-4">
      <section aria-label="Resumen de la sesión" className="space-y-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground tabular-nums">
          <span>
            {kpis.completed}/{kpis.assigned} completados
          </span>
          <Progress
            value={progressPercent}
            className="h-1.5 w-40"
            aria-label="Avance global de la sesión"
          />
          <span>{progressPercent}%</span>
          {totalRejectedAnswers > 0 && (
            <Badge
              variant="outline"
              className="border-status-danger-border bg-status-danger-bg text-status-danger-fg"
            >
              <AlertTriangle className="size-3 shrink-0" aria-hidden="true" />
              <span className="tabular-nums">
                {totalRejectedAnswers}{" "}
                {totalRejectedAnswers === 1 ? "respuesta rechazada" : "respuestas rechazadas"}
              </span>
            </Badge>
          )}
          {query.dataUpdatedAt > 0 && <span>Actualizado {formatTime(new Date(query.dataUpdatedAt).toISOString())}</span>}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {KPI_DEFS.map(({ key, label }) => {
            const active = kpiFilter === key;
            const alert = key === "interrupted" && kpis.interrupted > 0;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={active}
                onClick={() => setKpiFilter(active && key !== "assigned" ? "assigned" : key)}
                data-kpi={key}
                className={cn(
                  "rounded-lg border bg-card p-4 text-left shadow-[var(--shadow-xs)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-muted/40",
                  active ? "border-primary" : "border-border",
                  alert && "border-warning-border bg-warning-muted/50",
                )}
              >
                <span className="block text-sm text-muted-foreground">{label}</span>
                <span className="block text-2xl font-semibold tabular-nums text-foreground">
                  {query.isSuccess ? kpis[key] : "–"}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <DataTable
        columns={columns}
        rows={rows}
        density="comfortable"
        getRowId={(a) => String(a.assignmentId)}
        loading={query.isPending}
        error={query.isError ? query.error : null}
        onRetry={() => void query.refetch()}
        rowClassName={(a) =>
          a.attemptState === "interrumpido" ? "border-l-2 border-l-warning bg-warning-muted/30" : undefined
        }
        emptyState={
          hasFilters ? (
            <EmptyState
              title="Sin resultados para este filtro"
              description="Ningún participante coincide con la búsqueda o el indicador seleccionado."
              action={
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setKpiFilter("assigned");
                    setSearch("");
                  }}
                >
                  Limpiar filtros
                </Button>
              }
            />
          ) : (
            <EmptyState
              title="Sin participantes asignados"
              description="Agrega participantes en la pestaña «Participantes y accesos»."
            />
          )
        }
        toolbar={
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar participante"
              aria-label="Buscar participante"
              className="w-64 pl-8"
            />
          </div>
        }
      />

      <Dialog open={rejectedTarget !== null} onOpenChange={(open) => !open && setRejectedTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Respuestas rechazadas de {rejectedTarget?.participantName}</DialogTitle>
            <DialogDescription>
              Respuestas que el servidor rechazó definitivamente durante la aplicación.
            </DialogDescription>
          </DialogHeader>
          {rejectedTarget && (
            <ul className="space-y-2 text-sm">
              {rejectedTarget.rejectedAnswers.map((entry, idx) => (
                <li
                  key={`${entry.itemId}-${entry.code}-${idx}`}
                  className="flex items-center justify-between gap-3 rounded-md border border-status-danger-border bg-status-danger-bg px-3 py-2 text-status-danger-fg"
                >
                  <div>
                    <span className="font-semibold">Ítem #{entry.itemId}</span>
                    <span className="mx-1.5" aria-hidden="true">
                      ·
                    </span>
                    <span className="font-mono text-xs">{entry.code}</span>
                  </div>
                  {entry.rejectedAt && (
                    <time dateTime={entry.rejectedAt} className="text-xs tabular-nums">
                      {formatTime(entry.rejectedAt)}
                    </time>
                  )}
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={noteTarget !== null} onOpenChange={(open) => !open && setNoteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nota de incidencia</DialogTitle>
            <DialogDescription>
              Queda registrada en la sesión y asociada al participante.
            </DialogDescription>
          </DialogHeader>
          {noteTarget && (
            <IncidenceForm
              sessionId={sessionId}
              participants={[
                {
                  id: noteTarget.participantId,
                  name: noteTarget.participantName,
                  ...(noteTarget.participantCode ? { code: noteTarget.participantCode } : {}),
                },
              ]}
              lockedParticipantId={noteTarget.participantId}
              submitLabel="Guardar nota"
              onRecorded={() => setNoteTarget(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
