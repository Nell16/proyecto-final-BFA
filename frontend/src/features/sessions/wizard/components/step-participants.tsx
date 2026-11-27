import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import type { Participant } from "../../../../api/schemas/academic";
import type { Session } from "../../../../api/schemas/sessions";
import { Button } from "../../../../app/components/ui/button";
import { Checkbox } from "../../../../app/components/ui/checkbox";
import { DataTable, type DataTableColumn } from "../../../../app/components/ui/data-table";
import { EmptyState } from "../../../../app/components/ui/empty-state";
import { Input } from "../../../../app/components/ui/input";
import { Progress } from "../../../../app/components/ui/progress";
import { captureAccountScope, isAccountChangedError } from "../../../../store/accountScope";
import { PARTICIPANT_READ_MISSING_MESSAGE } from "../../access/participantReadGate";
import { computeTtlHours, resolveExpiresAt } from "../../access/ttl";
import { isCanceledError, useAssignParticipant } from "../../mutations";
import {
  EMPTY_FILTERS,
  filterParticipants,
  hasActiveFilters,
  type ParticipantFilters,
} from "../participant-filters";
import type { AccessEntry, AssignmentFailure } from "../types";
import {
  NO_PARTICIPANT_PERMISSION_MESSAGE,
  errorMessage,
  isForbidden,
  wizardCareersQuery,
  wizardCohortsQuery,
  wizardGroupsQuery,
  wizardParticipantsQuery,
} from "../wizard-queries";
import { InlineAlert, NativeSelect } from "./form-bits";

const PAGE_SIZE = 15;

interface StepParticipantsProps {
  sessionId: number;
  /** Fechas programadas: determinan la vigencia (`ttlHours`) de los enlaces emitidos. */
  schedule: Pick<Session, "scheduledStart" | "scheduledEnd">;
  /** Requiere SESION_APLICAR. */
  canAssign: boolean;
  /** Requiere PARTICIPANTE_LEER: sin él no se consulta la lista de participantes. */
  canReadParticipants: boolean;
  /** Participantes ya asignados a la sesión (en servidor o en esta visita). */
  assignedIds: ReadonlySet<string>;
  selectedIds: ReadonlySet<string>;
  onSelectedChange: (ids: Set<string>) => void;
  failures: AssignmentFailure[];
  onFailuresChange: (failures: AssignmentFailure[]) => void;
  /**
   * Se invoca por cada asignación exitosa, apenas llega el `rawToken` (solo memoria del wizard). Se invoca
   * aunque este paso ya se haya desmontado: un POST ya enviado nunca se descarta.
   */
  onAccessGranted: (entry: AccessEntry) => void;
  /** Empieza un lote de asignación (el padre lleva la cuenta de lotes en vuelo). */
  onBatchStart: () => void;
  /** Termina el lote (siempre se invoca, incluso si el paso se desmontó con una petición en vuelo). */
  onBatchEnd: () => void;
  onBack: () => void;
  onContinue: () => void;
}

export function StepParticipants(props: StepParticipantsProps) {
  const { canAssign, canReadParticipants, onBack, onContinue } = props;
  if (canAssign && !canReadParticipants) {
    return (
      <div className="space-y-4">
        <InlineAlert tone="warning" title="No puede elegir participantes">
          {PARTICIPANT_READ_MISSING_MESSAGE} Puede terminar sin asignar.
        </InlineAlert>
        <div className="flex justify-between">
          <Button type="button" variant="outline" onClick={onBack}>
            Atrás
          </Button>
          <Button type="button" onClick={onContinue}>
            Terminar sin asignar
          </Button>
        </div>
      </div>
    );
  }
  if (!canAssign) {
    return (
      <div className="space-y-4">
        <InlineAlert tone="warning" title="No puede asignar participantes">
          Su rol no tiene el permiso SESION_APLICAR, necesario para asignar participantes y generar accesos. Puede
          terminar sin asignar y solicitar el permiso al administrador.
        </InlineAlert>
        <div className="flex justify-between">
          <Button type="button" variant="outline" onClick={onBack}>
            Atrás
          </Button>
          <Button type="button" onClick={onContinue}>
            Terminar sin asignar
          </Button>
        </div>
      </div>
    );
  }
  return <AssignmentPanel {...props} />;
}

