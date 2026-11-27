import type {
  AnswerKeyDraft,
  ImageDraft,
  ItemDraft,
  OptionDraft,
  SubtestDraft,
  VersionConfigurationPayload,
} from "../../../api/schemas/instruments";
import {
  createDefaultDraftId,
  type DocumentAnswerKey,
  type DocumentImage,
  type DocumentItem,
  type DocumentOption,
  type DocumentSubtest,
  type DraftIdFactory,
  isActiveDraftNode,
  type VersionDocument,
} from "./types";

export interface BuildConfigurationDiffOptions {
  omitAnswerKeysWithoutRuleId?: boolean;
  includeAllActiveSubtests?: boolean;
  omitDeletedItemImages?: boolean;
}

export interface BuildCloneConfigurationOptions {
  ruleIdBySubtestDraftId?: Record<string, number>;
  omitAnswerKeysWithoutRuleId?: boolean;
  draftIdFactory?: DraftIdFactory;
}

export interface PendingImageUpload {
  ownerKind: "item" | "option";
  subtestDraftId: string;
  itemDraftId: string;
  optionDraftId: string | null;
  imageDraftId: string;
  pendingFileId: string;
  replaceByOrder: boolean;
  order: number;
  altText: string;
  role: string | null;
  fileName: string | null;
}

function toImageDraft(image: DocumentImage): ImageDraft | null {
  if (image.status === "DELETED") {
    if (image.id === null) return null;
    return {
      id: image.id,
      draftId: image.draftId,
      sourceId: image.sourceId,
      resourceId: image.resourceId,
      status: "DELETED",
      order: image.order,
      altText: image.altText,
      role: image.role,
    };
  }

  if (image.resourceId === null) {
    return null;
  }

  return {
    id: image.id,
    draftId: image.draftId,
    sourceId: image.sourceId,
    resourceId: image.resourceId,
    status: image.status,
    order: image.order,
    altText: image.altText,
    role: image.role,
  };
}

function collectImageDrafts(
  images: readonly DocumentImage[],
  includeAllActive: boolean,
  omitDeleted = false,
): ImageDraft[] {
  const result: ImageDraft[] = [];
  for (const img of images) {
    if (omitDeleted && img.status === "DELETED") continue;
    if (!includeAllActive && img.status === "EXISTING") continue;
    const draft = toImageDraft(img);
    if (draft) result.push(draft);
  }
  return result;
}

function toOptionDraft(option: DocumentOption, images: ImageDraft[]): OptionDraft {
  if (option.status === "DELETED") {
    return {
      id: option.id,
      draftId: option.draftId,
      sourceId: option.sourceId,
      status: "DELETED",
    };
  }
  return {
    id: option.id,
    draftId: option.draftId,
    sourceId: option.sourceId,
    status: option.status,
    code: option.code,
    text: option.text,
    order: option.order,
    ordinalValue: option.ordinalValue,
    images,
  };
}

