import { queryOptions, useQuery } from "@tanstack/react-query";
import { staffClient } from "../../api/client";
import {
  getSubtestCloneTemplate,
  listBaremos,
  listScoringRules,
  listScoringStrategies,
  listTests,
  listVersions,
} from "../../api/endpoints/instruments";
import { captureAccountScope } from "../../store/accountScope";
import { loadVersionDocument } from "./document/adapters";
import { useInstrumentPermissions } from "./permissions";

export const STAFF_IMAGE_STALE_TIME_MS = 5 * 60_000;

export const instrumentKeys = {
  all: ["instruments"] as const,
  tests: () => [...instrumentKeys.all, "tests"] as const,
  versions: (testId: number) => [...instrumentKeys.all, "versions", testId] as const,
  versionDocument: (versionId: number) =>
    [...instrumentKeys.all, "version-document", versionId] as const,
  clonePlan: (sourceVersionId: number) =>
    [...instrumentKeys.all, "clone-plan", sourceVersionId] as const,
  scoringStrategies: () => [...instrumentKeys.all, "scoring-strategies"] as const,
  scoringRules: (subtestId: number) =>
    [...instrumentKeys.all, "scoring-rules", subtestId] as const,
  subtestCloneTemplate: (subtestId: number) =>
    [...instrumentKeys.all, "subtest-clone-template", subtestId] as const,
  baremos: (versionId: number) => [...instrumentKeys.all, "baremos", versionId] as const,
  staffImage: (resourceId: number) => [...instrumentKeys.all, "staff-image", resourceId] as const,
};

export const testsListQuery = () =>
  queryOptions({
    queryKey: instrumentKeys.tests(),
    queryFn: listTests,
  });

export const versionsListQuery = (testId: number) =>
  queryOptions({
    queryKey: instrumentKeys.versions(testId),
    queryFn: () => listVersions(testId),
  });

export const versionDocumentQuery = (versionId: number, options?: { testId?: number }) =>
  queryOptions({
    queryKey: instrumentKeys.versionDocument(versionId),
    queryFn: () =>
      loadVersionDocument(versionId, {
        testId: options?.testId,
        scope: captureAccountScope(),
      }),
  });

export const scoringRulesQuery = (subtestId: number) =>
  queryOptions({
    queryKey: instrumentKeys.scoringRules(subtestId),
    queryFn: () => listScoringRules(subtestId),
  });

export const subtestCloneTemplateQuery = (subtestId: number) =>
  queryOptions({
    queryKey: instrumentKeys.subtestCloneTemplate(subtestId),
    queryFn: () => getSubtestCloneTemplate(subtestId),
  });

export const baremosQuery = (versionId: number) =>
  queryOptions({
    queryKey: instrumentKeys.baremos(versionId),
    queryFn: () => listBaremos(versionId),
  });

export const scoringStrategiesQuery = (enabled: boolean) =>
  queryOptions({
    queryKey: instrumentKeys.scoringStrategies(),
    queryFn: listScoringStrategies,
    enabled,
  });

export function useScoringStrategies() {
  const { canConfigureScoring } = useInstrumentPermissions();
  return useQuery(scoringStrategiesQuery(canConfigureScoring));
}

export function staffImageQueryOptions(resourceId: number) {
  return queryOptions({
    queryKey: instrumentKeys.staffImage(resourceId),
    queryFn: async ({ signal }): Promise<Blob> => {
      const res = await staffClient.get<Blob>(`/items/images/resources/${resourceId}`, {
        responseType: "blob",
        signal,
      });
      return res.data;
    },
    staleTime: STAFF_IMAGE_STALE_TIME_MS,
  });
}
