import type { SubtestCloneTemplate } from "../../../api/schemas/instruments";
import { createItemFromTemplate, type ItemTemplateId } from "./templates";
import {
  createDefaultDraftId,
  type DocumentAnswerKey,
  type DocumentBaremo,
  type DocumentBaremoRange,
  type DocumentImage,
  type DocumentItem,
  type DocumentNodeRef,
  type DocumentOption,
  type DocumentSubtest,
  type DocumentVersionMeta,
  type DraftIdFactory,
  type DraftStatus,
  isActiveDraftNode,
  nodeKeyOf,
  OPTION_RESPONSE_TYPES,
  type VersionDocument,
} from "./types";

export interface OrderCollisionEntry {
  draftId: string;
  id: number;
  code: string;
  fromOrder: number;
  toOrder: number;
}

export interface OrderCollision {
  level: "subtest" | "item" | "option";
  node: DocumentNodeRef;
  nodeKey: string;
  label: string;
  entries: OrderCollisionEntry[];
}

export interface AddSubtestInput {
  draftId?: string;
  code?: string;
  name?: string;
  description?: string;
  instructions?: string;
  order?: number;
  timeLimitSeconds?: number | null;
  randomizeItems?: boolean;
  randomizeOptions?: boolean;
  required?: boolean;
  strategyId?: number | null;
  defaultRuleId?: number | null;
}

export interface AddItemInput {
  draftId?: string;
  code?: string;
  itemType?: DocumentItem["itemType"];
  responseType?: DocumentItem["responseType"];
  prompt?: string;
  instruction?: string;
  order?: number;
  baseScore?: number;
  timeLimitSeconds?: number | null;
  required?: boolean;
  confidential?: boolean;
}

export interface AddOptionInput {
  draftId?: string;
  code?: string;
  text?: string;
  order?: number;
  ordinalValue?: number | null;
}

export interface AttachImageInput {
  draftId?: string;
  resourceId?: number | null;
  pendingFileId?: string | null;
  previewUrl?: string | null;
  order?: number;
  altText?: string;
  role?: string | null;
  fileName?: string | null;
}

export interface AddBaremoInput {
  draftId?: string;
  dimensionId?: number | null;
  code?: string;
  name?: string;
  description?: string;
  normativeGroup?: string;
}

export interface AddBaremoRangeInput {
  draftId?: string;
  minScore?: number;
  maxScore?: number;
  percentile?: number | null;
  category?: string;
  interpretation?: string;
  recommendation?: string;
  order?: number;
}

export type MoveSubtestAction =
  | { type: "MOVE_SUBTEST"; subtestDraftId: string; toIndex: number }
  | { type: "MOVE_SUBTEST"; fromIndex: number; toIndex: number };

export type MoveItemAction =
  | { type: "MOVE_ITEM"; subtestDraftId: string; itemDraftId: string; toIndex: number }
  | { type: "MOVE_ITEM"; subtestDraftId: string; fromIndex: number; toIndex: number };

export type MoveOptionAction =
  | {
      type: "MOVE_OPTION";
      subtestDraftId: string;
      itemDraftId: string;
      optionDraftId: string;
      toIndex: number;
    }
  | {
      type: "MOVE_OPTION";
      subtestDraftId: string;
      itemDraftId: string;
      fromIndex: number;
      toIndex: number;
    };

export type DocumentAction =
  | { type: "LOAD_DOCUMENT"; document: VersionDocument }
  | { type: "MARK_SAVED"; loadedAt?: string }
  | {
      type: "UPDATE_VERSION_META";
      patch: Partial<
        Pick<
          DocumentVersionMeta,
          | "number"
          | "strategyId"
          | "instructions"
          | "timeLimitSeconds"
          | "randomizeSubtests"
          | "randomizeItems"
        >
      >;
    }
  | { type: "ADD_SUBTEST"; input?: AddSubtestInput }
  | {
      type: "UPDATE_SUBTEST";
      subtestDraftId: string;
      patch: Partial<
        Pick<
          DocumentSubtest,
          | "code"
          | "name"
          | "description"
          | "instructions"
          | "order"
          | "timeLimitSeconds"
          | "randomizeItems"
          | "randomizeOptions"
          | "required"
          | "strategyId"
          | "defaultRuleId"
        >
      >;
    }
  | { type: "DELETE_SUBTEST"; subtestDraftId: string }
  | MoveSubtestAction
  | {
      type: "IMPORT_SUBTEST_CLONE";
      template: SubtestCloneTemplate;
      codeOverride?: string;
      nameOverride?: string;
    }
  | {
      type: "ADD_ITEM";
      subtestDraftId: string;
      templateId?: ItemTemplateId;
      input?: AddItemInput;
    }
  | { type: "DUPLICATE_ITEM"; subtestDraftId: string; itemDraftId: string }
  | {
      type: "UPDATE_ITEM";
      subtestDraftId: string;
      itemDraftId: string;
      patch: Partial<
        Pick<
          DocumentItem,
          | "code"
          | "itemType"
          | "responseType"
          | "prompt"
          | "instruction"
          | "order"
          | "baseScore"
          | "timeLimitSeconds"
          | "required"
          | "confidential"
        >
      >;
    }
  | { type: "DELETE_ITEM"; subtestDraftId: string; itemDraftId: string }
  | MoveItemAction
  | {
      type: "ADD_OPTION";
      subtestDraftId: string;
      itemDraftId: string;
      input?: AddOptionInput;
    }
  | {
      type: "UPDATE_OPTION";
      subtestDraftId: string;
      itemDraftId: string;
      optionDraftId: string;
      patch: Partial<Pick<DocumentOption, "code" | "text" | "order" | "ordinalValue">>;
    }
  | {
      type: "DELETE_OPTION";
      subtestDraftId: string;
      itemDraftId: string;
      optionDraftId: string;
    }
  | MoveOptionAction
  | {
      type: "SET_CORRECT_OPTION";
      subtestDraftId: string;
      itemDraftId: string;
      optionDraftId: string;
    }
  | {
      type: "UPDATE_ANSWER_KEY";
      subtestDraftId: string;
      itemDraftId: string;
      patch: Partial<
        Pick<
          DocumentAnswerKey,
          | "ruleId"
          | "correctOptionDraftId"
          | "correctOptionId"
          | "expectedText"
          | "expectedNumber"
          | "numericTolerance"
          | "score"
          | "requiresManualReview"
        >
      >;
    }
  | { type: "CLEAR_ANSWER_KEY"; subtestDraftId: string; itemDraftId: string }
  | {
      type: "ATTACH_ITEM_IMAGE";
      subtestDraftId: string;
      itemDraftId: string;
      image: AttachImageInput;
    }
  | {
      type: "UPDATE_ITEM_IMAGE";
      subtestDraftId: string;
      itemDraftId: string;
      imageDraftId: string;
      patch: Partial<
        Pick<
          DocumentImage,
          "resourceId" | "pendingFileId" | "previewUrl" | "order" | "altText" | "role" | "fileName"
        >
      >;
    }
  | {
      type: "DELETE_ITEM_IMAGE";
      subtestDraftId: string;
      itemDraftId: string;
      imageDraftId: string;
    }
  | {
      type: "ATTACH_OPTION_IMAGE";
      subtestDraftId: string;
      itemDraftId: string;
      optionDraftId: string;
      image: AttachImageInput;
    }
  | {
      type: "UPDATE_OPTION_IMAGE";
      subtestDraftId: string;
      itemDraftId: string;
      optionDraftId: string;
      imageDraftId: string;
      patch: Partial<
        Pick<
          DocumentImage,
          "resourceId" | "pendingFileId" | "previewUrl" | "order" | "altText" | "role" | "fileName"
        >
      >;
    }
  | {
      type: "DELETE_OPTION_IMAGE";
      subtestDraftId: string;
      itemDraftId: string;
      optionDraftId: string;
      imageDraftId: string;
    }
  | { type: "ADD_BAREMO"; input?: AddBaremoInput }
  | {
      type: "UPDATE_BAREMO";
      baremoDraftId: string;
      patch: Partial<
        Pick<DocumentBaremo, "dimensionId" | "code" | "name" | "description" | "normativeGroup">
      >;
    }
  | { type: "DELETE_BAREMO"; baremoDraftId: string }
  | { type: "ADD_BAREMO_RANGE"; baremoDraftId: string; input?: AddBaremoRangeInput }
  | {
      type: "UPDATE_BAREMO_RANGE";
      baremoDraftId: string;
      rangeDraftId: string;
      patch: Partial<
        Pick<
          DocumentBaremoRange,
          | "minScore"
          | "maxScore"
          | "percentile"
          | "category"
          | "interpretation"
          | "recommendation"
          | "order"
        >
      >;
    }
  | { type: "DELETE_BAREMO_RANGE"; baremoDraftId: string; rangeDraftId: string }
  | { type: "APPLY_SUBTEST_RULE_IDS"; ruleIdBySubtestDraftId: Record<string, number> }
  | { type: "REVERT_REORDERING"; baseline: VersionDocument };

