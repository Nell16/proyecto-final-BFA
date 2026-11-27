import { queryOptions } from "@tanstack/react-query";
import { getSession, listAssignments, listPauses, listSessions } from "../../api/endpoints/sessions";
import type { Session } from "../../api/schemas/sessions";

/** Polling del monitor en vivo: ABIERTA 5 s, PAUSADA 15 s, otros estados sin polling. */
export const LIVE_POLL_MS = 5_000;
export const PAUSED_POLL_MS = 15_000;

/**
 * Intervalo de refetch por estado. TanStack ya pausa el intervalo con la pestaña en segundo
 * plano (`refetchIntervalInBackground: false`) y lo reanuda al volver: no hay chequeo manual.
 */
export const pollIntervalFor = (status: Session["status"] | undefined): number | false => {
  if (status === "ABIERTA") return LIVE_POLL_MS;
  if (status === "PAUSADA") return PAUSED_POLL_MS;
  return false;
};

export const isLive = (status: Session["status"] | undefined): boolean =>
  status === "ABIERTA" || status === "PAUSADA";

export const sessionKeys = {
  all: ["sessions"] as const,
  list: () => [...sessionKeys.all, "list"] as const,
  detail: (id: number) => [...sessionKeys.all, "detail", id] as const,
  assignments: (id: number) => [...sessionKeys.all, "detail", id, "assignments"] as const,
  pauses: (id: number) => [...sessionKeys.all, "detail", id, "pauses"] as const,
};

export const sessionListQuery = () =>
  queryOptions({ queryKey: sessionKeys.list(), queryFn: listSessions });

/**
 * Polling opt-in: solo hace refetch periódico si el llamador pasa `poll: true` (el layout del detalle lo
 * activa únicamente con la pestaña Monitor visible). Sin `poll` la query no sondea.
 */
export const sessionDetailQuery = (id: number, options?: { poll?: boolean }) =>
  queryOptions({
    queryKey: sessionKeys.detail(id),
    queryFn: () => getSession(id),
    refetchInterval: (query) => (options?.poll === true ? pollIntervalFor(query.state.data?.status) : false),
  });

/** Polling opt-in: solo si el llamador pasa `pollWhile` (estado de la sesión ya cargada), p. ej. el monitor. */
export const sessionAssignmentsQuery = (id: number, options?: { pollWhile?: Session["status"] }) =>
  queryOptions({
    queryKey: sessionKeys.assignments(id),
    queryFn: () => listAssignments(id),
    refetchInterval: () => (options?.pollWhile ? pollIntervalFor(options.pollWhile) : false),
  });

export const sessionPausesQuery = (id: number) =>
  queryOptions({ queryKey: sessionKeys.pauses(id), queryFn: () => listPauses(id) });
