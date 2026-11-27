import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { delay, http, HttpResponse } from "msw";
import { setNavigator } from "../../../api/client";
import { ApiError } from "../../../api/errors";
import { useParticipantAuth } from "../../../store/participantAuth";
import { server } from "../../../test/msw/server";
import {
  createEvaluationGuard,
  evaluationGuard,
  fetchEvaluationWithTicket,
  inheritEvaluationTicket,
  isTicketCurrent,
} from "../evaluation-guard";

describe("evaluation-guard (F2-FIX-4)", () => {
  it("una solicitud vieja que llega DESPUÉS de una nueva ya aplicada no es vigente (orden de inicio, no de llegada)", () => {
    const guard = createEvaluationGuard(() => "42:jwt");
    const older = guard.startRequest();
    const newer = guard.startRequest();
    // La nueva llega primero y se aplica.
    expect(guard.isCurrent(newer)).toBe(true);
    guard.markApplied(newer);
    // La vieja llega después: no pisa.
    expect(guard.isCurrent(older)).toBe(false);
  });

  it("una solicitud vieja que llega ANTES que la nueva sí se aplica y la nueva sigue vigente", () => {
    const guard = createEvaluationGuard(() => "42:jwt");
    const older = guard.startRequest();
    const newer = guard.startRequest();
    expect(guard.isCurrent(older)).toBe(true);
    guard.markApplied(older);
    expect(guard.isCurrent(newer)).toBe(true);
  });

  it("ocultar la pestaña invalida lo iniciado antes; lo iniciado después es vigente", () => {
    const guard = createEvaluationGuard(() => "42:jwt");
    const before = guard.startRequest();
    guard.invalidateForVisibility();
    const after = guard.startRequest();
    expect(guard.isCurrent(before)).toBe(false);
    expect(guard.isCurrent(after)).toBe(true);
  });

  it("un cambio de dueño (asignación o token) invalida las solicitudes en vuelo", () => {
    let owner = "42:jwt-a";
    const guard = createEvaluationGuard(() => owner);
    const ticket = guard.startRequest();
    owner = "42:jwt-b";
    expect(guard.isCurrent(ticket)).toBe(false);
    expect(guard.isCurrent(guard.startRequest())).toBe(true);
  });

  it("asocia resultados y errores a su ticket por identidad; sin ticket (dato local) es vigente", () => {
    const guard = createEvaluationGuard(() => "42:jwt");
    const ticket = guard.startRequest();
    const data = { assignmentId: 42 };
    const error = new Error("boom");
    guard.register(data, ticket);
    guard.register(error, ticket);
    expect(guard.ticketOf(data)).toBe(ticket);
    expect(guard.ticketOf(error)).toBe(ticket);
    expect(guard.ticketOf({ assignmentId: 42 })).toBeUndefined();
    expect(guard.ticketOf("texto")).toBeUndefined();
    expect(guard.ticketOf(null)).toBeUndefined();
    expect(guard.isCurrent(undefined)).toBe(true);
  });
});

describe("isTicketCurrent (F2-FIX-6)", () => {
  it("un dato cuya solicitud se invalidó por visibilidad deja de ser vigente; un dato sin ticket sí lo es", () => {
    const data = { assignmentId: 42 };
    evaluationGuard.register(data, evaluationGuard.startRequest());
    expect(isTicketCurrent(data)).toBe(true);
    evaluationGuard.invalidateForVisibility();
    expect(isTicketCurrent(data)).toBe(false);
    expect(isTicketCurrent({ assignmentId: 42 })).toBe(true);
    // Una solicitud iniciada después de la ocultación es vigente.
    const later = { assignmentId: 42 };
    evaluationGuard.register(later, evaluationGuard.startRequest());
    expect(isTicketCurrent(later)).toBe(true);
  });
});

describe("401 de un /yo invalidado (F2-FIX-7)", () => {
  const API = "http://localhost:8080";
  const navigate = vi.fn();

  beforeEach(() => {
    navigate.mockReset();
    setNavigator(navigate, () => "/evaluacion/subtests/10/items/1");
    useParticipantAuth.getState().setSession({ token: "jwt-42", assignmentId: 42 });
  });
  afterEach(() => {
    setNavigator(null);
    useParticipantAuth.getState().clear();
  });

  async function yoWith401(invalidateBeforeResponse: boolean) {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started = false;
    server.use(
      http.get(`${API}/evaluacion-participante/yo`, async () => {
        started = true;
        await gate;
        return HttpResponse.json(
          { success: false, data: null, error: { code: "NO_AUTORIZADO", message: "x" }, correlationId: "c" },
          { status: 401 },
        );
      }),
    );
    const pending = fetchEvaluationWithTicket().catch((e: unknown) => e);
    while (!started) await delay(5);
    // Se oculta la pestaña con el /yo en vuelo; la respuesta llega después con 401 y el MISMO JWT.
    if (invalidateBeforeResponse) evaluationGuard.invalidateForVisibility();
    release();
    return (await pending) as ApiError;
  }

  it("un 401 de un /yo cuyo ticket fue invalidado NO cierra la sesión ni navega; el error queda asociado a su ticket (el guard lo descarta)", async () => {
    const error = await yoWith401(true);

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(401);
    expect(useParticipantAuth.getState().token).toBe("jwt-42");
    expect(navigate).not.toHaveBeenCalled();
    expect(isTicketCurrent(error)).toBe(false);
  });

  it("sin regresión · un 401 de un /yo VIGENTE sigue cerrando la sesión y navegando a acceso", async () => {
    const error = await yoWith401(false);

    expect(error.status).toBe(401);
    expect(useParticipantAuth.getState().token).toBeNull();
    expect(navigate).toHaveBeenCalledWith({ to: "/evaluacion/acceso", replace: true });
  });
});

describe("inheritEvaluationTicket (F2-FIX-8)", () => {
  it("la copia derivada conserva el MISMO ticket de la fuente: si la fuente se invalida, la copia también", () => {
    const source = { assignmentId: 42 };
    const ticket = evaluationGuard.startRequest();
    evaluationGuard.register(source, ticket);
    const copy = inheritEvaluationTicket(source, { ...source, extra: true });
    expect(evaluationGuard.ticketOf(copy)).toBe(ticket);
    expect(isTicketCurrent(copy)).toBe(true);

    evaluationGuard.invalidateForVisibility();
    expect(isTicketCurrent(source)).toBe(false);
    expect(isTicketCurrent(copy)).toBe(false);
  });

  it("una fuente sin ticket (dato local) no asigna ninguno a la copia", () => {
    const copy = inheritEvaluationTicket({ assignmentId: 42 }, { assignmentId: 42 });
    expect(evaluationGuard.ticketOf(copy)).toBeUndefined();
    expect(isTicketCurrent(copy)).toBe(true);
  });
});

