import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "../../../app/components/ui/button";
import { useConfirm } from "../../../app/components/ui/confirm-dialog";
import { LoadingState } from "../../../app/components/ui/loading-state";
import { PageHeader } from "../../../app/components/ui/page-header";
import { StatusBadge } from "../../../app/components/ui/status-badge";
import { captureAccountScope, isAccountChangedError } from "../../../store/accountScope";
import { PERMISSIONS } from "../../../store/permissions";
import { useStaffAuth } from "../../../store/staffAuth";
import { countUnexported, useExportTracker } from "../access/exportTracker";
import { useCanReadParticipants } from "../access/participantReadGate";
import { useUnsavedLinksGuard } from "../access/UnsavedLinksGuard";
import { availableActions, useSessionTransition } from "../mutations";
import { sessionAssignmentsQuery, sessionDetailQuery } from "../queries";
import { ExitDialog } from "./components/exit-dialog";
import { AccessSheet } from "./components/access-sheet";
import { InlineAlert } from "./components/form-bits";
import { StepData, type SessionDraft } from "./components/step-data";
import { StepParticipants } from "./components/step-participants";
import { StepReview } from "./components/step-review";
import { StepSubtests } from "./components/step-subtests";
import { Stepper, type StepperStep } from "./components/stepper";
import type { SubtestRow } from "./subtest-rows";
import type { AccessEntry, AssignmentFailure, InstrumentInfo } from "./types";
import { errorMessage } from "./wizard-queries";

/**
 * Orden elegido: el instrumento (test → versión) se elige en el mismo paso que los datos porque
 * `POST /sesiones` exige `versionTestId`; al crear, la sesión queda PROGRAMADA en el servidor y los
 * pasos siguientes (subtests, participantes) la editan. Así el wizard es reanudable con `?sessionId=N`.
 */
export const WIZARD_STEPS: readonly StepperStep[] = [
  { id: "data", label: "Datos e instrumento" },
  { id: "subtests", label: "Subtests" },
  { id: "participants", label: "Participantes" },
  { id: "review", label: "Revisión" },
];

const STEP_DATA = 0;
const STEP_SUBTESTS = 1;
const STEP_PARTICIPANTS = 2;
const STEP_REVIEW = 3;

export type WizardExitTarget = { to: "list" } | { to: "monitor"; sessionId: number };

interface SessionWizardPageProps {
  /** Valor de `?sessionId` (reanudación). */
  sessionId: number | undefined;
  onSessionIdChange: (sessionId: number) => void;
  onExit: (target: WizardExitTarget) => void;
}

