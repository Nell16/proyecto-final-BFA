import { useId, useState } from "react";
import { AlertCircle, AlertTriangle, Copy, Trash2 } from "lucide-react";

import { Alert, AlertDescription } from "../../../app/components/ui/alert";
import { Button } from "../../../app/components/ui/button";
import { ConfirmDialog } from "../../../app/components/ui/confirm-dialog";
import { Input } from "../../../app/components/ui/input";
import { Label } from "../../../app/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../app/components/ui/select";
import { Switch } from "../../../app/components/ui/switch";
import { Textarea } from "../../../app/components/ui/textarea";
import { cn } from "../../../app/components/ui/utils";
import {
  isActiveDraftNode,
  nodeKeyOf,
  OPTION_RESPONSE_TYPES,
  type DocumentAction,
  type DocumentItem,
  type DocumentSubtest,
  type ItemType,
  type ResponseType,
  type ValidationReport,
} from "../document";
import { AnswerKeyField } from "./AnswerKeyField";
import { ImageField } from "./ImageField";
import { OptionList } from "./OptionList";

const ITEM_TYPE_OPTIONS: readonly { value: ItemType; label: string }[] = [
  { value: "SOLO_TEXTO", label: "Solo texto" },
  { value: "SOLO_IMAGEN", label: "Solo imagen" },
  { value: "TEXTO_E_IMAGEN", label: "Texto e imagen" },
  { value: "COMPARACION_IMAGENES", label: "Comparación de imágenes" },
  { value: "RAZONAMIENTO_VERBAL", label: "Razonamiento verbal" },
];

const RESPONSE_TYPE_OPTIONS: readonly { value: ResponseType; label: string }[] = [
  { value: "OPCION_UNICA", label: "Opción única" },
  { value: "OPCION_MULTIPLE", label: "Opción múltiple" },
  { value: "VERDADERO_FALSO", label: "Verdadero / Falso" },
  { value: "NUMERICA", label: "Numérica" },
  { value: "TEXTO_ABIERTO", label: "Texto abierto" },
];

export interface ItemEditorProps {
  subtest: DocumentSubtest;
  item: DocumentItem;
  validation: ValidationReport;
  readOnly: boolean;
  canEdit: boolean;
  canConfigureScoring: boolean;
  onDispatch: (action: DocumentAction) => void;
  onRegisterPendingFile: (file: File) => {
    pendingFileId: string;
    previewUrl: string;
    fileName: string;
  };
  onRemovePendingFile: (pendingFileId: string) => void;
  onDuplicated?: () => void;
  onDeleted?: () => void;
}

/**
 * Editor contextual minimalista de un ítem del builder en un contenedor unificado:
 * metadatos en columnas, estímulo visual, lista de opciones y clave de respuesta.
 */
