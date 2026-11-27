import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useParticipantAuth } from "../../../store/participantAuth";
import {
  ASSIGNMENT_ID,
  ATTEMPT_ID,
  TOKEN,
  setupDraftEnvironment,
  single,
  storedDraftKeys,
  teardownDraftEnvironment,
} from "./draft-test-utils";
import { draftStorageKey, getOwnerToken, useRuntimeDraft } from "./store";

const store = () => useRuntimeDraft.getState();

beforeEach(() => setupDraftEnvironment());
afterEach(() => teardownDraftEnvironment());

describe("setAnswerLocal: optimismo, versión e idempotencia", () => {
  it("actualiza al instante, sube la versión y deja una sola entrada por ítem (la última)", () => {
    expect(store().setAnswerLocal(1, single(10), 4, 7)).toBe(1);
    expect(store().answers[1]).toMatchObject({ value: single(10), version: 1, timeUsedSeconds: 4 });
    expect(store().queue).toEqual([{ itemId: 1, version: 1, subtestId: 7, notStartedAttempts: 0 }]);

    expect(store().setAnswerLocal(2, single(20))).toBe(1);
    expect(store().setAnswerLocal(1, single(11), 9, 7)).toBe(2);

    expect(store().answers[1]).toMatchObject({ value: single(11), version: 2, timeUsedSeconds: 9 });
    // La versión nueva reemplaza a la vieja y va al final.
    expect(store().queue.map((e) => [e.itemId, e.version])).toEqual([
      [2, 1],
      [1, 2],
    ]);
  });

  it("no hace nada sin dueño enlazado", () => {
    store().clearDraft();
    expect(store().setAnswerLocal(1, single(10))).toBeNull();
    expect(store().queue).toEqual([]);
  });

  it("una respuesta nueva borra el rechazo vigente del ítem", () => {
    store().setAnswerLocal(1, single(10));
    const token = getOwnerToken()!;
    store().rejectAnswer(token, 1, 1, "OPCION_INVALIDA");
    expect(store().rejectedAnswers[1]?.code).toBe("OPCION_INVALIDA");

    store().setAnswerLocal(1, single(11));
    expect(store().rejectedAnswers[1]).toBeUndefined();
  });
});

describe("mutaciones de la cola", () => {
  it("removeFromQueue/commitSaved retiran solo la MISMA versión", () => {
    store().setAnswerLocal(1, single(10));
    const token = getOwnerToken()!;
    store().setAnswerLocal(1, single(11)); // v2 mientras "volaba" v1

    expect(store().commitSaved(token, 1, 1, 1234)).toBe(true);
    expect(store().queue.map((e) => e.version)).toEqual([2]); // v2 se conserva
    expect(store().lastSyncAt).toBe(1234);

    store().removeFromQueue(token, 1, 2);
    expect(store().queue).toEqual([]);
  });

  it("rejectAnswer saca de la cola y registra {code, value}; si la versión ya fue reemplazada no registra rechazo", () => {
    store().setAnswerLocal(1, single(10), undefined, 7);
    const token = getOwnerToken()!;
    expect(store().rejectAnswer(token, 1, 1, "SUBTEST_FINALIZADO")).toBe(true);
    expect(store().queue).toEqual([]);
    expect(store().rejectedAnswers[1]).toMatchObject({ code: "SUBTEST_FINALIZADO", value: single(10), subtestId: 7 });

    store().setAnswerLocal(2, single(20));
    store().setAnswerLocal(2, single(21)); // v2
    expect(store().rejectAnswer(token, 2, 1, "TIEMPO_AGOTADO")).toBe(false);
    expect(store().rejectedAnswers[2]).toBeUndefined();
    expect(store().queue.map((e) => [e.itemId, e.version])).toEqual([[2, 2]]);
  });

  it("bumpNotStarted cuenta por versión y devuelve null si la versión ya no está", () => {
    store().setAnswerLocal(1, single(10));
    const token = getOwnerToken()!;
    expect(store().bumpNotStarted(token, 1, 1)).toBe(1);
    expect(store().bumpNotStarted(token, 1, 1)).toBe(2);
    expect(store().bumpNotStarted(token, 1, 99)).toBeNull();
  });

  it("las mutaciones con un token de un dueño anterior se ignoran sin escribir nada", () => {
    store().setAnswerLocal(1, single(10));
    const stale = getOwnerToken()!;
    store().bindOwner({ assignmentId: 43, attemptId: 202 });
    store().setAnswerLocal(1, single(77));
    const before = store();

    expect(store().commitSaved(stale, 1, 1, 5)).toBe(false);
    expect(store().removeFromQueue(stale, 1, 1)).toBe(false);
    expect(store().rejectAnswer(stale, 1, 1, "SUBTEST_FINALIZADO")).toBe(false);
    expect(store().bumpNotStarted(stale, 1, 1)).toBeNull();
    expect(store().setOffline(stale, true)).toBe(false);
    expect(store().setSyncBlock(stale, { code: "SESION_PAUSADA", since: 1 })).toBe(false);

    expect(store().queue).toBe(before.queue);
    expect(store().rejectedAnswers).toBe(before.rejectedAnswers);
    expect(store().isOffline).toBe(false);
    expect(store().syncBlock).toBeNull();
    expect(store().lastSyncAt).toBeNull();
  });

  it("re-enlazar el mismo dueño tras limpiar no acepta mutaciones del epoch anterior", () => {
    store().setAnswerLocal(1, single(10));
    const old = getOwnerToken()!;
    store().clearDraft();
    store().bindOwner({ assignmentId: ASSIGNMENT_ID, attemptId: ATTEMPT_ID });
    store().setAnswerLocal(1, single(55));

    expect(store().commitSaved(old, 1, 1, 9)).toBe(false);
    expect(store().queue).toHaveLength(1);
  });
});

