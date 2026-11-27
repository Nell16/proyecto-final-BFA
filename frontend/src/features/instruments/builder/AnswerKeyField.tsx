import { useId } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, Info, Trash2 } from "lucide-react";

import { Alert, AlertDescription } from "../../../app/components/ui/alert";
import { Button } from "../../../app/components/ui/button";
import { Input } from "../../../app/components/ui/input";
import { Label } from "../../../app/components/ui/label";
import { Switch } from "../../../app/components/ui/switch";
import { Textarea } from "../../../app/components/ui/textarea";
import { cn } from "../../../app/components/ui/utils";
import {
  isActiveDraftNode,
  SINGLE_KEY_OPTION_RESPONSE_TYPES,
  type DocumentAction,
  type DocumentItem,
  type DocumentProblem,
} from "../document";

export interface AnswerKeyFieldProps {
  subtestDraftId: string;
  subtestDefaultRuleId: number | null;
  item: DocumentItem;
  readOnly: boolean;
  canEdit: boolean;
  canConfigureScoring: boolean;
  problems?: readonly DocumentProblem[];
  embedded?: boolean;
  onDispatch: (action: DocumentAction) => void;
}

/**
 * Editor minimalista de clave de respuesta adaptado al tipo de respuesta del ítem y
 * sujeto al permiso `CALIFICACION_CONFIGURAR` cuando el subtest no tiene regla previa.
 */
