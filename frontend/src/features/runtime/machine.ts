import type {
  AttemptStatus,
  Evaluation,
  RuntimeErrorCode,
  RuntimeSubtest,
  SessionStatus,
  SubtestAttempt,
} from "../../api/schemas/runtime";

/**
 * Máquina de estados pura del runner del participante (R-01).
 *
 * Reducer sin efectos: sin React, sin fetch, sin stores y sin relojes. Todo instante que
 * necesita la máquina (`clientNow`) viaja DENTRO del evento, de modo que el mismo evento sobre el
 * mismo estado siempre da el mismo resultado.
 *
 * `clientNow` es un instante MONOTÓNICO del cliente (`performance.now()`, en ms), NUNCA `Date.now()`:
 * el tiempo transcurrido desde la última referencia del servidor se mide con un reloj que no se
 * mueve si el usuario cambia la hora del equipo (un salto de +1 h no puede cerrar un subtest).
 *
 * Flujo feliz:
 *   validando → bienvenida → listaSubtests → instrucciones(s) → respondiendo(s, i)
 *   → finalizandoSubtest(s) → listaSubtests … → resumen → finalizando → completada
 *
 * Estados laterales:
 *   - `bloqueado(motivo)`: terminal. Se sale remontando la máquina (nueva carga de la ruta).
 *   - `pausada`: la sesión está PAUSADA. Recuerda el estado previo (`resumeTo`) y vuelve a él al
 *     reanudar, con el tiempo del subtest congelado durante la pausa.
 *   - `sinConexion` NO es un estado: es una bandera derivada del draft store.
 *
 * Reglas:
 *   - Sin transiciones implícitas: un evento inválido para el estado actual devuelve el MISMO
 *     objeto de estado (`Object.is`) y, si se pasó `onInvalid`, lo notifica.
 *   - Orden de subtests según `evaluation.subtests[].order`; no se abre un subtest COMPLETADO
 *     ni se salta el orden (ver `isSubtestOpenable`).
 *   - El ordinal del ítem está en [1, totalItems]; un ordinal fuera de rango se RECHAZA (no se
 *     recorta). Para guards de ruta usar `clampOrdinal`.
 *   - Con todos los subtests COMPLETADO la máquina va a `resumen` (sin pasar por la lista).
 *   - Las fechas del dominio ya son ISO con zona (regla 10 de conventions-api).
 *
 * Tiempo:
 *   El servidor es la autoridad. El snapshot de tiempo (`SubtestTiming`) guarda lo que dijo el
 *   servidor (`remainingSeconds`, `serverNow`, `startedAt`) y el instante monotónico de recepción
 *   (`receivedAt`, T0). `remaining = remainingSeconds*1000 − (clientNow − T0)`; la referencia es el
 *   par (servidor dijo X restantes) + (T0 monotónico). Sin `remainingSeconds` se deriva
 *   `startedAt + timeLimitSeconds − serverNow` (solo diferencias de relojes del servidor). Sin
 *   `serverNow` válido o sin T0 monotónico finito no hay referencia: no hay deadline local (null),
 *   ni siquiera con `remainingSeconds`.
 *   Mientras la sesión está pausada el tiempo no avanza (`remainingMs` devuelve el valor congelado).
 */

// ---------------------------------------------------------------------------
// Tipos públicos: tiempo
// ---------------------------------------------------------------------------

/** Timing tal como lo entrega el dominio (`/yo` por subtest o `iniciar subtest`). */
export type SubtestTimingInput = NonNullable<RuntimeSubtest["timing"]>;

/** Snapshot de tiempo de un subtest en curso, normalizado y con el instante local de recepción. */
export interface SubtestTiming {
  readonly timeLimitSeconds: number | null;
  /** ISO con zona, según el servidor. */
  readonly startedAt: string | null;
  /** Segundos restantes según el servidor en `serverNow` (puede ser fraccionario tras reanudar). */
  readonly remainingSeconds: number | null;
  /** ISO con zona del reloj del servidor cuando generó este snapshot. */
  readonly serverNow: string | null;
  /** El servidor reportó el subtest como pausado (tiempo congelado). */
  readonly paused: boolean;
  /** Instante MONOTÓNICO del cliente (`performance.now()`, ms) cuando se recibió el snapshot (T0). */
  readonly receivedAt: number;
}

// ---------------------------------------------------------------------------
// Tipos públicos: estados
// ---------------------------------------------------------------------------

export type BlockReason =
  | "sesionCerrada"
  | "sesionCancelada"
  | "sesionNoAbierta"
  | "accesoRevocado"
  | "expirado"
  | "asignacionNoOperable"
  /** 409 ASIGNACION_NO_OPERABLE con marcador local de entrega confirmada por el servidor. */
  | "evaluacionEntregada";

