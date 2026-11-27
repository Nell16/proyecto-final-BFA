import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { ApiError } from "../errors";
import sessionsFixture from "../schemas/__fixtures__/sessions/sessions.json";
import pausesFixture from "../schemas/__fixtures__/sessions/pauses.json";
import subtestsFixture from "../schemas/__fixtures__/sessions/subtests.json";
import assignedParticipantFixture from "../schemas/__fixtures__/sessions/assigned-participant.json";
import assignmentsFixture from "../schemas/__fixtures__/sessions/assignments.json";
import {
  SESSION_TRANSITIONS,
  assignParticipant,
  buildAccessCode,
  cancelSession,
  closeSession,
  createSession,
  getSession,
  listAssignments,
  listPauses,
  listSessions,
  openSession,
  pauseSession,
  recordIncidence,
  replaceSessionSubtests,
  resumeSession,
  revokeAssignment,
} from "./sessions";

const API = "http://localhost:8080";

const ok = <T,>(data: T) => HttpResponse.json({ success: true, data, message: "OK", error: null });

describe("buildAccessCode", () => {
  it("concatena assignmentId y rawToken con guion", () => {
    expect(buildAccessCode(501, "tok-secret-987")).toBe("501-tok-secret-987");
  });
});

describe("SESSION_TRANSITIONS", () => {
  it("define las transiciones permitidas según la máquina de estados", () => {
    expect(SESSION_TRANSITIONS).toEqual({
      PROGRAMADA: { open: true, pause: false, resume: false, close: false, cancel: true },
      ABIERTA: { open: false, pause: true, resume: false, close: true, cancel: true },
      PAUSADA: { open: false, pause: false, resume: true, close: true, cancel: true },
      CERRADA: { open: false, pause: false, resume: false, close: false, cancel: false },
      CANCELADA: { open: false, pause: false, resume: false, close: false, cancel: false },
      DESCONOCIDO: { open: false, pause: false, resume: false, close: false, cancel: false },
    });
  });
});

