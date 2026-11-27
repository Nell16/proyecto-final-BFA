import { beforeEach, describe, expect, it } from "vitest";
import { delay, http, HttpResponse } from "msw";
import { QueryClient } from "@tanstack/react-query";
import { server } from "../test/msw/server";
import { ensureStaffUser } from "./ensureStaffUser";
import { useStaffAuth } from "./staffAuth";
import { authKeys } from "../api/authService";

const API = "http://localhost:8080";
const me = (userId: string, permissions: string[]) => ({
  success: true,
  data: { userId, username: userId, roles: ["APLICADOR"], permissions },
});

const useMeHandler = (slowFor?: string) =>
  server.use(
    http.get(`${API}/auth/me`, async ({ request }) => {
      const auth = request.headers.get("authorization");
      if (auth === `Bearer ${slowFor}`) await delay(80);
      return HttpResponse.json(auth === "Bearer token-a" ? me("alice", ["USUARIO_LEER"]) : me("bob", ["SESION_APLICAR"]));
    }),
  );

beforeEach(() => {
  useStaffAuth.getState().clear();
});

describe("ensureStaffUser", () => {
  it("sin token devuelve login", async () => {
    expect(await ensureStaffUser(new QueryClient())).toBe("login");
  });

  it("hidrata el usuario desde /auth/me con clave por sesión", async () => {
    useMeHandler();
    const qc = new QueryClient();
    useStaffAuth.getState().setSession({ token: "token-a", expiresAt: null });

    expect(await ensureStaffUser(qc)).toBe("ok");
    expect(useStaffAuth.getState().user?.id).toBe("alice");
    const { sessionId } = useStaffAuth.getState();
    expect(qc.getQueryData(authKeys.me(sessionId))).toMatchObject({ id: "alice" });
  });

  it("race: si la sesión cambia mientras /auth/me vuela, no se escribe la identidad anterior", async () => {
    useMeHandler("token-a");
    const qc = new QueryClient();
    useStaffAuth.getState().setSession({ token: "token-a", expiresAt: null });

    const pending = ensureStaffUser(qc);
    await delay(10);
    // Otro login (otra cuenta) mientras la respuesta de alice sigue en vuelo.
    useStaffAuth.getState().setSession({ token: "token-b", expiresAt: null });

    expect(await pending).toBe("ok");
    expect(useStaffAuth.getState().user?.id).toBe("bob");
    expect(useStaffAuth.getState().hasPermission("USUARIO_LEER")).toBe(false);
  });

  it("race: si la sesión se cierra durante el vuelo, devuelve login y no escribe usuario", async () => {
    useMeHandler("token-a");
    const qc = new QueryClient();
    useStaffAuth.getState().setSession({ token: "token-a", expiresAt: null });

    const pending = ensureStaffUser(qc);
    await delay(10);
    useStaffAuth.getState().clear();

    expect(await pending).toBe("login");
    expect(useStaffAuth.getState().user).toBeNull();
  });

  it("race: un 401 de la identidad anterior se ignora si la sesión ya cambió, y se reevalúa la actual", async () => {
    let release: () => void = () => undefined;
    const gated = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get(`${API}/auth/me`, async ({ request }) => {
        if (request.headers.get("authorization") === "Bearer token-a") {
          await gated;
          return HttpResponse.json({ success: false }, { status: 401 });
        }
        return HttpResponse.json(me("bob", ["SESION_APLICAR"]));
      }),
    );
    const qc = new QueryClient();
    useStaffAuth.getState().setSession({ token: "token-a", expiresAt: null });

    const pending = ensureStaffUser(qc);
    await delay(10);
    useStaffAuth.getState().setSession({ token: "token-b", expiresAt: null });
    release();

    // Antes devolvía "login" por el 401 de A aunque ya hubiera sesión B válida.
    expect(await pending).toBe("ok");
    expect(useStaffAuth.getState().token).toBe("token-b");
    expect(useStaffAuth.getState().user?.id).toBe("bob");
  });

  it("respeta staleTime: un dato viejo se vuelve a pedir (no se usa ensureQueryData)", async () => {
    let calls = 0;
    server.use(
      http.get(`${API}/auth/me`, () => {
        calls += 1;
        return HttpResponse.json(me("alice", calls === 1 ? ["USUARIO_LEER"] : ["ROL_LEER"]));
      }),
    );
    const qc = new QueryClient();
    useStaffAuth.getState().setSession({ token: "token-a", expiresAt: null });
    qc.setQueryData(authKeys.me(useStaffAuth.getState().sessionId), { id: "alice", username: "x", roles: [], permissions: [] }, { updatedAt: 0 });

    await ensureStaffUser(qc);
    expect(calls).toBe(1);
    expect(useStaffAuth.getState().hasPermission("USUARIO_LEER")).toBe(true);
  });
});
