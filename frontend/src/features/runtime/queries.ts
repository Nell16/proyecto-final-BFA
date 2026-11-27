import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { getSubtestItems } from "../../api/endpoints/runtime";
import { RUNTIME_QUERY_KEY_PREFIX } from "../../api/queryClient";
import type { Evaluation } from "../../api/schemas/runtime";
import { evaluationGuard, fetchEvaluationWithTicket, isTicketCurrent } from "./evaluation-guard";

export const EVALUATION_STALE_TIME_MS = 10_000;
export const SUBTEST_ITEMS_STALE_TIME_MS = 5 * 60_000;
export const RUNTIME_IMAGE_STALE_TIME_MS = 5 * 60_000;

export const runtimeKeys = {
  all: [RUNTIME_QUERY_KEY_PREFIX] as const,
  evaluation: (assignmentId: number) =>
    [RUNTIME_QUERY_KEY_PREFIX, "evaluation", assignmentId] as const,
  subtestItems: (assignmentId: number, attemptId: number, subtestId: number) =>
    [RUNTIME_QUERY_KEY_PREFIX, "subtestItems", assignmentId, attemptId, subtestId] as const,
  image: (assignmentId: number, normalizedUrl: string) =>
    [RUNTIME_QUERY_KEY_PREFIX, "image", assignmentId, normalizedUrl] as const,
};

/**
 * El fetcher por defecto SIEMPRE asigna el ticket de vigencia al INICIAR la solicitud (F2-FIX-4/5): no existe una
 * variante sin ticket. El parámetro `fetcher` solo existe para tests.
 */
export function evaluationQueryOptions(
  assignmentId: number,
  fetcher: () => Promise<Evaluation> = fetchEvaluationWithTicket,
) {
  return queryOptions({
    queryKey: runtimeKeys.evaluation(assignmentId),
    queryFn: fetcher,
    // Cada respuesta conserva su identidad de objeto: el ticket de vigencia se asocia por identidad.
    structuralSharing: false,
    staleTime: EVALUATION_STALE_TIME_MS,
  });
}

/**
 * /yo VIGENTE para los loaders de /evaluacion (F2-FIX-6/8). Un loader nunca decide (redirige) con un /yo cuyo ticket
 * quedó invalidado.
 *
 * El loader NO comparte la promesa de la query (F2-FIX-8): si el runner ya está consultando la misma clave (sondeo),
 * `fetchQuery`/`ensureQueryData` reutilizan esa promesa en vuelo con los reintentos globales (hasta 3 solicitudes) y
 * `retry: false` no aplica. Por eso, sin un dato vigente en la caché, el loader hace UN intento PROPIO con
 * `fetchEvaluationWithTicket` (que no pasa por TanStack Query) y publica el resultado vigente en la caché. Espera como
 * máximo UNA solicitud propia, haya o no un sondeo en vuelo; el sondeo del runner sigue igual.
 *
 * Devuelve `null` si no puede confirmar (la solicitud falla, o su respuesta ya quedó invalidada): el loader entonces NO
 * redirige y deja montar la ruta; las guardas reactivas del runner corrigen después con el /yo vigente.
 */
export async function ensureCurrentEvaluation(
  queryClient: QueryClient,
  assignmentId: number,
): Promise<Evaluation | null> {
  const key = runtimeKeys.evaluation(assignmentId);
  const cached = queryClient.getQueryData<Evaluation>(key);
  if (cached !== undefined && isTicketCurrent(cached)) return cached;

  // Sin dato vigente: un intento propio. Si el dato de la caché no existe y la respuesta llega ya invalidada
  // (se ocultó la pestaña con la solicitud en vuelo), se repite UNA vez; con la caché ya poblada, un solo intento.
  const maxAttempts = cached === undefined ? 2 : 1;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let fresh: Evaluation;
    try {
      fresh = await fetchEvaluationWithTicket();
    } catch {
      return null;
    }
    if (!isTicketCurrent(fresh)) continue;
    return publishEvaluationIfNewest(queryClient, assignmentId, fresh);
  }
  return null;
}

/**
 * Publica en la caché un /yo vigente del loader sin pisar uno más nuevo (F2-FIX-8). El orden es el de INICIO de la
 * solicitud: si la caché ya tiene un /yo vigente de una solicitud iniciada DESPUÉS, ese es el que vale y se devuelve.
 * Si hubo uno más nuevo ya aplicado, el ticket de este resultado ya no es vigente (la guarda lo detecta antes).
 */
function publishEvaluationIfNewest(queryClient: QueryClient, assignmentId: number, fresh: Evaluation): Evaluation {
  const key = runtimeKeys.evaluation(assignmentId);
  const existing = queryClient.getQueryData<Evaluation>(key);
  const existingTicket = evaluationGuard.ticketOf(existing);
  const freshTicket = evaluationGuard.ticketOf(fresh);
  if (
    existing !== undefined &&
    existingTicket !== undefined &&
    freshTicket !== undefined &&
    existingTicket.seq > freshTicket.seq &&
    evaluationGuard.isCurrent(existingTicket)
  ) {
    return existing;
  }
  // `build` fija las opciones de la query (structuralSharing: false) si aún no existe: el objeto publicado conserva su
  // identidad y, con ella, su ticket.
  queryClient.getQueryCache().build(queryClient, { queryKey: key, structuralSharing: false });
  queryClient.setQueryData<Evaluation>(key, fresh);
  return fresh;
}

export function subtestItemsQueryOptions(
  assignmentId: number,
  attemptId: number,
  subtestId: number,
) {
  return queryOptions({
    queryKey: runtimeKeys.subtestItems(assignmentId, attemptId, subtestId),
    queryFn: () => getSubtestItems(attemptId, subtestId),
    staleTime: SUBTEST_ITEMS_STALE_TIME_MS,
  });
}
