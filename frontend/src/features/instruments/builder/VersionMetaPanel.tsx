import * as React from "react";
import { AlertCircle, AlertTriangle, Info, Lock } from "lucide-react";

import type { ScoringStrategy } from "../../../api/schemas/instruments";
import { Alert, AlertDescription, AlertTitle } from "../../../app/components/ui/alert";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../../app/components/ui/card";
import { Input } from "../../../app/components/ui/input";
import { Label } from "../../../app/components/ui/label";
import { StatusBadge } from "../../../app/components/ui/status-badge";
import { Switch } from "../../../app/components/ui/switch";
import { Textarea } from "../../../app/components/ui/textarea";
import { cn } from "../../../app/components/ui/utils";
import {
  type DocumentAction,
  type DocumentProblem,
  nodeKeyOf,
  type ValidationReport,
  type VersionDocument,
} from "../document";

export interface VersionMetaPanelProps {
  document: VersionDocument;
  validation: ValidationReport;
  readOnly: boolean;
  canEdit: boolean;
  canConfigureScoring: boolean;
  strategies: readonly ScoringStrategy[];
  strategiesLoading?: boolean;
  strategiesError?: string | null;
  onDispatch: (action: DocumentAction) => void;
}

function FieldMessages({ problems }: { problems: readonly DocumentProblem[] }) {
  if (problems.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      {problems.map((problem) =>
        problem.severity === "error" ? (
          <p
            key={problem.id}
            role="alert"
            className="flex items-center gap-1.5 text-xs text-status-danger-fg"
          >
            <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
            <span>{problem.message}</span>
          </p>
        ) : (
          <p
            key={problem.id}
            className="flex items-center gap-1.5 text-xs text-status-warning-fg"
          >
            <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
            <span>{problem.message}</span>
          </p>
        ),
      )}
    </div>
  );
}

const KNOWN_FIELDS = new Set(["number", "timeLimitSeconds", "instructions", "strategyId"]);

