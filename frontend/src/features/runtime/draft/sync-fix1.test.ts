import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpResponse, http } from "msw";
import type { SaveAnswerRequest } from "../../../api/endpoints/runtime";
import { useParticipantAuth } from "../../../store/participantAuth";
import { server } from "../../../test/msw/server";
import type { AnswerValue } from "../answer-value";
import {
  API,
  ASSIGNMENT_ID,
  ATTEMPT_ID,
  bulkResult,
  deferred,
  fail,
  mockRuntimeApi,
  ok,
  receipt,
  setupDraftEnvironment,
  single,
  teardownDraftEnvironment,
} from "./draft-test-utils";
import { useRuntimeDraft } from "./store";
import { flushBeforeFinish, flush, resumeSync, setAnswer } from "./sync";

/**
 * F2-FIX-1 — regresiones del motor de sincronización (hallazgos ALTO 1, ALTO 2 [red] y MEDIO 5).
 */

const store = () => useRuntimeDraft.getState();
const queuedIds = () => store().queue.map((e) => e.itemId);
const enqueue = (itemId: number, optionId: number, subtestId?: number) =>
  store().setAnswerLocal(itemId, single(optionId), undefined, subtestId);
const text = (value: string): AnswerValue => ({ kind: "TEXTO_ABIERTO", text: value });
const tick = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => setupDraftEnvironment());
afterEach(() => teardownDraftEnvironment());

describe("F2-FIX-1 ALTO 1 · bulk-sync nunca pisa una respuesta más nueva", () => {
  /** Cola de 101 ítems con lotes de 100 (config por defecto): el ítem 101 viaja en el SEGUNDO lote. */
  const enqueue101 = () => {
    for (let itemId = 1; itemId <= 101; itemId += 1) enqueue(itemId, itemId);
  };

  /** Valor que el "servidor" tiene guardado por ítem, en orden de llegada de las escrituras. */
  function serverRecorder() {
    const saved = new Map<number, number | undefined>();
    const writes: Array<{ via: "PUT" | "POST"; itemId: number; optionId: number | undefined }> = [];
    const active = new Map<number, number>();
    let maxConcurrentPerItem = 0;
    const begin = (itemId: number) => {
      const n = (active.get(itemId) ?? 0) + 1;
      active.set(itemId, n);
      maxConcurrentPerItem = Math.max(maxConcurrentPerItem, n);
    };
    const end = (itemId: number) => active.set(itemId, (active.get(itemId) ?? 1) - 1);
    return {
      saved,
      writes,
      begin,
      end,
      record: (via: "PUT" | "POST", body: SaveAnswerRequest) => {
        saved.set(body.itemId, body.selectedOptionIds[0]);
        writes.push({ via, itemId: body.itemId, optionId: body.selectedOptionIds[0] });
      },
      get maxConcurrentPerItem() {
        return maxConcurrentPerItem;
      },
    };
  }

  it("un PUT del ítem 101 confirmado mientras vuela el 1.er lote no es pisado por el 2.º lote con el valor viejo", async () => {
    const rec = serverRecorder();
    const gate = deferred();
    let bulkNumber = 0;
    mockRuntimeApi({
      put: (itemId, body) => {
        rec.record("PUT", body);
        return ok(receipt(itemId));
      },
      bulk: async (body) => {
        bulkNumber += 1;
        if (bulkNumber === 1) await gate.promise; // el 1.er lote queda en vuelo
        for (const answer of body) rec.record("POST", answer);
        return ok(body.map((a) => bulkResult(a.itemId, "GUARDADA")));
      },
    });
    enqueue101();

    const flushing = flush({ force: true });
    await vi.waitFor(() => expect(bulkNumber).toBe(1));

    // Mientras vuela el 1.er lote se cambia el ítem 101 (aún no estaba en vuelo): el PUT guarda el valor nuevo.
    await setAnswer(101, single(999));
    expect(rec.saved.get(101)).toBe(999);

    gate.resolve();
    await flushing;

    expect(rec.saved.get(101)).toBe(999); // sin la corrección, el 2.º lote lo pisaba con 101
    expect(rec.writes.filter((w) => w.itemId === 101)).toEqual([{ via: "PUT", itemId: 101, optionId: 999 }]);
    expect(queuedIds()).toEqual([]);
    expect(store().answers[101]?.value).toEqual(single(999));
  });

  it("si el PUT del ítem 101 sigue en vuelo cuando toca el 2.º lote, ese ítem se omite: nunca dos escrituras del mismo ítem en vuelo", async () => {
    const rec = serverRecorder();
    const bulkGate = deferred();
    const putGate = deferred();
    let bulkNumber = 0;
    mockRuntimeApi({
      put: async (itemId, body) => {
        rec.begin(itemId);
        await putGate.promise;
        rec.record("PUT", body);
        rec.end(itemId);
        return ok(receipt(itemId));
      },
      bulk: async (body) => {
        bulkNumber += 1;
        for (const answer of body) rec.begin(answer.itemId);
        if (bulkNumber === 1) await bulkGate.promise;
        for (const answer of body) {
          rec.record("POST", answer);
          rec.end(answer.itemId);
        }
        return ok(body.map((a) => bulkResult(a.itemId, "GUARDADA")));
      },
    });
    enqueue101();

    const flushing = flush({ force: true });
    await vi.waitFor(() => expect(bulkNumber).toBe(1));
    const putting = setAnswer(101, single(999)); // PUT en vuelo (retenido)
    await vi.waitFor(() => expect(rec.maxConcurrentPerItem).toBeGreaterThanOrEqual(1));
    await tick();

    bulkGate.resolve(); // el 1.er lote termina y el motor arma el 2.º con el ítem 101 aún en vuelo por PUT
    await tick(80);
    putGate.resolve();
    await Promise.all([flushing, putting]);
    await flush({ force: true });

    expect(rec.maxConcurrentPerItem).toBe(1);
    expect(rec.saved.get(101)).toBe(999);
    expect(rec.writes.filter((w) => w.itemId === 101).map((w) => w.optionId)).toEqual([999]);
    expect(queuedIds()).toEqual([]);
  });

  it("si el ítem cambió a una versión nueva que sigue en cola, el lote lleva SOLO esa versión (relee el store)", async () => {
    const gate = deferred();
    let bulkNumber = 0;
    const calls = mockRuntimeApi({
      bulk: async (body) => {
        bulkNumber += 1;
        if (bulkNumber === 1) await gate.promise;
        return ok(body.map((a) => bulkResult(a.itemId, "GUARDADA")));
      },
    });
    enqueue101();

    const flushing = flush({ force: true });
    await vi.waitFor(() => expect(bulkNumber).toBe(1));
    enqueue(101, 777); // v2 en cola, sin envío propio (p. ej. sin red cuando se escribió)
    gate.resolve();
    await flushing;

    const sentFor101 = calls.bulks.flat().filter((a) => a.itemId === 101);
    expect(sentFor101).toEqual([{ itemId: 101, selectedOptionIds: [777] }]); // jamás la versión vieja (101)
    expect(queuedIds()).toEqual([]);
  });
});

