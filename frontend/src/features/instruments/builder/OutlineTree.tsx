import * as React from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  FileText,
  GripVertical,
  Layers,
  Lock,
  Plus,
  RotateCcw,
  SlidersHorizontal,
} from "lucide-react";

import { Button, buttonVariants } from "../../../app/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../../app/components/ui/dropdown-menu";
import { cn } from "../../../app/components/ui/utils";
import {
  createDefaultDraftId,
  type DocumentAction,
  type DocumentItem,
  type DocumentNodeRef,
  type DocumentProblem,
  type DocumentSubtest,
  isActiveDraftNode,
  ITEM_TEMPLATE_LIST,
  type ItemTemplateId,
  nodeKeyOf,
  type ValidationReport,
  type VersionDocument,
} from "../document";

export interface OutlineTreeProps {
  document: VersionDocument;
  selectedNode: DocumentNodeRef;
  validation: ValidationReport;
  readOnly: boolean;
  canEdit: boolean;
  canConfigureBaremos: boolean;
  onSelectNode: (ref: DocumentNodeRef) => void;
  onDispatch: (action: DocumentAction) => void;
  onOpenReuseSubtest?: () => void;
  className?: string;
}

type ValidationSeverityState = "error" | "warning" | "ok";

type DragState =
  | { kind: "subtest"; subtestDraftId: string }
  | { kind: "item"; subtestDraftId: string; itemDraftId: string }
  | null;

function resolveSeverity(problems: readonly DocumentProblem[]): ValidationSeverityState {
  let hasWarning = false;
  for (const problem of problems) {
    if (problem.severity === "error") return "error";
    if (problem.severity === "warning") hasWarning = true;
  }
  return hasWarning ? "warning" : "ok";
}

function ValidationIcon({
  problems,
  severityOverride,
}: {
  problems?: readonly DocumentProblem[];
  severityOverride?: ValidationSeverityState;
}) {
  const severity = severityOverride ?? resolveSeverity(problems ?? []);

  if (severity === "error") {
    return (
      <span
        role="img"
        aria-label="Con errores"
        title="Con errores"
        data-validation-status="error"
        className="inline-flex shrink-0 items-center text-status-danger-fg"
      >
        <AlertCircle className="size-3.5" aria-hidden="true" />
      </span>
    );
  }

  if (severity === "warning") {
    return (
      <span
        role="img"
        aria-label="Con advertencias"
        title="Con advertencias"
        data-validation-status="warning"
        className="inline-flex shrink-0 items-center text-status-warning-fg"
      >
        <AlertTriangle className="size-3.5" aria-hidden="true" />
      </span>
    );
  }

  return (
    <span
      role="img"
      aria-label="Válido"
      title="Válido"
      data-validation-status="ok"
      className="inline-flex shrink-0 items-center text-status-success-fg"
    >
      <CheckCircle2 className="size-3.5" aria-hidden="true" />
    </span>
  );
}

function DirtyDot({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <span
      role="img"
      aria-label="Cambios sin guardar"
      title="Cambios sin guardar"
      data-dirty-indicator="true"
      className="size-2 shrink-0 rounded-full bg-status-warning-solid"
    />
  );
}

function isSameNodeRef(a: DocumentNodeRef, b: DocumentNodeRef): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "version":
    case "publish":
      return true;
    case "baremos":
      return b.kind === "baremos";
    case "subtest":
      return b.kind === "subtest" && a.subtestDraftId === b.subtestDraftId;
    case "item":
      return (
        b.kind === "item" &&
        a.subtestDraftId === b.subtestDraftId &&
        a.itemDraftId === b.itemDraftId
      );
  }
}

