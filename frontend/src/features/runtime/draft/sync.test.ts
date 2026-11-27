import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpResponse } from "msw";
import { useParticipantAuth } from "../../../store/participantAuth";
import {
  ASSIGNMENT_ID,
  ATTEMPT_ID,
  bulkResult,
  deferred,
  fail,
  mockRuntimeApi,
  ok,
  receipt,
  setBrowserOnline,
  setupDraftEnvironment,
  single,
  storedDraftKeys,
  teardownDraftEnvironment,
  waitUntil,
} from "./draft-test-utils";
import { getOwnerToken, useRuntimeDraft } from "./store";
import {
  STALE_PARTICIPANT,
  bindDraftOwner,
  clearRuntimeDraft,
  configureDraftSync,
  flush,
  flushAllBeforeFinish,
  flushBeforeFinish,
  isStaleParticipantError,
  markSubtestPendingUnconfirmed,
  resumeSync,
  setAnswer,
} from "./sync";

const store = () => useRuntimeDraft.getState();
const queuedIds = () => store().queue.map((e) => e.itemId);

/** Encola sin tocar la red (como si la respuesta se hubiera dado sin conexión). */
const enqueue = (itemId: number, optionId: number, subtestId?: number) =>
  store().setAnswerLocal(itemId, single(optionId), undefined, subtestId);

const tick = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => setupDraftEnvironment());
afterEach(() => teardownDraftEnvironment());

describe("setAnswer: optimismo, versión y PUT individual", () => {
  it("el estado local cambia al instante, antes de que el servidor responda", async () => {
    const gate = deferred();
    const calls = mockRuntimeApi({
      put: async () => {
        await gate.promise;
        return ok(receipt(1));
      },
    });

    const pending = setAnswer(1, single(10), 4.6, 7);

    // Síncrono: aún no hay respuesta del servidor.
    expect(store().answers[1]).toMatchObject({ value: single(10), version: 1, timeUsedSeconds: 4.6 });
    expect(queuedIds()).toEqual([1]);
    expect(store().lastSyncAt).toBeNull();

    await vi.waitFor(() => expect(calls.puts).toHaveLength(1));
    // `toSaveAnswerRequest` redondea el tiempo y arma el cuerpo del backend.
    expect(calls.puts[0]).toEqual({ itemId: 1, body: { itemId: 1, selectedOptionIds: [10], timeUsedSeconds: 5 } });

    gate.resolve();
    await pending;
    expect(queuedIds()).toEqual([]);
    expect(store().answers[1]?.value).toEqual(single(10)); // la respuesta local se conserva
    expect(store().lastSyncAt).not.toBeNull();
    expect(store().isOffline).toBe(false);
    expect(calls.bulks).toHaveLength(0);
  });

  it("cada cambio sube la versión; la cola solo conserva la última y se retira solo esa versión", async () => {
    const gate = deferred();
    const calls = mockRuntimeApi({
      put: async (itemId) => {
        await gate.promise;
        return ok(receipt(itemId));
      },
    });

    const first = setAnswer(1, single(10));
    await vi.waitFor(() => expect(calls.puts).toHaveLength(1));
    const second = setAnswer(1, single(11)); // v2 mientras v1 vuela

    expect(store().answers[1]?.version).toBe(2);
    expect(store().queue).toEqual([{ itemId: 1, version: 2, notStartedAttempts: 0 }]);

    gate.resolve();
    await Promise.all([first, second]);

    // v1 se confirmó por PUT (no borra v2); v2 salió después, por el envío serializado.
    expect(calls.order).toEqual(["PUT:1", "POST:[1]"]);
    expect(calls.bulks[0]).toEqual([{ itemId: 1, selectedOptionIds: [11] }]);
    expect(queuedIds()).toEqual([]);
    expect(store().answers[1]).toMatchObject({ value: single(11), version: 2 });
  });

  it("lanza si no hay dueño enlazado", () => {
    store().clearDraft();
    expect(() => setAnswer(1, single(10))).toThrow(/dueño/);
  });
});