const markEdited = (status: DraftStatus): DraftStatus =>
  status === "EXISTING" ? "UPDATED" : status;

function nextActiveOrder(nodes: readonly { status: DraftStatus; order: number }[]): number {
  let maxOrder = 0;
  for (const node of nodes) {
    if (isActiveDraftNode(node) && node.order > maxOrder) {
      maxOrder = node.order;
    }
  }
  return maxOrder + 1;
}

function makeUniqueCode(baseCode: string, existingCodes: readonly string[]): string {
  const taken = new Set(existingCodes.map((c) => c.trim().toUpperCase()));
  const trimmed = baseCode.trim() || "ITEM";
  if (!taken.has(trimmed.toUpperCase())) return trimmed;

  const candidateBase = `${trimmed}-COPIA`;
  if (!taken.has(candidateBase.toUpperCase())) return candidateBase;

  let index = 2;
  while (taken.has(`${candidateBase}-${index}`.toUpperCase())) {
    index += 1;
  }
  return `${candidateBase}-${index}`;
}

function deleteDraftNode<T extends { id: number | null; draftId: string; status: DraftStatus }>(
  list: readonly T[],
  draftId: string,
): { list: T[]; deleted: T | null } {
  const target = list.find((node) => node.draftId === draftId && isActiveDraftNode(node));
  if (!target) {
    return { list: [...list], deleted: null };
  }
  if (target.id === null || target.status === "CREATED") {
    return {
      list: list.filter((node) => node.draftId !== draftId),
      deleted: target,
    };
  }
  return {
    list: list.map((node) =>
      node.draftId === draftId ? { ...node, status: "DELETED" as const } : node,
    ),
    deleted: target,
  };
}

function moveAndRenumber<T extends { draftId: string; status: DraftStatus; order: number }>(
  list: readonly T[],
  target: { draftId?: string; fromIndex?: number; toIndex: number },
): T[] | null {
  const active = list.filter(isActiveDraftNode);
  const deleted = list.filter((node) => !isActiveDraftNode(node));

  const fromIndex =
    target.draftId !== undefined
      ? active.findIndex((node) => node.draftId === target.draftId)
      : (target.fromIndex ?? -1);

  const { toIndex } = target;
  if (
    fromIndex < 0 ||
    fromIndex >= active.length ||
    toIndex < 0 ||
    toIndex >= active.length ||
    fromIndex === toIndex
  ) {
    return null;
  }

  const reordered = [...active];
  const [moved] = reordered.splice(fromIndex, 1);
  if (!moved) return null;
  reordered.splice(toIndex, 0, moved);

  const renumbered = reordered.map((node, index) => {
    const newOrder = index + 1;
    if (node.order === newOrder) return node;
    return {
      ...node,
      order: newOrder,
      status: markEdited(node.status),
    };
  });

  return [...renumbered, ...deleted];
}

function updateSubtestById(
  doc: VersionDocument,
  subtestDraftId: string,
  updater: (subtest: DocumentSubtest) => DocumentSubtest | null,
): VersionDocument {
  let changed = false;
  const subtests = doc.subtests.map((subtest) => {
    if (subtest.draftId !== subtestDraftId || !isActiveDraftNode(subtest)) {
      return subtest;
    }
    const next = updater(subtest);
    if (!next || next === subtest) return subtest;
    changed = true;
    return next;
  });

  return changed ? withDirtyNodes({ ...doc, subtests }) : doc;
}

function updateItemById(
  doc: VersionDocument,
  subtestDraftId: string,
  itemDraftId: string,
  updater: (item: DocumentItem, subtest: DocumentSubtest) => DocumentItem | null,
): VersionDocument {
  return updateSubtestById(doc, subtestDraftId, (subtest) => {
    let changed = false;
    const items = subtest.items.map((item) => {
      if (item.draftId !== itemDraftId || !isActiveDraftNode(item)) {
        return item;
      }
      const next = updater(item, subtest);
      if (!next || next === item) return item;
      changed = true;
      return next;
    });
    return changed ? { ...subtest, items } : null;
  });
}

