import { useState } from "react";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Pause, Play, PlayCircle, XCircle, Lock } from "lucide-react";
import { toast } from "sonner";

import type { Assignment, Session } from "../../../api/schemas/sessions";
import { Button } from "../../../app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../app/components/ui/dialog";
import { useConfirm } from "../../../app/components/ui/confirm-dialog";
import { Label } from "../../../app/components/ui/label";
import { PageHeader } from "../../../app/components/ui/page-header";
import { Skeleton } from "../../../app/components/ui/skeleton";
import { StatusBadge } from "../../../app/components/ui/status-badge";
import { Textarea } from "../../../app/components/ui/textarea";
import { cn } from "../../../app/components/ui/utils";
import { captureAccountScope, isAccountChangedError, type AccountScope } from "../../../store/accountScope";
import { availableActions, useSessionTransition, type SessionAction } from "../mutations";
import { sessionDetailQuery, sessionKeys } from "../queries";
import { IncidenceLogProvider } from "./incidenceLog";
import { deriveKpis, errorMessage, useCanApplySessions } from "./model";

const SUCCESS_MESSAGE: Record<SessionAction, string> = {
  open: "Sesión abierta.",
  pause: "Sesión pausada.",
  resume: "Sesión reanudada.",
  close: "Sesión cerrada.",
  cancel: "Sesión cancelada.",
};

const TAB_CLASS =
  "inline-flex h-10 items-center border-b-2 border-transparent px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:border-primary aria-[current=page]:text-foreground";

function SessionTabs({ sessionId }: { sessionId: number }) {
  const id = String(sessionId);
  return (
    <nav aria-label="Secciones de la sesión" className="-mb-px flex flex-wrap gap-1 border-b border-border">
      <Link to="/app/sesiones/$id" params={{ id }} activeOptions={{ exact: true }} className={cn(TAB_CLASS)}>
        Monitor
      </Link>
      <Link to="/app/sesiones/$id/asignaciones" params={{ id }} className={cn(TAB_CLASS)}>
        Participantes y accesos
      </Link>
      <Link to="/app/sesiones/$id/incidencias" params={{ id }} className={cn(TAB_CLASS)}>
        Incidencias
      </Link>
      <Link to="/app/sesiones/$id/pausas" params={{ id }} className={cn(TAB_CLASS)}>
        Pausas
      </Link>
    </nav>
  );
}