export function VersionMetaPanel({
  document,
  validation,
  readOnly,
  canEdit,
  canConfigureScoring,
  strategies,
  strategiesLoading = false,
  strategiesError = null,
  onDispatch,
}: VersionMetaPanelProps) {
  const isEditable = canEdit && !readOnly;
  const { version } = document;

  const numberId = React.useId();
  const timeLimitId = React.useId();
  const instructionsId = React.useId();
  const strategySelectId = React.useId();
  const randomizeSubtestsId = React.useId();
  const randomizeItemsId = React.useId();

  const versionProblems = React.useMemo(
    () => validation.byNodeKey[nodeKeyOf({ kind: "version" })] ?? [],
    [validation.byNodeKey],
  );

  const problemsByField = React.useMemo(() => {
    const grouped: Record<string, DocumentProblem[]> = {
      number: [],
      timeLimitSeconds: [],
      instructions: [],
      strategyId: [],
      other: [],
    };
    for (const problem of versionProblems) {
      if (problem.field && KNOWN_FIELDS.has(problem.field)) {
        grouped[problem.field]?.push(problem);
      } else {
        grouped.other.push(problem);
      }
    }
    return grouped;
  }, [versionProblems]);

  const hasError = (field: string): boolean =>
    (problemsByField[field] ?? []).some((problem) => problem.severity === "error");

  const currentStrategy = React.useMemo(
    () => strategies.find((s) => s.id === version.strategyId) ?? null,
    [strategies, version.strategyId],
  );

  const readOnlyStrategyLabel = React.useMemo(() => {
    if (version.strategyId === null) return "Sin estrategia asignada";
    if (currentStrategy) return `${currentStrategy.name} (${currentStrategy.code})`;
    return `Estrategia #${version.strategyId}`;
  }, [currentStrategy, version.strategyId]);

  const badgeStatus = version.status === "DESCONOCIDO" ? "BORRADOR" : version.status;

  return (
    <div className="flex w-full flex-col gap-3">
      <Card className="border-border bg-card shadow-[var(--shadow-xs)]">
        <CardHeader className="flex flex-row items-center justify-between gap-3 border-b border-border px-5 py-3">
          <div className="flex min-w-0 items-baseline gap-2">
            <CardTitle className="truncate text-sm font-semibold text-foreground">
              {version.testName}
            </CardTitle>
            <span className="shrink-0 font-mono text-xs text-muted-foreground">
              {version.testCode}
            </span>
          </div>
          <StatusBadge domain="version" status={badgeStatus} />
        </CardHeader>

        <CardContent className="flex flex-col gap-4 p-5">
          {(readOnly || !canEdit) && (
            <Alert className="border-status-info-border bg-status-info-bg text-status-info-fg">
              <Info className="size-4" aria-hidden="true" />
              <AlertTitle className="text-sm font-medium">Modo solo lectura</AlertTitle>
              <AlertDescription className="text-xs text-status-info-fg">
                {readOnly
                  ? "Solo las versiones en estado Borrador pueden editarse."
                  : "No tienes permisos de edición sobre esta versión."}
              </AlertDescription>
            </Alert>
          )}

          {problemsByField.other.length > 0 && (
            <div className="rounded-md border border-status-danger-border bg-status-danger-bg/60 p-2.5">
              <FieldMessages problems={problemsByField.other} />
            </div>
          )}

          {/* Fila compacta: Número de versión + Tiempo límite + Estrategia */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
            <div className="flex flex-col gap-1 md:col-span-3">
              <Label htmlFor={numberId} className="text-xs font-medium text-muted-foreground">
                <span>Número de versión</span>
                <span className="text-status-danger-fg" aria-hidden="true">
                  *
                </span>
              </Label>
              <Input
                id={numberId}
                type="text"
                value={version.number}
                disabled={!isEditable}
                aria-invalid={hasError("number")}
                placeholder="Ej. 1.0"
                className="h-8 font-mono text-sm"
                onChange={(event) =>
                  onDispatch({
                    type: "UPDATE_VERSION_META",
                    patch: { number: event.target.value },
                  })
                }
              />
              <FieldMessages problems={problemsByField.number} />
            </div>

            <div className="flex flex-col gap-1 md:col-span-4">
              <Label htmlFor={timeLimitId} className="text-xs font-medium text-muted-foreground">
                Tiempo límite global (segundos)
              </Label>
              <Input
                id={timeLimitId}
                type="number"
                value={version.timeLimitSeconds === null ? "" : String(version.timeLimitSeconds)}
                disabled={!isEditable}
                aria-invalid={hasError("timeLimitSeconds")}
                placeholder="Sin límite global"
                className="h-8 text-sm tabular-nums"
                onChange={(event) => {
                  const raw = event.target.value.trim();
                  if (raw === "") {
                    onDispatch({
                      type: "UPDATE_VERSION_META",
                      patch: { timeLimitSeconds: null },
                    });
                    return;
                  }
                  const parsed = Number.parseInt(raw, 10);
                  onDispatch({
                    type: "UPDATE_VERSION_META",
                    patch: { timeLimitSeconds: Number.isFinite(parsed) ? parsed : null },
                  });
                }}
              />
              <FieldMessages problems={problemsByField.timeLimitSeconds} />
            </div>

            {/* Estrategia de calificación */}
            <div className="flex flex-col gap-1 md:col-span-5">
              <Label htmlFor={strategySelectId} className="text-xs font-medium text-muted-foreground">
                <span>Estrategia de calificación</span>
                <span className="text-status-danger-fg" aria-hidden="true">
                  *
                </span>
              </Label>

              {!canConfigureScoring ? (
                <div className="flex flex-col gap-1">
                  <div
                    aria-readonly="true"
                    data-testid="version-strategy-readonly"
                    className="flex h-8 items-center justify-between rounded-md border border-border bg-muted px-2.5 text-xs text-foreground"
                  >
                    <span className="truncate">{readOnlyStrategyLabel}</span>
                    <Lock className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                  </div>
                  <p className="text-xs text-status-warning-fg">
                    Requiere <span className="font-mono">CALIFICACION_CONFIGURAR</span> para modificarla.
                  </p>
                </div>
              ) : (
                <select
                  id={strategySelectId}
                  value={version.strategyId === null ? "" : String(version.strategyId)}
                  disabled={!isEditable || strategiesLoading}
                  aria-invalid={hasError("strategyId")}
                  onChange={(event) => {
                    const raw = event.target.value;
                    onDispatch({
                      type: "UPDATE_VERSION_META",
                      patch: { strategyId: raw === "" ? null : Number(raw) },
                    });
                  }}
                  className={cn(
                    "border-input bg-input-background text-foreground focus-visible:border-ring focus-visible:ring-ring/50 flex h-8 w-full rounded-md border px-2.5 py-1 text-xs outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
                    "aria-invalid:border-destructive aria-invalid:ring-destructive/20",
                  )}
                >
                  <option value="">
                    {strategiesLoading
                      ? "Cargando estrategias..."
                      : "Seleccionar estrategia de calificación..."}
                  </option>
                  {version.strategyId !== null && !currentStrategy && (
                    <option value={String(version.strategyId)}>
                      Estrategia #{version.strategyId}
                    </option>
                  )}
                  {strategies.map((strategy) => (
                    <option key={strategy.id} value={String(strategy.id)}>
                      {strategy.name} ({strategy.code})
                    </option>
                  ))}
                </select>
              )}

              <FieldMessages problems={problemsByField.strategyId} />
            </div>
          </div>

          {canConfigureScoring && strategiesError && (
            <Alert className="border-status-danger-border bg-status-danger-bg text-status-danger-fg">
              <AlertCircle className="size-4" aria-hidden="true" />
              <AlertTitle className="text-sm font-medium">
                Error al cargar estrategias
              </AlertTitle>
              <AlertDescription className="text-xs text-status-danger-fg">
                {strategiesError}
              </AlertDescription>
            </Alert>
          )}

          <div className="flex flex-col gap-1">
            <Label htmlFor={instructionsId} className="text-xs font-medium text-muted-foreground">
              Instrucciones generales
            </Label>
            <Textarea
              id={instructionsId}
              rows={3}
              value={version.instructions}
              disabled={!isEditable}
              aria-invalid={hasError("instructions")}
              placeholder="Indicaciones previas mostradas al participante antes de iniciar..."
              onChange={(event) =>
                onDispatch({
                  type: "UPDATE_VERSION_META",
                  patch: { instructions: event.target.value },
                })
              }
            />
            <FieldMessages problems={problemsByField.instructions} />
          </div>

          {/* Toggles minimalistas en línea */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-border pt-3">
            <div className="flex items-center gap-2">
              <Switch
                id={randomizeSubtestsId}
                checked={version.randomizeSubtests}
                disabled={!isEditable}
                onCheckedChange={(checked) =>
                  onDispatch({
                    type: "UPDATE_VERSION_META",
                    patch: { randomizeSubtests: checked },
                  })
                }
              />
              <Label
                htmlFor={randomizeSubtestsId}
                className="cursor-pointer text-xs font-medium text-foreground"
              >
                Aleatorizar orden de subtests
              </Label>
            </div>

            <div className="flex items-center gap-2">
              <Switch
                id={randomizeItemsId}
                checked={version.randomizeItems}
                disabled={!isEditable}
                onCheckedChange={(checked) =>
                  onDispatch({
                    type: "UPDATE_VERSION_META",
                    patch: { randomizeItems: checked },
                  })
                }
              />
              <Label
                htmlFor={randomizeItemsId}
                className="cursor-pointer text-xs font-medium text-foreground"
              >
                Permitir aleatorización de ítems
              </Label>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