function updateOptionById(
  doc: VersionDocument,
  subtestDraftId: string,
  itemDraftId: string,
  optionDraftId: string,
  updater: (option: DocumentOption) => DocumentOption | null,
): VersionDocument {
  return updateItemById(doc, subtestDraftId, itemDraftId, (item) => {
    let changed = false;
    const options = item.options.map((option) => {
      if (option.draftId !== optionDraftId || !isActiveDraftNode(option)) {
        return option;
      }
      const next = updater(option);
      if (!next || next === option) return option;
      changed = true;
      return next;
    });
    return changed ? { ...item, options } : null;
  });
}

function createDocumentImage(
  input: AttachImageInput,
  order: number,
  defaultRole: string | null,
  draftIdFactory: DraftIdFactory,
): DocumentImage {
  const resourceId = input.resourceId ?? null;
  const previewUrl =
    input.previewUrl !== undefined
      ? input.previewUrl
      : resourceId !== null
        ? `/items/images/resources/${resourceId}`
        : null;

  return {
    id: null,
    draftId: input.draftId ?? draftIdFactory("img"),
    sourceId: null,
    resourceId,
    pendingFileId: input.pendingFileId ?? null,
    previewUrl,
    status: "CREATED",
    order: input.order ?? order,
    altText: input.altText ?? "",
    role: input.role !== undefined ? input.role : defaultRole,
    fileName: input.fileName ?? null,
  };
}

function clearKeyOptionReference(answerKey: DocumentAnswerKey | null): DocumentAnswerKey | null {
  if (!answerKey || !isActiveDraftNode(answerKey)) return answerKey;
  if (answerKey.correctOptionDraftId === null && answerKey.correctOptionId === null) {
    return answerKey;
  }
  return {
    ...answerKey,
    status: markEdited(answerKey.status),
    correctOptionDraftId: null,
    correctOptionId: null,
  };
}

function isItemDirty(item: DocumentItem): boolean {
  if (item.status !== "EXISTING") return true;
  if (item.images.some((img) => img.status !== "EXISTING")) return true;
  if (
    item.options.some(
      (opt) => opt.status !== "EXISTING" || opt.images.some((img) => img.status !== "EXISTING"),
    )
  ) {
    return true;
  }
  if (item.answerKey && item.answerKey.status !== "EXISTING") return true;
  return false;
}

function isBaremoDirty(baremo: DocumentBaremo): boolean {
  if (baremo.status !== "EXISTING") return true;
  return baremo.ranges.some((range) => range.status !== "EXISTING");
}

export function getDirtyNodeIds(doc: VersionDocument): string[] {
  const dirty: string[] = [];
  if (doc.version.metaDirty) {
    dirty.push(nodeKeyOf({ kind: "version" }));
  }
  for (const subtest of doc.subtests) {
    if (subtest.status !== "EXISTING") {
      dirty.push(nodeKeyOf({ kind: "subtest", subtestDraftId: subtest.draftId }));
    }
    for (const item of subtest.items) {
      if (isItemDirty(item)) {
        dirty.push(
          nodeKeyOf({
            kind: "item",
            subtestDraftId: subtest.draftId,
            itemDraftId: item.draftId,
          }),
        );
      }
    }
  }
  for (const baremo of doc.baremos) {
    if (isBaremoDirty(baremo)) {
      dirty.push(nodeKeyOf({ kind: "baremos", baremoDraftId: baremo.draftId }));
    }
  }
  return dirty;
}

export function isDocumentDirty(doc: VersionDocument): boolean {
  return doc.version.metaDirty || doc.dirtyNodeIds.length > 0 || getDirtyNodeIds(doc).length > 0;
}

function withDirtyNodes(doc: VersionDocument): VersionDocument {
  return {
    ...doc,
    dirtyNodeIds: getDirtyNodeIds(doc),
  };
}

function markDocumentSaved(doc: VersionDocument, loadedAt?: string): VersionDocument {
  const cleanImage = (img: DocumentImage): DocumentImage => ({ ...img, status: "EXISTING" });

  const subtests: DocumentSubtest[] = doc.subtests
    .filter(isActiveDraftNode)
    .map((subtest) => ({
      ...subtest,
      status: "EXISTING",
      items: subtest.items.filter(isActiveDraftNode).map((item) => ({
        ...item,
        status: "EXISTING",
        images: item.images.filter(isActiveDraftNode).map(cleanImage),
        options: item.options.filter(isActiveDraftNode).map((option) => ({
          ...option,
          status: "EXISTING",
          images: option.images.filter(isActiveDraftNode).map(cleanImage),
        })),
        answerKey:
          item.answerKey && isActiveDraftNode(item.answerKey)
            ? { ...item.answerKey, status: "EXISTING" }
            : null,
      })),
    }));

  const baremos: DocumentBaremo[] = doc.baremos
    .filter(isActiveDraftNode)
    .map((baremo) => ({
      ...baremo,
      status: "EXISTING",
      ranges: baremo.ranges.filter(isActiveDraftNode).map((range) => ({
        ...range,
        status: "EXISTING",
      })),
    }));

  return {
    ...doc,
    version: { ...doc.version, metaDirty: false },
    subtests,
    baremos,
    dirtyNodeIds: [],
    loadedAt: loadedAt ?? doc.loadedAt,
  };
}