function PauseDialog({
  open,
  onOpenChange,
  onSubmit,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (reason: string) => void;
  pending: boolean;
}) {
  const [reason, setReason] = useState("");
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setReason("");
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pausar sesión</DialogTitle>
          <DialogDescription>
            Los participantes no podrán continuar hasta que reanudes la sesión.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="pause-reason">Motivo (opcional)</Label>
          <Textarea
            id="pause-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            placeholder="Ej. falla eléctrica breve"
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Volver
          </Button>
          <Button type="button" onClick={() => onSubmit(reason.trim())} disabled={pending}>
            Pausar sesión
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SessionActions({ session }: { session: Session }) {
  const canApply = useCanApplySessions();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const transition = useSessionTransition(session.id);
  const [pauseOpen, setPauseOpen] = useState(false);

  if (!canApply) return null;
  const actions = availableActions(session.status);

  // `scope` es el capturado al abrir la confirmación (o al pulsar la acción directa).
  const run = async (
    action: SessionAction,
    reason?: string,
    scope: AccountScope = captureAccountScope(),
  ): Promise<void> => {
    try {
      scope.assertCurrent();
      await transition.mutateAsync({ action, reason });
      if (!scope.isCurrent()) return; // cambió la cuenta: no se avisa en nombre de la cuenta anterior
      toast.success(SUCCESS_MESSAGE[action]);
    } catch (error) {
      if (isAccountChangedError(error) || !scope.isCurrent()) throw error;
      toast.error(errorMessage(error, "No se pudo cambiar el estado de la sesión."));
      throw error;
    }
  };

  const runQuiet = (action: SessionAction, reason?: string) => {
    run(action, reason).catch(() => undefined);
  };

  const impact = (): string => {
    const assignments = qc.getQueryData<Assignment[]>(sessionKeys.assignments(session.id));
    if (!assignments) return "";
    const kpis = deriveKpis(assignments);
    return ` Hay ${kpis.inProgress} participante(s) en curso y ${kpis.notStarted} sin iniciar.`;
  };

  const askClose = () => {
    const scope = captureAccountScope();
    void confirm({
      tone: "danger",
      title: "¿Cerrar la sesión?",
      description: `La sesión «${session.name}» pasará a CERRADA: dejará de estar disponible para la aplicación y no podrá volver a abrirse.${impact()}`,
      confirmLabel: "Sí, cerrar sesión",
      cancelLabel: "Volver",
      onConfirm: () => run("close", undefined, scope),
    });
  };

  const askCancel = () => {
    const scope = captureAccountScope();
    void confirm({
      tone: "danger",
      title: "¿Cancelar la sesión?",
      description: `Cancelar es irreversible: la sesión «${session.name}» pasará al estado terminal CANCELADA y no podrá abrirse ni reanudarse.${impact()}`,
      confirmLabel: "Sí, cancelar sesión",
      cancelLabel: "Volver",
      onConfirm: () => run("cancel", undefined, scope),
    });
  };

  return (
    <>
      {actions.open && (
        <Button type="button" onClick={() => runQuiet("open")} disabled={transition.isPending}>
          <Play className="size-4" aria-hidden="true" />
          Abrir sesión
        </Button>
      )}
      {actions.resume && (
        <Button type="button" onClick={() => runQuiet("resume")} disabled={transition.isPending}>
          <PlayCircle className="size-4" aria-hidden="true" />
          Reanudar
        </Button>
      )}
      {actions.pause && (
        <Button type="button" variant="outline" onClick={() => setPauseOpen(true)} disabled={transition.isPending}>
          <Pause className="size-4" aria-hidden="true" />
          Pausar
        </Button>
      )}
      {actions.close && (
        <Button type="button" variant="outline" onClick={askClose} disabled={transition.isPending}>
          <Lock className="size-4" aria-hidden="true" />
          Cerrar sesión
        </Button>
      )}
      {actions.cancel && (
        <Button type="button" variant="destructive" onClick={askCancel} disabled={transition.isPending}>
          <XCircle className="size-4" aria-hidden="true" />
          Cancelar sesión
        </Button>
      )}
      <PauseDialog
        open={pauseOpen}
        onOpenChange={setPauseOpen}
        pending={transition.isPending}
        onSubmit={(reason) => {
          run("pause", reason || undefined)
            .then(() => setPauseOpen(false))
            .catch(() => undefined);
        }}
      />
    </>
  );
}

/**
 * Layout de `/app/sesiones/$id`: cabecera con estado y transiciones, pestañas como enlaces
 * (deep-link por ruta hija) y `<Outlet />` para el contenido de cada pestaña.
 */
export function SessionDetailLayout({ sessionId }: { sessionId: number }) {
  const validId = Number.isInteger(sessionId) && sessionId > 0;
  // Solo la pestaña Monitor (ruta índice) necesita datos en vivo; las demás no sondean la sesión.
  const monitorActive = useRouterState({
    select: (state) => state.location.pathname.replace(/\/+$/, "") === `/app/sesiones/${sessionId}`,
  });
  const query = useQuery({ ...sessionDetailQuery(sessionId, { poll: monitorActive }), enabled: validId });

  const breadcrumbs = (name: string) => [
    {
      label: "Sesiones",
      to: "/app/sesiones",
      renderLink: ({ label }: { label: string }) => <Link to="/app/sesiones">{label}</Link>,
    },
    { label: name },
  ];

  if (!validId) {
    return (
      <div className="space-y-6">
        <PageHeader title="Sesión no encontrada" breadcrumbs={breadcrumbs("No encontrada")} />
        <p role="alert" className="text-sm text-muted-foreground">
          El identificador de sesión no es válido.
        </p>
      </div>
    );
  }

  if (query.isPending) {
    return (
      <div className="space-y-6" aria-busy="true">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (query.isError && query.data === undefined) {
    return (
      <div className="space-y-6">
        <PageHeader title="Sesión" breadcrumbs={breadcrumbs("Detalle")} />
        <div
          role="alert"
          className="flex flex-col items-center justify-center rounded-lg border border-danger-border bg-danger-muted/60 p-6 text-center"
        >
          <AlertCircle aria-hidden="true" className="mb-2 size-6 text-danger-foreground" />
          <p className="text-sm font-medium text-danger-foreground">
            {errorMessage(query.error, "No se pudo cargar la sesión.")}
          </p>
          <Button type="button" variant="outline" size="sm" className="mt-4" onClick={() => void query.refetch()}>
            Reintentar
          </Button>
        </div>
      </div>
    );
  }

  const session = query.data as Session;
  const subtitleParts = [session.code, session.location].filter((part): part is string => Boolean(part));

  return (
    <IncidenceLogProvider>
      <div className="space-y-6">
        <div className="space-y-4">
          <PageHeader
            className="border-b-0 pb-0"
            breadcrumbs={breadcrumbs(session.name)}
            title={
              <span className="flex flex-wrap items-center gap-3">
                {session.name}
                <StatusBadge domain="session" status={session.status} />
              </span>
            }
            subtitle={<span className="font-mono text-xs">{subtitleParts.join(" · ")}</span>}
            actions={<SessionActions session={session} />}
          />
          <SessionTabs sessionId={sessionId} />
        </div>
        {query.isError && (
          <div
            role="alert"
            data-testid="reload-error"
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning-border bg-warning-muted p-3 text-sm text-warning-foreground"
          >
            <span className="flex items-center gap-2">
              <AlertCircle aria-hidden="true" className="size-4 shrink-0" />
              {errorMessage(query.error, "No se pudo actualizar la sesión.")} Se muestran los últimos datos cargados.
            </span>
            <Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()}>
              Reintentar
            </Button>
          </div>
        )}
        <Outlet />
      </div>
    </IncidenceLogProvider>
  );
}
