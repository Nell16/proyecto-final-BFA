import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import {
  getAnalytics,
  getAttemptResult,
  getDashboardOverview,
  getDetailedResult,
  listPendingReviews,
} from "../../api/endpoints/results";
import { attemptsSource, type AttemptsQuery } from "./attempts-source";

/** Prefijo `results`: datos de staff (NO usar `runtime`, reservado al participante; conventions regla 9). */
export const resultKeys = {
  all: ["results"] as const,
  sessionOptions: () => [...resultKeys.all, "session-options"] as const,
  attempts: (query: AttemptsQuery) => [...resultKeys.all, "attempts", query] as const,
  attemptResult: (attemptId: number) => [...resultKeys.all, "attempt", attemptId, "result"] as const,
  detailedResult: (attemptId: number) => [...resultKeys.all, "attempt", attemptId, "detailed"] as const,
  pendingReviews: () => [...resultKeys.all, "manual-review", "pending"] as const,
  overview: (sessionId: number) => [...resultKeys.all, "dashboard", sessionId, "overview"] as const,
  analytics: (sessionId: number) => [...resultKeys.all, "dashboard", sessionId, "analytics"] as const,
};

/**
 * Opciones del filtro de sesión. `gcTime: 0` + `staleTime: 0`: la lista siempre es de la carga actual
 * (nunca de caché), así la sesión pedida por URL se valida contra datos frescos.
 */
export const sessionOptionsQuery = () =>
  queryOptions({
    queryKey: resultKeys.sessionOptions(),
    queryFn: () => attemptsSource.listSessionOptions(),
    gcTime: 0,
    staleTime: 0,
  });

/** Los parámetros forman parte de la key: una respuesta tardía de otra sesión jamás pisa a la vigente. */
export const attemptsQuery = (query: AttemptsQuery, options?: { keepPrevious?: boolean }) =>
  queryOptions({
    queryKey: resultKeys.attempts(query),
    queryFn: () => attemptsSource.listAttempts(query),
    ...(options?.keepPrevious ? { placeholderData: keepPreviousData } : {}),
  });

export const attemptResultQuery = (attemptId: number) =>
  queryOptions({ queryKey: resultKeys.attemptResult(attemptId), queryFn: () => getAttemptResult(attemptId) });

export const detailedResultQuery = (attemptId: number) =>
  queryOptions({ queryKey: resultKeys.detailedResult(attemptId), queryFn: () => getDetailedResult(attemptId) });

export const pendingReviewsQuery = () =>
  queryOptions({ queryKey: resultKeys.pendingReviews(), queryFn: listPendingReviews });

export const dashboardOverviewQuery = (sessionId: number) =>
  queryOptions({
    queryKey: resultKeys.overview(sessionId),
    queryFn: () => getDashboardOverview({ sessionId }),
  });

export const analyticsQuery = (sessionId: number) =>
  queryOptions({ queryKey: resultKeys.analytics(sessionId), queryFn: () => getAnalytics({ sessionId }) });
