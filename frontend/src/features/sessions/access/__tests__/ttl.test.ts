import { describe, expect, it } from "vitest";
import { computeTtlHours, expiresBeforeStart, resolveExpiresAt } from "../ttl";

// Los valores del backend sin offset son UTC (regla 10): el "ahora" del test también se fija en UTC.
const NOW = new Date("2026-11-24T08:00:00Z");

describe("computeTtlHours", () => {
  it("usa fin programado + 1 h, redondeando hacia arriba", () => {
    // fin 12:30 + 1 h = 13:30 → 5.5 h desde las 08:00 → 6 → mínimo 8
    expect(computeTtlHours({ scheduledStart: "2026-11-24T09:00:00", scheduledEnd: "2026-11-24T12:30:00" }, NOW)).toBe(8);
    // fin 2026-11-26T10:15 + 1 h = 11:15 → 51.25 h → 52
    expect(computeTtlHours({ scheduledStart: "2026-11-26T09:00:00", scheduledEnd: "2026-11-26T10:15:00" }, NOW)).toBe(52);
  });

  it("sin fin usa inicio + 8 h", () => {
    // inicio 2026-11-25T08:00 + 8 h → 32 h
    expect(computeTtlHours({ scheduledStart: "2026-11-25T08:00:00" }, NOW)).toBe(32);
  });

  it("aplica el mínimo de 8 h aunque la sesión ya haya terminado", () => {
    expect(computeTtlHours({ scheduledStart: "2026-11-01T09:00:00", scheduledEnd: "2026-11-01T10:00:00" }, NOW)).toBe(8);
  });

  it("aplica el máximo de 336 h", () => {
    expect(computeTtlHours({ scheduledStart: "2027-03-01T09:00:00", scheduledEnd: "2027-03-01T12:00:00" }, NOW)).toBe(336);
  });

  it("con fechas inválidas devuelve el mínimo", () => {
    expect(computeTtlHours({ scheduledStart: "nope" }, NOW)).toBe(8);
  });
});

describe("resolveExpiresAt", () => {
  it("prefiere el valor de la respuesta, normalizado a ISO con zona (sin offset = UTC)", () => {
    expect(resolveExpiresAt("2026-11-24T22:00:00", 8, NOW)).toBe("2026-11-24T22:00:00.000Z");
    expect(resolveExpiresAt("2026-11-24T22:00:00-06:00", 8, NOW)).toBe("2026-11-25T04:00:00.000Z");
  });
  it("calcula el vencimiento si la respuesta no lo trae", () => {
    const value = resolveExpiresAt("", 10, NOW);
    expect(new Date(value).getTime()).toBe(NOW.getTime() + 10 * 3_600_000);
  });
});

describe("expiresBeforeStart", () => {
  it("detecta un vencimiento anterior al inicio", () => {
    expect(expiresBeforeStart("2026-11-24T10:00:00", "2026-11-24T12:00:00")).toBe(true);
    expect(expiresBeforeStart("2026-11-24T13:00:00", "2026-11-24T12:00:00")).toBe(false);
    expect(expiresBeforeStart(undefined, "2026-11-24T12:00:00")).toBe(false);
  });
});
