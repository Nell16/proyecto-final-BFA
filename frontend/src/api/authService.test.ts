import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../test/msw/server";
import { authService, LOGIN_SUPERSEDED } from "./authService";
import { ApiError } from "./errors";
import { STAFF_AUTH_STORAGE_KEY, syncStaffAuthFromStorage, useStaffAuth } from "../store/staffAuth";
import { ensureStaffUser } from "../store/ensureStaffUser";
import { QueryClient } from "@tanstack/react-query";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), warning: vi.fn(), dismiss: vi.fn() }) }));

const API = "http://localhost:8080";
const FAR_FUTURE = "2099-01-01T00:00:00Z";

/** Promesa que se resuelve a mano: retiene una respuesta de MSW hasta `release()`. */
function gate(): { wait: Promise<void>; release: () => void } {
  let release: () => void = () => undefined;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { wait, release };
}

const persistedToken = (): string | null =>
  (JSON.parse(localStorage.getItem(STAFF_AUTH_STORAGE_KEY) ?? "null") as { state: { token: string | null } } | null)?.state
    .token ?? null;

/**
 * /auth/login responde `tok-<usuario>`; los usuarios listados en `heldLogin` / `heldMe`
 * retienen su respuesta de /auth/login o /auth/me hasta liberar la compuerta.
 */
function mockAuth(opts: { heldLogin?: Record<string, Promise<void>>; heldMe?: Record<string, Promise<void>> } = {}) {
  server.use(
    http.post(`${API}/auth/login`, async ({ request }) => {
      const { username } = (await request.json()) as { username: string };
      await opts.heldLogin?.[username];
      return HttpResponse.json({
        success: true,
        data: { accessToken: `tok-${username}`, tokenType: "Bearer", expiresAt: FAR_FUTURE, userId: username, username, permissions: [] },
      });
    }),
    http.get(`${API}/auth/me`, async ({ request }) => {
      const username = (request.headers.get("authorization") ?? "").replace("Bearer tok-", "");
      await opts.heldMe?.[username];
      return HttpResponse.json({
        success: true,
        data: { userId: username, username, roles: ["APLICADOR"], permissions: [`PERM_${username}`] },
      });
    }),
  );
}

/** Tokens con los que se llamó a /auth/me (sirve para saber cuándo una petición ya está en vuelo). */
const meRequests: string[] = [];

beforeEach(() => {
  meRequests.length = 0;
  server.events.on("request:start", ({ request }) => {
    if (request.url.endsWith("/auth/me")) meRequests.push((request.headers.get("authorization") ?? "").replace("Bearer ", ""));
  });
  useStaffAuth.getState().clear();
});

afterEach(() => {
  server.events.removeAllListeners();
  useStaffAuth.getState().clear();
});

describe("authService.login: generación de sesión", () => {
  it("login normal publica la sesión", async () => {
    mockAuth();
    const outcome = await authService.login("a", "x");
    expect(outcome.token).toBe("tok-a");
    expect(useStaffAuth.getState().token).toBe("tok-a");
    expect(useStaffAuth.getState().user?.id).toBe("a");
  });

  it("login A pendiente en /auth/login + login B => queda B y A se descarta", async () => {
    const holdA = gate();
    mockAuth({ heldLogin: { a: holdA.wait } });

    const loginA = authService.login("a", "x").catch((e: unknown) => e);
    const outcomeB = await authService.login("b", "x"); // B completa mientras A sigue retenido
    expect(useStaffAuth.getState().token).toBe("tok-b");

    holdA.release();
    const resultA = await loginA;

    expect(resultA).toBeInstanceOf(ApiError);
    expect((resultA as ApiError).code).toBe(LOGIN_SUPERSEDED);
    expect(outcomeB.token).toBe("tok-b");
    expect(useStaffAuth.getState().token).toBe("tok-b");
    expect(useStaffAuth.getState().user?.id).toBe("b");
    expect(persistedToken()).toBe("tok-b");
  });

  it("login A pendiente en /auth/me + login B => queda B y A se descarta", async () => {
    const holdMeA = gate();
    mockAuth({ heldMe: { a: holdMeA.wait } });

    const loginA = authService.login("a", "x").catch((e: unknown) => e);
    await vi.waitFor(() => expect(meRequests).toContain("tok-a")); // A ya superó /auth/login y espera /auth/me
    await authService.login("b", "x");

    holdMeA.release();
    const resultA = await loginA;

    expect((resultA as ApiError).code).toBe(LOGIN_SUPERSEDED);
    expect(useStaffAuth.getState().token).toBe("tok-b");
    expect(useStaffAuth.getState().hasPermission("PERM_a")).toBe(false);
    expect(useStaffAuth.getState().hasPermission("PERM_b")).toBe(true);
  });

  it("si la sesión cambia durante el login (otra pestaña/otro flujo) el resultado se descarta", async () => {
    const holdA = gate();
    mockAuth({ heldLogin: { a: holdA.wait } });

    const loginA = authService.login("a", "x").catch((e: unknown) => e);
    // Otro flujo publica una sesión mientras A espera.
    useStaffAuth.getState().setSession({ token: "otra-pestana", expiresAt: null, user: { id: "z", username: "z", roles: [], permissions: [] } });
    holdA.release();

    expect(((await loginA) as ApiError).code).toBe(LOGIN_SUPERSEDED);
    expect(useStaffAuth.getState().token).toBe("otra-pestana");
  });

  it("un login con credenciales inválidas rechaza con el error del backend (no SUPERSEDED)", async () => {
    server.use(
      http.post(`${API}/auth/login`, () =>
        HttpResponse.json({ success: false, error: { code: "AUTH_INVALID", message: "Credenciales inválidas" } }, { status: 401 }),
      ),
    );
    const error = (await authService.login("a", "mal").catch((e: unknown) => e)) as ApiError;
    expect(error.code).toBe("AUTH_INVALID");
    expect(useStaffAuth.getState().token).toBeNull();
  });
});

