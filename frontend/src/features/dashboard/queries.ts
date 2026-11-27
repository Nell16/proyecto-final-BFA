import { queryOptions } from "@tanstack/react-query";
import { getDashboardOverview } from "../../api/endpoints/dashboard";

export const dashboardKeys = {
  all: ["dashboard"] as const,
  overview: (sessionId: number) => [...dashboardKeys.all, "overview", sessionId] as const,
};

export const dashboardOverviewQuery = (sessionId: number, enabled = true) =>
  queryOptions({
    queryKey: dashboardKeys.overview(sessionId),
    queryFn: () => getDashboardOverview({ sessionId }),
    enabled: enabled && Number.isInteger(sessionId) && sessionId > 0,
  });
