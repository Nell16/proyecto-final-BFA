import { useCallback, useState } from "react";

/** Control de enlaces ya exportados (copiados, impresos o descargados), POR asignación. */
export function useExportTracker() {
  const [exportedIds, setExportedIds] = useState<ReadonlySet<number>>(() => new Set());

  const markExported = useCallback((ids: Iterable<number>) => {
    setExportedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
  }, []);

  const reset = useCallback(() => setExportedIds(new Set()), []);

  return { exportedIds, markExported, reset };
}

export const countUnexported = (
  entries: readonly { assignmentId: number }[] | null | undefined,
  exportedIds: ReadonlySet<number>,
): number => (entries ?? []).filter((e) => !exportedIds.has(e.assignmentId)).length;

export const UNEXPORTED_LINKS_DESCRIPTION =
  "Hay enlaces de acceso que todavía no copió, imprimió ni descargó. El token no se puede volver a mostrar ni regenerar todavía, así que si sale ahora esos participantes quedarán sin enlace.";
