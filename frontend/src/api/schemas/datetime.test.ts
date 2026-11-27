import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { normalizeServerDateTime, parseServerDateTime, serverDateTime, toServerDateTime } from "./datetime";
import { AssignedParticipantSchema, AssignmentSchema, SessionPauseSchema, SessionSchema } from "./sessions";

const ORIGINAL_TZ = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "America/Managua"; // UTC-6 sin horario de verano
});
afterAll(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

describe("serverDateTime (lectura)", () => {
  it("un valor sin offset es UTC: se le agrega Z y se normaliza a ISO", () => {
    expect(serverDateTime.parse("2026-11-24T14:00:00")).toBe("2026-11-24T14:00:00.000Z");
    expect(serverDateTime.parse("2026-11-24T14:00:00.123456")).toBe("2026-11-24T14:00:00.123Z");
  });

  it("respeta el offset cuando el backend lo manda", () => {
    expect(serverDateTime.parse("2026-11-24T14:00:00Z")).toBe("2026-11-24T14:00:00.000Z");
    expect(serverDateTime.parse("2026-11-24T08:00:00-06:00")).toBe("2026-11-24T14:00:00.000Z");
    expect(serverDateTime.parse("2026-11-24T14:00:00+0000")).toBe("2026-11-24T14:00:00.000Z");
  });

  it("rechaza fechas inválidas", () => {
    expect(serverDateTime.safeParse("nope").success).toBe(false);
    expect(serverDateTime.safeParse("2026-13-45T10:00:00").success).toBe(false);
    expect(serverDateTime.safeParse("").success).toBe(false);
    expect(serverDateTime.safeParse(5).success).toBe(false);
  });

  it("normalizeServerDateTime / parseServerDateTime devuelven null si no es válido", () => {
    expect(normalizeServerDateTime(null)).toBeNull();
    expect(normalizeServerDateTime("x")).toBeNull();
    expect(parseServerDateTime("2026-11-24T14:00:00")).toBe(Date.UTC(2026, 10, 24, 14, 0, 0));
  });

  it("los schemas de sesiones aplican la regla a TODOS sus campos de fecha", () => {
    const session = SessionSchema.parse({
      id: 1,
      codigoSesion: "S",
      nombreSesion: "N",
      estado: "PAUSADA",
      versionTestId: 1,
      inicioProgramado: "2026-11-24T10:00:00",
      finProgramado: "2026-11-24T12:00:00",
      inicioReal: "2026-11-24T10:02:00",
      finReal: "2026-11-24T11:50:00",
      pausadoEn: "2026-11-24T10:30:00",
    });
    expect(session).toMatchObject({
      scheduledStart: "2026-11-24T10:00:00.000Z",
      scheduledEnd: "2026-11-24T12:00:00.000Z",
      actualStart: "2026-11-24T10:02:00.000Z",
      actualEnd: "2026-11-24T11:50:00.000Z",
      pausedAt: "2026-11-24T10:30:00.000Z",
    });

    expect(
      SessionPauseSchema.parse({ id: 1, pausadoEn: "2026-11-24T10:30:00", reanudadoEn: "2026-11-24T10:40:00" }),
    ).toMatchObject({ pausedAt: "2026-11-24T10:30:00.000Z", resumedAt: "2026-11-24T10:40:00.000Z" });

    expect(
      AssignedParticipantSchema.parse({ assignmentId: 1, rawToken: "t", expiresAt: "2026-11-24T14:00:00" }).expiresAt,
    ).toBe("2026-11-24T14:00:00.000Z");

    const assignment = AssignmentSchema.parse({
      assignmentId: 1,
      participantId: "p",
      participantName: "n",
      status: "ACTIVO",
      state: "en-progreso",
      overallProgress: 10,
      lastActivity: "2026-11-24T14:20:00",
      tokenExpiraEn: "2026-11-24T22:00:00",
    });
    expect(assignment.lastActivityAt).toBe("2026-11-24T14:20:00.000Z");
    expect(assignment.tokenExpiresAt).toBe("2026-11-24T22:00:00.000Z");
    // El centinela "Nunca" sigue siendo "sin actividad" (no una fecha inválida).
    expect(
      AssignmentSchema.parse({
        assignmentId: 1,
        participantId: "p",
        participantName: "n",
        status: "ACTIVO",
        state: "no-iniciado",
        overallProgress: 0,
        lastActivity: "Nunca",
      }).lastActivityAt,
    ).toBeNull();
  });

  it("una fecha inválida en una sesión provoca fallo de parseo (no se muestra basura)", () => {
    expect(
      SessionSchema.safeParse({
        id: 1,
        codigoSesion: "S",
        nombreSesion: "N",
        estado: "ABIERTA",
        versionTestId: 1,
        inicioProgramado: "ayer",
      }).success,
    ).toBe(false);
  });
});

describe("toServerDateTime (escritura)", () => {
  it("devuelve YYYY-MM-DDTHH:mm:ss en UTC, sin Z, desde la hora local del navegador", () => {
    // 09:00 hora de Managua (UTC-6) = 15:00 UTC
    expect(toServerDateTime(new Date("2026-11-24T09:00:00"))).toBe("2026-11-24T15:00:00");
    expect(toServerDateTime(new Date("2026-11-24T20:30:15-06:00"))).toBe("2026-11-25T02:30:15");
    expect(toServerDateTime(new Date(Date.UTC(2026, 0, 2, 3, 4, 5, 999)))).toBe("2026-01-02T03:04:05");
  });

  it("ida y vuelta: lo escrito se lee como el mismo instante", () => {
    const date = new Date("2026-11-24T09:00:00");
    expect(new Date(serverDateTime.parse(toServerDateTime(date))).getTime()).toBe(date.getTime());
  });
});