export type FinishReason = "usuario" | "tiempo";

export interface ValidandoState {
  readonly kind: "validando";
}

export interface BienvenidaState {
  readonly kind: "bienvenida";
  readonly evaluation: Evaluation;
}

export interface ListaSubtestsState {
  readonly kind: "listaSubtests";
  readonly evaluation: Evaluation;
}

export interface InstruccionesState {
  readonly kind: "instrucciones";
  readonly evaluation: Evaluation;
  readonly subtestId: number;
}

export interface RespondiendoState {
  readonly kind: "respondiendo";
  readonly evaluation: Evaluation;
  readonly subtestId: number;
  /** 1-based, en [1, totalItems]. */
  readonly ordinal: number;
  readonly totalItems: number;
  readonly timing: SubtestTiming;
}

export interface FinalizandoSubtestState {
  readonly kind: "finalizandoSubtest";
  readonly evaluation: Evaluation;
  readonly subtestId: number;
  readonly totalItems: number;
  readonly timing: SubtestTiming;
  readonly reason: FinishReason;
  readonly returnOrdinal?: number;
}

export interface ResumenState {
  readonly kind: "resumen";
  readonly evaluation: Evaluation;
}

export interface FinalizandoState {
  readonly kind: "finalizando";
  readonly evaluation: Evaluation;
}

export interface CompletadaState {
  readonly kind: "completada";
  readonly evaluation: Evaluation;
}

/** Estados "de trabajo": los únicos desde los que se puede pausar y a los que se vuelve al reanudar. */
export type ResumableState =
  | BienvenidaState
  | ListaSubtestsState
  | InstruccionesState
  | RespondiendoState
  | FinalizandoSubtestState
  | ResumenState
  | FinalizandoState;

export interface PausadaState {
  readonly kind: "pausada";
  /** Estado al que se vuelve al reanudar (con el tiempo ya rebasado). */
  readonly resumeTo: ResumableState;
  /** Milisegundos restantes congelados del subtest en curso (null si no hay subtest con límite). */
  readonly frozenRemainingMs: number | null;
  /** ISO con zona del inicio de la pausa, si el servidor lo informó (`/yo`). */
  readonly pausedAt: string | null;
}

export interface BloqueadoState {
  readonly kind: "bloqueado";
  readonly reason: BlockReason;
  /** Puede ser null si se bloquea antes de cargar la evaluación (p. ej. TOKEN_EXPIRADO al validar). */
  readonly evaluation: Evaluation | null;
}

export type RunnerState =
  | ValidandoState
  | ResumableState
  | PausadaState
  | BloqueadoState
  | CompletadaState;

export type RunnerStateKind = RunnerState["kind"];

export const INITIAL_STATE: RunnerState = { kind: "validando" };

// ---------------------------------------------------------------------------
// Tipos públicos: eventos
// ---------------------------------------------------------------------------

