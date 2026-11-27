import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ClipboardCheck, Eye, FileText, Loader2, RefreshCw } from "lucide-react";

import { Button } from "../../../app/components/ui/button";
import { EmptyState } from "../../../app/components/ui/empty-state";
import { PageHeader } from "../../../app/components/ui/page-header";
import { Skeleton } from "../../../app/components/ui/skeleton";
import { ConfirmDialog } from "../../../app/components/ui/confirm-dialog";
import { captureAccountScope, isAccountChangedError } from "../../../store/accountScope";
import { DEFAULT_ATTEMPTS_PAGE_SIZE, type AttemptSummary, type AttemptsQuery } from "../attempts-source";
import { AttemptsTable } from "../components/AttemptsTable";
import { ErrorPanel } from "../components/ErrorPanel";
import { InlineNotice } from "../components/InlineNotice";
import { NativeSelect } from "../components/NativeSelect";
import { SourceUnavailable } from "../components/SourceUnavailable";
import { errorMessage, formatScore } from "../format";
import { resolveGradingSelection, type GradingSearch } from "../gradingSearch";
import { useScoreAttempt } from "../mutations";
import { useAttemptsSourceAvailable, useCanGradeAttempts, useCanViewAttemptResults } from "../permissions";
import { attemptsQuery, sessionOptionsQuery } from "../queries";

/** Tamaño de página de la tabla de Calificaciones (cada página sondea el estado de calificación de sus filas). */
export const GRADING_PAGE_SIZE = DEFAULT_ATTEMPTS_PAGE_SIZE;

/** Reloj fuera del render (la marca de selección se toma al detectar el cambio de selección). */
const nowMs = (): number => Date.now();

export interface GradingPageProps {
  /** Search de la ruta (`?sessionId&attemptId`, enviado por «Calificar» en el monitor). */
  search: GradingSearch;
  /** Cambia la sesión en la URL (la selección vive en la URL: no hay estado local que desincronizar). */
  onSessionChange: (sessionId: number) => void;
}

/**
 * Calificación de intentos. La sesión se DERIVA de la URL y de la lista de sesiones FRESCA:
 *  - Reintentar: si falla la lista de sesiones se muestra el error con «Reintentar» (nada queda a medias).
 *  - Nada se habilita antes de validar: los intentos, «Actualizar» y «Calificar» esperan a que la sesión
 *    (pedida o por defecto) exista en la lista fresca.
 *  - Respuestas tardías: los intentos se piden con la sesión en la query key; una respuesta de otra sesión
 *    nunca se publica bajo la selección vigente.
 *  - Lectura FRESCA: la caché (de una visita anterior) puede pintar filas, pero «Actualizar» y «Calificar» solo se
 *    habilitan cuando la lectura de la sesión vigente terminó con éxito DESPUÉS de seleccionarla
 *    (`dataUpdatedAt >= instante de la selección`; se reinicia al cambiar de sesión/página/deep link) y no hay otra
 *    lectura en curso. La query usa `staleTime: 0`, de modo que cambiar de key relee SIEMPRE, aunque la caché
 *    global (30 s) tenga esa sesión; mientras tanto se muestran las filas cacheadas con «Actualizando…».
 *  - Deep link: `attemptId` se localiza ANTES del corte de página (la fuente devuelve la página que lo contiene).
 */
