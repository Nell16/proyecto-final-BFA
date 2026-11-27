import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { useStaffAuth } from "../../store/staffAuth";
import { ApiError } from "../errors";
import { getDashboardOverview } from "./dashboard";
import overviewFixture from "../schemas/__fixtures__/dashboard/overview.json";

const API = "http://localhost:8080";

beforeEach(() => {
  useStaffAuth.getState().setSession({
    token: "staff-jwt",
    expiresAt: null,
    user: { id: "u1", username: "consultor", roles: ["CONSULTOR"], permissions: ["RESULTADO_AGREGADO_VER"] },
  });
});

afterEach(() => useStaffAuth.getState().clear());

describe("dashboard endpoints", () => {
  it("getDashboardOverview parses fixture with sessionId and tolerates extra fields", async () => {
    let seenSessionId: string | null = null;
    server.use(
      http.get(`${API}/dashboard/overview`, ({ request }) => {
        seenSessionId = new URL(request.url).searchParams.get("sessionId");
        return HttpResponse.json({
          success: true,
          data: { ...overviewFixture, extraMetric: 99 },
        });
      }),
    );

    const overview = await getDashboardOverview({ sessionId: 10 });
    expect(seenSessionId).toBe("10");
    expect(overview).toMatchObject({
      sessionId: 10,
      assignedCount: 30,
      startedCount: 25,
      completedCount: 22,
      scoredCount: 20,
    });
  });

  it("getDashboardOverview surfaces envelope errors", async () => {
    server.use(
      http.get(`${API}/dashboard/overview`, () =>
        HttpResponse.json({
          success: false,
          data: null,
          error: { code: "NOT_FOUND", message: "Sesión no encontrada" },
        }),
      ),
    );

    const err = await getDashboardOverview({ sessionId: 999 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("NOT_FOUND");
  });
});