function buildItemDiff(
  item: DocumentItem,
  subtest: DocumentSubtest,
  options: BuildConfigurationDiffOptions,
): ItemDraft | null {
  if (item.status === "DELETED") {
    if (item.id === null) return null;
    return {
      id: item.id,
      draftId: item.draftId,
      sourceId: item.sourceId,
      status: "DELETED",
    };
  }

  const includeAll = options.includeAllActiveSubtests === true;

  const itemImages = collectImageDrafts(
    item.images,
    includeAll,
    options.omitDeletedItemImages === true,
  );

  const optionDraftMap = new Map<string, OptionDraft>();
  const optionOrder: string[] = [];

  for (const opt of item.options) {
    if (opt.status === "DELETED") {
      if (opt.id !== null) {
        optionDraftMap.set(opt.draftId, toOptionDraft(opt, []));
        optionOrder.push(opt.draftId);
      }
      continue;
    }

    const dirtyOptImages = collectImageDrafts(opt.images, includeAll);
    if (includeAll || opt.status !== "EXISTING" || dirtyOptImages.length > 0) {
      optionDraftMap.set(opt.draftId, toOptionDraft(opt, dirtyOptImages));
      optionOrder.push(opt.draftId);
    }
  }

  let answerKeyDraft: AnswerKeyDraft | undefined;
  const key = item.answerKey;
  if (key !== null) {
    if (key.status === "DELETED") {
      if (key.id !== null) {
        answerKeyDraft = {
          id: key.id,
          draftId: key.draftId,
          sourceId: key.sourceId,
          status: "DELETED",
        };
      }
    } else if (includeAll || key.status !== "EXISTING") {
      const effectiveRuleId = key.ruleId ?? subtest.defaultRuleId;
      if (effectiveRuleId !== null || !options.omitAnswerKeysWithoutRuleId) {
        const targetOption = findReferencedActiveOption(item, key);
        let correctOptionDraftId: string | null = null;
        let correctOptionId: number | null = key.correctOptionId;

        if (targetOption) {
          if (optionDraftMap.has(targetOption.draftId)) {
            correctOptionDraftId = targetOption.draftId;
            correctOptionId = null;
          } else if (targetOption.id !== null) {
            correctOptionDraftId = null;
            correctOptionId = targetOption.id;
          } else {
            const activeTargetImages = collectImageDrafts(targetOption.images, true);
            optionDraftMap.set(targetOption.draftId, toOptionDraft(targetOption, activeTargetImages));
            optionOrder.push(targetOption.draftId);
            correctOptionDraftId = targetOption.draftId;
            correctOptionId = null;
          }
        } else if (key.correctOptionDraftId !== null) {
          // Si apuntaba a una opción que ya no está activa, evitar referencia colgante.
          correctOptionDraftId = null;
        }

        answerKeyDraft = {
          id: key.id,
          draftId: key.draftId,
          sourceId: key.sourceId,
          status: key.status,
          ruleId: effectiveRuleId,
          correctOptionDraftId,
          correctOptionId,
          expectedText: key.expectedText,
          expectedNumber: key.expectedNumber,
          numericTolerance: key.numericTolerance,
          score: key.score,
          requiresManualReview: key.requiresManualReview,
        };
      }
    }
  }

  const emittedOptions = optionOrder
    .map((draftId) => optionDraftMap.get(draftId))
    .filter((opt): opt is OptionDraft => opt !== undefined);

  const hasChanges =
    includeAll ||
    item.status !== "EXISTING" ||
    itemImages.length > 0 ||
    emittedOptions.length > 0 ||
    answerKeyDraft !== undefined;

  if (!hasChanges) return null;

  return {
    id: item.id,
    draftId: item.draftId,
    sourceId: item.sourceId,
    status: item.status,
    code: item.code,
    itemType: item.itemType,
    responseType: item.responseType,
    prompt: item.prompt,
    instruction: item.instruction,
    order: item.order,
    baseScore: item.baseScore,
    timeLimitSeconds: item.timeLimitSeconds,
    required: item.required,
    confidential: item.confidential,
    images: itemImages,
    options: emittedOptions,
    ...(answerKeyDraft !== undefined ? { answerKey: answerKeyDraft } : {}),
  };
}

function findReferencedActiveOption(
  item: DocumentItem,
  key: DocumentAnswerKey,
): DocumentOption | undefined {
  const activeOptions = item.options.filter(isActiveDraftNode);
  if (key.correctOptionDraftId !== null) {
    return activeOptions.find((opt) => opt.draftId === key.correctOptionDraftId);
  }
  if (key.correctOptionId !== null) {
    return activeOptions.find((opt) => opt.id === key.correctOptionId);
  }
  return undefined;
}

