import { useMemo, useState } from "react";
import { AlertCircle, Trash2 } from "lucide-react";

import { Button } from "../../../app/components/ui/button";
import { Input } from "../../../app/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../app/components/ui/table";
import { cn } from "../../../app/components/ui/utils";
import {
  createDefaultDraftId,
  isActiveDraftNode,
  type DocumentAction,
  type DocumentBaremo,
  type DocumentBaremoRange,
  type DocumentProblem,
} from "../document";

export interface RangeTableProps {
  baremo: DocumentBaremo;
  readOnly: boolean;
  canConfigureBaremos: boolean;
  problems?: readonly DocumentProblem[];
  onDispatch: (action: DocumentAction) => void;
}

interface RangeRowValidation {
  inverted: boolean;
  emptyCategory: boolean;
  invalidPercentile: boolean;
  overlaps: boolean;
  isInvalid: boolean;
  reasons: string[];
}

const PERSISTED_RANGE_LOCK_MESSAGE =
  "Los rangos ya guardados no pueden eliminarse; edita sus valores o crea una nueva versión.";

function rangesOverlap(a: DocumentBaremoRange, b: DocumentBaremoRange): boolean {
  return a.minScore <= b.maxScore && b.minScore <= a.maxScore;
}

function evaluateRanges(
  activeRanges: readonly DocumentBaremoRange[],
): Map<string, RangeRowValidation> {
  const map = new Map<string, RangeRowValidation>();

  for (const range of activeRanges) {
    const inverted = range.minScore > range.maxScore;
    const emptyCategory = range.category.trim() === "";
    const invalidPercentile =
      range.percentile !== null &&
      (!Number.isFinite(range.percentile) || range.percentile < 0 || range.percentile > 100);

    const overlaps =
      !inverted &&
      activeRanges.some(
        (other) =>
          other.draftId !== range.draftId &&
          other.minScore <= other.maxScore &&
          rangesOverlap(range, other),
      );

    const reasons: string[] = [];
    if (inverted) reasons.push("Rango invertido (mínimo > máximo)");
    if (overlaps) reasons.push("Se solapa con otro rango activo");
    if (invalidPercentile) reasons.push("Percentil fuera de [0, 100]");
    if (emptyCategory) reasons.push("Categoría obligatoria");

    map.set(range.draftId, {
      inverted,
      emptyCategory,
      invalidPercentile,
      overlaps,
      isInvalid: inverted || emptyCategory || invalidPercentile || overlaps,
      reasons,
    });
  }

  return map;
}

interface NumericCellInputProps {
  value: number | null;
  nullable?: boolean;
  disabled: boolean;
  invalid?: boolean;
  ariaLabel: string;
  placeholder?: string;
  className?: string;
  onCommit: (nextValue: number | null) => void;
}

function NumericCellInput({
  value,
  nullable = false,
  disabled,
  invalid = false,
  ariaLabel,
  placeholder,
  className,
  onCommit,
}: NumericCellInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const displayValue = draft !== null ? draft : value === null ? "" : String(value);

  const handleChange = (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed === "") {
      if (nullable) {
        setDraft(null);
        onCommit(null);
      } else {
        setDraft(raw);
      }
      return;
    }

    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      setDraft(null);
      onCommit(parsed);
    } else {
      setDraft(raw);
    }
  };

  return (
    <Input
      type="number"
      value={displayValue}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-invalid={invalid || undefined}
      placeholder={placeholder}
      onChange={(event) => handleChange(event.target.value)}
      onBlur={() => setDraft(null)}
      className={cn(
        "h-7 px-2 text-xs tabular-nums",
        invalid && "border-status-danger-solid focus-visible:ring-status-danger-bg",
        className,
      )}
    />
  );
}

