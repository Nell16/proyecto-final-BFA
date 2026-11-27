import { ApiError } from "../../../api/errors";
import { useParticipantAuth } from "../../../store/participantAuth";
import { toSaveAnswerRequest, type AnswerValue } from "../answer-value";
import { computeBackoffMs } from "./backoff";
import {
  classifyError,
  isDefinitiveCode,
  SESION_PAUSADA,
  SUBTEST_NO_INICIADO,
  type FailureClass,
} from "./classify";
import { getOwnerToken, useRuntimeDraft } from "./store";
import { postBulk, putAnswer, type BulkItemResult } from "./transport";
import type {
  BindResult,
  DraftOwner,
  DraftOwnerToken,
  FlushResult,
  RejectedAnswerEntry,
  UnconfirmedAnswerEntry,
} from "./types";

// ---------------------------------------------------------------------------
// Configuración (inyectable para tests)
// ---------------------------------------------------------------------------

export interface DraftSyncConfig {
  /** Primer retraso del backoff (ms). */
  baseDelayMs: number;
  /** Techo del backoff (ms). */
  maxDelayMs: number;
  /** Reintentos automáticos seguidos antes de rendirse hasta el próximo disparador manual. */
  maxAutoAttempts: number;
  /** Intervalo fijo (lento) con el que se sondea una sesión pausada (ms). */
  pausedProbeMs: number;
  /** `SUBTEST_NO_INICIADO` toleradas por versión antes de pasarla a `rejectedAnswers`. */
  notStartedMaxAttempts: number;
  /** Máximo de respuestas por bulk-sync (el backend admite 1000 / 2 MB). */
  bulkChunkSize: number;
  random: () => number;
  now: () => number;
}

const DEFAULT_CONFIG: DraftSyncConfig = {
  baseDelayMs: 1_000,
  maxDelayMs: 30_000,
  maxAutoAttempts: 8,
  pausedProbeMs: 15_000,
  notStartedMaxAttempts: 5,
  bulkChunkSize: 100,
  random: Math.random,
  now: Date.now,
};

let config: DraftSyncConfig = { ...DEFAULT_CONFIG };

export function configureDraftSync(partial: Partial<DraftSyncConfig>): void {
  config = { ...config, ...partial };
}

// ---------------------------------------------------------------------------
// Propiedad del estado: respuestas tardías
// ---------------------------------------------------------------------------

/** Código de `ApiError` con que se rechaza una operación que terminó cuando ya hay otro dueño. */
export const STALE_PARTICIPANT = "STALE_PARTICIPANT";

const staleError = (): ApiError =>
  new ApiError({
    status: 0,
    code: STALE_PARTICIPANT,
    message: "La respuesta pertenece a un participante o intento anterior y se descartó.",
  });

export const isStaleParticipantError = (error: unknown): boolean =>
  error instanceof ApiError && error.code === STALE_PARTICIPANT;

/**
 * ¿Sigue siendo el dueño capturado? Mismo `epoch` (nadie re-enlazó ni limpió) y, además, la sesión de
 * participante sigue siendo la de esa asignación: el token que viaja en la petición es el de `participantAuth`.
 */
function isCurrent(token: DraftOwnerToken): boolean {
  const current = getOwnerToken();
  if (!current || current.epoch !== token.epoch) return false;
  const authAssignment = useParticipantAuth.getState().assignmentId;
  return authAssignment === null || authAssignment === token.assignmentId;
}

/** Lanza `STALE_PARTICIPANT` si el dueño cambió. Se llama tras cada `await`, ANTES de escribir. */
function assertCurrent(token: DraftOwnerToken): void {
  if (!isCurrent(token)) throw staleError();
}

const isBrowserOnline = (): boolean => typeof navigator === "undefined" || navigator.onLine !== false;

// ---------------------------------------------------------------------------
// Estado del motor (en memoria, no persistido)
// ---------------------------------------------------------------------------

