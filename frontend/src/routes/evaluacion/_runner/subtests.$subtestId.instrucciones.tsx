import { useEffect, useRef } from "react";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { AlertCircle, AlertTriangle, ArrowLeft, Clock, Loader2, Play } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "../../../app/components/ui/alert";
import { Brand } from "../../../app/components/brand";
import { Button } from "../../../app/components/ui/button";
import { Card, CardContent } from "../../../app/components/ui/card";
import { Separator } from "../../../app/components/ui/separator";
import { StatusBadge } from "../../../app/components/ui/status-badge";
import { useRunner } from "../../../features/runtime/RunnerContext";
import { findSubtest, isSubtestOpenable } from "../../../features/runtime/machine";
import { isTicketCurrent } from "../../../features/runtime/evaluation-guard";
import { ensureCurrentEvaluation } from "../../../features/runtime/queries";
import { useParticipantAuth } from "../../../store/participantAuth";

export const Route = createFileRoute("/evaluacion/_runner/subtests/$subtestId/instrucciones")({
  params: {
    parse: (params) => ({
      subtestId: Number(params.subtestId),
    }),
    stringify: (params) => ({
      subtestId: String(params.subtestId),
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
  },
  component: SubtestInstruccionesRoute,
});

function formatTimeLimit(seconds: number | null): string {
  if (seconds === null) return "Sin límite";
  if (seconds < 60) return `${seconds} segundos`;
  const minutes = Math.round(seconds / 60);
  return `${minutes} ${minutes === 1 ? "minuto" : "minutos"}`;
}

function SubtestInstruccionesRoute() {
  const { subtestId } = Route.useParams();
  const navigate = useNavigate();
  const {
    state,
    evaluation,
    isStartingSubtest,
    actionError,
    clearActionError,
    ensureInstructionsRoute,
    backToListAction,
    startSubtestAction,
  } = useRunner();

  const routeAbortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    routeAbortRef.current = controller;
    return () => {
      controller.abort();
      if (routeAbortRef.current === controller) {
        routeAbortRef.current = null;
      }
    };
  }, [subtestId]);

  useEffect(() => {
    ensureInstructionsRoute(subtestId);
  }, [ensureInstructionsRoute, subtestId]);

  // Solo decide con una evaluación vigente (F2-FIX-7); si no lo está, espera el siguiente /yo vigente.
  useEffect(() => {
    if (!evaluation) return;
    if (!isTicketCurrent(evaluation)) return;
    if (state.kind === "pausada" || state.kind === "bloqueado") return;
    if (
      !isSubtestOpenable(evaluation, subtestId) ||
      state.kind === "resumen" ||
      state.kind === "completada" ||
      state.kind === "bienvenida"
    ) {
      void navigate({ to: "/evaluacion/sesion", replace: true });
    }
  }, [evaluation, state.kind, subtestId, navigate]);

  if (!evaluation) return null;
  const subtest = findSubtest(evaluation, subtestId);
  if (!subtest) return null;

  const isResume = subtest.status === "EN_PROGRESO" || subtest.status === "INTERRUMPIDO";

  const handleBack = () => {
    routeAbortRef.current?.abort();
    clearActionError();
    backToListAction();
    void navigate({ to: "/evaluacion/sesion" });
  };

  const handleStart = async () => {
    clearActionError();
    const signal = routeAbortRef.current?.signal;
    if (signal?.aborted) return;
    if (state.kind === "respondiendo" && state.subtestId === subtestId) {
      void navigate({
        to: "/evaluacion/subtests/$subtestId/items/$ordinal",
        params: { subtestId, ordinal: state.ordinal },
      });
      return;
    }
    const initialOrdinal = await startSubtestAction(subtestId, { signal });
    if (signal?.aborted || initialOrdinal === null) return;
    void navigate({
      to: "/evaluacion/subtests/$subtestId/items/$ordinal",
      params: { subtestId, ordinal: initialOrdinal },
    });
  };

  return (
    <div className="flex-1 flex items-center justify-center p-4 md:p-6">
      <Card className="w-full max-w-2xl rounded-lg border border-border bg-card shadow-[var(--shadow-xs)]">
        <CardContent className="p-6 md:p-8">
          <div className="flex items-center justify-between gap-4">
            <Brand compact />
            <StatusBadge domain="attempt" status={subtest.status} />
          </div>

          <div className="mt-6">
            <p className="text-xs font-medium text-muted-foreground">Instrucciones del subtest</p>
            <h1 className="text-xl font-semibold tracking-tight text-foreground mt-1">{subtest.name}</h1>
          </div>

          {actionError && (
            <Alert
              role="alert"
              className="mt-4 border-status-danger-border bg-status-danger-bg text-status-danger-fg"
            >
              <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
              <AlertDescription className="text-status-danger-fg">{actionError}</AlertDescription>
            </Alert>
          )}

          <Separator className="my-5" />

          <div className="space-y-4">
            <p className="text-sm sm:text-base text-foreground leading-relaxed whitespace-pre-line">
              {subtest.instructions?.trim() ||
                "Lea cuidadosamente cada reactivo y seleccione o ingrese la respuesta que considere correcta."}
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="rounded-lg border border-border bg-muted/40 p-4">
                <div className="text-xs font-medium text-muted-foreground">Cantidad de ítems</div>
                <div className="text-base font-semibold text-foreground mt-1 tabular-nums">
                  {subtest.items.length > 0 ? `${subtest.items.length} ítems` : "Se cargarán al iniciar"}
                </div>
              </div>
              <div className="rounded-lg border border-border bg-muted/40 p-4">
                <div className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <Clock className="size-3.5 shrink-0" aria-hidden="true" />
                  Tiempo límite
                </div>
                <div className="text-base font-semibold text-foreground mt-1 tabular-nums">
                  {formatTimeLimit(subtest.timeLimitSeconds)}
                </div>
              </div>
            </div>
          </div>

          <Alert className="mt-6 border-status-warning-border bg-status-warning-bg text-status-warning-fg">
            <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
            <AlertTitle>
              {isResume ? "El temporizador sigue corriendo desde el inicio del subtest" : "El temporizador iniciará de inmediato"}
            </AlertTitle>
            <AlertDescription className="text-status-warning-fg text-xs leading-relaxed">
              {subtest.timeLimitSeconds !== null
                ? "Al continuar, el tiempo se controla desde el servidor y no se reinicia al recargar la página."
                : "Este subtest no tiene límite de tiempo. Sus respuestas se guardan automáticamente."}
            </AlertDescription>
          </Alert>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <Button
              type="button"
              variant="outline"
              className="h-12 px-5 gap-2 focus-visible:ring-[3px] focus-visible:ring-ring"
              disabled={isStartingSubtest}
              onClick={handleBack}
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
              Volver
            </Button>

            <Button
              type="button"
              className="h-12 px-5 gap-2 focus-visible:ring-[3px] focus-visible:ring-ring"
              disabled={isStartingSubtest}
              onClick={() => void handleStart()}
            >
              {isStartingSubtest ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Preparando subtest...
                </>
              ) : (
                <>
                  <Play className="size-4" aria-hidden="true" />
                  {isResume ? "Continuar subtest" : "Iniciar subtest"}
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
