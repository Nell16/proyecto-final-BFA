import { afterEach, describe, expect, it, vi } from "vitest";
import { availableActions } from "../../mutations";

describe("availableActions (PAUSE_ENABLED desactivado por defecto)", () => {
  it("PROGRAMADA: abrir y cancelar", () => {
    expect(availableActions("PROGRAMADA")).toEqual({
      open: true,
      pause: false,
      resume: false,
      close: false,
      cancel: true,
    });
  });

  it("ABIERTA: cerrar y cancelar; pausar queda oculto sin el feature flag", () => {
    expect(availableActions("ABIERTA")).toEqual({
      open: false,
      pause: false,
      resume: false,
      close: true,
      cancel: true,
    });
  });

  it("PAUSADA: reanudar, cerrar y cancelar", () => {
    expect(availableActions("PAUSADA")).toEqual({
      open: false,
      pause: false,
      resume: true,
      close: true,
      cancel: true,
    });
  });

  it.each(["CERRADA", "CANCELADA", "DESCONOCIDO"] as const)("%s: sin acciones", (status) => {
    expect(Object.values(availableActions(status)).every((v) => v === false)).toBe(true);
  });
});

describe("availableActions con VITE_FEATURE_SESSION_PAUSE=true", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("ABIERTA habilita pausar", async () => {
    vi.stubEnv("VITE_FEATURE_SESSION_PAUSE", "true");
    vi.resetModules();
    const mod = await import("../../mutations");
    expect(mod.PAUSE_ENABLED).toBe(true);
    expect(mod.availableActions("ABIERTA").pause).toBe(true);
    expect(mod.availableActions("PROGRAMADA").pause).toBe(false);
  });
});