export function GradingPage({ search, onSessionChange }: GradingPageProps) {
  const canGrade = useCanGradeAttempts();
  const canViewResults = useCanViewAttemptResults();
  const available = useAttemptsSourceAvailable();

  const sessionsQuery = useQuery({ ...sessionOptionsQuery(), enabled: available });
  // Lista de sesiones FRESCA: éxito y obtenida después del montaje (nunca solo de caché).
  const validated = sessionsQuery.isSuccess && sessionsQuery.isFetchedAfterMount;
  const options = useMemo(() => sessionsQuery.data ?? [], [sessionsQuery.data]);
  const selection = validated ? resolveGradingSelection(options, search.sessionId) : null;
  const sessionId = selection?.sessionId;

  // Página elegida por el usuario. Pertenece a una selección (sesión + intento pedido): si esta cambia, vale
  // de nuevo la localización del deep link (sin estado que reiniciar a mano).
  const scopeKey = `${sessionId ?? ""}:${search.attemptId ?? ""}`;
  const [pageChoice, setPageChoice] = useState<{ scopeKey: string; page: number } | null>(null);
  const requestedPage = pageChoice?.scopeKey === scopeKey ? pageChoice.page : undefined;
  const highlighted = search.attemptId;

  const attemptsParams: AttemptsQuery = {
    sessionId,
    size: GRADING_PAGE_SIZE,
    ...(requestedPage !== undefined
      ? { page: requestedPage }
      : highlighted !== undefined
        ? { locateAttemptId: highlighted }
        : {}),
  };

  // Marca de frescura POR SELECCIÓN (sesión + página/deep link): instante en que se eligió la lectura vigente.
  // Se ajusta durante el render al cambiar la selección (sin effect); la petición que dispara la nueva key
  // empieza después de este instante, así que solo una respuesta posterior lo satisface.
  const readKey = JSON.stringify(attemptsParams);
  const [selectedAt, setSelectedAt] = useState<{ readKey: string; at: number }>(() => ({ readKey, at: nowMs() }));
  if (selectedAt.readKey !== readKey) setSelectedAt({ readKey, at: nowMs() });
  const selectionInstant = selectedAt.readKey === readKey ? selectedAt.at : Number.POSITIVE_INFINITY;

  const attempts = useQuery({
    ...attemptsQuery(attemptsParams),
    // Al paginar se conserva la página anterior mientras llega la nueva, pero NUNCA las filas de otra sesión.
    placeholderData: (previous, previousQuery) =>
      (previousQuery?.queryKey[2] as AttemptsQuery | undefined)?.sessionId === sessionId ? previous : undefined,
    // La caché no basta para habilitar acciones: cambiar de sesión/página (o montar) relee SIEMPRE, aunque la
    // caché global (30 s) ya tenga esa key. Las filas cacheadas se pintan mientras tanto.
    staleTime: 0,
    refetchOnMount: "always",
    enabled: available && validated && sessionId !== undefined,
  });

  // Lectura vigente y fresca: éxito obtenido DESPUÉS de seleccionar, sin placeholder de otra página ni otra lectura en curso.
  const attemptsReady =
    attempts.isSuccess &&
    attempts.dataUpdatedAt >= selectionInstant &&
    !attempts.isPlaceholderData &&
    !attempts.isFetching;

  const rows = useMemo(() => attempts.data?.items ?? [], [attempts.data]);
  const highlightedFound = highlighted !== undefined && rows.some((a) => a.attemptId === highlighted);
  const currentPage = attempts.data?.page ?? requestedPage ?? 1;

  useEffect(() => {
    if (!highlightedFound) return;
    document.querySelector<HTMLElement>('[data-highlighted="true"]')?.scrollIntoView?.({ block: "center" });
  }, [highlightedFound]);

  const score = useScoreAttempt();
  // El objetivo de la confirmación pertenece a una selección (sesión + página): si esta cambia con el diálogo
  // abierto, el objetivo deja de ser vigente (se DERIVA, sin sincronizar estado en un effect).
  const selectionKey = `${sessionId ?? ""}:${currentPage}`;
  const [confirmState, setConfirmState] = useState<{ attempt: AttemptSummary; selectionKey: string } | null>(null);
  const confirmTarget = confirmState?.selectionKey === selectionKey ? confirmState.attempt : null;
  const setConfirmTarget = (attempt: AttemptSummary | null) =>
    setConfirmState(attempt === null ? null : { attempt, selectionKey });

  const handleScore = async (attempt: AttemptSummary) => {
    // Al confirmar se revalida que la selección sigue vigente: lectura fresca de la misma sesión que contiene el intento.
    if (!attemptsReady || sessionId !== attempt.session.id || !rows.some((a) => a.attemptId === attempt.attemptId)) {
      setConfirmTarget(null);
      toast.warning("La selección cambió. Actualiza la lista e inténtalo de nuevo.");
      return;
    }
    const scope = captureAccountScope();
    try {
      const result = await score.mutateAsync(attempt.attemptId);
      if (!scope.isCurrent()) return;
      toast.success(
        result.requiresManualReview
          ? `Intento #${attempt.attemptId} calificado: ${formatScore(result.totalDirectScore)} pts. ${result.pendingReviewCount} respuestas requieren revisión manual.`
          : `Intento #${attempt.attemptId} calificado: ${formatScore(result.totalDirectScore)} pts.`,
      );
    } catch (error) {
      if (isAccountChangedError(error) || !scope.isCurrent()) return;
      toast.error(errorMessage(error, "No se pudo calificar el intento."));
      throw error; // el diálogo permanece abierto para reintentar
    }
  };

  const header = (
    <PageHeader
      title="Calificación de intentos"
      subtitle="Ejecuta la calificación de los intentos completados de una sesión."
      actions={
        <Button
          type="button"
          variant="outline"
          disabled={!validated || sessionId === undefined || attempts.isFetching}
          onClick={() => void attempts.refetch()}
        >
          {attempts.isFetching && validated ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="size-4" aria-hidden="true" />
          )}
          Actualizar
        </Button>
      }
    />
  );

  if (!available) {
    return (
      <div className="space-y-6">
        {header}
        <SourceUnavailable context="Para calificar necesitas elegir un intento." />
      </div>
    );
  }

  if (sessionsQuery.isError) {
    return (
      <div className="space-y-6">
        {header}
        <ErrorPanel
          error={sessionsQuery.error}
          title="No se pudo cargar la lista de sesiones"
          onRetry={() => void sessionsQuery.refetch()}
        />
      </div>
    );
  }

  if (!validated) {
    return (
      <div className="space-y-6" aria-busy="true">
        {header}
        <p role="status" className="sr-only">
          Cargando sesiones…
        </p>
        <Skeleton className="h-9 w-80" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (options.length === 0) {
    return (
      <div className="space-y-6">
        {header}
        <EmptyState title="No hay sesiones para calificar" description="Todavía no se ha programado ninguna sesión de aplicación." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}

      {selection?.requestedMissing && (
        <InlineNotice tone="warning" title="Sesión no encontrada">
          {search.sessionId !== undefined
            ? `La sesión #${search.sessionId} solicitada no está en la lista de sesiones actual. Se muestra la más reciente.`
            : "La sesión solicitada no está disponible."}
        </InlineNotice>
      )}

      {highlighted !== undefined && attemptsReady && requestedPage === undefined && attempts.data?.located === false && (
        <InlineNotice tone="warning" title={`Intento #${highlighted} no encontrado`}>
          El intento solicitado no pertenece a la sesión seleccionada.
        </InlineNotice>
      )}

      <AttemptsTable
        label="Intentos de la sesión"
        rows={rows}
        loading={attempts.isPending}
        error={attempts.isError ? attempts.error : null}
        onRetry={() => void attempts.refetch()}
        highlightedAttemptId={highlighted}
        pagination={{
          page: currentPage,
          pageSize: GRADING_PAGE_SIZE,
          total: attempts.data?.total ?? 0,
          onPageChange: (page) => setPageChoice({ scopeKey, page }),
        }}
        emptyState={
          <EmptyState title="Sin intentos" description="Esta sesión todavía no tiene intentos iniciados." />
        }
        toolbar={
          <>
            <div className="flex items-center gap-2">
              <label htmlFor="grading-session" className="text-sm font-medium text-foreground">
                Sesión
              </label>
              <NativeSelect
                id="grading-session"
                className="w-72"
                value={sessionId === undefined ? "" : String(sessionId)}
                onChange={(event) => onSessionChange(Number(event.target.value))}
              >
                {options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name} ({option.code})
                  </option>
                ))}
              </NativeSelect>
            </div>
            <p className="text-xs tabular-nums text-muted-foreground" aria-live="polite">
              {attempts.isSuccess ? `${attempts.data.total} ${attempts.data.total === 1 ? "intento" : "intentos"}` : ""}
              {attempts.isSuccess && !attemptsReady && attempts.isFetching ? <span> · Actualizando…</span> : null}
            </p>
          </>
        }
        renderActions={(attempt) => (
          <>
            {canViewResults && (
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
            {canViewResults && attempt.scored === true && (
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
              <Button
                type="button"
                size="sm"
                disabled={score.isPending || !attemptsReady}
                onClick={() => setConfirmTarget(attempt)}
                aria-label={`Calificar a ${attempt.participant.fullName}`}
              >
                {score.isPending && score.variables === attempt.attemptId ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <ClipboardCheck className="size-4" aria-hidden="true" />
                )}
                Calificar
              </Button>
            )}
          </>
        )}
      />

      <ConfirmDialog
        open={confirmTarget !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmTarget(null);
        }}
        title={confirmTarget ? `¿Calificar el intento #${confirmTarget.attemptId}?` : "¿Calificar el intento?"}
        description={
          confirmTarget
            ? `Se calculará el puntaje de ${confirmTarget.participant.fullName} con la clave oficial de la versión aplicada. Si el intento ya tiene resultado, se conserva el existente.`
            : undefined
        }
        confirmLabel="Calificar"
        onConfirm={async () => {
          if (confirmTarget) await handleScore(confirmTarget);
        }}
      />
    </div>
  );
}
