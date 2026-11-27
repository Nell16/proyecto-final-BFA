import { useQuery } from "@tanstack/react-query";
import type { CatalogType } from "../../api/schemas/academic";
import { useStaffAuth } from "../../store/staffAuth";
import { CATALOG_LABELS, CATALOG_PERMISSIONS } from "./permissions";
import { catalogListQuery, type CatalogItemByType } from "./queries";

const EMPTY: readonly never[] = [];

export interface UseCatalogResult<T extends CatalogType> {
  items: readonly CatalogItemByType[T][];
  isLoading: boolean;
  /** Motivo por el que el catálogo no está disponible (sin permiso o con error); `null` si sí lo está. */
  unavailableReason: string | null;
  refetch: () => void;
}

/**
 * Lee un catálogo de forma INDEPENDIENTE: nunca bloquea a quien lo usa. Si el usuario no tiene
 * el permiso de lectura no se consulta; si la consulta falla (p. ej. 403) se expone el motivo
 * para deshabilitar los controles que dependen de él.
 */
export function useCatalog<T extends CatalogType>(
  type: T,
  options: { enabled?: boolean } = {},
): UseCatalogResult<T> {
  const { enabled = true } = options;
  const canRead = useStaffAuth((s) => s.hasPermission(CATALOG_PERMISSIONS[type].read));
  const query = useQuery({ ...catalogListQuery(type), enabled: enabled && canRead });
  const label = CATALOG_LABELS[type];

  let unavailableReason: string | null = null;
  if (!enabled) unavailableReason = null;
  else if (!canRead) unavailableReason = `No tiene permiso para consultar ${label}.`;
  else if (query.isError) unavailableReason = `No se pudo consultar ${label}. Es posible que no tenga permiso.`;

  return {
    items: query.data ?? EMPTY,
    isLoading: enabled && canRead && query.isPending,
    unavailableReason,
    refetch: () => {
      void query.refetch();
    },
  };
}
