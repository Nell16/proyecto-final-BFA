import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Copy, Plus } from "lucide-react";

import type { TestVersion } from "../../../api/schemas/instruments";
import { Button } from "../../../app/components/ui/button";
import { BuilderLayout } from "../builder/BuilderLayout";
import { useInstrumentPermissions } from "../permissions";
import { testsListQuery, versionsListQuery } from "../queries";
import { NewVersionDialog } from "./NewVersionDialog";

export function VersionList({
  testId,
  revision,
  initialFocus,
}: {
  testId: number;
  revision?: number;
  initialFocus?: "subtest";
}) {
  const tests = useQuery(testsListQuery());
  const versions = useQuery(versionsListQuery(testId));
  const navigate = useNavigate();
  const { canEdit } = useInstrumentPermissions();
  const [create, setCreate] = useState<{ source?: TestVersion }>();
  const [warnings, setWarnings] = useState<string[]>([]);
  const [initialVersionId, setInitialVersionId] = useState<number>();
  const test = tests.data?.find((entry) => entry.id === testId);
  const list = [...(versions.data ?? [])].sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id,
  );
  const fallbackVersion = list.find((entry) => entry.status === "BORRADOR") ?? list[0];
  if (initialVersionId === undefined && fallbackVersion) setInitialVersionId(fallbackVersion.id);
  const selectedVersionId = revision ?? initialVersionId ?? fallbackVersion?.id;
  const active = list.find((entry) => entry.id === selectedVersionId);
  const params = { versionId: String(testId) };

  return (
    <div className="space-y-3">
      {/* Cabecera minimalista en una sola línea */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            asChild
            title="Volver a instrumentos"
          >
            <Link to="/app/instrumentos" aria-label="Volver a instrumentos">
              <ArrowLeft className="size-4" aria-hidden="true" />
            </Link>
          </Button>
          {test && (
            <div className="flex min-w-0 items-baseline gap-2">
              <h1 className="truncate text-lg font-semibold tracking-tight text-foreground">
                {test.name}
              </h1>
              <span className="shrink-0 font-mono text-xs text-muted-foreground">{test.code}</span>
            </div>
          )}
        </div>

        {test && (
          <div className="flex items-center gap-1.5">
            {list.length > 0 && (
              <select
                aria-label="Versión del test"
                className="border-input bg-input-background text-foreground focus-visible:border-ring focus-visible:ring-ring/50 h-8 rounded-md border px-2.5 text-xs font-medium outline-none focus-visible:ring-[3px]"
                value={active?.id ?? ""}
                onChange={(event) =>
                  void navigate({
                    to: "/app/instrumentos/$versionId",
                    params,
                    search: { revision: Number(event.target.value) },
                  })
                }
              >
                {!active && (
                  <option value="" disabled>
                    Seleccionar versión
                  </option>
                )}
                {list.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.number} · {entry.status}
                  </option>
                ))}
              </select>
            )}
            {canEdit && (
              <>
                <Button
                  variant="outline"
                  size="icon"
                  className="size-8"
                  aria-label="Nueva versión"
                  title="Nueva versión"
                  onClick={() => setCreate({})}
                >
                  <Plus className="size-4" aria-hidden="true" />
                </Button>
                {active && (
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-8"
                    aria-label="Nueva versión desde esta"
                    title="Nueva versión desde esta"
                    onClick={() => setCreate({ source: active })}
                  >
                    <Copy className="size-3.5" aria-hidden="true" />
                  </Button>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {(tests.isError && !tests.data) || (versions.isError && !versions.data) ? (
        <div
          role="alert"
          className="space-y-2 rounded-lg border border-status-danger-border bg-status-danger-bg p-4 text-sm text-status-danger-fg"
        >
          <p>{tests.error?.message ?? versions.error?.message}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void tests.refetch();
              void versions.refetch();
            }}
          >
            Reintentar
          </Button>
        </div>
      ) : tests.isPending || versions.isPending ? (
        <p role="status" className="text-sm text-muted-foreground">
          Cargando versiones…
        </p>
      ) : !test ? (
        <p role="alert" className="text-sm text-destructive">
          No se encontró el test.
        </p>
      ) : (
        <>
          {warnings.length > 0 && (
            <ul
              role="status"
              className="list-disc space-y-1 rounded-md border border-status-warning-border bg-status-warning-bg p-3 pl-7 text-xs text-status-warning-fg"
            >
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}

          {active ? (
            <BuilderLayout
              key={active.id}
              testId={testId}
              versionId={active.id}
              initialFocus={initialFocus}
            />
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-card p-8 text-center">
              <p role="status" className="text-sm text-muted-foreground">
                {list.length
                  ? "La versión seleccionada no pertenece a este test."
                  : "Este test todavía no tiene versiones."}
              </p>
              {canEdit && (
                <Button size="sm" onClick={() => setCreate({})}>
                  <Plus className="size-4" aria-hidden="true" />
                  <span>Crear primera versión</span>
                </Button>
              )}
            </div>
          )}

          {create && (
            <NewVersionDialog
              testId={testId}
              source={create.source}
              versions={list}
              onClose={() => setCreate(undefined)}
              onCreated={(version, notices = []) => {
                setCreate(undefined);
                setWarnings(notices);
                void navigate({
                  to: "/app/instrumentos/$versionId",
                  params,
                  search: { revision: version.id },
                });
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