describe("endpoints de sesiones", () => {
  it("listSessions parsea el fixture real y transforma al modelo de dominio", async () => {
    server.use(http.get(`${API}/sesiones`, () => ok(sessionsFixture)));

    const result = await listSessions();

    expect(result).toEqual([
      {
        id: 1,
        code: "SES-2026-01",
        name: "Evaluación Ingreso 2026",
        description: "Aplicación matutina grupo A",
        status: "PROGRAMADA",
        scheduledStart: "2026-11-24T09:00:00.000Z",
        scheduledEnd: "2026-11-24T12:00:00.000Z",
        location: "Laboratorio 2",
        versionTestId: 10,
      },
      {
        id: 2,
        code: "SES-2026-02",
        name: "Evaluación Vespertina",
        status: "PAUSADA",
        scheduledStart: "2026-11-24T14:00:00.000Z",
        actualStart: "2026-11-24T14:02:00.000Z",
        versionTestId: 10,
        pausedAt: "2026-11-24T14:25:00.000Z",
      },
    ]);
  });

  it("listSessions tolera campos desconocidos del backend y hace fallback de estado", async () => {
    server.use(
      http.get(`${API}/sesiones`, () =>
        ok([
          {
            ...sessionsFixture[0],
            estado: "ESTADO_FUTURO",
            campoNuevoInesperado: "tolerado",
          },
        ]),
      ),
    );

    const result = await listSessions();

    expect(result[0]?.status).toBe("DESCONOCIDO");
    expect(result[0]?.code).toBe("SES-2026-01");
  });

  it("listSessions lanza CONTRACT_MISMATCH si falta un campo requerido", async () => {
    server.use(http.get(`${API}/sesiones`, () => ok([{ id: 1 }])));

    const err = (await listSessions().catch((e: unknown) => e)) as ApiError;

    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("CONTRACT_MISMATCH");
  });

  it("listSessions propaga error del envelope con success=false", async () => {
    server.use(
      http.get(`${API}/sesiones`, () =>
        HttpResponse.json(
          { success: false, data: null, error: { code: "FORBIDDEN", message: "Sin permiso" } },
          { status: 200 },
        ),
      ),
    );

    const err = (await listSessions().catch((e: unknown) => e)) as ApiError;

    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("FORBIDDEN");
    expect(err.message).toBe("Sin permiso");
  });

  it("getSession obtiene el detalle por id", async () => {
    server.use(http.get(`${API}/sesiones/2`, () => ok(sessionsFixture[1])));

    const result = await getSession(2);

    expect(result.id).toBe(2);
    expect(result.status).toBe("PAUSADA");
    expect(result.pausedAt).toBe("2026-11-24T14:25:00.000Z");
  });

  it("createSession envía CreateSessionRequest y devuelve Session", async () => {
    let sentBody: unknown;
    server.use(
      http.post(`${API}/sesiones`, async ({ request }) => {
        sentBody = await request.json();
        return ok(sessionsFixture[0]);
      }),
    );

    const payload = {
      versionTestId: 10,
      code: "SES-2026-01",
      name: "Evaluación Ingreso 2026",
      description: "Aplicación matutina grupo A",
      scheduledStart: "2026-11-24T09:00:00",
      scheduledEnd: "2026-11-24T12:00:00",
      location: "Laboratorio 2",
    };

    const result = await createSession(payload);

    expect(sentBody).toEqual(payload);
    expect(result.id).toBe(1);
    expect(result.status).toBe("PROGRAMADA");
  });

  it("openSession, closeSession y cancelSession transicionan la sesión", async () => {
    server.use(
      http.post(`${API}/sesiones/1/activar`, () =>
        ok({ ...sessionsFixture[0], estado: "ABIERTA", inicioReal: "2026-11-24T09:01:00" }),
      ),
      http.post(`${API}/sesiones/1/cerrar`, () =>
        ok({ ...sessionsFixture[0], estado: "CERRADA", finReal: "2026-11-24T11:50:00" }),
      ),
      http.post(`${API}/sesiones/1/cancelar`, () =>
        ok({ ...sessionsFixture[0], estado: "CANCELADA", finReal: "2026-11-24T09:10:00" }),
      ),
    );

    const opened = await openSession(1);
    const closed = await closeSession(1);
    const canceled = await cancelSession(1);

    expect(opened.status).toBe("ABIERTA");
    expect(opened.actualStart).toBe("2026-11-24T09:01:00.000Z");
    expect(closed.status).toBe("CERRADA");
    expect(closed.actualEnd).toBe("2026-11-24T11:50:00.000Z");
    expect(canceled.status).toBe("CANCELADA");
  });

  it("pauseSession envía motivo opcional y resumeSession reanuda la sesión", async () => {
    let pauseBody: unknown;
    server.use(
      http.post(`${API}/sesiones/2/pausar`, async ({ request }) => {
        pauseBody = await request.json();
        return ok(sessionsFixture[1]);
      }),
      http.post(`${API}/sesiones/2/reanudar`, () =>
        ok({ ...sessionsFixture[1], estado: "ABIERTA", pausadoEn: null }),
      ),
    );

    const paused = await pauseSession(2, { motivo: "Falla eléctrica" });
    const resumed = await resumeSession(2);

    expect(pauseBody).toEqual({ motivo: "Falla eléctrica" });
    expect(paused.status).toBe("PAUSADA");
    expect(paused.pausedAt).toBe("2026-11-24T14:25:00.000Z");
    expect(resumed.status).toBe("ABIERTA");
    expect(resumed.pausedAt).toBeUndefined();
  });

  it("pauseSession propaga conflicto 409 del backend", async () => {
    server.use(
      http.post(`${API}/sesiones/1/pausar`, () =>
        HttpResponse.json(
          { success: false, data: null, error: { code: "CONFLICT", message: "Transición inválida" } },
          { status: 409 },
        ),
      ),
    );

    const err = (await pauseSession(1).catch((e: unknown) => e)) as ApiError;

    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(409);
    expect(err.code).toBe("CONFLICT");
  });

  it("listPauses parsea el historial de pausas y tolera campos extra", async () => {
    server.use(
      http.get(`${API}/sesiones/2/pausas`, () =>
        ok(pausesFixture.map((item) => ({ ...item, extraField: 123 }))),
      ),
    );

    const result = await listPauses(2);

    expect(result).toEqual([
      {
        id: 11,
        pausedAt: "2026-11-24T14:10:00.000Z",
        resumedAt: "2026-11-24T14:15:00.000Z",
        pausedBy: "550e8400-e29b-41d4-a716-446655440000",
        reason: "Falla eléctrica breve",
      },
      {
        id: 12,
        pausedAt: "2026-11-24T14:25:00.000Z",
        resumedAt: null,
        pausedBy: "550e8400-e29b-41d4-a716-446655440000",
        reason: null,
      },
    ]);
  });

  it("replaceSessionSubtests envía SessionSubtestRequest[] y parsea la respuesta", async () => {
    let sentBody: unknown;
    server.use(
      http.put(`${API}/sesiones/1/subtests`, async ({ request }) => {
        sentBody = await request.json();
        return ok(subtestsFixture);
      }),
    );

    const requestPayload = [
      { subtestId: 201, order: 1, timeLimitSeconds: 600, randomizeItems: true, randomizeOptions: false },
      { subtestId: 202, order: 2, randomizeItems: false, randomizeOptions: true },
    ];

    const result = await replaceSessionSubtests(1, requestPayload);

    expect(sentBody).toEqual(requestPayload);
    expect(result).toEqual([
      {
        id: 1001,
        sessionId: 1,
        versionTestId: 10,
        subtestId: 201,
        order: 1,
        timeLimitSeconds: 600,
        randomizeItems: true,
        randomizeOptions: false,
      },
      {
        id: 1002,
        sessionId: 1,
        versionTestId: 10,
        subtestId: 202,
        order: 2,
        randomizeItems: false,
        randomizeOptions: true,
      },
    ]);
  });

  it("assignParticipant envía participantId/ttlHours y parsea AssignedParticipant", async () => {
    let sentBody: unknown;
    server.use(
      http.post(`${API}/sesiones/1/asignaciones`, async ({ request }) => {
        sentBody = await request.json();
        return ok({ ...assignedParticipantFixture, extraInfo: "ignored" });
      }),
    );

    const result = await assignParticipant(1, {
      participantId: "11111111-2222-3333-4444-555555555555",
      ttlHours: 8,
    });

    expect(sentBody).toEqual({
      participantId: "11111111-2222-3333-4444-555555555555",
      ttlHours: 8,
    });
    expect(result).toEqual({
      assignmentId: 501,
      rawToken: "tok-secret-987",
      expiresAt: "2026-11-24T22:00:00.000Z",
    });
  });

  it("listAssignments normaliza centinelas del backend y tolera campos desconocidos", async () => {
    server.use(
      http.get(`${API}/sesiones/1/asignaciones`, () =>
        ok([
          ...assignmentsFixture,
          {
            ...assignmentsFixture[0],
            assignmentId: 504,
            status: "NUEVO_ESTADO",
            state: "estado-futuro",
            extraProp: true,
          },
        ]),
      ),
    );

    const result = await listAssignments(1);

    expect(result[0]).toEqual({
      assignmentId: 501,
      attemptId: null,
      participantId: "11111111-2222-3333-4444-555555555555",
      participantName: "Ana López",
      participantCode: "P-001",
      linkStatus: "GENERADO",
      attemptState: "no-iniciado",
      currentSubtestId: null,
      progress: 0,
      lastActivityAt: null,
      tokenExpiresAt: "2026-11-24T22:00:00.000Z",
      rejectedAnswersCount: 0,
      rejectedAnswers: [],
    });
    expect(result[1]?.currentSubtestId).toBe("SUB-01");
    expect(result[1]?.progress).toBe(50);
    expect(result[1]?.lastActivityAt).toBe("2026-11-24T14:20:00.000Z");
    expect(result[2]?.participantCode).toBeUndefined();
    expect(result[2]?.tokenExpiresAt).toBeNull();
    expect(result[3]?.linkStatus).toBe("DESCONOCIDO");
    expect(result[3]?.attemptState).toBe("DESCONOCIDO");
  });

  it("listAssignments parsea rejectedAnswersCount y rejectedAnswers cuando el backend los envía (B17)", async () => {
    server.use(
      http.get(`${API}/sesiones/1/asignaciones`, () =>
        ok([
          {
            ...assignmentsFixture[1],
            rejectedAnswers: [
              { itemId: 1002, code: "TIEMPO_AGOTADO", rejectedAt: "2026-11-24T14:21:00" },
              { itemId: 1005, code: "SUBTEST_FINALIZADO", rejectedAt: null },
            ],
          },
          {
            ...assignmentsFixture[2],
            rejectedAnswersCount: 3,
          },
        ]),
      ),
    );

    const result = await listAssignments(1);

    expect(result[0]?.rejectedAnswersCount).toBe(2);
    expect(result[0]?.rejectedAnswers).toEqual([
      { itemId: 1002, code: "TIEMPO_AGOTADO", rejectedAt: "2026-11-24T14:21:00.000Z" },
      { itemId: 1005, code: "SUBTEST_FINALIZADO", rejectedAt: null },
    ]);
    expect(result[1]?.rejectedAnswersCount).toBe(3);
    expect(result[1]?.rejectedAnswers).toEqual([]);
  });

  it("listAssignments rechaza progreso fuera de 0-100 con CONTRACT_MISMATCH", async () => {
    server.use(
      http.get(`${API}/sesiones/1/asignaciones`, () =>
        ok([{ ...assignmentsFixture[0], overallProgress: 150 }]),
      ),
    );

    const err = (await listAssignments(1).catch((e: unknown) => e)) as ApiError;

    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("CONTRACT_MISMATCH");
  });

  it("revokeAssignment revoca asignación y falla si el envelope indica error", async () => {
    server.use(http.post(`${API}/sesiones/1/asignaciones/501/revocar`, () => ok(null)));

    await expect(revokeAssignment(1, 501)).resolves.toBeUndefined();

    server.use(
      http.post(`${API}/sesiones/1/asignaciones/501/revocar`, () =>
        HttpResponse.json(
          { success: false, data: null, error: { code: "NOT_FOUND", message: "No existe" } },
          { status: 404 },
        ),
      ),
    );

    const err = (await revokeAssignment(1, 501).catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(404);
    expect(err.code).toBe("NOT_FOUND");
  });

  it("recordIncidence envía {participantId, text} y maneja errores del envelope", async () => {
    let sentBody: unknown;
    server.use(
      http.post(`${API}/sesiones/1/incidencias`, async ({ request }) => {
        sentBody = await request.json();
        return ok(null);
      }),
    );

    const payload = {
      participantId: "11111111-2222-3333-4444-555555555555",
      text: "Se desconectó 2 minutos",
    };

    await expect(recordIncidence(1, payload)).resolves.toBeUndefined();
    expect(sentBody).toEqual(payload);

    server.use(
      http.post(`${API}/sesiones/1/incidencias`, () =>
        HttpResponse.json(
          { success: false, data: null, error: { code: "SESSION_ERROR", message: "No registrada" } },
          { status: 200 },
        ),
      ),
    );

    const err = (await recordIncidence(1, payload).catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("SESSION_ERROR");
  });
});
