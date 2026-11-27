import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { ApiError } from "../../../api/errors";
import type { Participant } from "../../../api/schemas/academic";
import type { Session } from "../../../api/schemas/sessions";
import { Button } from "../../../app/components/ui/button";
import { Checkbox } from "../../../app/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../app/components/ui/dialog";
import { Input } from "../../../app/components/ui/input";
import { Skeleton } from "../../../app/components/ui/skeleton";
import { captureAccountScope, isAccountChangedError } from "../../../store/accountScope";
import { PARTICIPANT_READ_MISSING_MESSAGE } from "../access/participantReadGate";
import { computeTtlHours, resolveExpiresAt } from "../access/ttl";
import { isCanceledError, useAssignParticipant } from "../mutations";
import { wizardParticipantsQuery } from "../wizard/wizard-queries";
import type { AccessEntry } from "./accessSheet";
import { errorMessage } from "./model";

const CANDIDATES_PAGE_SIZE = 8;

interface AddParticipantsDialogProps {
  sessionId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Para calcular la vigencia de los enlaces (fin programado + margen). */
  session: Pick<Session, "scheduledStart" | "scheduledEnd"> | undefined;
  /** IDs de participantes con CUALQUIER asignación en la sesión (incluidas las revocadas). */
  assignedParticipantIds: ReadonlySet<string>;
  /** PARTICIPANTE_LEER: sin él no se muestra el selector. */
  canReadParticipants: boolean;
  /** Se invoca al empezar un lote, ANTES de la primera petición (activa el bloqueo de salida). */
  onBatchStart?: () => void;
  /** Se invoca por cada token recibido, apenas llega (no al final del lote). */
  onEntryGranted?: (entry: AccessEntry) => void;
  /** Se invoca al terminar el lote (también si falló o se abortó) mientras el diálogo siga montado. */
  onBatchEnd?: () => void;
  /** Al terminar un lote con al menos una asignación exitosa (con todas las entradas). */
  onAssigned?: (entries: AccessEntry[]) => void;
}