export function buildConfigurationDiff(
  doc: VersionDocument,
  options: BuildConfigurationDiffOptions = {},
): VersionConfigurationPayload {
  const includeAll = options.includeAllActiveSubtests === true;
  const subtests: SubtestDraft[] = [];

  for (const subtest of doc.subtests) {
    if (subtest.status === "DELETED") {
      if (subtest.id !== null) {
        subtests.push({
          id: subtest.id,
          draftId: subtest.draftId,
          sourceId: subtest.sourceId,
          status: "DELETED",
        });
      }
      continue;
    }

    const items: ItemDraft[] = [];
    for (const item of subtest.items) {
      const itemDiff = buildItemDiff(item, subtest, options);
      if (itemDiff) items.push(itemDiff);
    }

    const hasChanges = includeAll || subtest.status !== "EXISTING" || items.length > 0;
    if (!hasChanges) continue;

    subtests.push({
      id: subtest.id,
      draftId: subtest.draftId,
      sourceId: subtest.sourceId,
      status: subtest.status,
      code: subtest.code,
      name: subtest.name,
      description: subtest.description,
      instructions: subtest.instructions,
      order: subtest.order,
      timeLimitSeconds: subtest.timeLimitSeconds,
      randomizeItems: doc.version.randomizeItems ? subtest.randomizeItems : false,
      randomizeOptions: subtest.randomizeOptions,
      required: subtest.required,
      strategyId: subtest.strategyId,
      items,
    });
  }

  return { subtests };
}

export function collectPendingImageUploads(doc: VersionDocument): PendingImageUpload[] {
  const pending: PendingImageUpload[] = [];

  for (const subtest of doc.subtests) {
    if (!isActiveDraftNode(subtest)) continue;
    for (const item of subtest.items) {
      if (!isActiveDraftNode(item)) continue;

      for (const img of item.images) {
        if (isActiveDraftNode(img) && img.resourceId === null && img.pendingFileId !== null) {
          pending.push({
            ownerKind: "item",
            subtestDraftId: subtest.draftId,
            itemDraftId: item.draftId,
            optionDraftId: null,
            imageDraftId: img.draftId,
            pendingFileId: img.pendingFileId,
            replaceByOrder: img.id !== null,
            order: img.order,
            altText: img.altText,
            role: img.role,
            fileName: img.fileName,
          });
        }
      }

      for (const option of item.options) {
        if (!isActiveDraftNode(option)) continue;
        for (const img of option.images) {
          if (isActiveDraftNode(img) && img.resourceId === null && img.pendingFileId !== null) {
            pending.push({
              ownerKind: "option",
              subtestDraftId: subtest.draftId,
              itemDraftId: item.draftId,
              optionDraftId: option.draftId,
              imageDraftId: img.draftId,
              pendingFileId: img.pendingFileId,
              replaceByOrder: img.id !== null,
              order: img.order,
              altText: img.altText,
              role: img.role,
              fileName: img.fileName,
            });
          }
        }
      }
    }
  }

  return pending;
}

export function collectSubtestsNeedingScoringRule(doc: VersionDocument): DocumentSubtest[] {
  const needing: DocumentSubtest[] = [];
  for (const subtest of doc.subtests) {
    if (!isActiveDraftNode(subtest)) continue;
    if (subtest.defaultRuleId !== null) continue;

    const hasKeyWithoutRule = subtest.items.some(
      (item) =>
        isActiveDraftNode(item) &&
        item.answerKey !== null &&
        isActiveDraftNode(item.answerKey) &&
        item.answerKey.ruleId === null,
    );
    if (hasKeyWithoutRule) {
      needing.push(subtest);
    }
  }
  return needing;
}

