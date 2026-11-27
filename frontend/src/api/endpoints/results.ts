import { staffClient } from "../client";
import { unwrap, type ApiEnvelope } from "../errors";
import { parseOrThrow } from "../schemas/parse";
import {
  AttemptResultSchema,
  DetailedAttemptResultSchema,
  DimensionAggregateListSchema,
  GeneratedReportListSchema,
  GeneratedReportSchema,
  PendingReviewListSchema,
  PendingReviewSchema,
  ScoreAttemptResultSchema,
  SessionResultSummarySchema,
  type AttemptResult,
  type DetailedAttemptResult,
  type DimensionAggregate,
  type GeneratedReport,
  type PendingReview,
  type ReportFormat,
  type ScoreAttemptResult,
  type SessionResultSummary,
} from "../schemas/results";

export interface ReportFilterParams {
  attemptId?: number;
  resultId?: number;
  sessionId?: number;
}

export interface CreateReportInput {
  type: string;
  format: ReportFormat;
  storagePath: string;
  filtersJson?: string;
  attemptId?: number;
  resultId?: number;
  sessionId?: number;
}

export interface SubmitReviewInput {
  score?: number | null;
  comment?: string | null;
  approved: boolean;
}

export async function scoreAttempt(attemptId: number): Promise<ScoreAttemptResult> {
  const res = await staffClient.post<ApiEnvelope<unknown>>(`/attempts/${attemptId}/score`);
  return parseOrThrow(ScoreAttemptResultSchema, unwrap(res), `POST /attempts/${attemptId}/score`);
}

export async function getAttemptResult(attemptId: number): Promise<AttemptResult> {
  const res = await staffClient.get<ApiEnvelope<unknown>>(`/attempts/${attemptId}/result`);
  return parseOrThrow(AttemptResultSchema, unwrap(res), `GET /attempts/${attemptId}/result`);
}

export async function getDetailedResult(attemptId: number): Promise<DetailedAttemptResult> {
  const res = await staffClient.get<ApiEnvelope<unknown>>(`/attempts/${attemptId}/detailed-result`);
  return parseOrThrow(DetailedAttemptResultSchema, unwrap(res), `GET /attempts/${attemptId}/detailed-result`);
}

export async function getSessionSummary(sessionId: number): Promise<SessionResultSummary> {
  const res = await staffClient.get<ApiEnvelope<unknown>>(`/analytics/sessions/${sessionId}/summary`);
  return parseOrThrow(SessionResultSummarySchema, unwrap(res), `GET /analytics/sessions/${sessionId}/summary`);
}

export async function getAnalytics(params: { sessionId: number }): Promise<DimensionAggregate[]> {
  const res = await staffClient.get<ApiEnvelope<unknown>>("/analytics/results", { params });
  return parseOrThrow(DimensionAggregateListSchema, unwrap(res), "GET /analytics/results");
}

export async function getDashboardOverview(params: { sessionId: number }): Promise<SessionResultSummary> {
  const res = await staffClient.get<ApiEnvelope<unknown>>("/dashboard/overview", { params });
  return parseOrThrow(SessionResultSummarySchema, unwrap(res), "GET /dashboard/overview");
}

export async function listReports(params: ReportFilterParams = {}): Promise<GeneratedReport[]> {
  const res = await staffClient.get<ApiEnvelope<unknown>>("/reports", { params });
  return parseOrThrow(GeneratedReportListSchema, unwrap(res), "GET /reports");
}

export async function createIndividualReport(input: CreateReportInput): Promise<GeneratedReport> {
  const res = await staffClient.post<ApiEnvelope<unknown>>("/reports/individual", input);
  return parseOrThrow(GeneratedReportSchema, unwrap(res), "POST /reports/individual");
}

export async function createAggregateReport(input: CreateReportInput): Promise<GeneratedReport> {
  const res = await staffClient.post<ApiEnvelope<unknown>>("/reports/aggregate", input);
  return parseOrThrow(GeneratedReportSchema, unwrap(res), "POST /reports/aggregate");
}

export async function listPendingReviews(): Promise<PendingReview[]> {
  const res = await staffClient.get<ApiEnvelope<unknown>>("/manual-review/pending");
  return parseOrThrow(PendingReviewListSchema, unwrap(res), "GET /manual-review/pending");
}

export async function markPending(answerId: number): Promise<PendingReview> {
  const res = await staffClient.post<ApiEnvelope<unknown>>(`/manual-review/answers/${answerId}/pending`);
  return parseOrThrow(PendingReviewSchema, unwrap(res), `POST /manual-review/answers/${answerId}/pending`);
}

export async function submitReview(reviewId: number, input: SubmitReviewInput): Promise<PendingReview> {
  const res = await staffClient.put<ApiEnvelope<unknown>>(`/manual-review/${reviewId}`, input);
  return parseOrThrow(PendingReviewSchema, unwrap(res), `PUT /manual-review/${reviewId}`);
}
