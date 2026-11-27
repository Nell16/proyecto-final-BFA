import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getSubtestCloneTemplate, listSubtests } from "../../../api/endpoints/instruments";
import { Button } from "../../../app/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "../../../app/components/ui/dialog";
import { captureAccountScope } from "../../../store/accountScope";
import type { SubtestCloneTemplate } from "../../../api/schemas/instruments";
import { instrumentKeys, testsListQuery, versionsListQuery } from "../queries";

export function ReuseSubtestDialog({ onImport, onClose }: {
  onImport: (template: SubtestCloneTemplate) => void;
  onClose: () => void;
}) {
  const [testId, setTestId] = useState(0);
  const [versionId, setVersionId] = useState(0);
  const [subtestId, setSubtestId] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const tests = useQuery(testsListQuery());
  const versions = useQuery({ ...versionsListQuery(testId), enabled: testId > 0 });
  const subtests = useQuery({
    queryKey: [...instrumentKeys.all, "subtests", versionId],
    queryFn: () => listSubtests(versionId),
    enabled: versionId > 0,
  });

  async function importSubtest() {
    const scope = captureAccountScope();
    setPending(true);
    setError(undefined);
    try {
      const template = await getSubtestCloneTemplate(subtestId);
      if (scope.isCurrent()) onImport(template);
    } catch (cause) {
      if (scope.isCurrent()) setError(cause instanceof Error ? cause.message : "No se pudo importar el subtest.");
    } finally {
      if (scope.isCurrent()) setPending(false);
    }
  }

  const fields = [
    { label: "Test de origen", value: testId, data: tests.data, failed: tests.isError, retry: tests.refetch,
      change: (id: number) => { setTestId(id); setVersionId(0); setSubtestId(0); } },
    { label: "Versión de origen", value: versionId, data: versions.data?.map((v) => ({ id: v.id, name: v.number })),
      failed: versions.isError, retry: versions.refetch, change: (id: number) => { setVersionId(id); setSubtestId(0); } },
    { label: "Subtest", value: subtestId, data: subtests.data, failed: subtests.isError, retry: subtests.refetch,
      change: setSubtestId },
  ];

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !pending) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reutilizar subtest</DialogTitle>
          <DialogDescription>La copia se agregará al borrador de esta versión.</DialogDescription>
        </DialogHeader>
        {fields.map(({ label, value, data, failed, retry, change }) => (
          <div key={label}>
            <label className="grid gap-1 text-sm">
              {label}
              <select
                className="rounded-md border bg-background p-2"
                value={value}
                disabled={!data || pending}
                onChange={(event) => { setError(undefined); change(Number(event.target.value)); }}
              >
                <option value={0}>{data?.length === 0 ? "Sin resultados" : "Seleccionar"}</option>
                {data?.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
              </select>
            </label>
            {failed && <Button variant="link" onClick={() => void retry()}>Reintentar carga</Button>}
          </div>
        ))}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={onClose}>Cancelar</Button>
          <Button disabled={!subtestId || pending} onClick={() => void importSubtest()}>
            {pending ? "Importando…" : "Importar al borrador"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
