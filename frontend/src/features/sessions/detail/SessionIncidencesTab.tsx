import { useQuery } from "@tanstack/react-query";
import { Info } from "lucide-react";

import { Alert, AlertDescription } from "../../../app/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "../../../app/components/ui/card";
import { sessionAssignmentsQuery } from "../queries";
import { IncidenceForm } from "./IncidenceForm";
import { useIncidenceLog } from "./incidenceLog";
import { formatTime } from "./format";
import { useCanApplySessions } from "./model";

export function SessionIncidencesTab({ sessionId }: { sessionId: number }) {
  const canApply = useCanApplySessions();
  const log = useIncidenceLog();
  const assignments = useQuery(sessionAssignmentsQuery(sessionId));

  const participants = (assignments.data ?? [])
    .filter((a) => a.linkStatus !== "REVOCADO")
    .map((a) => ({
      id: a.participantId,
      name: a.participantName,
      ...(a.participantCode ? { code: a.participantCode } : {}),
    }));

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <Card className="border border-border bg-card shadow-[var(--shadow-xs)]">
        <CardHeader>
          <CardTitle className="text-base font-semibold">Registrar incidencia</CardTitle>
        </CardHeader>
        <CardContent>
          {!canApply ? (
            <Alert className="border-info-border bg-info-muted text-info-foreground">
              <Info aria-hidden="true" />
              <AlertDescription className="text-info-foreground">
                Registrar incidencias requiere el permiso SESION_APLICAR.
              </AlertDescription>
            </Alert>
          ) : assignments.isError ? (
            <p role="alert" className="text-sm text-danger-foreground">
              No se pudieron cargar los participantes de la sesión.
            </p>
          ) : participants.length === 0 && !assignments.isPending ? (
            <p className="text-sm text-muted-foreground">
              La sesión aún no tiene participantes asignados.
            </p>
          ) : (
            <IncidenceForm sessionId={sessionId} participants={participants} />
          )}
        </CardContent>
      </Card>

      <Card className="border border-border bg-card shadow-[var(--shadow-xs)]">
        <CardHeader>
          <CardTitle className="text-base font-semibold">Registradas en esta visita</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert className="border-info-border bg-info-muted text-info-foreground">
            <Info aria-hidden="true" />
            <AlertDescription className="text-info-foreground">
              El historial completo estará disponible cuando el backend exponga el listado.
            </AlertDescription>
          </Alert>
          {log.entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aún no registraste incidencias en esta visita.
            </p>
          ) : (
            <ol className="space-y-3">
              {log.entries.map((entry) => (
                <li key={entry.key} className="flex gap-3 border-l-2 border-border pl-3">
                  <time
                    dateTime={entry.recordedAt}
                    className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground"
                  >
                    {formatTime(entry.recordedAt)}
                  </time>
                  <div className="min-w-0 text-sm">
                    <p className="font-medium text-foreground">{entry.participantName}</p>
                    <p className="whitespace-pre-wrap break-words text-muted-foreground">{entry.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
