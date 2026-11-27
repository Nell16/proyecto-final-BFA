import { useId, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  GripVertical,
  Info,
  Plus,
  Trash2,
} from "lucide-react";

import { Alert, AlertDescription } from "../../../app/components/ui/alert";
import { Button } from "../../../app/components/ui/button";
import { Input } from "../../../app/components/ui/input";
import { Label } from "../../../app/components/ui/label";
import { cn } from "../../../app/components/ui/utils";
import {
  isActiveDraftNode,
  SINGLE_KEY_OPTION_RESPONSE_TYPES,
  type DocumentAction,
  type DocumentItem,
  type DocumentOption,
  type DocumentProblem,
} from "../document";
import { ImageField } from "./ImageField";

export interface OptionListProps {
  subtestDraftId: string;
  subtestDefaultRuleId: number | null;
  item: DocumentItem;
  readOnly: boolean;
  canEdit: boolean;
  canConfigureScoring: boolean;
  problems?: readonly DocumentProblem[];
  onDispatch: (action: DocumentAction) => void;
  onRegisterPendingFile: (file: File) => {
    pendingFileId: string;
    previewUrl: string;
    fileName: string;
  };
  onRemovePendingFile: (pendingFileId: string) => void;
}

/**
 * Lista editable minimalista de opciones de respuesta con selección de clave integrada,
 * reordenamiento por DnD HTML5 y botones de icono, e imágenes por opción.
 */
