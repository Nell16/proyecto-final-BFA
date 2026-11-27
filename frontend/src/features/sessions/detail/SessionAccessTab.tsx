import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Info, UserPlus } from "lucide-react";
import { toast } from "sonner";

import type { Assignment } from "../../../api/schemas/sessions";
import { Alert, AlertDescription } from "../../../app/components/ui/alert";
import { Button } from "../../../app/components/ui/button";
import { useConfirm } from "../../../app/components/ui/confirm-dialog";
import { DataTable, type DataTableColumn } from "../../../app/components/ui/data-table";
import { EmptyState } from "../../../app/components/ui/empty-state";
import { captureAccountScope, isAccountChangedError } from "../../../store/accountScope";
import { useCanReadParticipants } from "../access/participantReadGate";
import { countUnexported, useExportTracker } from "../access/exportTracker";
import { useUnsavedLinksGuard } from "../access/UnsavedLinksGuard";
import { useRevokeAssignment } from "../mutations";
import { sessionAssignmentsQuery, sessionDetailQuery } from "../queries";
import { AccessSheetDialog } from "./AccessSheetDialog";
import { AddParticipantsDialog } from "./AddParticipantsDialog";
import { LinkStatusBadge } from "./LinkStatusBadge";
import type { AccessEntry } from "./accessSheet";
import { formatDateTime } from "./format";
import { errorMessage, useCanApplySessions } from "./model";

const canRevoke = (a: Assignment) => a.linkStatus === "GENERADO" || a.linkStatus === "ACTIVO";

export function SessionAccessTab({ sessionId }: { sessionId: number }) {
  const canApply = useCanApplySessions();
  const confirm = useConfirm();
  const sessionQuery = useQuery(sessionDetailQuery(sessionId));
  const session = sessionQuery.data;
  const query = useQuery(sessionAssignmentsQuery(sessionId));
  const revoke = useRevokeAssignment(sessionId);
  const [addOpen, setAddOpen] = useState(false);
  const [sheet, setSheet] = useState<AccessEntry[] | null>(null);
  const canReadParticipants = useCanReadParticipants();
  // `batching`: hay un lote de asignación en curso. El bloqueo de salida rige desde que empieza el lote.
  const [batching, setBatching] = useState(false);
  const { exportedIds, markExported, reset: resetExported } = useExportTracker();
  const { dialog: leaveDialog } = useUnsavedLinksGuard(countUnexported(sheet, exportedIds) + (batching ? 1 : 0), batching);

  // Cualquier asignación existente (incluida la revocada) excluye al participante: el backend no admite
  // una segunda asignación para el mismo participante en la sesión.
  const assignedIds = useMemo(() => new Set((query.data ?? []).map((a) => a.participantId)), [query.data]);

  const sessionClosed = session?.status === "CERRADA" || session?.status === "CANCELADA";

  const askRevoke = (assignment: Assignment) => {
    const scope = captureAccountScope(); // cuenta vigente al abrir la confirmación
    void confirm({
      tone: "danger",
      title: `¿Revocar el acceso de ${assignment.participantName}?`,
      description:
        "El enlace de acceso dejará de funcionar y el participante no podrá ingresar a la evaluación. Esta pantalla no permite reactivarlo.",
      confirmLabel: "Revocar acceso",
      cancelLabel: "Volver",
      onConfirm: async () => {
        try {
          scope.assertCurrent();
          await revoke.mutateAsync(assignment.assignmentId);
          if (!scope.isCurrent()) return;
          toast.success("Acceso revocado.");
        } catch (error) {
          if (isAccountChangedError(error) || !scope.isCurrent()) throw error;
          toast.error(errorMessage(error, "No se pudo revocar el acceso."));
          throw error;
        }
      },
    });
  };

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
    { id: "linkStatus", header: "Enlace", cell: (a) => <LinkStatusBadge status={a.linkStatus} /> },
    {
      id: "expiresAt",
      header: "Expira",
      className: "tabular-nums",
      cell: (a) => formatDateTime(a.tokenExpiresAt),
    },
    {
      id: "code",
      header: "Código de acceso",
      cell: () => <span className="text-muted-foreground">Código entregado</span>,
    },
    {
      id: "actions",
      header: <span className="sr-only">Acciones</span>,
      className: "text-right",
      cell: (a) =>
        canApply && canRevoke(a) ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-danger-foreground hover:text-danger-foreground"
            onClick={() => askRevoke(a)}
            aria-label={`Revocar acceso de ${a.participantName}`}
          >
            Revocar
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-4">
      <Alert className="border-info-border bg-info-muted text-info-foreground">
        <Info aria-hidden="true" />
        <AlertDescription className="text-info-foreground">
          El código de acceso solo se muestra al asignar al participante. Regenerar un código perdido requiere
          soporte del backend (B2) y todavía no está disponible.
        </AlertDescription>
      </Alert>

      <DataTable
        columns={columns}
        rows={query.data ?? []}
        getRowId={(a) => String(a.assignmentId)}
        loading={query.isPending}
        error={query.isError ? query.error : null}
        onRetry={() => void query.refetch()}
        emptyState={
          <EmptyState
            title="Sin participantes asignados"
            description="Agrega participantes para generar sus accesos."
            action={
              canApply && !sessionClosed ? (
                <Button type="button" onClick={() => setAddOpen(true)}>
                  <UserPlus className="size-4" aria-hidden="true" />
                  Agregar participantes
                </Button>
              ) : undefined
            }
          />
        }
        toolbar={
          <>
            <p className="text-sm text-muted-foreground tabular-nums">
              {query.isSuccess ? `${query.data.length} asignación(es)` : ""}
            </p>
            {canApply && !sessionClosed && (
              <Button type="button" onClick={() => setAddOpen(true)}>
                <UserPlus className="size-4" aria-hidden="true" />
                Agregar participantes
              </Button>
            )}
          </>
        }
      />

      <AddParticipantsDialog
        sessionId={sessionId}
        open={addOpen}
        onOpenChange={setAddOpen}
        session={session}
        assignedParticipantIds={assignedIds}
        canReadParticipants={canReadParticipants}
        onBatchStart={() => {
          resetExported();
          setSheet([]);
          setBatching(true);
        }}
        // Cada token se publica apenas llega; la hoja se muestra al terminar el lote.
        onEntryGranted={(entry) => setSheet((prev) => [...(prev ?? []), entry])}
        onBatchEnd={() => {
          setBatching(false);
          setSheet((prev) => (prev && prev.length > 0 ? prev : null));
        }}
      />
      <AccessSheetDialog
        sessionName={session?.name ?? ""}
        scheduledStart={session?.scheduledStart}
        entries={batching ? null : sheet}
        exportedIds={exportedIds}
        onExported={markExported}
        onClose={() => {
          setSheet(null);
          resetExported();
        }}
      />
      {leaveDialog}
    </div>
  );
}
