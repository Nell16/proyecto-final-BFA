import { describe, expect, it } from "vitest";
import sessionsFixture from "./__fixtures__/sessions/sessions.json";
import { SessionWireSchema } from "./sessions";

describe("SessionWireSchema", () => {
  it("normaliza creadoEn (y las demás fechas) del fixture con serverDateTime", () => {
    const wire = SessionWireSchema.parse(sessionsFixture[0]);
    expect(wire.creadoEn).toBe("2026-11-20T14:30:00.000Z");
    expect(wire.inicioProgramado).toBe("2026-11-24T09:00:00.000Z");
    expect(SessionWireSchema.parse({ ...sessionsFixture[0], creadoEn: null }).creadoEn).toBeNull();
  });
});
