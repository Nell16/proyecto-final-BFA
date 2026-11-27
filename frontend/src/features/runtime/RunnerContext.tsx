import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import {
  finishAttempt,
  finishSubtest,
  isRuntimeBlocked,
  startAttempt,
  startSubtest,
} from "../../api/endpoints/runtime";
import { ApiError, safeErrorLog } from "../../api/errors";
import type {
  AttemptStatus,
  Evaluation,
  RuntimeErrorCode,
  RuntimeItem,
  RuntimeSubtest,
  SubtestAttempt,
} from "../../api/schemas/runtime";
import { RUNTIME_ERROR_CODES } from "../../api/schemas/runtime";
import { isDelivered, markDelivered } from "../../store/deliveredMarker";
import { useParticipantAuth } from "../../store/participantAuth";
import { fromSavedAnswer, type AnswerValue } from "./answer-value";
import { computeBackoffMs } from "./draft/backoff";
import {
  bindDraftOwner,
  clearRuntimeDraft,
  flushAllBeforeFinish,
  flushBeforeFinish,
  isStaleParticipantError,
  markSubtestPendingUnconfirmed,
  resumeSync,
  setAnswer,
  useRuntimeDraft,
  useSyncStatus,
  type FlushResult,
  type RejectedAnswerEntry,
  type UnconfirmedAnswerEntry,
} from "./draft";
import {
  INITIAL_STATE,
  buildTiming,
  clampOrdinal,
  deadline,
  findSubtest,
  isResumable,
  isSubtestDone,
  isSubtestOpenable,
  isTerminal,
  isValidOrdinal,
  remainingMs,
  runnerReducer,
  startSubtestOkEvent,
  timingRemainingMs,
  type FinishReason,
  type RunnerEvent,
  type RunnerState,
} from "./machine";
import { ensureVisibilityListener, evaluationGuard, inheritEvaluationTicket, isTicketCurrent } from "./evaluation-guard";
import { evaluationQueryOptions, runtimeKeys, subtestItemsQueryOptions } from "./queries";

const DEFAULT_POLLING_INTERVAL_MS = 10_000;

/** Evento SERVER_ERROR; con ASIGNACION_NO_OPERABLE o SESION_FINALIZADA añade si hay marcador de entrega de la asignación vigente. */
function serverErrorEvent(code: RuntimeErrorCode): RunnerEvent {
  const delivered =
    (code === "ASIGNACION_NO_OPERABLE" || code === "SESION_FINALIZADA") &&
    isDelivered(useParticipantAuth.getState().assignmentId);
  return { type: "SERVER_ERROR", code, clientNow: monoNow(), ...(delivered ? { delivered: true } : {}) };
}
/** Retraso SOLO del envío por red del texto abierto; el draft local se actualiza en cada tecla. */
const TEXT_SEND_DEBOUNCE_MS = 300;

/**
 * Reloj MONOTÓNICO del cliente (ms). Todo el tiempo transcurrido del runner (deadline del subtest, tiempo por
 * ítem, subtest e intento) se mide con él: un cambio de la hora del equipo no lo mueve. `Date.now()` queda
 * solo para marcas de tiempo, nunca para medir duraciones.
 */
function monoNow(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
}

/** Backoff del reintento de /yo al confirmar el plazo con el servidor (1 s → 8 s, con jitter). */
const RESYNC_BACKOFF = { baseDelayMs: 1_000, maxDelayMs: 8_000, random: () => Math.random() } as const;

/**
 * Gracia (N) antes de bloquear la edición cuando NO se puede confirmar el plazo con el servidor: si /yo sigue
 * fallando y el deadline local venció hace MÁS de N s, los campos de respuesta se deshabilitan. 15 s = un ciclo
 * completo del backoff (1 + 2 + 4 + 8 s) más un sondeo: cubre un microcorte o una pausa breve sin cerrar ni
 * bloquear nada, y evita que el participante siga escribiendo respuestas que el backend rechazaría por tiempo.
 * El bloqueo es solo de edición: el runner nunca cierra el subtest por su cuenta; el backend cierra por tiempo.
 */
export const EDIT_LOCK_GRACE_MS = 15_000;

/** Separación mínima entre dos consultas de verificación del plazo cuando el servidor dice que aún queda tiempo. */
const VERIFY_MIN_SPACING_MS = 1_000;

/** Quién pide confirmar el plazo con el servidor (solo informativo / para depurar). */
export type DeadlineOrigin = "tick" | "visibilidad" | "reanudacion" | "reintento" | "respuesta-rechazada";

/** Resultado de intentar aplicar un /yo: aplicado, ya procesado antes (misma identidad de objeto) o descartado por obsoleto. */
type ApplyEvaluationResult = "applied" | "duplicate" | "discarded";

type FreshEvaluationOutcome =
  | { kind: "ok"; data: Evaluation }
  | { kind: "failed" }
  | { kind: "superseded" };

function isTabVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState === "visible";
}

/**
 * ÚNICO punto que decide si el reloj del tiempo por ítem puede correr: solo con un subtest en curso
 * (`respondiendo`), sin pausa (del servidor ni de la sesión) y con la pestaña VISIBLE. Todo sitio que inicie o
 * reanude el reloj del ítem (visibilitychange, transición de estado, cambio de ítem activo) debe consultarlo:
 * un /yo que responde con la pestaña oculta no puede reiniciar el reloj y sumar el tiempo en segundo plano.
 */
function canRunItemClock(state: RunnerState): boolean {
  return state.kind === "respondiendo" && !state.timing.paused && isTabVisible();
}
const RUNTIME_ERROR_SET: ReadonlySet<string> = new Set(RUNTIME_ERROR_CODES);

const STARTABLE_STATUSES: ReadonlySet<AttemptStatus> = new Set<AttemptStatus>([
  "NO_INICIADO",
  "EN_PROGRESO",
  "INTERRUMPIDO",
]);

const RESUMABLE_ITEM_STATUSES: ReadonlySet<AttemptStatus> = new Set<AttemptStatus>([
  "EN_PROGRESO",
  "INTERRUMPIDO",
]);

function isAuthRevokedCode(code: string): boolean {
  return code === "UNAUTHORIZED" || code === "FORBIDDEN" || code === "HTTP_401" || code === "HTTP_403";
}

function isEvaluationSubtestOperable(
  evaluation: Evaluation | null | undefined,
  capturedAttemptId: number,
  subtestId: number,
  allowedStatuses: ReadonlySet<AttemptStatus>,
): boolean {
  if (!evaluation) return false;
  if (evaluation.attemptId !== capturedAttemptId) return false;
  if (evaluation.sessionStatus !== "ABIERTA") return false;
  if (evaluation.attemptStatus === "COMPLETADO" || evaluation.attemptStatus === "ANULADO") return false;
  const sub = findSubtest(evaluation, subtestId);
  if (!sub || isSubtestDone(sub) || !allowedStatuses.has(sub.status)) return false;
  return isSubtestOpenable(evaluation, subtestId);
}

function formatPendingItemLabels(evaluation: Evaluation, subtestId: number, itemIds: readonly number[]): string {
  const sub = findSubtest(evaluation, subtestId);
  return itemIds
    .map((id) => {
      if (sub) {
        const idx = sub.items.findIndex((it) => it.id === id);
        if (idx >= 0) return `Ítem ${idx + 1}`;
      }
      return `Ítem #${id}`;
    })
    .join(", ");
}

function withUpdatedSubtest(
  evaluation: Evaluation,
  subtestId: number,
  updater: (subtest: RuntimeSubtest) => RuntimeSubtest,
): Evaluation {
  // F2-FIX-8: la copia hereda el MISMO ticket de la fuente; sin él, una fuente invalidada se «rehabilitaría».
  return inheritEvaluationTicket(evaluation, {
    ...evaluation,
    subtests: evaluation.subtests.map((s) => (s.id === subtestId ? updater(s) : s)),
  });
}

