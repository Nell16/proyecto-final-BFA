import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ConfirmDialog } from "../../../app/components/ui/confirm-dialog";

interface PrintExport {
  /** Abre el diálogo de impresión; los enlaces NO se marcan como exportados hasta que el usuario lo confirme. */
  print: () => void;
  /** Renderizar en el árbol del componente: pregunta «¿Se imprimió o guardó la hoja?» tras `afterprint`. */
  dialog: ReactNode;
}

/**
 * Imprimir no garantiza que la hoja salió (el usuario puede cancelar el diálogo del navegador). Tras
 * `afterprint` se pide confirmación explícita y solo un «Sí» marca los ids como exportados. Si el navegador
 * no emite `afterprint` no se marca nada (falla del lado seguro: el aviso de salida se mantiene).
 */
export function usePrintExport(getIds: () => number[], onExported: (assignmentIds: number[]) => void): PrintExport {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const idsRef = useRef<number[]>([]);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => () => cleanupRef.current?.(), []);

  const print = useCallback(() => {
    cleanupRef.current?.();
    idsRef.current = getIds();
    const onAfterPrint = () => {
      cleanup();
      setConfirmOpen(true);
    };
    const cleanup = () => {
      window.removeEventListener("afterprint", onAfterPrint);
      cleanupRef.current = null;
    };
    cleanupRef.current = cleanup;
    window.addEventListener("afterprint", onAfterPrint);
    window.print();
  }, [getIds]);

  const dialog = (
    <ConfirmDialog
      open={confirmOpen}
      onOpenChange={setConfirmOpen}
      title="¿Se imprimió o guardó la hoja?"
      description="Solo si confirma, los enlaces de esta hoja se contarán como exportados y dejará de avisarle al salir."
      confirmLabel="Sí"
      cancelLabel="No"
      onConfirm={() => onExported(idsRef.current)}
    />
  );

  return { print, dialog };
}
