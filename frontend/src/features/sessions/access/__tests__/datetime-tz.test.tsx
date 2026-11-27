import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AssignedParticipantSchema, SessionSchema } from "../../../../api/schemas/sessions";
import { formatDateTime } from "../../detail/format";
import { toCreateSessionRequest } from "../../wizard/schemas";
import { ExpiryNotice } from "../ExpiryNotice";
import { computeTtlHours } from "../ttl";

const ORIGINAL_TZ = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "America/Managua"; // UTC-6
});
afterAll(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

const session = SessionSchema.parse({
  id: 1,
  codigoSesion: "S",
  nombreSesion: "N",
  estado: "PROGRAMADA",
  versionTestId: 1,
  // 16:00 UTC = 10:00 hora local de Managua
  inicioProgramado: "2026-11-24T16:00:00",
  finProgramado: "2026-11-24T18:00:00",
});

describe("fechas del backend (UTC sin zona) en la zona del navegador", () => {
  it("un expiresAt '…T14:00:00' del backend se muestra como 08:00 local", () => {
    const { expiresAt } = AssignedParticipantSchema.parse({ assignmentId: 1, rawToken: "t", expiresAt: "2026-11-24T14:00:00" });
    expect(formatDateTime(expiresAt)).toBe("24/11/2026 08:00");
    // También con el valor crudo (sin pasar por el schema): la regla vive en el formateador.
    expect(formatDateTime("2026-11-24T14:00:00")).toBe("24/11/2026 08:00");
    expect(formatDateTime(session.scheduledStart)).toBe("24/11/2026 10:00");
  });

  it("ese vencimiento (08:00 local) dispara el aviso para una sesión que empieza a las 10:00 local", () => {
    render(
      <ExpiryNotice entries={[{ expiresAt: "2026-11-24T14:00:00" }]} scheduledStart={session.scheduledStart} />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/vence antes del inicio programado/i);
  });

  it("y no avisa cuando vence después del inicio (22:00Z = 16:00 local)", () => {
    render(<ExpiryNotice entries={[{ expiresAt: "2026-11-24T22:00:00" }]} scheduledStart={session.scheduledStart} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("computeTtlHours interpreta el fin programado como UTC", () => {
    // ahora = 2026-11-24T10:00Z; fin 18:00Z + 1 h = 19:00Z → 9 h
    expect(computeTtlHours(session, new Date("2026-11-24T10:00:00Z"))).toBe(9);
  });

  it("el wizard convierte fecha + hora locales a LocalDateTime UTC al crear la sesión", () => {
    const request = toCreateSessionRequest({
      name: "x",
      code: "SES-1",
      date: "2026-11-24",
      startTime: "09:00",
      endTime: "11:30",
      location: "",
      description: "",
      testId: "1",
      versionId: "10",
    });
    expect(request.scheduledStart).toBe("2026-11-24T15:00:00");
    expect(request.scheduledEnd).toBe("2026-11-24T17:30:00");
  });
});