function mergeTimingFromAttempt(
  existing: RuntimeSubtest["timing"],
  attempt: SubtestAttempt,
): RuntimeSubtest["timing"] {
  const merged: NonNullable<RuntimeSubtest["timing"]> = {
    ...existing,
    ...attempt.timing,
    ...(attempt.startedAt !== undefined ? { startedAt: attempt.startedAt } : {}),
  };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function seedAttemptStartMs(evaluation: Evaluation): number | null {
  let earliest: number | null = null;
  for (const subtest of evaluation.subtests) {
    const startedAt = subtest.timing?.startedAt;
    if (!startedAt) continue;
    const ms = Date.parse(startedAt);
    if (!Number.isFinite(ms)) continue;
    const serverNowMs = subtest.timing?.serverNow ? Date.parse(subtest.timing.serverNow) : Number.NaN;
    const adjusted = Number.isFinite(serverNowMs) ? ms + (Date.now() - serverNowMs) : ms;
    if (earliest === null || adjusted < earliest) {
      earliest = adjusted;
    }
  }
  return earliest;
}

export interface RunnerContextValue {
  state: RunnerState;
  evaluation: Evaluation | null;
  assignmentId: number | null;
  nowMs: number;
  remainingTimeMs: number | null;
  evaluationError: unknown;
  refetchEvaluation: () => void;
  isStartingAttempt: boolean;
  isStartingSubtest: boolean;
  isFinishingSubtest: boolean;
  isFinishingAttempt: boolean;
  isRetryingSync: boolean;
  /** /yo falló al confirmar el plazo: se reintenta con backoff y NO se cierra por deadline hasta lograr uno exitoso. */
  isReconnecting: boolean;
  /** El deadline local venció y se está consultando al servidor («verificando tiempo»); aún no se cierra nada. */
  isVerifyingTime: boolean;
  /**
   * Edición bloqueada: el deadline local venció hace más de `EDIT_LOCK_GRACE_MS` y no se logró confirmarlo con el
   * servidor. Un /yo exitoso con tiempo extra (re-anclaje) la levanta sola.
   */
  isTimeLocked: boolean;
  actionError: string | null;
  clearActionError: () => void;
  completedUnconfirmedAnswers: readonly UnconfirmedAnswerEntry[];
  completedRejectedAnswers: readonly RejectedAnswerEntry[];
  startAttemptAction: () => Promise<boolean>;
  openSubtestAction: (subtestId: number) => void;
  backToListAction: () => void;
  startSubtestAction: (subtestId: number, options?: { signal?: AbortSignal }) => Promise<number | null>;
  goToItemAction: (ordinal: number) => void;
  finishSubtestAction: (subtestId: number, reason?: FinishReason) => Promise<boolean>;
  finishAttemptAction: () => Promise<boolean>;
  retrySyncAction: () => Promise<boolean>;
  ensureInstructionsRoute: (subtestId: number) => void;
  ensureItemsRoute: (subtestId: number, ordinal: number, options?: { signal?: AbortSignal }) => Promise<void>;
  getItemValue: (item: RuntimeItem) => AnswerValue | undefined;
  saveItemValue: (item: RuntimeItem, subtestId: number, value: AnswerValue) => Promise<void>;
  setActiveItem: (item: RuntimeItem | null, subtestId: number | null) => void;
}

const RunnerContext = createContext<RunnerContextValue | null>(null);

export interface RunnerProviderProps {
  children: ReactNode;
  /** Intervalo de polling de `/yo` (ms). 0 desactiva el polling (útil en tests). */
  pollingIntervalMs?: number;
}

export function RunnerProvider({
  children,
  pollingIntervalMs = DEFAULT_POLLING_INTERVAL_MS,
}: RunnerProviderProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const assignmentId = useParticipantAuth((s) => s.assignmentId);
  const token = useParticipantAuth((s) => s.token);
  const draftAnswers = useRuntimeDraft((s) => s.answers);
  const syncStatus = useSyncStatus();

  const [state, dispatch] = useReducer(runnerReducer, INITIAL_STATE);
  const stateRef = useRef(state);

  const [nowMs, setNowMs] = useState(() => monoNow());
  const [isStartingAttempt, setIsStartingAttempt] = useState(false);
  const [isStartingSubtest, setIsStartingSubtest] = useState(false);
  const [isFinishingSubtest, setIsFinishingSubtest] = useState(false);
  const [isFinishingAttempt, setIsFinishingAttempt] = useState(false);
  const [isRetryingSync, setIsRetryingSync] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [isVerifyingTime, setIsVerifyingTime] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [completionSnapshot, setCompletionSnapshot] = useState<{
    assignmentId: number;
    unconfirmed: UnconfirmedAnswerEntry[];
    rejected: RejectedAnswerEntry[];
  } | null>(null);

  const completedUnconfirmedAnswers = useMemo<readonly UnconfirmedAnswerEntry[]>(
    () => (completionSnapshot && completionSnapshot.assignmentId === assignmentId ? completionSnapshot.unconfirmed : []),
    [completionSnapshot, assignmentId],
  );
  const completedRejectedAnswers = useMemo<readonly RejectedAnswerEntry[]>(
    () => (completionSnapshot && completionSnapshot.assignmentId === assignmentId ? completionSnapshot.rejected : []),
    [completionSnapshot, assignmentId],
  );

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Seguimiento de tiempos reales (ítems, subtests, intento)
  const activeItemRef = useRef<{ itemId: number; subtestId: number; item: RuntimeItem } | null>(null);
  const itemEnteredAtRef = useRef<number | null>(null);
  const itemAccumulatedMsRef = useRef<Map<number, number>>(new Map());

  const subtestEnteredAtRef = useRef<{ subtestId: number; at: number } | null>(null);
  const subtestAccumulatedMsRef = useRef<Map<number, number>>(new Map());

  const attemptAccumulatedMsRef = useRef<number>(0);
  const attemptResumedAtRef = useRef<number | null>(null);
  const attemptSeededRef = useRef<number | null>(null);

  const finishingSubtestRef = useRef<number | null>(null);
  const loadingItemsForRef = useRef<number | null>(null);
  /**
   * El vencimiento del deadline LOCAL nunca cierra un subtest: solo el servidor lo confirma (ver
   * `confirmDeadlineWithServer`). Subtest cuyo agotamiento el servidor acaba de confirmar; `finishSubtestAction`
   * con motivo «tiempo» desde `respondiendo` exige (y consume) esta marca.
   */
  const serverConfirmedExpiryRef = useRef<number | null>(null);
  /** Consultas de verificación en vuelo (para el indicador y para no lanzar otra desde el tick). */
  const verifyingCountRef = useRef(0);
  const verifyNotBeforeRef = useRef(0);
  /** Cada verificación nueva (o una ocultación) invalida el resultado de las anteriores. */
  const resyncEpochRef = useRef(0);
  const resyncAttemptRef = useRef(0);
  const resyncRetryTimerRef = useRef<number | null>(null);
  const confirmDeadlineRef = useRef<(origin: DeadlineOrigin) => Promise<void>>(() => Promise.resolve());
  const lastValidatedTokenRef = useRef<string | null>(null);

  const isPausedOrTerminal = useCallback(
    (): boolean => isTerminal(stateRef.current) || stateRef.current.kind === "pausada",
    [],
  );

  const flushActiveItemMs = useCallback((now: number, keepRunning: boolean) => {
    const active = activeItemRef.current;
    const enteredAt = itemEnteredAtRef.current;
    if (active !== null && enteredAt !== null) {
      const elapsed = Math.max(0, now - enteredAt);
      const prev = itemAccumulatedMsRef.current.get(active.itemId) ?? 0;
      itemAccumulatedMsRef.current.set(active.itemId, prev + elapsed);
      itemEnteredAtRef.current = keepRunning ? now : null;
    } else if (!keepRunning) {
      itemEnteredAtRef.current = null;
    }
  }, []);

  const flushActiveSubtestMs = useCallback((now: number, keepRunning: boolean) => {
    const active = subtestEnteredAtRef.current;
    if (active !== null) {
      const elapsed = Math.max(0, now - active.at);
      const prev = subtestAccumulatedMsRef.current.get(active.subtestId) ?? 0;
      subtestAccumulatedMsRef.current.set(active.subtestId, prev + elapsed);
      subtestEnteredAtRef.current = keepRunning ? { subtestId: active.subtestId, at: now } : null;
    }
  }, []);

  const flushAttemptMs = useCallback((now: number, keepRunning: boolean) => {
    if (attemptResumedAtRef.current !== null) {
      attemptAccumulatedMsRef.current += Math.max(0, now - attemptResumedAtRef.current);
      attemptResumedAtRef.current = keepRunning ? now : null;
    }
  }, []);

  /**
   * Vigencia de las solicitudes de /yo (F2-FIX-4): cada solicitud lleva un ticket tomado al INICIAR (orden de inicio,
   * época de visibilidad, dueño). Una respuesta o error de una solicitud invalidada jamás cambia el estado.
   */
  // Guard único del módulo (F2-FIX-5): lo comparten los loaders de las rutas y la query del runner.
  const evaluationQuery = useQuery({
    ...evaluationQueryOptions(assignmentId ?? 0),
    enabled: assignmentId !== null && Boolean(token),
    refetchInterval: (query) => {
      if (pollingIntervalMs <= 0) return false;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return false;
      if (isTerminal(stateRef.current)) return false;
      const data = query.state.data;
      if (data && (data.attemptStatus === "COMPLETADO" || data.attemptStatus === "ANULADO")) {
        return false;
      }
      return pollingIntervalMs;
    },
  });
  const { refetch: refetchEvaluationQuery } = evaluationQuery;

  const currentEvaluation = useMemo(() => {
    switch (state.kind) {
      case "validando":
        return null;
      case "pausada":
        return state.resumeTo.evaluation;
      default:
        return state.evaluation;
    }
  }, [state]);

  const currentEvalRef = useRef<Evaluation | null>(currentEvaluation);
  useEffect(() => {
    stateRef.current = state;
    currentEvalRef.current = currentEvaluation;
  }, [state, currentEvaluation]);

  /**
   * Tiempo de revisión (MEDIO 6): al salir del ítem (navegar, finalizar, ocultar/cerrar la pestaña) un ítem YA
   * respondido cuyo tiempo acumulado cambió se vuelve a persistir con el MISMO valor y el `timeUsedSeconds` total.
   * Los ítems sin responder no generan escrituras; tampoco se escribe con el subtest cerrado, en pausa o terminal.
   * El tiempo en pausa o con la pestaña oculta no se acumula (lo corta `flushActiveItemMs`).
   */
  const persistActiveItemTime = useCallback(
    (now: number) => {
      const active = activeItemRef.current;
      if (active === null) return;
      if (stateRef.current.kind !== "respondiendo") return;
      const draft = useRuntimeDraft.getState().answers[active.itemId];
      const savedValue = active.item.savedAnswer
        ? fromSavedAnswer(active.item.responseType, active.item.savedAnswer)
        : undefined;
      const value = draft?.value ?? savedValue;
      if (value === undefined) return; // sin responder: nada que reescribir

      flushActiveItemMs(now, true); // acumula el tramo en curso sin detener el reloj
      const totalSeconds = Math.max(0, Math.round((itemAccumulatedMsRef.current.get(active.itemId) ?? 0) / 1000));
      const baselineSeconds = draft?.timeUsedSeconds ?? active.item.savedAnswer?.timeUsedSeconds ?? 0;
      if (totalSeconds === baselineSeconds) return;

      const attemptId = currentEvalRef.current?.attemptId;
      try {
        void setAnswer(active.itemId, value, totalSeconds, active.subtestId, {
          ...(attemptId !== null && attemptId !== undefined ? { attemptId } : {}),
        }).catch(() => undefined);
      } catch {
        // sin dueño enlazado: nada que persistir
      }
    },
    [flushActiveItemMs],
  );

  const isOwnerActive = useCallback(
    (capturedAssignmentId: number, capturedAttemptId?: number | null): boolean => {
      if (!mountedRef.current) return false;
      const auth = useParticipantAuth.getState();
      if (auth.assignmentId !== capturedAssignmentId || !auth.token) return false;
      if (capturedAttemptId !== undefined && capturedAttemptId !== null) {
        const liveAttemptId = currentEvalRef.current?.attemptId;
        if (liveAttemptId !== undefined && liveAttemptId !== null && liveAttemptId !== capturedAttemptId) {
          return false;
        }
      }
      return true;
    },
    [],
  );

  /**
   * ÚNICO punto que lleva un /yo a la máquina (EVALUATION_LOADED), venga del efecto de la query, del sondeo, del
   * resync o de una mutación (ver `loadEvaluationIfCurrent`). Descarta el dato si la solicitud que lo produjo fue
   * invalidada (ocultación de la pestaña, cambio de dueño) o empezó antes que otra ya aplicada: el orden es el de
   * INICIO de la solicitud, no el de llegada. Al descartar se restaura en la caché el último estado bueno aplicado,
   * de modo que ningún otro lector (mutaciones, rutas) vea el dato obsoleto.
   *
   * Cada /yo con timing re-ancla la referencia monotónica (serverNow + remainingSeconds recibidos en el instante
   * `monoNow()` = T0).
   */
  const lastProcessedEvaluationRef = useRef<Evaluation | null>(null);
  const lastGoodEvaluationRef = useRef<{ data: Evaluation; updatedAt: number } | null>(null);
  const loadEvaluationIfCurrent = useCallback(
    (data: Evaluation, clientNow: number): boolean => {
      if (!evaluationGuard.isCurrent(evaluationGuard.ticketOf(data))) return false;
      if (isTerminal(stateRef.current)) return false;
      dispatch({ type: "EVALUATION_LOADED", evaluation: data, clientNow });
      return true;
    },
    [],
  );
  const applyEvaluationIfCurrent = useCallback(
    (data: Evaluation, dataUpdatedAt: number): ApplyEvaluationResult => {
      if (assignmentId === null || data.assignmentId !== assignmentId) return "duplicate";
      // Se deduplica por identidad de objeto (cada /yo es un objeto distinto), NO por `dataUpdatedAt`: dos resultados
      // pueden compartir el mismo milisegundo.
      if (data === lastProcessedEvaluationRef.current) return "duplicate";
      lastProcessedEvaluationRef.current = data;

      const ticket = evaluationGuard.ticketOf(data);
      if (!evaluationGuard.isCurrent(ticket)) {
        const good = lastGoodEvaluationRef.current;
        if (good !== null && good.data.assignmentId === assignmentId) {
          // Se conserva el último estado bueno no obsoleto; el efecto no lo reprocesa (misma identidad).
          lastProcessedEvaluationRef.current = good.data;
          queryClient.setQueryData<Evaluation>(runtimeKeys.evaluation(assignmentId), good.data, {
            updatedAt: good.updatedAt,
          });
        } else if (isTabVisible()) {
          // Sin estado bueno previo: se vuelve a pedir (con la pestaña oculta lo hará la vuelta a la pestaña).
          void refetchEvaluationQuery();
        }
        return "discarded";
      }
      evaluationGuard.markApplied(ticket);
      lastGoodEvaluationRef.current = { data, updatedAt: dataUpdatedAt };
      const receivedMono = monoNow();

      if (data.attemptId !== null) {
        bindDraftOwner({ assignmentId: data.assignmentId, attemptId: data.attemptId });
        if (attemptSeededRef.current !== data.attemptId) {
          attemptSeededRef.current = data.attemptId;
          const seededStart = seedAttemptStartMs(data);
          attemptAccumulatedMsRef.current =
            seededStart !== null ? Math.max(0, Date.now() - seededStart) : 0;
          attemptResumedAtRef.current = data.sessionStatus === "PAUSADA" ? null : receivedMono;
        }
        // Acceso validado con un JWT distinto al anterior (nuevo canje del mismo intento): la cola retenida por un
        // 401 del JWT viejo se reanuda ahora, ya con el acceso confirmado por /yo.
        const sessionToken = useParticipantAuth.getState().token;
        if (sessionToken !== null && sessionToken !== lastValidatedTokenRef.current) {
          lastValidatedTokenRef.current = sessionToken;
          void resumeSync();
        }
      }

      loadEvaluationIfCurrent(data, receivedMono);
      return "applied";
    },
    [assignmentId, loadEvaluationIfCurrent, queryClient, refetchEvaluationQuery],
  );

  useEffect(() => {
    const data = evaluationQuery.data;
    if (!data) return;
    applyEvaluationIfCurrent(data, evaluationQuery.dataUpdatedAt);
  }, [applyEvaluationIfCurrent, evaluationQuery.data, evaluationQuery.dataUpdatedAt]);

  const clearResyncRetry = useCallback(() => {
    if (resyncRetryTimerRef.current !== null) {
      window.clearTimeout(resyncRetryTimerRef.current);
      resyncRetryTimerRef.current = null;
    }
  }, []);

  useEffect(() => clearResyncRetry, [clearResyncRetry]);

  // Consulta /yo y aplica el resultado. La época se comprueba ANTES de aplicar: una consulta reemplazada (otra
  // verificación o la ocultación de la pestaña) no toca el estado. Un /yo fallido NUNCA se interpreta como «se acabó
  // el tiempo»; el llamador decide qué hacer según el resultado.
  const fetchFreshEvaluation = useCallback(
    async (epoch: number): Promise<FreshEvaluationOutcome> => {
      if (assignmentId === null) return { kind: "failed" };
      const dataBefore = queryClient.getQueryData<Evaluation>(runtimeKeys.evaluation(assignmentId));
      let fresh: { data: Evaluation; dataUpdatedAt: number } | null = null;
      try {
        const result = await refetchEvaluationQuery();
        if (!result.isError && result.data !== undefined && result.data !== dataBefore) {
          fresh = { data: result.data, dataUpdatedAt: result.dataUpdatedAt };
        }
      } catch {
        // Se trata como un /yo fallido.
      }
      if (!mountedRef.current || epoch !== resyncEpochRef.current) return { kind: "superseded" };
      if (fresh === null) return { kind: "failed" };
      // Una respuesta obsoleta (otro dueño, o más vieja que una ya aplicada) no es una verificación válida.
      if (applyEvaluationIfCurrent(fresh.data, fresh.dataUpdatedAt) === "discarded") {
        return { kind: "superseded" };
      }
      return { kind: "ok", data: fresh.data };
    },
    [applyEvaluationIfCurrent, assignmentId, queryClient, refetchEvaluationQuery],
  );

  // Reintento con backoff de la verificación: estado «reconectando»; nada se cierra mientras tanto.
  const scheduleVerifyRetry = useCallback(() => {
    if (isTerminal(stateRef.current) || stateRef.current.kind === "pausada") {
      // Sin cierre posible; al reanudar, la transición vuelve a pedir un /yo.
      setIsReconnecting(false);
      return;
    }
    setIsReconnecting(true);
    const delay = computeBackoffMs(resyncAttemptRef.current, RESYNC_BACKOFF);
    resyncAttemptRef.current += 1;
    resyncRetryTimerRef.current = window.setTimeout(() => {
      resyncRetryTimerRef.current = null;
      const live = stateRef.current;
      if (!mountedRef.current || isTerminal(live) || live.kind === "pausada" || !isTabVisible()) {
        setIsReconnecting(false);
        return;
      }
      void confirmDeadlineRef.current("reintento");
    }, delay);
  }, []);

  // Pestaña oculta/visible y cierre de página. Al ocultarse: se persiste el tiempo de revisión del ítem, se deja de
  // contar su tiempo y se invalida cualquier verificación en vuelo. Al volver: se reactiva el reloj del ítem y se
  // consulta /yo (confirmDeadlineWithServer) ANTES de actuar sobre cualquier deadline.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisibility = () => {
      if (isTerminal(stateRef.current)) return;
      const now = monoNow();
      if (document.visibilityState === "hidden") {
        persistActiveItemTime(now);
        flushActiveItemMs(now, false);
        // Sin red en segundo plano: se invalida cualquier verificación en vuelo y se detienen los reintentos.
        // La invalidación de los tickets de /yo (época de visibilidad) la hace el listener ÚNICO del guard
        // (`ensureVisibilityListener`, F2-FIX-6); aquí no se duplica.
        resyncEpochRef.current += 1;
        clearResyncRetry();
        setIsReconnecting(false);
        return;
      }
      if (canRunItemClock(stateRef.current) && activeItemRef.current !== null) {
        itemEnteredAtRef.current ??= now;
      }
      void confirmDeadlineRef.current("visibilidad");
    };
    const onPageHide = () => {
      const now = monoNow();
      persistActiveItemTime(now);
      flushActiveItemMs(now, false);
    };
    ensureVisibilityListener(); // antes que el propio: la época del guard ya cambió cuando corre `onVisibility`
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [clearResyncRetry, flushActiveItemMs, persistActiveItemTime]);

  // Errores de carga/polling de /yo
  const lastProcessedErrorAtRef = useRef<number>(0);
  useEffect(() => {
    const err = evaluationQuery.error;
    if (!err || !evaluationQuery.isError) return;
    if (evaluationQuery.errorUpdatedAt === lastProcessedErrorAtRef.current) return;
    lastProcessedErrorAtRef.current = evaluationQuery.errorUpdatedAt;

    // Un error de una solicitud invalidada (pestaña oculta, otro dueño, más vieja que una aplicada) no cambia el estado.
    if (!evaluationGuard.isCurrent(evaluationGuard.ticketOf(err))) return;
    if (isStaleParticipantError(err)) return;
    if (isRuntimeBlocked(err)) {
      if (err.code === "SESION_PAUSADA" && stateRef.current.kind === "pausada") return;
      dispatch(serverErrorEvent(err.code as RuntimeErrorCode));
      return;
    }
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
      dispatch({ type: "ACCESS_REVOKED" });
    }
  }, [evaluationQuery.error, evaluationQuery.errorUpdatedAt, evaluationQuery.isError]);

  // Observa useSyncStatus() para pausa / bloqueo / revocación desde la cola de respuestas
  const lastSyncBlockCodeRef = useRef<string | null>(null);
  useEffect(() => {
    const code = syncStatus.blockedCode;
    if (code === lastSyncBlockCodeRef.current) return;
    lastSyncBlockCodeRef.current = code;
    if (!code) return;

    if (isAuthRevokedCode(code)) {
      dispatch({ type: "ACCESS_REVOKED" });
      return;
    }
    if (RUNTIME_ERROR_SET.has(code)) {
      if (code === "SESION_PAUSADA" && stateRef.current.kind === "pausada") return;
      if (isResumable(stateRef.current) || code !== "SESION_PAUSADA") {
        dispatch(serverErrorEvent(code as RuntimeErrorCode));
      }
    }
  }, [syncStatus.blockedCode]);

  // Transiciones laterales: salida de pausa -> resumeSync(); completada -> clearRuntimeDraft()
  const prevStateRef = useRef(state);
  useEffect(() => {
    const prev = prevStateRef.current;
    const prevKind = prev.kind;
    prevStateRef.current = state;

    const now = monoNow();
    if (prevKind === "pausada" && state.kind !== "pausada" && !isTerminal(state)) {
      void resumeSync();
      // Al reanudar se consulta /yo antes de actuar sobre cualquier deadline.
      void confirmDeadlineRef.current("reanudacion");
    }

    // El servidor cerró/anuló el subtest mientras se finalizaba (la máquina avanzó sola): lo que siga sin
    // confirmar en ese subtest ya no se podrá enviar; se conserva como "sin confirmar" para avisar al participante
    // (las rechazadas ya viven en rejectedAnswers).
    const prevBase = prev.kind === "pausada" ? prev.resumeTo : prev;
    if (prevBase.kind === "finalizandoSubtest" && (state.kind === "listaSubtests" || state.kind === "resumen")) {
      markSubtestPendingUnconfirmed(prevBase.subtestId);
    }

    if (state.kind === "completada") {
      clearRuntimeDraft();
      flushActiveItemMs(now, false);
      flushActiveSubtestMs(now, false);
      flushAttemptMs(now, false);
      return;
    }

    if (state.kind === "bloqueado") {
      flushActiveItemMs(now, false);
      flushActiveSubtestMs(now, false);
      flushAttemptMs(now, false);
      return;
    }

    if (state.kind === "pausada") {
      flushActiveItemMs(now, false);
      flushActiveSubtestMs(now, false);
      flushAttemptMs(now, false);
      return;
    }

    // Estado activo no pausado
    if (currentEvalRef.current?.attemptId !== null && attemptResumedAtRef.current === null) {
      attemptResumedAtRef.current = now;
    }

    if (state.kind === "respondiendo" && !state.timing.paused) {
      // Con la pestaña oculta un /yo puede cambiar el estado: el reloj del ítem NO se reinicia (lo hace la vuelta).
      if (canRunItemClock(state) && activeItemRef.current !== null && itemEnteredAtRef.current === null) {
        itemEnteredAtRef.current = now;
      }
      if (
        subtestEnteredAtRef.current === null ||
        subtestEnteredAtRef.current.subtestId !== state.subtestId
      ) {
        flushActiveSubtestMs(now, false);
        subtestEnteredAtRef.current = { subtestId: state.subtestId, at: now };
      }
    } else {
      flushActiveItemMs(now, false);
      flushActiveSubtestMs(now, false);
    }
  }, [state, flushActiveItemMs, flushActiveSubtestMs, flushAttemptMs]);

  // Tick de 1s mientras respondiendo y no pausado (lectura monotónica)
  const isTimerRunning = state.kind === "respondiendo" && !state.timing.paused;
  useEffect(() => {
    if (!isTimerRunning) return;
    const id = window.setInterval(() => {
      setNowMs(monoNow());
    }, 1_000);
    return () => window.clearInterval(id);
  }, [isTimerRunning]);

  const computeSubtestSeconds = useCallback(
    (subtestId: number, now: number): number => {
      const s = stateRef.current;
      const timing =
        s.kind === "respondiendo" || s.kind === "finalizandoSubtest" ? s.timing : null;
      if (timing && timing.timeLimitSeconds !== null) {
        const rem = remainingMs(s, now);
        if (rem !== null) {
          return Math.max(0, Math.round(timing.timeLimitSeconds - rem / 1000));
        }
      }
      flushActiveSubtestMs(now, false);
      const localMs = subtestAccumulatedMsRef.current.get(subtestId) ?? 0;
      if (localMs > 0) return Math.round(localMs / 1000);
      if (timing?.startedAt) {
        const startedMs = Date.parse(timing.startedAt);
        if (Number.isFinite(startedMs)) {
          // Fallback sin referencia monotónica: única comparación contra la hora de pared (fecha del servidor).
          return Math.max(0, Math.round((Date.now() - startedMs) / 1000));
        }
      }
      return 0;
    },
    [flushActiveSubtestMs],
  );

  const handleMutationError = useCallback(
    (err: unknown, capturedAssignmentId: number, capturedAttemptId?: number | null): boolean => {
      if (isStaleParticipantError(err)) return true;
      if (!isOwnerActive(capturedAssignmentId, capturedAttemptId)) return true;
      if (isRuntimeBlocked(err)) {
        dispatch(serverErrorEvent(err.code as RuntimeErrorCode));
        return true;
      }
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        dispatch({ type: "ACCESS_REVOKED" });
        return true;
      }
      return false;
    },
    [isOwnerActive],
  );

  const startAttemptAction = useCallback(async (): Promise<boolean> => {
    const ev = currentEvaluation;
    if (!ev) return false;
    const capturedAssignmentId = ev.assignmentId;
    setActionError(null);
    setIsStartingAttempt(true);
    try {
      const deviceInfo =
        typeof navigator !== "undefined" && navigator.userAgent ? navigator.userAgent : "web";
      const attempt = await startAttempt({ assignmentId: capturedAssignmentId, deviceInfo });
      if (!isOwnerActive(capturedAssignmentId)) return false;

      attemptSeededRef.current = attempt.id;
      attemptAccumulatedMsRef.current = 0;
      attemptResumedAtRef.current = monoNow();

      queryClient.setQueryData<Evaluation>(
        runtimeKeys.evaluation(capturedAssignmentId),
        (prev) =>
          prev
            ? inheritEvaluationTicket(prev, {
                ...prev,
                attemptId: attempt.id,
                attemptStatus: attempt.status,
              })
            : prev,
      );
      bindDraftOwner({ assignmentId: capturedAssignmentId, attemptId: attempt.id });
      dispatch({ type: "START_ATTEMPT_OK", attemptId: attempt.id });
      return true;
    } catch (err) {
      if (handleMutationError(err, capturedAssignmentId)) return false;
      setActionError(err instanceof ApiError ? err.message : "No se pudo iniciar la evaluación.");
      return false;
    } finally {
      if (mountedRef.current) setIsStartingAttempt(false);
    }
  }, [currentEvaluation, handleMutationError, isOwnerActive, queryClient]);

  const openSubtestAction = useCallback((subtestId: number) => {
    setActionError(null);
    dispatch({ type: "OPEN_SUBTEST", subtestId });
  }, []);

  const backToListAction = useCallback(() => {
    setActionError(null);
    dispatch({ type: "BACK_TO_LIST" });
  }, []);

  const startSubtestAction = useCallback(
    async (subtestId: number, options?: { signal?: AbortSignal }): Promise<number | null> => {
      const ev = currentEvalRef.current ?? currentEvaluation;
      if (!ev || ev.attemptId === null) return null;
      const capturedAssignmentId = ev.assignmentId;
      const capturedAttemptId = ev.attemptId;
      const signal = options?.signal;

      if (signal?.aborted) return null;

      if (stateRef.current.kind === "respondiendo" && stateRef.current.subtestId === subtestId) {
        return stateRef.current.ordinal;
      }

      setActionError(null);
      setIsStartingSubtest(true);
      try {
        const subtestAttempt = await startSubtest(capturedAttemptId, subtestId);
        if (signal?.aborted || !isOwnerActive(capturedAssignmentId, capturedAttemptId)) return null;
        if (isPausedOrTerminal()) return null;

        const liveBeforeItems =
          queryClient.getQueryData<Evaluation>(runtimeKeys.evaluation(capturedAssignmentId)) ??
          currentEvalRef.current ??
          ev;
        if (!isEvaluationSubtestOperable(liveBeforeItems, capturedAttemptId, subtestId, STARTABLE_STATUSES)) {
          return null;
        }

        const existingSubtest = findSubtest(liveBeforeItems, subtestId);
        let loadedItems = existingSubtest?.items ?? [];
        if (loadedItems.length === 0) {
          const loaded = await queryClient.ensureQueryData(
            subtestItemsQueryOptions(capturedAssignmentId, capturedAttemptId, subtestId),
          );
          if (signal?.aborted || !isOwnerActive(capturedAssignmentId, capturedAttemptId)) return null;
          if (isPausedOrTerminal()) return null;
          loadedItems = loaded.items;
        }

        const now = monoNow();
        let nextEvaluationSnapshot: Evaluation | null = null;
        let operableAfterLoad = false;
        queryClient.setQueryData<Evaluation>(
          runtimeKeys.evaluation(capturedAssignmentId),
          (prev) => {
            if (!prev) return prev;
            if (!isEvaluationSubtestOperable(prev, capturedAttemptId, subtestId, STARTABLE_STATUSES)) {
              operableAfterLoad = false;
              return prev;
            }
            operableAfterLoad = true;
            nextEvaluationSnapshot = withUpdatedSubtest(prev, subtestId, (sub) => ({
              ...sub,
              status: "EN_PROGRESO",
              items: loadedItems.length > 0 ? loadedItems : sub.items,
              timeLimitSeconds:
                subtestAttempt.timeLimitSeconds !== undefined
                  ? subtestAttempt.timeLimitSeconds
                  : sub.timeLimitSeconds,
              timing: mergeTimingFromAttempt(sub.timing, subtestAttempt),
            }));
            return nextEvaluationSnapshot;
          },
        );

        if (
          !operableAfterLoad ||
          !nextEvaluationSnapshot ||
          signal?.aborted ||
          isPausedOrTerminal()
        ) {
          return null;
        }

        if (loadedItems.length > 0) {
          loadEvaluationIfCurrent(nextEvaluationSnapshot, now);
        }
        if (stateRef.current.kind === "listaSubtests") {
          dispatch({ type: "OPEN_SUBTEST", subtestId });
        }
        dispatch(startSubtestOkEvent(subtestId, subtestAttempt, now, 1));
        subtestEnteredAtRef.current = { subtestId, at: now };
        return 1;
      } catch (err) {
        if (signal?.aborted) return null;
        if (handleMutationError(err, capturedAssignmentId, capturedAttemptId)) return null;
        setActionError(err instanceof ApiError ? err.message : "No se pudo iniciar el subtest.");
        return null;
      } finally {
        if (mountedRef.current) setIsStartingSubtest(false);
      }
    },
    [currentEvaluation, handleMutationError, isOwnerActive, isPausedOrTerminal, loadEvaluationIfCurrent, queryClient],
  );

  const goToItemAction = useCallback((ordinal: number) => {
    dispatch({ type: "GO_TO_ITEM", ordinal });
  }, []);

  const applyPendingSyncHoldOrError = useCallback((): boolean => {
    const block = useRuntimeDraft.getState().syncBlock;
    if (!block) return false;
    if (isAuthRevokedCode(block.code)) {
      dispatch({ type: "ACCESS_REVOKED" });
      return true;
    }
    if (RUNTIME_ERROR_SET.has(block.code)) {
      if (!(block.code === "SESION_PAUSADA" && stateRef.current.kind === "pausada")) {
        dispatch(serverErrorEvent(block.code as RuntimeErrorCode));
      }
      return true;
    }
    return false;
  }, []);

  const retrySyncAction = useCallback(async (): Promise<boolean> => {
    const ev = currentEvalRef.current ?? currentEvaluation;
    if (!ev || ev.attemptId === null) return false;
    const capturedAssignmentId = ev.assignmentId;
    const capturedAttemptId = ev.attemptId;

    setActionError(null);
    setIsRetryingSync(true);
    try {
      const result = await flushAllBeforeFinish();
      if (!isOwnerActive(capturedAssignmentId, capturedAttemptId)) return false;

      if (result.pending.length === 0) {
        return true;
      }
      if (applyPendingSyncHoldOrError()) {
        return false;
      }
      const n = result.pending.length;
      setActionError(
        `Aún ${n === 1 ? "queda 1 respuesta pendiente" : `quedan ${n} respuestas pendientes`} sin confirmar. Verifique su conexión e intente nuevamente.`,
      );
      return false;
    } catch (err) {
      if (handleMutationError(err, capturedAssignmentId, capturedAttemptId)) return false;
      setActionError(
        "No se pudieron sincronizar sus respuestas. Verifique su conexión e intente nuevamente.",
      );
      return false;
    } finally {
      if (mountedRef.current) setIsRetryingSync(false);
    }
  }, [applyPendingSyncHoldOrError, currentEvaluation, handleMutationError, isOwnerActive]);

  const finishSubtestAction = useCallback(
    async (subtestId: number, reason: FinishReason = "usuario"): Promise<boolean> => {
      const ev = currentEvalRef.current ?? currentEvaluation;
      if (!ev || ev.attemptId === null) return false;
      if (finishingSubtestRef.current === subtestId) return false;

      // Cierre por tiempo: el deadline LOCAL jamás finaliza un subtest. Desde `respondiendo` solo se cierra con la
      // confirmación del servidor (`confirmDeadlineWithServer` deja la marca); sin ella no se hace nada. Desde
      // `finalizandoSubtest` (reintento del cierre) el servidor ya lo había confirmado.
      let confirmedByServer = false;
      if (reason === "tiempo" && stateRef.current.kind === "respondiendo") {
        if (serverConfirmedExpiryRef.current !== subtestId) return false;
        serverConfirmedExpiryRef.current = null;
        confirmedByServer = true;
      }

      const capturedAssignmentId = ev.assignmentId;
      const capturedAttemptId = ev.attemptId;
      finishingSubtestRef.current = subtestId;
      setActionError(null);
      setIsFinishingSubtest(true);

      const now = monoNow();
      // Al salir del ítem por finalizar, el tiempo de revisión del ítem respondido se persiste antes del flush.
      persistActiveItemTime(now);
      flushActiveItemMs(now, false);
      const timeSeconds = computeSubtestSeconds(subtestId, now);

      if (reason === "tiempo") {
        if (confirmedByServer && stateRef.current.kind === "respondiendo") {
          // El servidor ya confirmó el agotamiento (/yo con 0 s, subtest cerrado o 409): pasa a «finalizando».
          dispatch({ type: "SERVER_ERROR", code: "TIEMPO_AGOTADO", clientNow: now });
        }
      } else if (stateRef.current.kind === "respondiendo") {
        dispatch({ type: "REQUEST_FINISH_SUBTEST" });
      }

      try {
        if (reason === "usuario") {
          let flushResult: FlushResult;
          try {
            flushResult = await flushBeforeFinish(subtestId);
          } catch (flushErr) {
            if (isStaleParticipantError(flushErr)) return false;
            if (!isOwnerActive(capturedAssignmentId, capturedAttemptId)) return false;
            if (handleMutationError(flushErr, capturedAssignmentId, capturedAttemptId)) return false;
            dispatch({ type: "FINISH_SUBTEST_FAILED", subtestId });
            setActionError(
              "No se pudieron sincronizar sus respuestas antes de cerrar. Verifique su conexión y reintente la sincronización.",
            );
            return false;
          }

          if (!isOwnerActive(capturedAssignmentId, capturedAttemptId)) return false;

          if (flushResult.pending.length > 0) {
            if (applyPendingSyncHoldOrError()) {
              return false;
            }
            dispatch({ type: "FINISH_SUBTEST_FAILED", subtestId });
            const latestEv = currentEvalRef.current ?? ev;
            const labels = formatPendingItemLabels(latestEv, subtestId, flushResult.pending);
            const n = flushResult.pending.length;
            setActionError(
              `No se pudieron confirmar ${n} ${
                n === 1 ? "respuesta pendiente" : "respuestas pendientes"
              } antes de cerrar (${labels}). Verifique su conexión y reintente la sincronización.`,
            );
            return false;
          }
        } else {
          try {
            await flushBeforeFinish(subtestId);
          } catch (flushErr) {
            if (isStaleParticipantError(flushErr)) return false;
            // Al vencer el tiempo, no bloqueamos el cierre si el flush falla por red o rechazo.
          }
        }

        if (!isOwnerActive(capturedAssignmentId, capturedAttemptId)) return false;

        try {
          await finishSubtest(capturedAttemptId, subtestId, { timeSeconds });
        } catch (finishErr) {
          if (isStaleParticipantError(finishErr)) return false;
          if (!isOwnerActive(capturedAssignmentId, capturedAttemptId)) return false;

          const closedByServer =
            finishErr instanceof ApiError &&
            finishErr.status === 409 &&
            (finishErr.code === "TIEMPO_AGOTADO" || finishErr.code === "SUBTEST_FINALIZADO");
          if (!closedByServer) {
            if (handleMutationError(finishErr, capturedAssignmentId, capturedAttemptId)) return false;
            if (reason === "usuario") {
              dispatch({ type: "FINISH_SUBTEST_FAILED", subtestId });
            }
            setActionError(
              finishErr instanceof ApiError ? finishErr.message : "No se pudo finalizar el subtest.",
            );
            return false;
          }
        }

        if (!isOwnerActive(capturedAssignmentId, capturedAttemptId)) return false;

        if (reason === "tiempo") {
          markSubtestPendingUnconfirmed(subtestId);
        }

        queryClient.setQueryData<Evaluation>(
          runtimeKeys.evaluation(capturedAssignmentId),
          (prev) =>
            prev
              ? withUpdatedSubtest(prev, subtestId, (sub) => ({
                  ...sub,
                  status: "COMPLETADO",
                }))
              : prev,
        );

        dispatch({ type: "FINISH_SUBTEST_OK", subtestId });
        void navigate({ to: "/evaluacion/sesion", replace: true });
        return true;
      } finally {
        if (finishingSubtestRef.current === subtestId) {
          finishingSubtestRef.current = null;
        }
        if (mountedRef.current) setIsFinishingSubtest(false);
      }
    },
    [
      applyPendingSyncHoldOrError,
      computeSubtestSeconds,
      currentEvaluation,
      flushActiveItemMs,
      handleMutationError,
      isOwnerActive,
      navigate,
      persistActiveItemTime,
      queryClient,
    ],
  );

  /**
   * ÚNICO punto por el que el vencimiento del plazo puede llevar a cerrar un subtest. Orígenes: tick del
   * cronómetro, vuelta de visibilitychange, reanudación de pausa, reintento tras un fallo y 409 TIEMPO_AGOTADO /
   * SUBTEST_FINALIZADO al responder. El deadline local solo dispara la CONSULTA («verificando tiempo»), nunca el cierre:
   *   - servidor con remainingSeconds <= 0, o subtest ya COMPLETADO/ANULADO → flushBeforeFinish → finishSubtest
   *     (una sola vez), o la máquina avanza sola si ya estaba cerrado;
   *   - servidor con tiempo restante (p. ej. por una pausa) → el /yo re-ancla el deadline y se sigue respondiendo;
   *   - /yo falla (red, 5xx) o no trae datos de tiempo → NO se cierra: «Reconectando…» + reintento con backoff; la
   *     edición se bloquea solo si el plazo local venció hace más de `EDIT_LOCK_GRACE_MS` (`isTimeLocked`). El backend
   *     cierra por tiempo de todos modos.
   * Con `serverVerdict` (409 al responder) el veredicto ya es del servidor y no hace falta consultar.
   */
  const confirmDeadlineWithServer = useCallback(
    async (origin: DeadlineOrigin, serverVerdict = false): Promise<void> => {
      void origin; // informativo: la lógica es la misma para todos los orígenes
      clearResyncRetry();
      if (assignmentId === null || isTerminal(stateRef.current)) return;
      const start = stateRef.current;
      const subtestId = start.kind === "respondiendo" ? start.subtestId : null;
      const capturedAttemptId = currentEvalRef.current?.attemptId ?? null;

      const closeConfirmedByServer = async (id: number): Promise<void> => {
        resyncAttemptRef.current = 0;
        setIsReconnecting(false);
        serverConfirmedExpiryRef.current = id;
        await finishSubtestAction(id, "tiempo");
        if (serverConfirmedExpiryRef.current === id) serverConfirmedExpiryRef.current = null;
      };

      if (serverVerdict && subtestId !== null) {
        await closeConfirmedByServer(subtestId);
        return;
      }

      const epoch = ++resyncEpochRef.current;
      const expiredLocally =
        start.kind === "respondiendo" && !start.timing.paused && (remainingMs(start, monoNow()) ?? 1) <= 0;
      verifyingCountRef.current += 1;
      if (expiredLocally) setIsVerifyingTime(true);
      try {
        const outcome = await fetchFreshEvaluation(epoch);
        if (outcome.kind === "superseded") return;
        if (outcome.kind === "failed") {
          scheduleVerifyRetry();
          return;
        }

        const data = outcome.data;
        const live = stateRef.current;
        if (subtestId === null || live.kind !== "respondiendo" || live.subtestId !== subtestId) {
          // Nada que cerrar (otro estado, pausa, terminal): la máquina ya aplicó lo que dijo el servidor.
          resyncAttemptRef.current = 0;
          setIsReconnecting(false);
          return;
        }
        if (
          data.attemptId !== capturedAttemptId ||
          data.sessionStatus !== "ABIERTA" ||
          data.attemptStatus === "COMPLETADO" ||
          data.attemptStatus === "ANULADO"
        ) {
          // Sesión pausada/cerrada o intento terminal: lo resuelve la máquina (EVALUATION_LOADED ya aplicado).
          resyncAttemptRef.current = 0;
          setIsReconnecting(false);
          return;
        }

        const sub = findSubtest(data, subtestId);
        if (sub === undefined || isSubtestDone(sub)) {
          // El servidor ya cerró el subtest: la máquina avanzó sola; lo que siga sin confirmar se conserva como aviso.
          markSubtestPendingUnconfirmed(subtestId);
          resyncAttemptRef.current = 0;
          setIsReconnecting(false);
          return;
        }

        if (sub.timeLimitSeconds === null) {
          // Subtest SIN límite de tiempo: no hay plazo que confirmar; un /yo 200 es una respuesta válida (nada de
          // «Reconectando…» ni reintentos).
          resyncAttemptRef.current = 0;
          verifyNotBeforeRef.current = monoNow() + VERIFY_MIN_SPACING_MS;
          setIsReconnecting(false);
          return;
        }

        const timingInput = sub.timing;
        const hasTiming =
          timingInput !== undefined &&
          ((timingInput.remainingSeconds !== undefined && timingInput.remainingSeconds !== null) ||
            (timingInput.startedAt !== undefined && timingInput.startedAt !== null));
        const serverRemaining = hasTiming
          ? timingRemainingMs(buildTiming(timingInput, sub.timeLimitSeconds, monoNow()), monoNow())
          : null;

        if (serverRemaining === null) {
          // El servidor no dio un plazo utilizable: no se cierra; se reintenta con backoff.
          scheduleVerifyRetry();
          return;
        }
        if (serverRemaining <= 0) {
          await closeConfirmedByServer(subtestId);
          return;
        }
        // Queda tiempo según el servidor: el /yo ya re-ancló el deadline (EVALUATION_LOADED). Se sigue respondiendo.
        resyncAttemptRef.current = 0;
        verifyNotBeforeRef.current = monoNow() + VERIFY_MIN_SPACING_MS;
        setIsReconnecting(false);
      } finally {
        verifyingCountRef.current -= 1;
        if (mountedRef.current && verifyingCountRef.current === 0) setIsVerifyingTime(false);
      }
    },
    [assignmentId, clearResyncRetry, fetchFreshEvaluation, finishSubtestAction, scheduleVerifyRetry],
  );

  useEffect(() => {
    confirmDeadlineRef.current = (origin) => confirmDeadlineWithServer(origin);
  }, [confirmDeadlineWithServer]);

  const effectiveNowMs =
    state.kind === "respondiendo" ? Math.max(nowMs, state.timing.receivedAt) : nowMs;
  const remainingTimeMs = remainingMs(state, effectiveNowMs);

  // Edición bloqueada solo si el plazo local venció hace más de N s y el servidor no lo confirmó ni lo extendió.
  const localDeadlineMs = deadline(state);
  const isTimeLocked =
    state.kind === "respondiendo" &&
    localDeadlineMs !== null &&
    effectiveNowMs - localDeadlineMs > EDIT_LOCK_GRACE_MS;

  // Al vencer el deadline local NO se cierra: se pasa a «verificando tiempo» y se consulta al servidor.
  // No se lanza con la pestaña oculta (la vuelta consulta /yo), con una verificación en vuelo, con un reintento
  // con backoff pendiente ni antes de la separación mínima tras un «aún queda tiempo».
  useEffect(() => {
    if (state.kind !== "respondiendo" || state.timing.paused) return;
    const rem = remainingMs(state, effectiveNowMs);
    if (rem === null || rem > 0) return;
    if (!isTabVisible()) return;
    if (verifyingCountRef.current > 0 || resyncRetryTimerRef.current !== null) return;
    if (monoNow() < verifyNotBeforeRef.current) return;
    void confirmDeadlineWithServer("tick");
  }, [state, effectiveNowMs, confirmDeadlineWithServer]);

  // 409 TIEMPO_AGOTADO / SUBTEST_FINALIZADO al responder: el servidor confirma el cierre del subtest en curso.
  const rejectedAnswers = useRuntimeDraft((s) => s.rejectedAnswers);
  const seenRejectedRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    const firstRun = seenRejectedRef.current === null;
    const seen = seenRejectedRef.current ?? new Set<string>();
    seenRejectedRef.current = seen;
    let verdictSubtestId: number | null = null;
    for (const [itemId, entry] of Object.entries(rejectedAnswers)) {
      const key = `${itemId}:${entry.version}:${entry.rejectedAt}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (firstRun) continue; // lo que ya había al montar no es un veredicto nuevo
      if (entry.code !== "TIEMPO_AGOTADO" && entry.code !== "SUBTEST_FINALIZADO") continue;
      const live = stateRef.current;
      if (live.kind === "respondiendo" && entry.subtestId === live.subtestId) {
        verdictSubtestId = live.subtestId;
      }
    }
    if (verdictSubtestId !== null && finishingSubtestRef.current === null) {
      void confirmDeadlineWithServer("respuesta-rechazada", true);
    }
  }, [rejectedAnswers, confirmDeadlineWithServer]);

  const finishAttemptAction = useCallback(async (): Promise<boolean> => {
    const ev = currentEvalRef.current ?? currentEvaluation;
    if (!ev || ev.attemptId === null) return false;
    const capturedAssignmentId = ev.assignmentId;
    const capturedAttemptId = ev.attemptId;

    setActionError(null);
    setIsFinishingAttempt(true);
    const now = monoNow();
    flushAttemptMs(now, false);
    const timeSeconds = Math.max(0, Math.round(attemptAccumulatedMsRef.current / 1000));

    if (stateRef.current.kind === "resumen") {
      dispatch({ type: "REQUEST_FINISH_ATTEMPT" });
    }

    try {
      const flushResult = await flushAllBeforeFinish();
      if (!isOwnerActive(capturedAssignmentId, capturedAttemptId)) return false;

      if (flushResult.pending.length > 0) {
        if (applyPendingSyncHoldOrError()) {
          return false;
        }
        dispatch({ type: "FINISH_ATTEMPT_FAILED" });
        const count = flushResult.pending.length;
        setActionError(
          `No se pudieron confirmar ${count} ${
            count === 1 ? "respuesta pendiente" : "respuestas pendientes"
          } antes de finalizar la evaluación. Verifique su conexión y reintente la sincronización.`,
        );
        return false;
      }

      await finishAttempt(capturedAttemptId, { timeSeconds });
      if (!isOwnerActive(capturedAssignmentId, capturedAttemptId)) return false;

      const draftState = useRuntimeDraft.getState();
      const unconfirmedSnap: UnconfirmedAnswerEntry[] = Object.entries(draftState.unconfirmedAnswers)
        .map(([itemId, entry]) => ({ itemId: Number(itemId), ...entry }))
        .sort((a, b) => a.recordedAt - b.recordedAt || a.itemId - b.itemId);
      const rejectedSnap: RejectedAnswerEntry[] = Object.entries(draftState.rejectedAnswers)
        .map(([itemId, entry]) => ({ itemId: Number(itemId), ...entry }))
        .sort((a, b) => a.rejectedAt - b.rejectedAt || a.itemId - b.itemId);
      setCompletionSnapshot({
        assignmentId: capturedAssignmentId,
        unconfirmed: unconfirmedSnap,
        rejected: rejectedSnap,
      });

      queryClient.setQueryData<Evaluation>(
        runtimeKeys.evaluation(capturedAssignmentId),
        (prev) => (prev ? inheritEvaluationTicket<Evaluation>(prev, { ...prev, attemptStatus: "COMPLETADO" }) : prev),
      );
      markDelivered(capturedAssignmentId, { hadUnconfirmed: unconfirmedSnap.length > 0 || rejectedSnap.length > 0 });
      clearRuntimeDraft();
      dispatch({ type: "FINISH_ATTEMPT_OK" });
      return true;
    } catch (err) {
      if (handleMutationError(err, capturedAssignmentId, capturedAttemptId)) return false;
      dispatch({ type: "FINISH_ATTEMPT_FAILED" });
      setActionError(err instanceof ApiError ? err.message : "No se pudo finalizar la evaluación.");
      return false;
    } finally {
      if (mountedRef.current) setIsFinishingAttempt(false);
    }
  }, [applyPendingSyncHoldOrError, currentEvaluation, flushAttemptMs, handleMutationError, isOwnerActive, queryClient]);

  const ensureInstructionsRoute = useCallback(
    (subtestId: number) => {
      if (state.kind === "listaSubtests" && isSubtestOpenable(state.evaluation, subtestId)) {
        dispatch({ type: "OPEN_SUBTEST", subtestId });
      }
    },
    [state],
  );

  const ensureItemsRoute = useCallback(
    async (subtestId: number, ordinal: number, options?: { signal?: AbortSignal }): Promise<void> => {
      const signal = options?.signal;
      if (signal?.aborted) return;

      if (state.kind === "respondiendo") {
        if (
          state.subtestId === subtestId &&
          state.ordinal !== ordinal &&
          isValidOrdinal(ordinal, state.totalItems)
        ) {
          dispatch({ type: "GO_TO_ITEM", ordinal });
        }
        return;
      }

      if (state.kind !== "listaSubtests" && state.kind !== "instrucciones") {
        return;
      }

      const ev = state.evaluation;
      const subtest = findSubtest(ev, subtestId);
      if (!subtest || !RESUMABLE_ITEM_STATUSES.has(subtest.status)) {
        return;
      }
      if (!isSubtestOpenable(ev, subtestId)) return;

      const capturedAssignmentId = ev.assignmentId;
      const capturedAttemptId = ev.attemptId;
      if (capturedAttemptId === null) return;
      if (!isEvaluationSubtestOperable(ev, capturedAttemptId, subtestId, RESUMABLE_ITEM_STATUSES)) {
        return;
      }

      let items = subtest.items;
      let targetEvaluation = ev;
      let currentKind: RunnerState["kind"] = state.kind;

      if (items.length === 0) {
        if (loadingItemsForRef.current === subtestId) return;
        loadingItemsForRef.current = subtestId;
        try {
          const loaded = await queryClient.ensureQueryData(
            subtestItemsQueryOptions(capturedAssignmentId, capturedAttemptId, subtestId),
          );
          if (signal?.aborted || !isOwnerActive(capturedAssignmentId, capturedAttemptId)) return;
          if (isPausedOrTerminal()) return;
          // F2-FIX-8: el await pudo durar lo bastante para que el /yo fuente quedara invalidado (pestaña oculta,
          // cambio de dueño): no se publica ni se navega con él; al llegar el /yo vigente el efecto de la ruta repite.
          if (!isTicketCurrent(ev)) return;

          items = loaded.items;
          if (items.length === 0) return;

          let mergedEvaluation: Evaluation | null = null;
          let operableAfterFetch = false;
          queryClient.setQueryData<Evaluation>(
            runtimeKeys.evaluation(capturedAssignmentId),
            (prev) => {
              if (!prev) return prev;
              // La fuente de la copia es la caché: si su ticket ya no es vigente, no se publica (F2-FIX-8).
              if (
                !isTicketCurrent(prev) ||
                !isEvaluationSubtestOperable(prev, capturedAttemptId, subtestId, RESUMABLE_ITEM_STATUSES)
              ) {
                operableAfterFetch = false;
                return prev;
              }
              operableAfterFetch = true;
              // `withUpdatedSubtest` conserva el ticket de `prev`.
              mergedEvaluation = withUpdatedSubtest(prev, subtestId, (sub) => ({
                ...sub,
                items,
              }));
              return mergedEvaluation;
            },
          );

          if (
            !operableAfterFetch ||
            !mergedEvaluation ||
            signal?.aborted ||
            isPausedOrTerminal()
          ) {
            return;
          }

          targetEvaluation = mergedEvaluation;
          loadEvaluationIfCurrent(targetEvaluation, monoNow());

          const latestState = stateRef.current;
          if (latestState.kind === "respondiendo") {
            const clamped = clampOrdinal(ordinal, latestState.totalItems);
            if (latestState.ordinal !== clamped) {
              dispatch({ type: "GO_TO_ITEM", ordinal: clamped });
            }
            return;
          }
          if (latestState.kind !== "listaSubtests" && latestState.kind !== "instrucciones") {
            return;
          }
          currentKind = latestState.kind;
        } catch (err) {
          if (signal?.aborted) return;
          handleMutationError(err, capturedAssignmentId, capturedAttemptId);
          return;
        } finally {
          if (loadingItemsForRef.current === subtestId) {
            loadingItemsForRef.current = null;
          }
        }
      }

      if (
        signal?.aborted ||
        isPausedOrTerminal() ||
        !isEvaluationSubtestOperable(targetEvaluation, capturedAttemptId, subtestId, RESUMABLE_ITEM_STATUSES)
      ) {
        return;
      }

      const activeSubtest = findSubtest(targetEvaluation, subtestId);
      if (!activeSubtest) return;

      const safeOrdinal = clampOrdinal(ordinal, items.length);
      const now = monoNow();
      if (currentKind === "listaSubtests") {
        dispatch({ type: "OPEN_SUBTEST", subtestId });
      }
      dispatch({
        type: "START_SUBTEST_OK",
        subtestId,
        timing: activeSubtest.timing ?? {},
        timeLimitSeconds: activeSubtest.timeLimitSeconds,
        ordinal: safeOrdinal,
        clientNow: now,
      });
    },
    [state, handleMutationError, isOwnerActive, isPausedOrTerminal, loadEvaluationIfCurrent, queryClient],
  );

  const getItemValue = useCallback(
    (item: RuntimeItem): AnswerValue | undefined => {
      const local = draftAnswers[item.id];
      if (local) return local.value;
      if (item.savedAnswer) return fromSavedAnswer(item.responseType, item.savedAnswer);
      return undefined;
    },
    [draftAnswers],
  );

  const setActiveItem = useCallback(
    (item: RuntimeItem | null, subtestId: number | null) => {
      const now = monoNow();
      const liveState = stateRef.current;
      const isRunning = canRunItemClock(liveState);
      const prev = activeItemRef.current;
      if (prev && item && prev.itemId === item.id && prev.subtestId === subtestId) {
        activeItemRef.current = { ...prev, item };
        if (itemEnteredAtRef.current === null && isRunning) {
          itemEnteredAtRef.current = now;
        }
        return;
      }

      // Se sale del ítem anterior: se persiste su tiempo de revisión (si estaba respondido y cambió).
      persistActiveItemTime(now);
      flushActiveItemMs(now, false);

      if (item !== null && subtestId !== null) {
        if (!itemAccumulatedMsRef.current.has(item.id)) {
          const localTime = useRuntimeDraft.getState().answers[item.id]?.timeUsedSeconds;
          const seedSeconds = localTime ?? item.savedAnswer?.timeUsedSeconds ?? 0;
          if (seedSeconds > 0) {
            itemAccumulatedMsRef.current.set(item.id, seedSeconds * 1000);
          }
        }
        activeItemRef.current = { itemId: item.id, subtestId, item };
        itemEnteredAtRef.current = isRunning ? now : null;
      } else {
        activeItemRef.current = null;
        itemEnteredAtRef.current = null;
      }
    },
    [flushActiveItemMs, persistActiveItemTime],
  );

  /**
   * Registra la respuesta. El draft local (con su `itemId` y el intento de origen) se actualiza AL INSTANTE en cada
   * cambio; el debounce afecta solo al envío por red del texto abierto. Así, cambiar de ítem, deshabilitar el campo
   * (deadline) o finalizar nunca pierde ni reasigna el texto, y `flushBeforeFinish` ve siempre el valor más reciente.
   */
  const saveItemValue = useCallback(
    async (item: RuntimeItem, subtestId: number, value: AnswerValue): Promise<void> => {
      const ev = currentEvalRef.current;
      if (!ev) return;
      const capturedAssignmentId = ev.assignmentId;
      const capturedAttemptId = ev.attemptId;
      const now = monoNow();
      const liveState = stateRef.current;

      if (!itemAccumulatedMsRef.current.has(item.id)) {
        const localTime = useRuntimeDraft.getState().answers[item.id]?.timeUsedSeconds;
        const seedSeconds = localTime ?? item.savedAnswer?.timeUsedSeconds ?? 0;
        if (seedSeconds > 0) {
          itemAccumulatedMsRef.current.set(item.id, seedSeconds * 1000);
        }
      }

      const accumulatedMs = itemAccumulatedMsRef.current.get(item.id) ?? 0;
      const liveMs =
        activeItemRef.current?.itemId === item.id &&
        itemEnteredAtRef.current !== null &&
        canRunItemClock(liveState)
          ? Math.max(0, now - itemEnteredAtRef.current)
          : 0;
      const timeUsedSeconds = Math.max(0, Math.round((accumulatedMs + liveMs) / 1000));

      try {
        await setAnswer(item.id, value, timeUsedSeconds, subtestId, {
          ...(value.kind === "TEXTO_ABIERTO" ? { debounceMs: TEXT_SEND_DEBOUNCE_MS } : {}),
          ...(capturedAttemptId !== null ? { attemptId: capturedAttemptId } : {}),
        });
      } catch (err) {
        if (isStaleParticipantError(err)) return;
        if (!isOwnerActive(capturedAssignmentId, capturedAttemptId)) return;
        if (import.meta.env.DEV) {
          console.error("[runner] Error guardando respuesta", safeErrorLog(err));
        }
      }
    },
    [isOwnerActive],
  );

  const refetchEvaluation = useCallback(() => {
    void refetchEvaluationQuery();
  }, [refetchEvaluationQuery]);
  const clearActionError = useCallback(() => setActionError(null), []);

  const value = useMemo<RunnerContextValue>(
    () => ({
      state,
      evaluation: currentEvaluation,
      assignmentId,
      nowMs: effectiveNowMs,
      remainingTimeMs,
      evaluationError: state.kind === "validando" && evaluationQuery.isError ? evaluationQuery.error : null,
      refetchEvaluation,
      isStartingAttempt,
      isStartingSubtest,
      isFinishingSubtest,
      isFinishingAttempt,
      isRetryingSync,
      isReconnecting,
      isVerifyingTime,
      isTimeLocked,
      actionError,
      clearActionError,
      completedUnconfirmedAnswers,
      completedRejectedAnswers,
      startAttemptAction,
      openSubtestAction,
      backToListAction,
      startSubtestAction,
      goToItemAction,
      finishSubtestAction,
      finishAttemptAction,
      retrySyncAction,
      ensureInstructionsRoute,
      ensureItemsRoute,
      getItemValue,
      saveItemValue,
      setActiveItem,
    }),
    [
      state,
      currentEvaluation,
      assignmentId,
      effectiveNowMs,
      remainingTimeMs,
      evaluationQuery.isError,
      evaluationQuery.error,
      refetchEvaluation,
      isStartingAttempt,
      isStartingSubtest,
      isFinishingSubtest,
      isFinishingAttempt,
      isRetryingSync,
      isReconnecting,
      isVerifyingTime,
      isTimeLocked,
      actionError,
      clearActionError,
      completedUnconfirmedAnswers,
      completedRejectedAnswers,
      startAttemptAction,
      openSubtestAction,
      backToListAction,
      startSubtestAction,
      goToItemAction,
      finishSubtestAction,
      finishAttemptAction,
      retrySyncAction,
      ensureInstructionsRoute,
      ensureItemsRoute,
      getItemValue,
      saveItemValue,
      setActiveItem,
    ],
  );

  return <RunnerContext.Provider value={value}>{children}</RunnerContext.Provider>;
}

export function useRunner(): RunnerContextValue {
  const ctx = useContext(RunnerContext);
  if (!ctx) {
    throw new Error("useRunner debe usarse dentro de un <RunnerProvider>.");
  }
  return ctx;
}