const putKey = (token: DraftOwnerToken, itemId: number): string => `${token.epoch}:${itemId}`;

/** PUT directos en vuelo por ítem. Una versión posterior del mismo ítem espera a que terminen. */
const inFlightPuts = new Map<string, Promise<void>>();
/** Ítems incluidos en un bulk-sync en vuelo (siguen en la cola hasta confirmarse). */
const inFlightBulk = new Set<string>();

let inFlightSync: Promise<void> | null = null;
let nextSync: Promise<void> | null = null;
let nextForce = false;

let timer: ReturnType<typeof setTimeout> | null = null;
let retryAttempt = 0;

function cancelTimer(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
}

/** Reintento con backoff exponencial + jitter, acotado por `maxAutoAttempts`. No-op si ya hay uno agendado. */
function scheduleRetry(token: DraftOwnerToken): void {
  if (timer !== null) return;
  if (retryAttempt >= config.maxAutoAttempts) return; // rendido: solo un disparador manual lo reanuda
  const delay = computeBackoffMs(retryAttempt, config);
  retryAttempt += 1;
  timer = setTimeout(() => {
    timer = null;
    if (!isCurrent(token)) return;
    // Sin red del navegador no se intenta: el evento `online` dispara el flush.
    if (!isBrowserOnline()) return;
    void flush({ force: true });
  }, delay);
}

/** Sondeo lento (intervalo fijo, sin crecer ni agotarse) mientras la sesión está pausada. */
function scheduleProbe(token: DraftOwnerToken): void {
  cancelTimer();
  timer = setTimeout(() => {
    timer = null;
    if (!isCurrent(token)) return;
    void flush({ force: true });
  }, config.pausedProbeMs);
}

// ---------------------------------------------------------------------------
// Instantáneas de la cola
// ---------------------------------------------------------------------------

interface Snapshot {
  itemId: number;
  version: number;
  value: AnswerValue;
  timeUsedSeconds?: number;
  subtestId?: number;
}

function snapshotQueue(): Snapshot[] {
  const { queue, answers } = useRuntimeDraft.getState();
  const snapshots: Snapshot[] = [];
  for (const entry of queue) {
    const answer = answers[entry.itemId];
    if (!answer || answer.version !== entry.version) continue;
    snapshots.push({
      itemId: entry.itemId,
      version: entry.version,
      value: answer.value,
      ...(answer.timeUsedSeconds !== undefined ? { timeUsedSeconds: answer.timeUsedSeconds } : {}),
      ...(entry.subtestId !== undefined ? { subtestId: entry.subtestId } : {}),
    });
  }
  return snapshots;
}

const snapshotItem = (itemId: number): Snapshot | null =>
  snapshotQueue().find((snap) => snap.itemId === itemId) ?? null;

const toRequest = (snap: Snapshot) => toSaveAnswerRequest(snap.itemId, snap.value, snap.timeUsedSeconds);

// ---------------------------------------------------------------------------
// Aplicación de resultados (siempre con el token: sin escrituras tardías)
// ---------------------------------------------------------------------------

type ItemOutcome = "saved" | "rejected" | "keep" | "halt";

function markReachable(token: DraftOwnerToken): void {
  const store = useRuntimeDraft.getState();
  store.setOffline(token, false);
  store.setSyncBlock(token, null);
}

function markSaved(token: DraftOwnerToken, snap: Snapshot): void {
  const store = useRuntimeDraft.getState();
  store.commitSaved(token, snap.itemId, snap.version, config.now());
  markReachable(token);
  retryAttempt = 0;
}

