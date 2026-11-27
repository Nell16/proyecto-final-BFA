import { queryOptions } from "@tanstack/react-query";
import { listCatalog, listParticipants } from "../../../api/endpoints/academic";
import { listSubtests, listTests, listVersions } from "../../../api/endpoints/instruments";
import type { Participant } from "../../../api/schemas/academic";
import { ApiError } from "../../../api/errors";

/** Keys propias del wizard (no usan el prefijo `runtime`, que es del participante). */
export const wizardKeys = {
  all: ["session-wizard"] as const,
  tests: () => [...wizardKeys.all, "tests"] as const,
  versions: (testId: number) => [...wizardKeys.all, "versions", testId] as const,
  subtests: (versionId: number) => [...wizardKeys.all, "subtests", versionId] as const,
  catalog: (type: "carreras" | "cohortes" | "grupos-academicos") => [...wizardKeys.all, "catalog", type] as const,
  participants: () => [...wizardKeys.all, "participants"] as const,
};

const PARTICIPANT_PAGE_SIZE = 200;
const MAX_PARTICIPANT_PAGES = 50;

/** El backend solo expone paginación (B10): se recorren todas las páginas para filtrar en cliente. */
export async function listAllParticipants(): Promise<Participant[]> {
  const all: Participant[] = [];
  for (let page = 0; page < MAX_PARTICIPANT_PAGES; page += 1) {
    const result = await listParticipants({ page, size: PARTICIPANT_PAGE_SIZE });
    all.push(...result.content);
    if (result.last || result.content.length === 0) break;
  }
  return all;
}

export const wizardTestsQuery = () => queryOptions({ queryKey: wizardKeys.tests(), queryFn: listTests });

export const wizardVersionsQuery = (testId: number) =>
  queryOptions({ queryKey: wizardKeys.versions(testId), queryFn: () => listVersions(testId) });

export const wizardSubtestsQuery = (versionId: number) =>
  queryOptions({ queryKey: wizardKeys.subtests(versionId), queryFn: () => listSubtests(versionId) });

/**
 * No existe `GET /versiones/{id}`: para una sesión reanudada se localiza la versión recorriendo los tests.
 * Devuelve `null` si no se encuentra.
 */
export const wizardVersionLookupQuery = (versionId: number) =>
  queryOptions({
    queryKey: [...wizardKeys.all, "version-lookup", versionId] as const,
    queryFn: async () => {
      const tests = await listTests();
      for (const test of tests) {
        const found = (await listVersions(test.id)).find((v) => v.id === versionId);
        if (found) return found;
      }
      return null;
    },
    retry: false,
  });

export const wizardCareersQuery = () =>
  queryOptions({ queryKey: wizardKeys.catalog("carreras"), queryFn: () => listCatalog("carreras") });

export const wizardCohortsQuery = () =>
  queryOptions({ queryKey: wizardKeys.catalog("cohortes"), queryFn: () => listCatalog("cohortes") });

export const wizardGroupsQuery = () =>
  queryOptions({ queryKey: wizardKeys.catalog("grupos-academicos"), queryFn: () => listCatalog("grupos-academicos") });

export const wizardParticipantsQuery = () =>
  queryOptions({ queryKey: wizardKeys.participants(), queryFn: listAllParticipants });

export const isForbidden = (error: unknown): boolean => error instanceof ApiError && error.status === 403;

export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim() !== "") return error.message;
  return fallback;
}

export const NO_TEST_PERMISSION_MESSAGE =
  "Su rol no tiene permiso para consultar instrumentos. Solicite al administrador el permiso de lectura del catálogo de instrumentos.";
export const NO_PARTICIPANT_PERMISSION_MESSAGE =
  "Su rol no tiene permiso para consultar participantes. Solicite al administrador el permiso de lectura de participantes.";