describe("F2-FIX-1 ALTO 2 · el debounce afecta SOLO al envío de red", () => {
  it("setAnswer con debounce registra al instante en el draft y agrupa la ráfaga en un único PUT con la versión vigente", async () => {
    const calls = mockRuntimeApi();

    const first = setAnswer(7, text("h"), 1, 70, { debounceMs: 40 });
    const second = setAnswer(7, text("ho"), 2, 70, { debounceMs: 40 });
    const third = setAnswer(7, text("hol"), 3, 70, { debounceMs: 40 });

    // Local e inmediato: ya está en el draft y en la cola con su itemId, sin red todavía.
    expect(store().answers[7]).toMatchObject({ value: text("hol"), version: 3 });
    expect(store().queue).toEqual([{ itemId: 7, version: 3, subtestId: 70, notStartedAttempts: 0 }]);
    expect(calls.puts).toHaveLength(0);

    await Promise.all([first, second, third]);

    expect(calls.puts).toEqual([{ itemId: 7, body: { itemId: 7, selectedOptionIds: [], textAnswer: "hol", timeUsedSeconds: 3 } }]);
    expect(queuedIds()).toEqual([]);
  });

  it("flushBeforeFinish adelanta el envío diferido y ve el valor más reciente", async () => {
    const calls = mockRuntimeApi();

    const pending = setAnswer(7, text("respuesta larga"), 4, 70, { debounceMs: 60_000 });
    expect(calls.puts).toHaveLength(0);

    const result = await flushBeforeFinish(70);

    expect(result).toEqual({ ok: true, pending: [], rejected: [] });
    expect(calls.bulks).toEqual([[{ itemId: 7, selectedOptionIds: [], textAnswer: "respuesta larga", timeUsedSeconds: 4 }]]);
    await pending; // la promesa del setAnswer diferido no queda colgada
  });

  it("una respuesta con intento de origen distinto al del draft se descarta (STALE_PARTICIPANT) sin escribir", async () => {
    const calls = mockRuntimeApi();

    await expect(setAnswer(7, text("x"), 1, 70, { attemptId: ATTEMPT_ID + 1 })).rejects.toMatchObject({
      code: "STALE_PARTICIPANT",
    });

    expect(store().answers[7]).toBeUndefined();
    expect(queuedIds()).toEqual([]);
    expect(calls.puts).toHaveLength(0);
    await setAnswer(7, text("ok"), 1, 70, { attemptId: ATTEMPT_ID });
    expect(store().answers[7]?.value).toEqual(text("ok"));
  });
});