export function buildCloneConfiguration(
  doc: VersionDocument,
  options: BuildCloneConfigurationOptions = {},
): VersionConfigurationPayload {
  const makeId = options.draftIdFactory ?? createDefaultDraftId;
  const subtests: SubtestDraft[] = [];

  for (const subtest of doc.subtests) {
    if (!isActiveDraftNode(subtest)) continue;

    const clonedSubtestDraftId = makeId("sub");
    const items: ItemDraft[] = [];

    for (const item of subtest.items) {
      if (!isActiveDraftNode(item)) continue;

      const clonedItemDraftId = makeId("item");
      const optionDraftByOldDraftId = new Map<string, string>();
      const optionDraftByOldId = new Map<number, string>();

      const clonedImages: ImageDraft[] = item.images
        .filter((img) => isActiveDraftNode(img) && img.resourceId !== null)
        .map((img) => ({
          id: null,
          draftId: makeId("img"),
          sourceId: img.id,
          resourceId: img.resourceId,
          status: "CREATED",
          order: img.order,
          altText: img.altText,
          role: img.role,
        }));

      const clonedOptions: OptionDraft[] = item.options
        .filter(isActiveDraftNode)
        .map((opt) => {
          const newOptDraftId = makeId("opt");
          optionDraftByOldDraftId.set(opt.draftId, newOptDraftId);
          if (opt.id !== null) optionDraftByOldId.set(opt.id, newOptDraftId);

          const optImages: ImageDraft[] = opt.images
            .filter((img) => isActiveDraftNode(img) && img.resourceId !== null)
            .map((img) => ({
              id: null,
              draftId: makeId("img"),
              sourceId: img.id,
              resourceId: img.resourceId,
              status: "CREATED",
              order: img.order,
              altText: img.altText,
              role: img.role,
            }));

          return {
            id: null,
            draftId: newOptDraftId,
            sourceId: opt.id,
            status: "CREATED",
            code: opt.code,
            text: opt.text,
            order: opt.order,
            ordinalValue: opt.ordinalValue,
            images: optImages,
          };
        });

      let clonedKey: AnswerKeyDraft | undefined;
      if (item.answerKey && isActiveDraftNode(item.answerKey)) {
        const key = item.answerKey;
        const resolvedRuleId = options.ruleIdBySubtestDraftId
          ? (options.ruleIdBySubtestDraftId[subtest.draftId] ?? null)
          : (key.ruleId ?? subtest.defaultRuleId ?? null);

        if (resolvedRuleId !== null || !options.omitAnswerKeysWithoutRuleId) {
          const mappedOptDraftId =
            (key.correctOptionDraftId !== null
              ? optionDraftByOldDraftId.get(key.correctOptionDraftId)
              : undefined) ??
            (key.correctOptionId !== null
              ? optionDraftByOldId.get(key.correctOptionId)
              : undefined) ??
            null;

          clonedKey = {
            id: null,
            draftId: makeId("key"),
            sourceId: key.id,
            status: "CREATED",
            ruleId: resolvedRuleId,
            correctOptionDraftId: mappedOptDraftId,
            correctOptionId: null,
            expectedText: key.expectedText,
            expectedNumber: key.expectedNumber,
            numericTolerance: key.numericTolerance,
            score: key.score,
            requiresManualReview: key.requiresManualReview,
          };
        }
      }

      items.push({
        id: null,
        draftId: clonedItemDraftId,
        sourceId: item.id,
        status: "CREATED",
        code: item.code,
        itemType: item.itemType,
        responseType: item.responseType,
        prompt: item.prompt,
        instruction: item.instruction,
        order: item.order,
        baseScore: item.baseScore,
        timeLimitSeconds: item.timeLimitSeconds,
        required: item.required,
        confidential: item.confidential,
        images: clonedImages,
        options: clonedOptions,
        ...(clonedKey !== undefined ? { answerKey: clonedKey } : {}),
      });
    }

    subtests.push({
      id: null,
      draftId: clonedSubtestDraftId,
      sourceId: subtest.id,
      status: "CREATED",
      code: subtest.code,
      name: subtest.name,
      description: subtest.description,
      instructions: subtest.instructions,
      order: subtest.order,
      timeLimitSeconds: subtest.timeLimitSeconds,
      randomizeItems: doc.version.randomizeItems ? subtest.randomizeItems : false,
      randomizeOptions: subtest.randomizeOptions,
      required: subtest.required,
      strategyId: subtest.strategyId,
      items,
    });
  }

  return { subtests };
}
