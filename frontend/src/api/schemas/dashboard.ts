import { z } from "zod";

/** GET /dashboard/overview -> ResultQueryService.SessionResultSummary */
export const DashboardOverviewSchema = z
  .object({
    sessionId: z.number(),
    assignedCount: z.number(),
    startedCount: z.number(),
    completedCount: z.number(),
    scoredCount: z.number(),
  })
  .loose();
export type DashboardOverview = z.output<typeof DashboardOverviewSchema>;
