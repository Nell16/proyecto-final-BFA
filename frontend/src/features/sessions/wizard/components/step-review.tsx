import type { Session } from "../../../../api/schemas/sessions";
import { Button } from "../../../../app/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../../../app/components/ui/card";
import { StatusBadge } from "../../../../app/components/ui/status-badge";
import { formatDateTime, formatTimeLimit } from "../format";
import { parseTimeLimit, type SubtestRow } from "../subtest-rows";
import type { AccessEntry, AssignmentFailure, InstrumentInfo } from "../types";
import { AccessSheet } from "./access-sheet";
import { InlineAlert } from "./form-bits";

interface StepReviewProps {
  session: Session;
  instrument: InstrumentInfo | null;
  /** Filas configuradas en esta visita (null si se reanudó el wizard y no se tocaron). */
  subtestRows: SubtestRow[] | null;
  /** Asignaciones que ya existen en el servidor. */
  assignedCount: number;
  entries: readonly AccessEntry[];
  failures: readonly AssignmentFailure[];
  canOpen: boolean;
  opening: boolean;
  exportedIds: ReadonlySet<number>;
  onExported: (assignmentIds: number[]) => void;
  onBack: () => void;
  onGoMonitor: () => void;
  onOpenNow: () => void;
}

export function StepReview({
  session,
  instrument,
  subtestRows,
  assignedCount,
  entries,
  failures,
  canOpen,
  opening,
  exportedIds,
  onExported,
  onBack,
  onGoMonitor,
  onOpenNow,
}: StepReviewProps) {
  const selectedSubtests = subtestRows?.filter((row) => row.selected) ?? null;
  const previousWithoutLink = Math.max(assignedCount - entries.length, 0);

  const rows: Array<[string, React.ReactNode]> = [
    ["Nombre", session.name],
    ["Código", <span key="code" className="font-mono">{session.code}</span>],
    ["Estado", <StatusBadge key="status" domain="session" status={session.status} />],
    ["Inicio programado", formatDateTime(session.scheduledStart)],
    ["Fin programado", formatDateTime(session.scheduledEnd)],
    ["Ubicación", session.location ?? "—"],
    [
      "Instrumento",
      instrument ? `${instrument.testName} · versión ${instrument.versionNumber}` : `Versión #${session.versionTestId}`,
    ],
    ["Participantes asignados", String(assignedCount)],
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Resumen de la sesión</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            {rows.map(([label, value]) => (
              <div key={label} className="space-y-0.5">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="text-foreground">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="space-y-1.5">
            <h3 className="text-sm font-semibold">Subtests</h3>
            {selectedSubtests ? (
              <ol className="list-decimal space-y-0.5 pl-5 text-sm" aria-label="Subtests seleccionados">
                {selectedSubtests.map((row) => {
                  const seconds = parseTimeLimit(row.timeLimitMinutes);
                  return (
                    <li key={row.subtestId}>
                      {row.name}{" "}
                      <span className="text-xs text-muted-foreground">
                        · {formatTimeLimit(typeof seconds === "number" ? seconds : null)}
                      </span>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="text-sm text-muted-foreground">
                Se conserva la configuración guardada en el servidor para esta sesión.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {failures.length > 0 && (
        <InlineAlert tone="warning" title={`${failures.length} participante(s) sin asignar`}>
          {failures.map((f) => f.participantName).join(", ")}. Vuelva al paso Participantes para reintentar.
        </InlineAlert>
      )}

      {assignedCount === 0 && (
        <InlineAlert tone="warning" title="Aún no hay participantes asignados">
          Puede abrir la sesión, pero nadie podrá ingresar hasta que asigne participantes desde el detalle de la sesión.
        </InlineAlert>
      )}

      {previousWithoutLink > 0 && (
        <InlineAlert tone="info">
          {previousWithoutLink} asignación(es) previa(s) no muestran enlace: los códigos solo se ven al generarse y por
          ahora no se pueden volver a mostrar ni regenerar.
        </InlineAlert>
      )}

      {entries.length > 0 && (
        <AccessSheet
          session={session}
          entries={entries}
          exportedIds={exportedIds}
          onExported={onExported}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="outline" onClick={onBack} disabled={opening}>
          Atrás
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={onGoMonitor} disabled={opening}>
            Ir al monitor
          </Button>
          {canOpen && (
            <Button type="button" onClick={onOpenNow} disabled={opening}>
              {opening ? "Abriendo…" : "Abrir sesión ahora"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