function buildClonedSubtest(
  doc: VersionDocument,
  template: SubtestCloneTemplate,
  draftIdFactory: DraftIdFactory,
  codeOverride?: string,
  nameOverride?: string,
): DocumentSubtest {
  const activeSubtests = doc.subtests.filter(isActiveDraftNode);
  const code = codeOverride
    ? codeOverride
    : makeUniqueCode(
        template.code,
        activeSubtests.map((s) => s.code),
      );
  const name = nameOverride ?? template.name;

  const items: DocumentItem[] = template.items.map((tplItem) => {
    const optionDraftIdBySourceId = new Map<number, string>();

    const options: DocumentOption[] = tplItem.options.map((tplOpt) => {
      const optDraftId = draftIdFactory("opt");
      optionDraftIdBySourceId.set(tplOpt.sourceOptionId, optDraftId);
      return {
        id: null,
        draftId: optDraftId,
        sourceId: tplOpt.sourceOptionId,
        status: "CREATED",
        code: tplOpt.code,
        text: tplOpt.text ?? "",
        order: tplOpt.order,
        ordinalValue: tplOpt.ordinalValue,
        images: tplOpt.images.map((tplImg, imgIdx) => ({
          id: null,
          draftId: draftIdFactory("img"),
          sourceId: tplImg.sourceImageId,
          resourceId: tplImg.resourceId,
          pendingFileId: null,
          previewUrl: `/items/images/resources/${tplImg.resourceId}`,
          status: "CREATED",
          order: tplImg.order ?? imgIdx + 1,
          altText: tplImg.altText ?? "",
          role: tplImg.role,
          fileName: null,
          storagePath: tplImg.storagePath,
        })),
      };
    });

    const images: DocumentImage[] = tplItem.images.map((tplImg, imgIdx) => ({
      id: null,
      draftId: draftIdFactory("img"),
      sourceId: tplImg.sourceImageId,
      resourceId: tplImg.resourceId,
      pendingFileId: null,
      previewUrl: `/items/images/resources/${tplImg.resourceId}`,
      status: "CREATED",
      order: tplImg.order ?? imgIdx + 1,
      altText: tplImg.altText ?? "",
      role: tplImg.role,
      fileName: null,
      storagePath: tplImg.storagePath,
    }));

    const tplKey = tplItem.answerKey;
    const mappedCorrectDraftId =
      tplKey?.correctOptionSourceId != null
        ? (optionDraftIdBySourceId.get(tplKey.correctOptionSourceId) ?? null)
        : null;

    const answerKey: DocumentAnswerKey | null = tplKey
      ? {
          id: null,
          draftId: draftIdFactory("key"),
          sourceId: tplKey.sourceAnswerKeyId,
          status: "CREATED",
          ruleId: null,
          correctOptionDraftId: mappedCorrectDraftId,
          correctOptionId: null,
          expectedText: tplKey.expectedText,
          expectedNumber: tplKey.expectedNumber,
          numericTolerance: tplKey.numericTolerance,
          score: tplKey.score,
          requiresManualReview: tplKey.requiresManualReview,
        }
      : null;

    return {
      id: null,
      draftId: draftIdFactory("item"),
      sourceId: tplItem.sourceItemId,
      status: "CREATED",
      code: tplItem.code,
      itemType: tplItem.itemType,
      responseType: tplItem.responseType,
      prompt: tplItem.prompt ?? "",
      instruction: tplItem.instruction ?? "",
      order: tplItem.order,
      baseScore: tplItem.baseScore,
      timeLimitSeconds: tplItem.timeLimitSeconds,
      required: tplItem.required,
      confidential: tplItem.confidential,
      images,
      options,
      answerKey,
    };
  });

  return {
    id: null,
    draftId: draftIdFactory("sub"),
    sourceId: template.sourceSubtestId,
    status: "CREATED",
    code,
    name,
    description: template.description ?? "",
    instructions: template.instructions ?? "",
    order: nextActiveOrder(doc.subtests),
    timeLimitSeconds: template.timeLimitSeconds,
    randomizeItems: doc.version.randomizeItems ? template.randomizeItems : false,
    randomizeOptions: template.randomizeOptions,
    required: template.required,
    strategyId: template.strategyId ?? doc.version.strategyId,
    defaultRuleId: null,
    items,
  };
}

const READONLY_EXEMPT_ACTIONS: ReadonlySet<DocumentAction["type"]> = new Set([
  "LOAD_DOCUMENT",
  "MARK_SAVED",
  "APPLY_SUBTEST_RULE_IDS",
]);