/** Fallos de transporte, pausa o bloqueo: valen para el ítem y para el lote entero. Devuelve `true` si lo atendió. */
function applyHold(token: DraftOwnerToken, failure: FailureClass): boolean {
  const store = useRuntimeDraft.getState();
  switch (failure.kind) {
    case "retry":
      store.setOffline(token, true);
      scheduleRetry(token);
      return true;
    case "paused":
      store.setOffline(token, false);
      store.setSyncBlock(token, { code: SESION_PAUSADA, since: config.now() });
      scheduleProbe(token);
      return true;
    case "blocked":
      store.setOffline(token, false);
      store.setSyncBlock(token, { code: failure.code, since: config.now() });
      cancelTimer();
      return true;
    default:
      return false;
  }
}

/** `SUBTEST_NO_INICIADO`: transitorio, pero con reintentos acotados por versión. */
function handleNotStarted(token: DraftOwnerToken, snap: Snapshot): ItemOutcome {
  const store = useRuntimeDraft.getState();
  const total = store.bumpNotStarted(token, snap.itemId, snap.version);
  if (total === null) return "keep";
  if (total >= config.notStartedMaxAttempts) {
    store.rejectAnswer(token, snap.itemId, snap.version, SUBTEST_NO_INICIADO);
    return "rejected";
  }
  scheduleRetry(token);
  return "keep";
}

function onItemFailure(token: DraftOwnerToken, snap: Snapshot, error: unknown): ItemOutcome {
  const failure = classifyError(error, "item");
  if (!isCurrent(token)) return "halt";
  if (applyHold(token, failure)) return "halt";
  const store = useRuntimeDraft.getState();
  switch (failure.kind) {
    case "definitive":
      markReachable(token);
      store.rejectAnswer(token, snap.itemId, snap.version, failure.code);
      return "rejected";
    case "not-started":
      markReachable(token);
      return handleNotStarted(token, snap);
    default:
      // 4xx desconocido: el servidor responde, pero no se entiende. Se conserva y se reintenta (acotado).
      markReachable(token);
      scheduleRetry(token);
      return "keep";
  }
}

/** Resultado por ítem de un bulk-sync que respondió 200. */
function onBulkItemResult(token: DraftOwnerToken, snap: Snapshot, result: BulkItemResult | undefined): ItemOutcome {
  const store = useRuntimeDraft.getState();
  if (!result) {
    scheduleRetry(token); // sin confirmación: se conserva
    return "keep";
  }
  if (result.status === "GUARDADA") {
    markSaved(token, snap);
    return "saved";
  }
  if (result.status === "RECHAZADA") {
    if (isDefinitiveCode(result.code)) {
      store.rejectAnswer(token, snap.itemId, snap.version, result.code);
      return "rejected";
    }
    if (result.code === SUBTEST_NO_INICIADO) return handleNotStarted(token, snap);
  }
  // Código desconocido o estado inesperado: transitorio (nunca se descarta lo que no se entiende).
  scheduleRetry(token);
  return "keep";
}

// ---------------------------------------------------------------------------
// Envío
// ---------------------------------------------------------------------------

/** PUT de una versión concreta. Nunca rechaza. */
async function sendViaPut(token: DraftOwnerToken, snap: Snapshot): Promise<ItemOutcome> {
  try {
    await putAnswer(token.attemptId, toRequest(snap));
  } catch (error) {
    return onItemFailure(token, snap, error);
  }
  if (!isCurrent(token)) return "halt"; // confirmación tardía de otro dueño: no se escribe nada
  markSaved(token, snap);
  return "saved";
}

/** Un bulk-sync entero falló. Transporte/pausa/bloqueo → retener; otro 4xx → aislar ítem por ítem. */
async function onBatchFailure(token: DraftOwnerToken, chunk: Snapshot[], error: unknown): Promise<"halt" | "done"> {
  const failure = classifyError(error, "batch");
  if (!isCurrent(token)) return "halt";
  if (applyHold(token, failure)) return "halt";

  // 4xx del lote (400/404/413/422, 409 por ítem…): el servidor es alcanzable, así que NO queda offline.
  // Se reenvía ítem por ítem para que cada uno reciba su propio veredicto y uno malo no bloquee a los demás.
  markReachable(token);
  for (const snap of chunk) {
    const key = putKey(token, snap.itemId);
    if (inFlightPuts.has(key)) continue; // lo resolverá ese PUT
    // Una versión más nueva pudo encolarse mientras tanto: se relee y se envía SOLO la vigente.
    const latest = snapshotItem(snap.itemId);
    if (!latest) continue;
    const outcome = await sendViaPut(token, latest);
    if (outcome === "halt") return "halt";
  }
  return "done";
}

