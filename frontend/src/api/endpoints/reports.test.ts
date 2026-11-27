import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { useStaffAuth } from "../../store/staffAuth";
import { ApiError } from "../errors";
import { createAggregateReport, createIndividualReport, listReports } from "./reports";
import reportsFixture from "../schemas/__fixtures__/reports/reports.json";

const API = "http://localhost:8080";

beforeEach(() => {
  useStaffAuth.getState().setSession({
    token: "staff-jwt",
    expiresAt: null,
    user: { id: "u1", username: "admin", roles: ["ADMIN"], permissions: ["REPORTE_EXPORTAR"] },
  });
});

afterEach(() => useStaffAuth.getState().clear());

describe("reports endpoints", () => {
  it("listReports parses fixture with serverDateTime and tolerates extra fields", async () => {
    let seenSessionId: string | null = null;
    server.use(
      http.get(`${API}/reports`, ({ request }) => {
        seenSessionId = new URL(request.url).searchParams.get("sessionId");
        return HttpResponse.json({
          success: true,
          data: reportsFixture.map((row) => ({ ...row, extraBackendField: true })),
        });
      }),
    );

    const list = await listReports({ sessionId: 10 });
    expect(seenSessionId).toBe("10");
    expect(list).toHaveLength(2);
    expect(list[0]?.generatedAt).toBe("2026-10-01T09:30:00.000Z");
    expect(list[1]?.format).toBe("XLSX");
  });

  it("createIndividualReport and createAggregateReport parse responses and handle envelope errors", async () => {
    server.use(
      http.post(`${API}/reports/individual`, () =>
        HttpResponse.json({ success: true, data: reportsFixture[0] }),
      ),
      http.post(`${API}/reports/aggregate`, () =>
        HttpResponse.json({
          success: false,
          data: null,
          error: { code: "BAD_REQUEST", message: "El reporte agregado requiere sesion" },
        }),
      ),
    );

    const individual = await createIndividualReport({
      type: "INDIVIDUAL",
      format: "PDF",
      storagePath: "/reports/individual-42.pdf",
      attemptId: 42,
    });
    expect(individual.id).toBe(3);
    expect(individual.attemptId).toBe(42);

    const err = await createAggregateReport({
      type: "AGREGADO",
      format: "XLSX",
      storagePath: "/reports/session-10.xlsx",
      sessionId: 10,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("BAD_REQUEST");
  });
});
