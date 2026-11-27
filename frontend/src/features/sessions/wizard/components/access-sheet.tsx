import { Copy, Download, Printer } from "lucide-react";
import { toast } from "sonner";
import { buildAccessCode } from "../../../../api/endpoints/sessions";
import type { Session } from "../../../../api/schemas/sessions";
import { Button } from "../../../../app/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../../app/components/ui/table";
import { AccessQr, ACCESS_QR_PRINT_CSS } from "../../access/AccessQr";
import { ExpiryNotice } from "../../access/ExpiryNotice";
import { accessSheetCsv, accessSheetText, copyToClipboard, downloadTextFile } from "../../access/export";
import { countUnexported } from "../../access/exportTracker";
import { usePrintExport } from "../../access/usePrintExport";
import { formatDateTime } from "../format";
import { buildAccessUrl } from "../schemas";
import type { AccessEntry } from "../types";
import { InlineAlert } from "./form-bits";

/** Solo la hoja es visible al imprimir. */
const PRINT_STYLES = `
@media print {
  body * { visibility: hidden !important; }
  #access-sheet, #access-sheet * { visibility: visible !important; }
  #access-sheet { position: absolute; left: 0; top: 0; width: 100%; border: 0; box-shadow: none; }
  #access-sheet .access-link { word-break: break-all; }
}
${ACCESS_QR_PRINT_CSS}`;

export const accessUrl = (entry: AccessEntry): string =>
  buildAccessUrl(buildAccessCode(entry.assignmentId, entry.rawToken));

interface AccessSheetProps {
  session: Session;
  entries: readonly AccessEntry[];
  /** Ids de asignación ya copiados, impresos o descargados (control POR asignación). */
  exportedIds: ReadonlySet<number>;
  onExported: (assignmentIds: number[]) => void;
}

export function AccessSheet({ session, entries, exportedIds, onExported }: AccessSheetProps) {
  const pending = countUnexported(entries, exportedIds);
  const allIds = () => entries.map((e) => e.assignmentId);

  const copyRow = async (entry: AccessEntry) => {
    if (await copyToClipboard(accessUrl(entry))) {
      onExported([entry.assignmentId]);
      toast.success(`Enlace de ${entry.participantName} copiado.`);
    } else {
      toast.error("No se pudo copiar. Seleccione el enlace y cópielo manualmente.");
    }
  };

  const copyAll = async () => {
    if (await copyToClipboard(accessSheetText(entries))) {
      onExported(allIds());
      toast.success("Hoja de accesos copiada.");
    } else {
      toast.error("No se pudo copiar. Use Imprimir o copie los enlaces uno por uno.");
    }
  };

  // No se marca como exportado antes de imprimir: se pregunta tras `afterprint`.
  const { print, dialog: printDialog } = usePrintExport(allIds, onExported);

  const download = () => {
    downloadTextFile(`accesos-${session.code.replace(/[^\w.-]+/g, "_")}.csv`, accessSheetCsv(entries));
    onExported(allIds());
  };

  return (
    <section
      id="access-sheet"
      aria-labelledby="access-sheet-title"
      className="space-y-4 rounded-lg border border-border bg-card p-4"
    >
      <style>{PRINT_STYLES}</style>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="access-sheet-title" className="text-base font-semibold">
            Hoja de accesos
          </h2>
          <p className="hidden text-sm print:block">
            {session.name} · <span className="font-mono">{session.code}</span> · {formatDateTime(session.scheduledStart)}
          </p>
        </div>
        <div className="flex gap-2 print:hidden">
          <Button type="button" variant="outline" size="sm" onClick={() => void copyAll()}>
            <Copy aria-hidden="true" className="size-4" />
            Copiar todo
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={download}>
            <Download aria-hidden="true" className="size-4" />
            Descargar CSV
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={print}>
            <Printer aria-hidden="true" className="size-4" />
            Imprimir
          </Button>
        </div>
      </div>

      <InlineAlert tone="warning" title="Estos códigos no se volverán a mostrar">
        Cópielos, descárguelos o imprímalos ahora. El token no se puede volver a mostrar ni regenerar todavía.{" "}
        <span aria-live="polite">
          {pending === 0 ? "Todos los enlaces fueron exportados." : `${pending} enlace(s) sin exportar.`}
        </span>
      </InlineAlert>
      <ExpiryNotice entries={entries} scheduledStart={session.scheduledStart} />
      {printDialog}

      <Table aria-label="Hoja de accesos">
        <TableHeader>
          <TableRow>
            <TableHead>Nombre</TableHead>
            <TableHead>Código</TableHead>
            <TableHead>Enlace de acceso</TableHead>
            <TableHead>QR</TableHead>
            <TableHead className="w-24 print:hidden">
              <span className="sr-only">Acciones</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((entry) => (
            <TableRow key={entry.assignmentId}>
              <TableCell className="font-medium">
                {entry.participantName}
                <span className="block text-xs font-normal text-muted-foreground">
                  Vence {formatDateTime(entry.expiresAt)}
                </span>
              </TableCell>
              <TableCell className="font-mono text-xs">{entry.participantCode}</TableCell>
              <TableCell className="access-link break-all font-mono text-xs">{accessUrl(entry)}</TableCell>
              <TableCell>
                <AccessQr value={accessUrl(entry)} label={`QR del enlace de ${entry.participantName}`} />
              </TableCell>
              <TableCell className="print:hidden">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void copyRow(entry)}
                  aria-label={`Copiar enlace de ${entry.participantName}`}
                >
                  <Copy aria-hidden="true" className="size-4" />
                  Copiar
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}