export function documentReducer(
  doc: VersionDocument,
  action: DocumentAction,
  draftIdFactory: DraftIdFactory = createDefaultDraftId,
): VersionDocument {
  if (doc.version.status !== "BORRADOR" && !READONLY_EXEMPT_ACTIONS.has(action.type)) {
    return doc;
  }

  switch (action.type) {
    case "LOAD_DOCUMENT":
      return withDirtyNodes(action.document);

    case "MARK_SAVED":
      return markDocumentSaved(doc, action.loadedAt);

    case "APPLY_SUBTEST_RULE_IDS": {
      let changed = false;
      const subtests = doc.subtests.map((subtest) => {
        const assignedRuleId = action.ruleIdBySubtestDraftId[subtest.draftId];
        if (assignedRuleId === undefined) return subtest;

        let subtestChanged = false;
        const nextDefaultRuleId = subtest.defaultRuleId ?? assignedRuleId;
        if (nextDefaultRuleId !== subtest.defaultRuleId) {
          subtestChanged = true;
        }

        const items = subtest.items.map((item) => {
          if (
            !isActiveDraftNode(item) ||
            !item.answerKey ||
            !isActiveDraftNode(item.answerKey) ||
            item.answerKey.ruleId !== null
          ) {
            return item;
          }
          subtestChanged = true;
          return {
            ...item,
            answerKey: {
              ...item.answerKey,
              ruleId: assignedRuleId,
              status: markEdited(item.answerKey.status),
            },
          };
        });

        if (!subtestChanged) return subtest;
        changed = true;
        return {
          ...subtest,
          defaultRuleId: nextDefaultRuleId,
          items,
        };
      });

      return changed ? withDirtyNodes({ ...doc, subtests }) : doc;
    }

    case "UPDATE_VERSION_META": {
      const nextVersion: DocumentVersionMeta = {
        ...doc.version,
        ...action.patch,
        metaDirty: true,
      };
      let subtests = doc.subtests;
      if (action.patch.randomizeItems === false) {
        subtests = doc.subtests.map((subtest) => {
          if (!isActiveDraftNode(subtest) || !subtest.randomizeItems) return subtest;
          return {
            ...subtest,
            randomizeItems: false,
            status: markEdited(subtest.status),
          };
        });
      }
      return withDirtyNodes({ ...doc, version: nextVersion, subtests });
    }

    case "ADD_SUBTEST": {
      const input = action.input ?? {};
      const order = input.order ?? nextActiveOrder(doc.subtests);
      const newSubtest: DocumentSubtest = {
        id: null,
        draftId: input.draftId ?? draftIdFactory("sub"),
        sourceId: null,
        status: "CREATED",
        code: input.code ?? `SUB-${order}`,
        name: input.name ?? `Subtest ${order}`,
        description: input.description ?? "",
        instructions: input.instructions ?? "",
        order,
        timeLimitSeconds: input.timeLimitSeconds ?? null,
        randomizeItems: doc.version.randomizeItems ? (input.randomizeItems ?? false) : false,
        randomizeOptions: input.randomizeOptions ?? false,
        required: input.required ?? true,
        strategyId: input.strategyId !== undefined ? input.strategyId : doc.version.strategyId,
        defaultRuleId: input.defaultRuleId ?? null,
        items: [],
      };
      return withDirtyNodes({ ...doc, subtests: [...doc.subtests, newSubtest] });
    }

    case "UPDATE_SUBTEST":
      return updateSubtestById(doc, action.subtestDraftId, (subtest) => {
        const nextRandomizeItems =
          action.patch.randomizeItems !== undefined
            ? doc.version.randomizeItems
              ? action.patch.randomizeItems
              : false
            : subtest.randomizeItems;

        return {
          ...subtest,
          ...action.patch,
          randomizeItems: nextRandomizeItems,
          status: markEdited(subtest.status),
        };
      });

    case "DELETE_SUBTEST": {
      const { list, deleted } = deleteDraftNode(doc.subtests, action.subtestDraftId);
      if (!deleted) return doc;
      return withDirtyNodes({ ...doc, subtests: list });
    }

    case "MOVE_SUBTEST": {
      const moved = moveAndRenumber(
        doc.subtests,
        "subtestDraftId" in action
          ? { draftId: action.subtestDraftId, toIndex: action.toIndex }
          : { fromIndex: action.fromIndex, toIndex: action.toIndex },
      );
      return moved ? withDirtyNodes({ ...doc, subtests: moved }) : doc;
    }

    case "IMPORT_SUBTEST_CLONE": {
      const cloned = buildClonedSubtest(
        doc,
        action.template,
        draftIdFactory,
        action.codeOverride,
        action.nameOverride,
      );
      return withDirtyNodes({ ...doc, subtests: [...doc.subtests, cloned] });
    }

    case "ADD_ITEM":
      return updateSubtestById(doc, action.subtestDraftId, (subtest) => {
        const input = action.input ?? {};
        const order = input.order ?? nextActiveOrder(subtest.items);
        const code =
          input.code ??
          makeUniqueCode(
            `IT-${order}`,
            subtest.items.filter(isActiveDraftNode).map((i) => i.code),
          );

        const baseItem: DocumentItem = action.templateId
          ? createItemFromTemplate(action.templateId, {
              code,
              order,
              draftIdFactory,
              defaultRuleId: subtest.defaultRuleId,
            })
          : {
              id: null,
              draftId: draftIdFactory("item"),
              sourceId: null,
              status: "CREATED",
              code,
              itemType: "SOLO_TEXTO",
              responseType: "OPCION_UNICA",
              prompt: "",
              instruction: "",
              order,
              baseScore: 1,
              timeLimitSeconds: null,
              required: true,
              confidential: true,
              images: [],
              options: [],
              answerKey: null,
            };

        const item: DocumentItem = {
          ...baseItem,
          draftId: input.draftId ?? baseItem.draftId,
          code: input.code ?? baseItem.code,
          itemType: input.itemType ?? baseItem.itemType,
          responseType: input.responseType ?? baseItem.responseType,
          prompt: input.prompt ?? baseItem.prompt,
          instruction: input.instruction ?? baseItem.instruction,
          order,
          baseScore: input.baseScore ?? baseItem.baseScore,
          timeLimitSeconds:
            input.timeLimitSeconds !== undefined
              ? input.timeLimitSeconds
              : baseItem.timeLimitSeconds,
          required: input.required ?? baseItem.required,
          confidential: input.confidential ?? baseItem.confidential,
        };

        return { ...subtest, items: [...subtest.items, item] };
      });

    case "DUPLICATE_ITEM":
      return updateSubtestById(doc, action.subtestDraftId, (subtest) => {
        const source = subtest.items.find(
          (i) => i.draftId === action.itemDraftId && isActiveDraftNode(i),
        );
        if (!source) return null;

        const optionDraftMap = new Map<string, string>();
        const optionIdMap = new Map<number, string>();

        const activeOptions = source.options.filter(isActiveDraftNode);
        const clonedOptions: DocumentOption[] = activeOptions.map((opt) => {
          const newDraftId = draftIdFactory("opt");
          optionDraftMap.set(opt.draftId, newDraftId);
          if (opt.id !== null) optionIdMap.set(opt.id, newDraftId);

          return {
            ...opt,
            id: null,
            draftId: newDraftId,
            sourceId: opt.id,
            status: "CREATED",
            images: opt.images.filter(isActiveDraftNode).map((img) => ({
              ...img,
              id: null,
              draftId: draftIdFactory("img"),
              sourceId: img.id,
              status: "CREATED",
            })),
          };
        });

        const clonedImages: DocumentImage[] = source.images
          .filter(isActiveDraftNode)
          .map((img) => ({
            ...img,
            id: null,
            draftId: draftIdFactory("img"),
            sourceId: img.id,
            status: "CREATED",
          }));

        let clonedKey: DocumentAnswerKey | null = null;
        if (source.answerKey && isActiveDraftNode(source.answerKey)) {
          const srcKey = source.answerKey;
          const mappedOptDraftId =
            (srcKey.correctOptionDraftId !== null
              ? optionDraftMap.get(srcKey.correctOptionDraftId)
              : undefined) ??
            (srcKey.correctOptionId !== null
              ? optionIdMap.get(srcKey.correctOptionId)
              : undefined) ??
            null;

          clonedKey = {
            ...srcKey,
            id: null,
            draftId: draftIdFactory("key"),
            sourceId: srcKey.id,
            status: "CREATED",
            correctOptionDraftId: mappedOptDraftId,
            correctOptionId: null,
          };
        }

        const duplicated: DocumentItem = {
          ...source,
          id: null,
          draftId: draftIdFactory("item"),
          sourceId: source.id,
          status: "CREATED",
          code: makeUniqueCode(
            source.code,
            subtest.items.filter(isActiveDraftNode).map((i) => i.code),
          ),
          order: nextActiveOrder(subtest.items),
          images: clonedImages,
          options: clonedOptions,
          answerKey: clonedKey,
        };

        return { ...subtest, items: [...subtest.items, duplicated] };
      });

    case "UPDATE_ITEM":
      return updateItemById(doc, action.subtestDraftId, action.itemDraftId, (item) => {
        const nextResponseType = action.patch.responseType ?? item.responseType;
        const shouldClearOptionRef = !OPTION_RESPONSE_TYPES.has(nextResponseType);
        return {
          ...item,
          ...action.patch,
          status: markEdited(item.status),
          answerKey: shouldClearOptionRef
            ? clearKeyOptionReference(item.answerKey)
            : item.answerKey,
        };
      });

    case "DELETE_ITEM":
      return updateSubtestById(doc, action.subtestDraftId, (subtest) => {
        const { list, deleted } = deleteDraftNode(subtest.items, action.itemDraftId);
        if (!deleted) return null;
        return { ...subtest, items: list };
      });

    case "MOVE_ITEM":
      return updateSubtestById(doc, action.subtestDraftId, (subtest) => {
        const moved = moveAndRenumber(
          subtest.items,
          "itemDraftId" in action
            ? { draftId: action.itemDraftId, toIndex: action.toIndex }
            : { fromIndex: action.fromIndex, toIndex: action.toIndex },
        );
        return moved ? { ...subtest, items: moved } : null;
      });

    case "ADD_OPTION":
      return updateItemById(doc, action.subtestDraftId, action.itemDraftId, (item) => {
        const input = action.input ?? {};
        const order = input.order ?? nextActiveOrder(item.options);
        const defaultLetter = String.fromCharCode(64 + Math.min(26, Math.max(1, order)));
        const newOption: DocumentOption = {
          id: null,
          draftId: input.draftId ?? draftIdFactory("opt"),
          sourceId: null,
          status: "CREATED",
          code: input.code ?? defaultLetter,
          text: input.text ?? "",
          order,
          ordinalValue: input.ordinalValue !== undefined ? input.ordinalValue : order,
          images: [],
        };
        return { ...item, options: [...item.options, newOption] };
      });

    case "UPDATE_OPTION":
      return updateOptionById(
        doc,
        action.subtestDraftId,
        action.itemDraftId,
        action.optionDraftId,
        (option) => ({
          ...option,
          ...action.patch,
          status: markEdited(option.status),
        }),
      );

    case "DELETE_OPTION":
      return updateItemById(doc, action.subtestDraftId, action.itemDraftId, (item) => {
        const { list, deleted } = deleteDraftNode(item.options, action.optionDraftId);
        if (!deleted) return null;

        let nextKey = item.answerKey;
        if (nextKey && isActiveDraftNode(nextKey)) {
          const matchesDeleted =
            nextKey.correctOptionDraftId === deleted.draftId ||
            (deleted.id !== null && nextKey.correctOptionId === deleted.id);
          if (matchesDeleted) {
            nextKey = clearKeyOptionReference(nextKey);
          }
        }

        return { ...item, options: list, answerKey: nextKey };
      });

    case "MOVE_OPTION":
      return updateItemById(doc, action.subtestDraftId, action.itemDraftId, (item) => {
        const moved = moveAndRenumber(
          item.options,
          "optionDraftId" in action
            ? { draftId: action.optionDraftId, toIndex: action.toIndex }
            : { fromIndex: action.fromIndex, toIndex: action.toIndex },
        );
        return moved ? { ...item, options: moved } : null;
      });

    case "SET_CORRECT_OPTION":
      return updateItemById(doc, action.subtestDraftId, action.itemDraftId, (item, subtest) => {
        const option = item.options.find(
          (o) => o.draftId === action.optionDraftId && isActiveDraftNode(o),
        );
        if (!option) return null;

        const existingKey = item.answerKey;
        if (!existingKey) {
          const createdKey: DocumentAnswerKey = {
            id: null,
            draftId: draftIdFactory("key"),
            sourceId: null,
            status: "CREATED",
            ruleId: subtest.defaultRuleId,
            correctOptionDraftId: option.draftId,
            correctOptionId: option.id,
            expectedText: null,
            expectedNumber: null,
            numericTolerance: null,
            score: item.baseScore,
            requiresManualReview: false,
          };
          return { ...item, answerKey: createdKey };
        }

        const nextStatus: DraftStatus =
          existingKey.status === "DELETED"
            ? existingKey.id !== null
              ? "UPDATED"
              : "CREATED"
            : markEdited(existingKey.status);

        return {
          ...item,
          answerKey: {
            ...existingKey,
            status: nextStatus,
            correctOptionDraftId: option.draftId,
            correctOptionId: option.id,
            requiresManualReview: false,
          },
        };
      });

    case "UPDATE_ANSWER_KEY":
      return updateItemById(doc, action.subtestDraftId, action.itemDraftId, (item, subtest) => {
        const existingKey = item.answerKey;
        if (!existingKey) {
          const createdKey: DocumentAnswerKey = {
            id: null,
            draftId: draftIdFactory("key"),
            sourceId: null,
            status: "CREATED",
            ruleId: subtest.defaultRuleId,
            correctOptionDraftId: null,
            correctOptionId: null,
            expectedText: null,
            expectedNumber: null,
            numericTolerance: null,
            score: item.baseScore,
            requiresManualReview: false,
            ...action.patch,
          };
          return { ...item, answerKey: createdKey };
        }

        const nextStatus: DraftStatus =
          existingKey.status === "DELETED"
            ? existingKey.id !== null
              ? "UPDATED"
              : "CREATED"
            : markEdited(existingKey.status);

        return {
          ...item,
          answerKey: {
            ...existingKey,
            ...action.patch,
            status: nextStatus,
          },
        };
      });

    case "CLEAR_ANSWER_KEY":
      return updateItemById(doc, action.subtestDraftId, action.itemDraftId, (item) => {
        if (!item.answerKey) return null;
        if (item.answerKey.id === null || item.answerKey.status === "CREATED") {
          return { ...item, answerKey: null };
        }
        if (item.answerKey.status === "DELETED") return null;
        return {
          ...item,
          answerKey: {
            ...item.answerKey,
            status: "DELETED",
            correctOptionDraftId: null,
            correctOptionId: null,
          },
        };
      });

    case "ATTACH_ITEM_IMAGE":
      return updateItemById(doc, action.subtestDraftId, action.itemDraftId, (item) => {
        const defaultRole =
          item.itemType === "COMPARACION_IMAGENES" ? "ESTIMULO" : "ENUNCIADO";
        const newImage = createDocumentImage(
          action.image,
          nextActiveOrder(item.images),
          defaultRole,
          draftIdFactory,
        );
        return { ...item, images: [...item.images, newImage] };
      });

    case "UPDATE_ITEM_IMAGE":
      return updateItemById(doc, action.subtestDraftId, action.itemDraftId, (item) => {
        let changed = false;
        const images = item.images.map((img) => {
          if (img.draftId !== action.imageDraftId || !isActiveDraftNode(img)) return img;
          changed = true;
          const nextResourceId =
            action.patch.resourceId !== undefined ? action.patch.resourceId : img.resourceId;
          const nextPreviewUrl =
            action.patch.previewUrl !== undefined
              ? action.patch.previewUrl
              : nextResourceId !== null && action.patch.resourceId !== undefined
                ? `/items/images/resources/${nextResourceId}`
                : img.previewUrl;
          return {
            ...img,
            ...action.patch,
            previewUrl: nextPreviewUrl,
            status: markEdited(img.status),
          };
        });
        return changed ? { ...item, images } : null;
      });

    case "DELETE_ITEM_IMAGE":
      return updateItemById(doc, action.subtestDraftId, action.itemDraftId, (item) => {
        const { list, deleted } = deleteDraftNode(item.images, action.imageDraftId);
        return deleted ? { ...item, images: list } : null;
      });

    case "ATTACH_OPTION_IMAGE":
      return updateOptionById(
        doc,
        action.subtestDraftId,
        action.itemDraftId,
        action.optionDraftId,
        (option) => {
          const newImage = createDocumentImage(
            action.image,
            nextActiveOrder(option.images),
            null,
            draftIdFactory,
          );
          return { ...option, images: [...option.images, newImage] };
        },
      );

    case "UPDATE_OPTION_IMAGE":
      return updateOptionById(
        doc,
        action.subtestDraftId,
        action.itemDraftId,
        action.optionDraftId,
        (option) => {
          let changed = false;
          const images = option.images.map((img) => {
            if (img.draftId !== action.imageDraftId || !isActiveDraftNode(img)) return img;
            changed = true;
            const nextResourceId =
              action.patch.resourceId !== undefined ? action.patch.resourceId : img.resourceId;
            const nextPreviewUrl =
              action.patch.previewUrl !== undefined
                ? action.patch.previewUrl
                : nextResourceId !== null && action.patch.resourceId !== undefined
                  ? `/items/images/resources/${nextResourceId}`
                  : img.previewUrl;
            return {
              ...img,
              ...action.patch,
              previewUrl: nextPreviewUrl,
              status: markEdited(img.status),
            };
          });
          return changed ? { ...option, images } : null;
        },
      );

    case "DELETE_OPTION_IMAGE":
      return updateOptionById(
        doc,
        action.subtestDraftId,
        action.itemDraftId,
        action.optionDraftId,
        (option) => {
          const { list, deleted } = deleteDraftNode(option.images, action.imageDraftId);
          return deleted ? { ...option, images: list } : null;
        },
      );

    case "ADD_BAREMO": {
      const input = action.input ?? {};
      const activeCount = doc.baremos.filter(isActiveDraftNode).length + 1;
      const newBaremo: DocumentBaremo = {
        id: null,
        draftId: input.draftId ?? draftIdFactory("bar"),
        status: "CREATED",
        dimensionId: input.dimensionId ?? null,
        code: input.code ?? `BAR-${activeCount}`,
        name: input.name ?? `Baremo ${activeCount}`,
        description: input.description ?? "",
        normativeGroup: input.normativeGroup ?? "General",
        ranges: [],
      };
      return withDirtyNodes({ ...doc, baremos: [...doc.baremos, newBaremo] });
    }

    case "UPDATE_BAREMO": {
      let changed = false;
      const baremos = doc.baremos.map((baremo) => {
        if (baremo.draftId !== action.baremoDraftId || !isActiveDraftNode(baremo)) {
          return baremo;
        }
        changed = true;
        return {
          ...baremo,
          ...action.patch,
          status: markEdited(baremo.status),
        };
      });
      return changed ? withDirtyNodes({ ...doc, baremos }) : doc;
    }

    case "DELETE_BAREMO": {
      const { list, deleted } = deleteDraftNode(doc.baremos, action.baremoDraftId);
      if (!deleted) return doc;
      return withDirtyNodes({ ...doc, baremos: list });
    }

    case "ADD_BAREMO_RANGE": {
      let changed = false;
      const baremos = doc.baremos.map((baremo) => {
        if (baremo.draftId !== action.baremoDraftId || !isActiveDraftNode(baremo)) {
          return baremo;
        }
        changed = true;
        const input = action.input ?? {};
        const order = input.order ?? nextActiveOrder(baremo.ranges);
        const newRange: DocumentBaremoRange = {
          id: null,
          draftId: input.draftId ?? draftIdFactory("rng"),
          status: "CREATED",
          minScore: input.minScore ?? 0,
          maxScore: input.maxScore ?? 0,
          percentile: input.percentile !== undefined ? input.percentile : null,
          category: input.category ?? "",
          interpretation: input.interpretation ?? "",
          recommendation: input.recommendation ?? "",
          order,
        };
        return { ...baremo, ranges: [...baremo.ranges, newRange] };
      });
      return changed ? withDirtyNodes({ ...doc, baremos }) : doc;
    }

    case "UPDATE_BAREMO_RANGE": {
      let changed = false;
      const baremos = doc.baremos.map((baremo) => {
        if (baremo.draftId !== action.baremoDraftId || !isActiveDraftNode(baremo)) {
          return baremo;
        }
        const ranges = baremo.ranges.map((range) => {
          if (range.draftId !== action.rangeDraftId || !isActiveDraftNode(range)) {
            return range;
          }
          changed = true;
          return {
            ...range,
            ...action.patch,
            status: markEdited(range.status),
          };
        });
        return changed ? { ...baremo, ranges } : baremo;
      });
      return changed ? withDirtyNodes({ ...doc, baremos }) : doc;
    }

    case "DELETE_BAREMO_RANGE": {
      let changed = false;
      const baremos = doc.baremos.map((baremo) => {
        if (baremo.draftId !== action.baremoDraftId || !isActiveDraftNode(baremo)) {
          return baremo;
        }
        const { list, deleted } = deleteDraftNode(baremo.ranges, action.rangeDraftId);
        if (!deleted) return baremo;
        changed = true;
        return { ...baremo, ranges: list };
      });
      return changed ? withDirtyNodes({ ...doc, baremos }) : doc;
    }

    case "REVERT_REORDERING": {
      const subtests = revertListOrder(
        doc.subtests,
        action.baseline.subtests,
        hasSubtestNonOrderChanges,
        (subtest, baseSub) => ({
          ...subtest,
          items: revertListOrder(
            subtest.items,
            baseSub.items,
            hasItemNonOrderChanges,
            (item, baseItem) => ({
              ...item,
              options: revertListOrder(item.options, baseItem.options, hasOptionNonOrderChanges),
            }),
          ),
        }),
      );
      return withDirtyNodes({ ...doc, subtests });
    }
  }
}

