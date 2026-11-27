import { create } from "zustand";
import { z } from "zod";
import type { AnswerValue } from "../answer-value";
import type {
  BindResult,
  DiscardNotice,
  DraftAnswer,
  DraftOwner,
  DraftOwnerToken,
  QueueEntry,
  RejectedAnswer,
  SyncBlock,
  UnconfirmedAnswer,
} from "./types";

// ---------------------------------------------------------------------------
// Persistencia: sessionStorage (nunca localStorage), una clave por asignación.
// Solo se guardan ids, respuestas y cola. Jamás tokens.
// ---------------------------------------------------------------------------

export const DRAFT_STORAGE_PREFIX = "bfa-runtime-draft:";
const STORAGE_VERSION = 1;

export const draftStorageKey = (assignmentId: number): string => `${DRAFT_STORAGE_PREFIX}${assignmentId}`;

const AnswerValueSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("OPCION_UNICA"), optionId: z.number().nullable() }),
  z.object({ kind: z.literal("VERDADERO_FALSO"), optionId: z.number().nullable() }),
  z.object({ kind: z.literal("OPCION_MULTIPLE"), optionIds: z.array(z.number()) }),
  z.object({ kind: z.literal("TEXTO_ABIERTO"), text: z.string() }),
  z.object({ kind: z.literal("NUMERICA"), value: z.number().nullable() }),
]);

const DraftAnswerSchema = z.object({
  value: AnswerValueSchema,
  version: z.number().int(),
  updatedAt: z.number(),
  timeUsedSeconds: z.number().optional(),
});

const QueueEntrySchema = z.object({
  itemId: z.number().int(),
  version: z.number().int(),
  subtestId: z.number().int().optional(),
  notStartedAttempts: z.number().int(),
});

const RejectedAnswerSchema = z.object({
  code: z.string(),
  value: AnswerValueSchema,
  version: z.number().int(),
  subtestId: z.number().int().optional(),
  rejectedAt: z.number(),
});

const UnconfirmedAnswerSchema = z.object({
  value: AnswerValueSchema,
  version: z.number().int(),
  subtestId: z.number().int(),
  recordedAt: z.number(),
});

const PersistedDraftSchema = z.object({
  v: z.literal(STORAGE_VERSION),
  owner: z.object({ assignmentId: z.number().int(), attemptId: z.number().int() }),
  answers: z.record(z.string(), DraftAnswerSchema),
  queue: z.array(QueueEntrySchema),
  rejectedAnswers: z.record(z.string(), RejectedAnswerSchema),
  unconfirmedAnswers: z.record(z.string(), UnconfirmedAnswerSchema).default({}),
  lastSyncAt: z.number().nullable(),
});

type PersistedDraft = z.output<typeof PersistedDraftSchema>;

const getStorage = (): Storage | null => {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
};

const storageKeys = (storage: Storage): string[] => {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key?.startsWith(DRAFT_STORAGE_PREFIX)) keys.push(key);
  }
  return keys;
};

/** Lee y valida un draft guardado. Lo corrupto o de otra versión se ignora (se trata como inexistente). */
function parseStored(raw: string | null): PersistedDraft | null {
  if (raw === null) return null;
  try {
    const parsed = PersistedDraftSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    // La cola solo puede referir respuestas existentes de la misma versión.
    const { answers } = parsed.data;
    return {
      ...parsed.data,
      queue: parsed.data.queue.filter((entry) => answers[entry.itemId]?.version === entry.version),
    };
  } catch {
    return null;
  }
}

/** Respuestas pendientes de un valor crudo de sessionStorage (para avisar de lo que se descarta). */
function pendingInRaw(raw: string | null): { pending: number; assignmentId: number | null } {
  if (raw === null) return { pending: 0, assignmentId: null };
  try {
    const data: unknown = JSON.parse(raw);
    const record = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
    const queue = Array.isArray(record.queue) ? record.queue.length : 0;
    const owner = record.owner as { assignmentId?: unknown } | null | undefined;
    return { pending: queue, assignmentId: typeof owner?.assignmentId === "number" ? owner.assignmentId : null };
  } catch {
    return { pending: 0, assignmentId: null };
  }
}