describe("bindOwner / clearDraft", () => {
  it("el mismo dueño no cambia nada", () => {
    store().setAnswerLocal(1, single(10));
    expect(store().bindOwner({ assignmentId: ASSIGNMENT_ID, attemptId: ATTEMPT_ID })).toEqual({
      changed: false,
      restored: false,
      discardedPending: 0,
    });
    expect(store().queue).toHaveLength(1);
  });

  it("cambiar de asignación limpia el estado anterior y su clave en sessionStorage, y avisa de lo descartado", () => {
    store().setAnswerLocal(1, single(10));
    store().setAnswerLocal(2, single(20));
    store().rejectAnswer(getOwnerToken()!, 2, 1, "OPCION_INVALIDA");
    expect(storedDraftKeys()).toEqual([draftStorageKey(ASSIGNMENT_ID)]);

    const result = store().bindOwner({ assignmentId: 43, attemptId: 202 });

    expect(result).toEqual({ changed: true, restored: false, discardedPending: 1 });
    expect(store().answers).toEqual({});
    expect(store().queue).toEqual([]);
    expect(store().rejectedAnswers).toEqual({});
    expect(store().owner).toEqual({ assignmentId: 43, attemptId: 202 });
    expect(store().discardNotice).toMatchObject({ count: 1, previousAssignmentId: ASSIGNMENT_ID });
    expect(storedDraftKeys()).toEqual([draftStorageKey(43)]);
  });

  it("sin respuestas pendientes no hay aviso", () => {
    store().bindOwner({ assignmentId: 43, attemptId: 202 });
    expect(store().discardNotice).toBeNull();
  });

  it("el mismo assignmentId con otro intento también es otro dueño", () => {
    store().setAnswerLocal(1, single(10));
    const result = store().bindOwner({ assignmentId: ASSIGNMENT_ID, attemptId: 999 });
    expect(result.changed).toBe(true);
    expect(result.discardedPending).toBe(1);
    expect(store().queue).toEqual([]);
  });

  it("dismissDiscardNotice oculta el aviso", () => {
    store().setAnswerLocal(1, single(10));
    store().bindOwner({ assignmentId: 43, attemptId: 202 });
    store().dismissDiscardNotice();
    expect(store().discardNotice).toBeNull();
  });

  it("clearDraft (completar el intento) limpia memoria y sessionStorage", () => {
    store().setAnswerLocal(1, single(10));
    store().clearDraft();
    expect(store().owner).toBeNull();
    expect(store().answers).toEqual({});
    expect(store().queue).toEqual([]);
    expect(storedDraftKeys()).toEqual([]);
  });
});

