import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Clock,
  CheckCircle2,
  Loader2,
  Lock,
  Play,
  RefreshCw,
  ShieldCheck,
  WifiOff,
  XCircle,
} from "lucide-react";

import type { Evaluation } from "../../../api/schemas/runtime";
import { Alert, AlertDescription, AlertTitle } from "../../../app/components/ui/alert";
import { Badge } from "../../../app/components/ui/badge";
import { Brand } from "../../../app/components/brand";
import { Button } from "../../../app/components/ui/button";
import { Card, CardContent } from "../../../app/components/ui/card";
import { ConfirmDialog } from "../../../app/components/ui/confirm-dialog";
import { Separator } from "../../../app/components/ui/separator";
import { StatusBadge } from "../../../app/components/ui/status-badge";
import { cn } from "../../../app/components/ui/utils";
import { useRunner } from "../../../features/runtime/RunnerContext";
import { isAnswered } from "../../../features/runtime/answer-value";
import {
  useRejectedAnswers,
  useSyncStatus,
  useUnconfirmedAnswers,
  type UnconfirmedAnswerEntry,
} from "../../../features/runtime/draft";
import { isSubtestOpenable } from "../../../features/runtime/machine";
import { useParticipantAuth } from "../../../store/participantAuth";

export const Route = createFileRoute("/evaluacion/_runner/sesion")({
  component: EvaluacionSesionRoute,
});

function formatUnconfirmedItemLabel(
  evaluation: Evaluation,
  entry: UnconfirmedAnswerEntry,
): string {
  const sub = evaluation.subtests.find((s) => s.id === entry.subtestId);
  if (sub) {
    const idx = sub.items.findIndex((it) => it.id === entry.itemId);
    if (idx >= 0) {
      return `${sub.name} · Ítem ${idx + 1}`;
    }
    return `${sub.name} · Ítem #${entry.itemId}`;
  }
  return `Subtest #${entry.subtestId} · Ítem #${entry.itemId}`;
}

