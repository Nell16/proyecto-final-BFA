import { staffClient } from "../client";
import { unwrap, type ApiEnvelope } from "../errors";
import { DashboardOverviewSchema, type DashboardOverview } from "../schemas/dashboard";
import { parseOrThrow } from "../schemas/parse";

export async function getDashboardOverview(params: { sessionId: number }): Promise<DashboardOverview> {
  const res = await staffClient.get<ApiEnvelope<unknown>>("/dashboard/overview", { params });
  return parseOrThrow(DashboardOverviewSchema, unwrap(res), "GET /dashboard/overview");
}
