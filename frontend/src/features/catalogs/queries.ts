import { queryOptions } from "@tanstack/react-query";
import { listCatalog } from "../../api/endpoints/academic";
import type { AcademicGroup, Career, CatalogType, Cohort, Sex } from "../../api/schemas/academic";

/** Los catálogos cambian muy poco: 10 min de frescura. */
export const CATALOG_STALE_TIME_MS = 10 * 60_000;

export interface CatalogItemByType {
  sexos: Sex;
  carreras: Career;
  cohortes: Cohort;
  "grupos-academicos": AcademicGroup;
}

export const catalogKeys = {
  all: ["catalogs"] as const,
  type: (type: CatalogType) => [...catalogKeys.all, type] as const,
  list: (type: CatalogType) => [...catalogKeys.type(type), "list"] as const,
};

export const catalogListQuery = <T extends CatalogType>(type: T) =>
  queryOptions({
    queryKey: catalogKeys.list(type),
    // `listCatalog` devuelve la unión; el parseo por tipo garantiza el elemento correcto.
    queryFn: () => listCatalog(type) as Promise<CatalogItemByType[T][]>,
    staleTime: CATALOG_STALE_TIME_MS,
  });
