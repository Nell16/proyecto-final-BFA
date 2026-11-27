import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock,
  LayoutGrid,
  Loader2,
  RefreshCw,
  WifiOff,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "../../../app/components/ui/alert";
import { Brand } from "../../../app/components/brand";
import { Button } from "../../../app/components/ui/button";
import { Card, CardContent } from "../../../app/components/ui/card";
import { ConfirmDialog } from "../../../app/components/ui/confirm-dialog";
import { Progress } from "../../../app/components/ui/progress";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../../../app/components/ui/sheet";
import { Skeleton } from "../../../app/components/ui/skeleton";
import { cn } from "../../../app/components/ui/utils";
import { useRunner } from "../../../features/runtime/RunnerContext";
import { RuntimeImage, prefetchItemImages } from "../../../features/runtime/RuntimeImage";
import { isAnswered } from "../../../features/runtime/answer-value";
import { useRejectedAnswers, useSyncStatus } from "../../../features/runtime/draft";
import {
  clampOrdinal,
  findSubtest,
  isSubtestOpenable,
  isValidOrdinal,
} from "../../../features/runtime/machine";
import { isTicketCurrent } from "../../../features/runtime/evaluation-guard";
import { ensureCurrentEvaluation, subtestItemsQueryOptions } from "../../../features/runtime/queries";
import { AnswerRenderer } from "../../../features/runtime/renderers";
import { useParticipantAuth } from "../../../store/participantAuth";

export const Route = createFileRoute("/evaluacion/_runner/subtests/$subtestId/items/$ordinal")({
  params: {
    parse: (params) => ({
      subtestId: Number(params.subtestId),
      ordinal: Number(params.ordinal),
    }),
    stringify: (params) => ({
      subtestId: String(params.subtestId),
      ordinal: String(params.ordinal),
    }),
  },
  beforeLoad: async ({ context, params }) => {
    if (!Number.isInteger(params.subtestId) || params.subtestId <= 0) {
      throw redirect({ to: "/evaluacion/sesion", replace: true });
    }
    const { assignmentId } = useParticipantAuth.getState();
    if (assignmentId === null) {
      throw redirect({ to: "/evaluacion/acceso", replace: true });
    }

    // Solo se decide con un /yo vigente (F2-FIX-6); sin confirmación se deja montar y el runner corrige después.
    const evaluation = await ensureCurrentEvaluation(context.queryClient, assignmentId);
    if (evaluation === null) return;

    if (!isSubtestOpenable(evaluation, params.subtestId)) {
      throw redirect({ to: "/evaluacion/sesion", replace: true });
    }

    const subtest = findSubtest(evaluation, params.subtestId);
    if (!subtest || subtest.status === "NO_INICIADO") {
      throw redirect({
        to: "/evaluacion/subtests/$subtestId/instrucciones",
        params: { subtestId: params.subtestId },
        replace: true,
      });
    }

    let items = subtest.items;
    if (items.length === 0 && evaluation.attemptId !== null) {
      try {
        const loaded = await context.queryClient.ensureQueryData(
          subtestItemsQueryOptions(assignmentId, evaluation.attemptId, params.subtestId),
        );
        items = loaded.items;
      } catch {
        return;
      }
    }

    // El await de los ítems pudo durar lo suficiente para que el /yo con el que se decide quedara invalidado
    // (pestaña oculta, cambio de dueño): sin ticket vigente NO se corrige el ordinal (F2-FIX-7).
    if (!isTicketCurrent(evaluation)) return;

    if (items.length > 0 && !isValidOrdinal(params.ordinal, items.length)) {
      throw redirect({
        to: "/evaluacion/subtests/$subtestId/items/$ordinal",
        params: {
          subtestId: params.subtestId,
          ordinal: clampOrdinal(params.ordinal, items.length),
        },
        replace: true,
      });
    }
  },
  component: SubtestItemRunnerRoute,
});

