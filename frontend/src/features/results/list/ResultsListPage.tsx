import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ClipboardCheck, Eye, FileText, RefreshCw, Search } from "lucide-react";

import type { AttemptStatus } from "../../../api/schemas/results";
import { Button } from "../../../app/components/ui/button";
import { EmptyState } from "../../../app/components/ui/empty-state";
import { Input } from "../../../app/components/ui/input";
import { PageHeader } from "../../../app/components/ui/page-header";
import { DEFAULT_ATTEMPTS_PAGE_SIZE } from "../attempts-source";
import { AttemptsTable } from "../components/AttemptsTable";
import { ErrorPanel } from "../components/ErrorPanel";
import { NativeSelect } from "../components/NativeSelect";
import { SourceUnavailable } from "../components/SourceUnavailable";
import type { SessionSearch } from "../gradingSearch";
import { useAttemptsSourceAvailable, useCanGradeAttempts, useCanViewAttemptResults } from "../permissions";
import { attemptsQuery, sessionOptionsQuery } from "../queries";

type StatusFilter = "ALL" | Exclude<AttemptStatus, "DESCONOCIDO">;
type ScoredFilter = "ALL" | "SCORED" | "PENDING";

const STATUS_OPTIONS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: "ALL", label: "Todos los estados" },
  { value: "COMPLETADO", label: "Completado" },
  { value: "EN_PROGRESO", label: "En progreso" },
  { value: "INTERRUMPIDO", label: "Interrumpido" },
  { value: "ANULADO", label: "Anulado" },
  { value: "NO_INICIADO", label: "No iniciado" },
];

const SCORED_OPTIONS: ReadonlyArray<{ value: ScoredFilter; label: string }> = [
  { value: "ALL", label: "Toda calificación" },
  { value: "SCORED", label: "Calificados" },
  { value: "PENDING", label: "Sin calificar" },
];

export interface ResultsListPageProps {
  search: SessionSearch;
  /** `undefined` = todas las sesiones. */
  onSessionChange: (sessionId: number | undefined) => void;
}

