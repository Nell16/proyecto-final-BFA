import { describe, expect, it } from "vitest";
import { isAppPath, isEvaluationPath } from "./areaPaths";

describe("isAppPath", () => {
  it("acepta /app exacto y sus descendientes (con query/hash)", () => {
    expect(isAppPath("/app")).toBe(true);
    expect(isAppPath("/app/")).toBe(true);
    expect(isAppPath("/app/sesiones/3")).toBe(true);
    expect(isAppPath("/app?x=1")).toBe(true);
    expect(isAppPath("/app#frag")).toBe(true);
    expect(isAppPath("/app/dashboard?tab=a")).toBe(true);
  });

  it("'/application' y otros prefijos de texto NO cuentan como /app", () => {
    expect(isAppPath("/application")).toBe(false);
    expect(isAppPath("/application/x")).toBe(false);
    expect(isAppPath("/apple")).toBe(false);
    expect(isAppPath("/login?redirect=/app")).toBe(false);
    expect(isAppPath("")).toBe(false);
  });
});

describe("isEvaluationPath", () => {
  it("solo /evaluacion exacto o descendientes", () => {
    expect(isEvaluationPath("/evaluacion")).toBe(true);
    expect(isEvaluationPath("/evaluacion/acceso")).toBe(true);
    expect(isEvaluationPath("/evaluacion?x=1")).toBe(true);
    expect(isEvaluationPath("/evaluaciones")).toBe(false);
    expect(isEvaluationPath("/evaluacionX/acceso")).toBe(false);
  });
});
