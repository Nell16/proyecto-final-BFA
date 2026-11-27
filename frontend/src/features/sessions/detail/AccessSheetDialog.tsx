import { useState } from "react";
import { Copy, Download, Printer, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { Button } from "../../../app/components/ui/button";
import { ConfirmDialog } from "../../../app/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../app/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../app/components/ui/table";
import { AccessQr, ACCESS_QR_PRINT_CSS } from "../access/AccessQr";
import { ExpiryNotice } from "../access/ExpiryNotice";
import { accessSheetCsv, accessSheetText, copyToClipboard, downloadTextFile } from "../access/export";
import { countUnexported, UNEXPORTED_LINKS_DESCRIPTION } from "../access/exportTracker";
import { usePrintExport } from "../access/usePrintExport";
import { buildAccessLink, type AccessEntry } from "./accessSheet";
import { formatDateTime } from "./format";

/** Al imprimir solo se ve la hoja: se oculta la app (#root), el overlay y los controles `.no-print`. */
const PRINT_CSS = `
@media print {
  body * { visibility: hidden !important; }
  #root { display: none !important; }
  .access-sheet, .access-sheet * { visibility: visible !important; }
  .access-sheet {
    position: absolute !important;
    inset: 0 auto auto 0 !important;
    transform: none !important;
    width: 100% !important;
    max-width: none !important;
    max-height: none !important;
    overflow: visible !important;
    border: 0 !important;
    box-shadow: none !important;
    padding: 0 !important;
    background: #fff !important;
    color: #000 !important;
  }
  .access-sheet .no-print { display: none !important; }
  .access-sheet code { word-break: break-all; }
}
${ACCESS_QR_PRINT_CSS}`;

/** Copia al portapapeles; devuelve `true` si se copió (solo entonces se marca como exportado). */
async function copyText(text: string, successMessage: string): Promise<boolean> {
  if (await copyToClipboard(text)) {
    toast.success(successMessage);
    return true;
  }
  toast.error("No se pudo copiar. Selecciona el texto y cópialo manualmente.");
  return false;
}

interface AccessSheetDialogProps {
  sessionName: string;
  /** Inicio programado de la sesión: permite avisar de enlaces que vencen antes de empezar. */
  scheduledStart?: string;
  /** `null` = cerrada. Al cerrarse el padre debe descartar las entradas (el token no se vuelve a mostrar). */
  entries: AccessEntry[] | null;
  /** Ids de asignación ya copiados, impresos o descargados (control POR asignación, lo lleva el padre). */
  exportedIds: ReadonlySet<number>;
  onExported: (assignmentIds: number[]) => void;
  onClose: () => void;
}

export function AccessSheetDialog({
  sessionName,
  scheduledStart,
  entries,
  exportedIds,
  onExported,
  onClose,
}: AccessSheetDialogProps) {
  const open = entries !== null;
  const rows = entries ?? [];
  const pending = countUnexported(rows, exportedIds);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const requestClose = () => {
    if (pending > 0) setConfirmOpen(true);
    else onClose();
  };
  const allIds = () => rows.map((r) => r.assignmentId);

  const copyAll = async () => {
    if (await copyText(accessSheetText(rows), "Hoja copiada.")) onExported(allIds());
  };
  // No se marca como exportado antes de imprimir: se pregunta tras `afterprint`.
  const { print, dialog: printDialog } = usePrintExport(allIds, onExported);
  const download = () => {
    downloadTextFile(`accesos-${sessionName.replace(/[^\w.-]+/g, "_") || "sesion"}.csv`, accessSheetCsv(rows));
    onExported(allIds());
  };

  return (
    <>
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) requestClose();
      }}
    >
      <DialogContent
        // Un token perdido no se puede recuperar: solo se cierra con el botón explícito.
        onEscapeKeyDown={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        className="access-sheet max-h-[90vh] overflow-y-auto sm:max-w-3xl"
      >
        <style>{PRINT_CSS}</style>
        <DialogHeader>
          <DialogTitle>Hoja de accesos</DialogTitle>
          <DialogDescription>
            Sesión «{sessionName}». Entrega a cada participante su enlace de acceso.
          </DialogDescription>
        </DialogHeader>

        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-warning-border bg-warning-muted p-3 text-sm text-warning-foreground"
        >
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <p>
            <strong>Estos códigos no se volverán a mostrar.</strong> Cópialos, descárgalos o imprime esta hoja antes de
            cerrar: el token no se puede volver a mostrar ni regenerar todavía.
          </p>
        </div>
        <ExpiryNotice entries={rows} scheduledStart={scheduledStart} />

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Participante</TableHead>
              <TableHead>Código</TableHead>
              <TableHead>Enlace de acceso</TableHead>
              <TableHead>QR</TableHead>
              <TableHead className="no-print">
                <span className="sr-only">Copiar</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((entry) => {
              const link = buildAccessLink(entry);
              return (
                <TableRow key={entry.assignmentId}>
                  <TableCell className="font-medium">
                    {entry.participantName}
                    <span className="block text-xs font-normal text-muted-foreground">
                      Vence {formatDateTime(entry.expiresAt)}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{entry.participantCode}</TableCell>
                  <TableCell>
                    <code className="break-all font-mono text-xs">{link}</code>
                  </TableCell>
                  <TableCell>
                    <AccessQr value={link} label={`QR del enlace de ${entry.participantName}`} />
                  </TableCell>
                  <TableCell className="no-print text-right">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        void copyText(link, "Enlace copiado.").then((copied) => {
                          if (copied) onExported([entry.assignmentId]);
                        })
                      }
                      aria-label={`Copiar enlace de ${entry.participantName}`}
                    >
                      <Copy className="size-4" aria-hidden="true" />
                      Copiar
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        <DialogFooter className="no-print items-center sm:justify-between">
          <p className="text-sm text-muted-foreground tabular-nums" aria-live="polite">
            {pending === 0 ? "Todos los enlaces fueron exportados." : `${pending} enlace(s) sin exportar`}
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={() => void copyAll()}>
              <Copy className="size-4" aria-hidden="true" />
              Copiar todo
            </Button>
            <Button type="button" variant="outline" onClick={download}>
              <Download className="size-4" aria-hidden="true" />
              Descargar CSV
            </Button>
            <Button type="button" variant="outline" onClick={print}>
              <Printer className="size-4" aria-hidden="true" />
              Imprimir
            </Button>
            <Button type="button" onClick={requestClose}>
              Cerrar
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {printDialog}
    <ConfirmDialog
      open={confirmOpen}
      onOpenChange={setConfirmOpen}
      tone="danger"
      title="Cerrar sin exportar los enlaces"
      description={UNEXPORTED_LINKS_DESCRIPTION}
      confirmLabel="Cerrar sin exportar"
      cancelLabel="Volver a la hoja"
      onConfirm={onClose}
    />
    </>
  );
}