describe("orden PUT → POST con un PUT en vuelo", () => {
  it("un flush manual no reenvía el ítem con PUT en vuelo; la versión nueva sale en bulk DESPUÉS del PUT", async () => {
    const gate = deferred();
    const calls = mockRuntimeApi({
      put: async (itemId) => {
        await gate.promise;
        return ok(receipt(itemId));
      },
    });

    const first = setAnswer(1, single(10)); // PUT v1 en vuelo
    await vi.waitFor(() => expect(calls.order).toEqual(["PUT:1"]));

    const second = setAnswer(1, single(11)); // v2: espera al PUT
    await flush({ force: true }); // intento de adelantarse con el lote
    await tick();
    expect(calls.order).toEqual(["PUT:1"]); // ningún POST se adelantó al PUT

    gate.resolve();
    await Promise.all([first, second]);

    expect(calls.order).toEqual(["PUT:1", "POST:[1]"]);
    expect(calls.bulks[0]).toEqual([{ itemId: 1, selectedOptionIds: [11] }]);
    expect(queuedIds()).toEqual([]);
  });

  it("otros ítems sin PUT en vuelo sí salen en el lote mientras el ítem en vuelo se difiere", async () => {
    const gate = deferred();
    const calls = mockRuntimeApi({
      put: async (itemId) => {
        await gate.promise;
        return ok(receipt(itemId));
      },
    });

    enqueue(2, 20);
    enqueue(3, 30);
    const first = setAnswer(1, single(10));
    await vi.waitFor(() => expect(calls.order).toEqual(["PUT:1"]));

    await flush({ force: true });
    expect(calls.order).toEqual(["PUT:1", "POST:[2,3]"]); // 1 queda fuera: tiene PUT en vuelo
    expect(queuedIds()).toEqual([1]);

    gate.resolve();
    await first;
    expect(queuedIds()).toEqual([]);
  });
});

describe("flush por online / visibilitychange", () => {
  it("sin red del navegador no se envía nada hasta que llega el evento `online`", async () => {
    const online = setBrowserOnline(false);
    const calls = mockRuntimeApi();

    await setAnswer(1, single(10));
    await setAnswer(2, single(20));
    await tick(60);

    expect(calls.order).toEqual([]); // ni PUT ni POST, ni timers de reintento
    expect(queuedIds()).toEqual([1, 2]);
    expect(store().isOffline).toBe(true);

    online.mockReturnValue(true);
    window.dispatchEvent(new Event("online"));

    await vi.waitFor(() => expect(calls.order).toEqual(["POST:[1,2]"]));
    await vi.waitFor(() => expect(queuedIds()).toEqual([]));
    expect(store().isOffline).toBe(false);
    expect(store().lastSyncAt).not.toBeNull();
  });

  it("visibilitychange solo dispara el flush al volver a ser visible", async () => {
    const calls = mockRuntimeApi();
    enqueue(1, 10);
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");

    document.dispatchEvent(new Event("visibilitychange"));
    await tick(40);
    expect(calls.order).toEqual([]);

    visibility.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => expect(calls.order).toEqual(["POST:[1]"]));
  });

  it("clearRuntimeDraft quita los listeners: un `online` posterior ya no envía", async () => {
    const calls = mockRuntimeApi();
    enqueue(1, 10);
    clearRuntimeDraft();
    window.dispatchEvent(new Event("online"));
    await tick(40);
    expect(calls.order).toEqual([]);
  });
});