export function SessionWizardPage({ sessionId, onSessionIdChange, onExit }: SessionWizardPageProps) {
  const confirm = useConfirm();
  const canApply = useStaffAuth((s) => s.hasPermission(PERMISSIONS.SESION_APLICAR));
  const canReadParticipants = useCanReadParticipants();

  const sessionQuery = useQuery({ ...sessionDetailQuery(sessionId ?? 0), enabled: sessionId !== undefined });
  const assignmentsQuery = useQuery({
    ...sessionAssignmentsQuery(sessionId ?? 0),
    enabled: sessionId !== undefined,
  });
  const transition = useSessionTransition(sessionId ?? 0);
  // El wizard se montó con ?sessionId: el backend no devuelve la configuración previa de subtests (B4).
  const [resumed] = useState(() => sessionId !== undefined);

  const session = sessionId !== undefined ? (sessionQuery.data ?? null) : null;

  // Estado del wizard: solo en memoria del componente (los tokens NUNCA salen de aquí).
  const [step, setStep] = useState<number | null>(null);
  const [maxVisited, setMaxVisited] = useState(0);
  const [draft, setDraft] = useState<SessionDraft | null>(null);
  const [instrument, setInstrument] = useState<InstrumentInfo | null>(null);
  const [rows, setRows] = useState<SubtestRow[] | null>(null);
  const [savedSignature, setSavedSignature] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [failures, setFailures] = useState<AssignmentFailure[]>([]);
  const [entries, setEntries] = useState<AccessEntry[]>([]);
  const [lockedSubtestIds, setLockedSubtestIds] = useState<ReadonlySet<number>>(() => new Set());
  const { exportedIds, markExported } = useExportTracker();
  // Lotes de asignación con una petición posiblemente en vuelo. Sigue > 0 aunque StepParticipants se haya
  // desmontado (sesión a solo lectura): la respuesta de un POST ya enviado se publica aquí al llegar.
  const [inFlight, setInFlight] = useState(0);
  const busy = inFlight > 0;
  const [leaving, setLeaving] = useState(false);
  const [exitDialogOpen, setExitDialogOpen] = useState(false);

  const serverAssignments = useMemo(() => assignmentsQuery.data ?? [], [assignmentsQuery.data]);
  const assignedIds = useMemo(() => {
    const ids = new Set(serverAssignments.map((a) => a.participantId));
    for (const entry of entries) ids.add(entry.participantId);
    return ids;
  }, [serverAssignments, entries]);
  // Fallos vigentes: se derivan en cada render contra las asignaciones conocidas AHORA, así quien quedó asignado
  // (desde otra pestaña o por una recarga durante un lote) nunca figura como «sin asignar», sin importar el orden
  // en que lleguen el resultado del lote y la recarga de asignaciones.
  const visibleFailures = useMemo(
    () => failures.filter((f) => !assignedIds.has(f.participantId)),
    [failures, assignedIds],
  );

  // Sesión que ya no es PROGRAMADA: vista de solo lectura (StepParticipants se desmonta y no envía más POST,
  // pero la petición en vuelo termina y publica su token en `entries`).
  const pendingLinks = countUnexported(entries, exportedIds);
  const codesUnsaved = pendingLinks > 0;

  // Bloquea navegación (breadcrumb, menú, Atrás) y cierre de pestaña mientras haya enlaces sin exportar.
  // El bloqueo rige desde que EMPIEZA un lote de asignación (`busy`) hasta que termina la última petición
  // en vuelo, también en solo lectura: el token que aún no llegó no se puede recuperar después.
  const { dialog: leaveDialog, bypassRef } = useUnsavedLinksGuard(pendingLinks + (busy ? 1 : 0), busy);

  // Sesión reanudada: sin asignaciones → subtests pendientes; con asignaciones → participantes.
  const resumedStep = serverAssignments.length > 0 ? STEP_PARTICIPANTS : STEP_SUBTESTS;
  const current = session ? (step ?? resumedStep) : STEP_DATA;

  // Al avanzar/retroceder de paso el foco pasa al encabezado del paso (lectores de pantalla y teclado).
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusHeadingPending = useRef(false);
  useEffect(() => {
    if (!focusHeadingPending.current) return;
    focusHeadingPending.current = false;
    headingRef.current?.focus();
  }, [current]);

  const canCancel = session !== null && canApply && availableActions(session.status).cancel;

  const goTo = useCallback((index: number) => {
    focusHeadingPending.current = true;
    setStep(index);
    setMaxVisited((prev) => Math.max(prev, index));
  }, []);

  const confirmDiscardCodes = async (): Promise<boolean> => {
    if (!codesUnsaved) return true;
    return confirm({
      tone: "danger",
      title: "Salir sin copiar los códigos",
      description: `Hay ${pendingLinks} enlace(s) de acceso que todavía no copió, imprimió ni descargó. El token no se puede volver a mostrar ni regenerar todavía, así que esos participantes quedarían sin enlace.`,
      confirmLabel: "Salir de todos modos",
      cancelLabel: "Volver a la hoja",
    });
  };

  const leave = async (target: WizardExitTarget) => {
    const scope = captureAccountScope();
    if (!(await confirmDiscardCodes()) || !scope.isCurrent()) return;
    bypassRef.current = true;
    setLeaving(true);
    onExit(target);
  };

  const openNow = async () => {
    if (sessionId === undefined) return;
    const scope = captureAccountScope();
    if (!(await confirmDiscardCodes()) || !scope.isCurrent()) return;
    try {
      await transition.mutateAsync({ action: "open" });
      if (!scope.isCurrent()) return; // cambió la cuenta: no se avisa ni se navega
      toast.success("Sesión abierta.");
      bypassRef.current = true;
      setLeaving(true);
      onExit({ to: "monitor", sessionId });
    } catch (error) {
      if (isAccountChangedError(error) || !scope.isCurrent()) return;
      toast.error(errorMessage(error, "No se pudo abrir la sesión."));
    }
  };

  const cancelCreatedSession = async () => {
    if (sessionId === undefined || !canCancel) return;
    setExitDialogOpen(false);
    const scope = captureAccountScope();
    const confirmed = await confirm({
      tone: "danger",
      title: "Cancelar sesión creada",
      description:
        "La sesión pasará a estado Cancelada y sus accesos dejarán de ser válidos. Esta acción no se puede deshacer.",
      confirmLabel: "Cancelar sesión creada",
      cancelLabel: "Volver",
    });
    if (!confirmed || !scope.isCurrent()) return;
    try {
      await transition.mutateAsync({ action: "cancel" });
      if (!scope.isCurrent()) return;
      toast.success("Sesión cancelada.");
      bypassRef.current = true;
      setLeaving(true);
      onExit({ to: "list" });
    } catch (error) {
      if (isAccountChangedError(error) || !scope.isCurrent()) return;
      toast.error(errorMessage(error, "No se pudo cancelar la sesión."));
    }
  };

  const requestCancelWizard = async () => {
    if (session) {
      setExitDialogOpen(true);
      return;
    }
    const hasDraft = Boolean(draft?.name?.trim() || draft?.location?.trim() || draft?.description?.trim());
    if (hasDraft) {
      const scope = captureAccountScope();
      const discard = await confirm({
        title: "Descartar el borrador",
        description: "Todavía no se creó ninguna sesión; los datos escritos se perderán.",
        confirmLabel: "Descartar",
        cancelLabel: "Seguir editando",
      });
      if (!discard || !scope.isCurrent()) return;
    }
    setLeaving(true);
    onExit({ to: "list" });
  };

  const keepScheduled = async () => {
    setExitDialogOpen(false);
    await leave({ to: "list" });
  };

  const renderHeader = (withActions: boolean) => (
    <PageHeader
      title="Nueva sesión"
      subtitle="Cree la sesión, configure el instrumento y asigne participantes."
      breadcrumbs={[{ label: "Sesiones", to: "/app/sesiones" }, { label: "Nueva sesión" }]}
      renderBreadcrumbLink={({ label }) => <Link to="/app/sesiones">{label}</Link>}
      actions={
        withActions ? (
          <Button type="button" variant="outline" onClick={() => void requestCancelWizard()} disabled={busy || leaving}>
            Cancelar
          </Button>
        ) : undefined
      }
    />
  );
  const header = renderHeader(true);

  // El diálogo del guard se renderiza fuera de `renderBody` para que esté presente en TODAS las vistas
  // (carga, error, solo lectura, pasos): el guard nunca queda "blocked" sin diálogo visible.
  const renderBody = (): ReactNode => {
    // --- Reanudación: espera a conocer la sesión (y sus asignaciones) para saltar al paso pendiente.
    if (sessionId !== undefined && !session) {
      if (sessionQuery.isError) {
        return (
          <div className="mx-auto max-w-5xl space-y-6">
            {header}
            <InlineAlert
              tone="danger"
              title="No se pudo cargar la sesión"
              action={
                <Button type="button" variant="outline" size="sm" onClick={() => void sessionQuery.refetch()}>
                  Reintentar
                </Button>
              }
            >
              {errorMessage(sessionQuery.error, "Verifique que la sesión exista y que tenga permiso para verla.")}
            </InlineAlert>
          </div>
        );
      }
      return (
        <div className="mx-auto max-w-5xl space-y-6">
          {header}
          <LoadingState message="Cargando la sesión…" />
        </div>
      );
    }

    if (session && session.status !== "PROGRAMADA" && !leaving) {
      return (
        <div className="mx-auto max-w-5xl space-y-6">
          {renderHeader(false)}
          <InlineAlert
            tone="info"
            title="Esta sesión ya no se puede configurar desde el asistente"
            action={
              <Button asChild size="sm">
                <Link to="/app/sesiones/$id" params={{ id: String(session.id) }}>
                  Ir al detalle de la sesión
                </Link>
              </Button>
            }
          >
            <span className="inline-flex items-center gap-2">
              Estado actual: <StatusBadge domain="session" status={session.status} />. Solo las sesiones programadas
              pueden editarse aquí.
            </span>
          </InlineAlert>
          {busy && (
            <InlineAlert tone="info" title="Hay una asignación en curso">
              Se está terminando de procesar la última asignación enviada. Su enlace aparecerá en la hoja de accesos
              apenas llegue; no se enviarán más asignaciones.
            </InlineAlert>
          )}
          {entries.length > 0 && (
            <>
              <InlineAlert tone="warning" title="Enlaces emitidos en esta visita">
                La sesión cambió de estado mientras configuraba el acceso. Los enlaces ya emitidos no se pueden volver a
                mostrar: cópielos, imprímalos o descárguelos antes de salir.
              </InlineAlert>
              <AccessSheet session={session} entries={entries} exportedIds={exportedIds} onExported={markExported} />
            </>
          )}
        </div>
      );
    }

    if (session && !assignmentsQuery.data && assignmentsQuery.isError) {
      return (
        <div className="mx-auto max-w-5xl space-y-6">
          {header}
          <InlineAlert
            tone="danger"
            title="No se pudieron cargar las asignaciones de la sesión"
            action={
              <Button type="button" variant="outline" size="sm" onClick={() => void assignmentsQuery.refetch()}>
                Reintentar
              </Button>
            }
          >
            {errorMessage(
              assignmentsQuery.error,
              "Sin conocer las asignaciones existentes no se puede retomar la sesión de forma segura.",
            )}
          </InlineAlert>
        </div>
      );
    }

    if (session && step === null && assignmentsQuery.isPending) {
      return (
        <div className="mx-auto max-w-5xl space-y-6">
          {header}
          <LoadingState message="Retomando la sesión…" />
        </div>
      );
    }

    const maxReachable = session ? Math.max(maxVisited, current) : STEP_DATA;

    return (
      <div className="mx-auto max-w-5xl space-y-6">
        {header}
        <Stepper steps={WIZARD_STEPS} current={current} maxReachable={maxReachable} onSelect={goTo} disabled={busy || leaving} />

        <h2 ref={headingRef} tabIndex={-1} className="text-sm font-medium text-muted-foreground outline-none">
          Paso {current + 1} de {WIZARD_STEPS.length} · {WIZARD_STEPS[current].label}
        </h2>

        <div>
          {current === STEP_DATA && (
            <StepData
              session={session}
              instrument={instrument}
              draft={draft}
              onDraftChange={setDraft}
              onCreated={(created, info) => {
                setInstrument(info);
                goTo(STEP_SUBTESTS);
                onSessionIdChange(created.id);
              }}
              onContinue={() => goTo(STEP_SUBTESTS)}
            />
          )}

          {session && current === STEP_SUBTESTS && (
            <StepSubtests
              sessionId={session.id}
              versionId={session.versionTestId}
              instrument={instrument}
              rows={rows}
              onRowsChange={setRows}
              savedSignature={savedSignature}
              lockedIds={lockedSubtestIds}
              resumed={resumed}
              onSaved={(result) => {
                setSavedSignature(result.signature);
                setRows(result.rows);
                setLockedSubtestIds(result.lockedIds);
              }}
              onBack={() => goTo(STEP_DATA)}
              onContinue={() => goTo(STEP_PARTICIPANTS)}
            />
          )}

          {session && current === STEP_PARTICIPANTS && (
            <StepParticipants
              sessionId={session.id}
              schedule={session}
              canAssign={canApply}
              canReadParticipants={canReadParticipants}
              assignedIds={assignedIds}
              selectedIds={selectedIds}
              onSelectedChange={setSelectedIds}
              failures={visibleFailures}
              onFailuresChange={setFailures}
              onAccessGranted={(entry) =>
                setEntries((prev) => [...prev.filter((e) => e.assignmentId !== entry.assignmentId), entry])
              }
              onBatchStart={() => setInFlight((n) => n + 1)}
              onBatchEnd={() => setInFlight((n) => Math.max(0, n - 1))}
              onBack={() => goTo(STEP_SUBTESTS)}
              onContinue={() => goTo(STEP_REVIEW)}
            />
          )}

          {session && current === STEP_REVIEW && (
            <StepReview
              session={session}
              instrument={instrument}
              subtestRows={savedSignature !== null ? rows : null}
              assignedCount={assignedIds.size}
              entries={entries}
              failures={visibleFailures}
              canOpen={canApply && session.status === "PROGRAMADA"}
              opening={transition.isPending}
              exportedIds={exportedIds}
              onExported={markExported}
              onBack={() => goTo(STEP_PARTICIPANTS)}
              onGoMonitor={() => void leave({ to: "monitor", sessionId: session.id })}
              onOpenNow={() => void openNow()}
            />
          )}
        </div>

        {session && (
          <ExitDialog
            open={exitDialogOpen}
            onOpenChange={setExitDialogOpen}
            sessionCode={session.code}
            canCancel={canCancel}
            onKeepScheduled={() => void keepScheduled()}
            onCancelSession={() => void cancelCreatedSession()}
          />
        )}
      </div>
    );
  };

  return (
    <>
      {renderBody()}
      {leaveDialog}
    </>
  );
}
