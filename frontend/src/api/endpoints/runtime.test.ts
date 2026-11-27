import { beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { ApiError } from "../errors";
import { useParticipantAuth } from "../../store/participantAuth";
import accessValidateFixture from "../schemas/__fixtures__/runtime/access-validate.json";
import evaluationLegacyFixture from "../schemas/__fixtures__/runtime/evaluation-legacy.json";
import evaluationPausedFixture from "../schemas/__fixtures__/runtime/evaluation-paused.json";
import startSubtestFixture from "../schemas/__fixtures__/runtime/start-subtest.json";
import subtestItemsFixture from "../schemas/__fixtures__/runtime/subtest-items.json";
import {
  RUNTIME_ERROR_CODES,
  bulkSync,
  finishAttempt,
  finishSubtest,
  getEvaluation,
  getSubtestItems,
  isRuntimeBlocked,
  parseAccessCode,
  saveAnswer,
  startAttempt,
  startSubtest,
  validateAccess,
} from "./runtime";

const API = "http://localhost:8080";

beforeEach(() => {
  useParticipantAuth.getState().clear();
  useParticipantAuth.getState().setSession({ token: "participant-jwt", assignmentId: 42 });
});

describe("parseAccessCode", () => {
  it("acepta formato directo assignmentId-token incluyendo guiones en el token", () => {
    expect(parseAccessCode("123-abc")).toEqual({ assignmentId: 123, token: "abc" });
    expect(parseAccessCode("  42-tok-con-guiones-99  ")).toEqual({
      assignmentId: 42,
      token: "tok-con-guiones-99",
    });
  });

  it("acepta URLs completas o rutas que terminen en /evaluacion/123-abc", () => {
    expect(parseAccessCode("https://bfa.uam.mx/evaluacion/123-abc")).toEqual({
      assignmentId: 123,
      token: "abc",
    });
    expect(parseAccessCode("http://localhost:5173/evaluacion/77-xyz-123/")).toEqual({
      assignmentId: 77,
      token: "xyz-123",
    });
    expect(parseAccessCode("https://bfa.uam.mx/evaluacion/88-tok?foo=bar#sec")).toEqual({
      assignmentId: 88,
      token: "tok",
    });
    expect(parseAccessCode("/evaluacion/99-ruta-relativa")).toEqual({
      assignmentId: 99,
      token: "ruta-relativa",
    });
  });

  it.each([
    "",
    "   ",
    "solo-letras",
    "sinGuion",
    "-tokenSinId",
    "123-",
    "0-token",
    "-5-token",
    "1e2-token",
    "1.5-token",
    "123-con espacio",
    "https://bfa.uam.mx/otra-ruta/123-abc",
    "https://bfa.uam.mx/evaluacion/123-abc/subtests",
    "https://bfa.uam.mx/evaluacion/invalido",
  ])("rechaza '%s' con ApiError INVALID_ACCESS_CODE", (raw) => {
    let thrown: unknown;
    try {
      parseAccessCode(raw);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(ApiError);
    expect((thrown as ApiError).code).toBe("INVALID_ACCESS_CODE");
  });
});

describe("validateAccess", () => {
  it("envía { assignmentId, token } y parsea respuesta real", async () => {
    let seenBody: unknown;
    server.use(
      http.post(`${API}/acceso-participante/validar`, async ({ request }) => {
        seenBody = await request.json();
        return HttpResponse.json(accessValidateFixture);
      }),
    );

    const res = await validateAccess("https://bfa.uam.mx/evaluacion/42-secret-token");

    expect(seenBody).toEqual({ assignmentId: 42, token: "secret-token" });
    expect(res).toEqual({
      assignmentId: 42,
      participantId: "550e8400-e29b-41d4-a716-446655440000",
      accessToken: "eyJhbGciOiJIUzI1NiJ9.participant-token",
      tokenType: "Bearer",
    });
  });
});

describe("getEvaluation (/evaluacion-participante/yo)", () => {
  it("parsea payload real sin campos futuros de pausa/timing y ordena subtests, ítems, opciones e imágenes", async () => {
    server.use(
      http.get(`${API}/evaluacion-participante/yo`, () => HttpResponse.json(evaluationLegacyFixture)),
    );

    const ev = await getEvaluation();

    expect(ev.attemptId).toBeNull();
    expect(ev.assignmentId).toBe(42);
    expect(ev.sessionId).toBe(7);
    expect(ev.participantName).toBe("Ana Pérez Gómez");
    expect(ev.sessionName).toBe("Evaluación Cohorte 2026-1");
    expect(ev.sessionStatus).toBe("ABIERTA");
    expect(ev.attemptStatus).toBe("NO_INICIADO");
    expect(ev.pausedAt).toBeUndefined();

    expect(ev.subtests.map((s) => s.order)).toEqual([1, 2]);

    const first = ev.subtests[0];
    expect(first.id).toBe(10);
    expect(first.timeLimitSeconds).toBe(600);
    expect(first.timing).toBeUndefined();
    expect(first.items.map((i) => i.order)).toEqual([1, 2]);

    const item1 = first.items[0];
    expect(item1.id).toBe(101);
    expect(item1.itemType).toBe("RAZONAMIENTO_VERBAL");
    expect(item1.responseType).toBe("OPCION_UNICA");
    expect(item1.options.map((o) => o.label)).toEqual(["A", "B", "C"]);

    const item2 = first.items[1];
    expect(item2.images.map((img) => img.order)).toEqual([1, 2]);
    expect(item2.images[0]).toEqual({
      id: 501,
      url: "/items/images/resources/901",
      altText: "Figura A",
      order: 1,
      role: "ESTIMULO",
    });
    expect(item2.options.map((o) => o.id)).toEqual([1001, 1002]);
    expect(item2.options.map((o) => o.label)).toEqual(["A", "B"]);
    expect(item2.options[1].images[0].role).toBeUndefined();

    const second = ev.subtests[1];
    expect(second.timeLimitSeconds).toBeNull();
    expect(second.instructions).toBeUndefined();
  });

  it("parsea payload real con campos futuros de pausa, timing y savedAnswer presentes", async () => {
    server.use(
      http.get(`${API}/evaluacion-participante/yo`, () => HttpResponse.json(evaluationPausedFixture)),
    );

    const ev = await getEvaluation();

    expect(ev.attemptId).toBe(101);
    expect(ev.sessionStatus).toBe("PAUSADA");
    expect(ev.pausedAt).toBe("2026-11-24T21:10:00.000Z");
    expect(ev.attemptStatus).toBe("EN_PROGRESO");

    const active = ev.subtests[0];
    expect(active.timing).toEqual({
      startedAt: "2026-11-24T21:05:00.000Z",
      remainingSeconds: 400,
      paused: true,
      serverNow: "2026-11-24T21:12:00.000Z",
    });
    expect(active.items[0].savedAnswer).toEqual({
      selectedOptionIds: [901],
      timeUsedSeconds: 18,
    });

    const pending = ev.subtests[1];
    expect(pending.timing).toEqual({
      paused: false,
      serverNow: "2026-11-24T21:12:00.000Z",
    });
  });

  it("tolera campos desconocidos en el wire y aplica fallback DESCONOCIDO en estados desconocidos", async () => {
    server.use(
      http.get(`${API}/evaluacion-participante/yo`, () =>
        HttpResponse.json({
          success: true,
          data: {
            ...evaluationLegacyFixture.data,
            campoNuevo: "ignorado",
            sessionStatus: "ESTADO_FUTURO",
            attemptStatus: "OTRO_ESTADO",
            subtests: [
              {
                ...evaluationLegacyFixture.data.subtests[1],
                extraSubtest: 99,
                status: "NUEVO_ESTADO",
              },
            ],
          },
        }),
      ),
    );

    const ev = await getEvaluation();

    expect(ev.sessionStatus).toBe("DESCONOCIDO");
    expect(ev.attemptStatus).toBe("DESCONOCIDO");
    expect(ev.subtests[0].status).toBe("DESCONOCIDO");
  });

  it("lanza CONTRACT_MISMATCH si falta un campo obligatorio o tipoItem no es válido", async () => {
    server.use(
      http.get(`${API}/evaluacion-participante/yo`, () =>
        HttpResponse.json({
          success: true,
          data: { assignmentId: 42 },
        }),
      ),
    );

    const errMissing = await getEvaluation().catch((e: unknown) => e);
    expect(errMissing).toBeInstanceOf(ApiError);
    expect((errMissing as ApiError).code).toBe("CONTRACT_MISMATCH");

    const badSubtest = {
      ...evaluationLegacyFixture.data.subtests[0],
      items: [
        {
          ...evaluationLegacyFixture.data.subtests[0].items[0],
          itemType: "TIPO_INVALIDO",
        },
      ],
    };
    server.use(
      http.get(`${API}/evaluacion-participante/yo`, () =>
        HttpResponse.json({
          success: true,
          data: {
            ...evaluationLegacyFixture.data,
            subtests: [badSubtest],
          },
        }),
      ),
    );

    const errEnum = await getEvaluation().catch((e: unknown) => e);
    expect(errEnum).toBeInstanceOf(ApiError);
    expect((errEnum as ApiError).code).toBe("CONTRACT_MISMATCH");

    server.use(
      http.get(`${API}/evaluacion-participante/yo`, () =>
        HttpResponse.json({
          success: true,
          data: {
            ...evaluationPausedFixture.data,
            pausedAt: "fecha-invalida",
          },
        }),
      ),
    );

    const errDate = await getEvaluation().catch((e: unknown) => e);
    expect(errDate).toBeInstanceOf(ApiError);
    expect((errDate as ApiError).code).toBe("CONTRACT_MISMATCH");
  });

  it("lanza ApiError cuando el envelope indica success: false", async () => {
    server.use(
      http.get(`${API}/evaluacion-participante/yo`, () =>
        HttpResponse.json({
          success: false,
          data: null,
          error: { code: "TOKEN_EXPIRADO", message: "Token expirado" },
          correlationId: "cid-err",
        }),
      ),
    );

    const err = await getEvaluation().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("TOKEN_EXPIRADO");
    expect((err as ApiError).correlationId).toBe("cid-err");
  });
});

describe("endpoints de ejecución del intento", () => {
  it("startAttempt y finishAttempt parsean EntityView de IntentoTest", async () => {
    server.use(
      http.post(`${API}/evaluacion-participante/iniciar`, () =>
        HttpResponse.json({
          success: true,
          data: {
            id: 101,
            asignacionId: 42,
            iniciadoEn: "2026-11-24T15:00:00",
            finalizadoEn: null,
            estado: "EN_PROGRESO",
            ultimoSubtest: null,
            ultimaActividadEn: "2026-11-24T15:00:00",
            tiempoTotalSegundos: null,
            informacionDispositivo: "Chrome/130",
          },
        }),
      ),
      http.post(`${API}/intentos/101/finalizar`, () =>
        HttpResponse.json({
          success: true,
          data: {
            id: 101,
            asignacionId: 42,
            iniciadoEn: "2026-11-24T15:00:00",
            finalizadoEn: "2026-11-24T15:20:00",
            estado: "COMPLETADO",
            tiempoTotalSegundos: 1200,
          },
        }),
      ),
    );

    const started = await startAttempt({ assignmentId: 42, deviceInfo: "Chrome/130" });
    expect(started).toEqual({
      id: 101,
      assignmentId: 42,
      status: "EN_PROGRESO",
      startedAt: "2026-11-24T15:00:00.000Z",
      lastActivityAt: "2026-11-24T15:00:00.000Z",
      deviceInfo: "Chrome/130",
    });

    const finished = await finishAttempt(101, { timeSeconds: 1200 });
    expect(finished.status).toBe("COMPLETADO");
    expect(finished.totalTimeSeconds).toBe(1200);
    expect(finished.finishedAt).toBe("2026-11-24T15:20:00.000Z");
  });

  it("startSubtest, getSubtestItems y finishSubtest parsean sus contratos reales", async () => {
    server.use(
      http.post(`${API}/intentos/101/subtests/10/iniciar`, () => HttpResponse.json(startSubtestFixture)),
      http.get(`${API}/intentos/101/subtests/10/items`, () => HttpResponse.json(subtestItemsFixture)),
      http.post(`${API}/intentos/101/subtests/10/finalizar`, () =>
        HttpResponse.json({
          success: true,
          data: {
            id: 305,
            intentoId: 101,
            subtestId: 10,
            iniciadoEn: "2026-11-24T15:05:00",
            finalizadoEn: "2026-11-24T15:10:00",
            estado: "COMPLETADO",
            tiempoUsadoSegundos: 300,
          },
        }),
      ),
    );

    const started = await startSubtest(101, 10);
    expect(started.id).toBe(305);
    expect(started.timing).toEqual({
      startedAt: "2026-11-24T21:05:00.000Z",
      remainingSeconds: 600,
      paused: false,
      serverNow: "2026-11-24T21:05:00.000Z",
    });

    const subtest = await getSubtestItems(101, 10);
    expect(subtest.items[0].options.map((o) => o.label)).toEqual(["V", "F"]);

    const finished = await finishSubtest(101, 10, { timeSeconds: 300 });
    expect(finished.status).toBe("COMPLETADO");
    expect(finished.timeUsedSeconds).toBe(300);
    expect(finished.startedAt).toBe("2026-11-24T15:05:00.000Z");
    expect(finished.finishedAt).toBe("2026-11-24T15:10:00.000Z");
  });

  it("saveAnswer y bulkSync envían los payloads esperados y parsean RespuestaItem", async () => {
    let seenPut: unknown;
    let seenBulk: unknown;

    server.use(
      http.put(`${API}/intentos/101/items/101/respuesta`, async ({ request }) => {
        seenPut = await request.json();
        return HttpResponse.json({
          success: true,
          data: {
            id: 700,
            intentoId: 101,
            itemId: 101,
            respondidoEn: "2026-11-24T15:06:00",
            tiempoUsadoSegundos: 12,
            esFinal: true,
            requiereRevisionManual: false,
          },
        });
      }),
      http.post(`${API}/intentos/101/respuestas/bulk-sync`, async ({ request }) => {
        seenBulk = await request.json();
        return HttpResponse.json({
          success: true,
          data: [
            { itemId: 201, status: "GUARDADA", code: null, answerId: 701 },
            { itemId: 202, status: "RECHAZADA", code: "OPCION_INVALIDA", answerId: null },
            { status: "GUARDADA" },
          ],
        });
      }),
    );

    const single = await saveAnswer(101, {
      itemId: 101,
      selectedOptionIds: [901],
      timeUsedSeconds: 12,
    });
    expect(seenPut).toEqual({ itemId: 101, selectedOptionIds: [901], timeUsedSeconds: 12 });
    expect(single.id).toBe(700);
    expect(single.isFinal).toBe(true);
    expect(single.answeredAt).toBe("2026-11-24T15:06:00.000Z");

    const synced = await bulkSync(101, [
      { itemId: 201, selectedOptionIds: [], numericAnswer: 4, timeUsedSeconds: 20 },
    ]);
    expect(seenBulk).toEqual([
      { itemId: 201, selectedOptionIds: [], numericAnswer: 4, timeUsedSeconds: 20 },
    ]);
    // Contrato real del backend (BulkSyncResult); la fila mal formada se descarta.
    expect(synced).toEqual([
      { itemId: 201, status: "GUARDADA", code: null, answerId: 701 },
      { itemId: 202, status: "RECHAZADA", code: "OPCION_INVALIDA", answerId: null },
    ]);
  });
});

describe("isRuntimeBlocked", () => {
  it("409 con SESION_PAUSADA devuelve true", async () => {
    server.use(
      http.put(`${API}/intentos/101/items/101/respuesta`, () =>
        HttpResponse.json(
          {
            success: false,
            data: null,
            error: {
              code: "SESION_PAUSADA",
              message: "La sesión está pausada por el aplicador",
            },
          },
          { status: 409 },
        ),
      ),
    );

    const err = await saveAnswer(101, { itemId: 101, selectedOptionIds: [901] }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect(isRuntimeBlocked(err)).toBe(true);
  });

  it("cubre todos los códigos de RUNTIME_ERROR_CODES en 409 y rechaza otros status o códigos", () => {
    for (const code of RUNTIME_ERROR_CODES) {
      expect(isRuntimeBlocked(new ApiError({ status: 409, code, message: "bloqueado" }))).toBe(true);
    }
    expect(isRuntimeBlocked(new ApiError({ status: 400, code: "SESION_PAUSADA", message: "x" }))).toBe(false);
    expect(isRuntimeBlocked(new ApiError({ status: 409, code: "OTRO_CONFLICTO", message: "x" }))).toBe(false);
    expect(isRuntimeBlocked(new Error("SESION_PAUSADA"))).toBe(false);
  });
});