describe("backoff exponencial con jitter (fake timers)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    configureDraftSync({ random: () => 0.5, baseDelayMs: 1000, maxDelayMs: 8000, maxAutoAttempts: 4 });
  });

  it("reintenta con retrasos crecientes y jitter, se rinde tras los intentos acotados y `online` lo reanuda", async () => {
    const calls = mockRuntimeApi({
      put: () => HttpResponse.error(),
      bulk: () => HttpResponse.error(),
    });

    await setAnswer(1, single(10));
    expect(calls.order).toEqual(["PUT:1"]);
    expect(store().isOffline).toBe(true);
    expect(queuedIds()).toEqual([1]); // la cola se retiene

    // Retrasos con random=0.5: techo/2 + 0.5*techo/2 → 750, 1500, 3000, 6000 (tope 8000).
    const delays = [750, 1500, 3000, 6000];
    let expected = 1;
    for (const delay of delays) {
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(calls.order).toHaveLength(expected); // aún no
      await vi.advanceTimersByTimeAsync(1);
      expected += 1;
      await waitUntil(() => expect(calls.order).toHaveLength(expected));
    }
    expect(calls.order).toEqual(["PUT:1", "POST:[1]", "POST:[1]", "POST:[1]", "POST:[1]"]);

    // Intentos agotados: no hay más reintentos automáticos aunque pase mucho tiempo.
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(calls.order).toHaveLength(5);
    expect(store().isOffline).toBe(true);
    expect(queuedIds()).toEqual([1]);

    // Un disparador manual reinicia el calendario y reintenta.
    mockRuntimeApi(); // el servidor se recupera
    window.dispatchEvent(new Event("online"));
    await waitUntil(() => expect(queuedIds()).toEqual([]));
    expect(store().isOffline).toBe(false);
  });

  it("un 5xx también es reintentable (offline + backoff), y el éxito reinicia el contador", async () => {
    let failing = true;
    const calls = mockRuntimeApi({
      put: () => (failing ? fail(503, "HTTP_503") : ok(receipt(1))),
      bulk: (body) => (failing ? fail(503, "HTTP_503") : ok(body.map((a) => bulkResult(a.itemId, "GUARDADA")))),
    });

    await setAnswer(1, single(10));
    expect(store().isOffline).toBe(true);

    failing = false;
    await vi.advanceTimersByTimeAsync(750);
    await waitUntil(() => expect(queuedIds()).toEqual([]));
    expect(calls.order).toEqual(["PUT:1", "POST:[1]"]);
    expect(store().isOffline).toBe(false);

    // Tras el éxito no queda ningún timer pendiente.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls.order).toHaveLength(2);
  });

  it("una respuesta nueva con el backoff agotado reinicia el calendario (sin enviar al instante)", async () => {
    const calls = mockRuntimeApi({ put: () => HttpResponse.error(), bulk: () => HttpResponse.error() });
    configureDraftSync({ maxAutoAttempts: 1 });

    await setAnswer(1, single(10));
    await vi.advanceTimersByTimeAsync(750);
    await waitUntil(() => expect(calls.order).toHaveLength(2));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls.order).toHaveLength(2); // agotado

    await setAnswer(2, single(20)); // no envía: está offline
    expect(calls.order).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(750);
    await waitUntil(() => expect(calls.order).toHaveLength(3));
    expect(calls.bulks.at(-1)?.map((a) => a.itemId)).toEqual([1, 2]);
  });
});