export type RunnerEvent =
  /** `/evaluacion-participante/yo` cargado (primera carga o refetch/polling). Re-sincroniza la máquina. */
  | { readonly type: "EVALUATION_LOADED"; readonly evaluation: Evaluation; readonly clientNow: number }
  // `clientNow` de todos los eventos: instante monotónico (`performance.now()`), no hora de pared.
  /** `iniciar` intento respondió OK. Solo desde `bienvenida`. */
  | { readonly type: "START_ATTEMPT_OK"; readonly attemptId: number }
  /** El participante abre un subtest desde la lista. */
  | { readonly type: "OPEN_SUBTEST"; readonly subtestId: number }
  /** Vuelve de las instrucciones a la lista. */
  | { readonly type: "BACK_TO_LIST" }
  /**
   * `iniciar subtest` respondió OK. `timing` es el del endpoint; `timeLimitSeconds` pisa el del
   * subtest de la evaluación si viene. `ordinal` (opcional, default 1) permite retomar en un ítem.
   * El total de ítems sale de `evaluation.subtests[].items` (`/yo` los incluye).
   */
  | {
      readonly type: "START_SUBTEST_OK";
      readonly subtestId: number;
      readonly timing: SubtestTimingInput;
      readonly timeLimitSeconds?: number | null;
      readonly ordinal?: number;
      readonly clientNow: number;
    }
  | { readonly type: "GO_TO_ITEM"; readonly ordinal: number }
  | { readonly type: "NEXT" }
  | { readonly type: "PREV" }
  /** El participante pide terminar el subtest. */
  | { readonly type: "REQUEST_FINISH_SUBTEST" }
  /** `finalizar subtest` respondió OK (o el backend lo cerró por tiempo). */
  | { readonly type: "FINISH_SUBTEST_OK"; readonly subtestId: number }
  /** Fallo recuperable al finalizar subtest iniciado por el usuario (vuelve a `respondiendo`). */
  | { readonly type: "FINISH_SUBTEST_FAILED"; readonly subtestId: number }
  /**
   * El cronómetro local llegó al deadline. `clientNow` (instante monotónico) es OBLIGATORIO y la máquina lo
   * VERIFICA siempre: con tiempo restante > 0, sin referencia válida (serverNow + T0 monotónico) o con un
   * `clientNow` no finito el evento se ignora.
   */
  | { readonly type: "DEADLINE_REACHED"; readonly clientNow: number }
  /** Desde `resumen`: el participante confirma el envío final. */
  | { readonly type: "REQUEST_FINISH_ATTEMPT" }
  | { readonly type: "FINISH_ATTEMPT_OK" }
  /** Fallo recuperable al finalizar el intento (vuelve a `resumen`). */
  | { readonly type: "FINISH_ATTEMPT_FAILED" }
  /** Cambio de estado de la sesión detectado por el cliente (p. ej. polling ligero). */
  | { readonly type: "SESSION_STATUS_CHANGED"; readonly status: SessionStatus; readonly clientNow: number }
  /** 409 de bloqueo del backend (`isRuntimeBlocked`). */
  | {
      readonly type: "SERVER_ERROR";
      readonly code: RuntimeErrorCode;
      readonly clientNow: number;
      /** Solo con ASIGNACION_NO_OPERABLE o SESION_FINALIZADA: existe el marcador local de que el finalizar fue confirmado. */
      readonly delivered?: boolean;
    }
  /** El acceso fue revocado (401/403 de la audiencia participante). */
  | { readonly type: "ACCESS_REVOKED" };

export type RunnerEventType = RunnerEvent["type"];

// ---------------------------------------------------------------------------
// Utilidades de evaluación (orden y apertura de subtests)
// ---------------------------------------------------------------------------

const OPENABLE_STATUSES: ReadonlySet<AttemptStatus> = new Set<AttemptStatus>([
  "NO_INICIADO",
  "EN_PROGRESO",
  "INTERRUMPIDO",
]);

function orderedSubtests(evaluation: Evaluation): RuntimeSubtest[] {
  return [...evaluation.subtests].sort((a, b) => a.order - b.order);
}

export function findSubtest(evaluation: Evaluation, subtestId: number): RuntimeSubtest | undefined {
  return evaluation.subtests.find((s) => s.id === subtestId);
}

/** Cantidad de ítems del subtest según la evaluación (0 si no existe). */
export function totalItemsOf(evaluation: Evaluation, subtestId: number): number {
  return findSubtest(evaluation, subtestId)?.items.length ?? 0;
}

/**
 * Subtest cerrado para el participante: COMPLETADO o ANULADO (decisión del orquestador: un subtest anulado por
 * el personal no se puede abrir, pero tampoco bloquea el orden ni impide llegar al resumen).
 */
export function isSubtestDone(subtest: Pick<RuntimeSubtest, "status">): boolean {
  return subtest.status === "COMPLETADO" || subtest.status === "ANULADO";
}

/** ¿Todos los subtests están cerrados (COMPLETADO o ANULADO)? (false si no hay subtests). */
export function allSubtestsCompleted(evaluation: Evaluation): boolean {
  return evaluation.subtests.length > 0 && evaluation.subtests.every(isSubtestDone);
}

/** Primer subtest, según el orden de la evaluación, que aún no está cerrado. */
export function nextPendingSubtest(evaluation: Evaluation): RuntimeSubtest | null {
  return orderedSubtests(evaluation).find((s) => !isSubtestDone(s)) ?? null;
}

/**
 * Regla de orden, independiente del estado de la máquina (útil para guards de ruta):
 * el subtest existe, hay intento, su estado es NO_INICIADO|EN_PROGRESO|INTERRUMPIDO
 * (nunca COMPLETADO ni ANULADO) y todos los anteriores, por `order`, están cerrados (COMPLETADO o ANULADO).
 */
export function isSubtestOpenable(evaluation: Evaluation, subtestId: number): boolean {
  if (evaluation.attemptId === null) return false;
  const ordered = orderedSubtests(evaluation);
  const index = ordered.findIndex((s) => s.id === subtestId);
  const target = ordered[index];
  if (target === undefined || !OPENABLE_STATUSES.has(target.status)) return false;
  return ordered.slice(0, index).every(isSubtestDone);
}