export function RangeTable({
  baremo,
  readOnly,
  canConfigureBaremos,
  problems = [],
  onDispatch,
}: RangeTableProps) {
  const editable = !readOnly && canConfigureBaremos;

  const activeRanges = useMemo(
    () => baremo.ranges.filter(isActiveDraftNode).sort((a, b) => a.order - b.order),
    [baremo.ranges],
  );

  const validationByDraftId = useMemo(() => evaluateRanges(activeRanges), [activeRanges]);
  const hasPersistedRanges = useMemo(
    () => activeRanges.some((range) => range.id !== null),
    [activeRanges],
  );
  const rangeProblemCount = useMemo(
    () => problems.filter((problem) => problem.field === "ranges").length,
    [problems],
  );

  const handleAddRange = () => {
    if (!editable) return;
    const minScore =
      activeRanges.length > 0
        ? Math.max(...activeRanges.map((range) => range.maxScore)) + 1
        : 0;
    const maxScore = minScore + 10;

    onDispatch({
      type: "ADD_BAREMO_RANGE",
      baremoDraftId: baremo.draftId,
      input: {
        draftId: createDefaultDraftId("rng"),
        minScore,
        maxScore,
      },
    });
  };

  const updateRange = (
    rangeDraftId: string,
    patch: Extract<DocumentAction, { type: "UPDATE_BAREMO_RANGE" }>["patch"],
  ) => {
    if (!editable) return;
    onDispatch({
      type: "UPDATE_BAREMO_RANGE",
      baremoDraftId: baremo.draftId,
      rangeDraftId,
      patch,
    });
  };

  return (
    <div className="space-y-3" data-slot="baremo-range-table">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-foreground">Rangos de baremación</h3>
          <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground tabular-nums">
            {activeRanges.length}
          </span>
          {rangeProblemCount > 0 && (
            <span className="text-xs font-medium text-status-danger-fg tabular-nums">
              {rangeProblemCount}{" "}
              {rangeProblemCount === 1 ? "incidencia en rangos" : "incidencias en rangos"}
            </span>
          )}
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!editable}
          onClick={handleAddRange}
        >
          + Añadir rango
        </Button>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-[var(--shadow-xs)]">
        <Table>
          <TableHeader className="bg-muted/70 text-xs font-semibold text-muted-foreground border-b border-border">
            <TableRow className="h-9 hover:bg-transparent">
              <TableHead className="px-3 py-1.5 text-xs font-semibold text-muted-foreground w-20">
                Orden
              </TableHead>
              <TableHead className="px-3 py-1.5 text-xs font-semibold text-muted-foreground w-24">
                Mín.
              </TableHead>
              <TableHead className="px-3 py-1.5 text-xs font-semibold text-muted-foreground w-24">
                Máx.
              </TableHead>
              <TableHead className="px-3 py-1.5 text-xs font-semibold text-muted-foreground w-24">
                Percentil
              </TableHead>
              <TableHead className="px-3 py-1.5 text-xs font-semibold text-muted-foreground min-w-36">
                Categoría <span className="text-status-danger-fg">*</span>
              </TableHead>
              <TableHead className="px-3 py-1.5 text-xs font-semibold text-muted-foreground min-w-44">
                Interpretación
              </TableHead>
              <TableHead className="px-3 py-1.5 text-xs font-semibold text-muted-foreground min-w-44">
                Recomendación
              </TableHead>
              <TableHead className="px-3 py-1.5 text-right text-xs font-semibold text-muted-foreground w-24">
                Acciones
              </TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {activeRanges.length === 0 ? (
              <TableRow className="h-9 hover:bg-transparent">
                <TableCell
                  colSpan={8}
                  className="px-3 py-6 text-center text-sm text-muted-foreground whitespace-normal"
                >
                  Este baremo no tiene rangos definidos.
                  {editable ? " Usa «+ Añadir rango» para agregar el primero." : ""}
                </TableCell>
              </TableRow>
            ) : (
              activeRanges.map((range, index) => {
                const rowValidation = validationByDraftId.get(range.draftId);
                const isInvalid = rowValidation?.isInvalid ?? false;
                const canDeleteRange = editable && range.id === null;
                const rowNumber = index + 1;
                const deleteTitle =
                  range.id !== null
                    ? PERSISTED_RANGE_LOCK_MESSAGE
                    : !editable
                      ? "Edición bloqueada en modo solo lectura"
                      : "Eliminar rango local";

                return (
                  <TableRow
                    key={range.draftId}
                    data-invalid={isInvalid ? "true" : undefined}
                    className={cn(
                      "h-9",
                      isInvalid && "bg-status-danger-bg/40 hover:bg-status-danger-bg/50",
                    )}
                  >
                    <TableCell className="px-3 py-1.5 tabular-nums">
                      <NumericCellInput
                        value={range.order}
                        disabled={!editable}
                        ariaLabel={`Orden rango ${rowNumber}`}
                        className="w-16 font-mono"
                        onCommit={(nextValue) => {
                          if (nextValue !== null) {
                            updateRange(range.draftId, { order: nextValue });
                          }
                        }}
                      />
                    </TableCell>

                    <TableCell className="px-3 py-1.5 tabular-nums">
                      <NumericCellInput
                        value={range.minScore}
                        disabled={!editable}
                        invalid={
                          Boolean(rowValidation?.inverted || rowValidation?.overlaps)
                        }
                        ariaLabel={`Puntaje mínimo rango ${rowNumber}`}
                        className="w-20 text-right"
                        onCommit={(nextValue) => {
                          if (nextValue !== null) {
                            updateRange(range.draftId, { minScore: nextValue });
                          }
                        }}
                      />
                    </TableCell>

                    <TableCell className="px-3 py-1.5 tabular-nums">
                      <NumericCellInput
                        value={range.maxScore}
                        disabled={!editable}
                        invalid={
                          Boolean(rowValidation?.inverted || rowValidation?.overlaps)
                        }
                        ariaLabel={`Puntaje máximo rango ${rowNumber}`}
                        className="w-20 text-right"
                        onCommit={(nextValue) => {
                          if (nextValue !== null) {
                            updateRange(range.draftId, { maxScore: nextValue });
                          }
                        }}
                      />
                    </TableCell>

                    <TableCell className="px-3 py-1.5 tabular-nums">
                      <NumericCellInput
                        value={range.percentile}
                        nullable
                        disabled={!editable}
                        invalid={Boolean(rowValidation?.invalidPercentile)}
                        ariaLabel={`Percentil rango ${rowNumber}`}
                        placeholder="0–100"
                        className="w-20 text-right"
                        onCommit={(nextValue) => {
                          updateRange(range.draftId, { percentile: nextValue });
                        }}
                      />
                    </TableCell>

                    <TableCell className="px-3 py-1.5">
                      <Input
                        value={range.category}
                        disabled={!editable}
                        aria-label={`Categoría rango ${rowNumber}`}
                        aria-invalid={rowValidation?.emptyCategory || undefined}
                        placeholder="Categoría"
                        onChange={(event) =>
                          updateRange(range.draftId, { category: event.target.value })
                        }
                        className={cn(
                          "h-7 text-xs",
                          rowValidation?.emptyCategory &&
                            "border-status-danger-solid focus-visible:ring-status-danger-bg",
                        )}
                      />
                    </TableCell>

                    <TableCell className="px-3 py-1.5">
                      <Input
                        value={range.interpretation}
                        disabled={!editable}
                        aria-label={`Interpretación rango ${rowNumber}`}
                        placeholder="Interpretación"
                        onChange={(event) =>
                          updateRange(range.draftId, { interpretation: event.target.value })
                        }
                        className="h-7 text-xs"
                      />
                    </TableCell>

                    <TableCell className="px-3 py-1.5">
                      <Input
                        value={range.recommendation}
                        disabled={!editable}
                        aria-label={`Recomendación rango ${rowNumber}`}
                        placeholder="Recomendación"
                        onChange={(event) =>
                          updateRange(range.draftId, { recommendation: event.target.value })
                        }
                        className="h-7 text-xs"
                      />
                    </TableCell>

                    <TableCell className="px-3 py-1.5 text-right tabular-nums">
                      <div className="inline-flex items-center justify-end gap-1.5">
                        {isInvalid && rowValidation && (
                          <span
                            role="img"
                            aria-label={rowValidation.reasons.join(". ")}
                            title={rowValidation.reasons.join(" · ")}
                            className="inline-flex items-center text-status-danger-fg"
                          >
                            <AlertCircle className="size-4" aria-hidden="true" />
                          </span>
                        )}
                        <span title={deleteTitle} className="inline-flex">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={!canDeleteRange}
                            aria-label={`Eliminar rango ${range.category.trim() || rowNumber}`}
                            title={deleteTitle}
                            onClick={() => {
                              if (!canDeleteRange) return;
                              onDispatch({
                                type: "DELETE_BAREMO_RANGE",
                                baremoDraftId: baremo.draftId,
                                rangeDraftId: range.draftId,
                              });
                            }}
                            className="size-7 text-muted-foreground hover:text-status-danger-fg"
                          >
                            <Trash2 className="size-3.5" aria-hidden="true" />
                          </Button>
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {hasPersistedRanges && (
        <p className="text-xs text-muted-foreground">{PERSISTED_RANGE_LOCK_MESSAGE}</p>
      )}
    </div>
  );
}