describe("bulk-sync: códigos definitivos y transitorios por ítem", () => {
  it("los definitivos van a rejectedAnswers con su valor y salen de la cola; GUARDADA se retira; el resto se conserva", async () => {
    enqueue(1, 11, 7);
    enqueue(2, 12, 7);
    enqueue(3, 13, 7);
    enqueue(4, 14, 7);
    enqueue(5, 15, 7);
    enqueue(6, 16, 7);
    enqueue(7, 17, 7);
    enqueue(8, 18, 7);
    const calls = mockRuntimeApi({
      bulk: () =>
        ok([
          bulkResult(1, "RECHAZADA", "SUBTEST_FINALIZADO"),
          bulkResult(2, "RECHAZADA", "TIEMPO_AGOTADO"),
          bulkResult(3, "RECHAZADA", "ITEM_NO_ENCONTRADO"),
          bulkResult(4, "RECHAZADA", "OPCION_INVALIDA"),
          bulkResult(5, "RECHAZADA", "RESPUESTA_INVALIDA"),
          bulkResult(6, "RECHAZADA", "CODIGO_DESCONOCIDO"), // transitorio: no se descarta lo que no se entiende
          bulkResult(7, "GUARDADA"),
          // 8: sin confirmación → se conserva
        ]),
    });

    await flush({ force: true });

    expect(calls.bulks).toHaveLength(1);
    expect(calls.bulks[0]?.map((a) => a.itemId)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(
      Object.fromEntries(Object.entries(store().rejectedAnswers).map(([id, r]) => [id, r.code])),
    ).toEqual({
      1: "SUBTEST_FINALIZADO",
      2: "TIEMPO_AGOTADO",
      3: "ITEM_NO_ENCONTRADO",
      4: "OPCION_INVALIDA",
      5: "RESPUESTA_INVALIDA",
    });
    expect(store().rejectedAnswers[1]).toMatchObject({ value: single(11), subtestId: 7 });
    expect(queuedIds()).toEqual([6, 8]);
    expect(store().isOffline).toBe(false); // el backend respondió
    expect(store().lastSyncAt).not.toBeNull();
    // La respuesta local sigue ahí aunque esté rechazada.
    expect(store().answers[1]?.value).toEqual(single(11));
  });

  it("una versión nueva encolada mientras volaba el lote no se pisa con el resultado de la vieja", async () => {
    enqueue(1, 10);
    const gate = deferred();
    mockRuntimeApi({
      bulk: async () => {
        await gate.promise;
        return ok([bulkResult(1, "RECHAZADA", "OPCION_INVALIDA")]);
      },
    });

    const flushing = flush({ force: true });
    await tick();
    enqueue(1, 99); // v2 mientras v1 vuela
    gate.resolve();
    await flushing;

    expect(store().rejectedAnswers[1]).toBeUndefined(); // el rechazo era de v1
    expect(store().queue).toEqual([{ itemId: 1, version: 2, notStartedAttempts: 0 }]);
  });

  it("PUT individual: códigos definitivos (409/400/404) van a rejectedAnswers", async () => {
    mockRuntimeApi({
      put: (itemId) => {
        if (itemId === 1) return fail(409, "SUBTEST_FINALIZADO");
        if (itemId === 2) return fail(409, "TIEMPO_AGOTADO");
        if (itemId === 3) return fail(400, "BAD_REQUEST");
        return fail(404, "NOT_FOUND");
      },
    });
    for (const itemId of [1, 2, 3, 4]) await setAnswer(itemId, single(itemId));

    expect(
      Object.fromEntries(Object.entries(store().rejectedAnswers).map(([id, r]) => [id, r.code])),
    ).toEqual({
      1: "SUBTEST_FINALIZADO",
      2: "TIEMPO_AGOTADO",
      3: "RESPUESTA_INVALIDA",
      4: "ITEM_NO_ENCONTRADO",
    });
    expect(queuedIds()).toEqual([]);
    expect(store().isOffline).toBe(false);
  });

  it("agrupa el lote en trozos de `bulkChunkSize`", async () => {
    configureDraftSync({ bulkChunkSize: 2 });
    for (const itemId of [1, 2, 3, 4, 5]) enqueue(itemId, itemId);
    const calls = mockRuntimeApi();

    await flush({ force: true });

    expect(calls.order).toEqual(["POST:[1,2]", "POST:[3,4]", "POST:[5]"]);
    expect(queuedIds()).toEqual([]);
  });

  it("serializa: dos flush simultáneos no producen dos bulk-sync a la vez", async () => {
    enqueue(1, 10);
    let concurrent = 0;
    let maxConcurrent = 0;
    mockRuntimeApi({
      bulk: async (body) => {
        concurrent += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await tick(20);
        concurrent -= 1;
        return ok(body.map((a) => bulkResult(a.itemId, "GUARDADA")));
      },
    });

    await Promise.all([flush({ force: true }), flush({ force: true }), flush({ force: true })]);

    expect(maxConcurrent).toBe(1);
    expect(queuedIds()).toEqual([]);
  });
});

describe("SUBTEST_NO_INICIADO: reintentos acotados", () => {
  it("en bulk-sync se conserva N-1 veces y a la N-ésima pasa a rejectedAnswers", async () => {
    configureDraftSync({ notStartedMaxAttempts: 3 });
    enqueue(1, 10, 7);
    const calls = mockRuntimeApi({ bulk: () => ok([bulkResult(1, "RECHAZADA", "SUBTEST_NO_INICIADO")]) });

    await flush({ force: true });
    expect(queuedIds()).toEqual([1]);
    expect(store().queue[0]?.notStartedAttempts).toBe(1);
    await flush({ force: true });
    expect(queuedIds()).toEqual([1]);
    expect(store().queue[0]?.notStartedAttempts).toBe(2);
    expect(store().rejectedAnswers[1]).toBeUndefined();

    await flush({ force: true });
    expect(queuedIds()).toEqual([]);
    expect(store().rejectedAnswers[1]).toMatchObject({ code: "SUBTEST_NO_INICIADO", value: single(10), subtestId: 7 });
    expect(calls.bulks).toHaveLength(3);

    await flush({ force: true }); // ya no hay nada que reintentar
    expect(calls.bulks).toHaveLength(3);
  });

  it("el contador es por versión: una respuesta nueva empieza de cero", async () => {
    configureDraftSync({ notStartedMaxAttempts: 2 });
    enqueue(1, 10);
    mockRuntimeApi({ bulk: () => ok([bulkResult(1, "RECHAZADA", "SUBTEST_NO_INICIADO")]) });

    await flush({ force: true });
    expect(store().queue[0]?.notStartedAttempts).toBe(1);
    enqueue(1, 11);
    expect(store().queue[0]?.notStartedAttempts).toBe(0);
    await flush({ force: true });
    expect(queuedIds()).toEqual([1]); // 1 de 2: aún se conserva
  });

  it("en PUT (409 SUBTEST_NO_INICIADO) cuenta y conserva la respuesta", async () => {
    mockRuntimeApi({ put: () => fail(409, "SUBTEST_NO_INICIADO") });

    await setAnswer(1, single(10));

    expect(queuedIds()).toEqual([1]);
    expect(store().queue[0]?.notStartedAttempts).toBe(1);
    expect(store().isOffline).toBe(false);
    expect(store().rejectedAnswers[1]).toBeUndefined();
  });
});

describe("SESION_PAUSADA", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    configureDraftSync({ random: () => 0.5, pausedProbeMs: 15_000 });
  });

  it("retiene la cola sin offline, sondea despacio a intervalo fijo y se reanuda con resumeSync()", async () => {
    let paused = true;
    const calls = mockRuntimeApi({
      put: (itemId) => (paused ? fail(409, "SESION_PAUSADA", "pausada") : ok(receipt(itemId))),
      bulk: (body) =>
        paused ? fail(409, "SESION_PAUSADA", "pausada") : ok(body.map((a) => bulkResult(a.itemId, "GUARDADA"))),
    });

    await setAnswer(1, single(10));

    expect(calls.order).toEqual(["PUT:1"]);
    expect(queuedIds()).toEqual([1]); // retenida
    expect(store().isOffline).toBe(false); // el servidor responde: no es un problema de red
    expect(store().syncBlock?.code).toBe("SESION_PAUSADA");

    // Mientras está pausada, responder más solo encola (no martilla al servidor).
    await setAnswer(2, single(20));
    expect(calls.order).toEqual(["PUT:1"]);
    expect(queuedIds()).toEqual([1, 2]);

    // Sondeo lento, a intervalo FIJO (no crece como el backoff).
    await vi.advanceTimersByTimeAsync(14_999);
    expect(calls.order).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await waitUntil(() => expect(calls.order).toHaveLength(2));
    expect(calls.order[1]).toBe("POST:[1,2]");
    await vi.advanceTimersByTimeAsync(15_000);
    await waitUntil(() => expect(calls.order).toHaveLength(3));
    expect(queuedIds()).toEqual([1, 2]);
    expect(store().syncBlock?.code).toBe("SESION_PAUSADA");

    // La sesión se reanuda.
    paused = false;
    await resumeSync();
    expect(queuedIds()).toEqual([]);
    expect(store().syncBlock).toBeNull();
    expect(store().isOffline).toBe(false);
    expect(calls.order.at(-1)).toBe("POST:[1,2]");

    // Sin cola no quedan sondeos.
    const count = calls.order.length;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(calls.order).toHaveLength(count);
  });

  it("en bulk-sync entero 409 SESION_PAUSADA también retiene sin offline", async () => {
    enqueue(1, 10);
    mockRuntimeApi({ bulk: () => fail(409, "SESION_PAUSADA") });

    await flush({ force: true });

    expect(queuedIds()).toEqual([1]);
    expect(store().isOffline).toBe(false);
    expect(store().syncBlock?.code).toBe("SESION_PAUSADA");
  });

  it("otro bloqueo de runtime (TOKEN_EXPIRADO) retiene sin reintento automático", async () => {
    const calls = mockRuntimeApi({ put: () => fail(409, "TOKEN_EXPIRADO") });

    await setAnswer(1, single(10));
    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(calls.order).toEqual(["PUT:1"]);
    expect(queuedIds()).toEqual([1]);
    expect(store().isOffline).toBe(false);
    expect(store().syncBlock?.code).toBe("TOKEN_EXPIRADO");
  });
});