/** Serializa los envíos: nunca hay dos bulk-sync a la vez. Como máximo uno en vuelo y uno en espera. */
function runSerializedSync(force: boolean): Promise<void> {
  if (inFlightSync === null) {
    const run: Promise<void> = syncOnce(force).finally(() => {
      if (inFlightSync === run) inFlightSync = null;
    });
    inFlightSync = run;
    return run;
  }
  if (force) nextForce = true;
  if (nextSync === null) {
    nextSync = inFlightSync
      .catch(() => undefined)
      .then(() => {
        nextSync = null;
        const forced = nextForce;
        nextForce = false;
        return runSerializedSync(forced);
      });
  }
  return nextSync;
}

/**
 * Envía la cola en lotes. Los ítems a enviar se fijan al empezar la pasada, pero NUNCA su contenido: cada lote
 * se arma en el instante de enviarlo releyendo la cola vigente del store, de modo que solo viaja la última
 * versión de cada ítem (una respuesta que un PUT ya confirmó mientras corría el lote anterior no puede ser
 * pisada por una versión vieja: ya no está en la cola y se omite). Los ítems con un PUT en vuelo se omiten (y
 * se anotan en `waits`): jamás hay dos escrituras del mismo `itemId` en vuelo. Cada lote se arma y se marca
 * en vuelo de forma síncrona, sin `await` entre medias, para que ningún PUT se cuele entre la relectura y el
 * envío. Lo que se encole después de empezar la pasada lo envía su propio `setAnswer`/`flush`.
 */
async function sendQueuedChunks(token: DraftOwnerToken, waits: Map<string, Promise<void>>): Promise<void> {
  const itemIds = snapshotQueue().map((snap) => snap.itemId);
  let cursor = 0;
  while (cursor < itemIds.length) {
    if (!isCurrent(token)) return;
    const live = new Map(snapshotQueue().map((snap) => [snap.itemId, snap] as const));
    const chunk: Snapshot[] = [];
    while (cursor < itemIds.length && chunk.length < config.bulkChunkSize) {
      const itemId = itemIds[cursor];
      cursor += 1;
      const snap = itemId === undefined ? undefined : live.get(itemId);
      if (!snap) continue; // ya confirmado, rechazado o retirado desde que empezó la pasada
      const key = putKey(token, snap.itemId);
      const put = inFlightPuts.get(key);
      if (put) {
        waits.set(key, put);
        continue;
      }
      chunk.push(snap);
    }
    if (chunk.length === 0) continue;

    const keys = chunk.map((snap) => putKey(token, snap.itemId));
    for (const key of keys) inFlightBulk.add(key);
    try {
      let results: Map<number, BulkItemResult>;
      try {
        results = await postBulk(token.attemptId, chunk.map(toRequest));
      } catch (error) {
        if ((await onBatchFailure(token, chunk, error)) === "halt") return;
        continue;
      }
      if (!isCurrent(token)) return; // la respuesta es de otro dueño: no se toca el store
      markReachable(token); // el backend respondió: hay conexión aunque queden pendientes
      for (const snap of chunk) onBulkItemResult(token, snap, results.get(snap.itemId));
    } finally {
      for (const key of keys) inFlightBulk.delete(key);
    }
  }
}

/**
 * Un envío de la cola. Nunca rechaza. Sin `force` respeta `isOffline` y las retenciones (los temporizadores
 * y disparadores manuales ya se encargan); con `force` (online, visibilidad, timer, antes de finalizar) intenta igual.
 */