describe("F2-FIX-1 MEDIO 5 · un nuevo canje válido reanuda la cola tras un 401", () => {
  const SECOND_JWT = "secret-participant-jwt-2";

  it("el JWT nuevo de la misma asignación limpia UNAUTHORIZED, conserva la cola y la reanuda con el JWT nuevo", async () => {
    mockRuntimeApi({ put: () => fail(401, "UNAUTHORIZED", "token vencido") });
    await setAnswer(1, single(10), undefined, 70);
    expect(store().syncBlock?.code).toBe("UNAUTHORIZED");
    expect(queuedIds()).toEqual([1]);

    const seenAuth: Array<string | null> = [];
    server.use(
      http.put(`${API}/intentos/${ATTEMPT_ID}/items/:itemId/respuesta`, ({ request, params }) => {
        seenAuth.push(request.headers.get("authorization"));
        return ok(receipt(Number(params.itemId)));
      }),
      http.post(`${API}/intentos/${ATTEMPT_ID}/respuestas/bulk-sync`, async ({ request }) => {
        seenAuth.push(request.headers.get("authorization"));
        const body = (await request.json()) as SaveAnswerRequest[];
        return ok(body.map((a) => bulkResult(a.itemId, "GUARDADA")));
      }),
    );

    // Nuevo canje de la MISMA asignación e intento.
    useParticipantAuth.getState().setSession({ token: SECOND_JWT, assignmentId: ASSIGNMENT_ID });

    expect(store().syncBlock).toBeNull();
    expect(queuedIds()).toEqual([1]); // la cola del mismo intento se conserva
    expect(store().answers[1]?.value).toEqual(single(10));

    await resumeSync(); // lo que hace el runner tras validar el acceso con /yo
    expect(queuedIds()).toEqual([]);
    expect(seenAuth).toEqual([`Bearer ${SECOND_JWT}`]);
    expect(store().syncBlock).toBeNull();
  });

  it("el 401 tardío de una petición del JWT anterior no bloquea la sesión nueva", async () => {
    const gate = deferred();
    mockRuntimeApi({
      put: async () => {
        await gate.promise;
        return fail(401, "UNAUTHORIZED", "token vencido");
      },
    });
    const pending = setAnswer(1, single(10), undefined, 70); // vuela con el JWT anterior

    await tick();
    useParticipantAuth.getState().setSession({ token: SECOND_JWT, assignmentId: ASSIGNMENT_ID });
    gate.resolve();
    await pending;

    expect(store().syncBlock).toBeNull(); // sin la corrección quedaba UNAUTHORIZED (la asignación coincidía)
    expect(queuedIds()).toEqual([1]); // la respuesta no se pierde: sale con el JWT nuevo
  });

  it("un canje de OTRA asignación no renueva el draft (lo descarta bindDraftOwner, como antes)", () => {
    const epochBefore = store().epoch;
    useParticipantAuth.getState().setSession({ token: SECOND_JWT, assignmentId: ASSIGNMENT_ID + 1 });
    expect(store().epoch).toBe(epochBefore);
  });
});

/**
 * Portado del legacy (participantService.test.ts) antes de borrarlo en F-06: un cuerpo de bulk-sync inesperado
 * nunca confirma ni rechaza nada; la cola se conserva para reintentar.
 */
describe("F-06 · bulk-sync con cuerpo inesperado conserva la cola", () => {
  const rejectedIds = () => Object.keys(store().rejectedAnswers);

  it("raíz que no es una lista: no confirma nada y no registra rechazos", async () => {
    mockRuntimeApi({ bulk: () => ok({ unexpected: true }) });
    enqueue(11, 1);
    enqueue(12, 2);
    await flush({ force: true });
    expect(queuedIds().sort()).toEqual([11, 12]);
    expect(rejectedIds()).toEqual([]);
  });

  it("envelope success:false: el lote no confirma nada; cada ítem sale de la cola solo si su PUT lo confirma", async () => {
    const calls = mockRuntimeApi({
      bulk: () => HttpResponse.json({ success: false, data: null, message: "Error", error: { code: "ERROR", message: "Error" } }),
      put: (itemId) => (itemId === 11 ? ok(receipt(itemId)) : fail(503, "ERROR")),
    });
    enqueue(11, 1);
    enqueue(12, 2);
    await flush({ force: true });
    // 11 confirmado por su PUT individual; 12 (PUT 503) sigue en cola. Nada se rechaza.
    expect(calls.puts.map((p) => p.itemId).sort()).toEqual([11, 12]);
    expect(queuedIds()).toEqual([12]);
    expect(rejectedIds()).toEqual([]);
  });

  it("filas mal formadas o ausentes: solo se confirma lo que llegó bien", async () => {
    mockRuntimeApi({ bulk: () => ok([bulkResult(11, "GUARDADA"), { status: "GUARDADA" }]) });
    enqueue(11, 1);
    enqueue(12, 2);
    await flush({ force: true });
    expect(queuedIds()).toEqual([12]);
    expect(rejectedIds()).toEqual([]);
  });
});