function hasSubtestNonOrderChanges(current: DocumentSubtest, base: DocumentSubtest): boolean {
  return (
    current.code !== base.code ||
    current.name !== base.name ||
    current.description !== base.description ||
    current.instructions !== base.instructions ||
    current.timeLimitSeconds !== base.timeLimitSeconds ||
    current.randomizeItems !== base.randomizeItems ||
    current.randomizeOptions !== base.randomizeOptions ||
    current.required !== base.required ||
    current.strategyId !== base.strategyId
  );
}

function hasItemNonOrderChanges(current: DocumentItem, base: DocumentItem): boolean {
  return (
    current.code !== base.code ||
    current.itemType !== base.itemType ||
    current.responseType !== base.responseType ||
    current.prompt !== base.prompt ||
    current.instruction !== base.instruction ||
    current.baseScore !== base.baseScore ||
    current.timeLimitSeconds !== base.timeLimitSeconds ||
    current.required !== base.required ||
    current.confidential !== base.confidential
  );
}

function hasOptionNonOrderChanges(current: DocumentOption, base: DocumentOption): boolean {
  return (
    current.code !== base.code ||
    current.text !== base.text ||
    current.ordinalValue !== base.ordinalValue
  );
}

function revertListOrder<T extends { id: number | null; status: DraftStatus; order: number }>(
  list: readonly T[],
  baselineList: readonly T[],
  hasNonOrderChanges: (current: T, base: T) => boolean,
  transformMatched?: (current: T, base: T) => T,
): T[] {
  const baseById = new Map<number, T>();
  let maxBaseOrder = 0;
  for (const base of baselineList) {
    if (isActiveDraftNode(base) && base.id !== null) {
      baseById.set(base.id, base);
      if (base.order > maxBaseOrder) maxBaseOrder = base.order;
    }
  }

  let nextCreatedOrder = maxBaseOrder;
  const active: T[] = [];
  const deleted: T[] = [];

  for (const node of list) {
    if (!isActiveDraftNode(node)) {
      deleted.push(node);
      continue;
    }
    if (node.id !== null && baseById.has(node.id)) {
      const base = baseById.get(node.id)!;
      const updatedNode = transformMatched ? transformMatched(node, base) : node;
      const nextStatus: DraftStatus =
        updatedNode.status === "UPDATED" && !hasNonOrderChanges(updatedNode, base)
          ? "EXISTING"
          : updatedNode.status;
      active.push({ ...updatedNode, order: base.order, status: nextStatus });
    } else {
      nextCreatedOrder += 1;
      active.push({ ...node, order: nextCreatedOrder });
    }
  }

  active.sort((a, b) => a.order - b.order);
  return [...active, ...deleted];
}