async function syncOnce(force: boolean): Promise<void> {
  const token = getOwnerToken();
  if (!token || !isCurrent(token)) return;
  const store = useRuntimeDraft.getState();

  if (store.queue.length === 0) {
    store.setOffline(token, false);
    cancelTimer();
    retryAttempt = 0;
    return;
  }
  if (!force && (store.isOffline || store.syncBlock)) return;

  // Un ítem con PUT directo en vuelo se deja en la cola: si el POST guardara antes que el PUT, la selección
  // vieja del PUT ganaría. Se reintenta cuando ese PUT termine.
  const waits = new Map<string, Promise<void>>();
  await sendQueuedChunks(token, waits);
  if (waits.size > 0) void Promise.all(waits.values()).then(() => flush({ force: false }));

  if (isCurrent(token) && useRuntimeDraft.getState().queue.length === 0) {
    cancelTimer();
    retryAttempt = 0;
  }
}

/** Vacía la cola en lote (bulk-sync). Serializado y compartido: nunca rechaza. */
export function flush(options: { force?: boolean } = {}): Promise<void> {
  return runSerializedSync(options.force ?? false);
}

async function sendItem(itemId: number): Promise<void> {
  const token = getOwnerToken();
  if (!token || !isCurrent(token)) return;
  const store = useRuntimeDraft.getState();

  if (store.syncBlock) {
    if (store.syncBlock.code === SESION_PAUSADA && timer === null) scheduleProbe(token);
    return; // retenida: la respuesta queda en cola
  }
  if (!isBrowserOnline()) {
    store.setOffline(token, true); // sin timers: el evento `online` dispara el flush
    return;
  }
  if (store.isOffline) {
    if (timer === null) {
      retryAttempt = 0; // una respuesta nueva reinicia el calendario de reintentos
      scheduleRetry(token);
    }
    return;
  }

  // Orden por ítem: si hay un PUT o un bulk-sync en vuelo con este ítem, un PUT directo podría adelantarse y
  // luego ser pisado por la versión vieja. La nueva versión ya reemplazó a la anterior en la cola y sale por
  // el envío serializado, después del que está en vuelo.
  const key = putKey(token, itemId);
  const prior = inFlightPuts.get(key);
  if (prior || inFlightBulk.has(key)) {
    if (prior) await prior;
    await flush({ force: false });
    return;
  }

  const direct = (async (): Promise<void> => {
    const snap = snapshotItem(itemId);
    if (!snap) return;
    await sendViaPut(token, snap);
  })();
  inFlightPuts.set(key, direct);
  try {
    await direct;
  } finally {
    if (inFlightPuts.get(key) === direct) inFlightPuts.delete(key);
  }
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

/** Opciones de `setAnswer`. */
export interface SetAnswerOptions {
  /**
   * Retraso (ms) SOLO del envío por red. El estado local (draft + cola, con su `itemId`) se registra siempre al
   * instante; el timer se limita a agrupar ráfagas de cambios del mismo ítem (p. ej. texto abierto mientras se
   * escribe) en un único envío de la versión vigente. Cualquier flush (finalizar, reanudar, online…) lo adelanta.
   */
  debounceMs?: number;
  /**
   * Intento de origen de la respuesta. Si el draft ya pertenece a otro intento, la respuesta se descarta
   * (`STALE_PARTICIPANT`) en vez de caer en el estado del dueño nuevo.
   */
  attemptId?: number;
}

interface PendingSend {
  timer: ReturnType<typeof setTimeout>;
  resolvers: Array<() => void>;
}

/** Envíos por red diferidos (debounce), por ítem. El contenido ya está en la cola: aquí solo vive el timer. */
const pendingSends = new Map<string, PendingSend>();

/** Cancela los timers de envío diferido. Lo local ya está en la cola: lo envía el flush que los adelanta. */
function releasePendingSends(): void {
  for (const pending of pendingSends.values()) {
    clearTimeout(pending.timer);
    for (const resolve of pending.resolvers) resolve();
  }
  pendingSends.clear();
}

function scheduleDebouncedSend(token: DraftOwnerToken, itemId: number, delayMs: number): Promise<void> {
  const key = putKey(token, itemId);
  return new Promise<void>((resolve) => {
    const previous = pendingSends.get(key);
    if (previous) clearTimeout(previous.timer);
    const resolvers = [...(previous?.resolvers ?? []), resolve];
    const timer = setTimeout(() => {
      pendingSends.delete(key);
      const settle = (): void => {
        for (const done of resolvers) done();
      };
      if (!isCurrent(token)) {
        settle();
        return;
      }
      void sendItem(itemId).finally(settle); // sendItem relee la versión vigente del store
    }, delayMs);
    pendingSends.set(key, { timer, resolvers });
  });
}

/**
 * Registra la respuesta: estado local inmediato (optimista), versión nueva, cola y envío (PUT individual).
 * Resuelve cuando el intento de envío terminó (puede quedar en cola si no hay red); nunca rechaza por red.
 * Lanza si no hay dueño enlazado (`bindDraftOwner`). Rechaza con `STALE_PARTICIPANT` si `options.attemptId`
 * ya no es el del draft.
 */
export function setAnswer(
  itemId: number,
  value: AnswerValue,
  timeUsedSeconds?: number,
  subtestId?: number,
  options: SetAnswerOptions = {},
): Promise<void> {
  const store = useRuntimeDraft.getState();
  if (options.attemptId !== undefined && store.owner !== null && store.owner.attemptId !== options.attemptId) {
    return Promise.reject(staleError());
  }
  const version = store.setAnswerLocal(itemId, value, timeUsedSeconds, subtestId);
  if (version === null) {
    throw new Error("runtimeDraft: no hay un dueño enlazado. Llame a bindDraftOwner() antes de responder.");
  }
  const token = getOwnerToken();
  if (token && (options.debounceMs ?? 0) > 0) return scheduleDebouncedSend(token, itemId, options.debounceMs as number);
  const sending = sendItem(itemId);
  // Un envío inmediato sustituye a uno diferido del mismo ítem (la versión vigente ya sale ahora).
  const key = token ? putKey(token, itemId) : null;
  const deferred = key === null ? undefined : pendingSends.get(key);
  if (key !== null && deferred) {
    clearTimeout(deferred.timer);
    pendingSends.delete(key);
    void sending.finally(() => {
      for (const resolve of deferred.resolvers) resolve();
    });
  }
  return sending;
}

const inSubtest = (entrySubtestId: number | undefined, subtestId: number): boolean =>
  entrySubtestId === undefined || entrySubtestId === subtestId;

function pendingFor(subtestId: number): number[] {
  return useRuntimeDraft
    .getState()
    .queue.filter((entry) => inSubtest(entry.subtestId, subtestId))
    .map((entry) => entry.itemId);
}

function rejectedFor(subtestId: number): RejectedAnswerEntry[] {
  const { rejectedAnswers } = useRuntimeDraft.getState();
  return Object.entries(rejectedAnswers)
    .filter(([, rejected]) => inSubtest(rejected.subtestId, subtestId))
    .map(([itemId, rejected]) => ({ itemId: Number(itemId), ...rejected }));
}

async function awaitInFlightPuts(token: DraftOwnerToken): Promise<void> {
  const prefix = `${token.epoch}:`;
  const waits = [...inFlightPuts].filter(([key]) => key.startsWith(prefix)).map(([, promise]) => promise);
  if (waits.length > 0) await Promise.all(waits);
}

/**
 * Vacía la cola de ese subtest antes de finalizarlo (intento final, ignora `isOffline` y reinicia el backoff).
 * No bloquea con alert: devuelve el estado y el runner decide.
 * - `ok`: no queda nada pendiente ni rechazado en el subtest.
 * - `pending`: `itemId` sin confirmar (sin red, pausa, 5xx…).
 * - `rejected`: respuestas que el backend rechazó de forma definitiva.
 * Rechaza con `STALE_PARTICIPANT` si el dueño cambió mientras tanto (el runner debe ignorarlo).
 */
export async function flushBeforeFinish(subtestId: number, options: { maxRounds?: number } = {}): Promise<FlushResult> {
  const token = getOwnerToken();
  if (!token) return { ok: true, pending: [], rejected: [] };
  assertCurrent(token);

  releasePendingSends(); // lo diferido ya está en la cola: sale en este flush
  cancelTimer();
  retryAttempt = 0;
  const rounds = Math.max(1, options.maxRounds ?? 3);
  for (let round = 0; round < rounds; round += 1) {
    await awaitInFlightPuts(token);
    assertCurrent(token);
    if (pendingFor(subtestId).length === 0) break;
    await flush({ force: true });
    assertCurrent(token);
    const { isOffline, syncBlock } = useRuntimeDraft.getState();
    if (isOffline || syncBlock) break; // reintentar en caliente no ayuda
  }
  await awaitInFlightPuts(token);
  assertCurrent(token);

  const pending = pendingFor(subtestId);
  const rejected = rejectedFor(subtestId);
  return { ok: pending.length === 0 && rejected.length === 0, pending, rejected };
}

/**
 * Vacía TODA la cola pendiente del participante antes de finalizar el intento definitivo.
 * Devuelve el estado resultante (no descarta respuestas pendientes ni rechazos).
 */
export async function flushAllBeforeFinish(options: { maxRounds?: number } = {}): Promise<FlushResult> {
  const token = getOwnerToken();
  if (!token) return { ok: true, pending: [], rejected: [] };
  assertCurrent(token);

  releasePendingSends();
  cancelTimer();
  retryAttempt = 0;
  const rounds = Math.max(1, options.maxRounds ?? 3);
  for (let round = 0; round < rounds; round += 1) {
    await awaitInFlightPuts(token);
    assertCurrent(token);
    if (useRuntimeDraft.getState().queue.length === 0) break;
    await flush({ force: true });
    assertCurrent(token);
    const { isOffline, syncBlock } = useRuntimeDraft.getState();
    if (isOffline || syncBlock) break;
  }
  await awaitInFlightPuts(token);
  assertCurrent(token);

  const { queue, rejectedAnswers } = useRuntimeDraft.getState();
  const pending = queue.map((entry) => entry.itemId);
  const rejected: RejectedAnswerEntry[] = Object.entries(rejectedAnswers).map(([itemId, entry]) => ({
    itemId: Number(itemId),
    ...entry,
  }));
  return { ok: pending.length === 0 && rejected.length === 0, pending, rejected };
}

/**
 * Cuando el tiempo límite obliga a cerrar el subtest y quedaron respuestas sin confirmar,
 * las traslada de `queue` a `unconfirmedAnswers` para conservarlas y exponerlas al participante.
 */
export function markSubtestPendingUnconfirmed(
  subtestId: number,
  itemIds?: readonly number[],
): UnconfirmedAnswerEntry[] {
  const token = getOwnerToken();
  if (!token || !isCurrent(token)) return [];
  const targetIds = itemIds ?? pendingFor(subtestId);
  if (targetIds.length === 0) return [];
  const targetSet = new Set(targetIds);
  const applied = useRuntimeDraft.getState().recordUnconfirmedOnTimeout(token, subtestId, targetIds);
  if (!applied) return [];
  const { unconfirmedAnswers } = useRuntimeDraft.getState();
  return Object.entries(unconfirmedAnswers)
    .filter(([id]) => targetSet.has(Number(id)))
    .map(([id, entry]) => ({ itemId: Number(id), ...entry }))
    .sort((a, b) => a.recordedAt - b.recordedAt || a.itemId - b.itemId);
}

/** Reanuda la sincronización retenida (p. ej. la sesión dejó de estar pausada) y vacía la cola. */
export async function resumeSync(): Promise<void> {
  const token = getOwnerToken();
  if (!token || !isCurrent(token)) return;
  const store = useRuntimeDraft.getState();
  store.setSyncBlock(token, null);
  releasePendingSends();
  cancelTimer();
  retryAttempt = 0;
  if (store.queue.length > 0) await flush({ force: true });
}

function onTrigger(): void {
  const token = getOwnerToken();
  if (!token || !isCurrent(token)) return;
  if (useRuntimeDraft.getState().queue.length === 0) return;
  releasePendingSends();
  cancelTimer();
  retryAttempt = 0;
  void flush({ force: true });
}

/**
 * Nuevo canje de la MISMA asignación (el JWT de `participantAuth` cambió): las peticiones del JWT anterior que
 * sigan en vuelo dejan de ser válidas (nuevo `epoch`), se limpia la retención (p. ej. `UNAUTHORIZED`) y el estado
 * offline, y la cola del mismo intento se conserva. No envía nada: el runner reanuda (`resumeSync`) tras validar
 * el acceso con `/yo`. Con otra asignación no hace nada: `bindDraftOwner` descartará el estado ajeno.
 */
function onParticipantAuthChanged(
  state: { token: string | null; assignmentId: number | null },
  prev: { token: string | null },
): void {
  if (state.token === prev.token || state.token === null) return;
  const { owner, renewSession } = useRuntimeDraft.getState();
  if (!owner || owner.assignmentId !== state.assignmentId) return;
  renewSession();
  resetEngineState();
}

let removeListeners: (() => void) | null = null;

/** Escucha `online` y `visibilitychange` (visible) para vaciar la cola. Idempotente; devuelve cómo quitarlos. */
export function startDraftSyncListeners(): () => void {
  if (removeListeners) return removeListeners;
  if (typeof window === "undefined" || typeof document === "undefined") return () => undefined;
  const onVisibility = (): void => {
    if (document.visibilityState === "visible") onTrigger();
  };
  window.addEventListener("online", onTrigger);
  document.addEventListener("visibilitychange", onVisibility);
  const unsubscribeAuth = useParticipantAuth.subscribe(onParticipantAuthChanged);
  removeListeners = () => {
    window.removeEventListener("online", onTrigger);
    document.removeEventListener("visibilitychange", onVisibility);
    unsubscribeAuth();
    removeListeners = null;
  };
  return removeListeners;
}

function resetEngineState(): void {
  releasePendingSends();
  cancelTimer();
  retryAttempt = 0;
  nextForce = false;
}

/**
 * Enlaza el draft a la asignación e intento del runner (llamar cuando se conoce el `attemptId`). Si el dueño
 * cambia: descarta el estado anterior (ver `discardNotice`), restaura el guardado en sessionStorage si es el
 * mismo dueño tras una recarga, activa los listeners y, si quedó cola, la envía.
 */
export function bindDraftOwner(owner: DraftOwner): BindResult {
  const result = useRuntimeDraft.getState().bindOwner(owner);
  if (!result.changed) return result;
  resetEngineState();
  startDraftSyncListeners();
  if (useRuntimeDraft.getState().queue.length > 0) void flush({ force: true });
  return result;
}

/** Completar el intento o cerrar la sesión: limpia el estado, su copia en sessionStorage, timers y listeners. */
export function clearRuntimeDraft(): void {
  useRuntimeDraft.getState().clearDraft();
  resetEngineState();
  removeListeners?.();
}

/** Solo para tests: restablece configuración, timers, listeners y el seguimiento de envíos en vuelo. */
export function resetDraftSyncForTests(): void {
  config = { ...DEFAULT_CONFIG };
  resetEngineState();
  removeListeners?.();
  inFlightPuts.clear();
  inFlightBulk.clear();
  inFlightSync = null;
  nextSync = null;
}