describe("bulk-sync que falla entero", () => {
  it("un 4xx del lote NO deja la cola en offline: se aísla ítem por ítem con PUT", async () => {
    enqueue(1, 10);
    enqueue(2, 20);
    enqueue(3, 30);
    const calls = mockRuntimeApi({
      bulk: () => fail(400, "BAD_REQUEST", "lote inválido"),
      put: (itemId) => (itemId === 2 ? fail(400, "BAD_REQUEST") : ok(receipt(itemId))),
    });

    await flush({ force: true });

    expect(calls.order).toEqual(["POST:[1,2,3]", "PUT:1", "PUT:2", "PUT:3"]);
    expect(store().isOffline).toBe(false);
    expect(queuedIds()).toEqual([]); // 1 y 3 guardados; 2 rechazado
    expect(store().rejectedAnswers[2]).toMatchObject({ code: "RESPUESTA_INVALIDA", value: single(20) });
    expect(store().rejectedAnswers[1]).toBeUndefined();
  });

  it("413 PAYLOAD_TOO_LARGE también se aísla; un ítem con 5xx en el aislamiento corta y reintenta", async () => {
    enqueue(1, 10);
    enqueue(2, 20);
    const calls = mockRuntimeApi({
      bulk: () => fail(413, "PAYLOAD_TOO_LARGE"),
      put: (itemId) => (itemId === 1 ? ok(receipt(1)) : fail(503, "HTTP_503")),
    });

    await flush({ force: true });

    expect(calls.order).toEqual(["POST:[1,2]", "PUT:1", "PUT:2"]);
    expect(queuedIds()).toEqual([2]); // 1 guardado; 2 sigue pendiente
    expect(store().isOffline).toBe(true); // el 503 del ítem sí es un problema de servidor
  });

  it("403 del lote retiene la cola sin offline y sin reenviar ítem por ítem", async () => {
    enqueue(1, 10);
    enqueue(2, 20);
    const calls = mockRuntimeApi({ bulk: () => fail(403, "FORBIDDEN") });

    await flush({ force: true });

    expect(calls.order).toEqual(["POST:[1,2]"]);
    expect(queuedIds()).toEqual([1, 2]);
    expect(store().isOffline).toBe(false);
    expect(store().syncBlock?.code).toBe("FORBIDDEN");
  });

  it("un fallo de red del lote sí deja offline y conserva la cola (retry con backoff)", async () => {
    enqueue(1, 10);
    const calls = mockRuntimeApi({ bulk: () => HttpResponse.error() });

    await flush({ force: true });

    expect(calls.order).toEqual(["POST:[1]"]);
    expect(queuedIds()).toEqual([1]);
    expect(store().isOffline).toBe(true);
    expect(store().syncBlock).toBeNull();
  });
});