describe("authService.login frente a una sesión persistida por otra pestaña", () => {
  /** Simula que OTRA pestaña persistió su sesión (sin que esta reciba aún el evento `storage`). */
  const otherTabPersists = (token: string) =>
    localStorage.setItem(
      STAFF_AUTH_STORAGE_KEY,
      JSON.stringify({ state: { token, expiresAt: null, user: null, sessionId: `sid-${token}` }, version: 1 }),
    );

  it("login tardío de A (en /auth/login) con B persistida por otra pestaña => A se descarta y queda B", async () => {
    const holdA = gate();
    mockAuth({ heldLogin: { a: holdA.wait } });

    const loginA = authService.login("a", "x").catch((e: unknown) => e);
    otherTabPersists("tok-b");
    holdA.release();

    expect(((await loginA) as ApiError).code).toBe(LOGIN_SUPERSEDED);
    expect(persistedToken()).toBe("tok-b");
    expect(useStaffAuth.getState().token).not.toBe("tok-a");
    expect(useStaffAuth.getState().user).toBeNull();
  });

  it("login tardío de A (en /auth/me) con B persistida => A se descarta y queda B en memoria y storage tras el evento", async () => {
    const holdMeA = gate();
    mockAuth({ heldMe: { a: holdMeA.wait } });

    const loginA = authService.login("a", "x").catch((e: unknown) => e);
    await vi.waitFor(() => expect(meRequests).toContain("tok-a"));
    otherTabPersists("tok-b");
    holdMeA.release();

    expect(((await loginA) as ApiError).code).toBe(LOGIN_SUPERSEDED);
    expect(persistedToken()).toBe("tok-b");
    expect(useStaffAuth.getState().token).not.toBe("tok-a");

    // Llega el evento `storage` pendiente: esta pestaña adopta B.
    await syncStaffAuthFromStorage();
    expect(useStaffAuth.getState().token).toBe("tok-b");
    expect(persistedToken()).toBe("tok-b");
  });

  it("un login sin interferencias sigue publicando la sesión (el storage no cambió)", async () => {
    mockAuth();
    await authService.login("a", "x");
    expect(persistedToken()).toBe("tok-a");
    expect(useStaffAuth.getState().token).toBe("tok-a");
  });
});

describe("ensureStaffUser: /auth/me tardío frente a una sesión persistida por otra pestaña", () => {
  it("la respuesta tardía de A no reescribe B (ni token ni usuario) en el storage", async () => {
    const holdMeA = gate();
    mockAuth({ heldMe: { a: holdMeA.wait } });
    useStaffAuth.getState().setSession({ token: "tok-a", expiresAt: null });

    const pending = ensureStaffUser(new QueryClient());
    await vi.waitFor(() => expect(meRequests).toContain("tok-a"));
    // Otra pestaña persiste B; esta aún no recibió el evento `storage`.
    localStorage.setItem(
      STAFF_AUTH_STORAGE_KEY,
      JSON.stringify({ state: { token: "tok-b", expiresAt: null, user: null, sessionId: "sid-b" }, version: 1 }),
    );
    holdMeA.release();
    await pending;

    expect(persistedToken()).toBe("tok-b");
    expect(JSON.parse(localStorage.getItem(STAFF_AUTH_STORAGE_KEY) ?? "{}").state.sessionId).toBe("sid-b");
    // Esta pestaña terminó adoptando B y sin el usuario de A.
    expect(useStaffAuth.getState().token).toBe("tok-b");
    expect(useStaffAuth.getState().hasPermission("PERM_a")).toBe(false);
  });
});
