import { describe, expect, it } from "vitest";
import { ApiError } from "../../../api/errors";
import { computeBackoffMs } from "./backoff";
import { DEFINITIVE_REJECTION_CODES, classifyError, isDefinitiveCode } from "./classify";

const apiError = (status: number, code: string) => new ApiError({ status, code, message: code });

describe("classifyError (ítem: PUT individual)", () => {
  it.each(DEFINITIVE_REJECTION_CODES)("%s es definitivo", (code) => {
    expect(classifyError(apiError(409, code), "item")).toEqual({ kind: "definitive", code });
  });

  it("400 BAD_REQUEST y 404 NOT_FOUND del PUT equivalen a RESPUESTA_INVALIDA e ITEM_NO_ENCONTRADO", () => {
    expect(classifyError(apiError(400, "BAD_REQUEST"), "item")).toEqual({
      kind: "definitive",
      code: "RESPUESTA_INVALIDA",
    });
    expect(classifyError(apiError(404, "NOT_FOUND"), "item")).toEqual({
      kind: "definitive",
      code: "ITEM_NO_ENCONTRADO",
    });
  });

  it("SUBTEST_NO_INICIADO es transitorio acotado, SESION_PAUSADA es pausa", () => {
    expect(classifyError(apiError(409, "SUBTEST_NO_INICIADO"), "item")).toEqual({ kind: "not-started" });
    expect(classifyError(apiError(409, "SESION_PAUSADA"), "item")).toEqual({ kind: "paused" });
  });

  it("los 409 de runtime bloqueado y 401/403 retienen la cola sin reintento", () => {
    for (const code of ["SESION_NO_ABIERTA", "SESION_FINALIZADA", "TOKEN_EXPIRADO", "ASIGNACION_NO_OPERABLE"]) {
      expect(classifyError(apiError(409, code), "item")).toEqual({ kind: "blocked", code });
    }
    expect(classifyError(apiError(403, "FORBIDDEN"), "item")).toEqual({ kind: "blocked", code: "FORBIDDEN" });
    expect(classifyError(apiError(401, "UNAUTHORIZED"), "item")).toEqual({ kind: "blocked", code: "UNAUTHORIZED" });
  });

  it("red, timeout, 5xx, 408 y 429 son reintentables", () => {
    expect(classifyError(apiError(0, "NETWORK"), "item")).toEqual({ kind: "retry" });
    expect(classifyError(apiError(0, "TIMEOUT"), "item")).toEqual({ kind: "retry" });
    expect(classifyError(apiError(503, "HTTP_503"), "item")).toEqual({ kind: "retry" });
    expect(classifyError(apiError(408, "HTTP_408"), "item")).toEqual({ kind: "retry" });
    expect(classifyError(apiError(429, "HTTP_429"), "item")).toEqual({ kind: "retry" });
    expect(classifyError(new Error("boom"), "item")).toEqual({ kind: "retry" });
  });

  it("un 4xx desconocido es `client` (transitorio acotado)", () => {
    expect(classifyError(apiError(409, "CONFLICT"), "item")).toEqual({ kind: "client", code: "CONFLICT" });
    expect(classifyError(apiError(422, "RARO"), "item")).toEqual({ kind: "client", code: "RARO" });
  });
});

describe("classifyError (lote: bulk-sync entero)", () => {
  it("los códigos por ítem y 400/404 NO son veredicto del lote: se aíslan ítem por ítem", () => {
    expect(classifyError(apiError(409, "SUBTEST_FINALIZADO"), "batch")).toEqual({
      kind: "client",
      code: "SUBTEST_FINALIZADO",
    });
    expect(classifyError(apiError(409, "TIEMPO_AGOTADO"), "batch")).toEqual({ kind: "client", code: "TIEMPO_AGOTADO" });
    expect(classifyError(apiError(409, "SUBTEST_NO_INICIADO"), "batch")).toEqual({
      kind: "client",
      code: "SUBTEST_NO_INICIADO",
    });
    expect(classifyError(apiError(400, "BAD_REQUEST"), "batch")).toEqual({ kind: "client", code: "BAD_REQUEST" });
    expect(classifyError(apiError(413, "PAYLOAD_TOO_LARGE"), "batch")).toEqual({
      kind: "client",
      code: "PAYLOAD_TOO_LARGE",
    });
  });

  it("transporte, pausa y bloqueo valen para todo el lote", () => {
    expect(classifyError(apiError(0, "NETWORK"), "batch")).toEqual({ kind: "retry" });
    expect(classifyError(apiError(502, "HTTP_502"), "batch")).toEqual({ kind: "retry" });
    expect(classifyError(apiError(409, "SESION_PAUSADA"), "batch")).toEqual({ kind: "paused" });
    expect(classifyError(apiError(409, "TOKEN_EXPIRADO"), "batch")).toEqual({ kind: "blocked", code: "TOKEN_EXPIRADO" });
    expect(classifyError(apiError(403, "FORBIDDEN"), "batch")).toEqual({ kind: "blocked", code: "FORBIDDEN" });
  });
});

describe("isDefinitiveCode", () => {
  it("solo reconoce los cinco códigos definitivos", () => {
    expect(DEFINITIVE_REJECTION_CODES.every((code) => isDefinitiveCode(code))).toBe(true);
    expect(isDefinitiveCode("SUBTEST_NO_INICIADO")).toBe(false);
    expect(isDefinitiveCode("SESION_PAUSADA")).toBe(false);
    expect(isDefinitiveCode(null)).toBe(false);
    expect(isDefinitiveCode("CUALQUIER_COSA")).toBe(false);
  });
});

describe("computeBackoffMs", () => {
  const base = { baseDelayMs: 1000, maxDelayMs: 30_000 };

  it("crece exponencialmente y respeta el máximo", () => {
    const top = { ...base, random: () => 0.999999 };
    const low = { ...base, random: () => 0 };
    expect(computeBackoffMs(0, low)).toBe(500);
    expect(computeBackoffMs(0, top)).toBe(1000);
    expect(computeBackoffMs(1, low)).toBe(1000);
    expect(computeBackoffMs(2, low)).toBe(2000);
    expect(computeBackoffMs(4, low)).toBe(8000);
    expect(computeBackoffMs(10, top)).toBeLessThanOrEqual(30_000);
    expect(computeBackoffMs(10, low)).toBe(15_000);
    expect(computeBackoffMs(500, top)).toBeLessThanOrEqual(30_000);
  });

  it("el jitter queda en [techo/2, techo]", () => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const ceiling = Math.min(30_000, 1000 * 2 ** attempt);
      for (const r of [0, 0.25, 0.5, 0.75, 0.999]) {
        const delay = computeBackoffMs(attempt, { ...base, random: () => r });
        expect(delay).toBeGreaterThanOrEqual(ceiling / 2);
        expect(delay).toBeLessThanOrEqual(ceiling);
      }
    }
  });
});