export function ItemEditor({
  subtest,
  item,
  validation,
  readOnly,
  canEdit,
  canConfigureScoring,
  onDispatch,
  onRegisterPendingFile,
  onRemovePendingFile,
  onDuplicated,
  onDeleted,
}: ItemEditorProps) {
  const editorId = useId();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const isLocked = readOnly || !canEdit;
  const itemNodeKey = nodeKeyOf({
    kind: "item",
    subtestDraftId: subtest.draftId,
    itemDraftId: item.draftId,
  });
  const itemProblems = validation.byNodeKey[itemNodeKey] ?? [];
  const generalItemProblems = itemProblems.filter(
    (p) => p.field !== "options" && !p.field?.startsWith("answerKey"),
  );

  const updateItem = (patch: Extract<DocumentAction, { type: "UPDATE_ITEM" }>["patch"]) => {
    onDispatch({
      type: "UPDATE_ITEM",
      subtestDraftId: subtest.draftId,
      itemDraftId: item.draftId,
      patch,
    });
  };

  const handleDuplicate = () => {
    onDispatch({
      type: "DUPLICATE_ITEM",
      subtestDraftId: subtest.draftId,
      itemDraftId: item.draftId,
    });
    onDuplicated?.();
  };

  const handleConfirmDelete = () => {
    for (const img of item.images) {
      if (isActiveDraftNode(img) && img.pendingFileId !== null) {
        onRemovePendingFile(img.pendingFileId);
      }
    }
    for (const opt of item.options) {
      if (!isActiveDraftNode(opt)) continue;
      for (const img of opt.images) {
        if (isActiveDraftNode(img) && img.pendingFileId !== null) {
          onRemovePendingFile(img.pendingFileId);
        }
      }
    }
    onDispatch({
      type: "DELETE_ITEM",
      subtestDraftId: subtest.draftId,
      itemDraftId: item.draftId,
    });
    onDeleted?.();
  };

  const codeInputId = `${editorId}-code`;
  const itemTypeId = `${editorId}-item-type`;
  const responseTypeId = `${editorId}-response-type`;
  const promptId = `${editorId}-prompt`;
  const instructionId = `${editorId}-instruction`;
  const baseScoreId = `${editorId}-base-score`;
  const timeLimitId = `${editorId}-time-limit`;
  const requiredId = `${editorId}-required`;
  const confidentialId = `${editorId}-confidential`;

  const codeError = itemProblems.find((p) => p.field === "code");
  const baseScoreError = itemProblems.find((p) => p.field === "baseScore");
  const timeLimitError = itemProblems.find((p) => p.field === "timeLimitSeconds");

  return (
    <div className="space-y-3" data-slot="item-editor">
      {generalItemProblems.length > 0 && (
        <div className="space-y-1.5" aria-label="Validación del ítem">
          {generalItemProblems.map((problem) => {
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

      <div className="divide-y divide-border rounded-lg border border-border bg-card shadow-[var(--shadow-xs)]">
        {/* Cabecera minimalista con botones de icono */}
        <div className="flex items-center justify-between gap-2 px-5 py-3">
          <div className="flex min-w-0 items-baseline gap-2">
            <h2 className="truncate text-sm font-semibold text-foreground">
              {subtest.name} › {item.code}
            </h2>
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
              #{item.order}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Duplicar"
              title="Duplicar ítem"
              disabled={isLocked}
              onClick={handleDuplicate}
              className="size-8 text-muted-foreground hover:text-foreground"
            >
              <Copy className="size-4" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Eliminar ítem"
              title="Eliminar ítem"
              disabled={isLocked}
              onClick={() => setDeleteDialogOpen(true)}
              className="size-8 text-muted-foreground hover:bg-status-danger-bg hover:text-status-danger-fg"
            >
              <Trash2 className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </div>

        {/* Configuración del ítem */}
        <section aria-labelledby={`${editorId}-general-heading`} className="space-y-4 p-5">
          <h3
            id={`${editorId}-general-heading`}
            className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
          >
            Configuración del ítem
          </h3>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-12">
            <div className="space-y-1 xl:col-span-2">
              <Label htmlFor={codeInputId} className="text-xs font-medium text-muted-foreground">
                Código del ítem <span className="text-status-danger-fg">*</span>
              </Label>
              <Input
                id={codeInputId}
                value={item.code}
                disabled={isLocked}
                aria-invalid={Boolean(codeError)}
                className="h-8 font-mono text-sm"
                onChange={(event) => updateItem({ code: event.target.value })}
              />
              {codeError && (
                <p className="text-xs text-status-danger-fg">{codeError.message}</p>
              )}
            </div>

            <div className="space-y-1 xl:col-span-3">
              <Label htmlFor={itemTypeId} className="text-xs font-medium text-muted-foreground">
                Tipo de ítem
              </Label>
              <Select
                value={item.itemType}
                disabled={isLocked}
                onValueChange={(value) => updateItem({ itemType: value as ItemType })}
              >
                <SelectTrigger id={itemTypeId} size="sm" className="text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ITEM_TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1 xl:col-span-3">
              <Label htmlFor={responseTypeId} className="text-xs font-medium text-muted-foreground">
                Tipo de respuesta
              </Label>
              <Select
                value={item.responseType}
                disabled={isLocked}
                onValueChange={(value) => updateItem({ responseType: value as ResponseType })}
              >
                <SelectTrigger id={responseTypeId} size="sm" className="text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RESPONSE_TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1 xl:col-span-2">
              <Label htmlFor={baseScoreId} className="text-xs font-medium text-muted-foreground">
                Puntaje base
              </Label>
              <Input
                id={baseScoreId}
                type="number"
                min={0}
                step="any"
                value={item.baseScore}
                disabled={isLocked}
                aria-invalid={Boolean(baseScoreError)}
                className="h-8 text-sm tabular-nums"
                onChange={(event) => {
                  const raw = event.target.value.trim();
                  if (raw === "") return;
                  const parsed = Number(raw);
                  if (Number.isFinite(parsed) && parsed >= 0) {
                    updateItem({ baseScore: parsed });
                  }
                }}
              />
              {baseScoreError && (
                <p className="text-xs text-status-danger-fg">{baseScoreError.message}</p>
              )}
            </div>

            <div className="space-y-1 xl:col-span-2">
              <Label htmlFor={timeLimitId} className="text-xs font-medium text-muted-foreground">
                Tiempo límite (segundos)
              </Label>
              <Input
                id={timeLimitId}
                type="number"
                min={1}
                step={1}
                value={item.timeLimitSeconds ?? ""}
                disabled={isLocked}
                placeholder="Sin límite"
                aria-invalid={Boolean(timeLimitError)}
                className="h-8 text-sm tabular-nums"
                onChange={(event) => {
                  const raw = event.target.value.trim();
                  if (raw === "") {
                    updateItem({ timeLimitSeconds: null });
                    return;
                  }
                  const parsed = Number.parseInt(raw, 10);
                  if (Number.isFinite(parsed) && parsed > 0) {
                    updateItem({ timeLimitSeconds: parsed });
                  }
                }}
              />
              {timeLimitError && (
                <p className="text-xs text-status-danger-fg">{timeLimitError.message}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
            <div className="space-y-1 md:col-span-7">
              <Label htmlFor={promptId} className="text-xs font-medium text-muted-foreground">
                Enunciado
              </Label>
              <Textarea
                id={promptId}
                value={item.prompt}
                disabled={isLocked}
                rows={2}
                placeholder="Pregunta o consigna principal del ítem"
                onChange={(event) => updateItem({ prompt: event.target.value })}
              />
            </div>

            <div className="space-y-1 md:col-span-5">
              <Label htmlFor={instructionId} className="text-xs font-medium text-muted-foreground">
                Instrucción
              </Label>
              <Textarea
                id={instructionId}
                value={item.instruction}
                disabled={isLocked}
                rows={2}
                placeholder="Indicaciones específicas para el participante"
                onChange={(event) => updateItem({ instruction: event.target.value })}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-1">
            <div className="flex items-center gap-2">
              <Switch
                id={requiredId}
                checked={item.required}
                disabled={isLocked}
                onCheckedChange={(checked) => updateItem({ required: checked })}
              />
              <Label htmlFor={requiredId} className="cursor-pointer text-xs font-medium text-foreground">
                Ítem obligatorio
              </Label>
            </div>

            <div className="flex items-center gap-2">
              <Switch
                id={confidentialId}
                checked={item.confidential}
                disabled={isLocked}
                onCheckedChange={(checked) => updateItem({ confidential: checked })}
              />
              <Label
                htmlFor={confidentialId}
                className="cursor-pointer text-xs font-medium text-foreground"
              >
                Confidencial
              </Label>
            </div>
          </div>
        </section>

        {/* Imágenes de estímulo */}
        <section aria-labelledby={`${editorId}-images-heading`} className="space-y-2.5 px-5 py-3.5">
          <h3
            id={`${editorId}-images-heading`}
            className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
          >
            Imágenes de estímulo
          </h3>

          <ImageField
            kind="item"
            images={item.images}
            readOnly={readOnly}
            canEdit={canEdit}
            onAttachFile={(file) => {
              const pending = onRegisterPendingFile(file);
              onDispatch({
                type: "ATTACH_ITEM_IMAGE",
                subtestDraftId: subtest.draftId,
                itemDraftId: item.draftId,
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
                type: "UPDATE_ITEM_IMAGE",
                subtestDraftId: subtest.draftId,
                itemDraftId: item.draftId,
                imageDraftId,
                patch,
              })
            }
            onDeleteImage={(imageDraftId) => {
              const target = item.images.find((img) => img.draftId === imageDraftId);
              if (target?.pendingFileId !== null && target?.pendingFileId !== undefined) {
                onRemovePendingFile(target.pendingFileId);
              }
              onDispatch({
                type: "DELETE_ITEM_IMAGE",
                subtestDraftId: subtest.draftId,
                itemDraftId: item.draftId,
                imageDraftId,
              });
            }}
          />
        </section>

        {/* Opciones de respuesta */}
        {OPTION_RESPONSE_TYPES.has(item.responseType) && (
          <div className="px-5 py-4">
            <OptionList
              subtestDraftId={subtest.draftId}
              subtestDefaultRuleId={subtest.defaultRuleId}
              item={item}
              readOnly={readOnly}
              canEdit={canEdit}
              canConfigureScoring={canConfigureScoring}
              problems={itemProblems}
              onDispatch={onDispatch}
              onRegisterPendingFile={onRegisterPendingFile}
              onRemovePendingFile={onRemovePendingFile}
            />
          </div>
        )}

        {/* Clave de respuesta */}
        <div className="px-5 py-4">
          <AnswerKeyField
            embedded
            subtestDraftId={subtest.draftId}
            subtestDefaultRuleId={subtest.defaultRuleId}
            item={item}
            readOnly={readOnly}
            canEdit={canEdit}
            canConfigureScoring={canConfigureScoring}
            problems={itemProblems}
            onDispatch={onDispatch}
          />
        </div>
      </div>

      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        tone="danger"
        title="¿Eliminar ítem?"
        description={`Se eliminará el ítem "${item.code}" junto con sus opciones, imágenes y clave de respuesta.`}
        confirmLabel="Eliminar ítem"
        cancelLabel="Cancelar"
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}