/** ¿Puede abrirse `subtestId` AHORA? Exige estar en `listaSubtests` y cumplir `isSubtestOpenable`. */
export function canOpenSubtest(state: RunnerState, evaluation: Evaluation, subtestId: number): boolean {
  return state.kind === "listaSubtests" && isSubtestOpenable(evaluation, subtestId);
}

/** Recorta un ordinal a [1, total]. Con total < 1 devuelve 1. */
export function clampOrdinal(ordinal: number, total: number): number {
  if (!Number.isFinite(ordinal) || total < 1) return 1;
  return Math.min(Math.max(Math.trunc(ordinal), 1), total);
}

export function isValidOrdinal(ordinal: number, total: number): boolean {
  return Number.isInteger(ordinal) && ordinal >= 1 && ordinal <= total;
}

// ---------------------------------------------------------------------------
// Tiempo: snapshot, deadline y restante
// ---------------------------------------------------------------------------

function parseMs(iso: string | null | undefined): number | null {
  if (iso == null || iso === "") return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/** Normaliza el timing del dominio a un snapshot con el instante local de recepción. */
export function buildTiming(
  input: SubtestTimingInput | undefined,
  timeLimitSeconds: number | null,
  clientNow: number,
): SubtestTiming {
  return {
    timeLimitSeconds,
    startedAt: input?.startedAt ?? null,
    remainingSeconds: input?.remainingSeconds ?? null,
    serverNow: input?.serverNow ?? null,
    paused: input?.paused ?? false,
    receivedAt: clientNow,
  };
}

/**
 * Instante (en la escala monotónica del cliente) en que vence el subtest, o null si no hay límite
 * o no hay una referencia válida. La referencia exige AMBAS cosas: un T0 monotónico finito (`receivedAt`)
 * y un `serverNow` válido (el snapshot nació de una respuesta fresca del servidor). Sin ellas no hay
 * deadline local: el cierre por tiempo queda en manos del servidor hasta el próximo /yo.
 * - Con `remainingSeconds`: `receivedAt + remainingSeconds*1000` (T0 + lo que dijo el servidor).
 * - Sin `remainingSeconds`: `receivedAt + (startedAt + timeLimitSeconds − serverNow)`; solo usa
 *   diferencias entre fechas del servidor (jamás se compara una fecha absoluta con `clientNow`).
 */
export function timingDeadline(timing: SubtestTiming): number | null {
  if (!Number.isFinite(timing.receivedAt)) return null;
  const serverNowMs = parseMs(timing.serverNow);
  if (serverNowMs === null) return null;
  if (timing.remainingSeconds !== null) {
    return Number.isFinite(timing.remainingSeconds) ? timing.receivedAt + timing.remainingSeconds * 1000 : null;
  }
  const startedAtMs = parseMs(timing.startedAt);
  if (timing.timeLimitSeconds !== null && startedAtMs !== null) {
    return timing.receivedAt + (startedAtMs + timing.timeLimitSeconds * 1000 - serverNowMs);
  }
  return null;
}

/**
 * ¿La referencia monotónica del snapshot es utilizable en `clientNow`? Exige un T0 finito y un reloj que
 * no vaya hacia atrás respecto de T0. Si no se cumple, el runner NO debe cerrar por deadline: primero
 * refresca `/yo`.
 */
export function isTimingReferenceValid(timing: SubtestTiming, clientNow: number): boolean {
  return Number.isFinite(timing.receivedAt) && Number.isFinite(clientNow) && clientNow >= timing.receivedAt;
}

/** Milisegundos restantes (≥ 0) en `clientNow`. Un snapshot pausado no avanza. Null sin límite. */
export function timingRemainingMs(timing: SubtestTiming, clientNow: number): number | null {
  const deadlineMs = timingDeadline(timing);
  if (timing.paused) {
    if (timing.remainingSeconds !== null) return Math.max(0, timing.remainingSeconds * 1000);
    return deadlineMs === null ? null : Math.max(0, deadlineMs - timing.receivedAt);
  }
  return deadlineMs === null ? null : Math.max(0, deadlineMs - clientNow);
}

function activeTiming(state: RunnerState): SubtestTiming | null {
  return state.kind === "respondiendo" || state.kind === "finalizandoSubtest" ? state.timing : null;
}

/**
 * Deadline absoluto (epoch ms, reloj del cliente) del subtest en curso.
 * Null si no hay subtest activo, no tiene límite o el tiempo está congelado (pausa).
 */
export function deadline(state: RunnerState): number | null {
  const timing = activeTiming(state);
  if (timing === null || timing.paused) return null;
  return timingDeadline(timing);
}

/**
 * Milisegundos restantes del subtest en curso en `clientNow` (≥ 0), o null si no aplica.
 * En `pausada` devuelve el valor congelado: no avanza con `clientNow`.
 */
export function remainingMs(state: RunnerState, clientNow: number): number | null {
  if (state.kind === "pausada") return state.frozenRemainingMs;
  const timing = activeTiming(state);
  return timing === null ? null : timingRemainingMs(timing, clientNow);
}

// ---------------------------------------------------------------------------
// Selectores de estado
// ---------------------------------------------------------------------------

const RESUMABLE_KINDS: ReadonlySet<RunnerStateKind> = new Set<RunnerStateKind>([
  "bienvenida",
  "listaSubtests",
  "instrucciones",
  "respondiendo",
  "finalizandoSubtest",
  "resumen",
  "finalizando",
]);

export function isResumable(state: RunnerState): state is ResumableState {
  return RESUMABLE_KINDS.has(state.kind);
}

/** `bloqueado` y `completada` no aceptan más eventos. */
export function isTerminal(state: RunnerState): state is BloqueadoState | CompletadaState {
  return state.kind === "bloqueado" || state.kind === "completada";
}

/** Evaluación vigente de la máquina (null en `validando` o bloqueo previo a la carga). */
export function evaluationOf(state: RunnerState): Evaluation | null {
  switch (state.kind) {
    case "validando":
      return null;
    case "pausada":
      return state.resumeTo.evaluation;
    default:
      return state.evaluation;
  }
}

/** Subtest abierto en instrucciones, respondiendo o finalizando (también a través de `pausada`). */
export function currentSubtestId(state: RunnerState): number | null {
  const base = state.kind === "pausada" ? state.resumeTo : state;
  switch (base.kind) {
    case "instrucciones":
    case "respondiendo":
    case "finalizandoSubtest":
      return base.subtestId;
    default:
      return null;
  }
}

/** Ordinal actual (solo en `respondiendo`, también a través de `pausada`). */
export function currentOrdinal(state: RunnerState): number | null {
  const base = state.kind === "pausada" ? state.resumeTo : state;
  return base.kind === "respondiendo" ? base.ordinal : null;
}

// ---------------------------------------------------------------------------
// Transiciones internas
// ---------------------------------------------------------------------------

function withSubtestStatus(evaluation: Evaluation, subtestId: number, status: AttemptStatus): Evaluation {
  return {
    ...evaluation,
    subtests: evaluation.subtests.map((s) => (s.id === subtestId ? { ...s, status } : s)),
  };
}

function afterSubtests(evaluation: Evaluation): ListaSubtestsState | ResumenState {
  return allSubtestsCompleted(evaluation)
    ? { kind: "resumen", evaluation }
    : { kind: "listaSubtests", evaluation };
}

function initialPhase(evaluation: Evaluation): BienvenidaState | ListaSubtestsState | ResumenState {
  const started = evaluation.attemptId !== null && evaluation.attemptStatus !== "NO_INICIADO";
  return started ? afterSubtests(evaluation) : { kind: "bienvenida", evaluation };
}

function blocked(state: RunnerState, reason: BlockReason): BloqueadoState {
  return { kind: "bloqueado", reason, evaluation: evaluationOf(state) };
}

/** Estado terminal que impone la evaluación (intento anulado/completado o sesión no operable), o null. */
function terminalFromEvaluation(evaluation: Evaluation): BloqueadoState | CompletadaState | null {
  if (evaluation.attemptStatus === "ANULADO") {
    return { kind: "bloqueado", reason: "asignacionNoOperable", evaluation };
  }
  if (evaluation.attemptStatus === "COMPLETADO") return { kind: "completada", evaluation };
  switch (evaluation.sessionStatus) {
    case "CANCELADA":
      return { kind: "bloqueado", reason: "sesionCancelada", evaluation };
    case "CERRADA":
      return { kind: "bloqueado", reason: "sesionCerrada", evaluation };
    case "PROGRAMADA":
      return { kind: "bloqueado", reason: "sesionNoAbierta", evaluation };
    default:
      return null;
  }
}

/** Snapshot fresco del servidor para un subtest EN_PROGRESO, o null si no trae datos de tiempo. */
function freshTiming(subtest: RuntimeSubtest | undefined, clientNow: number): SubtestTiming | null {
  const timing = subtest?.timing;
  if (subtest === undefined || timing === undefined || subtest.status !== "EN_PROGRESO") return null;
  if (timing.remainingSeconds === undefined && timing.startedAt === undefined) return null;
  return buildTiming(timing, subtest.timeLimitSeconds, clientNow);
}

/** Aplica una evaluación nueva a un estado de trabajo, conservando la fase salvo que el servidor la supere. */
function refreshPhase(phase: ResumableState, evaluation: Evaluation, clientNow: number): ResumableState {
  switch (phase.kind) {
    case "bienvenida":
    case "resumen":
    case "finalizando":
      return { ...phase, evaluation };
    case "listaSubtests":
      return afterSubtests(evaluation);
    case "instrucciones": {
      const opened = findSubtest(evaluation, phase.subtestId);
      return opened && isSubtestDone(opened) ? afterSubtests(evaluation) : { ...phase, evaluation };
    }
    case "respondiendo": {
      const subtest = findSubtest(evaluation, phase.subtestId);
      if (subtest && isSubtestDone(subtest)) return afterSubtests(evaluation);
      return { ...phase, evaluation, timing: freshTiming(subtest, clientNow) ?? phase.timing };
    }
    case "finalizandoSubtest": {
      const subtest = findSubtest(evaluation, phase.subtestId);
      // El servidor ya cerró (o anuló) el subtest mientras se finalizaba: no esperar más al cierre local.
      if (subtest && isSubtestDone(subtest)) return afterSubtests(evaluation);
      return { ...phase, evaluation, timing: freshTiming(subtest, clientNow) ?? phase.timing };
    }
  }
}

/** Congela el tiempo y pasa a `pausada`. */
function pause(phase: ResumableState, clientNow: number, pausedAt: string | null): PausadaState {
  const timing = activeTiming(phase);
  return {
    kind: "pausada",
    resumeTo: phase,
    frozenRemainingMs: timing === null ? null : timingRemainingMs(timing, clientNow),
    pausedAt,
  };
}

/** Reanuda: el tiempo congelado se rebasa a `clientNow` (el reloj vuelve a correr desde ahí). */
function resume(paused: PausadaState, clientNow: number): ResumableState {
  const phase = paused.resumeTo;
  if (phase.kind !== "respondiendo" && phase.kind !== "finalizandoSubtest") return phase;
  const rebased: SubtestTiming =
    paused.frozenRemainingMs === null
      ? { ...phase.timing, paused: false, receivedAt: clientNow }
      : {
          ...phase.timing,
          remainingSeconds: paused.frozenRemainingMs / 1000,
          // `serverNow` se conserva: solo certifica que el snapshot nació de un /yo del servidor (el cálculo usa
          // remainingSeconds + el T0 rebasado). Sin él no habría deadline local hasta el próximo /yo.
          paused: false,
          receivedAt: clientNow,
        };
  return { ...phase, timing: rebased };
}

function onEvaluationLoaded(
  state: RunnerState,
  evaluation: Evaluation,
  clientNow: number,
): RunnerState {
  const terminal = terminalFromEvaluation(evaluation);
  if (terminal !== null) return terminal;

  const sessionPaused = evaluation.sessionStatus === "PAUSADA";
  const sessionOpen = evaluation.sessionStatus === "ABIERTA";

  if (state.kind === "validando") {
    const phase = initialPhase(evaluation);
    return sessionPaused ? pause(phase, clientNow, evaluation.pausedAt ?? null) : phase;
  }

  if (state.kind === "pausada") {
    const refreshed = refreshPhase(state.resumeTo, evaluation, clientNow);
    const refreshedTiming = activeTiming(refreshed);
    const serverFrozen =
      refreshedTiming !== null && refreshedTiming.paused ? timingRemainingMs(refreshedTiming, clientNow) : null;
    const stillPaused: PausadaState = {
      kind: "pausada",
      resumeTo: refreshed,
      frozenRemainingMs: serverFrozen ?? state.frozenRemainingMs,
      pausedAt: evaluation.pausedAt ?? state.pausedAt,
    };
    if (!sessionOpen) return stillPaused;
    // Reanudada. Si el servidor mandó timing fresco y corriendo, se usa tal cual (es la autoridad);
    // si no, se rebasa el tiempo congelado a `clientNow`.
    const previousTiming = activeTiming(state.resumeTo);
    if (refreshedTiming !== null && refreshedTiming !== previousTiming && !refreshedTiming.paused) {
      return refreshed;
    }
    return resume(stillPaused, clientNow);
  }

  if (!isResumable(state)) return state;
  const refreshed = refreshPhase(state, evaluation, clientNow);
  return sessionPaused ? pause(refreshed, clientNow, evaluation.pausedAt ?? null) : refreshed;
}

function onServerError(
  state: RunnerState,
  code: RuntimeErrorCode,
  clientNow: number,
  delivered = false,
): RunnerState | null {
  switch (code) {
    case "SESION_PAUSADA":
      return isResumable(state) ? pause(state, clientNow, null) : null;
    case "TIEMPO_AGOTADO":
      return state.kind === "respondiendo" ? toFinishingByTime(state) : null;
    case "SESION_NO_ABIERTA":
      return blocked(state, "sesionNoAbierta");
    case "SESION_FINALIZADA":
      return blocked(state, delivered ? "evaluacionEntregada" : "sesionCerrada");
    case "TOKEN_EXPIRADO":
      return blocked(state, "expirado");
    case "ASIGNACION_NO_OPERABLE":
      return blocked(state, delivered ? "evaluacionEntregada" : "asignacionNoOperable");
    default:
      return assertNever(code);
  }
}

function onSessionStatusChanged(
  state: RunnerState,
  status: SessionStatus,
  clientNow: number,
): RunnerState | null {
  switch (status) {
    case "PAUSADA":
      return isResumable(state) ? pause(state, clientNow, null) : null;
    case "ABIERTA":
      return state.kind === "pausada" ? resume(state, clientNow) : null;
    case "CERRADA":
      return blocked(state, "sesionCerrada");
    case "CANCELADA":
      return blocked(state, "sesionCancelada");
    case "PROGRAMADA":
      return blocked(state, "sesionNoAbierta");
    case "DESCONOCIDO":
      return null;
    default:
      return assertNever(status);
  }
}

function toFinishingByTime(state: RespondiendoState): FinalizandoSubtestState {
  return {
    kind: "finalizandoSubtest",
    evaluation: state.evaluation,
    subtestId: state.subtestId,
    totalItems: state.totalItems,
    timing: state.timing,
    reason: "tiempo",
    returnOrdinal: state.ordinal,
  };
}

function assertNever(value: never): never {
  throw new Error(`Valor no contemplado en la máquina del runner: ${String(value)}`);
}

/** Devuelve el estado siguiente, el mismo objeto `state` (no-op válido) o `null` si el evento es inválido. */
function transition(state: RunnerState, event: RunnerEvent): RunnerState | null {
  if (isTerminal(state)) return null;

  switch (event.type) {
    case "EVALUATION_LOADED":
      return onEvaluationLoaded(state, event.evaluation, event.clientNow);

    case "START_ATTEMPT_OK":
      if (state.kind !== "bienvenida") return null;
      return {
        kind: "listaSubtests",
        evaluation: { ...state.evaluation, attemptId: event.attemptId, attemptStatus: "EN_PROGRESO" },
      };

    case "OPEN_SUBTEST":
      if (state.kind !== "listaSubtests" || !isSubtestOpenable(state.evaluation, event.subtestId)) return null;
      return { kind: "instrucciones", evaluation: state.evaluation, subtestId: event.subtestId };

    case "BACK_TO_LIST":
      return state.kind === "instrucciones"
        ? { kind: "listaSubtests", evaluation: state.evaluation }
        : null;

    case "START_SUBTEST_OK": {
      if (state.kind !== "instrucciones" || state.subtestId !== event.subtestId) return null;
      const subtest = findSubtest(state.evaluation, event.subtestId);
      if (subtest === undefined) return null;
      const totalItems = subtest.items.length;
      const ordinal = event.ordinal ?? 1;
      if (!isValidOrdinal(ordinal, totalItems)) return null;
      const limit = event.timeLimitSeconds !== undefined ? event.timeLimitSeconds : subtest.timeLimitSeconds;
      const evaluation =
        subtest.status === "EN_PROGRESO"
          ? state.evaluation
          : withSubtestStatus(state.evaluation, event.subtestId, "EN_PROGRESO");
      return {
        kind: "respondiendo",
        evaluation,
        subtestId: event.subtestId,
        ordinal,
        totalItems,
        timing: buildTiming(event.timing, limit, event.clientNow),
      };
    }

    case "GO_TO_ITEM":
      if (state.kind !== "respondiendo" || !isValidOrdinal(event.ordinal, state.totalItems)) return null;
      return event.ordinal === state.ordinal ? state : { ...state, ordinal: event.ordinal };

    case "NEXT":
      if (state.kind !== "respondiendo" || state.ordinal >= state.totalItems) return null;
      return { ...state, ordinal: state.ordinal + 1 };

    case "PREV":
      if (state.kind !== "respondiendo" || state.ordinal <= 1) return null;
      return { ...state, ordinal: state.ordinal - 1 };

    case "REQUEST_FINISH_SUBTEST":
      if (state.kind !== "respondiendo") return null;
      return { ...toFinishingByTime(state), reason: "usuario" };

    case "DEADLINE_REACHED": {
      if (state.kind !== "respondiendo" || state.timing.paused) return null;
      // `clientNow` obligatorio: sin un instante monotónico finito la máquina no puede verificar el vencimiento.
      if (typeof event.clientNow !== "number" || !Number.isFinite(event.clientNow)) return null;
      const rem = timingRemainingMs(state.timing, event.clientNow);
      if (rem === null || rem > 0 || !isTimingReferenceValid(state.timing, event.clientNow)) return null;
      return toFinishingByTime(state);
    }

    case "FINISH_SUBTEST_OK": {
      if (state.kind !== "finalizandoSubtest" || state.subtestId !== event.subtestId) return null;
      return afterSubtests(withSubtestStatus(state.evaluation, event.subtestId, "COMPLETADO"));
    }

    case "FINISH_SUBTEST_FAILED": {
      if (
        state.kind !== "finalizandoSubtest" ||
        state.subtestId !== event.subtestId ||
        state.reason !== "usuario"
      ) {
        return null;
      }
      return {
        kind: "respondiendo",
        evaluation: state.evaluation,
        subtestId: state.subtestId,
        ordinal: clampOrdinal(state.returnOrdinal ?? 1, state.totalItems),
        totalItems: state.totalItems,
        timing: state.timing,
      };
    }

    case "REQUEST_FINISH_ATTEMPT":
      return state.kind === "resumen" ? { kind: "finalizando", evaluation: state.evaluation } : null;

    case "FINISH_ATTEMPT_OK":
      return state.kind === "finalizando"
        ? {
            kind: "completada",
            evaluation: { ...state.evaluation, attemptStatus: "COMPLETADO" },
          }
        : null;

    case "FINISH_ATTEMPT_FAILED":
      return state.kind === "finalizando"
        ? { kind: "resumen", evaluation: state.evaluation }
        : null;

    case "SESSION_STATUS_CHANGED":
      return onSessionStatusChanged(state, event.status, event.clientNow);

    case "SERVER_ERROR":
      return onServerError(state, event.code, event.clientNow, event.delivered === true);

    case "ACCESS_REVOKED":
      return blocked(state, "accesoRevocado");

    default:
      return assertNever(event);
  }
}

// ---------------------------------------------------------------------------
// Reducer público
// ---------------------------------------------------------------------------

export type InvalidEventHandler = (state: RunnerState, event: RunnerEvent) => void;

export interface ReduceOptions {
  /** Se invoca cuando el evento no es válido para el estado actual (el reducer devuelve `state`). */
  readonly onInvalid?: InvalidEventHandler;
}

/** Reducer puro. Un evento inválido devuelve el MISMO `state` (referencia idéntica). */
export function reduce(state: RunnerState, event: RunnerEvent, options: ReduceOptions = {}): RunnerState {
  const next = transition(state, event);
  if (next === null) {
    options.onInvalid?.(state, event);
    return state;
  }
  return next;
}

/** Dev warning para eventos inválidos; no hace nada fuera de desarrollo. */
export const devWarnInvalidEvent: InvalidEventHandler = (state, event) => {
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.warn(`[runtime/machine] evento ${event.type} ignorado en estado ${state.kind}`);
  }
};

/** Reducer listo para `useReducer`: `reduce` con dev warning en eventos inválidos. */
export function runnerReducer(state: RunnerState, event: RunnerEvent): RunnerState {
  return reduce(state, event, { onInvalid: devWarnInvalidEvent });
}

// ---------------------------------------------------------------------------
// Constructores de eventos desde las respuestas de los endpoints
// ---------------------------------------------------------------------------

/** Construye `START_SUBTEST_OK` a partir de la respuesta de `startSubtest`. */
export function startSubtestOkEvent(
  subtestId: number,
  attempt: SubtestAttempt,
  clientNow: number,
  ordinal?: number,
): Extract<RunnerEvent, { type: "START_SUBTEST_OK" }> {
  const timing: SubtestTimingInput = {
    ...(attempt.startedAt !== undefined ? { startedAt: attempt.startedAt } : {}),
    ...attempt.timing,
  };
  return {
    type: "START_SUBTEST_OK",
    subtestId,
    timing,
    clientNow,
    ...(attempt.timeLimitSeconds !== undefined ? { timeLimitSeconds: attempt.timeLimitSeconds } : {}),
    ...(ordinal !== undefined ? { ordinal } : {}),
  };
}
