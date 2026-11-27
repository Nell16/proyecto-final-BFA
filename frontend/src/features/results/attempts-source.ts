import { ApiError } from "../../api/errors";
import { getAttemptResult } from "../../api/endpoints/results";
import { getSession, listAssignments, listSessions } from "../../api/endpoints/sessions";
import type { AttemptStatus } from "../../api/schemas/results";
import type { Assignment, Session } from "../../api/schemas/sessions";
import { captureAccountScope, type AccountScope } from "../../store/accountScope";
import { PERMISSIONS } from "../../store/permissions";
import { useStaffAuth } from "../../store/staffAuth";
import { toAttemptStatus } from "../sessions/detail/model";

/**
 * FUENTE DE INTENTOS (adaptador).
 *
 * Las pantallas de resultados, calificación y revisión consumen SOLO esta interfaz (`AttemptsSource`).
 * Hoy la implementación es un PUENTE sobre `/sesiones` + `/sesiones/{id}/asignaciones` (exige `SESION_LEER`,
 * que el Consultor no tiene). Cuando exista B14 (`GET /attempts`, ver
 * `psycho-form/docs/backend-permisos-claves-intentos-prompt.md`) se cambia así, sin tocar ninguna pantalla:
 *
 *  1. `src/api/schemas/results.ts`: agregar `AttemptSummaryWireSchema` (el `AttemptSummaryDto` del prompt:
 *     attemptId, status, startedAt, finishedAt, totalTimeSeconds, participant{id,code,fullName},
 *     session{id,code,name}, version{id,testName,number}, scored, resultId, pendingManualReviews) y
 *     `AttemptSummaryPageSchema` (PageResponse) con `serverDateTime` en las fechas.
 *  2. `src/api/endpoints/results.ts`: agregar `listAttempts(params)` → `GET /attempts?status&scored&sessionId&
 *     versionTestId&participantCode&from&to&page&size&sort`.
 *  3. En ESTE archivo: escribir `apiAttemptsSource` (listAttempts = el endpoint nuevo; `listSessionOptions` =
 *     sesiones distintas derivadas de los intentos, sin exigir `SESION_LEER`; `requiredPermissions` =
 *     `[RESULTADO_VER, CALIFICACION_EJECUTAR]`) y exportarlo como `attemptsSource` en lugar del puente.
 *  4. Borrar `bridgeAttemptsSource` y sus tests (`attempts-source.test.ts`). `AttemptSummary`, `AttemptsQuery`
 *     y `AttemptsPage` no cambian: ya son la forma del DTO futuro.
 */

/** Resumen de un intento (forma del futuro `AttemptSummaryDto`). Los `null` son «dato no disponible». */
export interface AttemptSummary {
  attemptId: number;
  status: AttemptStatus;
  startedAt: string | null;
  finishedAt: string | null;
  totalTimeSeconds: number | null;
  participant: { id: string; code: string | null; fullName: string };
  session: { id: number; code: string; name: string };
  version: { id: number; testName: string | null; number: string | null };
  /** `null`: se desconoce (el puente no puede consultarlo sin `RESULTADO_VER` o la consulta falló). */
  scored: boolean | null;
  resultId: number | null;
  /** `null`: se desconoce (el puente no lo conoce; B14 lo trae en el DTO). */
  pendingManualReviews: number | null;
}

export interface AttemptsQuery {
  sessionId?: number;
  status?: AttemptStatus;
  scored?: boolean;
  participantCode?: string;
  /** Base 1. */
  page?: number;
  size?: number;
  /**
   * Deep link: si se indica (y NO se pide `page`), la fuente localiza este intento entre TODOS los resultados
   * (ya filtrados, antes de cortar la página) y devuelve la página que lo contiene. Si no está, devuelve la 1.
   */
  locateAttemptId?: number;
}

export interface AttemptsPage {
  items: AttemptSummary[];
  total: number;
  /** Página realmente devuelta (con `locateAttemptId` puede diferir de la pedida). */
  page: number;
  size: number;
  /** Solo con `locateAttemptId`: `true` si el intento se encontró entre todos los resultados. */
  located?: boolean;
}

export interface AttemptSessionOption {
  id: number;
  code: string;
  name: string;
}

export interface AttemptsSource {
  /** Permisos de los que basta UNO para usar la fuente (mismo criterio que `hasAnyPermission`). */
  readonly requiredPermissions: readonly string[];
  isAvailable(permissions: readonly string[]): boolean;
  /** Sesiones para el filtro, de la más reciente a la más antigua. Siempre una lectura fresca. */
  listSessionOptions(): Promise<AttemptSessionOption[]>;
  listAttempts(query: AttemptsQuery): Promise<AttemptsPage>;
}

export const DEFAULT_ATTEMPTS_PAGE_SIZE = 20;
export const MAX_ATTEMPTS_PAGE_SIZE = 100;

const PROBE_CONCURRENCY = 6;

/** Ejecuta `worker` sobre `items` con a lo sumo `limit` tareas en vuelo; conserva el orden. */
async function mapWithLimit<T, R>(items: readonly T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
}

const byRecency = (a: Session, b: Session): number => b.scheduledStart.localeCompare(a.scheduledStart);

interface Candidate {
  session: Session;
  assignment: Assignment;
  attemptId: number;
}

type ScoreProbe = { scored: boolean | null; resultId: number | null };

/**
 * Pregunta si un intento COMPLETADO ya tiene resultado. 404/400 = «sin resultado» (el backend responde
 * EntityNotFound). Cualquier otro fallo, o no tener `RESULTADO_VER`, deja el dato en «desconocido».
 */