export function OptionList({
  subtestDraftId,
  subtestDefaultRuleId,
  item,
  readOnly,
  canEdit,
  canConfigureScoring,
  problems = [],
  onDispatch,
  onRegisterPendingFile,
  onRemovePendingFile,
}: OptionListProps) {
  const listId = useId();
  const [draggedDraftId, setDraggedDraftId] = useState<string | null>(null);
  const [dragOverDraftId, setDragOverDraftId] = useState<string | null>(null);

  const isLocked = readOnly || !canEdit;
  const canEditKey = !readOnly && canEdit && (subtestDefaultRuleId !== null || canConfigureScoring);
  const isSingleKeyType = SINGLE_KEY_OPTION_RESPONSE_TYPES.has(item.responseType);

  const rawActiveOptions = item.options.filter(isActiveDraftNode);
  const activeOptions = [...rawActiveOptions].sort((a, b) => a.order - b.order);
  const codeCounts = new Map<string, number>();
  for (const opt of activeOptions) {
    const normalized = opt.code.trim().toUpperCase();
    if (normalized) {
      codeCounts.set(normalized, (codeCounts.get(normalized) ?? 0) + 1);
    }
  }
  const activeKey = item.answerKey && isActiveDraftNode(item.answerKey) ? item.answerKey : null;
  const optionProblems = problems.filter((problem) => problem.field === "options");

  const isOptionCorrect = (option: DocumentOption): boolean => {
    if (!activeKey || activeKey.requiresManualReview) return false;
    if (activeKey.correctOptionDraftId !== null) {
      return activeKey.correctOptionDraftId === option.draftId;
    }
    return activeKey.correctOptionId !== null && option.id === activeKey.correctOptionId;
  };

  const moveOptionToSortedIndex = (sourceDraftId: string, targetSortedIndex: number) => {
    const targetOption = activeOptions[targetSortedIndex];
    if (!targetOption) return;
    const rawTargetIndex = rawActiveOptions.findIndex((o) => o.draftId === targetOption.draftId);
    if (rawTargetIndex < 0) return;

    onDispatch({
      type: "MOVE_OPTION",
      subtestDraftId,
      itemDraftId: item.draftId,
      optionDraftId: sourceDraftId,
      toIndex: rawTargetIndex,
    });
  };

  const handleDeleteOption = (option: DocumentOption) => {
    for (const img of option.images) {
      if (isActiveDraftNode(img) && img.pendingFileId !== null) {
        onRemovePendingFile(img.pendingFileId);
      }
    }
    onDispatch({
      type: "DELETE_OPTION",
      subtestDraftId,
      itemDraftId: item.draftId,
      optionDraftId: option.draftId,
    });
  };

  return (
    <section aria-labelledby={`${listId}-heading`} className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3
            id={`${listId}-heading`}
            className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
          >
            Opciones de respuesta
          </h3>
          <span className="font-mono text-xs text-muted-foreground tabular-nums">
            ({activeOptions.length})
          </span>
        </div>

        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="+ Añadir opción"
          title="Añadir opción"
          disabled={isLocked}
          onClick={() =>
            onDispatch({
              type: "ADD_OPTION",
              subtestDraftId,
              itemDraftId: item.draftId,
            })
          }
          className="size-7"
        >
          <Plus className="size-4" aria-hidden="true" />
        </Button>
      </div>

      {!readOnly && canEdit && !canEditKey && isSingleKeyType && (
        <Alert className="border-status-info-border bg-status-info-bg text-status-info-fg">
          <Info className="size-4" aria-hidden="true" />
          <AlertDescription className="text-xs text-status-info-fg">
            Marcar la clave en un subtest sin regla previa requiere el permiso{" "}
            <code className="font-mono font-semibold">CALIFICACION_CONFIGURAR</code>.
          </AlertDescription>
        </Alert>
      )}

      {optionProblems.length > 0 && (
        <div className="space-y-1.5">
          {optionProblems.map((problem) => {
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

      {activeOptions.length === 0 ? (
        <div className="rounded-md border border-dashed border-border py-4 text-center text-xs text-muted-foreground">
          Sin opciones activas. Añade al menos 2 opciones.
        </div>
      ) : (
        <div
          role={isSingleKeyType ? "radiogroup" : undefined}
          aria-label={isSingleKeyType ? "Opciones de respuesta" : undefined}
          className="space-y-1.5"
        >
          {activeOptions.map((opt, index) => {
            const correct = isSingleKeyType && isOptionCorrect(opt);
            const codeInputId = `${listId}-code-${opt.draftId}`;
            const textInputId = `${listId}-text-${opt.draftId}`;
            const ordinalInputId = `${listId}-ordinal-${opt.draftId}`;
            const isDragging = draggedDraftId === opt.draftId;
            const isDragOver = dragOverDraftId === opt.draftId && draggedDraftId !== opt.draftId;

            return (
              <div
                key={opt.draftId}
                data-slot="option-row"
                data-option-id={opt.draftId}
                draggable={!isLocked}
                onDragStart={(event) => {
                  if (isLocked) {
                    event.preventDefault();
                    return;
                  }
                  setDraggedDraftId(opt.draftId);
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", opt.draftId);
                }}
                onDragOver={(event) => {
                  if (isLocked) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  if (dragOverDraftId !== opt.draftId) {
                    setDragOverDraftId(opt.draftId);
                  }
                }}
                onDragLeave={() => {
                  if (dragOverDraftId === opt.draftId) {
                    setDragOverDraftId(null);
                  }
                }}
                onDrop={(event) => {
                  if (isLocked) return;
                  event.preventDefault();
                  const sourceId = draggedDraftId || event.dataTransfer.getData("text/plain");
                  setDraggedDraftId(null);
                  setDragOverDraftId(null);
                  if (sourceId && sourceId !== opt.draftId) {
                    moveOptionToSortedIndex(sourceId, index);
                  }
                }}
                onDragEnd={() => {
                  setDraggedDraftId(null);
                  setDragOverDraftId(null);
                }}
                className={cn(
                  "rounded-md border px-2.5 py-2 transition-colors",
                  correct
                    ? "border-status-success-border bg-status-success-bg/35"
                    : "border-border bg-card",
                  isDragging && "opacity-60",
                  isDragOver && "border-primary ring-2 ring-ring/30",
                )}
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <span
                    className={cn(
                      "inline-flex shrink-0 items-center text-muted-foreground",
                      !isLocked && "cursor-grab",
                    )}
                    aria-hidden="true"
                  >
                    <GripVertical className="size-3.5" />
                  </span>

                  {isSingleKeyType && (
                    <button
                      type="button"
                      role="radio"
                      aria-checked={correct}
                      aria-label={`Marcar opción ${opt.code} como correcta`}
                      title={correct ? "Clave correcta" : "Marcar como correcta"}
                      disabled={!canEditKey}
                      onClick={() =>
                        onDispatch({
                          type: "SET_CORRECT_OPTION",
                          subtestDraftId,
                          itemDraftId: item.draftId,
                          optionDraftId: opt.draftId,
                        })
                      }
                      className={cn(
                        "inline-flex size-7 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
                        correct
                          ? "text-status-success-fg"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      {correct ? (
                        <>
                          <CheckCircle2 className="size-4" aria-hidden="true" />
                          <span className="sr-only">Correcta</span>
                        </>
                      ) : (
                        <span
                          aria-hidden="true"
                          className="size-3.5 rounded-full border border-border-strong bg-background"
                        />
                      )}
                    </button>
                  )}

                  <div className="w-16 shrink-0">
                    <Label htmlFor={codeInputId} className="sr-only">
                      Código
                    </Label>
                    <Input
                      id={codeInputId}
                      value={opt.code}
                      disabled={isLocked}
                      placeholder="Cod."
                      aria-invalid={
                        opt.code.trim() === "" ||
                        (codeCounts.get(opt.code.trim().toUpperCase()) ?? 0) > 1
                      }
                      className="h-8 font-mono text-xs"
                      onChange={(event) =>
                        onDispatch({
                          type: "UPDATE_OPTION",
                          subtestDraftId,
                          itemDraftId: item.draftId,
                          optionDraftId: opt.draftId,
                          patch: { code: event.target.value },
                        })
                      }
                    />
                  </div>

                  <div className="min-w-[9rem] flex-1">
                    <Label htmlFor={textInputId} className="sr-only">
                      Texto
                    </Label>
                    <Input
                      id={textInputId}
                      value={opt.text}
                      disabled={isLocked}
                      placeholder="Texto visible de la opción"
                      className="h-8 text-sm"
                      onChange={(event) =>
                        onDispatch({
                          type: "UPDATE_OPTION",
                          subtestDraftId,
                          itemDraftId: item.draftId,
                          optionDraftId: opt.draftId,
                          patch: { text: event.target.value },
                        })
                      }
                    />
                  </div>

                  <div className="w-20 shrink-0">
                    <Label htmlFor={ordinalInputId} className="sr-only">
                      Valor ordinal
                    </Label>
                    <Input
                      id={ordinalInputId}
                      type="number"
                      step="any"
                      value={opt.ordinalValue ?? ""}
                      disabled={isLocked}
                      placeholder="Ordinal"
                      className="h-8 text-xs tabular-nums"
                      onChange={(event) => {
                        const raw = event.target.value.trim();
                        if (raw === "") {
                          onDispatch({
                            type: "UPDATE_OPTION",
                            subtestDraftId,
                            itemDraftId: item.draftId,
                            optionDraftId: opt.draftId,
                            patch: { ordinalValue: null },
                          });
                          return;
                        }
                        const parsed = Number(raw);
                        if (Number.isFinite(parsed)) {
                          onDispatch({
                            type: "UPDATE_OPTION",
                            subtestDraftId,
                            itemDraftId: item.draftId,
                            optionDraftId: opt.draftId,
                            patch: { ordinalValue: parsed },
                          });
                        }
                      }}
                    />
                  </div>

                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Subir opción"
                    title="Subir opción"
                    disabled={isLocked || index === 0}
                    onClick={() => moveOptionToSortedIndex(opt.draftId, index - 1)}
                    className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
                  >
                    <ArrowUp className="size-3.5" aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Bajar opción"
                    title="Bajar opción"
                    disabled={isLocked || index === activeOptions.length - 1}
                    onClick={() => moveOptionToSortedIndex(opt.draftId, index + 1)}
                    className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
                  >
                    <ArrowDown className="size-3.5" aria-hidden="true" />
                  </Button>

                  <ImageField
                    kind="option"
                    compact
                    images={opt.images}
                    readOnly={readOnly}
                    canEdit={canEdit}
                    onAttachFile={(file) => {
                      const pending = onRegisterPendingFile(file);
                      onDispatch({
                        type: "ATTACH_OPTION_IMAGE",
                        subtestDraftId,
                        itemDraftId: item.draftId,
                        optionDraftId: opt.draftId,
                        image: {
                          pendingFileId: pending.pendingFileId,
                          previewUrl: pending.previewUrl,
                          fileName: pending.fileName,
                          altText: "",
                        },
                      });
                    }}
                    onUpdateImage={(imageDraftId, patch) =>
                      onDispatch({
                        type: "UPDATE_OPTION_IMAGE",
                        subtestDraftId,
                        itemDraftId: item.draftId,
                        optionDraftId: opt.draftId,
                        imageDraftId,
                        patch,
                      })
                    }
                    onDeleteImage={(imageDraftId) => {
                      const target = opt.images.find((img) => img.draftId === imageDraftId);
                      if (target?.pendingFileId !== null && target?.pendingFileId !== undefined) {
                        onRemovePendingFile(target.pendingFileId);
                      }
                      onDispatch({
                        type: "DELETE_OPTION_IMAGE",
                        subtestDraftId,
                        itemDraftId: item.draftId,
                        optionDraftId: opt.draftId,
                        imageDraftId,
                      });
                    }}
                  />

                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Eliminar opción"
                    title="Eliminar opción"
                    disabled={isLocked}
                    onClick={() => handleDeleteOption(opt)}
                    className="size-7 shrink-0 text-muted-foreground hover:bg-status-danger-bg hover:text-status-danger-fg"
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