describe("flushBeforeFinish", () => {
  it("vacía la cola y devuelve {ok:true} si todo se guardó", async () => {
    enqueue(1, 10, 7);
    enqueue(2, 20, 8); // otro subtest
    const calls = mockRuntimeApi();

    const result = await flushBeforeFinish(7);

    expect(result).toEqual({ ok: true, pending: [], rejected: [] });
    expect(calls.order).toEqual(["POST:[1,2]"]);
  });

  it("espera a un PUT en vuelo y luego envía lo pendiente, sin alert", async () => {
    const gate = deferred();
    const calls = mockRuntimeApi({
      put: async (itemId) => {
        await gate.promise;
        return ok(receipt(itemId));
      },
    });
    const first = setAnswer(1, single(10), undefined, 7);
    await vi.waitFor(() => expect(calls.order).toEqual(["PUT:1"]));
    const second = setAnswer(1, single(11), undefined, 7);

    const finishing = flushBeforeFinish(7);
    await tick();
    expect(calls.order).toEqual(["PUT:1"]);
    gate.resolve();
    const result = await finishing;
    await Promise.all([first, second]);

    expect(result).toEqual({ ok: true, pending: [], rejected: [] });
    expect(calls.order).toEqual(["PUT:1", "POST:[1]"]);
  });

  it("sin conexión devuelve pending (no lanza) para que el runner decida", async () => {
    enqueue(1, 10, 7);
    enqueue(2, 20, 7);
    mockRuntimeApi({ bulk: () => HttpResponse.error() });

    const result = await flushBeforeFinish(7);

    expect(result.ok).toBe(false);
    expect(result.pending).toEqual([1, 2]);
    expect(result.rejected).toEqual([]);
    expect(store().isOffline).toBe(true);
  });

  it("con la sesión pausada devuelve pending sin reintentar en caliente", async () => {
    enqueue(1, 10, 7);
    const calls = mockRuntimeApi({ bulk: () => fail(409, "SESION_PAUSADA") });

    const result = await flushBeforeFinish(7);

    expect(result).toMatchObject({ ok: false, pending: [1] });
    expect(calls.bulks).toHaveLength(1);
  });

  it("informa los rechazos definitivos del subtest", async () => {
    enqueue(1, 10, 7);
    enqueue(2, 20, 7);
    enqueue(3, 30, 8);
    mockRuntimeApi({
      bulk: () =>
        ok([
          bulkResult(1, "RECHAZADA", "TIEMPO_AGOTADO"),
          bulkResult(2, "GUARDADA"),
          bulkResult(3, "RECHAZADA", "OPCION_INVALIDA"),
        ]),
    });

    const result = await flushBeforeFinish(7);

    expect(result.ok).toBe(false);
    expect(result.pending).toEqual([]);
    expect(result.rejected).toHaveLength(1); // el rechazo del ítem 3 es de otro subtest
    expect(result.rejected[0]).toMatchObject({ itemId: 1, code: "TIEMPO_AGOTADO", value: single(10) });
  });

  it("ignora isOffline y reinicia el backoff: es el intento final", async () => {
    enqueue(1, 10, 7);
    store().setOffline(getOwnerToken()!, true);
    const calls = mockRuntimeApi();

    const result = await flushBeforeFinish(7);

    expect(result.ok).toBe(true);
    expect(calls.order).toEqual(["POST:[1]"]);
    expect(store().isOffline).toBe(false);
  });

  it("sin dueño enlazado no hace nada", async () => {
    store().clearDraft();
    await expect(flushBeforeFinish(7)).resolves.toEqual({ ok: true, pending: [], rejected: [] });
  });

  it("flushAllBeforeFinish devuelve pendientes si falla 5xx y vacía toda la cola al recuperarse", async () => {
    enqueue(1, 10, 7);
    enqueue(2, 20, 8);
    let failSync = true;
    mockRuntimeApi({
      bulk: (body) =>
        failSync
          ? fail(503, "UNAVAILABLE", "Sin conexión")
          : ok(body.map((a) => bulkResult(a.itemId, "GUARDADA"))),
    });

    const first = await flushAllBeforeFinish();
    expect(first.ok).toBe(false);
    expect(first.pending).toEqual([1, 2]);

    failSync = false;
    const second = await flushAllBeforeFinish();
    expect(second).toEqual({ ok: true, pending: [], rejected: [] });
    expect(queuedIds()).toEqual([]);
  });

  it("markSubtestPendingUnconfirmed traslada los pendientes del subtest a unconfirmedAnswers", () => {
    enqueue(1, 10, 7);
    enqueue(2, 20, 8);

    const moved = markSubtestPendingUnconfirmed(7);
    expect(moved).toHaveLength(1);
    expect(moved[0]).toMatchObject({ itemId: 1, subtestId: 7, value: single(10) });
    expect(queuedIds()).toEqual([2]);
    expect(store().unconfirmedAnswers[1]).toMatchObject({ subtestId: 7, value: single(10) });
  });
});