function collectLevelOrderCollisions<
  T extends { id: number | null; draftId: string; status: DraftStatus; code: string; order: number },
>(currentList: readonly T[], baselineList: readonly T[]): OrderCollisionEntry[] {
  const baseOrderById = new Map<number, number>();
  const occupiedOrders = new Map<number, number>();
  for (const base of baselineList) {
    if (isActiveDraftNode(base) && base.id !== null) {
      baseOrderById.set(base.id, base.order);
      occupiedOrders.set(base.order, base.id);
    }
  }

  const entries: OrderCollisionEntry[] = [];
  for (const node of currentList) {
    if (!isActiveDraftNode(node)) continue;
    if (node.id !== null) {
      const baseOrder = baseOrderById.get(node.id);
      if (baseOrder === undefined || node.order === baseOrder) continue;
      const occupantId = occupiedOrders.get(node.order);
      if (occupantId !== undefined && occupantId !== node.id) {
        entries.push({
          draftId: node.draftId,
          id: node.id,
          code: node.code,
          fromOrder: baseOrder,
          toOrder: node.order,
        });
      }
    } else {
      const occupantId = occupiedOrders.get(node.order);
      if (occupantId !== undefined) {
        entries.push({
          draftId: node.draftId,
          id: -1,
          code: node.code,
          fromOrder: -1,
          toOrder: node.order,
        });
      }
    }
  }
  return entries;
}

