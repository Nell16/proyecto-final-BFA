import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import {
  EXPIRY_WARNING_TOAST_ID,
  STAFF_AUTH_STORAGE_KEY,
  setSessionExpiredHandler,
  startStaffAuthStorageSync,
  stopStaffAuthStorageSync,
  syncStaffAuthFromStorage,
  useStaffAuth,
} from "./staffAuth";
import { queryClient } from "../api/queryClient";
import { useParticipantAuth } from "./participantAuth";
import { requirePermission } from "./requirePermission";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), warning: vi.fn(), dismiss: vi.fn() }) }));

/** Residuo de localStorage del antiguo store de admin: `resetAccountScopedState` debe purgarlo. */
const LEGACY_ADMIN_STORAGE_KEY = "bfa-digital-admin-storage";

const user = { id: "u1", username: "ana", roles: ["APLICADOR"], permissions: ["SESION_APLICAR", "PARTICIPANTE_LEER"] };

beforeEach(() => {
  vi.mocked(toast.warning).mockClear();
  vi.mocked(toast.dismiss).mockClear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  useStaffAuth.getState().clear();
});

afterEach(() => {
  setSessionExpiredHandler(null);
  vi.useRealTimers();
});

describe("staffAuth", () => {
  it("hasPermission / hasAnyPermission usan solo la lista de /auth/me (sin admin implícito)", () => {
    useStaffAuth.getState().setSession({
      token: "t",
      expiresAt: null,
      user: { ...user, roles: ["ADMINISTRADOR"], permissions: ["USUARIO_LEER"] },
    });
    const s = useStaffAuth.getState();
    expect(s.hasPermission("USUARIO_LEER")).toBe(true);
    expect(s.hasPermission("AUDITORIA_VER")).toBe(false);
    expect(s.hasAnyPermission(["AUDITORIA_VER", "USUARIO_LEER"])).toBe(true);
    expect(s.hasAnyPermission(["AUDITORIA_VER"])).toBe(false);
  });

  it("cierra la sesión automáticamente al expirar y avisa al handler", () => {
    const onExpired = vi.fn();
    setSessionExpiredHandler(onExpired);
    useStaffAuth.getState().setSession({ token: "t", expiresAt: "2026-01-01T00:10:00Z", user });

    vi.advanceTimersByTime(9 * 60_000);
    expect(useStaffAuth.getState().token).toBe("t");

    vi.advanceTimersByTime(60_000);
    expect(useStaffAuth.getState().token).toBeNull();
    expect(useStaffAuth.getState().user).toBeNull();
    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  it("un expiresAt ya vencido cierra la sesión de inmediato", () => {
    useStaffAuth.getState().setSession({ token: "t", expiresAt: "2025-12-31T23:00:00Z", user });
    expect(useStaffAuth.getState().token).toBeNull();
  });

  it("clear cancela el temporizador de expiración", () => {
    const onExpired = vi.fn();
    setSessionExpiredHandler(onExpired);
    useStaffAuth.getState().setSession({ token: "t", expiresAt: "2026-01-01T00:10:00Z", user });
    useStaffAuth.getState().clear();
    vi.advanceTimersByTime(20 * 60_000);
    expect(onExpired).not.toHaveBeenCalled();
  });
});

describe("participantAuth", () => {
  it("es independiente de staffAuth", () => {
    useStaffAuth.getState().setSession({ token: "staff", expiresAt: null, user });
    useParticipantAuth.getState().setSession({ token: "part", assignmentId: 3 });
    useParticipantAuth.getState().clear();
    expect(useStaffAuth.getState().token).toBe("staff");
  });

  it("persiste en sessionStorage con su propia clave", () => {
    useParticipantAuth.getState().setSession({ token: "part", assignmentId: 3 });
    expect(sessionStorage.getItem("bfa-participant-auth")).toContain("part");
    expect(localStorage.getItem("bfa-participant-auth")).toBeNull();
  });
});

describe("requirePermission", () => {
  it("deja pasar si tiene alguno de los permisos", () => {
    useStaffAuth.getState().setSession({ token: "t", expiresAt: null, user });
    expect(() => requirePermission(["TEST_CREAR", "SESION_APLICAR"])()).not.toThrow();
  });

  it("redirige a /no-autorizado si no tiene ninguno", () => {
    useStaffAuth.getState().setSession({ token: "t", expiresAt: null, user });
    let thrown: unknown;
    try {
      requirePermission("AUDITORIA_VER")();
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toMatchObject({ options: { to: "/no-autorizado" } });
  });
});

describe("aviso previo de expiración", () => {
  it("2 minutos antes muestra un toast persistente con acción y se cancela al reprogramar/cerrar", () => {
    useStaffAuth.getState().setSession({ token: "t", expiresAt: "2026-01-01T00:10:00Z", user });
    expect(toast.warning).not.toHaveBeenCalled();

    vi.advanceTimersByTime(8 * 60_000);
    expect(toast.warning).toHaveBeenCalledTimes(1);
    const [message, options] = vi.mocked(toast.warning).mock.calls[0];
    expect(message).toBe("Su sesión expirará en 2 minutos");
    expect(options).toMatchObject({ id: EXPIRY_WARNING_TOAST_ID, duration: Infinity, action: { label: "Cerrar sesión" } });

    vi.mocked(toast.dismiss).mockClear();
    useStaffAuth.getState().setSession({ token: "t2", expiresAt: "2026-01-01T01:00:00Z", user });
    expect(toast.dismiss).toHaveBeenCalledWith(EXPIRY_WARNING_TOAST_ID);
  });

  it("la acción 'Cerrar sesión' cierra la sesión y avisa al handler", () => {
    const onExpired = vi.fn();
    setSessionExpiredHandler(onExpired);
    useStaffAuth.getState().setSession({ token: "t", expiresAt: "2026-01-01T00:10:00Z", user });
    vi.advanceTimersByTime(8 * 60_000);

    const options = vi.mocked(toast.warning).mock.calls[0][1] as unknown as { action: { onClick: () => void } };
    options.action.onClick();

    expect(useStaffAuth.getState().token).toBeNull();
    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  it("un timer de una sesión anterior no cierra la sesión nueva", () => {
    const onExpired = vi.fn();
    setSessionExpiredHandler(onExpired);
    useStaffAuth.getState().setSession({ token: "viejo", expiresAt: "2026-01-01T00:10:00Z", user });
    useStaffAuth.getState().setSession({ token: "nuevo", expiresAt: "2026-01-01T02:00:00Z", user });

    vi.advanceTimersByTime(30 * 60_000);

    expect(useStaffAuth.getState().token).toBe("nuevo");
    expect(onExpired).not.toHaveBeenCalled();
  });
});

describe("coordinación entre pestañas", () => {
  const stored = (token: string | null, expiresAt: string | null = null) =>
    JSON.stringify({ state: { token, expiresAt, user, sessionId: 9 }, version: 0 });

  it("si otra pestaña cambió de sesión se re-hidrata y se reprograma el timer", async () => {
    const onExpired = vi.fn();
    setSessionExpiredHandler(onExpired);
    useStaffAuth.getState().setSession({ token: "a", expiresAt: "2026-01-01T00:10:00Z", user });

    localStorage.setItem(STAFF_AUTH_STORAGE_KEY, stored("b", "2026-01-01T03:00:00Z"));
    await syncStaffAuthFromStorage();
    expect(useStaffAuth.getState().token).toBe("b");

    vi.advanceTimersByTime(60 * 60_000); // el timer de "a" ya no cierra "b"
    expect(useStaffAuth.getState().token).toBe("b");
    vi.advanceTimersByTime(2 * 60 * 60_000);
    expect(useStaffAuth.getState().token).toBeNull();
    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  it("si otra pestaña cerró sesión (clave borrada) se cierra aquí", async () => {
    useStaffAuth.getState().setSession({ token: "a", expiresAt: null, user });
    localStorage.removeItem(STAFF_AUTH_STORAGE_KEY);
    await syncStaffAuthFromStorage();
    expect(useStaffAuth.getState().token).toBeNull();
  });

  it("el evento `storage` dispara la sincronización", async () => {
    useStaffAuth.getState().setSession({ token: "a", expiresAt: null, user });
    localStorage.setItem(STAFF_AUTH_STORAGE_KEY, stored("c"));
    window.dispatchEvent(new StorageEvent("storage", { key: STAFF_AUTH_STORAGE_KEY }));
    await vi.waitFor(() => expect(useStaffAuth.getState().token).toBe("c"));
  });
});

describe("timers frente a una sesión persistida por otra pestaña", () => {
  const otherTab = (token: string, expiresAt: string | null) =>
    JSON.stringify({ state: { token, expiresAt, user, sessionId: 9 }, version: 0 });

  it("el timer de expiración de A no cierra ni borra la sesión B persistida por otra pestaña", () => {
    const onExpired = vi.fn();
    setSessionExpiredHandler(onExpired);
    useStaffAuth.getState().setSession({ token: "a", expiresAt: "2026-01-01T00:10:00Z", user });

    // Otra pestaña persiste B (sin evento `storage` en esta).
    localStorage.setItem(STAFF_AUTH_STORAGE_KEY, otherTab("b", "2026-01-01T05:00:00Z"));
    vi.advanceTimersByTime(11 * 60_000); // A ya habría vencido

    expect(JSON.parse(localStorage.getItem(STAFF_AUTH_STORAGE_KEY) ?? "{}").state.token).toBe("b");
    expect(useStaffAuth.getState().token).toBe("b"); // se re-hidrata B
    expect(onExpired).not.toHaveBeenCalled();
  });

  it("la acción 'Cerrar sesión' del aviso de A tampoco cierra la sesión persistida B", () => {
    const onExpired = vi.fn();
    setSessionExpiredHandler(onExpired);
    useStaffAuth.getState().setSession({ token: "a", expiresAt: "2026-01-01T00:10:00Z", user });
    vi.advanceTimersByTime(8 * 60_000);
    const options = vi.mocked(toast.warning).mock.calls[0][1] as unknown as { action: { onClick: () => void } };

    localStorage.setItem(STAFF_AUTH_STORAGE_KEY, otherTab("b", null));
    options.action.onClick();

    expect(JSON.parse(localStorage.getItem(STAFF_AUTH_STORAGE_KEY) ?? "{}").state.token).toBe("b");
    expect(useStaffAuth.getState().token).toBe("b");
    expect(onExpired).not.toHaveBeenCalled();
  });

  it("si la persistencia sigue siendo la misma sesión, el timer cierra normalmente", () => {
    const onExpired = vi.fn();
    setSessionExpiredHandler(onExpired);
    useStaffAuth.getState().setSession({ token: "a", expiresAt: "2026-01-01T00:10:00Z", user });
    vi.advanceTimersByTime(11 * 60_000);
    expect(useStaffAuth.getState().token).toBeNull();
    expect(onExpired).toHaveBeenCalledTimes(1);
  });
});

describe("listener global de `storage`", () => {
  it("se puede dar de baja y volver a registrar sin duplicarse", async () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    try {
      stopStaffAuthStorageSync();
      expect(remove).toHaveBeenCalledWith("storage", expect.any(Function));

      // Dado de baja: un evento de otra pestaña ya no sincroniza.
      useStaffAuth.getState().setSession({ token: "a", expiresAt: null, user });
      localStorage.setItem(STAFF_AUTH_STORAGE_KEY, JSON.stringify({ state: { token: "c", expiresAt: null, user, sessionId: 9 }, version: 0 }));
      window.dispatchEvent(new StorageEvent("storage", { key: STAFF_AUTH_STORAGE_KEY }));
      await Promise.resolve();
      expect(useStaffAuth.getState().token).toBe("a");

      // Registrar dos veces deja un solo listener.
      const stop = startStaffAuthStorageSync();
      startStaffAuthStorageSync();
      expect(add.mock.calls.filter(([type]) => type === "storage")).toHaveLength(1);
      window.dispatchEvent(new StorageEvent("storage", { key: STAFF_AUTH_STORAGE_KEY }));
      await vi.waitFor(() => expect(useStaffAuth.getState().token).toBe("c"));
      stop();
    } finally {
      add.mockRestore();
      remove.mockRestore();
      startStaffAuthStorageSync(); // deja el módulo como lo encontró
    }
  });
});

describe("cambio de cuenta", () => {
  const seedAccountData = () => {
    localStorage.setItem(LEGACY_ADMIN_STORAGE_KEY, "{}");
    queryClient.setQueryData(["auth", "me", 1], { id: "alice" });
    queryClient.setQueryData(["otro"], 1);
  };

  it("logout purga el residuo de localStorage y la caché de React Query", () => {
    useStaffAuth.getState().setSession({ token: "a", expiresAt: null, user });
    seedAccountData();

    useStaffAuth.getState().clear();

    expect(localStorage.getItem(LEGACY_ADMIN_STORAGE_KEY)).toBeNull();
    expect(queryClient.getQueryData(["auth", "me", 1])).toBeUndefined();
    expect(queryClient.getQueryData(["otro"])).toBeUndefined();
  });

  it("setSession con otro usuario descarta los datos de la cuenta anterior", () => {
    useStaffAuth.getState().setSession({ token: "a", expiresAt: null, user });
    seedAccountData();

    useStaffAuth.getState().setSession({ token: "b", expiresAt: null, user: { ...user, id: "u2" } });

    expect(localStorage.getItem(LEGACY_ADMIN_STORAGE_KEY)).toBeNull();
    expect(queryClient.getQueryData(["auth", "me", 1])).toBeUndefined();
  });

  it("sessionId cambia con cada token nuevo y con cada cierre; no se reutiliza", () => {
    useStaffAuth.getState().setSession({ token: "a", expiresAt: null, user });
    const first = useStaffAuth.getState().sessionId;
    useStaffAuth.getState().setSession({ token: "a", expiresAt: null, user });
    expect(useStaffAuth.getState().sessionId).toBe(first);
    useStaffAuth.getState().clear();
    const afterClear = useStaffAuth.getState().sessionId;
    expect(afterClear).not.toBe(first);
    useStaffAuth.getState().setSession({ token: "b", expiresAt: null, user });
    const second = useStaffAuth.getState().sessionId;
    expect(new Set([first, afterClear, second]).size).toBe(3);
  });
});

describe("identidad de sesión única entre pestañas", () => {
  it("dos pestañas (dos instancias del módulo) con el mismo número de sesiones no comparten sessionId para tokens distintos", async () => {
    const ids: string[] = [];
    for (const token of ["tok-pestana-1", "tok-pestana-2"]) {
      vi.resetModules();
      const tab = await import("./staffAuth"); // instancia nueva = pestaña nueva (contador propio)
      tab.useStaffAuth.getState().setSession({ token, expiresAt: null, user });
      ids.push(tab.useStaffAuth.getState().sessionId);
      tab.stopStaffAuthStorageSync(); // la instancia de prueba no debe seguir escuchando `storage`
    }
    expect(ids[0]).not.toBe(ids[1]);
    expect(typeof ids[0]).toBe("string");
  });

  it("al adoptar una sesión de v0 (contador numérico) se renueva el sessionId", async () => {
    localStorage.setItem(
      STAFF_AUTH_STORAGE_KEY,
      JSON.stringify({ state: { token: "b", expiresAt: null, user, sessionId: 1 }, version: 0 }),
    );
    await syncStaffAuthFromStorage();
    expect(useStaffAuth.getState().token).toBe("b");
    expect(typeof useStaffAuth.getState().sessionId).toBe("string");
  });
});

describe("setUser", () => {
  const persistB = () =>
    localStorage.setItem(
      STAFF_AUTH_STORAGE_KEY,
      JSON.stringify({ state: { token: "b", expiresAt: null, user: null, sessionId: "sid-b" }, version: 1 }),
    );

  it("con memoria y storage en el mismo token aplica el usuario y devuelve true", () => {
    useStaffAuth.getState().setSession({ token: "a", expiresAt: null });
    expect(useStaffAuth.getState().setUser(user, "a")).toBe(true);
    expect(useStaffAuth.getState().user?.id).toBe("u1");
  });

  it("con otra sesión B persistida por otra pestaña NO escribe ni token ni usuario: B queda en el storage", () => {
    useStaffAuth.getState().setSession({ token: "a", expiresAt: null });
    persistB(); // evento `storage` aún pendiente en esta pestaña

    expect(useStaffAuth.getState().setUser(user, "a")).toBe(false);

    const persisted = JSON.parse(localStorage.getItem(STAFF_AUTH_STORAGE_KEY) ?? "{}");
    expect(persisted.state.token).toBe("b");
    expect(persisted.state.sessionId).toBe("sid-b");
    expect(useStaffAuth.getState().user).toBeNull();
  });

  it("con el mismo token pero otro sessionId persistido por otra pestaña NO escribe la clave y deja el storage intacto", () => {
    useStaffAuth.getState().setSession({ token: "a", expiresAt: null });
    const other = JSON.stringify({
      state: { token: "a", expiresAt: null, user: null, sessionId: "sid-otra-pestana" },
      version: 1,
    });
    localStorage.setItem(STAFF_AUTH_STORAGE_KEY, other);
    const spy = vi.spyOn(Storage.prototype, "setItem");
    try {
      expect(useStaffAuth.getState().setUser(user, "a")).toBe(false);
      expect(spy.mock.calls.some(([key]) => key === STAFF_AUTH_STORAGE_KEY)).toBe(false);
    } finally {
      spy.mockRestore();
    }
    expect(localStorage.getItem(STAFF_AUTH_STORAGE_KEY)).toBe(other);
  });

  it("si el token con el que se pidió /auth/me ya no es el de memoria, se descarta", () => {
    useStaffAuth.getState().setSession({ token: "b", expiresAt: null });
    expect(useStaffAuth.getState().setUser(user, "a")).toBe(false);
    expect(useStaffAuth.getState().user).toBeNull();
  });
});