function UnconfirmedAnswersAlert({
  entries,
  evaluation,
}: {
  entries: readonly UnconfirmedAnswerEntry[];
  evaluation: Evaluation;
}) {
  if (entries.length === 0) return null;
  return (
    <Alert
      role="alert"
      className="mt-5 border-status-warning-border bg-status-warning-bg text-status-warning-fg text-left"
    >
      <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
      <AlertTitle>
        {entries.length}{" "}
        {entries.length === 1
          ? "respuesta quedó sin confirmar al vencer el tiempo"
          : "respuestas quedaron sin confirmar al vencer el tiempo"}
      </AlertTitle>
      <AlertDescription className="text-status-warning-fg text-xs space-y-1">
        <p>
          El límite de tiempo cerró el subtest sin conexión confirmada; informe a su aplicador para
          revisión si corresponde:
        </p>
        <ul className="list-disc pl-4 space-y-0.5 tabular-nums">
          {entries.map((entry) => (
            <li key={entry.itemId}>{formatUnconfirmedItemLabel(evaluation, entry)}</li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}

function formatTimeLimit(seconds: number | null): string {
  if (seconds === null) return "Sin límite";
  if (seconds < 60) return `${seconds} s`;
  const mins = Math.round(seconds / 60);
  return `${mins} ${mins === 1 ? "minuto" : "minutos"}`;
}

function EvaluacionSesionRoute() {
  const navigate = useNavigate();
  const {
    state,
    evaluation,
    isStartingAttempt,
    isFinishingAttempt,
    isRetryingSync,
    actionError,
    clearActionError,
    completedUnconfirmedAnswers,
    completedRejectedAnswers,
    startAttemptAction,
    openSubtestAction,
    backToListAction,
    finishAttemptAction,
    retrySyncAction,
    getItemValue,
  } = useRunner();

  const syncStatus = useSyncStatus();
  const rejectedAnswers = useRejectedAnswers();
  const unconfirmedAnswers = useUnconfirmedAnswers();
  const [confirmFinishOpen, setConfirmFinishOpen] = useState(false);

  // Si llegó aquí por botón Atrás desde instrucciones, regresa limpiamente a listaSubtests.
  useEffect(() => {
    if (state.kind === "instrucciones") {
      backToListAction();
    }
  }, [state.kind, backToListAction]);

  // Durante un subtest activo (respondiendo), redirige de vuelta al ítem en curso.
  useEffect(() => {
    if (state.kind === "respondiendo") {
      void navigate({
        to: "/evaluacion/subtests/$subtestId/items/$ordinal",
        params: { subtestId: state.subtestId, ordinal: state.ordinal },
        replace: true,
      });
    }
  }, [state, navigate]);

  if (!evaluation) return null;

  const handleExitBeforeStart = () => {
    useParticipantAuth.getState().clear();
    void navigate({ to: "/evaluacion/acceso", replace: true });
  };

  const handleOpenSubtest = (subtestId: number) => {
    openSubtestAction(subtestId);
    void navigate({
      to: "/evaluacion/subtests/$subtestId/instrucciones",
      params: { subtestId },
    });
  };

  if (state.kind === "bienvenida") {
    const orderedSubtests = [...evaluation.subtests].sort((a, b) => a.order - b.order);

    return (
      <div className="flex-1 flex items-center justify-center p-4 md:p-6">
        <Card className="w-full max-w-2xl rounded-lg border border-border bg-card shadow-[var(--shadow-xs)]">
          <CardContent className="p-6 md:p-8">
            <div className="flex items-center justify-between gap-4">
              <Brand />
              <StatusBadge domain="session" status={evaluation.sessionStatus} />
            </div>

            <h1 className="text-xl font-semibold tracking-tight text-foreground mt-6">
              Bienvenido/a a la evaluación UAM SIAT
            </h1>
            <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
              Participante:{" "}
              <span className="font-medium text-foreground">{evaluation.participantName}</span> · Sesión:{" "}
              <span className="font-medium text-foreground">{evaluation.sessionName}</span>
            </p>

            {actionError && (
              <Alert
                role="alert"
                className="mt-4 border-status-danger-border bg-status-danger-bg text-status-danger-fg"
              >
                <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
                <AlertDescription className="text-status-danger-fg">{actionError}</AlertDescription>
              </Alert>
            )}

            <Separator className="my-6" />

            <div className="space-y-3">
              <h2 className="text-base font-semibold text-foreground">
                Subtests habilitados en esta sesión
              </h2>
              {orderedSubtests.map((subtest, idx) => (
                <div
                  key={subtest.id}
                  className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-3.5"
                >
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground text-sm font-semibold tabular-nums">
                    {idx + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-foreground">{subtest.name}</div>
                    <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap items-center gap-2 tabular-nums">
                      <span>{subtest.items.length} ítems</span>
                      <span aria-hidden="true">·</span>
                      <span className="inline-flex items-center gap-1">
                        <Clock className="size-3.5" aria-hidden="true" />
                        Límite: {formatTimeLimit(subtest.timeLimitSeconds)}
                      </span>
                    </div>
                  </div>
                  <BookOpen className="size-4 text-muted-foreground shrink-0" aria-hidden="true" />
                </div>
              ))}
            </div>

            <Alert className="mt-6 border-status-warning-border bg-status-warning-bg text-status-warning-fg">
              <ShieldCheck className="size-4 shrink-0" aria-hidden="true" />
              <AlertTitle>Instrucciones y confidencialidad</AlertTitle>
              <AlertDescription className="text-status-warning-fg text-xs leading-relaxed">
                Lea cuidadosamente cada instrucción antes de responder. Sus respuestas se guardan
                automáticamente. Una vez finalizado cada subtest no podrá modificarlo. Está prohibida la
                reproducción o difusión de los reactivos de esta prueba.
              </AlertDescription>
            </Alert>

            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <Button
                type="button"
                variant="ghost"
                className="h-12 px-4 focus-visible:ring-[3px] focus-visible:ring-ring"
                onClick={handleExitBeforeStart}
                disabled={isStartingAttempt}
              >
                Salir
              </Button>
              <Button
                type="button"
                className="h-12 px-5 gap-2 focus-visible:ring-[3px] focus-visible:ring-ring"
                disabled={isStartingAttempt}
                onClick={() => {
                  clearActionError();
                  void startAttemptAction();
                }}
              >
                {isStartingAttempt ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    Iniciando evaluación...
                  </>
                ) : (
                  <>
                    Comenzar evaluación
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (state.kind === "completada") {
    return (
      <div className="flex-1 flex items-center justify-center p-4 md:p-6">
        <Card className="w-full max-w-md rounded-lg border border-border bg-card shadow-[var(--shadow-xs)]">
          <CardContent className="p-6 sm:p-8 text-center space-y-5">
            <div className="mx-auto flex size-14 items-center justify-center rounded-full border border-status-success-border bg-status-success-bg text-status-success-fg">
              <CheckCircle2 className="size-8" aria-hidden="true" />
            </div>

            <div className="space-y-2">
              <div className="flex justify-center">
                <StatusBadge domain="attempt" status="COMPLETADO" />
              </div>
              <h1 className="text-xl font-semibold tracking-tight text-foreground">
                Evaluación Finalizada
              </h1>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Sus respuestas han sido registradas correctamente. Muchas gracias por su participación,{" "}
                <span className="font-medium text-foreground">{evaluation.participantName}</span>.
              </p>
            </div>

            <div className="rounded-lg border border-border bg-muted/50 p-3.5 text-xs text-muted-foreground leading-relaxed">
              Sesión: <span className="font-medium text-foreground">{evaluation.sessionName}</span>. Puede cerrar
              esta pestaña de forma segura.
            </div>

            <UnconfirmedAnswersAlert
              entries={completedUnconfirmedAnswers}
              evaluation={evaluation}
            />

            {completedRejectedAnswers.length > 0 && (
              <Alert
                role="alert"
                className="mt-4 border-status-danger-border bg-status-danger-bg text-status-danger-fg text-left"
              >
                <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
                <AlertTitle>
                  {completedRejectedAnswers.length}{" "}
                  {completedRejectedAnswers.length === 1
                    ? "respuesta no pudo guardarse en el servidor"
                    : "respuestas no pudieron guardarse en el servidor"}
                </AlertTitle>
                <AlertDescription className="text-status-danger-fg text-xs space-y-1">
                  <ul className="list-disc pl-4 space-y-0.5">
                    {completedRejectedAnswers.map((entry) => (
                      <li key={entry.itemId}>
                        Ítem #{entry.itemId}: {entry.code}
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            <Button
              type="button"
              variant="outline"
              className="w-full h-12 px-5 gap-2 focus-visible:ring-[3px] focus-visible:ring-ring"
              onClick={handleExitBeforeStart}
            >
              Volver al inicio
              <ArrowRight className="size-4" aria-hidden="true" />
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (state.kind === "resumen" || state.kind === "finalizando") {
    const orderedSubtests = [...evaluation.subtests].sort((a, b) => a.order - b.order);

    return (
      <div className="flex-1 flex items-center justify-center p-4 md:p-6">
        <Card className="w-full max-w-2xl rounded-lg border border-border bg-card shadow-[var(--shadow-xs)]">
          <CardContent className="p-6 md:p-8">
            <div className="flex items-center justify-between gap-4">
              <Brand compact />
              <Badge
                variant="outline"
                className="inline-flex items-center gap-1.5 rounded-full border-status-info-border bg-status-info-bg px-2.5 py-0.5 text-xs font-medium text-status-info-fg"
              >
                <ShieldCheck className="size-3.5" aria-hidden="true" />
                Revisión final
              </Badge>
            </div>

            <h1 className="text-xl font-semibold tracking-tight text-foreground mt-6">
              Resumen de su Evaluación
            </h1>
            <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
              Verifique el estado de cada subtest antes de confirmar el envío definitivo.
            </p>

            {actionError && (
              <Alert
                role="alert"
                className="mt-4 border-status-danger-border bg-status-danger-bg text-status-danger-fg"
              >
                <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
                <AlertDescription className="text-status-danger-fg">{actionError}</AlertDescription>
              </Alert>
            )}

            <div className="mt-6 space-y-3">
              {orderedSubtests.map((subtest) => {
                const answeredCount = subtest.items.filter((it) => isAnswered(getItemValue(it))).length;
                return (
                  <div
                    key={subtest.id}
                    className="flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/25 p-4"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-foreground">{subtest.name}</div>
                      <div className="text-xs text-muted-foreground mt-0.5 tabular-nums">
                        {subtest.status === "ANULADO"
                          ? "Subtest anulado por el aplicador"
                          : `${answeredCount} de ${subtest.items.length} ítems respondidos`}
                      </div>
                    </div>
                    <StatusBadge domain="attempt" status={subtest.status} />
                  </div>
                );
              })}
            </div>

            {(syncStatus.isOffline || syncStatus.pending > 0) && (
              <Alert className="mt-5 border-status-warning-border bg-status-warning-bg text-status-warning-fg">
                <WifiOff className="size-4 shrink-0" aria-hidden="true" />
                <AlertTitle>Sincronización pendiente</AlertTitle>
                <AlertDescription className="text-status-warning-fg text-xs leading-relaxed tabular-nums space-y-2">
                  <p>
                    Tiene {syncStatus.pending}{" "}
                    {syncStatus.pending === 1 ? "respuesta pendiente" : "respuestas pendientes"} de envío.
                    Debe confirmarse la sincronización antes de entregar la evaluación.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isRetryingSync || isFinishingAttempt}
                    className="gap-1.5 border-status-warning-border bg-card text-foreground hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring"
                    onClick={() => void retrySyncAction()}
                  >
                    <RefreshCw
                      className={cn("size-3.5", isRetryingSync && "animate-spin")}
                      aria-hidden="true"
                    />
                    Reintentar sincronización
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            <UnconfirmedAnswersAlert entries={unconfirmedAnswers} evaluation={evaluation} />

            {rejectedAnswers.length > 0 && (
              <Alert
                role="alert"
                className="mt-5 border-status-danger-border bg-status-danger-bg text-status-danger-fg"
              >
                <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
                <AlertTitle>
                  {rejectedAnswers.length}{" "}
                  {rejectedAnswers.length === 1
                    ? "respuesta no pudo guardarse en el servidor"
                    : "respuestas no pudieron guardarse en el servidor"}
                </AlertTitle>
                <AlertDescription className="text-status-danger-fg text-xs space-y-1">
                  <p>Informe al aplicador si considera necesario revisar estas respuestas:</p>
                  <ul className="list-disc pl-4 space-y-0.5">
                    {rejectedAnswers.map((entry) => (
                      <li key={entry.itemId}>
                        Ítem #{entry.itemId}: {entry.code}
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            <Alert className="mt-5 border-status-info-border bg-status-info-bg text-status-info-fg">
              <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
              <AlertDescription className="text-status-info-fg text-xs leading-relaxed">
                Al confirmar &ldquo;Finalizar evaluación&rdquo;, sus respuestas quedarán registradas
                oficialmente y el intento se dará por concluido.
              </AlertDescription>
            </Alert>

            <div className="mt-6 flex justify-end">
              <Button
                type="button"
                className="h-12 px-5 gap-2 focus-visible:ring-[3px] focus-visible:ring-ring"
                disabled={isFinishingAttempt || state.kind === "finalizando"}
                onClick={() => {
                  clearActionError();
                  setConfirmFinishOpen(true);
                }}
              >
                {isFinishingAttempt || state.kind === "finalizando" ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    Finalizando evaluación...
                  </>
                ) : (
                  "Finalizar evaluación"
                )}
              </Button>
            </div>

            <ConfirmDialog
              open={confirmFinishOpen}
              onOpenChange={setConfirmFinishOpen}
              title="¿Finalizar y entregar la evaluación?"
              description={
                <div className="space-y-2">
                  <p>
                    Esta acción dará por concluida su evaluación de forma definitiva y no podrá volver a
                    modificar sus respuestas.
                  </p>
                  {syncStatus.pending > 0 && (
                    <p className="text-status-warning-fg font-medium tabular-nums">
                      Hay {syncStatus.pending}{" "}
                      {syncStatus.pending === 1 ? "respuesta pendiente" : "respuestas pendientes"} de envío;
                      si falla la sincronización, la evaluación no se cerrará hasta confirmarlas.
                    </p>
                  )}
                  {rejectedAnswers.length > 0 && (
                    <p className="text-status-danger-fg font-medium">
                      Aviso: hay {rejectedAnswers.length}{" "}
                      {rejectedAnswers.length === 1 ? "respuesta rechazada" : "respuestas rechazadas"} por el
                      servidor.
                    </p>
                  )}
                </div>
              }
              confirmLabel="Confirmar entrega final"
              cancelLabel="Cancelar"
              onConfirm={async () => {
                const ok = await finishAttemptAction();
                if (!ok) {
                  throw new Error("No se pudo finalizar la evaluación");
                }
              }}
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  // Estado por defecto: listaSubtests
  const orderedSubtests = [...evaluation.subtests].sort((a, b) => a.order - b.order);

  return (
    <div className="flex-1 flex items-center justify-center p-4 md:p-6">
      <Card className="w-full max-w-2xl rounded-lg border border-border bg-card shadow-[var(--shadow-xs)]">
        <CardContent className="p-6 md:p-8">
          <div className="flex items-center justify-between gap-4">
            <Brand compact />
            <StatusBadge domain="session" status={evaluation.sessionStatus} />
          </div>

          <h1 className="text-xl font-semibold tracking-tight text-foreground mt-6">
            Subtests de la Evaluación
          </h1>
          <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
            Participante: <span className="font-medium text-foreground">{evaluation.participantName}</span> ·
            Complete cada subtest habilitado en el orden indicado.
          </p>

          <Separator className="my-6" />

          <UnconfirmedAnswersAlert entries={unconfirmedAnswers} evaluation={evaluation} />

          <div className="space-y-3 mt-4">
            {orderedSubtests.map((subtest, idx) => {
              const openable = isSubtestOpenable(evaluation, subtest.id);
              const isAnnulled = subtest.status === "ANULADO";
              const isCompleted = subtest.status === "COMPLETADO";
              const isInProgress = subtest.status === "EN_PROGRESO" || subtest.status === "INTERRUMPIDO";

              return (
                <div
                  key={subtest.id}
                  data-subtest-id={subtest.id}
                  className={cn(
                    "flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-lg border p-4 transition-colors",
                    openable
                      ? "border-primary/40 bg-accent/25"
                      : "border-border bg-card",
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={cn(
                        "flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold tabular-nums",
                        isCompleted
                          ? "border border-status-success-border bg-status-success-bg text-status-success-fg"
                          : isAnnulled
                            ? "border border-status-danger-border bg-status-danger-bg text-status-danger-fg"
                            : openable
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground",
                      )}
                    >
                      {isCompleted ? (
                        <CheckCircle2 className="size-4" aria-hidden="true" />
                      ) : isAnnulled ? (
                        <XCircle className="size-4" aria-hidden="true" />
                      ) : (
                        idx + 1
                      )}
                    </div>
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-foreground">{subtest.name}</span>
                        <StatusBadge domain="attempt" status={subtest.status} />
                      </div>
                      <div className="text-xs text-muted-foreground tabular-nums">
                        {subtest.items.length} ítems · Límite: {formatTimeLimit(subtest.timeLimitSeconds)}
                      </div>
                      {isAnnulled && (
                        <p className="text-xs text-status-danger-fg font-medium">
                          Anulado por el aplicador · No disponible
                        </p>
                      )}
                      {!openable && !isCompleted && !isAnnulled && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <Lock className="size-3.5" aria-hidden="true" />
                          Disponible al completar el subtest anterior
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="shrink-0">
                    {openable ? (
                      <Button
                        type="button"
                        className="h-12 w-full sm:w-auto px-5 gap-2 focus-visible:ring-[3px] focus-visible:ring-ring"
                        onClick={() => handleOpenSubtest(subtest.id)}
                      >
                        <Play className="size-4" aria-hidden="true" />
                        {isInProgress ? "Continuar" : "Iniciar"}
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        className="h-12 w-full sm:w-auto px-5"
                        disabled
                      >
                        {isCompleted ? "Finalizado" : isAnnulled ? "Anulado" : "Bloqueado"}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