describe("cambio de dueño: STALE_PARTICIPANT y sin escrituras tardías", () => {
  it("la confirmación tardía de un PUT del participante anterior no escribe en el estado del nuevo", async () => {
    const gate = deferred();
    mockRuntimeApi({
      put: async (itemId) => {
        await gate.promise;
        return ok(receipt(itemId));
      },
    });
    const pending = setAnswer(1, single(10));
    await tick();

    // Entra otro participante en la misma pestaña mientras el PUT vuela.
    useParticipantAuth.getState().setSession({ token: "otro-token", assignmentId: 43 });
    bindDraftOwner({ assignmentId: 43, attemptId: 202 });
    const before = store();
    expect(before.discardNotice).toMatchObject({ count: 1, previousAssignmentId: ASSIGNMENT_ID });

    gate.resolve();
    await pending; // no lanza

    expect(store().owner).toEqual({ assignmentId: 43, attemptId: 202 });
    expect(store().answers).toEqual({});
    expect(store().queue).toBe(before.queue);
    expect(store().lastSyncAt).toBeNull();
    expect(store().isOffline).toBe(false);
    expect(storedDraftKeys()).toEqual(["bfa-runtime-draft:43"]); // la clave del anterior no revive
  });

  it("un fallo de red tardío del anterior no marca offline al nuevo ni agenda reintentos", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const gate = deferred();
    const calls = mockRuntimeApi({
      put: async () => {
        await gate.promise;
        return HttpResponse.error();
      },
    });
    const pending = setAnswer(1, single(10));
    await waitUntil(() => expect(calls.puts).toHaveLength(1));

    useParticipantAuth.getState().setSession({ token: "otro-token", assignmentId: 43 });
    bindDraftOwner({ assignmentId: 43, attemptId: 202 });
    gate.resolve();
    await pending;

    expect(store().isOffline).toBe(false);
    expect(store().queue).toEqual([]);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(calls.order).toEqual(["PUT:1"]); // nadie reintentó nada
  });

  it("el rechazo definitivo tardío de un bulk del anterior no se registra en el nuevo", async () => {
    enqueue(1, 10);
    const gate = deferred();
    mockRuntimeApi({
      bulk: async () => {
        await gate.promise;
        return ok([bulkResult(1, "RECHAZADA", "SUBTEST_FINALIZADO")]);
      },
    });
    const flushing = flush({ force: true });
    await tick();

    useParticipantAuth.getState().setSession({ token: "otro-token", assignmentId: 43 });
    bindDraftOwner({ assignmentId: 43, attemptId: 202 });
    enqueue(1, 77); // el nuevo participante responde el MISMO itemId
    gate.resolve();
    await flushing;

    expect(store().rejectedAnswers).toEqual({});
    expect(store().queue.map((e) => [e.itemId, e.version])).toEqual([[1, 1]]);
  });

  it("flushBeforeFinish rechaza con STALE_PARTICIPANT si el dueño cambia mientras espera", async () => {
    const gate = deferred();
    const calls = mockRuntimeApi({
      put: async (itemId) => {
        await gate.promise;
        return ok(receipt(itemId));
      },
    });
    const answering = setAnswer(1, single(10), undefined, 7);
    await vi.waitFor(() => expect(calls.puts).toHaveLength(1));

    const finishing = flushBeforeFinish(7);
    const assertion = expect(finishing).rejects.toMatchObject({ code: STALE_PARTICIPANT });
    useParticipantAuth.getState().setSession({ token: "otro-token", assignmentId: 43 });
    bindDraftOwner({ assignmentId: 43, attemptId: 202 });
    gate.resolve();

    await assertion;
    await finishing.catch((error: unknown) => expect(isStaleParticipantError(error)).toBe(true));
    await answering;
    expect(store().owner?.assignmentId).toBe(43);
    expect(store().lastSyncAt).toBeNull();
  });

  it("si participantAuth ya es de otra asignación no se envía nada con ese token (la respuesta queda en cola)", async () => {
    const calls = mockRuntimeApi();
    useParticipantAuth.getState().setSession({ token: "otro-token", assignmentId: 99 });

    await setAnswer(1, single(10));
    await flush({ force: true });
    await tick();

    expect(calls.order).toEqual([]);
    expect(queuedIds()).toEqual([1]);
  });

  it("isOffline está protegido por dueño: la bandera del anterior no se arrastra al nuevo", async () => {
    setBrowserOnline(false);
    await setAnswer(1, single(10));
    expect(store().isOffline).toBe(true);

    useParticipantAuth.getState().setSession({ token: "otro-token", assignmentId: 43 });
    bindDraftOwner({ assignmentId: 43, attemptId: 202 });

    expect(store().isOffline).toBe(false);
  });
});