export function AddParticipantsDialog({
  sessionId,
  open,
  onOpenChange,
  session,
  assignedParticipantIds,
  canReadParticipants,
  onBatchStart,
  onEntryGranted,
  onBatchEnd,
  onAssigned,
}: AddParticipantsDialogProps) {
  const assign = useAssignParticipant(sessionId);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<ReadonlyMap<string, Participant>>(new Map());
  const [submitting, setSubmitting] = useState(false);
  // Al desmontar (salir de la ruta) el lote se aborta: no se ENVÍAN más POST. Un POST ya enviado nunca se
  // descarta: su token se entrega al padre (`onEntryGranted`) aunque el diálogo se haya cerrado o desmontado.
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  // El backend solo pagina (B10): se traen todas las páginas y se busca/pagina en cliente.
  const query = useQuery({ ...wizardParticipantsQuery(), enabled: open && canReadParticipants, retry: false });

  const forbidden = query.error instanceof ApiError && query.error.status === 403;
  // El bucle del lote consulta el estado VIGENTE de la query: un 403 recibido DURANTE el lote detiene los envíos nuevos.
  const queryClient = useQueryClient();
  const isForbiddenNow = () => {
    const state = queryClient.getQueryState(wizardParticipantsQuery().queryKey);
    return state?.status === "error" && state.error instanceof ApiError && state.error.status === 403;
  };
  // 403 durante el lote: se aborta su señal. `useAssignParticipant` la comprueba justo antes de ENVIAR, lo que
  // cubre también una mutación pausada (sin conexión) que se reanude después del 403.
  useEffect(() => {
    if (forbidden) abortRef.current?.abort();
  }, [forbidden]);
  // Solo cuentan los seleccionados que todavía no figuran asignados (la lista puede refrescarse).
  const eligibleCount = [...selected.keys()].filter((id) => !assignedParticipantIds.has(id)).length;

  const candidates = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (query.data ?? []).filter(
      (p) =>
        p.status !== "INACTIVO" &&
        !assignedParticipantIds.has(p.id) &&
        (needle === "" || p.fullName.toLowerCase().includes(needle) || p.code.toLowerCase().includes(needle)),
    );
  }, [query.data, search, assignedParticipantIds]);

  const totalPages = Math.max(1, Math.ceil(candidates.length / CANDIDATES_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = candidates.slice((currentPage - 1) * CANDIDATES_PAGE_SIZE, currentPage * CANDIDATES_PAGE_SIZE);

  const reset = () => {
    setSearch("");
    setPage(1);
    setSelected(new Map());
  };

  const toggle = (participant: Participant, checked: boolean) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (checked) next.set(participant.id, participant);
      else next.delete(participant.id);
      return next;
    });
  };

  const handleOpenChange = (next: boolean) => {
    if (submitting) return;
    if (!next) reset();
    onOpenChange(next);
  };

  const submit = async () => {
    // Sin permiso de lectura de participantes (403) no se envía ningún POST nuevo; y quien ya figura asignado
    // (p. ej. porque la lista se refrescó durante un lote anterior) nunca se reenvía.
    if (forbidden) return;
    const batch = [...selected.values()].filter((p) => !assignedParticipantIds.has(p.id));
    if (batch.length === 0) return;
    setSubmitting(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const scope = captureAccountScope();
    onBatchStart?.();
    const startedAt = new Date();
    const ttlHours = session ? computeTtlHours(session, startedAt) : undefined;
    const entries: AccessEntry[] = [];
    const failures: string[] = [];
    let aborted = false;
    let stopped = false;
    const canSend = () => mountedRef.current && !controller.signal.aborted && !isForbiddenNow();
    for (const participant of batch) {
      // Desmontaje, aborto o 403: no se envían más POST; los tokens recibidos ya se entregaron.
      if (!canSend()) {
        controller.abort();
        stopped = true;
        break;
      }
      try {
        scope.assertCurrent();
        // `canSend` se reevalúa dentro de la mutación justo antes del envío (cubre la reanudación de una mutación
        // pausada sin conexión sin depender de ningún efecto de React).
        const result = await assign.mutateAsync({ participantId: participant.id, ttlHours, signal: controller.signal, canSend });
        if (!scope.isCurrent()) {
          aborted = true;
          break;
        }
        const entry: AccessEntry = {
          assignmentId: result.assignmentId,
          participantName: participant.fullName,
          participantCode: participant.code,
          rawToken: result.rawToken,
          expiresAt: resolveExpiresAt(result.expiresAt, ttlHours ?? 8, startedAt),
        };
        entries.push(entry);
        // El token se publica de inmediato: el bloqueo de salida y la hoja lo conocen desde ya.
        onEntryGranted?.(entry);
      } catch (error) {
        if (isAccountChangedError(error)) {
          aborted = true;
          break;
        }
        if (isCanceledError(error)) {
          // No llegó a enviarse: no es un fallo del participante.
          stopped = true;
          break;
        }
        // Respuesta de error de un POST enviado: es un fallo real aunque el lote se corte después.
        failures.push(`${participant.fullName}: ${errorMessage(error, "No se pudo asignar.")}`);
      }
    }
    abortRef.current = null;
    // Si se desmontó (ruta abandonada) no hay estado propio que actualizar, pero el padre debe saber que el
    // lote terminó (levanta el bloqueo de salida y muestra la hoja con los tokens ya entregados).
    if (!mountedRef.current) {
      onBatchEnd?.();
      return;
    }
    setSubmitting(false);
    onBatchEnd?.();

    // Si cambió la cuenta de staff no se publican resultados (ni hoja ni avisos) de la cuenta anterior.
    if (aborted || !scope.isCurrent()) return;

    if (stopped) {
      toast.warning(
        isForbiddenNow()
          ? "La asignación se detuvo: ya no tiene permiso para ver participantes."
          : "La asignación se detuvo; los participantes no enviados siguen sin asignar.",
      );
    }
    if (failures.length > 0) {
      toast.error(`No se pudo asignar a ${failures.length} participante(s).`, {
        description: failures.join(" · "),
        duration: 8000,
      });
    }
    if (entries.length > 0) {
      reset();
      onOpenChange(false);
      onAssigned?.(entries);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Agregar participantes</DialogTitle>
          <DialogDescription>
            Selecciona uno o varios participantes. Al asignar se genera su código de acceso.
          </DialogDescription>
        </DialogHeader>

        {!canReadParticipants ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-warning-border bg-warning-muted p-3 text-sm text-warning-foreground"
          >
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <p>{PARTICIPANT_READ_MISSING_MESSAGE}</p>
          </div>
        ) : forbidden ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-warning-border bg-warning-muted p-3 text-sm text-warning-foreground"
          >
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <p>
              No tienes permiso para consultar participantes (PARTICIPANTE_LEER), por lo que no se puede armar
              la lista desde aquí.
            </p>
          </div>
        ) : query.isError ? (
          <div role="alert" className="space-y-2 rounded-lg border border-danger-border bg-danger-muted/60 p-3 text-sm">
            <p className="text-danger-foreground">{errorMessage(query.error, "No se pudo cargar la lista de participantes.")}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()}>
              Reintentar
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="relative">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                type="search"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder="Buscar por nombre o código"
                aria-label="Buscar participantes"
                className="pl-8"
              />
            </div>
            <ul
              aria-label="Participantes disponibles"
              className="max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border"
            >
              {query.isPending ? (
                Array.from({ length: 4 }, (_, i) => (
                  <li key={i} className="p-3">
                    <Skeleton className="h-4 w-2/3" />
                  </li>
                ))
              ) : candidates.length === 0 ? (
                <li className="p-4 text-center text-sm text-muted-foreground">
                  No hay participantes disponibles para este criterio.
                </li>
              ) : (
                pageRows.map((participant) => {
                  const id = `candidate-${participant.id}`;
                  return (
                    <li key={participant.id} className="flex items-center gap-3 p-3">
                      <Checkbox
                        id={id}
                        checked={selected.has(participant.id)}
                        onCheckedChange={(checked) => toggle(participant, checked === true)}
                      />
                      <label htmlFor={id} className="flex min-w-0 flex-1 cursor-pointer flex-col text-sm">
                        <span className="font-medium text-foreground">{participant.fullName}</span>
                        <span className="font-mono text-xs text-muted-foreground">{participant.code}</span>
                      </label>
                    </li>
                  );
                })
              )}
            </ul>
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span className="tabular-nums" aria-live="polite">
                {candidates.length} disponible(s) · página {currentPage} de {totalPages}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={currentPage <= 1 || submitting}
                  onClick={() => setPage(currentPage - 1)}
                >
                  Anterior
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={currentPage >= totalPages || submitting}
                  onClick={() => setPage(currentPage + 1)}
                >
                  Siguiente
                </Button>
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="items-center sm:justify-between">
          <p className="text-sm text-muted-foreground tabular-nums" aria-live="polite">
            {eligibleCount} seleccionado(s)
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={submitting}>
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={() => void submit()}
              disabled={!canReadParticipants || forbidden || eligibleCount === 0 || submitting}
            >
              {submitting ? "Asignando…" : "Asignar y generar accesos"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
