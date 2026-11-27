import { beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { useStaffAuth } from "../../store/staffAuth";
import { ApiError } from "../errors";
import {
  createAggregateReport,
  createIndividualReport,
  getAnalytics,
  getAttemptResult,
  getDashboardOverview,
  getDetailedResult,
  getSessionSummary,
  listPendingReviews,
  listReports,
  markPending,
  scoreAttempt,
  submitReview,
} from "./results";
import detailedResultFixture from "../schemas/__fixtures__/results/detailed-result.json";
import dashboardOverviewFixture from "../schemas/__fixtures__/results/dashboard-overview.json";
import attemptResultFixture from "../schemas/__fixtures__/results/attempt-result.json";
import scoreAttemptFixture from "../schemas/__fixtures__/results/score-attempt.json";
import pendingReviewsFixture from "../schemas/__fixtures__/results/pending-reviews.json";
import reportsFixture from "../schemas/__fixtures__/results/reports.json";

const API = "http://localhost:8080";

beforeEach(() => {
  useStaffAuth.getState().setSession({
    token: "staff-jwt",
    expiresAt: null,
    user: { id: "u1", username: "admin", roles: ["ADMIN"], permissions: ["RESULTADO_VER"] },
  });
});

describe("results endpoints", () => {
  it("getDetailedResult parses fixture and transforms carrera/cohorte/respuestaId", async () => {
    server.use(
      http.get(`${API}/attempts/42/detailed-result`, () =>
        HttpResponse.json({ success: true, data: detailedResultFixture }),
      ),
    );

    const res = await getDetailedResult(42);

    expect(res.attemptId).toBe(42);
    expect(res.career).toBe("Psicología");
    expect(res.cohort).toBe("2026-I");
    expect(res.attemptStatus).toBe("COMPLETADO");
    expect(res.subtests[0]?.items[0]?.response?.responseId).toBe(9001);
  });

  it("getDetailedResult tolerates unknown fields and falls back unknown status to DESCONOCIDO", async () => {
    server.use(
      http.get(`${API}/attempts/42/detailed-result`, () =>
        HttpResponse.json({
          success: true,
          data: {
            ...detailedResultFixture,
            attemptStatus: "ESTADO_NUEVO",
            extraBackendField: "tolerated",
          },
        }),
      ),
    );

    const res = await getDetailedResult(42);

    expect(res.attemptStatus).toBe("DESCONOCIDO");
  });

  it("normaliza las fechas sin offset del backend (UTC) a ISO con zona (conventions regla 10)", async () => {
    server.use(
      http.get(`${API}/attempts/42/detailed-result`, () => HttpResponse.json({ success: true, data: detailedResultFixture })),
      http.post(`${API}/attempts/42/score`, () => HttpResponse.json({ success: true, data: scoreAttemptFixture })),
      http.get(`${API}/manual-review/pending`, () => HttpResponse.json({ success: true, data: pendingReviewsFixture })),
    );

    const detail = await getDetailedResult(42);
    expect(detail.startedAt).toBe("2026-10-01T09:00:00.000Z");
    expect(detail.finishedAt).toBe("2026-10-01T09:18:30.000Z");
    expect(detail.scoredAt).toBe("2026-10-01T09:19:00.000Z");
    expect(detail.subtests[0]?.items[0]?.response?.answeredAt).toBe("2026-10-01T09:02:10.000Z");

    expect((await scoreAttempt(42)).scoredAt).toBe("2026-10-01T09:19:00.000Z");

    const [review] = await listPendingReviews();
    expect(review?.createdAt).toBe("2026-10-01T09:20:00.000Z");
    expect(review?.reviewedAt).toBeNull();
  });

  it("rechaza una fecha inválida con CONTRACT_MISMATCH", async () => {
    server.use(
      http.get(`${API}/attempts/42/detailed-result`, () =>
        HttpResponse.json({ success: true, data: { ...detailedResultFixture, startedAt: "no es una fecha" } }),
      ),
    );
    const err = await getDetailedResult(42).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("CONTRACT_MISMATCH");
  });

  it("getDashboardOverview parses fixture with sessionId query param", async () => {
    let seenSessionId: string | null = null;
    server.use(
      http.get(`${API}/dashboard/overview`, ({ request }) => {
        seenSessionId = new URL(request.url).searchParams.get("sessionId");
        return HttpResponse.json({
          success: true,
          data: { ...dashboardOverviewFixture, unexpectedExtra: 123 },
        });
      }),
    );

    const res = await getDashboardOverview({ sessionId: 10 });

    expect(seenSessionId).toBe("10");
    expect(res).toMatchObject({
      sessionId: 10,
      assignedCount: 30,
      startedCount: 25,
      completedCount: 22,
      scoredCount: 20,
    });
  });

  it("getDashboardOverview throws ApiError on envelope error", async () => {
    server.use(
      http.get(`${API}/dashboard/overview`, () =>
        HttpResponse.json({
          success: false,
          data: null,
          error: { code: "SESSION_NOT_FOUND", message: "Sesión no encontrada" },
        }),
      ),
    );

    const err = await getDashboardOverview({ sessionId: 999 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("SESSION_NOT_FOUND");
  });

  it("getDetailedResult throws CONTRACT_MISMATCH on invalid payload", async () => {
    server.use(
      http.get(`${API}/attempts/42/detailed-result`, () =>
        HttpResponse.json({ success: true, data: { invalid: true } }),
      ),
    );

    const err = await getDetailedResult(42).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("CONTRACT_MISMATCH");
  });

  it("scoreAttempt, getAttemptResult, getSessionSummary and getAnalytics parse backend shapes", async () => {
    server.use(
      http.post(`${API}/attempts/42/score`, () =>
        HttpResponse.json({ success: true, data: scoreAttemptFixture }),
      ),
      http.get(`${API}/attempts/42/result`, () =>
        HttpResponse.json({ success: true, data: attemptResultFixture }),
      ),
      http.get(`${API}/analytics/sessions/10/summary`, () =>
        HttpResponse.json({ success: true, data: dashboardOverviewFixture }),
      ),
      http.get(`${API}/analytics/results`, () =>
        HttpResponse.json({
          success: true,
          data: [
            {
              dimensionId: 5,
              name: "Somática",
              count: 4,
              averageDirectScore: null,
              suppressedByPrivacyThreshold: true,
            },
          ],
        }),
      ),
    );

    const scored = await scoreAttempt(42);
    expect(scored.attemptId).toBe(42);
    expect(scored.totalDirectScore).toBe(18);

    const result = await getAttemptResult(42);
    expect(result.resultId).toBe(15);

    const summary = await getSessionSummary(10);
    expect(summary.scoredCount).toBe(20);

    const analytics = await getAnalytics({ sessionId: 10 });
    expect(analytics[0]?.suppressedByPrivacyThreshold).toBe(true);
    expect(analytics[0]?.averageDirectScore).toBeNull();
  });

  it("reports and manual review endpoints parse fixtures", async () => {
    server.use(
      http.get(`${API}/reports`, () => HttpResponse.json({ success: true, data: reportsFixture })),
      http.post(`${API}/reports/individual`, () =>
        HttpResponse.json({ success: true, data: reportsFixture[0] }),
      ),
      http.post(`${API}/reports/aggregate`, () =>
        HttpResponse.json({ success: true, data: { ...reportsFixture[0], sesionAplicacionId: 10 } }),
      ),
      http.get(`${API}/manual-review/pending`, () =>
        HttpResponse.json({ success: true, data: pendingReviewsFixture }),
      ),
      http.post(`${API}/manual-review/answers/9002/pending`, () =>
        HttpResponse.json({ success: true, data: pendingReviewsFixture[0] }),
      ),
      http.put(`${API}/manual-review/7`, () =>
        HttpResponse.json({
          success: true,
          data: { ...pendingReviewsFixture[0], status: "REVISADO", score: 2 },
        }),
      ),
    );

    const reports = await listReports({ attemptId: 42 });
    expect(reports[0]?.format).toBe("PDF");
    expect(reports[0]?.storagePath).toBe("/reports/individual-42.pdf");

    const ind = await createIndividualReport({
      type: "INDIVIDUAL",
      format: "PDF",
      storagePath: "/reports/individual-42.pdf",
      attemptId: 42,
    });
    expect(ind.attemptId).toBe(42);

    const agg = await createAggregateReport({
      type: "AGGREGATE",
      format: "XLSX",
      storagePath: "/reports/session-10.xlsx",
      sessionId: 10,
    });
    expect(agg.sessionId).toBe(10);

    const pending = await listPendingReviews();
    expect(pending[0]?.status).toBe("PENDIENTE");

    const marked = await markPending(9002);
    expect(marked.answerId).toBe(9002);

    const resolved = await submitReview(7, { score: 2, comment: "Correcto", approved: true });
    expect(resolved.status).toBe("REVISADO");
    expect(resolved.score).toBe(2);
  });
});