describe("limpieza y restauración", () => {
  it("cambiar de asignación limpia lo anterior; completar el intento limpia todo y detiene los envíos", async () => {
    setBrowserOnline(false);
    await setAnswer(1, single(10));
    await setAnswer(2, single(20));
    expect(storedDraftKeys()).toEqual([`bfa-runtime-draft:${ASSIGNMENT_ID}`]);

    useParticipantAuth.getState().setSession({ token: "otro-token", assignmentId: 43 });
    const result = bindDraftOwner({ assignmentId: 43, attemptId: 202 });

    expect(result).toMatchObject({ changed: true, discardedPending: 2 });
    expect(store().answers).toEqual({});
    expect(store().queue).toEqual([]);
    expect(store().discardNotice).toMatchObject({ count: 2, previousAssignmentId: ASSIGNMENT_ID });
    // El nuevo dueño se guarda vacío; nada del anterior sobrevive.
    expect(storedDraftKeys()).toEqual(["bfa-runtime-draft:43"]);
    expect(JSON.parse(sessionStorage.getItem("bfa-runtime-draft:43")!)).toMatchObject({ queue: [], answers: {} });
  });

  it("tras una recarga con cola pendiente, bindDraftOwner restaura y envía la cola", async () => {
    setBrowserOnline(false);
    await setAnswer(1, single(10), 3, 7);
    await setAnswer(2, single(20));
    // Recarga: se pierde la memoria, queda sessionStorage.
    useRuntimeDraft.setState({ owner: null, answers: {}, queue: [], rejectedAnswers: {}, lastSyncAt: null });
    vi.restoreAllMocks(); // vuelve la red
    const calls = mockRuntimeApi();

    const result = bindDraftOwner({ assignmentId: ASSIGNMENT_ID, attemptId: ATTEMPT_ID });

    expect(result).toMatchObject({ changed: true, restored: true });
    await vi.waitFor(() => expect(calls.order).toEqual(["POST:[1,2]"]));
    expect(calls.bulks[0]?.[0]).toEqual({ itemId: 1, selectedOptionIds: [10], timeUsedSeconds: 3 });
    await vi.waitFor(() => expect(queuedIds()).toEqual([]));
  });
});
