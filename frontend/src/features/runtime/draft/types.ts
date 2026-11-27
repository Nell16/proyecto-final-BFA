import type { AnswerValue } from "../answer-value";

/** Dueño del draft: la asignación y el intento a los que pertenece todo el estado. */
export interface DraftOwner {
  assignmentId: number;
  attemptId: number;
}

/**
 * Dueño + `epoch` interno (se incrementa en cada cambio de dueño o limpieza). Es lo que capturan las
 * operaciones asíncronas para verificar, tras cada `await`, que siguen escribiendo en el mismo estado
 * (incluso si se vuelve a enlazar la misma asignación e intento).
 */
export interface DraftOwnerToken extends DraftOwner {
  epoch: number;
}

/** Respuesta local (optimista) de un ítem. `version` sube en cada cambio. */
export interface DraftAnswer {
  value: AnswerValue;
  version: number;
  /** `Date.now()` del último cambio local. */
  updatedAt: number;
  timeUsedSeconds?: number;
}

/**
 * Entrada de la cola de sincronización. Idempotente por `itemId`: solo existe la última versión.
 * El contenido vive en `answers[itemId]` (la versión de la entrada siempre coincide con la de la respuesta).
 */
export interface QueueEntry {
  itemId: number;
  version: number;
  /** Subtest del ítem (para `flushBeforeFinish`). Sin él, la entrada cuenta para cualquier subtest. */
  subtestId?: number;
  /** Veces que el backend respondió `SUBTEST_NO_INICIADO` para esta versión (reintento acotado). */
  notStartedAttempts: number;
}

/** Respuesta rechazada de forma definitiva: fuera de la cola, visible para el participante y el monitor. */
export interface RejectedAnswer {
  /** Código del backend (`SUBTEST_FINALIZADO`, `TIEMPO_AGOTADO`, …). */
  code: string;
  value: AnswerValue;
  version: number;
  subtestId?: number;
  /** `Date.now()` del rechazo. */
  rejectedAt: number;
}

export type RejectedAnswerEntry = RejectedAnswer & { itemId: number };

/**
 * Respuesta local que seguía pendiente en la cola cuando un subtest se cerró por tiempo
 * agotado y la sincronización seguía fallando. Se preserva para mostrarla al participante.
 */
export interface UnconfirmedAnswer {
  value: AnswerValue;
  version: number;
  subtestId: number;
  recordedAt: number;
}

export type UnconfirmedAnswerEntry = UnconfirmedAnswer & { itemId: number };

/**
 * La sincronización está retenida por una causa que no es de red: la cola se conserva intacta.
 * - `SESION_PAUSADA`: se sondea despacio y se reanuda con `resumeSync()` o al volver a abrirse la sesión.
 * - Cualquier otro código (`SESION_NO_ABIERTA`, `TOKEN_EXPIRADO`, `UNAUTHORIZED`…): no hay reintento
 *   automático; solo `resumeSync()`, `online`/`visibilitychange` o `flushBeforeFinish` lo vuelven a intentar.
 */
export interface SyncBlock {
  code: string;
  /** `Date.now()` en que se detectó. */
  since: number;
}

/** Aviso de que se descartó la cola de otro participante/intento (§7b F2). */
export interface DiscardNotice {
  /** Respuestas pendientes que se perdieron. */
  count: number;
  /** Asignación a la que pertenecían, si se conoce. */
  previousAssignmentId: number | null;
  at: number;
}

export interface BindResult {
  /** `false` si el dueño ya era ese (no se tocó nada). */
  changed: boolean;
  /** Se restauró el draft guardado en sessionStorage (recarga de la pestaña). */
  restored: boolean;
  /** Respuestas pendientes descartadas por pertenecer a otro dueño. */
  discardedPending: number;
}

export interface FlushResult {
  /** `true` si no queda nada pendiente ni rechazado en ese subtest. */
  ok: boolean;
  /** `itemId` de las respuestas del subtest que siguen en la cola (sin confirmar). */
  pending: number[];
  /** Respuestas del subtest rechazadas de forma definitiva. */
  rejected: RejectedAnswerEntry[];
}

export interface SyncStatus {
  /** Respuestas en cola, sin confirmar. */
  pending: number;
  isOffline: boolean;
  rejectedCount: number;
  /** `Date.now()` de la última confirmación del servidor, o `null`. */
  lastSyncAt: number | null;
  /** Atajo de `blockedCode === "SESION_PAUSADA"`. */
  isPaused: boolean;
  /** Código de la retención activa (ver `SyncBlock`), o `null`. */
  blockedCode: string | null;
}