/** Resultados individuales: intentos de una sesión (o de todas) con acceso a respuestas y baremo. */
export function ResultsListPage({ search, onSessionChange }: ResultsListPageProps) {
  const available = useAttemptsSourceAvailable();
  const canView = useCanViewAttemptResults();
  const canGrade = useCanGradeAttempts();
  const sessions = useQuery({ ...sessionOptionsQuery(), enabled: available });

  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [scored, setScored] = useState<ScoredFilter>("ALL");
  const [participant, setParticipant] = useState("");
  const [page, setPage] = useState(1);

  // Una sesión de la URL que no existe en la lista fresca se trata como «todas».
  const sessionId =
    sessions.isSuccess && search.sessionId !== undefined && sessions.data.some((s) => s.id === search.sessionId)
      ? search.sessionId
      : undefined;
  const sessionsReady = sessions.isSuccess;

  const query = useMemo(
    () => ({
      sessionId,
      ...(status !== "ALL" ? { status } : {}),
      ...(scored !== "ALL" ? { scored: scored === "SCORED" } : {}),
      ...(participant.trim() !== "" ? { participantCode: participant.trim() } : {}),
      page,
      size: DEFAULT_ATTEMPTS_PAGE_SIZE,
    }),
    [sessionId, status, scored, participant, page],
  );
  const attempts = useQuery({ ...attemptsQuery(query), enabled: available && sessionsReady });

  const hasFilters = status !== "ALL" || scored !== "ALL" || participant.trim() !== "" || sessionId !== undefined;
  const clearFilters = () => {
    setStatus("ALL");
    setScored("ALL");
    setParticipant("");
    setPage(1);
    onSessionChange(undefined);
  };

  const header = (
    <PageHeader
      title="Resultados individuales"
      subtitle="Consulta las respuestas y el resultado con baremo de cada intento."
      actions={
        <Button type="button" variant="outline" disabled={!sessionsReady || attempts.isFetching} onClick={() => void attempts.refetch()}>
          <RefreshCw className="size-4" aria-hidden="true" />
          Actualizar
        </Button>
      }
    />
  );

  if (!available) {
    return (
      <div className="space-y-6">
        {header}
        <SourceUnavailable context="Para consultar resultados necesitas elegir un intento." />
      </div>
    );
  }

  if (sessions.isError) {
    return (
      <div className="space-y-6">
        {header}
        <ErrorPanel error={sessions.error} title="No se pudo cargar la lista de sesiones" onRetry={() => void sessions.refetch()} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}
      <AttemptsTable
        label="Intentos"
        showSession
        rows={attempts.data?.items ?? []}
        loading={!sessionsReady || attempts.isPending}
        error={attempts.isError ? attempts.error : null}
        onRetry={() => void attempts.refetch()}
        pagination={{
          page,
          pageSize: DEFAULT_ATTEMPTS_PAGE_SIZE,
          total: attempts.data?.total ?? 0,
          onPageChange: setPage,
        }}
        emptyState={
          hasFilters ? (
            <EmptyState
              title="Sin resultados para este filtro"
              description="Ningún intento coincide con la sesión, el estado o la búsqueda seleccionados."
              action={
                <Button type="button" variant="outline" onClick={clearFilters}>
                  Limpiar filtros
                </Button>
              }
            />
          ) : (
            <EmptyState title="Sin intentos aún" description="Todavía no hay intentos registrados." />
          )
        }
        toolbar={
          <>
            <div className="flex flex-wrap items-center gap-2">
              <NativeSelect
                aria-label="Filtrar por sesión"
                className="w-64"
                value={sessionId === undefined ? "" : String(sessionId)}
                disabled={!sessionsReady}
                onChange={(event) => {
                  setPage(1);
                  onSessionChange(event.target.value === "" ? undefined : Number(event.target.value));
                }}
              >
                <option value="">Todas las sesiones</option>
                {(sessions.data ?? []).map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name} ({option.code})
                  </option>
                ))}
              </NativeSelect>
              <NativeSelect
                aria-label="Filtrar por estado"
                className="w-44"
                value={status}
                onChange={(event) => {
                  setPage(1);
                  setStatus(event.target.value as StatusFilter);
                }}
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </NativeSelect>
              <NativeSelect
                aria-label="Filtrar por calificación"
                className="w-44"
                value={scored}
                onChange={(event) => {
                  setPage(1);
                  setScored(event.target.value as ScoredFilter);
                }}
              >
                {SCORED_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </NativeSelect>
              <div className="relative">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  type="search"
                  value={participant}
                  onChange={(event) => {
                    setPage(1);
                    setParticipant(event.target.value);
                  }}
                  placeholder="Buscar por nombre o código"
                  aria-label="Buscar participante"
                  className="w-60 pl-8"
                />
              </div>
              {hasFilters && (
                <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
                  Limpiar filtros
                </Button>
              )}
            </div>
            <p className="text-xs tabular-nums text-muted-foreground" aria-live="polite">
              {attempts.isSuccess ? `${attempts.data.total} ${attempts.data.total === 1 ? "intento" : "intentos"}` : ""}
            </p>
          </>
        }
        renderActions={(attempt) => (
          <>
            {canView && (
              <Button asChild variant="ghost" size="sm">
                <Link
                  to="/app/resultados/intento/$attemptId"
                  params={{ attemptId: String(attempt.attemptId) }}
                  aria-label={`Ver respuestas de ${attempt.participant.fullName}`}
                >
                  <FileText className="size-4" aria-hidden="true" />
                  Respuestas
                </Link>
              </Button>
            )}
            {canView && attempt.scored === true && (
              <Button asChild variant="ghost" size="sm">
                <Link
                  to="/app/resultados/individual/$attemptId"
                  params={{ attemptId: String(attempt.attemptId) }}
                  aria-label={`Ver baremo de ${attempt.participant.fullName}`}
                >
                  <Eye className="size-4" aria-hidden="true" />
                  Baremo
                </Link>
              </Button>
            )}
            {canGrade && attempt.status === "COMPLETADO" && attempt.scored !== true && (
              <Button asChild variant="ghost" size="sm">
                <Link
                  to="/app/calificaciones"
                  search={{ sessionId: attempt.session.id, attemptId: attempt.attemptId }}
                  aria-label={`Calificar a ${attempt.participant.fullName}`}
                >
                  <ClipboardCheck className="size-4" aria-hidden="true" />
                  Calificar
                </Link>
              </Button>
            )}
          </>
        )}
      />
    </div>
  );
}