function writeStored(state: RuntimeDraftState): void {
  const storage = getStorage();
  if (!storage || !state.owner) return;
  const payload = {
    v: STORAGE_VERSION,
    owner: state.owner,
    answers: state.answers,
    queue: state.queue,
    rejectedAnswers: state.rejectedAnswers,
    unconfirmedAnswers: state.unconfirmedAnswers,
    lastSyncAt: state.lastSyncAt,
  };
  try {
    storage.setItem(draftStorageKey(state.owner.assignmentId), JSON.stringify(payload));
  } catch {
    // Cuota llena o storage bloqueado: el draft sigue funcionando en memoria.
  }
}

function removeStored(assignmentId: number): void {
  try {
    getStorage()?.removeItem(draftStorageKey(assignmentId));
  } catch {
    // storage no disponible
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export interface RuntimeDraftState {
  /** Se incrementa en cada cambio de dueño o limpieza. Solo en memoria. */
  epoch: number;
  owner: DraftOwner | null;
  answers: Record<number, DraftAnswer>;
  queue: QueueEntry[];
  rejectedAnswers: Record<number, RejectedAnswer>;
  unconfirmedAnswers: Record<number, UnconfirmedAnswer>;
  isOffline: boolean;
  lastSyncAt: number | null;
  syncBlock: SyncBlock | null;
  discardNotice: DiscardNotice | null;

  /**
   * Enlaza el estado a una asignación e intento. Si cambian, el estado del dueño anterior se descarta
   * (y se avisa en `discardNotice` si tenía respuestas sin enviar); si hay un draft guardado de ese
   * mismo dueño en sessionStorage (recarga), se restaura.
   */
  bindOwner: (owner: DraftOwner) => BindResult;
  /** Limpia todo el estado y su copia en sessionStorage (completar el intento, cerrar sesión). */
  clearDraft: () => void;
  /**
   * Nuevo canje de la misma asignación e intento (JWT nuevo): sube el `epoch` para invalidar lo que siga en
   * vuelo con el JWT anterior y limpia `syncBlock`/`isOffline`. Conserva respuestas, cola y rechazos.
   * Devuelve `false` si no hay dueño.
   */
  renewSession: () => boolean;
  /**
   * Actualiza el estado local de inmediato (optimista), sube la versión y encola. No toca la red:
   * el envío lo dispara `setAnswer` de `sync.ts`. Devuelve la versión, o `null` si no hay dueño.
   */
  setAnswerLocal: (itemId: number, value: AnswerValue, timeUsedSeconds?: number, subtestId?: number) => number | null;
  dismissDiscardNotice: () => void;

  // Mutaciones protegidas por dueño: ignoran (y devuelven false) las que llegan de un dueño anterior.
  /** Confirma una versión enviada: la retira de la cola solo si sigue siendo esa versión. */
  commitSaved: (token: DraftOwnerToken, itemId: number, version: number, at: number) => boolean;
  /** Retira de la cola solo la misma versión. */
  removeFromQueue: (token: DraftOwnerToken, itemId: number, version: number) => boolean;
  /** Rechazo definitivo: fuera de la cola y a `rejectedAnswers` (solo si la versión sigue vigente). */
  rejectAnswer: (token: DraftOwnerToken, itemId: number, version: number, code: string) => boolean;
  /** Cierre forzado por tiempo con respuestas pendientes: conserva el valor en `unconfirmedAnswers` y limpia `queue`. */
  recordUnconfirmedOnTimeout: (token: DraftOwnerToken, subtestId: number, itemIds: readonly number[]) => boolean;
  /** Suma un `SUBTEST_NO_INICIADO` a la entrada de esa versión. Devuelve el total, o `null` si ya no aplica. */
  bumpNotStarted: (token: DraftOwnerToken, itemId: number, version: number) => number | null;
  setOffline: (token: DraftOwnerToken, isOffline: boolean) => boolean;
  setSyncBlock: (token: DraftOwnerToken, block: SyncBlock | null) => boolean;
}

const emptyData = {
  owner: null,
  answers: {} as Record<number, DraftAnswer>,
  queue: [] as QueueEntry[],
  rejectedAnswers: {} as Record<number, RejectedAnswer>,
  unconfirmedAnswers: {} as Record<number, UnconfirmedAnswer>,
  isOffline: false,
  lastSyncAt: null,
  syncBlock: null,
} satisfies Partial<RuntimeDraftState>;

const isCurrent = (state: RuntimeDraftState, token: DraftOwnerToken): boolean =>
  state.owner !== null && state.epoch === token.epoch;

export const useRuntimeDraft = create<RuntimeDraftState>()((set, get) => ({
  epoch: 0,
  ...emptyData,
  discardNotice: null,

  bindOwner: (owner) => {
    const state = get();
    const current = state.owner;
    if (current && current.assignmentId === owner.assignmentId && current.attemptId === owner.attemptId) {
      return { changed: false, restored: false, discardedPending: 0 };
    }

    const storage = getStorage();
    let discardedPending = 0;
    let previousAssignmentId: number | null = null;

    // Estado en memoria del dueño anterior.
    if (current) {
      discardedPending += state.queue.length;
      previousAssignmentId = current.assignmentId;
      removeStored(current.assignmentId);
    }

    // Drafts de otros dueños que quedaron en esta pestaña (recarga + otro participante): se purgan.
    const ownKey = draftStorageKey(owner.assignmentId);
    let hydrated: PersistedDraft | null = null;
    if (storage) {
      for (const key of storageKeys(storage)) {
        let raw: string | null = null;
        try {
          raw = storage.getItem(key);
        } catch {
          raw = null;
        }
        if (key === ownKey) {
          const stored = parseStored(raw);
          if (stored && stored.owner.attemptId === owner.attemptId) {
            hydrated = stored;
            continue;
          }
          // Misma asignación pero otro intento (o dato corrupto): también es ajeno.
        }
        const foreign = pendingInRaw(raw);
        discardedPending += foreign.pending;
        previousAssignmentId ??= foreign.assignmentId;
        try {
          storage.removeItem(key);
        } catch {
          // storage no disponible
        }
      }
    }

    const discardNotice: DiscardNotice | null =
      discardedPending > 0 ? { count: discardedPending, previousAssignmentId, at: Date.now() } : null;

    set({
      epoch: state.epoch + 1,
      ...emptyData,
      owner: { assignmentId: owner.assignmentId, attemptId: owner.attemptId },
      ...(hydrated
        ? {
            answers: hydrated.answers as Record<number, DraftAnswer>,
            queue: hydrated.queue,
            rejectedAnswers: hydrated.rejectedAnswers as Record<number, RejectedAnswer>,
            unconfirmedAnswers: hydrated.unconfirmedAnswers as Record<number, UnconfirmedAnswer>,
            lastSyncAt: hydrated.lastSyncAt,
          }
        : {}),
      discardNotice,
    });
    return { changed: true, restored: hydrated !== null, discardedPending };
  },

  clearDraft: () => {
    const { owner, epoch } = get();
    if (owner) removeStored(owner.assignmentId);
    set({ epoch: epoch + 1, ...emptyData, discardNotice: null });
  },

  renewSession: () => {
    const state = get();
    if (!state.owner) return false;
    set({ epoch: state.epoch + 1, syncBlock: null, isOffline: false });
    return true;
  },

  setAnswerLocal: (itemId, value, timeUsedSeconds, subtestId) => {
    const state = get();
    if (!state.owner) return null;
    const version = (state.answers[itemId]?.version ?? 0) + 1;
    const answer: DraftAnswer = {
      value,
      version,
      updatedAt: Date.now(),
      ...(timeUsedSeconds !== undefined ? { timeUsedSeconds } : {}),
    };
    const entry: QueueEntry = {
      itemId,
      version,
      notStartedAttempts: 0,
      ...(subtestId !== undefined ? { subtestId } : {}),
    };
    const rest = { ...state.rejectedAnswers };
    delete rest[itemId];
    let unconfirmedAnswers = state.unconfirmedAnswers;
    if (itemId in unconfirmedAnswers) {
      unconfirmedAnswers = { ...unconfirmedAnswers };
      delete unconfirmedAnswers[itemId];
    }
    set({
      answers: { ...state.answers, [itemId]: answer },
      // Idempotente por ítem: la nueva versión reemplaza a la anterior (y va al final).
      queue: [...state.queue.filter((e) => e.itemId !== itemId), entry],
      // Una respuesta nueva se juzga por sí misma: el rechazo de la anterior ya no aplica.
      rejectedAnswers: rest,
      unconfirmedAnswers,
    });
    return version;
  },

  dismissDiscardNotice: () => set({ discardNotice: null }),

  commitSaved: (token, itemId, version, at) => {
    const state = get();
    if (!isCurrent(state, token)) return false;
    set({
      queue: state.queue.filter((e) => !(e.itemId === itemId && e.version === version)),
      lastSyncAt: at,
    });
    return true;
  },

  removeFromQueue: (token, itemId, version) => {
    const state = get();
    if (!isCurrent(state, token)) return false;
    set({ queue: state.queue.filter((e) => !(e.itemId === itemId && e.version === version)) });
    return true;
  },

  rejectAnswer: (token, itemId, version, code) => {
    const state = get();
    if (!isCurrent(state, token)) return false;
    const answer = state.answers[itemId];
    const entry = state.queue.find((e) => e.itemId === itemId && e.version === version);
    // La versión enviada ya fue reemplazada: la nueva se juzgará por sí misma.
    if (!answer || answer.version !== version) {
      set({ queue: state.queue.filter((e) => !(e.itemId === itemId && e.version === version)) });
      return false;
    }
    const rejected: RejectedAnswer = {
      code,
      value: answer.value,
      version,
      rejectedAt: Date.now(),
      ...(entry?.subtestId !== undefined ? { subtestId: entry.subtestId } : {}),
    };
    set({
      queue: state.queue.filter((e) => !(e.itemId === itemId && e.version === version)),
      rejectedAnswers: { ...state.rejectedAnswers, [itemId]: rejected },
    });
    return true;
  },

  recordUnconfirmedOnTimeout: (token, subtestId, itemIds) => {
    const state = get();
    if (!isCurrent(state, token)) return false;
    const targetSet = new Set(itemIds);
    if (targetSet.size === 0) return true;

    const nextUnconfirmed = { ...state.unconfirmedAnswers };
    const movedIds = new Set<number>();
    const recordedAt = Date.now();

    for (const entry of state.queue) {
      if (!targetSet.has(entry.itemId)) continue;
      const answer = state.answers[entry.itemId];
      if (!answer) continue;
      nextUnconfirmed[entry.itemId] = {
        value: answer.value,
        version: entry.version,
        subtestId: entry.subtestId ?? subtestId,
        recordedAt,
      };
      movedIds.add(entry.itemId);
    }

    if (movedIds.size === 0) return true;

    set({
      unconfirmedAnswers: nextUnconfirmed,
      queue: state.queue.filter((entry) => !movedIds.has(entry.itemId)),
    });
    return true;
  },

  bumpNotStarted: (token, itemId, version) => {
    const state = get();
    if (!isCurrent(state, token)) return null;
    const index = state.queue.findIndex((e) => e.itemId === itemId && e.version === version);
    if (index < 0) return null;
    const entry = state.queue[index];
    if (!entry) return null;
    const total = entry.notStartedAttempts + 1;
    const queue = [...state.queue];
    queue[index] = { ...entry, notStartedAttempts: total };
    set({ queue });
    return total;
  },

  setOffline: (token, isOffline) => {
    const state = get();
    if (!isCurrent(state, token)) return false;
    if (state.isOffline !== isOffline) set({ isOffline });
    return true;
  },

  setSyncBlock: (token, block) => {
    const state = get();
    if (!isCurrent(state, token)) return false;
    const same = state.syncBlock === null ? block === null : block !== null && block.code === state.syncBlock.code;
    if (!same) set({ syncBlock: block });
    return true;
  },
}));

// Persistencia: se escribe cuando cambia lo que se guarda. `isOffline` y `syncBlock` no se persisten.
useRuntimeDraft.subscribe((state, prev) => {
  if (!state.owner) return;
  if (
    state.owner !== prev.owner ||
    state.answers !== prev.answers ||
    state.queue !== prev.queue ||
    state.rejectedAnswers !== prev.rejectedAnswers ||
    state.unconfirmedAnswers !== prev.unconfirmedAnswers ||
    state.lastSyncAt !== prev.lastSyncAt
  ) {
    writeStored(state);
  }
});

/** Captura el dueño actual (con su `epoch`) para verificarlo tras cada `await`. */
export function getOwnerToken(): DraftOwnerToken | null {
  const { owner, epoch } = useRuntimeDraft.getState();
  return owner ? { ...owner, epoch } : null;
}
