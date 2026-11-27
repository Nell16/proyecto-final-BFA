import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { delay, http, HttpResponse } from "msw";
import { server } from "../test/msw/server";
import { createApiClient, isParticipantRedeemPath, participantClient, setNavigator, staffClient } from "./client";
import { ApiError, toApiError, unwrap, type ApiEnvelope } from "./errors";
import { STAFF_AUTH_STORAGE_KEY, useStaffAuth } from "../store/staffAuth";
import { useParticipantAuth } from "../store/participantAuth";

const API = "http://localhost:8080";
const navigate = vi.fn();

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), warning: vi.fn(), dismiss: vi.fn() }) }));

const staffUser = { id: "u1", username: "ana", roles: ["APLICADOR"], permissions: ["SESION_APLICAR"] };

beforeEach(() => {
  vi.mocked(toast.error).mockClear();
  navigate.mockReset();
  setNavigator(navigate, () => "/app/sesiones");
  useStaffAuth.getState().clear();
  useParticipantAuth.getState().clear();
  useStaffAuth.getState().setSession({ token: "staff-jwt", expiresAt: null, user: staffUser });
});

describe("interceptor de respuesta", () => {
  it("401 en staff limpia la sesión y navega a /login con redirect", async () => {
    server.use(http.get(`${API}/protegido`, () => HttpResponse.json({ success: false }, { status: 401 })));

    const error = await staffClient.get("/protegido").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(401);
    expect(useStaffAuth.getState().token).toBeNull();
    expect(useStaffAuth.getState().user).toBeNull();
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith({ to: "/login", search: { redirect: "/app/sesiones" }, replace: true });
  });

  it("401 simultáneos navegan una sola vez", async () => {
    server.use(http.get(`${API}/protegido`, () => HttpResponse.json({ success: false }, { status: 401 })));

    await Promise.allSettled([staffClient.get("/protegido"), staffClient.get("/protegido")]);

    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("401 en /auth/login (credenciales inválidas) no cierra sesión ni navega", async () => {
    server.use(
      http.post(`${API}/auth/login`, () =>
        HttpResponse.json(
          { success: false, error: { code: "AUTH_INVALID", message: "Credenciales inválidas" } },
          { status: 401 },
        ),
      ),
    );

    const error = (await staffClient.post("/auth/login", {}).catch((e: unknown) => e)) as ApiError;

    expect(error.code).toBe("AUTH_INVALID");
    expect(error.message).toBe("Credenciales inválidas");
    expect(useStaffAuth.getState().token).toBe("staff-jwt");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("403 rechaza con ApiError(403) sin hacer logout", async () => {
    server.use(
      http.get(`${API}/prohibido`, () =>
        HttpResponse.json(
          { success: false, error: { code: "FORBIDDEN", message: "Sin permiso" }, correlationId: "abc-123" },
          { status: 403 },
        ),
      ),
    );

    const error = (await staffClient.get("/prohibido").catch((e: unknown) => e)) as ApiError;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(403);
    expect(error.code).toBe("FORBIDDEN");
    expect(error.correlationId).toBe("abc-123");
    expect(useStaffAuth.getState().token).toBe("staff-jwt");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("error de red => ApiError con status 0 y code NETWORK", async () => {
    server.use(http.get(`${API}/caido`, () => HttpResponse.error()));

    const error = (await staffClient.get("/caido").catch((e: unknown) => e)) as ApiError;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(0);
    expect(error.code).toBe("NETWORK");
  });

  it("timeout => ApiError con code TIMEOUT", async () => {
    server.use(
      http.get(`${API}/lento`, async () => {
        await delay(300);
        return HttpResponse.json({ success: true, data: null });
      }),
    );
    const client = createApiClient(() => null, () => undefined, { timeoutMs: 30 });

    const error = (await client.get("/lento").catch((e: unknown) => e)) as ApiError;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(0);
    expect(error.code).toBe("TIMEOUT");
  });

  it("propaga details del envelope de error", async () => {
    server.use(
      http.post(`${API}/crear`, () =>
        HttpResponse.json(
          { success: false, error: { code: "VALIDATION", message: "Datos inválidos", details: ["name: requerido"] } },
          { status: 400 },
        ),
      ),
    );

    const error = (await staffClient.post("/crear", {}).catch((e: unknown) => e)) as ApiError;

    expect(error.code).toBe("VALIDATION");
    expect(error.details).toEqual(["name: requerido"]);
  });
});

describe("aislamiento staff / participante", () => {
  it("cada cliente envía su propio token", async () => {
    useParticipantAuth.getState().setSession({ token: "participant-jwt", assignmentId: 7 });
    const seen: Record<string, string | null> = {};
    server.use(
      http.get(`${API}/quien`, ({ request }) => {
        seen[request.headers.get("x-cliente") ?? "?"] = request.headers.get("authorization");
        return HttpResponse.json({ success: true, data: null });
      }),
    );

    await staffClient.get("/quien", { headers: { "x-cliente": "staff" } });
    await participantClient.get("/quien", { headers: { "x-cliente": "participante" } });

    expect(seen.staff).toBe("Bearer staff-jwt");
    expect(seen.participante).toBe("Bearer participant-jwt");
  });

  it("401 en participante limpia solo participantAuth y navega a /evaluacion/acceso", async () => {
    setNavigator(navigate, () => "/evaluacion/sesion");
    useParticipantAuth.getState().setSession({ token: "participant-jwt", assignmentId: 7 });
    server.use(http.get(`${API}/yo`, () => HttpResponse.json({ success: false }, { status: 401 })));

    await participantClient.get("/yo").catch(() => undefined);

    expect(useParticipantAuth.getState().token).toBeNull();
    expect(useStaffAuth.getState().token).toBe("staff-jwt");
    expect(navigate).toHaveBeenCalledWith({ to: "/evaluacion/acceso", replace: true });
  });

  it("401 del participante estando en /app (staff) limpia participantAuth pero NO navega", async () => {
    setNavigator(navigate, () => "/app/sesiones");
    useParticipantAuth.getState().setSession({ token: "participant-jwt", assignmentId: 7 });
    server.use(http.get(`${API}/yo`, () => HttpResponse.json({ success: false }, { status: 401 })));

    await participantClient.get("/yo").catch(() => undefined);

    expect(useParticipantAuth.getState().token).toBeNull();
    expect(useStaffAuth.getState().token).toBe("staff-jwt");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("401 del participante en '/evaluacionX' (prefijo ajeno) no navega", async () => {
    setNavigator(navigate, () => "/evaluacionX");
    useParticipantAuth.getState().setSession({ token: "participant-jwt", assignmentId: 7 });
    server.use(http.get(`${API}/yo`, () => HttpResponse.json({ success: false }, { status: 401 })));

    await participantClient.get("/yo").catch(() => undefined);

    expect(navigate).not.toHaveBeenCalled();
  });

  it("401 tardío del participante anterior durante el canje de otro código: limpia la sesión anterior pero NO navega", async () => {
    setNavigator(navigate, () => "/evaluacion/43-token-de-b");
    useParticipantAuth.getState().setSession({ token: "participant-jwt-a", assignmentId: 7 });
    server.use(http.get(`${API}/yo`, () => HttpResponse.json({ success: false }, { status: 401 })));

    await participantClient.get("/yo").catch(() => undefined);

    expect(useParticipantAuth.getState().token).toBeNull();
    expect(navigate).not.toHaveBeenCalled(); // el canje de B en /evaluacion/$code sigue montado
  });

  it("isParticipantRedeemPath distingue el canje de las rutas fijas del participante", () => {
    expect(isParticipantRedeemPath("/evaluacion/43-abc")).toBe(true);
    expect(isParticipantRedeemPath("/evaluacion/43-abc?x=1")).toBe(true);
    for (const path of ["/evaluacion/acceso", "/evaluacion/acceso?code=1", "/evaluacion/sesion", "/evaluacion/subtests/1/items/2", "/evaluacion", "/evaluacionX/1", "/app/sesiones"]) {
      expect(isParticipantRedeemPath(path)).toBe(false);
    }
  });

  it("validar el acceso del participante no pisa el token del staff", () => {
    useParticipantAuth.getState().setSession({ token: "participant-jwt", assignmentId: 7 });
    expect(useStaffAuth.getState().token).toBe("staff-jwt");
  });
});

describe("FormData", () => {
  it("elimina Content-Type para que el navegador fije el boundary", async () => {
    let contentType: string | null = null;
    server.use(
      http.post(`${API}/subir`, ({ request }) => {
        contentType = request.headers.get("content-type");
        return HttpResponse.json({ success: true, data: null });
      }),
    );
    const form = new FormData();
    form.append("file", new Blob(["x"]), "x.txt");

    await staffClient.post("/subir", form);

    expect(contentType).toMatch(/^multipart\/form-data; boundary=/);
  });
});

describe("unwrap / toApiError", () => {
  it("unwrap devuelve data.data cuando success=true", () => {
    const res = { status: 200, data: { success: true, data: { id: 1 } } as ApiEnvelope<{ id: number }> };
    expect(unwrap(res)).toEqual({ id: 1 });
  });

  it("unwrap lanza ApiError con code cuando success=false (HTTP 200)", () => {
    const res = {
      status: 200,
      data: {
        success: false,
        data: null,
        error: { code: "SESSION_CLOSED", message: "La sesión está cerrada" },
        correlationId: "cid-1",
      } as ApiEnvelope<null>,
    };

    let thrown: unknown;
    try {
      unwrap(res);
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(ApiError);
    expect((thrown as ApiError).code).toBe("SESSION_CLOSED");
    expect((thrown as ApiError).message).toBe("La sesión está cerrada");
    expect((thrown as ApiError).correlationId).toBe("cid-1");
  });

  it("toApiError es idempotente y envuelve errores desconocidos", () => {
    const original = new ApiError({ status: 409, code: "CONFLICT", message: "x" });
    expect(toApiError(original)).toBe(original);
    expect(toApiError("boom").code).toBe("UNKNOWN");
    expect(toApiError(new Error("fallo")).message).toBe("fallo");
  });
});

describe("token enviado y 401 tardío", () => {
  it("un 401 de una petición enviada con un token viejo NO borra la sesión nueva", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get(`${API}/lento-401`, async () => {
        await gate;
        return HttpResponse.json({ success: false }, { status: 401 });
      }),
    );

    const pending = staffClient.get("/lento-401").catch((e: unknown) => e);
    await delay(10);
    // Mientras vuela, otra cuenta inicia sesión.
    useStaffAuth.getState().setSession({ token: "nuevo-jwt", expiresAt: null, user: staffUser });
    release();

    const error = (await pending) as ApiError;
    expect(error.status).toBe(401);
    expect(useStaffAuth.getState().token).toBe("nuevo-jwt");
    expect(useStaffAuth.getState().user).not.toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("validar acceso de participante y login de staff no mandan Authorization", async () => {
    useParticipantAuth.getState().setSession({ token: "participant-jwt", assignmentId: 7 });
    const seen: Record<string, string | null> = {};
    server.use(
      http.post(`${API}/acceso-participante/validar`, ({ request }) => {
        seen.validar = request.headers.get("authorization");
        return HttpResponse.json({ success: true, data: null });
      }),
      http.post(`${API}/auth/login`, ({ request }) => {
        seen.login = request.headers.get("authorization");
        return HttpResponse.json({ success: true, data: null });
      }),
    );

    await participantClient.post("/acceso-participante/validar", {}, { headers: { Authorization: "Bearer manual" } });
    await staffClient.post("/auth/login", {});

    expect(seen.validar).toBeNull();
    expect(seen.login).toBeNull();
  });
});

describe("401 de una petición obsoleta (isStillRelevant, F2-FIX-7)", () => {
  it("con isStillRelevant() === false un 401 del participante NO limpia la sesión ni navega; el error sube", async () => {
    setNavigator(navigate, () => "/evaluacion/subtests/10/items/1");
    useParticipantAuth.getState().setSession({ token: "participant-jwt", assignmentId: 42 });
    server.use(http.get(`${API}/yo-obsoleto`, () => HttpResponse.json({ success: false }, { status: 401 })));

    const error = (await participantClient
      .get("/yo-obsoleto", { isStillRelevant: () => false })
      .catch((e: unknown) => e)) as ApiError;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(401);
    expect(useParticipantAuth.getState().token).toBe("participant-jwt");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("con isStillRelevant() === true (o sin predicado) un 401 del participante se comporta como siempre: limpia y navega a acceso", async () => {
    setNavigator(navigate, () => "/evaluacion/subtests/10/items/1");
    server.use(http.get(`${API}/yo-vigente`, () => HttpResponse.json({ success: false }, { status: 401 })));

    useParticipantAuth.getState().setSession({ token: "participant-jwt", assignmentId: 42 });
    await participantClient.get("/yo-vigente", { isStillRelevant: () => true }).catch(() => undefined);
    expect(useParticipantAuth.getState().token).toBeNull();
    expect(navigate).toHaveBeenCalledWith({ to: "/evaluacion/acceso", replace: true });

    navigate.mockReset();
    useParticipantAuth.getState().setSession({ token: "participant-jwt-2", assignmentId: 42 });
    await participantClient.get("/yo-vigente").catch(() => undefined);
    expect(useParticipantAuth.getState().token).toBeNull();
    expect(navigate).toHaveBeenCalledWith({ to: "/evaluacion/acceso", replace: true });
  });

  it("el predicado se consulta al volver la respuesta (no al emitir la petición)", async () => {
    setNavigator(navigate, () => "/evaluacion/sesion");
    useParticipantAuth.getState().setSession({ token: "participant-jwt", assignmentId: 42 });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get(`${API}/yo-lento`, async () => {
        await gate;
        return HttpResponse.json({ success: false }, { status: 401 });
      }),
    );
    let relevant = true;
    const pending = participantClient.get("/yo-lento", { isStillRelevant: () => relevant }).catch((e: unknown) => e);
    await delay(10);
    relevant = false; // p. ej. se ocultó la pestaña mientras volaba
    release();

    expect(((await pending) as ApiError).status).toBe(401);
    expect(useParticipantAuth.getState().token).toBe("participant-jwt");
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe("403 en staff", () => {
  const forbidden = () =>
    HttpResponse.json({ success: false, error: { code: "FORBIDDEN", message: "Sin permiso" } }, { status: 403 });

  it("emite un toast de error una sola vez en métodos no-GET", async () => {
    server.use(http.post(`${API}/crear`, forbidden));
    await staffClient.post("/crear", {}).catch(() => undefined);
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith("Sin permiso");
  });

  it("no avisa en GET ni con silent403, y el participante nunca avisa", async () => {
    server.use(
      http.get(`${API}/leer`, forbidden),
      http.delete(`${API}/borrar`, forbidden),
      http.post(`${API}/part`, forbidden),
    );
    await staffClient.get("/leer").catch(() => undefined);
    await staffClient.delete("/borrar", { silent403: true }).catch(() => undefined);
    await participantClient.post("/part", {}).catch(() => undefined);
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe("navegación fuera de /app", () => {
  it("un 401 de staff estando en /evaluacion limpia la sesión pero no navega", async () => {
    setNavigator(navigate, () => "/evaluacion/acceso");
    server.use(http.get(`${API}/protegido`, () => HttpResponse.json({ success: false }, { status: 401 })));

    await staffClient.get("/protegido").catch(() => undefined);

    expect(useStaffAuth.getState().token).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe("401 con la sesión cambiada en otra pestaña", () => {
  const otherTabSession = (token: string) =>
    JSON.stringify({ state: { token, expiresAt: null, user: staffUser, sessionId: 50 }, version: 0 });

  it("si otra pestaña persistió otra sesión, el 401 de la anterior NO borra la persistencia: se re-hidrata", async () => {
    let release: () => void = () => undefined;
    const gated = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get(`${API}/lento-401`, async () => {
        await gated;
        return HttpResponse.json({ success: false }, { status: 401 });
      }),
    );

    const pending = staffClient.get("/lento-401").catch((e: unknown) => e);
    await delay(10);
    // Otra "pestaña" inicia sesión: escribe su sesión en localStorage (sin evento `storage` en esta).
    localStorage.setItem(STAFF_AUTH_STORAGE_KEY, otherTabSession("token-otra-pestana"));
    release();

    const error = (await pending) as ApiError;
    expect(error.status).toBe(401);
    // La persistencia sigue siendo la de la otra pestaña…
    expect(JSON.parse(localStorage.getItem(STAFF_AUTH_STORAGE_KEY) ?? "{}").state.token).toBe("token-otra-pestana");
    // …y esta pestaña la adopta en vez de cerrarla.
    expect(useStaffAuth.getState().token).toBe("token-otra-pestana");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("si la persistencia sigue siendo el token enviado, el 401 cierra la sesión (comportamiento normal)", async () => {
    server.use(http.get(`${API}/protegido`, () => HttpResponse.json({ success: false }, { status: 401 })));
    await staffClient.get("/protegido").catch(() => undefined);
    expect(useStaffAuth.getState().token).toBeNull();
    expect(navigate).toHaveBeenCalledTimes(1);
  });
});

describe("prefijo de área /app", () => {
  it("'/application' NO cuenta como /app: el 401 limpia la sesión pero no navega", async () => {
    setNavigator(navigate, () => "/application");
    server.use(http.get(`${API}/protegido`, () => HttpResponse.json({ success: false }, { status: 401 })));

    await staffClient.get("/protegido").catch(() => undefined);

    expect(useStaffAuth.getState().token).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("'/app' exacto (con query) sí cuenta como /app", async () => {
    setNavigator(navigate, () => "/app?tab=1");
    server.use(http.get(`${API}/protegido`, () => HttpResponse.json({ success: false }, { status: 401 })));

    await staffClient.get("/protegido").catch(() => undefined);

    expect(navigate).toHaveBeenCalledWith({ to: "/login", search: { redirect: "/app?tab=1" }, replace: true });
  });
});
