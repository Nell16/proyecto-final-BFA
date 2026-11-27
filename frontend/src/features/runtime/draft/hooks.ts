import { useCallback, useMemo } from "react";
import type { AnswerValue } from "../answer-value";
import { setAnswer } from "./sync";
import { useRuntimeDraft } from "./store";
import type {
  DiscardNotice,
  DraftAnswer,
  RejectedAnswer,
  RejectedAnswerEntry,
  SyncStatus,
  UnconfirmedAnswerEntry,
} from "./types";

export interface UseDraftAnswerResult {
  /** Respuesta local completa (valor + versión), o `undefined` si el ítem no tiene respuesta local. */
  answer: DraftAnswer | undefined;
  value: AnswerValue | undefined;
  /** La última versión de este ítem aún no está confirmada por el servidor. */
  isPending: boolean;
  /** Rechazo definitivo vigente de este ítem, si lo hay. */
  rejected: RejectedAnswer | undefined;
  /** Registra la respuesta (optimista + cola + envío). `timeUsedSeconds` lo mide quien cronometra el ítem. */
  setValue: (value: AnswerValue, timeUsedSeconds?: number) => Promise<void>;
}

export function useDraftAnswer(itemId: number, options: { subtestId?: number } = {}): UseDraftAnswerResult {
  const { subtestId } = options;
  const answer = useRuntimeDraft((state) => state.answers[itemId]);
  const rejected = useRuntimeDraft((state) => state.rejectedAnswers[itemId]);
  const isPending = useRuntimeDraft((state) => state.queue.some((entry) => entry.itemId === itemId));
  const setValue = useCallback(
    (value: AnswerValue, timeUsedSeconds?: number) => setAnswer(itemId, value, timeUsedSeconds, subtestId),
    [itemId, subtestId],
  );
  return { answer, value: answer?.value, isPending, rejected, setValue };
}

export function useSyncStatus(): SyncStatus {
  const pending = useRuntimeDraft((state) => state.queue.length);
  const isOffline = useRuntimeDraft((state) => state.isOffline);
  const rejectedCount = useRuntimeDraft((state) => Object.keys(state.rejectedAnswers).length);
  const lastSyncAt = useRuntimeDraft((state) => state.lastSyncAt);
  const blockedCode = useRuntimeDraft((state) => state.syncBlock?.code ?? null);
  return useMemo(
    () => ({ pending, isOffline, rejectedCount, lastSyncAt, isPaused: blockedCode === "SESION_PAUSADA", blockedCode }),
    [pending, isOffline, rejectedCount, lastSyncAt, blockedCode],
  );
}

/** Respuestas rechazadas de forma definitiva, para mostrarlas al participante y al monitor. */
export function useRejectedAnswers(): RejectedAnswerEntry[] {
  const rejectedAnswers = useRuntimeDraft((state) => state.rejectedAnswers);
  return useMemo(
    () => Object.entries(rejectedAnswers).map(([itemId, rejected]) => ({ itemId: Number(itemId), ...rejected })),
    [rejectedAnswers],
  );
}

/** Respuestas que quedaron sin confirmar al vencer el tiempo de un subtest. */
export function useUnconfirmedAnswers(): UnconfirmedAnswerEntry[] {
  const unconfirmedAnswers = useRuntimeDraft((state) => state.unconfirmedAnswers);
  return useMemo(
    () =>
      Object.entries(unconfirmedAnswers)
        .map(([itemId, entry]) => ({ itemId: Number(itemId), ...entry }))
        .sort((a, b) => a.recordedAt - b.recordedAt || a.itemId - b.itemId),
    [unconfirmedAnswers],
  );
}

/** Aviso (§7b F2) de que se descartó la cola de otro participante. `dismiss` lo oculta. */
export function useDiscardNotice(): { notice: DiscardNotice | null; dismiss: () => void } {
  const notice = useRuntimeDraft((state) => state.discardNotice);
  const dismiss = useRuntimeDraft((state) => state.dismissDiscardNotice);
  return { notice, dismiss };
}