function AssignmentPanel({
  sessionId,
  schedule,
  assignedIds,
  selectedIds,
  onSelectedChange,
  failures,
  onFailuresChange,
  onAccessGranted,
  onBatchStart,
  onBatchEnd,
  onBack,
  onContinue,
}: StepParticipantsProps) {
  const participantsQuery = useQuery(wizardParticipantsQuery());
  // Los catálogos son opcionales: si fallan (p. ej. sin permiso) solo se pierden los filtros.
  const careersQuery = useQuery(wizardCareersQuery());
  const cohortsQuery = useQuery(wizardCohortsQuery());
  const groupsQuery = useQuery(wizardGroupsQuery());
  const assign = useAssignParticipant(sessionId);

  const [filters, setFilters] = useState<ParticipantFilters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const running = progress !== null;

  const mounted = useRef(true);
  // Se aborta al desmontar: un POST pausado (sin conexión) no debe enviarse al reconectar. La señal solo
  // impide ENVIAR peticiones nuevas; una ya enviada se resuelve y su token se publica al padre.
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const participants = useMemo(() => participantsQuery.data ?? [], [participantsQuery.data]);
  const filtered = useMemo(() => filterParticipants(participants, filters), [participants, filters]);
  const selectable = useMemo(() => filtered.filter((p) => !assignedIds.has(p.id)), [filtered, assignedIds]);
  const allFilteredSelected = selectable.length > 0 && selectable.every((p) => selectedIds.has(p.id));

  const groups = useMemo(() => {
    const all = groupsQuery.data ?? [];
    return filters.careerId === "" ? all : all.filter((g) => g.careerId === undefined || String(g.careerId) === filters.careerId);
  }, [groupsQuery.data, filters.careerId]);

  const updateFilters = (patch: Partial<ParticipantFilters>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
    setPage(1);
  };

  const toggleOne = (id: string, checked: boolean) => {
    const next = new Set(selectedIds);
    if (checked) next.add(id);
    else next.delete(id);
    onSelectedChange(next);
  };

  const toggleAllFiltered = () => {
    const next = new Set(selectedIds);
    for (const p of selectable) {
      if (allFilteredSelected) next.delete(p.id);
      else next.add(p.id);
    }
    onSelectedChange(next);
  };

  // 403 (también en una recarga con datos previos): no se envían POST nuevos; los que ya van en vuelo se entregan.
  const forbidden = participantsQuery.isError && isForbidden(participantsQuery.error);
  // El bucle del lote consulta el estado VIGENTE de la query (no el de su closure): un 403 recibido DURANTE el
  // lote detiene los envíos nuevos.
  const queryClient = useQueryClient();
  const isForbiddenNow = () => {
    const state = queryClient.getQueryState(wizardParticipantsQuery().queryKey);
    return state?.status === "error" && isForbidden(state.error);
  };
  // 403 durante el lote: se aborta su señal (refuerzo; `canSend` ya lo comprueba en el punto de envío). Al detenerse,
  // el lote publica lo ya resuelto y los no enviados conservan su estado previo (siguen pendientes de reintento).
  useEffect(() => {
    if (forbidden) abortRef.current?.abort();
  }, [forbidden]);

  const byId = useMemo(() => new Map(participants.map((p) => [p.id, p])), [participants]);
  const pendingSelected = [...selectedIds].filter((id) => !assignedIds.has(id));

  const runAssignment = async (requestedIds: string[]) => {
    if (forbidden) return;
    // Quien ya figura asignado (p. ej. un fallido que luego apareció asignado) nunca se reenvía.
    const targetIds = requestedIds.filter((id) => !assignedIds.has(id));
    const targets = targetIds.map((id) => byId.get(id)).filter((p): p is Participant => p !== undefined);
    if (targets.length === 0) {
      // Los fallidos que ya figuran asignados dejan de ser fallos pendientes.
      if (failures.some((f) => assignedIds.has(f.participantId))) {
        onFailuresChange(failures.filter((f) => !assignedIds.has(f.participantId)));
      }
      return;
    }
    onBatchStart();
    setProgress({ done: 0, total: targets.length });
    const scope = captureAccountScope();
    const controller = new AbortController();
    abortRef.current = controller;
    const startedAt = new Date();
    const ttlHours = computeTtlHours(schedule, startedAt);
    const succeededIds = new Set<string>();
    const newFailures: AssignmentFailure[] = [];
    // `account`: cambió la cuenta (no se publica nada). `stopped`: salida, solo lectura o 403 (se publica lo
    // resuelto; los no enviados conservan su estado previo de selección/fallo).
    let outcome: "completed" | "stopped" | "account" = "completed";
    const canSend = () => mounted.current && !controller.signal.aborted && !isForbiddenNow();

    // Secuencial a propósito: el backend crea un token por asignación y así el progreso es fiel.
    for (const [index, participant] of targets.entries()) {
      // No se ENVÍA ningún POST más si se salió de la ruta/paso, la sesión pasó a solo lectura o hay 403. Un POST
      // ya enviado nunca se descarta: su token se publica al padre aunque este panel ya esté desmontado.
      if (!canSend()) {
        controller.abort();
        outcome = "stopped";
        break;
      }
      try {
        scope.assertCurrent();
        // `canSend` se vuelve a evaluar dentro de la mutación justo antes del envío (cubre la reanudación de una
        // mutación pausada sin conexión, sin depender de que React haya ejecutado ningún efecto).
        const result = await assign.mutateAsync({ participantId: participant.id, ttlHours, signal: controller.signal, canSend });
        if (!scope.isCurrent()) {
          outcome = "account";
          break;
        }
        succeededIds.add(participant.id);
        // Sin condicionar a `mounted`: el padre sigue montado mientras la cuenta sea la vigente.
        onAccessGranted({
          participantId: participant.id,
          participantName: participant.fullName,
          participantCode: participant.code,
          assignmentId: result.assignmentId,
          rawToken: result.rawToken,
          expiresAt: resolveExpiresAt(result.expiresAt, ttlHours, startedAt),
        });
      } catch (error) {
        if (isAccountChangedError(error) || !scope.isCurrent()) {
          outcome = "account";
          break;
        }
        if (isCanceledError(error)) {
          // No llegó a enviarse: no es un fallo del participante.
          outcome = "stopped";
          break;
        }
        // Respuesta de error de un POST enviado: es un fallo real aunque el lote se corte después.
        newFailures.push({
          participantId: participant.id,
          participantName: participant.fullName,
          message: errorMessage(error, "No se pudo asignar al participante."),
        });
      }
      if (mounted.current) setProgress({ done: index + 1, total: targets.length });
    }
    abortRef.current = null;

    // Si cambió la cuenta de staff no se publican resultados de la cuenta anterior.
    if (outcome === "account" || !scope.isCurrent()) {
      onBatchEnd();
      if (mounted.current) setProgress(null);
      return;
    }

    // Quien recibió su acceso deja de ser fallo y de estar seleccionado; quien falló ahora reemplaza su fallo previo;
    // quien no llegó a enviarse conserva su estado previo (sigue pendiente de reintento); quien ya figura asignado
    // en servidor (p. ej. desde otra pestaña) deja de ser fallo.
    const newFailedIds = new Set(newFailures.map((f) => f.participantId));
    onFailuresChange([
      ...failures.filter(
        (f) => !succeededIds.has(f.participantId) && !newFailedIds.has(f.participantId) && !assignedIds.has(f.participantId),
      ),
      ...newFailures,
    ]);
    onSelectedChange(new Set([...selectedIds].filter((id) => !succeededIds.has(id))));
    onBatchEnd();
    if (mounted.current) setProgress(null);

    const succeeded = succeededIds.size;
    if (outcome === "stopped") {
      if (mounted.current) toast.warning(`Asignación detenida: ${succeeded} asignado(s); el resto quedó pendiente.`);
    } else if (newFailures.length === 0) toast.success(`${succeeded} participante(s) asignado(s).`);
    else toast.warning(`${succeeded} asignado(s); ${newFailures.length} con error. Puede reintentar los fallidos.`);
  };

  const columns: DataTableColumn<Participant>[] = [
    {
      id: "select",
      header: <span className="sr-only">Seleccionar</span>,
      className: "w-10",
      cell: (p) => {
        const assigned = assignedIds.has(p.id);
        return (
          <Checkbox
            checked={assigned || selectedIds.has(p.id)}
            disabled={assigned || running}
            onCheckedChange={(checked) => toggleOne(p.id, checked === true)}
            aria-label={`Seleccionar ${p.fullName}`}
          />
        );
      },
    },
    {
      id: "name",
      header: "Nombre",
      cell: (p) => (
        <div className="min-w-0">
          <p className="font-medium">{p.fullName}</p>
          {assignedIds.has(p.id) && <p className="text-xs text-muted-foreground">Ya asignado a esta sesión</p>}
        </div>
      ),
    },
    { id: "code", header: "Código", cell: (p) => <span className="font-mono text-xs">{p.code}</span> },
    { id: "career", header: "Carrera", cell: (p) => p.career?.name ?? "—" },
    { id: "cohort", header: "Cohorte", cell: (p) => p.cohort?.name ?? "—" },
    { id: "group", header: "Grupo", cell: (p) => p.group?.name ?? "—" },
  ];

  const pagedRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const emptyState = hasActiveFilters(filters) ? (
    <EmptyState
      title="Sin resultados para este filtro"
      description="Pruebe con otra búsqueda o limpie los filtros."
      action={
        <Button type="button" variant="outline" onClick={() => updateFilters(EMPTY_FILTERS)}>
          Limpiar filtros
        </Button>
      }
    />
  ) : (
    <EmptyState title="Sin participantes activos" description="Registre participantes para poder asignarlos a la sesión." />
  );

  const assignedNow = assignedIds.size;
  const pct = progress ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="space-y-4">
      {forbidden ? (
        <InlineAlert tone="danger" title="Sin permiso para ver participantes">
          {NO_PARTICIPANT_PERMISSION_MESSAGE}
        </InlineAlert>
      ) : (
        <DataTable
          columns={columns}
          rows={pagedRows}
          getRowId={(p) => p.id}
          loading={participantsQuery.isPending}
          error={participantsQuery.isError ? errorMessage(participantsQuery.error, "No se pudieron cargar los participantes.") : null}
          onRetry={() => void participantsQuery.refetch()}
          emptyState={emptyState}
          density="compact"
          rowClassName={(p) => (selectedIds.has(p.id) ? "bg-accent/40" : undefined)}
          pagination={{ page, pageSize: PAGE_SIZE, total: filtered.length, onPageChange: setPage }}
          toolbar={
            <div className="flex w-full flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative w-full sm:w-64">
                  <Search
                    aria-hidden="true"
                    className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  />
                  <Input
                    value={filters.search}
                    onChange={(event) => updateFilters({ search: event.target.value })}
                    placeholder="Buscar por nombre o código"
                    aria-label="Buscar participante"
                    className="pl-8"
                    disabled={running}
                  />
                </div>
                <NativeSelect
                  aria-label="Filtrar por carrera"
                  className="w-auto min-w-40"
                  value={filters.careerId}
                  disabled={running || !careersQuery.data}
                  onChange={(event) => updateFilters({ careerId: event.target.value, groupId: "" })}
                >
                  <option value="">Todas las carreras</option>
                  {(careersQuery.data ?? []).map((c) => (
                    <option key={c.id} value={String(c.id)}>
                      {c.name}
                    </option>
                  ))}
                </NativeSelect>
                <NativeSelect
                  aria-label="Filtrar por cohorte"
                  className="w-auto min-w-40"
                  value={filters.cohortId}
                  disabled={running || !cohortsQuery.data}
                  onChange={(event) => updateFilters({ cohortId: event.target.value })}
                >
                  <option value="">Todas las cohortes</option>
                  {(cohortsQuery.data ?? []).map((c) => (
                    <option key={c.id} value={String(c.id)}>
                      {c.name}
                    </option>
                  ))}
                </NativeSelect>
                <NativeSelect
                  aria-label="Filtrar por grupo"
                  className="w-auto min-w-40"
                  value={filters.groupId}
                  disabled={running || !groupsQuery.data}
                  onChange={(event) => updateFilters({ groupId: event.target.value })}
                >
                  <option value="">Todos los grupos</option>
                  {groups.map((g) => (
                    <option key={g.id} value={String(g.id)}>
                      {g.name}
                    </option>
                  ))}
                </NativeSelect>
                {hasActiveFilters(filters) && (
                  <Button type="button" variant="ghost" size="sm" disabled={running} onClick={() => updateFilters(EMPTY_FILTERS)}>
                    Limpiar filtros
                  </Button>
                )}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-muted-foreground tabular-nums" aria-live="polite">
                  {filtered.length} participante(s) · {pendingSelected.length} seleccionado(s)
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={running || selectable.length === 0}
                    onClick={toggleAllFiltered}
                  >
                    {allFilteredSelected ? "Quitar todos los filtrados" : `Seleccionar todos los filtrados (${selectable.length})`}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={running || selectedIds.size === 0}
                    onClick={() => onSelectedChange(new Set())}
                  >
                    Limpiar selección
                  </Button>
                </div>
              </div>
            </div>
          }
        />
      )}

      {progress && (
        <div className="space-y-2 rounded-lg border border-border bg-card p-4">
          <p role="status" className="flex items-center gap-2 text-sm font-medium">
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            Asignando {Math.min(progress.done + 1, progress.total)} de {progress.total}…
          </p>
          <Progress value={pct} aria-label="Progreso de asignación" />
        </div>
      )}

      {failures.length > 0 && !running && (
        <InlineAlert
          tone="danger"
          title={`${failures.length} asignación(es) fallida(s)`}
          action={
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={forbidden}
              onClick={() => void runAssignment(failures.map((f) => f.participantId))}
            >
              Reintentar fallidos ({failures.length})
            </Button>
          }
        >
          <ul className="list-disc space-y-0.5 pl-4">
            {failures.map((f) => (
              <li key={f.participantId}>
                <span className="font-medium">{f.participantName}</span>: {f.message}
              </li>
            ))}
          </ul>
        </InlineAlert>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="outline" onClick={onBack} disabled={running}>
          Atrás
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            disabled={running || forbidden || pendingSelected.length === 0}
            onClick={() => void runAssignment(pendingSelected)}
          >
            Asignar {pendingSelected.length} seleccionado(s)
          </Button>
          <Button type="button" variant={assignedNow > 0 ? "default" : "outline"} onClick={onContinue} disabled={running}>
            {assignedNow > 0 ? "Continuar a revisión" : "Continuar sin asignar"}
          </Button>
        </div>
      </div>
    </div>
  );
}