function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function SubtestItemRunnerRoute() {
  const { subtestId, ordinal } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const promptId = useId();

  const {
    state,
    evaluation,
    assignmentId,
    remainingTimeMs,
    isFinishingSubtest,
    isRetryingSync,
    isReconnecting,
    isVerifyingTime,
    isTimeLocked,
    actionError,
    clearActionError,
    ensureItemsRoute,
    goToItemAction,
    finishSubtestAction,
    retrySyncAction,
    getItemValue,
    saveItemValue,
    setActiveItem,
  } = useRunner();

  const syncStatus = useSyncStatus();
  const allRejectedAnswers = useRejectedAnswers();

  const [itemMapOpen, setItemMapOpen] = useState(false);
  const [finishDialogOpen, setFinishDialogOpen] = useState(false);
  const [timerAnnouncement, setTimerAnnouncement] = useState("");
  const announcedMilestonesRef = useRef<Set<string>>(new Set());

  const subtest = evaluation ? findSubtest(evaluation, subtestId) : undefined;
  const needsSeparateItemsFetch = Boolean(
    evaluation && evaluation.attemptId !== null && subtest && subtest.items.length === 0,
  );

  const itemsQuery = useQuery({
    ...subtestItemsQueryOptions(assignmentId ?? 0, evaluation?.attemptId ?? 0, subtestId),
    enabled: needsSeparateItemsFetch && assignmentId !== null && evaluation?.attemptId !== null,
  });

  const items = useMemo(
    () => (subtest && subtest.items.length > 0 ? subtest.items : (itemsQuery.data?.items ?? [])),
    [subtest, itemsQuery.data],
  );

  const totalItems = items.length;
  const safeOrdinal = totalItems > 0 ? clampOrdinal(ordinal, totalItems) : ordinal;
  const currentItem = items[safeOrdinal - 1];
  const nextItem = items[safeOrdinal];

  // Si llegó a un ordinal fuera de rango después de cargar ítems, normaliza la URL. Solo decide con una evaluación
  // vigente (F2-FIX-7); si no lo está, espera el siguiente /yo vigente (cambia `evaluation` y el efecto se repite).
  useEffect(() => {
    if (!isTicketCurrent(evaluation)) return;
    if (totalItems > 0 && ordinal !== safeOrdinal) {
      void navigate({
        to: "/evaluacion/subtests/$subtestId/items/$ordinal",
        params: { subtestId, ordinal: safeOrdinal },
        replace: true,
      });
    }
  }, [evaluation, totalItems, ordinal, safeOrdinal, subtestId, navigate]);

  // Recuperación tras recarga o sincronización de ordinal con la máquina
  useEffect(() => {
    const controller = new AbortController();
    void ensureItemsRoute(subtestId, safeOrdinal, { signal: controller.signal });
    return () => {
      controller.abort();
    };
  }, [ensureItemsRoute, subtestId, safeOrdinal, state.kind]);

  // Redirección reactiva si el polling cierra/anula el subtest abierto o cambia de fase
  // Solo decide con una evaluación vigente (F2-FIX-7): un /yo invalidado (pestaña oculta) no desvía; se espera el
  // siguiente /yo vigente.
  useEffect(() => {
    if (!evaluation) return;
    if (!isTicketCurrent(evaluation)) return;
    if (
      state.kind === "pausada" ||
      state.kind === "bloqueado" ||
      state.kind === "finalizandoSubtest"
    ) {
      return;
    }
    if (
      !isSubtestOpenable(evaluation, subtestId) ||
      state.kind === "resumen" ||
      state.kind === "completada" ||
      state.kind === "bienvenida"
    ) {
      void navigate({ to: "/evaluacion/sesion", replace: true });
      return;
    }
    if (subtest && subtest.status === "NO_INICIADO") {
      void navigate({
        to: "/evaluacion/subtests/$subtestId/instrucciones",
        params: { subtestId },
        replace: true,
      });
    }
  }, [evaluation, state.kind, subtestId, subtest, navigate]);

  // Medición real del tiempo activo del ítem. El efecto depende del `id` del ítem (no del objeto): un /yo del
  // polling trae objetos nuevos y no debe contar como "salir del ítem" (al salir se persiste el tiempo de revisión).
  const currentItemRef = useRef(currentItem);
  useEffect(() => {
    currentItemRef.current = currentItem;
  });
  const currentItemId = currentItem?.id;
  useEffect(() => {
    setActiveItem(currentItemRef.current ?? null, subtestId);
    return () => {
      setActiveItem(null, null);
    };
  }, [currentItemId, subtestId, setActiveItem]);

  // Prefetch de imágenes del siguiente ítem
  useEffect(() => {
    if (assignmentId === null || !nextItem) return;
    void prefetchItemImages(queryClient, assignmentId, nextItem);
  }, [assignmentId, nextItem, queryClient]);

  // Anuncios accesibles (aria-live="assertive") al llegar a 2:00 y 0:30 restantes
  useEffect(() => {
    if (remainingTimeMs === null || state.kind !== "respondiendo") return;
    const secs = Math.ceil(remainingTimeMs / 1000);
    if (secs <= 120 && secs > 30 && !announcedMilestonesRef.current.has(`${subtestId}:120`)) {
      announcedMilestonesRef.current.add(`${subtestId}:120`);
      setTimerAnnouncement("Quedan 2 minutos para finalizar este subtest.");
    } else if (secs <= 30 && secs > 0 && !announcedMilestonesRef.current.has(`${subtestId}:30`)) {
      announcedMilestonesRef.current.add(`${subtestId}:30`);
      setTimerAnnouncement("Quedan 30 segundos para finalizar este subtest.");
    }
  }, [remainingTimeMs, state.kind, subtestId]);

  const navigateToOrdinal = useCallback(
    (targetOrdinal: number) => {
      if (totalItems <= 0) return;
      const clamped = clampOrdinal(targetOrdinal, totalItems);
      if (clamped === safeOrdinal) return;
      goToItemAction(clamped);
      void navigate({
        to: "/evaluacion/subtests/$subtestId/items/$ordinal",
        params: { subtestId, ordinal: clamped },
      });
    },
    [totalItems, safeOrdinal, goToItemAction, navigate, subtestId],
  );

  const isModalOpen = itemMapOpen || finishDialogOpen;
  const isDisabled = state.kind !== "respondiendo" || isFinishingSubtest;
  // Con el plazo local vencido hace > N s sin confirmar con el servidor se bloquea SOLO la edición de la respuesta.
  const isAnswerLocked = isDisabled || isTimeLocked;
  const hotkeysActive = !isModalOpen && !isAnswerLocked;

  // Navegación por teclado ← / → sin interferir con inputs ni modales; bloqueada igual que los botones mientras se
  // finaliza el subtest (o la sesión está pausada/cerrada): `isDisabled`.
  useEffect(() => {
    if (isModalOpen || isDisabled || totalItems <= 0) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      if (isEditableElement(event.target)) return;

      if (event.key === "ArrowLeft" && safeOrdinal > 1) {
        event.preventDefault();
        navigateToOrdinal(safeOrdinal - 1);
      } else if (event.key === "ArrowRight" && safeOrdinal < totalItems) {
        event.preventDefault();
        navigateToOrdinal(safeOrdinal + 1);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isModalOpen, isDisabled, totalItems, safeOrdinal, navigateToOrdinal]);

  const subtestItemIds = useMemo(() => new Set(items.map((it) => it.id)), [items]);
  const rejectedInSubtest = useMemo(
    () =>
      allRejectedAnswers.filter(
        (entry) => entry.subtestId === subtestId || subtestItemIds.has(entry.itemId),
      ),
    [allRejectedAnswers, subtestId, subtestItemIds],
  );
  const rejectedSet = useMemo(
    () => new Set(rejectedInSubtest.map((r) => r.itemId)),
    [rejectedInSubtest],
  );

  const unansweredItems = useMemo(
    () =>
      items
        .map((it, idx) => ({ item: it, ordinal: idx + 1 }))
        .filter(({ item }) => !isAnswered(getItemValue(item))),
    [items, getItemValue],
  );

  const answeredCount = totalItems - unansweredItems.length;
  const progressPercent = totalItems > 0 ? (safeOrdinal / totalItems) * 100 : 0;

  // Niveles del cronómetro (§4): normal (>120s), advertencia (30–120s), crítico (<30s, sin parpadeo)
  const remainingSeconds = remainingTimeMs !== null ? Math.ceil(remainingTimeMs / 1000) : null;
  const timerToneClass =
    remainingSeconds === null
      ? "border-transparent bg-muted text-foreground"
      : remainingSeconds < 30
        ? "border-status-danger-border bg-status-danger-bg text-status-danger-fg"
        : remainingSeconds <= 120
          ? "border-status-warning-border bg-status-warning-bg text-status-warning-fg"
          : "border-transparent bg-muted text-foreground";

  if (!evaluation || !subtest) return null;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Regiones aria-live para lectores de pantalla */}
      <div aria-live="assertive" className="sr-only">
        {timerAnnouncement}
      </div>
      <div aria-live="polite" className="sr-only">
        {isReconnecting
          ? isTimeLocked
            ? "Reconectando con el servidor. La edición está bloqueada hasta confirmar el tiempo restante."
            : "Reconectando con el servidor para confirmar el tiempo restante."
          : isVerifyingTime
            ? "Verificando el tiempo restante con el servidor."
            : syncStatus.isOffline
              ? "Sin conexión. Respuestas guardadas localmente."
              : syncStatus.pending > 0
                ? `Guardando ${syncStatus.pending} respuestas.`
                : "Respuestas guardadas."}
      </div>

      {/* Header fijo de modo examen (sin enlaces de salida) */}
      <header className="sticky top-0 z-30 border-b border-border bg-card shrink-0">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-3 px-4">
          <div className="flex items-center gap-3 min-w-0">
            <Brand compact />
            <span className="hidden sm:block h-5 w-px bg-border shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-foreground">{subtest.name}</div>
              <div className="text-xs text-muted-foreground tabular-nums">
                Ítem {safeOrdinal} de {totalItems || "—"}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {/* /yo falló al confirmar el plazo: se reintenta sin cerrar el subtest por el plazo local */}
            {isReconnecting && (
              <div
                role="status"
                className="inline-flex items-center gap-1.5 rounded-full border border-status-warning-border bg-status-warning-bg px-2.5 py-1 text-xs font-medium text-status-warning-fg"
              >
                <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden="true" />
                <span>Reconectando…</span>
              </div>
            )}

            {/* El plazo local venció: se consulta al servidor antes de cerrar nada */}
            {isVerifyingTime && !isReconnecting && (
              <div
                role="status"
                className="inline-flex items-center gap-1.5 rounded-full border border-status-info-border bg-status-info-bg px-2.5 py-1 text-xs font-medium text-status-info-fg"
              >
                <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden="true" />
                <span>Verificando tiempo…</span>
              </div>
            )}

            {/* Indicador sobrio de guardado / sincronización */}
            <div
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
                syncStatus.isOffline
                  ? "border-status-warning-border bg-status-warning-bg text-status-warning-fg"
                  : syncStatus.pending > 0
                    ? "border-status-info-border bg-status-info-bg text-status-info-fg"
                    : "border-status-success-border bg-status-success-bg text-status-success-fg",
              )}
            >
              {syncStatus.isOffline ? (
                <>
                  <WifiOff className="size-3.5 shrink-0" aria-hidden="true" />
                  <span>Sin conexión</span>
                </>
              ) : syncStatus.pending > 0 ? (
                <>
                  <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden="true" />
                  <span>Guardando...</span>
                </>
              ) : (
                <>
                  <span
                    aria-hidden="true"
                    className="size-1.5 shrink-0 rounded-full bg-status-success-solid"
                  />
                  <span>Guardado</span>
                </>
              )}
            </div>

            {/* Cronómetro con 3 niveles (sin parpadeo) */}
            {remainingTimeMs !== null && (
              <div
                role="timer"
                aria-label="Tiempo restante del subtest"
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 font-mono text-sm font-semibold tabular-nums transition-colors",
                  timerToneClass,
                )}
              >
                <Clock className="size-4 shrink-0" aria-hidden="true" />
                <span>{formatCountdown(remainingTimeMs)}</span>
              </div>
            )}

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 gap-1.5 px-3 bg-card hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring"
              aria-label="Abrir mapa de ítems"
              onClick={() => setItemMapOpen(true)}
            >
              <LayoutGrid className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">Mapa</span>
            </Button>
          </div>
        </div>
        <Progress value={progressPercent} className="h-1 rounded-none bg-muted" />
      </header>

      {/* Banner offline */}
      {syncStatus.isOffline && (
        <div className="border-b border-status-warning-border bg-status-warning-bg px-4 py-2.5 text-status-warning-fg">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 text-xs sm:text-sm font-medium">
            <div className="flex items-center gap-2">
              <WifiOff className="size-4 shrink-0" aria-hidden="true" />
              <span>
                Sin conexión · Sus respuestas se guardan localmente hasta recuperar la señal.
              </span>
            </div>
            {syncStatus.pending > 0 && (
              <span className="rounded-full border border-status-warning-border bg-card px-2.5 py-0.5 font-mono text-xs font-semibold text-status-warning-fg tabular-nums shrink-0">
                {syncStatus.pending} {syncStatus.pending === 1 ? "pendiente" : "pendientes"}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Banner de respuestas rechazadas definitivamente */}
      {rejectedInSubtest.length > 0 && (
        <div className="border-b border-status-danger-border bg-status-danger-bg px-4 py-2.5 text-status-danger-fg">
          <div className="mx-auto flex max-w-5xl items-start gap-2 text-xs sm:text-sm">
            <AlertTriangle className="size-4 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <span className="font-semibold">
                {rejectedInSubtest.length}{" "}
                {rejectedInSubtest.length === 1 ? "respuesta rechazada" : "respuestas rechazadas"} por el
                servidor:
              </span>{" "}
              {rejectedInSubtest
                .map((entry) => {
                  const idx = items.findIndex((it) => it.id === entry.itemId);
                  const label = idx >= 0 ? `Ítem ${idx + 1}` : `Ítem #${entry.itemId}`;
                  return `${label} (${entry.code})`;
                })
                .join(", ")}
            </div>
          </div>
        </div>
      )}

      {/* Contenido principal del ítem (superficie centrada max-w-3xl para lectura y estímulo óptimos) */}
      <main className="flex-1 overflow-y-auto px-4 py-5 md:px-6 md:py-8">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
          {actionError && (
            <Alert
              role="alert"
              className="border-status-danger-border bg-status-danger-bg text-status-danger-fg"
            >
              <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
              <AlertTitle>No se pudo completar la acción</AlertTitle>
              <AlertDescription className="text-status-danger-fg space-y-2">
                <p>{actionError}</p>
                {syncStatus.pending > 0 && state.kind === "respondiendo" && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isRetryingSync}
                    className="gap-1.5 border-status-danger-border bg-card text-foreground hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring"
                    onClick={() => void retrySyncAction()}
                  >
                    <RefreshCw
                      className={cn("size-3.5", isRetryingSync && "animate-spin")}
                      aria-hidden="true"
                    />
                    Reintentar sincronización
                  </Button>
                )}
                {state.kind === "finalizandoSubtest" &&
                  state.reason === "tiempo" &&
                  !isFinishingSubtest && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="border-status-danger-border bg-card text-foreground hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring"
                      onClick={() => void finishSubtestAction(subtestId, "tiempo")}
                    >
                      Reintentar cierre del subtest
                    </Button>
                  )}
              </AlertDescription>
            </Alert>
          )}

          <Card className="rounded-lg border border-border bg-card shadow-[var(--shadow-xs)]">
            <CardContent className="p-6 md:p-8 flex flex-col gap-6">
              {itemsQuery.isPending && items.length === 0 ? (
                <div className="space-y-4" aria-busy="true" aria-label="Cargando reactivo">
                  <Skeleton className="h-4 w-24 bg-muted" />
                  <Skeleton className="h-6 w-3/4 bg-muted" />
                  <Skeleton className="h-52 w-full rounded-lg bg-muted" />
                  <div className="space-y-3 pt-2">
                    <Skeleton className="h-14 w-full rounded-lg bg-muted" />
                    <Skeleton className="h-14 w-full rounded-lg bg-muted" />
                  </div>
                </div>
              ) : currentItem ? (
                <>
                  <div className="space-y-2 select-none" onContextMenu={(e) => e.preventDefault()}>
                    <div className="text-xs font-medium text-muted-foreground tabular-nums">
                      Ítem {safeOrdinal} de {totalItems}
                    </div>
                    <h1
                      id={promptId}
                      className="text-lg sm:text-xl font-semibold tracking-tight text-foreground leading-snug"
                    >
                      {currentItem.prompt?.trim() || "Seleccione la respuesta correspondiente."}
                    </h1>
                    {currentItem.instruction?.trim() && (
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        {currentItem.instruction.trim()}
                      </p>
                    )}
                  </div>

                  {currentItem.images.length > 0 && (
                    <div
                      className="rounded-lg border border-border bg-muted/40 p-4 sm:p-5 flex flex-col items-center gap-4 select-none"
                      onContextMenu={(e) => e.preventDefault()}
                    >
                      {currentItem.images.map((image) => (
                        <RuntimeImage
                          key={image.id}
                          src={image.url}
                          alt={image.altText ?? `Estímulo del ítem ${safeOrdinal}`}
                          assignmentId={assignmentId}
                          className="max-h-80 w-auto max-w-full"
                        />
                      ))}
                    </div>
                  )}

                  <div className="pt-1">
                    <AnswerRenderer
                      item={currentItem}
                      value={getItemValue(currentItem)}
                      onChange={(nextValue) => {
                        void saveItemValue(currentItem, subtestId, nextValue);
                      }}
                      disabled={isAnswerLocked}
                      hotkeysActive={hotkeysActive}
                      labelledBy={promptId}
                      renderImage={(image) => (
                        <RuntimeImage
                          src={image.url}
                          alt={image.altText ?? ""}
                          assignmentId={assignmentId}
                          compact
                          allowRetry={false}
                          className="max-h-36 w-auto max-w-full"
                        />
                      )}
                    />
                  </div>
                </>
              ) : (
                <Alert
                  role="alert"
                  className="border-status-danger-border bg-status-danger-bg text-status-danger-fg"
                >
                  <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
                  <AlertDescription className="text-status-danger-fg">
                    No se encontró el reactivo solicitado.
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        </div>
      </main>

      {/* Footer de navegación ergonómico (h-16, botones h-12 px-5, gap-3) */}
      <footer className="border-t border-border bg-card shrink-0">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-3 px-4">
          <Button
            type="button"
            variant="outline"
            className="h-12 px-5 gap-2 focus-visible:ring-[3px] focus-visible:ring-ring"
            disabled={safeOrdinal <= 1 || isDisabled}
            onClick={() => navigateToOrdinal(safeOrdinal - 1)}
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Anterior
          </Button>

          <div className="hidden sm:flex items-center gap-2 text-xs font-medium text-muted-foreground tabular-nums">
            <CheckCircle2 className="size-4 text-status-success-fg" aria-hidden="true" />
            <span>
              {answeredCount} / {totalItems} respondidos
            </span>
          </div>

          {safeOrdinal < totalItems ? (
            <Button
              type="button"
              className="h-12 px-5 gap-2 focus-visible:ring-[3px] focus-visible:ring-ring"
              disabled={isDisabled}
              onClick={() => navigateToOrdinal(safeOrdinal + 1)}
            >
              Siguiente
              <ArrowRight className="size-4" aria-hidden="true" />
            </Button>
          ) : (
            <Button
              type="button"
              className="h-12 px-5 gap-2 focus-visible:ring-[3px] focus-visible:ring-ring"
              disabled={isDisabled}
              onClick={() => {
                clearActionError();
                setFinishDialogOpen(true);
              }}
            >
              {isFinishingSubtest ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Finalizando...
                </>
              ) : (
                "Finalizar subtest"
              )}
            </Button>
          )}
        </div>
      </footer>

      {/* Mapa de ítems (Sheet con grilla 5 cols móvil / 8 cols sm+, celdas >= 44×44px) */}
      <Sheet open={itemMapOpen} onOpenChange={setItemMapOpen}>
        <SheetContent
          side="right"
          className="w-full max-w-md sm:max-w-[464px] bg-card text-card-foreground border-border shadow-[var(--shadow-md)]"
        >
          <SheetHeader className="border-b border-border pb-4">
            <SheetTitle className="text-base font-semibold text-foreground">Mapa de ítems</SheetTitle>
            <SheetDescription className="text-xs text-muted-foreground tabular-nums">
              {answeredCount} de {totalItems} respondidos en {subtest.name}.
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-5">
            <div className="grid grid-cols-5 sm:grid-cols-8 gap-2">
              {items.map((item, idx) => {
                const itemOrdinal = idx + 1;
                const isCurrent = itemOrdinal === safeOrdinal;
                const isRejected = rejectedSet.has(item.id);
                const answered = isAnswered(getItemValue(item));

                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-label={`Ir al ítem ${itemOrdinal}${isCurrent ? " (actual)" : answered ? " (respondido)" : " (pendiente)"}`}
                    aria-current={isCurrent ? "step" : undefined}
                    onClick={() => {
                      setItemMapOpen(false);
                      navigateToOrdinal(itemOrdinal);
                    }}
                    className={cn(
                      "flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md font-mono text-sm tabular-nums transition-colors cursor-pointer",
                      "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring",
                      isCurrent
                        ? "border-2 border-primary bg-primary/10 text-brand-deep dark:text-primary font-semibold"
                        : isRejected
                          ? "border-2 border-status-danger-solid bg-status-danger-bg text-status-danger-fg font-semibold"
                          : answered
                            ? "border border-primary bg-primary text-primary-foreground font-medium"
                            : "border border-border bg-card text-muted-foreground hover:border-border-strong hover:text-foreground",
                    )}
                  >
                    {itemOrdinal}
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground pt-3 border-t border-border">
              <span className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="size-3.5 rounded-xs border-2 border-primary bg-primary/10"
                />
                Actual
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="size-3.5 rounded-xs bg-primary" />
                Respondido
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="size-3.5 rounded-xs border border-border bg-card"
                />
                Sin responder
              </span>
              {rejectedInSubtest.length > 0 && (
                <span className="inline-flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className="size-3.5 rounded-xs border-2 border-status-danger-solid bg-status-danger-bg"
                  />
                  Rechazado
                </span>
              )}
            </div>

            <Button
              type="button"
              variant="outline"
              className="w-full h-12 px-5 focus-visible:ring-[3px] focus-visible:ring-ring"
              disabled={isDisabled}
              onClick={() => {
                setItemMapOpen(false);
                clearActionError();
                setFinishDialogOpen(true);
              }}
            >
              Finalizar subtest
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* ConfirmDialog previo a finalizar el subtest (0 alert/confirm nativos) */}
      <ConfirmDialog
        open={finishDialogOpen}
        onOpenChange={setFinishDialogOpen}
        title="¿Finalizar este subtest?"
        description={
          <div className="space-y-2.5 text-left">
            <p className="tabular-nums">
              Ha respondido <span className="font-semibold text-foreground">{answeredCount}</span> de{" "}
              <span className="font-semibold text-foreground">{totalItems}</span> ítems. Una vez
              finalizado, no podrá volver a editar este subtest.
            </p>
            {unansweredItems.length > 0 ? (
              <p className="rounded-md border border-status-warning-border bg-status-warning-bg px-3 py-2 text-xs text-status-warning-fg">
                Ítems sin responder:{" "}
                <span className="font-mono font-semibold tabular-nums">
                  {unansweredItems.map((entry) => entry.ordinal).join(", ")}
                </span>
              </p>
            ) : (
              <p className="text-xs text-status-success-fg font-medium">
                Todos los ítems tienen respuesta registrada.
              </p>
            )}
            {rejectedInSubtest.length > 0 && (
              <p className="rounded-md border border-status-danger-border bg-status-danger-bg px-3 py-2 text-xs text-status-danger-fg">
                Respuestas rechazadas ({rejectedInSubtest.length}):{" "}
                {rejectedInSubtest
                  .map((entry) => {
                    const idx = items.findIndex((it) => it.id === entry.itemId);
                    const label = idx >= 0 ? `Ítem ${idx + 1}` : `Ítem #${entry.itemId}`;
                    return `${label} (${entry.code})`;
                  })
                  .join(", ")}
              </p>
            )}
            {syncStatus.pending > 0 && (
              <p className="text-xs text-muted-foreground tabular-nums">
                Hay {syncStatus.pending}{" "}
                {syncStatus.pending === 1 ? "respuesta por sincronizar" : "respuestas por sincronizar"}; se
                intentará el envío antes de cerrar. Si falla la sincronización, el subtest no se cerrará
                hasta confirmar sus respuestas.
              </p>
            )}
          </div>
        }
        confirmLabel="Finalizar subtest"
        cancelLabel="Seguir respondiendo"
        onConfirm={async () => {
          const ok = await finishSubtestAction(subtestId, "usuario");
          if (!ok) {
            throw new Error("No se pudo finalizar el subtest");
          }
        }}
      />
    </div>
  );
}