/**
 * Detecta permutaciones o reordenamientos entre posiciones ocupadas por registros
 * ya persistidos que colisionan bajo las restricciones UNIQUE inmediatas del backend (B18).
 */
export function detectOrderCollisions(
  doc: VersionDocument,
  baseline: VersionDocument | null,
): OrderCollision[] {
  if (!baseline) return [];
  const collisions: OrderCollision[] = [];

  const subtestEntries = collectLevelOrderCollisions(doc.subtests, baseline.subtests);
  if (subtestEntries.length > 0) {
    const node: DocumentNodeRef = { kind: "version" };
    collisions.push({
      level: "subtest",
      node,
      nodeKey: nodeKeyOf(node),
      label: "Subtests de la versión",
      entries: subtestEntries,
    });
  }

  const baseSubtestById = new Map<number, DocumentSubtest>();
  for (const baseSub of baseline.subtests) {
    if (isActiveDraftNode(baseSub) && baseSub.id !== null) {
      baseSubtestById.set(baseSub.id, baseSub);
    }
  }

  for (const subtest of doc.subtests) {
    if (!isActiveDraftNode(subtest) || subtest.id === null) continue;
    const baseSub = baseSubtestById.get(subtest.id);
    if (!baseSub) continue;

    const itemEntries = collectLevelOrderCollisions(subtest.items, baseSub.items);
    if (itemEntries.length > 0) {
      const node: DocumentNodeRef = { kind: "subtest", subtestDraftId: subtest.draftId };
      collisions.push({
        level: "item",
        node,
        nodeKey: nodeKeyOf(node),
        label: `Ítems de ${subtest.name || subtest.code}`,
        entries: itemEntries,
      });
    }

    const baseItemById = new Map<number, DocumentItem>();
    for (const baseItem of baseSub.items) {
      if (isActiveDraftNode(baseItem) && baseItem.id !== null) {
        baseItemById.set(baseItem.id, baseItem);
      }
    }

    for (const item of subtest.items) {
      if (!isActiveDraftNode(item) || item.id === null) continue;
      const baseItem = baseItemById.get(item.id);
      if (!baseItem) continue;

      const optionEntries = collectLevelOrderCollisions(item.options, baseItem.options);
      if (optionEntries.length > 0) {
        const node: DocumentNodeRef = {
          kind: "item",
          subtestDraftId: subtest.draftId,
          itemDraftId: item.draftId,
        };
        collisions.push({
          level: "option",
          node,
          nodeKey: nodeKeyOf(node),
          label: `Opciones de ${item.code}`,
          entries: optionEntries,
        });
      }
    }
  }

  return collisions;
}

export function createDocumentReducer(
  draftIdFactory: DraftIdFactory,
): (doc: VersionDocument, action: DocumentAction) => VersionDocument {
  return (doc, action) => documentReducer(doc, action, draftIdFactory);
}