export function OutlineTree({
  document,
  selectedNode,
  validation,
  readOnly,
  canEdit,
  canConfigureBaremos,
  onSelectNode,
  onDispatch,
  onOpenReuseSubtest,
  className,
}: OutlineTreeProps) {
  const isEditable = canEdit && !readOnly;

  const [subtestsGroupExpanded, setSubtestsGroupExpanded] = React.useState(true);
  const [collapsedSubtestIds, setCollapsedSubtestIds] = React.useState<Record<string, boolean>>(
    {},
  );
  const [dragState, setDragState] = React.useState<DragState>(null);
  const [dropTargetKey, setDropTargetKey] = React.useState<string | null>(null);

  const dirtySet = new Set(document.dirtyNodeIds);

  const activeSubtests = [...document.subtests]
    .filter(isActiveDraftNode)
    .sort((a, b) => a.order - b.order);

  const activeBaremos = document.baremos.filter(isActiveDraftNode);

  const baremosProblems: DocumentProblem[] = [...(validation.byNodeKey["baremos"] ?? [])];
  for (const [key, list] of Object.entries(validation.byNodeKey)) {
    if (key.startsWith("baremo:")) {
      baremosProblems.push(...list);
    }
  }

  const baremosDirty =
    dirtySet.has("baremos") ||
    document.dirtyNodeIds.some((id) => id.startsWith("baremo:")) ||
    document.baremos.some((b) => dirtySet.has(b.draftId));

  const publishPassedCount = validation.checklist.filter((item) => item.passed).length;

  let publishSeverity: ValidationSeverityState = "ok";
  let publishWarning = validation.warnings.length > 0;
  for (const item of validation.checklist) {
    if (!item.passed) {
      if (item.severity === "error") {
        publishSeverity = "error";
        break;
      }
      publishWarning = true;
    }
  }
  if (publishSeverity !== "error") {
    if (!validation.valid) {
      publishSeverity = "error";
    } else if (publishWarning) {
      publishSeverity = "warning";
    }
  }

  const handleAddSubtest = () => {
    if (!isEditable) return;
    const draftId = createDefaultDraftId("sub");
    onDispatch({ type: "ADD_SUBTEST", input: { draftId } });
    onSelectNode({ kind: "subtest", subtestDraftId: draftId });
    setSubtestsGroupExpanded(true);
  };

  const handleAddItem = (subtestDraftId: string, templateId?: ItemTemplateId) => {
    if (!isEditable) return;
    const itemDraftId = createDefaultDraftId("item");
    onDispatch(
      templateId
        ? { type: "ADD_ITEM", subtestDraftId, templateId, input: { draftId: itemDraftId } }
        : { type: "ADD_ITEM", subtestDraftId, input: { draftId: itemDraftId } },
    );
    setCollapsedSubtestIds((prev) => ({ ...prev, [subtestDraftId]: false }));
    onSelectNode({ kind: "item", subtestDraftId, itemDraftId });
  };

  const toggleSubtestExpanded = (subtestDraftId: string) => {
    setCollapsedSubtestIds((prev) => ({
      ...prev,
      [subtestDraftId]: !prev[subtestDraftId],
    }));
  };

  const handleSubtestDragStart = (
    event: React.DragEvent<HTMLElement>,
    subtest: DocumentSubtest,
  ) => {
    if (!isEditable) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", subtest.draftId);
    setDragState({ kind: "subtest", subtestDraftId: subtest.draftId });
  };

  const handleSubtestDrop = (
    event: React.DragEvent<HTMLElement>,
    targetSubtest: DocumentSubtest,
    targetIndex: number,
  ) => {
    event.preventDefault();
    setDropTargetKey(null);
    if (!isEditable || !dragState || dragState.kind !== "subtest") {
      setDragState(null);
      return;
    }
    if (dragState.subtestDraftId !== targetSubtest.draftId) {
      onDispatch({
        type: "MOVE_SUBTEST",
        subtestDraftId: dragState.subtestDraftId,
        toIndex: targetIndex,
      });
    }
    setDragState(null);
  };

  const handleItemDragStart = (
    event: React.DragEvent<HTMLElement>,
    subtestDraftId: string,
    item: DocumentItem,
  ) => {
    if (!isEditable) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", item.draftId);
    setDragState({ kind: "item", subtestDraftId, itemDraftId: item.draftId });
  };

  const handleItemDrop = (
    event: React.DragEvent<HTMLElement>,
    subtestDraftId: string,
    targetItem: DocumentItem,
    targetIndex: number,
  ) => {
    event.preventDefault();
    setDropTargetKey(null);
    if (
      !isEditable ||
      !dragState ||
      dragState.kind !== "item" ||
      dragState.subtestDraftId !== subtestDraftId
    ) {
      setDragState(null);
      return;
    }
    if (dragState.itemDraftId !== targetItem.draftId) {
      onDispatch({
        type: "MOVE_ITEM",
        subtestDraftId,
        itemDraftId: dragState.itemDraftId,
        toIndex: targetIndex,
      });
    }
    setDragState(null);
  };

  const versionRef: DocumentNodeRef = { kind: "version" };
  const versionSelected = isSameNodeRef(selectedNode, versionRef);
  const versionProblems = validation.byNodeKey[nodeKeyOf(versionRef)] ?? [];

  const baremosRef: DocumentNodeRef = { kind: "baremos" };
  const baremosSelected = isSameNodeRef(selectedNode, baremosRef);

  const publishRef: DocumentNodeRef = { kind: "publish" };
  const publishSelected = isSameNodeRef(selectedNode, publishRef);

  return (
    <nav
      aria-label="Estructura de la versión"
      className={cn(
        "flex h-full flex-col gap-3 overflow-y-auto rounded-lg border border-border bg-card p-3 text-card-foreground shadow-[var(--shadow-xs)]",
        className,
      )}
    >
      {/* Datos de versión */}
      <div
        className={cn(
          "flex items-center gap-1.5 rounded-md border px-2 py-1.5 transition-colors",
          versionSelected
            ? "border-primary bg-accent text-accent-foreground"
            : "border-transparent hover:bg-muted/60",
        )}
      >
        <button
          type="button"
          onClick={() => onSelectNode(versionRef)}
          aria-current={versionSelected ? "location" : undefined}
          className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <SlidersHorizontal className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="truncate">Datos de versión</span>
        </button>
        <DirtyDot visible={document.version.metaDirty || dirtySet.has("version")} />
        <ValidationIcon problems={versionProblems} />
      </div>

      <div className="border-t border-border" />

      {/* Grupo SUBTESTS */}
      <section aria-label="Subtests" className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-1 px-0.5">
          <button
            type="button"
            onClick={() => setSubtestsGroupExpanded((prev) => !prev)}
            aria-expanded={subtestsGroupExpanded}
            className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
          >
            {subtestsGroupExpanded ? (
              <ChevronDown className="size-3.5" aria-hidden="true" />
            ) : (
              <ChevronRight className="size-3.5" aria-hidden="true" />
            )}
            <span>SUBTESTS</span>
            <span className="font-mono text-xs tabular-nums">({activeSubtests.length})</span>
          </button>

          <div className="flex items-center gap-0.5">
            {onOpenReuseSubtest && !readOnly && canEdit && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="+ Reutilizar"
                title="Reutilizar subtest existente"
                onClick={onOpenReuseSubtest}
                className="size-6 text-muted-foreground hover:text-foreground"
              >
                <RotateCcw className="size-3.5" aria-hidden="true" />
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="+ Nuevo subtest"
              title="Nuevo subtest"
              disabled={!isEditable}
              onClick={handleAddSubtest}
              className="size-6 text-muted-foreground hover:text-foreground"
            >
              <Plus className="size-3.5" aria-hidden="true" />
            </Button>
          </div>
        </div>

        {subtestsGroupExpanded && (
          <div className="flex flex-col gap-1.5">
            {activeSubtests.length === 0 ? (
              <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                Sin subtests activos aún.
              </p>
            ) : (
              activeSubtests.map((subtest, subIndex) => {
                const subRef: DocumentNodeRef = { kind: "subtest", subtestDraftId: subtest.draftId };
                const subKey = nodeKeyOf(subRef);
                const subSelected = isSameNodeRef(selectedNode, subRef);
                const subExpanded = !collapsedSubtestIds[subtest.draftId];

                const activeItems = [...subtest.items]
                  .filter(isActiveDraftNode)
                  .sort((a, b) => a.order - b.order);

                const subRolledProblems: DocumentProblem[] = [
                  ...(validation.byNodeKey[subKey] ?? []),
                ];
                for (const item of activeItems) {
                  const itemKey = nodeKeyOf({
                    kind: "item",
                    subtestDraftId: subtest.draftId,
                    itemDraftId: item.draftId,
                  });
                  subRolledProblems.push(...(validation.byNodeKey[itemKey] ?? []));
                }

                const subDirty = dirtySet.has(subKey) || dirtySet.has(subtest.draftId);
                const isSubDropTarget = dropTargetKey === subKey;

                return (
                  <div
                    key={subtest.draftId}
                    data-testid={`outline-subtest-${subtest.draftId}`}
                    className={cn(
                      "flex flex-col gap-1 rounded-md border border-transparent",
                      isSubDropTarget && "border-primary bg-accent/40",
                    )}
                    onDragOver={
                      isEditable
                        ? (event) => {
                            if (dragState?.kind !== "subtest") return;
                            event.preventDefault();
                            setDropTargetKey(subKey);
                          }
                        : undefined
                    }
                    onDragLeave={
                      isEditable
                        ? () => {
                            if (dropTargetKey === subKey) setDropTargetKey(null);
                          }
                        : undefined
                    }
                    onDrop={
                      isEditable
                        ? (event) => handleSubtestDrop(event, subtest, subIndex)
                        : undefined
                    }
                  >
                    <div
                      draggable={isEditable}
                      onDragStart={(event) => handleSubtestDragStart(event, subtest)}
                      onDragEnd={() => {
                        setDragState(null);
                        setDropTargetKey(null);
                      }}
                      className={cn(
                        "flex items-center gap-1 rounded-md border px-1.5 py-1 transition-colors",
                        subSelected
                          ? "border-primary bg-accent text-accent-foreground"
                          : "border-transparent hover:bg-muted/60",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => toggleSubtestExpanded(subtest.draftId)}
                        aria-expanded={subExpanded}
                        aria-label={
                          subExpanded
                            ? `Colapsar subtest ${subtest.name || subtest.code}`
                            : `Expandir subtest ${subtest.name || subtest.code}`
                        }
                        className="inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        {subExpanded ? (
                          <ChevronDown className="size-3.5" aria-hidden="true" />
                        ) : (
                          <ChevronRight className="size-3.5" aria-hidden="true" />
                        )}
                      </button>

                      {isEditable && (
                        <span
                          aria-hidden="true"
                          title="Arrastrar para reordenar subtest"
                          className="inline-flex shrink-0 cursor-grab items-center text-muted-foreground"
                        >
                          <GripVertical className="size-3.5" />
                        </span>
                      )}

                      <button
                        type="button"
                        onClick={() => onSelectNode(subRef)}
                        aria-current={subSelected ? "location" : undefined}
                        className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span className="font-mono text-xs text-muted-foreground tabular-nums">
                          {subtest.order}.
                        </span>
                        <span className="truncate">{subtest.name || subtest.code}</span>
                      </button>

                      <DirtyDot visible={subDirty} />
                      <ValidationIcon problems={subRolledProblems} />

                      <div className="flex shrink-0 items-center">
                        <button
                          type="button"
                          aria-label="Mover subtest arriba"
                          disabled={!isEditable || subIndex === 0}
                          onClick={() =>
                            onDispatch({
                              type: "MOVE_SUBTEST",
                              subtestDraftId: subtest.draftId,
                              toIndex: subIndex - 1,
                            })
                          }
                          className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                        >
                          <ArrowUp className="size-3" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          aria-label="Mover subtest abajo"
                          disabled={!isEditable || subIndex === activeSubtests.length - 1}
                          onClick={() =>
                            onDispatch({
                              type: "MOVE_SUBTEST",
                              subtestDraftId: subtest.draftId,
                              toIndex: subIndex + 1,
                            })
                          }
                          className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                        >
                          <ArrowDown className="size-3" aria-hidden="true" />
                        </button>
                      </div>
                    </div>

                    {subExpanded && (
                      <div className="ml-4 flex flex-col gap-1 border-l border-border pl-2">
                        {activeItems.map((item, itemIndex) => {
                          const itemRef: DocumentNodeRef = {
                            kind: "item",
                            subtestDraftId: subtest.draftId,
                            itemDraftId: item.draftId,
                          };
                          const itemKey = nodeKeyOf(itemRef);
                          const itemSelected = isSameNodeRef(selectedNode, itemRef);
                          const itemProblems = validation.byNodeKey[itemKey] ?? [];
                          const itemDirty = dirtySet.has(itemKey) || dirtySet.has(item.draftId);
                          const isItemDropTarget = dropTargetKey === itemKey;

                          return (
                            <div
                              key={item.draftId}
                              data-testid={`outline-item-${item.draftId}`}
                              draggable={isEditable}
                              onDragStart={(event) =>
                                handleItemDragStart(event, subtest.draftId, item)
                              }
                              onDragEnd={() => {
                                setDragState(null);
                                setDropTargetKey(null);
                              }}
                              onDragOver={
                                isEditable
                                  ? (event) => {
                                      if (
                                        dragState?.kind !== "item" ||
                                        dragState.subtestDraftId !== subtest.draftId
                                      ) {
                                        return;
                                      }
                                      event.preventDefault();
                                      setDropTargetKey(itemKey);
                                    }
                                  : undefined
                              }
                              onDragLeave={
                                isEditable
                                  ? () => {
                                      if (dropTargetKey === itemKey) setDropTargetKey(null);
                                    }
                                  : undefined
                              }
                              onDrop={
                                isEditable
                                  ? (event) =>
                                      handleItemDrop(event, subtest.draftId, item, itemIndex)
                                  : undefined
                              }
                              className={cn(
                                "flex items-center gap-1 rounded-md border px-1.5 py-1 transition-colors",
                                isItemDropTarget && "border-primary bg-accent/40",
                                itemSelected
                                  ? "border-primary bg-accent text-accent-foreground"
                                  : "border-transparent hover:bg-muted/60",
                              )}
                            >
                              {isEditable && (
                                <span
                                  aria-hidden="true"
                                  title="Arrastrar para reordenar ítem"
                                  className="inline-flex shrink-0 cursor-grab items-center text-muted-foreground"
                                >
                                  <GripVertical className="size-3" />
                                </span>
                              )}

                              <button
                                type="button"
                                onClick={() => onSelectNode(itemRef)}
                                aria-current={itemSelected ? "location" : undefined}
                                className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              >
                                <FileText
                                  className="size-3.5 shrink-0 text-muted-foreground"
                                  aria-hidden="true"
                                />
                                <span className="shrink-0 font-mono text-xs font-medium text-foreground">
                                  {item.code}
                                </span>
                                <span className="truncate text-muted-foreground">
                                  {item.prompt.trim() || "Sin enunciado"}
                                </span>
                              </button>

                              <DirtyDot visible={itemDirty} />
                              <ValidationIcon problems={itemProblems} />

                              <div className="flex shrink-0 items-center">
                                <button
                                  type="button"
                                  aria-label="Mover ítem arriba"
                                  disabled={!isEditable || itemIndex === 0}
                                  onClick={() =>
                                    onDispatch({
                                      type: "MOVE_ITEM",
                                      subtestDraftId: subtest.draftId,
                                      itemDraftId: item.draftId,
                                      toIndex: itemIndex - 1,
                                    })
                                  }
                                  className="inline-flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                                >
                                  <ArrowUp className="size-3" aria-hidden="true" />
                                </button>
                                <button
                                  type="button"
                                  aria-label="Mover ítem abajo"
                                  disabled={!isEditable || itemIndex === activeItems.length - 1}
                                  onClick={() =>
                                    onDispatch({
                                      type: "MOVE_ITEM",
                                      subtestDraftId: subtest.draftId,
                                      itemDraftId: item.draftId,
                                      toIndex: itemIndex + 1,
                                    })
                                  }
                                  className="inline-flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                                >
                                  <ArrowDown className="size-3" aria-hidden="true" />
                                </button>
                              </div>
                            </div>
                          );
                        })}

                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              disabled={!isEditable}
                              className={cn(
                                buttonVariants({ variant: "ghost", size: "sm" }),
                                "h-7 justify-start px-2 text-xs text-muted-foreground hover:text-foreground",
                              )}
                            >
                              <Plus className="size-3.5" aria-hidden="true" />
                              <span>+ Nuevo ítem</span>
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start" className="w-72">
                            <DropdownMenuItem onSelect={() => handleAddItem(subtest.draftId)}>
                              <div className="flex flex-col gap-0.5">
                                <span className="text-sm font-medium">Ítem en blanco</span>
                                <span className="text-xs text-muted-foreground">
                                  Configuración vacía desde cero
                                </span>
                              </div>
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            {ITEM_TEMPLATE_LIST.map((tpl) => (
                              <DropdownMenuItem
                                key={tpl.id}
                                onSelect={() => handleAddItem(subtest.draftId, tpl.id)}
                              >
                                <div className="flex flex-col gap-0.5">
                                  <span className="text-sm font-medium">{tpl.label}</span>
                                  <span className="text-xs text-muted-foreground">
                                    {tpl.description}
                                  </span>
                                </div>
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </section>

      <div className="border-t border-border" />

      {/* Baremos */}
      <div
        className={cn(
          "flex items-center gap-1.5 rounded-md border px-2 py-1.5 transition-colors",
          baremosSelected
            ? "border-primary bg-accent text-accent-foreground"
            : "border-transparent hover:bg-muted/60",
        )}
      >
        <button
          type="button"
          onClick={() => onSelectNode(baremosRef)}
          aria-current={baremosSelected ? "location" : undefined}
          className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Layers className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="truncate">Baremos</span>
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground tabular-nums">
            {activeBaremos.length}
          </span>
        </button>
        {!canConfigureBaremos && (
          <span
            role="img"
            aria-label="Solo lectura para baremos"
            title="Sin permiso para editar baremos"
            className="inline-flex shrink-0 items-center text-muted-foreground"
          >
            <Lock className="size-3.5" aria-hidden="true" />
          </span>
        )}
        <DirtyDot visible={baremosDirty} />
        <ValidationIcon problems={baremosProblems} />
      </div>

      {/* Revisión y publicación */}
      <div
        className={cn(
          "flex items-center gap-1.5 rounded-md border px-2 py-1.5 transition-colors",
          publishSelected
            ? "border-primary bg-accent text-accent-foreground"
            : "border-transparent hover:bg-muted/60",
        )}
      >
        <button
          type="button"
          onClick={() => onSelectNode(publishRef)}
          aria-current={publishSelected ? "location" : undefined}
          className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ClipboardCheck className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="truncate">Revisión y publicación</span>
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground tabular-nums">
            {publishPassedCount}/{validation.checklist.length}
          </span>
        </button>
        <ValidationIcon severityOverride={publishSeverity} />
      </div>
    </nav>
  );
}