export function AnswerKeyField({
  subtestDraftId,
  subtestDefaultRuleId,
  item,
  readOnly,
  canEdit,
  canConfigureScoring,
  problems = [],
  embedded = false,
  onDispatch,
}: AnswerKeyFieldProps) {
  const fieldId = useId();
  const canEditKey = !readOnly && canEdit && (subtestDefaultRuleId !== null || canConfigureScoring);
  const activeKey = item.answerKey && isActiveDraftNode(item.answerKey) ? item.answerKey : null;
  const keyProblems = problems.filter((problem) => problem.field?.startsWith("answerKey"));

  const isPersistedKey = activeKey !== null && activeKey.id !== null;
  const clearKeyDisabled = !canEditKey || activeKey === null || isPersistedKey;

  const activeOptions = item.options.filter(isActiveDraftNode);
  const selectedSingleOption =
    activeKey && !activeKey.requiresManualReview
      ? (activeOptions.find((opt) =>
          activeKey.correctOptionDraftId !== null
            ? opt.draftId === activeKey.correctOptionDraftId
            : activeKey.correctOptionId !== null && opt.id === activeKey.correctOptionId,
        ) ?? null)
      : null;

  const updateAnswerKey = (
    patch: Extract<DocumentAction, { type: "UPDATE_ANSWER_KEY" }>["patch"],
  ) => {
    onDispatch({
      type: "UPDATE_ANSWER_KEY",
      subtestDraftId,
      itemDraftId: item.draftId,
      patch,
    });
  };

  const scoreInputId = `${fieldId}-score`;
  const manualReviewId = `${fieldId}-manual-review`;
  const expectedTextId = `${fieldId}-expected-text`;
  const expectedNumberId = `${fieldId}-expected-number`;
  const numericToleranceId = `${fieldId}-numeric-tolerance`;

  const scoreValue = activeKey ? activeKey.score : item.baseScore;
  const manualReviewChecked = activeKey?.requiresManualReview ?? false;

  const scoreInput = (
    <div className="space-y-1">
      <Label htmlFor={scoreInputId} className="text-xs font-medium text-muted-foreground">
        Puntaje de clave
      </Label>
      <Input
        id={scoreInputId}
        type="number"
        min={0}
        step="any"
        value={scoreValue}
        disabled={!canEditKey}
        className="h-8 text-sm tabular-nums"
        onChange={(event) => {
          const raw = event.target.value.trim();
          if (raw === "") return;
          const parsed = Number(raw);
          if (Number.isFinite(parsed) && parsed >= 0) {
            updateAnswerKey({ score: parsed });
          }
        }}
      />
    </div>
  );

  const manualReviewSwitch = (
    <div className="flex items-center gap-2 pt-4">
      <Switch
        id={manualReviewId}
        checked={manualReviewChecked}
        disabled={!canEditKey}
        onCheckedChange={(checked) => updateAnswerKey({ requiresManualReview: checked })}
      />
      <Label htmlFor={manualReviewId} className="cursor-pointer text-xs font-medium text-foreground">
        Requiere revisión manual
      </Label>
    </div>
  );

  return (
    <section
      aria-labelledby={`${fieldId}-heading`}
      className={cn(
        "space-y-3",
        !embedded && "rounded-lg border border-border bg-card p-4 shadow-[var(--shadow-xs)]",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <h3
          id={`${fieldId}-heading`}
          className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          Clave de respuesta
        </h3>

        {SINGLE_KEY_OPTION_RESPONSE_TYPES.has(item.responseType) && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Quitar clave"
            title="Quitar clave"
            disabled={clearKeyDisabled}
            onClick={() =>
              onDispatch({
                type: "CLEAR_ANSWER_KEY",
                subtestDraftId,
                itemDraftId: item.draftId,
              })
            }
            className="size-7 text-muted-foreground hover:bg-status-danger-bg hover:text-status-danger-fg"
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
          </Button>
        )}
      </div>

      {!readOnly && canEdit && !canEditKey && (
        <Alert className="border-status-info-border bg-status-info-bg text-status-info-fg">
          <Info className="size-4" aria-hidden="true" />
          <AlertDescription className="text-xs text-status-info-fg">
            Este subtest no tiene una regla de calificación asignada. Se requiere el permiso{" "}
            <code className="font-mono font-semibold">CALIFICACION_CONFIGURAR</code> para definir o
            editar claves de respuesta.
          </AlertDescription>
        </Alert>
      )}

      {keyProblems.length > 0 && (
        <div className="space-y-1.5">
          {keyProblems.map((problem) => {
            const isError = problem.severity === "error";
            return (
              <Alert
                key={problem.id}
                className={
                  isError
                    ? "border-status-danger-border bg-status-danger-bg text-status-danger-fg"
                    : "border-status-warning-border bg-status-warning-bg text-status-warning-fg"
                }
              >
                {isError ? (
                  <AlertCircle className="size-4" aria-hidden="true" />
                ) : (
                  <AlertTriangle className="size-4" aria-hidden="true" />
                )}
                <AlertDescription
                  className={cn(
                    "text-xs",
                    isError ? "text-status-danger-fg" : "text-status-warning-fg",
                  )}
                >
                  {problem.message}
                </AlertDescription>
              </Alert>
            );
          })}
        </div>
      )}

      {SINGLE_KEY_OPTION_RESPONSE_TYPES.has(item.responseType) && (
        <div className="space-y-1.5">
          <div className="grid grid-cols-1 items-center gap-3 sm:grid-cols-12">
            <div className="space-y-1 sm:col-span-5">
              <span className="text-xs font-medium text-muted-foreground">Selección activa</span>
              <div
                className={cn(
                  "flex h-8 items-center gap-2 rounded-md border px-2.5 text-xs",
                  selectedSingleOption
                    ? "border-status-success-border bg-status-success-bg/40 text-status-success-fg"
                    : "border-border bg-muted/40 text-muted-foreground",
                )}
              >
                {selectedSingleOption ? (
                  <>
                    <CheckCircle2 className="size-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">
                      Opción correcta:{" "}
                      <strong className="font-mono">{selectedSingleOption.code}</strong>
                      {selectedSingleOption.text ? ` — ${selectedSingleOption.text}` : ""}
                    </span>
                  </>
                ) : (
                  <span>Sin opción correcta asignada</span>
                )}
              </div>
            </div>

            <div className="sm:col-span-3">{scoreInput}</div>
            <div className="sm:col-span-4">{manualReviewSwitch}</div>
          </div>

          {isPersistedKey && (
            <p className="text-xs text-muted-foreground">
              Esta clave ya está guardada en el servidor: actualiza la opción correcta o marca
              revisión manual en lugar de quitarla directamente.
            </p>
          )}
        </div>
      )}

      {item.responseType === "OPCION_MULTIPLE" && (
        <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-12">
          <div className="space-y-1 sm:col-span-5">
            <Label htmlFor={expectedTextId} className="text-xs font-medium text-muted-foreground">
              Códigos de opciones correctas
            </Label>
            <Input
              id={expectedTextId}
              value={activeKey?.expectedText ?? ""}
              disabled={!canEditKey}
              placeholder="Ej. A,C"
              className="h-8 font-mono text-sm"
              onChange={(event) => {
                const value = event.target.value;
                updateAnswerKey({ expectedText: value === "" ? null : value });
              }}
            />
          </div>

          <div className="sm:col-span-3">{scoreInput}</div>
          <div className="sm:col-span-4">{manualReviewSwitch}</div>
        </div>
      )}

      {item.responseType === "NUMERICA" && (
        <div className="grid grid-cols-1 items-center gap-3 sm:grid-cols-2 xl:grid-cols-12">
          <div className="space-y-1 xl:col-span-3">
            <Label htmlFor={expectedNumberId} className="text-xs font-medium text-muted-foreground">
              Valor numérico esperado
            </Label>
            <Input
              id={expectedNumberId}
              type="number"
              step="any"
              value={activeKey?.expectedNumber ?? ""}
              disabled={!canEditKey}
              placeholder="Ej. 42"
              className="h-8 text-sm tabular-nums"
              onChange={(event) => {
                const raw = event.target.value.trim();
                if (raw === "") {
                  updateAnswerKey({ expectedNumber: null });
                  return;
                }
                const parsed = Number(raw);
                if (Number.isFinite(parsed)) {
                  updateAnswerKey({ expectedNumber: parsed });
                }
              }}
            />
          </div>

          <div className="space-y-1 xl:col-span-3">
            <Label
              htmlFor={numericToleranceId}
              className="text-xs font-medium text-muted-foreground"
            >
              Tolerancia numérica
            </Label>
            <Input
              id={numericToleranceId}
              type="number"
              min={0}
              step="any"
              value={activeKey?.numericTolerance ?? ""}
              disabled={!canEditKey}
              placeholder="Ej. 0.5"
              className="h-8 text-sm tabular-nums"
              onChange={(event) => {
                const raw = event.target.value.trim();
                if (raw === "") {
                  updateAnswerKey({ numericTolerance: null });
                  return;
                }
                const parsed = Number(raw);
                if (Number.isFinite(parsed) && parsed >= 0) {
                  updateAnswerKey({ numericTolerance: parsed });
                }
              }}
            />
          </div>

          <div className="xl:col-span-2">{scoreInput}</div>
          <div className="xl:col-span-4">{manualReviewSwitch}</div>
        </div>
      )}

      {item.responseType === "TEXTO_ABIERTO" && (
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor={expectedTextId} className="text-xs font-medium text-muted-foreground">
              Rúbrica / texto esperado de referencia
            </Label>
            <Textarea
              id={expectedTextId}
              value={activeKey?.expectedText ?? ""}
              disabled={!canEditKey}
              placeholder="Criterios clave o respuesta modelo para el evaluador"
              rows={2}
              onChange={(event) => {
                const value = event.target.value;
                updateAnswerKey({ expectedText: value === "" ? null : value });
              }}
            />
          </div>

          <div className="grid grid-cols-1 items-center gap-3 sm:grid-cols-12">
            <div className="sm:col-span-4">{scoreInput}</div>
            <div className="sm:col-span-8">{manualReviewSwitch}</div>
          </div>
        </div>
      )}
    </section>
  );
}
