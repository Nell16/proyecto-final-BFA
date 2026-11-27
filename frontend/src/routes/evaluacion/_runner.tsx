import { useEffect } from "react";
import { createFileRoute, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { AlertCircle, AlertTriangle, CheckCircle2, Clock, Lock, PauseCircle, RefreshCw, ShieldAlert } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "../../app/components/ui/alert";
import { Brand } from "../../app/components/brand";
import { Button } from "../../app/components/ui/button";
import { Card, CardContent } from "../../app/components/ui/card";
import { Skeleton } from "../../app/components/ui/skeleton";
import { StatusBadge } from "../../app/components/ui/status-badge";
import { RunnerProvider, useRunner } from "../../features/runtime/RunnerContext";
import { useDiscardNotice } from "../../features/runtime/draft";
import type { BlockReason } from "../../features/runtime/machine";
import { deliveredHadUnconfirmed } from "../../store/deliveredMarker";
import { useParticipantAuth } from "../../store/participantAuth";

export const Route = createFileRoute("/evaluacion/_runner")({
  beforeLoad: () => {
    const { token, assignmentId } = useParticipantAuth.getState();
    if (!token || assignmentId === null) {
      throw redirect({ to: "/evaluacion/acceso", replace: true });
    }
  },
  component: EvaluacionRunnerLayout,
});

function formatDurationMs(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  if (hours > 0) {
    return `${hours}:${mm}:${ss}`;
  }
  return `${mm}:${ss}`;
}

const BLOCK_MESSAGES: Record<BlockReason, { title: string; description: string }> = {
  sesionCerrada: {
    title: "Sesión finalizada",
    description: "La sesión de evaluación ha sido cerrada por el aplicador. Ya no es posible continuar.",
  },
  sesionCancelada: {
    title: "Sesión cancelada",
    description: "La sesión de evaluación fue cancelada. Consulte con su aplicador para más indicaciones.",
  },
  sesionNoAbierta: {
    title: "Sesión no disponible",
    description: "La sesión de evaluación aún no está abierta. Espere a que el aplicador la habilite.",
  },
  accesoRevocado: {
    title: "Acceso revocado",
    description: "Su autorización de acceso ha sido revocada o venció. Solicite un nuevo código al aplicador.",
  },
  expirado: {
    title: "Acceso expirado",
    description: "El enlace o tiempo límite de acceso ha expirado. Solicite una nueva asignación al aplicador.",
  },
  asignacionNoOperable: {
    title: "Asignación no operable",
    description:
      "Esta evaluación ya no admite respuestas. Si ya la entregaste, tus respuestas quedaron registradas. Consulta al aplicador si tienes dudas.",
  },
  evaluacionEntregada: {
    title: "Evaluación entregada",
    description:
      "Tu evaluación fue entregada. Si tienes dudas sobre tus respuestas, consulta al aplicador. No es posible modificarlas. Puedes cerrar esta ventana.",
  },
};

function DiscardNoticeBanner() {
  const { notice, dismiss } = useDiscardNotice();
  if (!notice) return null;

  return (
    <div className="border-b border-status-warning-border bg-status-warning-bg px-4 py-2.5 text-status-warning-fg">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs sm:text-sm font-medium leading-snug tabular-nums">
          <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
          <span>
            Se descartaron {notice.count}{" "}
            {notice.count === 1 ? "respuesta pendiente" : "respuestas pendientes"} de una sesión anterior
            {notice.previousAssignmentId !== null ? ` (asignación #${notice.previousAssignmentId})` : ""} para
            proteger su evaluación actual.
          </span>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0 border-status-warning-border bg-card text-foreground hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring"
          onClick={dismiss}
        >
          Entendido
        </Button>
      </div>
    </div>
  );
}

function RunnerShell() {
  const navigate = useNavigate();
  const assignmentId = useParticipantAuth((s) => s.assignmentId);
  const { state, evaluation, remainingTimeMs, evaluationError, refetchEvaluation } = useRunner();

  useEffect(() => {
    if (state.kind !== "respondiendo") return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [state.kind]);

  const handleBackToAccess = () => {
    useParticipantAuth.getState().clear();
    void navigate({ to: "/evaluacion/acceso", replace: true });
  };

  if (state.kind === "validando") {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <DiscardNoticeBanner />
        <div className="flex-1 flex items-center justify-center p-4 md:p-6">
          <Card className="w-full max-w-lg rounded-lg border border-border bg-card shadow-[var(--shadow-xs)]">
            <CardContent className="p-6 sm:p-8 space-y-5">
              <div className="flex justify-center">
                <Brand />
              </div>

              {evaluationError ? (
                <Alert
                  role="alert"
                  className="border-status-danger-border bg-status-danger-bg text-status-danger-fg"
                >
                  <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
                  <AlertTitle>Error al cargar la evaluación</AlertTitle>
                  <AlertDescription className="text-status-danger-fg space-y-3">
                    <p>No fue posible recuperar el estado de su evaluación. Verifique su conexión.</p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="border-status-danger-border bg-card text-foreground hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring"
                        onClick={refetchEvaluation}
                      >
                        <RefreshCw className="size-3.5" aria-hidden="true" />
                        Reintentar
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="focus-visible:ring-[3px] focus-visible:ring-ring"
                        onClick={handleBackToAccess}
                      >
                        Volver al acceso
                      </Button>
                    </div>
                  </AlertDescription>
                </Alert>
              ) : (
                <div className="space-y-3" aria-busy="true" aria-label="Cargando evaluación">
                  <Skeleton className="h-6 w-2/3 mx-auto bg-muted" />
                  <Skeleton className="h-4 w-1/2 mx-auto bg-muted" />
                  <div className="space-y-2.5 pt-2">
                    <Skeleton className="h-16 w-full rounded-lg bg-muted" />
                    <Skeleton className="h-16 w-full rounded-lg bg-muted" />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (state.kind === "pausada") {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <DiscardNoticeBanner />
        <div className="flex-1 flex items-center justify-center p-4 md:p-6">
          <Card className="w-full max-w-lg rounded-lg border border-border bg-card shadow-[var(--shadow-xs)]">
            <CardContent className="p-6 sm:p-8 text-center space-y-5">
              <div className="flex items-center justify-between gap-3">
                <Brand compact />
                <StatusBadge domain="session" status="PAUSADA" />
              </div>

              <div className="mx-auto flex size-12 items-center justify-center rounded-full border border-status-warning-border bg-status-warning-bg text-status-warning-fg">
                <PauseCircle className="size-6" aria-hidden="true" />
              </div>

              <div className="space-y-2">
                <h1 className="text-xl font-semibold tracking-tight text-foreground">
                  Evaluación pausada
                </h1>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  El aplicador ha pausado temporalmente la sesión. Permanezca en esta pantalla: su progreso
                  y tiempo restante están congelados y la prueba se reanudará automáticamente.
                </p>
              </div>

              {remainingTimeMs !== null && (
                <div className="inline-flex items-center gap-2 rounded-md border border-status-warning-border bg-status-warning-bg px-4 py-2 font-mono text-sm font-semibold tabular-nums text-status-warning-fg">
                  <Clock className="size-4 shrink-0" aria-hidden="true" />
                  Tiempo restante congelado: {formatDurationMs(remainingTimeMs)}
                </div>
              )}

              {evaluation && (
                <div className="rounded-lg border border-border bg-muted/50 px-4 py-3 text-xs text-muted-foreground leading-relaxed">
                  Participante: <span className="font-medium text-foreground">{evaluation.participantName}</span> ·
                  Sesión: <span className="font-medium text-foreground">{evaluation.sessionName}</span>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (state.kind === "bloqueado") {
    const info = BLOCK_MESSAGES[state.reason];
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <DiscardNoticeBanner />
        <div className="flex-1 flex items-center justify-center p-4 md:p-6">
          <Card className="w-full max-w-lg rounded-lg border border-border bg-card shadow-[var(--shadow-xs)]">
            <CardContent className="p-6 sm:p-8 text-center space-y-5">
              <div className="flex justify-center">
                <Brand />
              </div>

              <div
                className={
                  state.reason === "evaluacionEntregada"
                    ? "mx-auto flex size-12 items-center justify-center rounded-full border border-status-success-border bg-status-success-bg text-status-success-fg"
                    : "mx-auto flex size-12 items-center justify-center rounded-full border border-status-danger-border bg-status-danger-bg text-status-danger-fg"
                }
              >
                {state.reason === "evaluacionEntregada" ? (
                  <CheckCircle2 className="size-6" aria-hidden="true" />
                ) : state.reason === "accesoRevocado" ? (
                  <ShieldAlert className="size-6" aria-hidden="true" />
                ) : (
                  <Lock className="size-6" aria-hidden="true" />
                )}
              </div>

              <div className="space-y-2">
                <h1 className="text-xl font-semibold tracking-tight text-foreground">{info.title}</h1>
                <p className="text-sm text-muted-foreground leading-relaxed">{info.description}</p>
              </div>

              {state.reason === "evaluacionEntregada" && deliveredHadUnconfirmed(assignmentId) && (
                <Alert
                  role="alert"
                  className="border-status-warning-border bg-status-warning-bg text-status-warning-fg text-left"
                >
                  <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
                  <AlertTitle>Algunas respuestas pudieron no sincronizarse</AlertTitle>
                  <AlertDescription className="text-status-warning-fg text-xs">
                    Al entregar quedaban respuestas sin confirmar en el servidor. Avisa al aplicador para que verifique
                    tus respuestas.
                  </AlertDescription>
                </Alert>
              )}

              <Button
                type="button"
                className="w-full h-12 px-5 focus-visible:ring-[3px] focus-visible:ring-ring"
                onClick={handleBackToAccess}
              >
                Volver al inicio
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <DiscardNoticeBanner />
      <Outlet />
    </div>
  );
}

export function EvaluacionRunnerLayout() {
  return (
    <RunnerProvider>
      <RunnerShell />
    </RunnerProvider>
  );
}