async function probeScore(attemptId: number, scope: AccountScope): Promise<ScoreProbe> {
  // Cada sondeo es una petición nueva: si la cuenta cambió, saldría con el JWT de la cuenta nueva.
  scope.assertCurrent();
  if (!useStaffAuth.getState().hasPermission(PERMISSIONS.RESULTADO_VER)) return { scored: null, resultId: null };
  try {
    const result = await getAttemptResult(attemptId);
    return { scored: true, resultId: result.resultId };
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 400)) {
      return { scored: false, resultId: null };
    }
    return { scored: null, resultId: null };
  }
}

function toSummary(candidate: Candidate, probe: ScoreProbe): AttemptSummary {
  const { session, assignment, attemptId } = candidate;
  return {
    attemptId,
    status: toAttemptStatus(assignment.attemptState),
    startedAt: null,
    finishedAt: null,
    totalTimeSeconds: null,
    participant: {
      id: assignment.participantId,
      code: assignment.participantCode ?? null,
      fullName: assignment.participantName,
    },
    session: { id: session.id, code: session.code, name: session.name },
    version: { id: session.versionTestId, testName: null, number: null },
    scored: probe.scored,
    resultId: probe.resultId,
    pendingManualReviews: null,
  };
}

async function collectCandidates(sessionId: number | undefined, scope: AccountScope): Promise<Candidate[]> {
  let sessions: Session[];
  if (sessionId !== undefined) {
    try {
      sessions = [await getSession(sessionId)];
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return [];
      throw error;
    }
  } else {
    sessions = (await listSessions()).sort(byRecency);
  }
  const perSession = await Promise.all(
    sessions.map(async (session) => {
      scope.assertCurrent();
      const assignments = await listAssignments(session.id);
      return assignments.flatMap((assignment): Candidate[] =>
        assignment.attemptId === null ? [] : [{ session, assignment, attemptId: assignment.attemptId }],
      );
    }),
  );
  scope.assertCurrent();
  return perSession.flat();
}

/**
 * Implementación puente (provisional hasta B14). Limitaciones respecto del DTO futuro: no conoce
 * `startedAt/finishedAt/totalTimeSeconds`, `version.testName/number` ni `pendingManualReviews`, y `scored`
 * se obtiene sondeando `GET /attempts/{id}/result` (solo de los intentos de la página devuelta, salvo que se
 * filtre por `scored`, que obliga a sondear todos los COMPLETADO).
 */
const BRIDGE_PERMISSIONS: readonly string[] = [PERMISSIONS.SESION_APLICAR, PERMISSIONS.SESION_CREAR];

export const bridgeAttemptsSource: AttemptsSource = {
  requiredPermissions: BRIDGE_PERMISSIONS,

  isAvailable(permissions) {
    return BRIDGE_PERMISSIONS.some((permission) => permissions.includes(permission));
  },

  async listSessionOptions() {
    const sessions = (await listSessions()).sort(byRecency);
    return sessions.map((session) => ({ id: session.id, code: session.code, name: session.name }));
  },

  async listAttempts(query) {
    const size = Math.min(Math.max(1, query.size ?? DEFAULT_ATTEMPTS_PAGE_SIZE), MAX_ATTEMPTS_PAGE_SIZE);
    // Lectura de varios pasos (sesiones → asignaciones → sondeos): un único scope, comprobado antes de cada envío.
    const scope = captureAccountScope();

    const code = query.participantCode?.trim().toLowerCase() ?? "";
    let candidates = (await collectCandidates(query.sessionId, scope)).filter(
      (c) =>
        (query.status === undefined || toAttemptStatus(c.assignment.attemptState) === query.status) &&
        (code === "" ||
          (c.assignment.participantCode ?? "").toLowerCase().includes(code) ||
          c.assignment.participantName.toLowerCase().includes(code)),
    );

    const needsScore = (c: Candidate) => toAttemptStatus(c.assignment.attemptState) === "COMPLETADO";
    const probeOf = async (c: Candidate): Promise<ScoreProbe> =>
      needsScore(c) ? probeScore(c.attemptId, scope) : { scored: false, resultId: null };

    // Con filtro `scored` hay que conocer el estado de todos antes de paginar.
    const probes = new Map<number, ScoreProbe>();
    if (query.scored !== undefined) {
      const all = await mapWithLimit(candidates, PROBE_CONCURRENCY, probeOf);
      candidates.forEach((c, index) => probes.set(c.attemptId, all[index]));
      candidates = candidates.filter((c) => {
        const scored = probes.get(c.attemptId)?.scored;
        return query.scored ? scored === true : scored !== true;
      });
    }

    const total = candidates.length;

    // Deep link: se localiza el intento ANTES de cortar la página, entre todas las asignaciones ya filtradas.
    let page = Math.max(1, query.page ?? 1);
    let located: boolean | undefined;
    if (query.locateAttemptId !== undefined && query.page === undefined) {
      const index = candidates.findIndex((c) => c.attemptId === query.locateAttemptId);
      located = index >= 0;
      if (index >= 0) page = Math.floor(index / size) + 1;
    }

    const slice = candidates.slice((page - 1) * size, page * size);
    const missing = slice.filter((c) => !probes.has(c.attemptId));
    const probed = await mapWithLimit(missing, PROBE_CONCURRENCY, probeOf);
    missing.forEach((c, index) => probes.set(c.attemptId, probed[index]));

    scope.assertCurrent();
    return {
      items: slice.map((c) => toSummary(c, probes.get(c.attemptId) ?? { scored: null, resultId: null })),
      total,
      page,
      size,
      ...(located === undefined ? {} : { located }),
    };
  },
};

/** Fuente vigente. Cambiar aquí (y solo aquí) cuando exista `GET /attempts` (B14). */
export const attemptsSource: AttemptsSource = bridgeAttemptsSource;
