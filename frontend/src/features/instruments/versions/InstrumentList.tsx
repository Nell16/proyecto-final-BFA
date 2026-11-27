import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ClipboardCheck, Plus } from "lucide-react";

import { Badge } from "../../../app/components/ui/badge";
import { Button } from "../../../app/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../app/components/ui/table";
import { PERMISSIONS } from "../../../store/permissions";
import { useStaffAuth } from "../../../store/staffAuth";
import { useInstrumentPermissions } from "../permissions";
import { testsListQuery } from "../queries";
import { NewTestWizardDialog } from "./NewTestWizardDialog";

export function InstrumentList() {
  const query = useQuery(testsListQuery());
  const { canEdit } = useInstrumentPermissions();
  const canReview = useStaffAuth((state) =>
    state.user?.permissions.includes(PERMISSIONS.CALIFICACION_EJECUTAR),
  );
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <section className="space-y-4" aria-label="Instrumentos">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Instrumentos</h1>
          <p className="text-xs text-muted-foreground">
            Administra tus tests psicométricos, versiones, subtests, ítems y baremos.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canReview && (
            <Button variant="outline" size="sm" asChild>
              <Link to="/app/revision-manual">
                <ClipboardCheck className="size-4" aria-hidden="true" />
                <span>Revisión manual</span>
              </Link>
            </Button>
          )}
          {canEdit && (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" aria-hidden="true" />
              <span>Nuevo test</span>
            </Button>
          )}
        </div>
      </div>

      {query.isPending ? (
        <p role="status" className="text-sm text-muted-foreground">
          Cargando instrumentos…
        </p>
      ) : query.isError ? (
        <div role="alert" className="space-y-2 rounded-lg border border-status-danger-border bg-status-danger-bg p-4 text-sm text-status-danger-fg">
          <p>{query.error.message}</p>
          <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
            Reintentar
          </Button>
        </div>
      ) : query.data.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-card p-8 text-center">
          <p role="status" className="text-sm text-muted-foreground">
            Todavía no hay tests registrados.
          </p>
          {canEdit && (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" aria-hidden="true" />
              <span>Crear primer test</span>
            </Button>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card shadow-[var(--shadow-xs)]">
          <Table>
            <TableHeader className="border-b border-border bg-muted/70 text-xs font-semibold text-muted-foreground">
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-36 px-4 py-2.5">Código</TableHead>
                <TableHead className="px-4 py-2.5">Test</TableHead>
                <TableHead className="w-32 px-4 py-2.5">Estado</TableHead>
                <TableHead className="w-40 px-4 py-2.5 text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.map((test) => (
                <TableRow key={test.id} className="h-11">
                  <TableCell className="px-4 py-2.5 font-mono text-xs font-semibold text-foreground">
                    {test.code}
                  </TableCell>
                  <TableCell className="px-4 py-2.5">
                    <div className="font-medium text-foreground">{test.name}</div>
                    {test.description && (
                      <p className="max-w-xl truncate text-xs text-muted-foreground">
                        {test.description}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="px-4 py-2.5">
                    <Badge variant="outline" className="font-mono text-xs">
                      {test.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="px-4 py-2.5 text-right">
                    <Button variant="outline" size="sm" asChild>
                      <Link
                        to="/app/instrumentos/$versionId"
                        params={{ versionId: String(test.id) }}
                        aria-label={`Ver versiones de ${test.name}`}
                      >
                        Ver versiones
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {createOpen && canEdit && (
        <NewTestWizardDialog
          existingTests={query.data ?? []}
          onClose={() => setCreateOpen(false)}
        />
      )}
    </section>
  );
}
