import { queryOptions } from "@tanstack/react-query";
import { listReports, type ReportFilterParams } from "../../api/endpoints/reports";

export const reportKeys = {
  all: ["reports"] as const,
  list: (filters: ReportFilterParams) => [...reportKeys.all, "list", filters] as const,
};

export const reportListQuery = (filters: ReportFilterParams = {}) =>
  queryOptions({
    queryKey: reportKeys.list(filters),
    queryFn: () => listReports(filters),
  });