describe("persistencia en sessionStorage", () => {
  it("guarda ids, respuestas y cola bajo una clave por asignación, nunca en localStorage y sin tokens", () => {
    expect(useParticipantAuth.getState().token).toBe(TOKEN);
    store().setAnswerLocal(1, { kind: "NUMERICA", value: 3.5 }, 12, 7);
    store().setAnswerLocal(2, single(20));

    expect(storedDraftKeys()).toEqual([`bfa-runtime-draft:${ASSIGNMENT_ID}`]);
    const raw = sessionStorage.getItem(draftStorageKey(ASSIGNMENT_ID))!;
    const saved = JSON.parse(raw) as {
      owner: unknown;
      answers: Record<string, { value: unknown; version: number }>;
      queue: { itemId: number }[];
    };
    expect(saved.owner).toEqual({ assignmentId: ASSIGNMENT_ID, attemptId: ATTEMPT_ID });
    expect(saved.answers["1"]).toMatchObject({ value: { kind: "NUMERICA", value: 3.5 }, version: 1 });
    expect(saved.queue.map((e) => e.itemId)).toEqual([1, 2]);

    // Ni el token ni nada parecido a un secreto.
    expect(raw).not.toContain(TOKEN);
    expect(raw.toLowerCase()).not.toMatch(/token|jwt|authorization|bearer/);
    // Nada del draft en localStorage.
    for (let i = 0; i < localStorage.length; i += 1) {
      expect(localStorage.key(i)).not.toMatch(/runtime-draft/);
    }
  });

  it("tras una recarga (memoria vacía) restaura el draft del mismo dueño", () => {
    store().setAnswerLocal(1, single(10), 3, 7);
    store().setAnswerLocal(2, single(20));
    const token = getOwnerToken()!;
    store().commitSaved(token, 2, 1, 777);

    // Simula recargar la pestaña: se pierde la memoria, sessionStorage queda.
    useRuntimeDraft.setState({ owner: null, answers: {}, queue: [], rejectedAnswers: {}, lastSyncAt: null });
    expect(storedDraftKeys()).toEqual([draftStorageKey(ASSIGNMENT_ID)]);

    const result = store().bindOwner({ assignmentId: ASSIGNMENT_ID, attemptId: ATTEMPT_ID });

    expect(result).toEqual({ changed: true, restored: true, discardedPending: 0 });
    expect(store().answers[1]).toMatchObject({ value: single(10), version: 1, timeUsedSeconds: 3 });
    expect(store().queue.map((e) => e.itemId)).toEqual([1]);
    expect(store().lastSyncAt).toBe(777);
    expect(store().isOffline).toBe(false); // `isOffline` no se persiste
  });

  it("tras una recarga con OTRO participante, descarta la cola ajena y avisa", () => {
    store().setAnswerLocal(1, single(10));
    store().setAnswerLocal(2, single(20));
    useRuntimeDraft.setState({ owner: null, answers: {}, queue: [], rejectedAnswers: {}, lastSyncAt: null });

    const result = store().bindOwner({ assignmentId: 43, attemptId: 202 });

    expect(result).toMatchObject({ changed: true, restored: false, discardedPending: 2 });
    expect(store().discardNotice).toMatchObject({ count: 2, previousAssignmentId: ASSIGNMENT_ID });
    expect(store().queue).toEqual([]);
    expect(storedDraftKeys()).toEqual([draftStorageKey(43)]);
  });

  it("un draft corrupto o de otro intento se ignora y se purga", () => {
    sessionStorage.setItem(draftStorageKey(50), "{no es json");
    store().bindOwner({ assignmentId: 50, attemptId: 1 });
    expect(store().queue).toEqual([]);
    expect(store().answers).toEqual({});

    store().setAnswerLocal(1, single(10));
    useRuntimeDraft.setState({ owner: null, answers: {}, queue: [], rejectedAnswers: {}, lastSyncAt: null });
    const result = store().bindOwner({ assignmentId: 50, attemptId: 2 }); // otro intento
    expect(result.restored).toBe(false);
    expect(result.discardedPending).toBe(1);
  });

  it("recordUnconfirmedOnTimeout conserva respuestas pendientes del subtest en sessionStorage y las retira de queue", () => {
    store().setAnswerLocal(1, single(10), 4, 7);
    store().setAnswerLocal(2, single(20), 2, 8);
    const token = getOwnerToken()!;

    expect(store().recordUnconfirmedOnTimeout(token, 7, [1])).toBe(true);
    expect(store().queue.map((e) => e.itemId)).toEqual([2]);
    expect(store().unconfirmedAnswers[1]).toMatchObject({
      value: single(10),
      version: 1,
      subtestId: 7,
    });

    // Simula recarga: también restaura unconfirmedAnswers
    useRuntimeDraft.setState({
      owner: null,
      answers: {},
      queue: [],
      rejectedAnswers: {},
      unconfirmedAnswers: {},
      lastSyncAt: null,
    });
    const restored = store().bindOwner({ assignmentId: ASSIGNMENT_ID, attemptId: ATTEMPT_ID });
    expect(restored.restored).toBe(true);
    expect(store().unconfirmedAnswers[1]).toMatchObject({
      value: single(10),
      version: 1,
      subtestId: 7,
    });
  });
});
