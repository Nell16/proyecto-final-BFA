import { staffClient } from "../client";
import { unwrap, type ApiEnvelope } from "../errors";
import { parseOrThrow } from "../schemas/parse";
import {
  GeneratedReportListSchema,
  GeneratedReportSchema,
  type GeneratedReport,
  type ReportFormat,
} from "../schemas/reports";

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
