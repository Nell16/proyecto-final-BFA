import { Button } from "../../../app/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "../../../app/components/ui/dialog";
import { isActiveDraftNode, type ValidationReport, type VersionDocument } from "../document";

export type VersionTransition = "approve" | "publish";

export function PublishDialog({ action, document, validation, pending, error, onClose, onConfirm }: {
  action: VersionTransition;
  document: VersionDocument;
  validation: ValidationReport;
  pending: boolean;
  error?: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const subtests = document.subtests.filter(isActiveDraftNode);
  const items = subtests.flatMap((subtest) => subtest.items.filter(isActiveDraftNode));
  const keys = items.filter((item) => item.answerKey && isActiveDraftNode(item.answerKey));
  const approving = action === "approve";
  const label = approving ? "Aprobar" : "Publicar";
  const allowed = approving ? validation.canApprove : validation.canPublish;

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !pending) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{label} versión {document.version.number}</DialogTitle>
          <DialogDescription>
            {approving
              ? "La versión quedará en solo lectura y podrá publicarse."
              : "La versión quedará disponible para nuevas sesiones de evaluación."}
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm">{subtests.length} subtests · {items.length} ítems · {keys.length} claves</p>
        {validation.warnings.length > 0 && (
          <ul className="max-h-48 list-disc space-y-1 overflow-y-auto pl-5 text-sm">
            {validation.warnings.map((warning) => <li key={warning.id}>{warning.message}</li>)}
          </ul>
        )}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>Cancelar</Button>
          <Button disabled={pending || !allowed} onClick={onConfirm}>
            {pending ? "Procesando…" : label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
