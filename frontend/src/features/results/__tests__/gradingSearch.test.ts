import { describe, expect, it } from "vitest";
import { gradingSearchSchema, resolveGradingSelection, sessionSearchSchema } from "../gradingSearch";

describe("gradingSearchSchema", () => {
  it("acepta sessionId y attemptId (también como texto de la URL)", () => {
    expect(gradingSearchSchema.parse({ sessionId: "7", attemptId: 9002 })).toEqual({ sessionId: 7, attemptId: 9002 });
  });

  it("valida cada valor por separado: uno inválido se ignora y el otro se conserva", () => {
    expect(gradingSearchSchema.parse({ sessionId: "abc", attemptId: 5 })).toEqual({ sessionId: undefined, attemptId: 5 });
    expect(gradingSearchSchema.parse({ sessionId: 3, attemptId: -1 })).toEqual({ sessionId: 3, attemptId: undefined });
    expect(gradingSearchSchema.parse({ sessionId: 0, attemptId: 1.5 })).toEqual({ sessionId: undefined, attemptId: undefined });
    expect(gradingSearchSchema.parse({})).toEqual({});
  });

  it("sessionSearchSchema solo conserva la sesión", () => {
    expect(sessionSearchSchema.parse({ sessionId: "4", attemptId: 9 })).toEqual({ sessionId: 4 });
    expect(sessionSearchSchema.parse({ sessionId: "x" })).toEqual({ sessionId: undefined });
  });
});

describe("resolveGradingSelection", () => {
  const options = [{ id: 3 }, { id: 2 }, { id: 1 }];

  it("usa la sesión pedida si existe en la lista fresca", () => {
    expect(resolveGradingSelection(options, 2)).toEqual({ sessionId: 2, requestedMissing: false });
  });

  it("sin pedido selecciona la más reciente (primera) sin avisar", () => {
    expect(resolveGradingSelection(options, undefined)).toEqual({ sessionId: 3, requestedMissing: false });
  });

  it("pedida inexistente: cae en la primera y avisa", () => {
    expect(resolveGradingSelection(options, 99)).toEqual({ sessionId: 3, requestedMissing: true });
  });

  it("lista fresca vacía: no hay selección (y avisa solo si se pidió una)", () => {
    expect(resolveGradingSelection([], undefined)).toEqual({ sessionId: undefined, requestedMissing: false });
    expect(resolveGradingSelection([], 5)).toEqual({ sessionId: undefined, requestedMissing: true });
  });
});
