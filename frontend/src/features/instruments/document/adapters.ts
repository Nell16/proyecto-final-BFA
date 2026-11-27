import { staffClient } from "../../../api/client";
import {
  createBaremo,
  createBaremoRange,
  createScoringRule,
  createVersion,
  deleteItemImage,
  getSubtestCloneTemplate,
  listBaremoRanges,
  listBaremos,
  listScoringRules,
  listSubtests,
  listTests,
  listVersions,
  saveVersionConfiguration,
  updateBaremo,
  updateBaremoRange,
  updateVersion,
  uploadItemImage,
  uploadOptionImage,
} from "../../../api/endpoints/instruments";
import { ApiError, type ApiEnvelope, unwrap } from "../../../api/errors";
import {
  UploadedImageWireSchema,
  VersionConfigurationRequestSchema,
  VersionRequestSchema,
} from "../../../api/schemas/instruments";
import { parseOrThrow } from "../../../api/schemas/parse";
import type {
  BaremoPayload,
  BaremoRangePayload,
  ItemDraft,
  ScoringRule,
  Subtest,
  SubtestCloneTemplate,
  SubtestDraft,
  TestInstrument,
  TestVersion,
  UploadedImage,
  VersionPayload,
} from "../../../api/schemas/instruments";
import type { AccountScope } from "../../../store/accountScope";
import type { InstrumentPermissions } from "../permissions";
import {
  buildCloneConfiguration,
  buildConfigurationDiff,
  collectPendingImageUploads,
  collectSubtestsNeedingScoringRule,
} from "./diff";
import {
  reconcileVersionDocumentThreeWay,
  type DocumentConflictNode,
} from "./reconcile";
import { detectOrderCollisions, getDirtyNodeIds, type OrderCollision } from "./reducer";
import { validateVersionDocument } from "./schema";
import {
  baremoNaturalKey,
  clearSentConfiguration,
  cloneSentSnapshot,
  codeKey,
  recordSentBaremo,
  recordSentConfiguration,
  recordSentRange,
  recordSentScoringRule,
  recordSentVersion,
  sentKey,
  uploadSlotKey,
  type SentSnapshot,
} from "./sent";
import {
  isActiveDraftNode,
  type DocumentAnswerKey,
  type DocumentBaremo,
  type DocumentImage,
  type DocumentItem,
  type DocumentOption,
  type DocumentSubtest,
  type VersionDocument,
  documentSignature,
} from "./types";

export interface LoadedVersionDocument {
  document: VersionDocument;
  test: TestInstrument;
  version: TestVersion;
  scoringRulesBySubtestId: Record<number, ScoringRule[]>;
  activeScoringRuleCount: number;
  hasActiveScoringRules: boolean;
}

export type SaveStepId = "metadata" | "configuration" | "scoring" | "images" | "baremos";

export const SAVE_STEP_LABELS: Record<SaveStepId, string> = {
  metadata: "Metadatos de versión",
  configuration: "Subtests, ítems y opciones",
  scoring: "Reglas de calificación y claves",
  images: "Imágenes pendientes",
  baremos: "Baremos y rangos",
};

export interface StepCommitSnapshot {
  step?: SaveStepId;
  document: VersionDocument;
  baselineDocument: VersionDocument | null;
  baselineSignature: string | undefined;
  reconciliationPending?: boolean;
  sent?: SentSnapshot;
}

export interface SaveVersionDocumentInput {
  document: VersionDocument;
  pendingFiles: Record<string, File>;
  baselineDocument?: VersionDocument;
  baselineSignature?: string;
  reconciliationPending?: boolean;
  sent?: SentSnapshot;
  completedSteps?: readonly SaveStepId[];
  pendingSteps?: readonly SaveStepId[];
  onStepCommitted?: (snapshot: StepCommitSnapshot) => void;
  permissions: Pick<
    InstrumentPermissions,
    "canEdit" | "canConfigureScoring" | "canConfigureBaremos"
  >;
  scope?: AccountScope;
}

export class PartialSaveError extends Error {
  public readonly cause: unknown;
  public readonly completedSteps: SaveStepId[];
  public readonly pendingSteps: SaveStepId[];
  public readonly document: VersionDocument;
  public readonly baselineDocument: VersionDocument | null;
  public readonly baselineSignature: string | undefined;
  public readonly reconciliationPending: boolean;
  public readonly sent: SentSnapshot;

  constructor(params: {
    cause: unknown;
    message?: string;
    completedSteps: SaveStepId[];
    pendingSteps: SaveStepId[];
    document: VersionDocument;
    baselineDocument: VersionDocument | null;
    baselineSignature: string | undefined;
    reconciliationPending?: boolean;
    sent?: SentSnapshot;
  }) {
    const baseMessage =
      params.message ??
      (params.cause instanceof Error ? params.cause.message : "Error al guardar la versión.");
    super(baseMessage);
    this.name = "PartialSaveError";
    this.cause = params.cause;
    this.completedSteps = params.completedSteps;
    this.pendingSteps = params.pendingSteps;
    this.document = params.document;
    this.baselineDocument = params.baselineDocument;
    this.baselineSignature = params.baselineSignature;
    this.reconciliationPending = params.reconciliationPending ?? false;
    this.sent = cloneSentSnapshot(params.sent);
  }
}

export class VersionConflictError extends ApiError {
  public readonly conflicts: DocumentConflictNode[];

  constructor(conflicts: DocumentConflictNode[]) {
    const labels = conflicts.map((c) => c.label);
    super({
      status: 409,
      code: "VERSION_DOCUMENT_CHANGED",
      message:
        labels.length > 0
          ? `La configuración del servidor cambió en ${labels.length} nodo(s): ${labels.join("; ")}. Revisa los conflictos antes de continuar.`
          : "La configuración del servidor cambió. Revisa los cambios pendientes y, cuando estés listo, descarta el borrador local para recargar la versión.",
      details: labels,
    });
    this.name = "VersionConflictError";
    this.conflicts = conflicts;
  }
}

export class OrderCollisionError extends ApiError {
  public readonly collisions: OrderCollision[];

  constructor(collisions: OrderCollision[]) {
    super({
      status: 409,
      code: "ORDER_PERMUTATION_COLLISION",
      message:
        "El reordenamiento intercambia posiciones ocupadas por registros ya guardados (límite temporal del backend B18). Revierte el reordenamiento para guardar.",
      details: collisions.map((c) => c.label),
    });
    this.name = "OrderCollisionError";
    this.collisions = collisions;
  }
}

export interface CloneRulePlanItem {
  subtestDraftId: string;
  subtestCode: string;
  subtestName: string;
  rule: ScoringRule;
  effectiveStrategyId: number | null;
  mappedItemDraftId: string | null;
  reason?: string;
}

export interface CloneBaremoPlanItem {
  baremo: DocumentBaremo;
  reason: string;
}

export interface VersionClonePlan {
  sourceLoaded: LoadedVersionDocument;
  copiableRules: CloneRulePlanItem[];
  omittedRules: CloneRulePlanItem[];
  omittedAnswerKeyCount: number;
  copiableBaremos: DocumentBaremo[];
  omittedBaremos: CloneBaremoPlanItem[];
  hasOmissions: boolean;
  signature: string;
}

export interface VersionClonePlanSignatureOptions {
  copyBaremos?: boolean;
  canConfigureScoring?: boolean;
  canConfigureBaremos?: boolean;
}

export interface CloneVersionFromSourceInput {
  testId: number;
  sourceVersionId: number;
  versionPayload: VersionPayload;
  permissions: Pick<
    InstrumentPermissions,
    "canEdit" | "canConfigureScoring" | "canConfigureBaremos"
  >;
  copyBaremos?: boolean;
  expectedPlanSignature?: string;
  scope?: AccountScope;
}

export type CloneVersionFromSourceResult =
  | {
      status: "cloned";
      version: TestVersion;
      copiedAnswerKeys: boolean;
      copiedBaremos: boolean;
      warnings: string[];
    }
  | {
      status: "plan_changed";
      plan: VersionClonePlan;
    };

export class IncompleteVersionCloneError extends Error {
  constructor(public readonly version: TestVersion, detail: string) {
    super(`Se creó la versión ${version.number}, pero la copia quedó incompleta. ${detail}`);
  }
}

const normalizeCode = (value: string): string => value.trim().toUpperCase();

async function resolveTestAndVersion(
  versionId: number,
  preferredTestId?: number,
  scope?: AccountScope,
): Promise<{ test: TestInstrument; version: TestVersion }> {
  scope?.assertCurrent();
  const tests = await listTests();
  scope?.assertCurrent();

  if (tests.length === 0) {
    throw new ApiError({
      status: 404,
      code: "VERSION_NOT_FOUND",
      message: `Versión no encontrada: ${versionId}`,
    });
  }

  let checkedTestId: number | null = null;
  if (preferredTestId !== undefined) {
    const preferredTest = tests.find((t) => t.id === preferredTestId);
    if (preferredTest) {
      checkedTestId = preferredTest.id;
      const versions = await listVersions(preferredTest.id);
      scope?.assertCurrent();
      const match = versions.find((v) => v.id === versionId);
      if (match) {
        return { test: preferredTest, version: match };
      }
    }
  }

  const remainingTests = tests.filter((t) => t.id !== checkedTestId);
  if (remainingTests.length > 0) {
    const versionGroups = await Promise.all(
      remainingTests.map(async (test) => ({
        test,
        versions: await listVersions(test.id),
      })),
    );
    scope?.assertCurrent();

    for (const group of versionGroups) {
      const match = group.versions.find((v) => v.id === versionId);
      if (match) {
        return { test: group.test, version: match };
      }
    }
  }

  throw new ApiError({
    status: 404,
    code: "VERSION_NOT_FOUND",
    message: `Versión no encontrada: ${versionId}`,
  });
}

function mapTemplateImage(
  img: SubtestCloneTemplate["items"][number]["images"][number],
  index: number,
): DocumentImage {
  return {
    id: img.sourceImageId,
    draftId: `img-${img.sourceImageId}`,
    sourceId: null,
    resourceId: img.resourceId,
    pendingFileId: null,
    previewUrl: `/items/images/resources/${img.resourceId}`,
    status: "EXISTING",
    order: img.order ?? index + 1,
    altText: img.altText ?? "",
    role: img.role,
    fileName: null,
    storagePath: img.storagePath,
  };
}

function pickDefaultRuleId(rules: readonly ScoringRule[]): number | null {
  const claveRule = rules.find((r) => r.active && r.ruleType === "CLAVE_ITEM");
  if (claveRule) return claveRule.id;
  const anyActive = rules.find((r) => r.active);
  return anyActive ? anyActive.id : null;
}

export async function loadVersionDocument(
  versionId: number,
  options?: { testId?: number; scope?: AccountScope },
): Promise<LoadedVersionDocument> {
  const scope = options?.scope;
  scope?.assertCurrent();

  const { test, version } = await resolveTestAndVersion(versionId, options?.testId, scope);

  scope?.assertCurrent();
  const [subtestsRaw, baremosRaw] = await Promise.all([
    listSubtests(versionId),
    listBaremos(versionId),
  ]);
  scope?.assertCurrent();

  const sortedSubtests = [...subtestsRaw].sort((a, b) => a.order - b.order || a.id - b.id);

  const [subtestBundles, rangesByBaremo] = await Promise.all([
    Promise.all(
      sortedSubtests.map(async (subtest) => {
        const [template, rules] = await Promise.all([
          getSubtestCloneTemplate(subtest.id),
          listScoringRules(subtest.id),
        ]);
        return { subtest, template, rules };
      }),
    ),
    Promise.all(baremosRaw.map((baremo) => listBaremoRanges(baremo.id))),
  ]);
  scope?.assertCurrent();

  const scoringRulesBySubtestId: Record<number, ScoringRule[]> = {};
  let activeScoringRuleCount = 0;

  const subtests: DocumentSubtest[] = subtestBundles.map(({ subtest, template, rules }) => {
    scoringRulesBySubtestId[subtest.id] = rules;
    activeScoringRuleCount += rules.filter((r) => r.active).length;

    const items: DocumentItem[] = template.items.map((tplItem) => {
      const optionsList: DocumentOption[] = tplItem.options.map((tplOpt) => ({
        id: tplOpt.sourceOptionId,
        draftId: `opt-${tplOpt.sourceOptionId}`,
        sourceId: null,
        status: "EXISTING",
        code: tplOpt.code,
        text: tplOpt.text ?? "",
        order: tplOpt.order,
        ordinalValue: tplOpt.ordinalValue,
        images: tplOpt.images.map((img, idx) => mapTemplateImage(img, idx)),
      }));

      const itemImages: DocumentImage[] = tplItem.images.map((img, idx) =>
        mapTemplateImage(img, idx),
      );

      let answerKey: DocumentAnswerKey | null = null;
      if (tplItem.answerKey) {
        const tplKey = tplItem.answerKey;
        const hasOption =
          tplKey.correctOptionSourceId !== null &&
          tplItem.options.some((o) => o.sourceOptionId === tplKey.correctOptionSourceId);

        answerKey = {
          id: tplKey.sourceAnswerKeyId,
          draftId: `key-${tplKey.sourceAnswerKeyId}`,
          sourceId: null,
          status: "EXISTING",
          ruleId: tplKey.sourceRuleId,
          correctOptionDraftId: hasOption ? `opt-${tplKey.correctOptionSourceId}` : null,
          correctOptionId: tplKey.correctOptionSourceId,
          expectedText: tplKey.expectedText,
          expectedNumber: tplKey.expectedNumber,
          numericTolerance: tplKey.numericTolerance,
          score: tplKey.score,
          requiresManualReview: tplKey.requiresManualReview,
        };
      }

      return {
        id: tplItem.sourceItemId,
        draftId: `item-${tplItem.sourceItemId}`,
        sourceId: null,
        status: "EXISTING",
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
        images: itemImages,
        options: optionsList,
        answerKey,
      };
    });

    return {
      id: subtest.id,
      draftId: `sub-${subtest.id}`,
      sourceId: null,
      status: "EXISTING",
      code: subtest.code,
      name: subtest.name,
      description: subtest.description ?? "",
      instructions: subtest.instructions ?? "",
      order: subtest.order,
      timeLimitSeconds: subtest.timeLimitSeconds,
      randomizeItems: subtest.randomizeItems,
      randomizeOptions: subtest.randomizeOptions,
      required: subtest.required,
      strategyId: subtest.strategyId,
      defaultRuleId: pickDefaultRuleId(rules),
      items,
    };
  });

  const baremos: DocumentBaremo[] = baremosRaw.map((baremo, index): DocumentBaremo => {
    const rawRanges = rangesByBaremo[index] ?? [];
    const ranges = [...rawRanges].sort((a, b) => a.id - b.id).map((r) => ({
      id: r.id,
      draftId: `range-${r.id}`,
      status: "EXISTING" as const,
      minScore: r.minScore,
      maxScore: r.maxScore,
      percentile: r.percentile,
      category: r.category,
      interpretation: r.interpretation ?? "",
      recommendation: r.recommendation ?? "",
      order: r.order,
    }));

    return {
      id: baremo.id,
      draftId: `baremo-${baremo.id}`,
      status: "EXISTING",
      dimensionId: baremo.dimensionId,
      code: baremo.code,
      name: baremo.name,
      description: baremo.description ?? "",
      normativeGroup: baremo.normativeGroup ?? "",
      ranges,
    };
  }).sort((a, b) => (a.id ?? 0) - (b.id ?? 0));

  const document: VersionDocument = {
    version: {
      versionId: version.id,
      testId: test.id,
      testCode: test.code,
      testName: test.name,
      number: version.number,
      status: version.status,
      strategyId: version.strategyId,
      instructions: version.instructions ?? "",
      timeLimitSeconds: version.timeLimitSeconds,
      randomizeSubtests: version.randomizeSubtests,
      randomizeItems: version.randomizeItems,
      metaDirty: false,
    },
    subtests,
    baremos,
    dirtyNodeIds: [],
    loadedAt: new Date().toISOString(),
  };

  return {
    document,
    test,
    version,
    scoringRulesBySubtestId,
    activeScoringRuleCount,
    hasActiveScoringRules: activeScoringRuleCount > 0,
  };
}

function applyVersionMetaToDoc(doc: VersionDocument, saved: TestVersion, metaDirty: boolean): VersionDocument {
  const next: VersionDocument = {
    ...doc,
    version: {
      ...doc.version,
      number: saved.number,
      strategyId: saved.strategyId,
      instructions: saved.instructions ?? "",
      timeLimitSeconds: saved.timeLimitSeconds,
      randomizeSubtests: saved.randomizeSubtests,
      randomizeItems: saved.randomizeItems,
      metaDirty,
    },
  };
  return { ...next, dirtyNodeIds: getDirtyNodeIds(next) };
}

function reconcileDocumentAfterPass1(
  doc: VersionDocument,
  persistedSubtests: Subtest[],
  omitAnswerKeysWithoutRuleId: boolean,
): VersionDocument {
  const persistedById = new Map<number, Subtest>();
  const persistedByCode = new Map<string, Subtest>();
  for (const s of persistedSubtests) {
    persistedById.set(s.id, s);
    persistedByCode.set(codeKey(s.code), s);
  }

  const nextSubtests: DocumentSubtest[] = [];
  for (const subtest of doc.subtests) {
    if (subtest.status === "DELETED") continue;
    const matched =
      (subtest.id !== null ? persistedById.get(subtest.id) : undefined) ??
      persistedByCode.get(codeKey(subtest.code));
    const resolvedSubtestId = matched?.id ?? subtest.id;

    const nextItems: DocumentItem[] = [];
    for (const item of subtest.items) {
      if (item.status === "DELETED") continue;

      const nextImages: DocumentImage[] = [];
      for (const img of item.images) {
        if (img.status === "DELETED") continue;
        if (img.resourceId !== null) {
          nextImages.push({ ...img, status: "EXISTING" });
        } else {
          nextImages.push(img);
        }
      }

      const nextOptions: DocumentOption[] = [];
      for (const opt of item.options) {
        if (opt.status === "DELETED") continue;
        const nextOptImages: DocumentImage[] = [];
        for (const oImg of opt.images) {
          if (oImg.status === "DELETED") continue;
          nextOptImages.push(oImg.resourceId !== null ? { ...oImg, status: "EXISTING" } : oImg);
        }
        nextOptions.push({ ...opt, status: "EXISTING", images: nextOptImages });
      }

      let nextAnswerKey: DocumentAnswerKey | null = item.answerKey;
      if (nextAnswerKey) {
        if (nextAnswerKey.status === "DELETED") {
          // Backend ignora DELETE de clave (B13); mantener si tenía id
          nextAnswerKey = nextAnswerKey.id !== null ? nextAnswerKey : null;
        } else {
          const effectiveRuleId = nextAnswerKey.ruleId ?? subtest.defaultRuleId;
          const wasDeferred = effectiveRuleId === null && omitAnswerKeysWithoutRuleId;
          if (!wasDeferred) {
            nextAnswerKey = { ...nextAnswerKey, status: "EXISTING" };
          }
        }
      }

      nextItems.push({
        ...item,
        status: "EXISTING",
        images: nextImages,
        options: nextOptions,
        answerKey: nextAnswerKey,
      });
    }

    nextSubtests.push({
      ...subtest,
      id: resolvedSubtestId,
      status: "EXISTING",
      items: nextItems,
    });
  }

  const next: VersionDocument = { ...doc, subtests: nextSubtests };
  return { ...next, dirtyNodeIds: getDirtyNodeIds(next) };
}

function applyPass1ToBaseline(
  baseline: VersionDocument,
  workingDocAfterPass1: VersionDocument,
  omitDeferredKeys: boolean,
): VersionDocument {
  const baseSubById = new Map<number, DocumentSubtest>();
  const baseSubByCode = new Map<string, DocumentSubtest>();
  for (const s of baseline.subtests) {
    if (s.id !== null) baseSubById.set(s.id, s);
    baseSubByCode.set(codeKey(s.code), s);
  }

  const subtests: DocumentSubtest[] = workingDocAfterPass1.subtests
    .filter(isActiveDraftNode)
    .map((docSub) => {
      const baseSub =
        (docSub.id !== null ? baseSubById.get(docSub.id) : undefined) ??
        baseSubByCode.get(codeKey(docSub.code));

      const baseItemById = new Map<number, DocumentItem>();
      const baseItemByCode = new Map<string, DocumentItem>();
      for (const it of baseSub?.items ?? []) {
        if (it.id !== null) baseItemById.set(it.id, it);
        baseItemByCode.set(codeKey(it.code), it);
      }

      const items: DocumentItem[] = docSub.items
        .filter(isActiveDraftNode)
        .map((docItem) => {
          const baseItem =
            (docItem.id !== null ? baseItemById.get(docItem.id) : undefined) ??
            baseItemByCode.get(codeKey(docItem.code));

          let answerKey: DocumentAnswerKey | null = docItem.answerKey;
          if (answerKey) {
            const effectiveRuleId = answerKey.ruleId ?? docSub.defaultRuleId;
            const wasDeferred = omitDeferredKeys && effectiveRuleId === null;
            if (answerKey.status === "DELETED" || (answerKey.status !== "EXISTING" && wasDeferred)) {
              answerKey = baseItem?.answerKey ? structuredClone(baseItem.answerKey) : null;
            }
          }

          return {
            ...structuredClone(docItem),
            images: docItem.images
              .filter((img) => isActiveDraftNode(img) && img.resourceId !== null)
              .map((img) => ({ ...structuredClone(img), status: "EXISTING" as const })),
            options: docItem.options
              .filter(isActiveDraftNode)
              .map((opt) => ({
                ...structuredClone(opt),
                status: "EXISTING" as const,
                images: opt.images
                  .filter((img) => isActiveDraftNode(img) && img.resourceId !== null)
                  .map((img) => ({ ...structuredClone(img), status: "EXISTING" as const })),
              })),
            answerKey: answerKey ? structuredClone(answerKey) : null,
          };
        });

      return {
        ...structuredClone(docSub),
        status: "EXISTING" as const,
        randomizeItems: baseline.version.randomizeItems ? docSub.randomizeItems : false,
        defaultRuleId: baseSub?.defaultRuleId ?? docSub.defaultRuleId,
        items,
      };
    });

  return {
    ...baseline,
    subtests,
    dirtyNodeIds: [],
  };
}

function applyBaselineRuleId(
  baseline: VersionDocument,
  subtestId: number,
  subtestCode: string,
  ruleId: number,
): VersionDocument {
  const targetCode = codeKey(subtestCode);
  return {
    ...baseline,
    subtests: baseline.subtests.map((s) =>
      s.id === subtestId || codeKey(s.code) === targetCode
        ? { ...s, id: s.id ?? subtestId, defaultRuleId: s.defaultRuleId ?? ruleId }
        : s,
    ),
  };
}

function applyPass2KeysToBaseline(
  baseline: VersionDocument,
  workingDocAfterPass2: VersionDocument,
  pass2SubtestDraftIds: ReadonlySet<string>,
): VersionDocument {
  const docSubById = new Map<number, DocumentSubtest>();
  const docSubByCode = new Map<string, DocumentSubtest>();
  for (const s of workingDocAfterPass2.subtests) {
    if (!pass2SubtestDraftIds.has(s.draftId)) continue;
    if (s.id !== null) docSubById.set(s.id, s);
    docSubByCode.set(codeKey(s.code), s);
  }

  return {
    ...baseline,
    subtests: baseline.subtests.map((sub) => {
      const p2Sub =
        (sub.id !== null ? docSubById.get(sub.id) : undefined) ??
        docSubByCode.get(codeKey(sub.code));
      if (!p2Sub) return sub;

      const p2ItemById = new Map<number, DocumentItem>();
      const p2ItemByCode = new Map<string, DocumentItem>();
      for (const it of p2Sub.items) {
        if (!isActiveDraftNode(it)) continue;
        if (it.id !== null) p2ItemById.set(it.id, it);
        p2ItemByCode.set(codeKey(it.code), it);
      }

      return {
        ...sub,
        items: sub.items.map((item) => {
          const p2Item =
            (item.id !== null ? p2ItemById.get(item.id) : undefined) ??
            p2ItemByCode.get(codeKey(item.code));
          if (!p2Item?.answerKey || !isActiveDraftNode(p2Item.answerKey)) return item;
          return {
            ...item,
            answerKey: {
              ...structuredClone(p2Item.answerKey),
              status: "EXISTING" as const,
            },
          };
        }),
      };
    }),
  };
}

function upsertDocumentImage(
  images: readonly DocumentImage[],
  nextImage: DocumentImage,
): DocumentImage[] {
  const cloned = structuredClone(nextImage);
  const idx = images.findIndex((img) => img.id === cloned.id || img.order === cloned.order);
  if (idx < 0) return [...images, cloned];
  return images.map((img, i) => (i === idx ? cloned : img));
}

function applyUploadedImageToBaseline(
  baseline: VersionDocument,
  params: {
    ownerKind: "item" | "option";
    subtestId: number;
    subtestCode: string;
    itemCode: string;
    optionCode?: string;
    image: DocumentImage;
  },
): VersionDocument {
  const targetSubCode = codeKey(params.subtestCode);
  const targetItemCode = codeKey(params.itemCode);
  const targetOptCode = params.optionCode ? codeKey(params.optionCode) : undefined;

  return {
    ...baseline,
    subtests: baseline.subtests.map((sub) => {
      if (sub.id !== params.subtestId && codeKey(sub.code) !== targetSubCode) return sub;
      return {
        ...sub,
        items: sub.items.map((item) => {
          if (codeKey(item.code) !== targetItemCode) return item;
          if (params.ownerKind === "item") {
            return { ...item, images: upsertDocumentImage(item.images, params.image) };
          }
          return {
            ...item,
            options: item.options.map((opt) =>
              targetOptCode && codeKey(opt.code) === targetOptCode
                ? { ...opt, images: upsertDocumentImage(opt.images, params.image) }
                : opt,
            ),
          };
        }),
      };
    }),
  };
}

function applyBaremoToBaseline(
  baseline: VersionDocument,
  baremo: DocumentBaremo,
  persistedBaremoId: number,
): VersionDocument {
  const targetNaturalKey = baremoNaturalKey(baremo);
  let matched = false;
  const nextBaremos = baseline.baremos.map((existing) => {
    if (
      existing.id === persistedBaremoId ||
      existing.draftId === baremo.draftId ||
      (targetNaturalKey !== "" && baremoNaturalKey(existing) === targetNaturalKey)
    ) {
      matched = true;
      return {
        ...existing,
        id: persistedBaremoId,
        status: "EXISTING" as const,
        dimensionId: baremo.dimensionId,
        code: baremo.code.trim(),
        name: baremo.name.trim(),
        description: baremo.description.trim() ? baremo.description : "",
        normativeGroup: baremo.normativeGroup.trim() ? baremo.normativeGroup : "",
      };
    }
    return existing;
  });

  if (!matched) {
    nextBaremos.push({
      id: persistedBaremoId,
      draftId: `baremo-${persistedBaremoId}`,
      status: "EXISTING",
      dimensionId: baremo.dimensionId,
      code: baremo.code.trim(),
      name: baremo.name.trim(),
      description: baremo.description.trim() ? baremo.description : "",
      normativeGroup: baremo.normativeGroup.trim() ? baremo.normativeGroup : "",
      ranges: [],
    });
  }

  return { ...baseline, baremos: nextBaremos };
}

function applyBaremoRangeToBaseline(
  baseline: VersionDocument,
  baremoId: number,
  baremoDraftId: string,
  range: DocumentBaremo["ranges"][number],
  persistedRangeId: number,
): VersionDocument {
  return {
    ...baseline,
    baremos: baseline.baremos.map((b) => {
      if (b.id !== baremoId && b.draftId !== baremoDraftId) return b;
      let matched = false;
      const nextRanges = b.ranges.map((r) => {
        if (r.id === persistedRangeId || r.draftId === range.draftId) {
          matched = true;
          return {
            ...r,
            id: persistedRangeId,
            status: "EXISTING" as const,
            minScore: range.minScore,
            maxScore: range.maxScore,
            percentile: range.percentile,
            category: range.category.trim(),
            interpretation: range.interpretation.trim() ? range.interpretation : "",
            recommendation: range.recommendation.trim() ? range.recommendation : "",
            order: range.order,
          };
        }
        return r;
      });
      if (!matched) {
        nextRanges.push({
          id: persistedRangeId,
          draftId: `range-${persistedRangeId}`,
          status: "EXISTING",
          minScore: range.minScore,
          maxScore: range.maxScore,
          percentile: range.percentile,
          category: range.category.trim(),
          interpretation: range.interpretation.trim() ? range.interpretation : "",
          recommendation: range.recommendation.trim() ? range.recommendation : "",
          order: range.order,
        });
      }
      return { ...b, ranges: nextRanges };
    }),
  };
}

interface DeletedItemImageRef {
  subtestDraftId: string;
  itemDraftId: string;
  imageDraftId: string;
  imageId: number;
}

function collectDeletedItemImages(doc: VersionDocument): DeletedItemImageRef[] {
  const deleted: DeletedItemImageRef[] = [];
  for (const subtest of doc.subtests) {
    if (!isActiveDraftNode(subtest)) continue;
    for (const item of subtest.items) {
      if (!isActiveDraftNode(item)) continue;
      for (const img of item.images) {
        if (img.status === "DELETED" && img.id !== null) {
          deleted.push({
            subtestDraftId: subtest.draftId,
            itemDraftId: item.draftId,
            imageDraftId: img.draftId,
            imageId: img.id,
          });
        }
      }
    }
  }
  return deleted;
}

async function replaceItemImageByOrder(
  itemId: number,
  order: number,
  input: { file: Blob; altText?: string; role?: string },
): Promise<UploadedImage> {
  const form = new FormData();
  form.append("file", input.file);
  if (input.altText !== undefined) form.append("altText", input.altText);
  if (input.role !== undefined) form.append("role", input.role);

  const res = await staffClient.put<ApiEnvelope<unknown>>(
    `/items/${itemId}/images/by-order/${order}`,
    form,
  );
  return parseOrThrow(
    UploadedImageWireSchema,
    unwrap(res),
    "PUT /items/{itemId}/images/by-order/{order}",
  );
}

async function replaceOptionImageByOrder(
  optionId: number,
  order: number,
  input: { file: Blob; altText?: string },
): Promise<UploadedImage> {
  const form = new FormData();
  form.append("file", input.file);
  if (input.altText !== undefined) form.append("altText", input.altText);

  const res = await staffClient.put<ApiEnvelope<unknown>>(
    `/options/${optionId}/images/by-order/${order}`,
    form,
  );
  return parseOrThrow(
    UploadedImageWireSchema,
    unwrap(res),
    "PUT /options/{optionId}/images/by-order/{order}",
  );
}

function isUncertainMutationError(cause: unknown): boolean {
  if (!(cause instanceof ApiError)) return true;
  return cause.status === 0 || cause.status >= 500;
}

function computePendingSteps(doc: VersionDocument): SaveStepId[] {
  const needingRule = collectSubtestsNeedingScoringRule(doc);
  const pendingUploads = collectPendingImageUploads(doc);
  const pendingItemImageDeletes = collectDeletedItemImages(doc);
  const pass1Diff = buildConfigurationDiff(doc, {
    omitAnswerKeysWithoutRuleId: needingRule.length > 0,
    omitDeletedItemImages: true,
  });
  const dirtyActiveBaremos = doc.baremos.filter(
    (b) =>
      b.status !== "DELETED" &&
      (b.status !== "EXISTING" ||
        b.ranges.some((r) => r.status === "CREATED" || r.status === "UPDATED")),
  );

  const steps: SaveStepId[] = [];
  if (doc.version.metaDirty) steps.push("metadata");
  if (pass1Diff.subtests.length > 0) steps.push("configuration");
  if (needingRule.length > 0) steps.push("scoring");
  if (pendingUploads.length > 0 || pendingItemImageDeletes.length > 0) steps.push("images");
  if (dirtyActiveBaremos.length > 0) steps.push("baremos");
  return steps;
}

export async function saveVersionDocument(
  input: SaveVersionDocumentInput,
): Promise<LoadedVersionDocument> {
  const { document, pendingFiles, permissions, scope } = input;
  const versionId = document.version.versionId;

  scope?.assertCurrent();

  if (document.version.status !== "BORRADOR") {
    throw new ApiError({
      status: 400,
      code: "VERSION_NOT_DRAFT",
      message: "Solo se pueden guardar cambios en versiones en estado BORRADOR.",
    });
  }

  let workingDoc = structuredClone(document);
  let workingBaseline: VersionDocument | null = input.baselineDocument
    ? structuredClone(input.baselineDocument)
    : null;
  let workingSent = cloneSentSnapshot(input.sent);
  const completedSteps: SaveStepId[] = [...(input.completedSteps ?? [])];
  const completedInThisAttempt = new Set<SaveStepId>();

  const markCompletedStep = (step: SaveStepId) => {
    completedInThisAttempt.add(step);
    if (!completedSteps.includes(step)) {
      completedSteps.push(step);
    }
  };

  const emitCommitted = (step?: SaveStepId, reconciliationPending = false) => {
    workingDoc = { ...workingDoc, dirtyNodeIds: getDirtyNodeIds(workingDoc) };
    input.onStepCommitted?.({
      step,
      document: workingDoc,
      baselineDocument: workingBaseline,
      baselineSignature: workingBaseline ? documentSignature(workingBaseline) : undefined,
      reconciliationPending,
      sent: cloneSentSnapshot(workingSent),
    });
  };

  // Fail-fast B18 antes de recargar cuando no hay reconciliación pendiente
  if (!input.reconciliationPending && workingBaseline !== null) {
    const initialCollisions = detectOrderCollisions(workingDoc, workingBaseline);
    if (initialCollisions.length > 0) {
      throw new OrderCollisionError(initialCollisions);
    }
  }

  // Reconciliación a 3 vías por nodo antes de planificar/emitir escrituras
  const shouldPreReconcile =
    input.reconciliationPending ||
    (workingBaseline !== null &&
      (input.baselineSignature !== undefined || (input.completedSteps?.length ?? 0) > 0));

  if (shouldPreReconcile) {
    let current: LoadedVersionDocument;
    try {
      current = await loadVersionDocument(versionId, { testId: workingDoc.version.testId, scope });
    } catch (reloadCause) {
      if (scope && !scope.isCurrent()) {
        throw reloadCause;
      }
      if (input.reconciliationPending) {
        const causeMessage =
          reloadCause instanceof Error ? reloadCause.message : "Error de conexión";
        workingDoc = { ...workingDoc, dirtyNodeIds: getDirtyNodeIds(workingDoc) };
        throw new PartialSaveError({
          cause: reloadCause,
          message: `No se pudo recargar el estado del servidor para reconciliar el guardado parcial (${causeMessage}). El reintento sigue disponible cuando se recupere la conexión.`,
          completedSteps,
          pendingSteps:
            input.pendingSteps && input.pendingSteps.length > 0
              ? [...input.pendingSteps]
              : computePendingSteps(workingDoc),
          document: workingDoc,
          baselineDocument: workingBaseline,
          baselineSignature: input.baselineSignature,
          reconciliationPending: true,
          sent: workingSent,
        });
      }
      throw reloadCause;
    }

    const theirs = structuredClone(current.document);
    const reconciled = reconcileVersionDocumentThreeWay({
      base: workingBaseline ?? theirs,
      mine: workingDoc,
      theirs,
      sent: workingSent,
      pendingFiles,
    });

    if (reconciled.conflicts.length > 0) {
      throw new VersionConflictError(reconciled.conflicts);
    }

    workingDoc = reconciled.document;
    workingBaseline = theirs;
    workingSent = reconciled.sent;
    if (input.reconciliationPending) {
      emitCommitted(undefined, false);
    }

    if (computePendingSteps(workingDoc).length === 0) {
      return current;
    }
  } else if (input.baselineSignature !== undefined) {
    const current = await loadVersionDocument(versionId, {
      testId: workingDoc.version.testId,
      scope,
    });
    if (documentSignature(current.document) !== input.baselineSignature) {
      throw new VersionConflictError([]);
    }
    workingBaseline = structuredClone(current.document);
  }

  // Validación Fail-Fast ANTES de emitir ninguna mutación
  const needingRule = collectSubtestsNeedingScoringRule(workingDoc);
  const pendingUploads = collectPendingImageUploads(workingDoc);
  const pendingItemImageDeletes = collectDeletedItemImages(workingDoc);
  const omitDeferredKeys = needingRule.length > 0;
  const pass1Diff = buildConfigurationDiff(workingDoc, {
    omitAnswerKeysWithoutRuleId: omitDeferredKeys,
    omitDeletedItemImages: true,
  });
  const dirtyActiveBaremos = workingDoc.baremos.filter(
    (b) =>
      b.status !== "DELETED" &&
      (b.status !== "EXISTING" ||
        b.ranges.some((r) => r.status === "CREATED" || r.status === "UPDATED")),
  );

  if (
    (workingDoc.version.metaDirty ||
      pass1Diff.subtests.length > 0 ||
      pendingUploads.length > 0 ||
      pendingItemImageDeletes.length > 0) &&
    !permissions.canEdit
  ) {
    throw new ApiError({
      status: 403,
      code: "FORBIDDEN_EDIT",
      message: "No tienes permiso para editar la configuración de este instrumento (TEST_CREAR).",
    });
  }

  if (needingRule.length > 0) {
    if (!permissions.canConfigureScoring) {
      throw new ApiError({
        status: 403,
        code: "FORBIDDEN_SCORING",
        message:
          "Se requiere el permiso CALIFICACION_CONFIGURAR para crear reglas de calificación en subtests nuevos con claves de respuesta.",
      });
    }

    const missingStrategy = needingRule.some(
      (subtest) => (subtest.strategyId ?? workingDoc.version.strategyId) === null,
    );
    if (missingStrategy) {
      throw new ApiError({
        status: 400,
        code: "MISSING_STRATEGY",
        message:
          "Debe seleccionar una estrategia de calificación en la versión o el subtest antes de guardar claves de respuesta.",
      });
    }
  }

  for (const upload of pendingUploads) {
    if (!pendingFiles[upload.pendingFileId]) {
      throw new ApiError({
        status: 400,
        code: "MISSING_PENDING_FILE",
        message:
          "Hay imágenes pendientes cuyo archivo local ya no está disponible tras recargar. Vuelve a seleccionarlas o elimínalas antes de guardar.",
      });
    }
  }

  if (dirtyActiveBaremos.length > 0 && !permissions.canConfigureBaremos) {
    throw new ApiError({
      status: 403,
      code: "FORBIDDEN_BAREMO",
      message: "Se requiere el permiso BAREMO_CONFIGURAR para guardar cambios en baremos.",
    });
  }

  // Validación completa del documento (no solo del diff) antes de escribir (MEDIO 3)
  const fullValidation = validateVersionDocument(workingDoc);
  if (!fullValidation.canSave) {
    const firstSaveError = fullValidation.saveErrors[0]!;
    throw new ApiError({
      status: 400,
      code: "INVALID_VERSION_DRAFT",
      message: firstSaveError.message,
      details: fullValidation.saveErrors.map((e) => e.message),
    });
  }

  const v = workingDoc.version;
  const metadata = v.metaDirty
    ? VersionRequestSchema.safeParse({
        number: v.number,
        strategyId: v.strategyId,
        instructions: v.instructions.trim() ? v.instructions : null,
        timeLimitSeconds: v.timeLimitSeconds,
        randomizeSubtests: v.randomizeSubtests,
        randomizeItems: v.randomizeItems,
      })
    : undefined;
  const configuration = VersionConfigurationRequestSchema.safeParse(pass1Diff);
  if (metadata?.success === false || !configuration.success) {
    const issue = metadata?.error?.issues[0] ?? configuration.error?.issues[0];
    throw new ApiError({
      status: 400,
      code: "INVALID_VERSION_DRAFT",
      message: issue?.message ?? "Revisa los campos del borrador antes de guardar.",
    });
  }

  const plannedSteps: SaveStepId[] = [];
  if (metadata) plannedSteps.push("metadata");
  if (pass1Diff.subtests.length > 0) plannedSteps.push("configuration");
  if (needingRule.length > 0) plannedSteps.push("scoring");
  if (pendingUploads.length > 0 || pendingItemImageDeletes.length > 0) plannedSteps.push("images");
  if (dirtyActiveBaremos.length > 0) plannedSteps.push("baremos");

  // Detección de permutaciones que colisionan bajo B18 antes de escribir metadatos (MEDIO 5)
  const orderCollisions = detectOrderCollisions(workingDoc, workingBaseline);
  if (orderCollisions.length > 0) {
    throw new OrderCollisionError(orderCollisions);
  }

  let mutatedBeyondMetadata = false;
  let attemptedMutation = false;

  try {
    // 1. Metadata de la versión
    if (metadata) {
      scope?.assertCurrent();
      attemptedMutation = true;
      recordSentVersion(workingSent, workingDoc.version);
      const savedVersion = await updateVersion(versionId, metadata.data);
      delete workingSent.nodes[sentKey.version];
      workingDoc = applyVersionMetaToDoc(workingDoc, savedVersion, false);
      if (workingBaseline) {
        workingBaseline = applyVersionMetaToDoc(workingBaseline, savedVersion, false);
      }
      markCompletedStep("metadata");
      emitCommitted("metadata");
    }

    // 2. Pass 1: estructura e ítems (omitiendo claves sin ruleId cuando aplica)
    let persistedSubtests: Subtest[] = [];
    if (pass1Diff.subtests.length > 0) {
      scope?.assertCurrent();
      attemptedMutation = true;
      recordSentConfiguration(workingSent, workingDoc, pass1Diff);
      persistedSubtests = await saveVersionConfiguration(versionId, pass1Diff);
      clearSentConfiguration(workingSent, pass1Diff);
      mutatedBeyondMetadata = true;
      workingDoc = reconcileDocumentAfterPass1(workingDoc, persistedSubtests, omitDeferredKeys);
      if (workingBaseline) {
        workingBaseline = applyPass1ToBaseline(workingBaseline, workingDoc, omitDeferredKeys);
      }
      markCompletedStep("configuration");
      emitCommitted("configuration");
    }

    let fallbackSubtests: Subtest[] | null = null;
    const resolvePersistedSubtestId = async (subtest: DocumentSubtest): Promise<number> => {
      if (subtest.id !== null) return subtest.id;

      const targetCode = codeKey(subtest.code);
      const fromPass1 = persistedSubtests.find((s) => codeKey(s.code) === targetCode);
      if (fromPass1) return fromPass1.id;

      if (!fallbackSubtests) {
        scope?.assertCurrent();
        fallbackSubtests = await listSubtests(versionId);
      }
      const fromList = fallbackSubtests.find((s) => codeKey(s.code) === targetCode);
      if (!fromList) {
        throw new ApiError({
          status: 500,
          code: "SUBTEST_NOT_PERSISTED",
          message: `No se pudo resolver el subtest persistido (${subtest.code}).`,
        });
      }
      return fromList.id;
    };

    const templateCache = new Map<number, SubtestCloneTemplate>();

    // 3. Pass 2: reglas de calificación + claves diferidas
    if (needingRule.length > 0) {
      const pass2Subtests: SubtestDraft[] = [];

      for (const subtest of needingRule) {
        const subtestId = await resolvePersistedSubtestId(subtest);

        scope?.assertCurrent();
        attemptedMutation = true;
        const ruleStrategyId = (subtest.strategyId ?? workingDoc.version.strategyId)!;
        recordSentScoringRule(workingSent, subtest.draftId, `CLAVE_ITEM:${ruleStrategyId}`);
        const createdRule = await createScoringRule(subtestId, {
          strategyId: ruleStrategyId,
          ruleType: "CLAVE_ITEM",
          priority: 1,
          parametersJson: "{}",
        });
        delete workingSent.nodes[sentKey.scoringRule(subtest.draftId)];
        mutatedBeyondMetadata = true;

        workingDoc = {
          ...workingDoc,
          subtests: workingDoc.subtests.map((s) =>
            s.draftId !== subtest.draftId
              ? s
              : {
                  ...s,
                  id: subtestId,
                  defaultRuleId: s.defaultRuleId ?? createdRule.id,
                  items: s.items.map((it) =>
                    isActiveDraftNode(it) &&
                    it.answerKey !== null &&
                    isActiveDraftNode(it.answerKey) &&
                    it.answerKey.ruleId === null
                      ? { ...it, answerKey: { ...it.answerKey, ruleId: createdRule.id } }
                      : it,
                  ),
                },
          ),
        };
        if (workingBaseline) {
          workingBaseline = applyBaselineRuleId(
            workingBaseline,
            subtestId,
            subtest.code,
            createdRule.id,
          );
        }
        emitCommitted();

        scope?.assertCurrent();
        const tpl = await getSubtestCloneTemplate(subtestId);
        templateCache.set(subtestId, tpl);

        const itemsWithDeferredKey = subtest.items.filter(
          (item) =>
            isActiveDraftNode(item) &&
            item.answerKey !== null &&
            isActiveDraftNode(item.answerKey) &&
            item.answerKey.ruleId === null,
        );

        if (itemsWithDeferredKey.length === 0) continue;

        const pass2Items: ItemDraft[] = itemsWithDeferredKey.map((item) => {
          const key = item.answerKey!;
          const tplItem = tpl.items.find(
            (ti) =>
              (item.id !== null && ti.sourceItemId === item.id) ||
              codeKey(ti.code) === codeKey(item.code),
          );
          if (!tplItem) {
            throw new ApiError({
              status: 500,
              code: "ITEM_NOT_PERSISTED",
              message: `No se encontró el ítem "${item.code}" tras guardar la estructura.`,
            });
          }

          let persistedOptionId = key.correctOptionId;
          if (key.correctOptionDraftId !== null) {
            const docOpt = item.options.find(
              (opt) => isActiveDraftNode(opt) && opt.draftId === key.correctOptionDraftId,
            );
            if (docOpt) {
              const tplOpt = tplItem.options.find(
                (to) =>
                  (docOpt.id !== null && to.sourceOptionId === docOpt.id) ||
                  codeKey(to.code) === codeKey(docOpt.code),
              );
              if (tplOpt) {
                persistedOptionId = tplOpt.sourceOptionId;
              }
            }
          }

          const existingKeyId = key.id ?? tplItem.answerKey?.sourceAnswerKeyId ?? null;

          return {
            id: tplItem.sourceItemId,
            draftId: item.draftId,
            sourceId: null,
            status: "UPDATED",
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
            images: [],
            options: [],
            answerKey: {
              id: existingKeyId,
              draftId: key.draftId,
              sourceId: null,
              status: existingKeyId !== null ? "UPDATED" : "CREATED",
              ruleId: createdRule.id,
              correctOptionDraftId: null,
              correctOptionId: persistedOptionId,
              expectedText: key.expectedText,
              expectedNumber: key.expectedNumber,
              numericTolerance: key.numericTolerance,
              score: key.score,
              requiresManualReview: key.requiresManualReview,
            },
          };
        });

        pass2Subtests.push({
          id: subtestId,
          draftId: subtest.draftId,
          sourceId: null,
          status: "UPDATED",
          code: subtest.code,
          name: subtest.name,
          description: subtest.description,
          instructions: subtest.instructions,
          order: subtest.order,
          timeLimitSeconds: subtest.timeLimitSeconds,
          randomizeItems: document.version.randomizeItems ? subtest.randomizeItems : false,
          randomizeOptions: subtest.randomizeOptions,
          required: subtest.required,
          strategyId: subtest.strategyId,
          items: pass2Items,
        });
      }

      const pass2SubtestIds = new Set(needingRule.map((s) => s.draftId));

      if (pass2Subtests.length > 0) {
        scope?.assertCurrent();
        attemptedMutation = true;
        const pass2Payload = { subtests: pass2Subtests };
        recordSentConfiguration(workingSent, workingDoc, pass2Payload);
        await saveVersionConfiguration(versionId, pass2Payload);
        clearSentConfiguration(workingSent, pass2Payload);
        mutatedBeyondMetadata = true;
      }

      workingDoc = {
        ...workingDoc,
        subtests: workingDoc.subtests.map((s) =>
          !pass2SubtestIds.has(s.draftId)
            ? s
            : {
                ...s,
                items: s.items.map((it) =>
                  it.answerKey && isActiveDraftNode(it.answerKey)
                    ? { ...it, answerKey: { ...it.answerKey, status: "EXISTING" } }
                    : it,
                ),
              },
        ),
      };
      if (pass2Subtests.length > 0 && workingBaseline) {
        workingBaseline = applyPass2KeysToBaseline(workingBaseline, workingDoc, pass2SubtestIds);
      }
      markCompletedStep("scoring");
      emitCommitted("scoring");
    }

    // 4. Imágenes pendientes (borrados obsoletos y subidas/reemplazos)
    if (pendingItemImageDeletes.length > 0 || pendingUploads.length > 0) {
      for (const del of pendingItemImageDeletes) {
        scope?.assertCurrent();
        attemptedMutation = true;
        const delSentKey = sentKey.itemImage(del.subtestDraftId, del.itemDraftId, del.imageDraftId);
        workingSent.nodes[delSentKey] = { op: "DELETED", sig: "" };
        await deleteItemImage(del.imageId);
        delete workingSent.nodes[delSentKey];
        mutatedBeyondMetadata = true;

        const stripDeletedImage = (docToUpdate: VersionDocument): VersionDocument => ({
          ...docToUpdate,
          subtests: docToUpdate.subtests.map((s) =>
            s.draftId !== del.subtestDraftId
              ? s
              : {
                  ...s,
                  items: s.items.map((it) =>
                    it.draftId !== del.itemDraftId
                      ? it
                      : {
                          ...it,
                          images: it.images.filter(
                            (img) => img.draftId !== del.imageDraftId && img.id !== del.imageId,
                          ),
                        },
                  ),
                },
          ),
        });
        workingDoc = stripDeletedImage(workingDoc);
        if (workingBaseline) {
          workingBaseline = stripDeletedImage(workingBaseline);
        }
        emitCommitted();
      }

      const subtestByDraftId = new Map<string, DocumentSubtest>();
      for (const s of workingDoc.subtests) {
        if (isActiveDraftNode(s)) {
          subtestByDraftId.set(s.draftId, s);
        }
      }

      const uniqueSubtestDraftIds = Array.from(
        new Set(pendingUploads.map((u) => u.subtestDraftId)),
      );
      for (const subtestDraftId of uniqueSubtestDraftIds) {
        const docSubtest = subtestByDraftId.get(subtestDraftId);
        if (!docSubtest) continue;
        const subtestId = await resolvePersistedSubtestId(docSubtest);
        if (!templateCache.has(subtestId)) {
          scope?.assertCurrent();
          const tpl = await getSubtestCloneTemplate(subtestId);
          templateCache.set(subtestId, tpl);
        }
      }

      for (const upload of pendingUploads) {
        scope?.assertCurrent();
        const docSubtest = subtestByDraftId.get(upload.subtestDraftId);
        if (!docSubtest) continue;
        const subtestId = await resolvePersistedSubtestId(docSubtest);
        const template = templateCache.get(subtestId)!;
        const docItem = docSubtest.items.find(
          (i) => i.draftId === upload.itemDraftId && isActiveDraftNode(i),
        );
        if (!docItem) continue;

        const tplItem = template.items.find(
          (ti) =>
            (docItem.id !== null && ti.sourceItemId === docItem.id) ||
            codeKey(ti.code) === codeKey(docItem.code),
        );
        if (!tplItem) {
          throw new ApiError({
            status: 500,
            code: "ITEM_NOT_PERSISTED",
            message: `No se encontró el ítem "${docItem.code}" para subir imagen.`,
          });
        }

        const file = pendingFiles[upload.pendingFileId]!;
        const slotKey = uploadSlotKey({
          subtestDraftId: upload.subtestDraftId,
          itemDraftId: upload.itemDraftId,
          optionDraftId: upload.optionDraftId,
          order: upload.order,
        });
        const uploadIdentity = {
          pendingFileId: upload.pendingFileId,
          fileName: file.name ?? upload.fileName ?? null,
          fileSize: typeof file.size === "number" ? file.size : undefined,
          lastModified: typeof file.lastModified === "number" ? file.lastModified : undefined,
        };

        if (upload.ownerKind === "item") {
          attemptedMutation = true;
          let uploaded;
          try {
            uploaded = upload.replaceByOrder
              ? await replaceItemImageByOrder(tplItem.sourceItemId, upload.order, {
                  file,
                  altText: upload.altText,
                  role: upload.role ?? "ENUNCIADO",
                })
              : await uploadItemImage(tplItem.sourceItemId, {
                  file,
                  order: upload.order,
                  altText: upload.altText,
                  role: upload.role ?? "ENUNCIADO",
                });
          } catch (uploadCause) {
            if (isUncertainMutationError(uploadCause)) {
              workingSent.uploads[slotKey] = {
                subtestDraftId: upload.subtestDraftId,
                itemDraftId: upload.itemDraftId,
                optionDraftId: null,
                order: upload.order,
                ...uploadIdentity,
                altText: upload.altText,
                role: upload.role ?? "ENUNCIADO",
              };
            }
            throw uploadCause;
          }
          delete workingSent.uploads[slotKey];
          mutatedBeyondMetadata = true;
          const persistedImg: DocumentImage = {
            id: uploaded.imageLinkId,
            draftId: upload.imageDraftId,
            sourceId: null,
            resourceId: uploaded.resourceId,
            pendingFileId: null,
            previewUrl: `/items/images/resources/${uploaded.resourceId}`,
            status: "EXISTING",
            order: uploaded.order,
            altText: uploaded.altText ?? upload.altText,
            role: uploaded.role ?? upload.role,
            fileName: uploaded.fileName,
            storagePath: uploaded.storagePath,
          };
          workingDoc = {
            ...workingDoc,
            subtests: workingDoc.subtests.map((s) =>
              s.draftId !== upload.subtestDraftId
                ? s
                : {
                    ...s,
                    items: s.items.map((it) =>
                      it.draftId !== upload.itemDraftId
                        ? it
                        : {
                            ...it,
                            images: it.images.map((img) =>
                              img.draftId !== upload.imageDraftId ? img : persistedImg,
                            ),
                          },
                    ),
                  },
            ),
          };
          if (workingBaseline) {
            workingBaseline = applyUploadedImageToBaseline(workingBaseline, {
              ownerKind: "item",
              subtestId,
              subtestCode: docSubtest.code,
              itemCode: docItem.code,
              image: persistedImg,
            });
          }
          emitCommitted();
        } else {
          const docOption = docItem.options.find(
            (opt) => opt.draftId === upload.optionDraftId && isActiveDraftNode(opt),
          );
          if (!docOption) continue;

          const tplOpt = tplItem.options.find(
            (to) =>
              (docOption.id !== null && to.sourceOptionId === docOption.id) ||
              codeKey(to.code) === codeKey(docOption.code),
          );
          if (!tplOpt) {
            throw new ApiError({
              status: 500,
              code: "OPTION_NOT_PERSISTED",
              message: `No se encontró la opción "${docOption.code}" para subir imagen.`,
            });
          }

          attemptedMutation = true;
          let uploaded;
          try {
            uploaded = upload.replaceByOrder
              ? await replaceOptionImageByOrder(tplOpt.sourceOptionId, upload.order, {
                  file,
                  altText: upload.altText,
                })
              : await uploadOptionImage(tplOpt.sourceOptionId, {
                  file,
                  order: upload.order,
                  altText: upload.altText,
                });
          } catch (uploadCause) {
            if (isUncertainMutationError(uploadCause)) {
              workingSent.uploads[slotKey] = {
                subtestDraftId: upload.subtestDraftId,
                itemDraftId: upload.itemDraftId,
                optionDraftId: upload.optionDraftId,
                order: upload.order,
                ...uploadIdentity,
                altText: upload.altText,
                role: upload.role,
              };
            }
            throw uploadCause;
          }
          delete workingSent.uploads[slotKey];
          mutatedBeyondMetadata = true;
          const persistedOptImg: DocumentImage = {
            id: uploaded.imageLinkId,
            draftId: upload.imageDraftId,
            sourceId: null,
            resourceId: uploaded.resourceId,
            pendingFileId: null,
            previewUrl: `/items/images/resources/${uploaded.resourceId}`,
            status: "EXISTING",
            order: uploaded.order,
            altText: uploaded.altText ?? upload.altText,
            role: uploaded.role ?? upload.role,
            fileName: uploaded.fileName,
            storagePath: uploaded.storagePath,
          };
          workingDoc = {
            ...workingDoc,
            subtests: workingDoc.subtests.map((s) =>
              s.draftId !== upload.subtestDraftId
                ? s
                : {
                    ...s,
                    items: s.items.map((it) =>
                      it.draftId !== upload.itemDraftId
                        ? it
                        : {
                            ...it,
                            options: it.options.map((opt) =>
                              opt.draftId !== upload.optionDraftId
                                ? opt
                                : {
                                    ...opt,
                                    images: opt.images.map((img) =>
                                      img.draftId !== upload.imageDraftId ? img : persistedOptImg,
                                    ),
                                  },
                            ),
                          },
                    ),
                  },
            ),
          };
          if (workingBaseline) {
            workingBaseline = applyUploadedImageToBaseline(workingBaseline, {
              ownerKind: "option",
              subtestId,
              subtestCode: docSubtest.code,
              itemCode: docItem.code,
              optionCode: docOption.code,
              image: persistedOptImg,
            });
          }
          emitCommitted();
        }
      }
      markCompletedStep("images");
      emitCommitted("images");
    }

    // 5. Baremos y rangos
    if (dirtyActiveBaremos.length > 0) {
      for (const baremo of dirtyActiveBaremos) {
        scope?.assertCurrent();

        const baremoPayload: BaremoPayload = {
          versionId,
          dimensionId: baremo.dimensionId,
          code: baremo.code.trim(),
          name: baremo.name.trim(),
          description: baremo.description.trim() ? baremo.description : null,
          normativeGroup: baremo.normativeGroup.trim() ? baremo.normativeGroup : null,
        };

        let baremoId: number;
        let baremoMutated = false;
        if (baremo.id === null) {
          attemptedMutation = true;
          recordSentBaremo(workingSent, baremo, "CREATED");
          const savedBaremo = await createBaremo(baremoPayload);
          delete workingSent.nodes[sentKey.baremo(baremo.draftId)];
          baremoId = savedBaremo.id;
          baremoMutated = true;
        } else if (baremo.status === "UPDATED") {
          attemptedMutation = true;
          recordSentBaremo(workingSent, baremo, "UPDATED");
          await updateBaremo(baremo.id, baremoPayload);
          delete workingSent.nodes[sentKey.baremo(baremo.draftId)];
          baremoId = baremo.id;
          baremoMutated = true;
        } else {
          baremoId = baremo.id;
        }

        if (baremoMutated) {
          mutatedBeyondMetadata = true;
          workingDoc = {
            ...workingDoc,
            baremos: workingDoc.baremos.map((b) =>
              b.draftId === baremo.draftId ? { ...b, id: baremoId, status: "EXISTING" } : b,
            ),
          };
          if (workingBaseline) {
            workingBaseline = applyBaremoToBaseline(workingBaseline, baremo, baremoId);
          }
          emitCommitted();
        }

        for (const range of baremo.ranges) {
          if (range.status !== "CREATED" && range.status !== "UPDATED") continue;

          scope?.assertCurrent();
          const rangePayload: BaremoRangePayload = {
            minScore: range.minScore,
            maxScore: range.maxScore,
            percentile: range.percentile,
            category: range.category.trim(),
            interpretation: range.interpretation.trim() ? range.interpretation : null,
            recommendation: range.recommendation.trim() ? range.recommendation : null,
            order: range.order,
          };

          let savedRangeId: number;
          if (range.id === null) {
            attemptedMutation = true;
            recordSentRange(workingSent, baremo.draftId, range, "CREATED");
            const createdRange = await createBaremoRange(baremoId, rangePayload);
            delete workingSent.nodes[sentKey.range(baremo.draftId, range.draftId)];
            savedRangeId = createdRange.id;
          } else {
            attemptedMutation = true;
            recordSentRange(workingSent, baremo.draftId, range, "UPDATED");
            await updateBaremoRange(range.id, rangePayload);
            delete workingSent.nodes[sentKey.range(baremo.draftId, range.draftId)];
            savedRangeId = range.id;
          }
          mutatedBeyondMetadata = true;

          workingDoc = {
            ...workingDoc,
            baremos: workingDoc.baremos.map((b) =>
              b.draftId !== baremo.draftId
                ? b
                : {
                    ...b,
                    ranges: b.ranges.map((r) =>
                      r.draftId === range.draftId
                        ? { ...r, id: savedRangeId, status: "EXISTING" }
                        : r,
                    ),
                  },
            ),
          };
          if (workingBaseline) {
            workingBaseline = applyBaremoRangeToBaseline(
              workingBaseline,
              baremoId,
              baremo.draftId,
              range,
              savedRangeId,
            );
          }
          emitCommitted();
        }
      }
      markCompletedStep("baremos");
      emitCommitted("baremos");
    }

    // 6. Recarga autoritativa
    return await loadVersionDocument(versionId, {
      testId: workingDoc.version.testId,
      scope,
    });
  } catch (cause) {
    if (scope && !scope.isCurrent()) {
      throw cause;
    }

    const shouldReconcile =
      completedSteps.length > 0 ||
      mutatedBeyondMetadata ||
      (attemptedMutation && isUncertainMutationError(cause));

    if (!shouldReconcile) {
      throw cause;
    }

    let reconciliationPending = false;
    try {
      scope?.assertCurrent();
      const serverSnapshot = await loadVersionDocument(versionId, {
        testId: workingDoc.version.testId,
        scope,
      });
      const theirs = structuredClone(serverSnapshot.document);
      const reconciled = reconcileVersionDocumentThreeWay({
        base: workingBaseline ?? theirs,
        mine: workingDoc,
        theirs,
        sent: workingSent,
        pendingFiles,
      });

      if (reconciled.conflicts.length > 0) {
        workingDoc = { ...workingDoc, dirtyNodeIds: getDirtyNodeIds(workingDoc) };
        emitCommitted(undefined, false);
        throw new VersionConflictError(reconciled.conflicts);
      }

      workingDoc = reconciled.document;
      workingBaseline = theirs;
      workingSent = reconciled.sent;

      const remainingSteps = computePendingSteps(workingDoc);
      if (remainingSteps.length === 0) {
        return serverSnapshot;
      }

      workingDoc = { ...workingDoc, dirtyNodeIds: getDirtyNodeIds(workingDoc) };
      const reconciledSignature = documentSignature(workingBaseline);

      throw new PartialSaveError({
        cause,
        completedSteps,
        pendingSteps: remainingSteps,
        document: workingDoc,
        baselineDocument: workingBaseline,
        baselineSignature: reconciledSignature,
        reconciliationPending: false,
        sent: workingSent,
      });
    } catch (reloadCause) {
      if (reloadCause instanceof VersionConflictError || reloadCause instanceof PartialSaveError) {
        throw reloadCause;
      }
      if (scope && !scope.isCurrent()) {
        throw reloadCause;
      }
      reconciliationPending = true;
    }

    workingDoc = { ...workingDoc, dirtyNodeIds: getDirtyNodeIds(workingDoc) };
    const reconciledSignature = workingBaseline
      ? documentSignature(workingBaseline)
      : input.baselineSignature;
    const pendingSteps = plannedSteps.filter((step) => !completedInThisAttempt.has(step));

    throw new PartialSaveError({
      cause,
      completedSteps,
      pendingSteps,
      document: workingDoc,
      baselineDocument: workingBaseline,
      baselineSignature: reconciledSignature,
      reconciliationPending,
      sent: workingSent,
    });
  }
}

const UNMAPPABLE_PARAM_KEY_PATTERN =
  /^(dimension_?(resultado_?)?ids?|rubrica_?id|criterio_?rubrica_?id|nivel_?criterio_?rubrica_?id|baremo_?id|opcion_?puntaje_?dimension_?id)$/i;

function collectUnmappableParamKeys(value: unknown, found: Set<string>): void {
  if (Array.isArray(value)) {
    for (const entry of value) collectUnmappableParamKeys(entry, found);
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, prop] of Object.entries(value as Record<string, unknown>)) {
      if (UNMAPPABLE_PARAM_KEY_PATTERN.test(key)) {
        const hasValue = Array.isArray(prop) ? prop.length > 0 : prop !== null && prop !== undefined && prop !== "";
        if (hasValue) found.add(key);
      }
      collectUnmappableParamKeys(prop, found);
    }
  }
}

function getUncopiableRuleReason(
  rule: ScoringRule,
  subtest: DocumentSubtest,
  effectiveStrategyId: number | null,
): string | null {
  if (!rule.active) {
    return "La regla está inactiva y el endpoint disponible solo crea reglas activas.";
  }
  if (rule.ruleType === "OPCION_DIMENSION") {
    return "Las reglas OPCION_DIMENSION dependen de la matriz opción-dimensión (opcion_puntaje_dimension), sin endpoints disponibles para copiarla.";
  }
  if (rule.ruleType === "RUBRICA") {
    return "Las reglas RUBRICA dependen de rúbricas, criterios y niveles sin endpoints disponibles para copiarlos.";
  }
  if (effectiveStrategyId === null) {
    return "La regla no tiene estrategia de calificación configurada.";
  }
  if (rule.itemId !== null) {
    const hasMappedItem = subtest.items.some(
      (item) => isActiveDraftNode(item) && item.id === rule.itemId,
    );
    if (!hasMappedItem) {
      return `La regla apunta a un ítem (#${rule.itemId}) ausente entre los ítems activos del subtest.`;
    }
  }

  const rawParams = rule.parametersJson.trim();
  if (rawParams !== "") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawParams);
    } catch {
      return "El JSON de parámetros de la regla no es válido y no puede verificarse para la copia.";
    }
    const unmappable = new Set<string>();
    collectUnmappableParamKeys(parsed, unmappable);
    if (unmappable.size > 0) {
      return `Los parámetros referencian entidades ligadas a la versión origen (${Array.from(unmappable).join(", ")}) que no pueden remapease con los endpoints disponibles.`;
    }
  }

  return null;
}

function hashClonePlanPayload(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input.charCodeAt(i);
    h1 ^= ch;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ ch, 0x85ebca6b) >>> 0;
    h2 ^= h2 >>> 13;
  }
  return `${h1.toString(16).padStart(8, "0")}-${h2.toString(16).padStart(8, "0")}-${input.length}`;
}

export function getVersionClonePlanSignature(
  plan: Omit<VersionClonePlan, "signature">,
  options?: VersionClonePlanSignatureOptions,
): string {
  const includeScoring = options?.canConfigureScoring !== false;
  const includeBaremos =
    options?.canConfigureBaremos !== false && options?.copyBaremos !== false;

  const scoringPart = includeScoring
    ? {
        omittedRules: [...plan.omittedRules]
          .map((r) => ({
            subtestCode: normalizeCode(r.subtestCode),
            subtestName: r.subtestName,
            ruleId: r.rule.id,
            ruleType: r.rule.ruleType,
            priority: r.rule.priority,
            reason: r.reason ?? "",
          }))
          .sort((a, b) => a.ruleId - b.ruleId || a.subtestCode.localeCompare(b.subtestCode)),
        omittedAnswerKeyCount: plan.omittedAnswerKeyCount,
        copiableRules: [...plan.copiableRules]
          .map((r) => ({
            subtestCode: normalizeCode(r.subtestCode),
            ruleId: r.rule.id,
            ruleType: r.rule.ruleType,
            priority: r.rule.priority,
            effectiveStrategyId: r.effectiveStrategyId,
            mappedItemDraftId: r.mappedItemDraftId,
            parametersJson: r.rule.parametersJson,
            observation: r.rule.observation ?? "",
          }))
          .sort((a, b) => a.ruleId - b.ruleId || a.subtestCode.localeCompare(b.subtestCode)),
      }
    : null;

  const baremosPart = includeBaremos
    ? {
        omittedBaremos: [...plan.omittedBaremos]
          .map((b) => ({
            id: b.baremo.id,
            code: normalizeCode(b.baremo.code),
            name: b.baremo.name,
            dimensionId: b.baremo.dimensionId,
            reason: b.reason,
          }))
          .sort((a, b) => (a.id ?? -1) - (b.id ?? -1) || a.code.localeCompare(b.code)),
        copiableBaremos: [...plan.copiableBaremos]
          .map((b) => ({
            id: b.id,
            code: normalizeCode(b.code),
            name: b.name,
            description: b.description,
            normativeGroup: b.normativeGroup,
            dimensionId: b.dimensionId,
            ranges: b.ranges
              .filter(isActiveDraftNode)
              .map((r) => [
                r.id,
                r.minScore,
                r.maxScore,
                r.percentile,
                r.category,
                r.interpretation,
                r.recommendation,
                r.order,
              ]),
          }))
          .sort((a, b) => (a.id ?? -1) - (b.id ?? -1) || a.code.localeCompare(b.code)),
      }
    : null;

  return hashClonePlanPayload(JSON.stringify({ scoring: scoringPart, baremos: baremosPart }));
}

export function buildVersionClonePlan(
  sourceLoaded: LoadedVersionDocument,
  options?: { targetStrategyId?: number | null },
): VersionClonePlan {
  const activeSourceSubtests = sourceLoaded.document.subtests.filter(isActiveDraftNode);
  const copiableRules: CloneRulePlanItem[] = [];
  const omittedRules: CloneRulePlanItem[] = [];
  const copiableRuleIds = new Set<number>();
  const copiableSubtestIdsWithRules = new Set<string>();

  for (const subtest of activeSourceSubtests) {
    const rules = sourceLoaded.scoringRulesBySubtestId[subtest.id ?? -1] ?? [];
    for (const rule of rules) {
      const effectiveStrategyId =
        rule.strategyId ??
        subtest.strategyId ??
        options?.targetStrategyId ??
        sourceLoaded.document.version.strategyId;

      const mappedItemDraftId =
        rule.itemId !== null
          ? (subtest.items.find((it) => isActiveDraftNode(it) && it.id === rule.itemId)?.draftId ?? null)
          : null;

      const reason = getUncopiableRuleReason(rule, subtest, effectiveStrategyId);
      const item: CloneRulePlanItem = {
        subtestDraftId: subtest.draftId,
        subtestCode: subtest.code,
        subtestName: subtest.name,
        rule,
        effectiveStrategyId,
        mappedItemDraftId,
        ...(reason ? { reason } : {}),
      };
      if (reason) {
        omittedRules.push(item);
      } else {
        copiableRules.push(item);
        copiableRuleIds.add(rule.id);
        copiableSubtestIdsWithRules.add(subtest.draftId);
      }
    }
  }

  let omittedAnswerKeyCount = 0;
  for (const subtest of activeSourceSubtests) {
    for (const item of subtest.items) {
      if (!isActiveDraftNode(item) || !item.answerKey || !isActiveDraftNode(item.answerKey)) continue;
      const key = item.answerKey;
      if (key.ruleId !== null && !copiableRuleIds.has(key.ruleId)) {
        omittedAnswerKeyCount += 1;
      }
    }
  }

  const activeBaremos = sourceLoaded.document.baremos.filter(isActiveDraftNode);
  const copiableBaremos: DocumentBaremo[] = [];
  const omittedBaremos: CloneBaremoPlanItem[] = [];
  for (const baremo of activeBaremos) {
    if (baremo.dimensionId === null) {
      copiableBaremos.push(baremo);
    } else {
      omittedBaremos.push({
        baremo,
        reason: `Asociado a la dimensión #${baremo.dimensionId}; los endpoints disponibles no permiten clonar dimensiones de resultado hacia la versión destino.`,
      });
    }
  }

  const hasOmissions =
    omittedRules.length > 0 || omittedAnswerKeyCount > 0 || omittedBaremos.length > 0;

  const basePlan = {
    sourceLoaded,
    copiableRules,
    omittedRules,
    omittedAnswerKeyCount,
    copiableBaremos,
    omittedBaremos,
    hasOmissions,
  };

  return {
    ...basePlan,
    signature: getVersionClonePlanSignature(basePlan),
  };
}

export async function inspectVersionClonePlan(
  testId: number,
  sourceVersionId: number,
  options?: { targetStrategyId?: number | null; scope?: AccountScope },
): Promise<VersionClonePlan> {
  options?.scope?.assertCurrent();
  const sourceLoaded = await loadVersionDocument(sourceVersionId, {
    testId,
    scope: options?.scope,
  });
  return buildVersionClonePlan(sourceLoaded, { targetStrategyId: options?.targetStrategyId });
}

export async function cloneVersionFromSource(
  input: CloneVersionFromSourceInput,
): Promise<CloneVersionFromSourceResult> {
  const {
    testId,
    sourceVersionId,
    versionPayload,
    permissions,
    copyBaremos,
    expectedPlanSignature,
    scope,
  } = input;

  if (!permissions.canEdit) {
    throw new ApiError({
      status: 403,
      code: "FORBIDDEN_EDIT",
      message: "No tienes permiso para clonar versiones de este instrumento (TEST_CREAR).",
    });
  }

  scope?.assertCurrent();
  const plan = await inspectVersionClonePlan(testId, sourceVersionId, {
    targetStrategyId: versionPayload.strategyId ?? null,
    scope,
  });

  if (expectedPlanSignature !== undefined) {
    const freshSignature = getVersionClonePlanSignature(plan, {
      copyBaremos,
      canConfigureScoring: permissions.canConfigureScoring,
      canConfigureBaremos: permissions.canConfigureBaremos,
    });
    if (freshSignature !== expectedPlanSignature) {
      return {
        status: "plan_changed",
        plan,
      };
    }
  }

  const { sourceLoaded } = plan;

  scope?.assertCurrent();
  const createdVersion = await createVersion(testId, versionPayload);

  try {
    // Pass 1: estructura + imágenes sin claves
    const pass1Payload = buildCloneConfiguration(sourceLoaded.document, {
      ruleIdBySubtestDraftId: {},
      omitAnswerKeysWithoutRuleId: true,
    });

    let persistedSubtests: Subtest[] = [];
    if (pass1Payload.subtests.length > 0) {
      scope?.assertCurrent();
      persistedSubtests = await saveVersionConfiguration(createdVersion.id, pass1Payload);
    }

    // Pass 2: reglas y claves en la nueva versión
    const activeSourceSubtests = sourceLoaded.document.subtests.filter(isActiveDraftNode);
    const subtestsWithOriginScoring = activeSourceSubtests.filter((subtest) => {
      const hasActiveKeys = subtest.items.some(
        (item) =>
          isActiveDraftNode(item) && item.answerKey !== null && isActiveDraftNode(item.answerKey),
      );
      const hasRules = (sourceLoaded.scoringRulesBySubtestId[subtest.id ?? -1] ?? []).length > 0;
      return hasActiveKeys || hasRules;
    });

    const warnings: string[] = [];
    let copiedAnswerKeys = false;

    if (subtestsWithOriginScoring.length > 0) {
      if (!permissions.canConfigureScoring) {
        warnings.push(
          "La versión se clonó sin reglas ni claves de respuesta porque no cuentas con el permiso CALIFICACION_CONFIGURAR.",
        );
      } else {
        const newSubtestIdBySourceDraftId = new Map<string, number>();
        const newRuleIdBySourceRuleId = new Map<number, number>();
        const fallbackRuleIdBySubtestDraftId = new Map<string, number>();
        const templateByNewSubtestId = new Map<number, SubtestCloneTemplate>();

        for (const omitted of plan.omittedRules) {
          warnings.push(
            `Regla ${omitted.rule.ruleType} (prioridad ${omitted.rule.priority}) del subtest "${omitted.subtestName || omitted.subtestCode}" omitida: ${omitted.reason}`,
          );
        }

        for (const subtest of subtestsWithOriginScoring) {
          const persisted = persistedSubtests.find(
            (ps) => normalizeCode(ps.code) === normalizeCode(subtest.code),
          );
          if (!persisted) continue;
          const newSubtestId = persisted.id;
          newSubtestIdBySourceDraftId.set(subtest.draftId, newSubtestId);

          const subtestCopiableRules = plan.copiableRules.filter(
            (r) => r.subtestDraftId === subtest.draftId,
          );
          const subtestOmittedRules = plan.omittedRules.filter(
            (r) => r.subtestDraftId === subtest.draftId,
          );
          const hasItemLevelRules = subtestCopiableRules.some((r) => r.mappedItemDraftId !== null);
          const activeItemsWithKey = subtest.items.filter(
            (item) =>
              isActiveDraftNode(item) &&
              item.answerKey !== null &&
              isActiveDraftNode(item.answerKey),
          );

          let tpl: SubtestCloneTemplate | undefined;
          if (hasItemLevelRules || activeItemsWithKey.length > 0) {
            scope?.assertCurrent();
            tpl = await getSubtestCloneTemplate(newSubtestId);
            templateByNewSubtestId.set(newSubtestId, tpl);
          }

          if (subtestCopiableRules.length > 0) {
            for (const rulePlan of subtestCopiableRules) {
              let mappedItemId: number | null = null;
              if (rulePlan.mappedItemDraftId !== null && tpl) {
                const srcItem = subtest.items.find((it) => it.draftId === rulePlan.mappedItemDraftId);
                if (srcItem) {
                  const tplItem = tpl.items.find(
                    (ti) => normalizeCode(ti.code) === normalizeCode(srcItem.code),
                  );
                  mappedItemId = tplItem ? tplItem.sourceItemId : null;
                }
              }

              const strategyId =
                rulePlan.effectiveStrategyId ??
                subtest.strategyId ??
                createdVersion.strategyId ??
                sourceLoaded.document.version.strategyId;

              if (strategyId === null) continue;

              scope?.assertCurrent();
              const createdRule = await createScoringRule(newSubtestId, {
                strategyId,
                ruleType: rulePlan.rule.ruleType,
                itemId: mappedItemId,
                priority: rulePlan.rule.priority,
                parametersJson: rulePlan.rule.parametersJson.trim()
                  ? rulePlan.rule.parametersJson
                  : "{}",
                observation: rulePlan.rule.observation,
              });
              newRuleIdBySourceRuleId.set(rulePlan.rule.id, createdRule.id);

              if (
                !fallbackRuleIdBySubtestDraftId.has(subtest.draftId) ||
                rulePlan.rule.ruleType === "CLAVE_ITEM"
              ) {
                fallbackRuleIdBySubtestDraftId.set(subtest.draftId, createdRule.id);
              }
              copiedAnswerKeys = true;
            }
          } else if (subtestOmittedRules.length === 0 && activeItemsWithKey.length > 0) {
            const effectiveStrategyId =
              subtest.strategyId ??
              createdVersion.strategyId ??
              sourceLoaded.document.version.strategyId;

            if (effectiveStrategyId === null) {
              warnings.push(
                `El subtest "${subtest.name || subtest.code}" se clonó sin regla de calificación porque no tiene estrategia configurada.`,
              );
              continue;
            }

            scope?.assertCurrent();
            const createdRule = await createScoringRule(newSubtestId, {
              strategyId: effectiveStrategyId,
              ruleType: "CLAVE_ITEM",
              priority: 1,
              parametersJson: "{}",
            });
            fallbackRuleIdBySubtestDraftId.set(subtest.draftId, createdRule.id);
            copiedAnswerKeys = true;
          }
        }

        const pass2Subtests: SubtestDraft[] = [];

        for (const subtest of subtestsWithOriginScoring) {
          const newSubtestId = newSubtestIdBySourceDraftId.get(subtest.draftId);
          if (newSubtestId === undefined) continue;

          const activeItemsWithKey = subtest.items.filter(
            (item) =>
              isActiveDraftNode(item) &&
              item.answerKey !== null &&
              isActiveDraftNode(item.answerKey),
          );
          if (activeItemsWithKey.length === 0) continue;

          const tpl = templateByNewSubtestId.get(newSubtestId) ?? (await getSubtestCloneTemplate(newSubtestId));
          const pass2Items: ItemDraft[] = [];

          for (const srcItem of activeItemsWithKey) {
            const srcKey = srcItem.answerKey!;
            const resolvedRuleId =
              srcKey.ruleId !== null
                ? newRuleIdBySourceRuleId.get(srcKey.ruleId)
                : fallbackRuleIdBySubtestDraftId.get(subtest.draftId);

            if (resolvedRuleId === undefined) {
              warnings.push(
                `Clave de respuesta del ítem "${srcItem.code}" omitida porque su regla origen no pudo copiarse.`,
              );
              continue;
            }

            const tplItem = tpl.items.find(
              (ti) => normalizeCode(ti.code) === normalizeCode(srcItem.code),
            );
            if (!tplItem) {
              throw new ApiError({
                status: 500,
                code: "CLONE_ITEM_NOT_FOUND",
                message: `No se encontró el ítem clonado "${srcItem.code}" en el subtest destino.`,
              });
            }

            let mappedNewOptionId: number | null = null;
            const activeSrcOptions = srcItem.options.filter(isActiveDraftNode);
            const matchedSrcOption =
              (srcKey.correctOptionDraftId !== null
                ? activeSrcOptions.find((o) => o.draftId === srcKey.correctOptionDraftId)
                : undefined) ??
              (srcKey.correctOptionId !== null
                ? activeSrcOptions.find((o) => o.id === srcKey.correctOptionId)
                : undefined);

            if (matchedSrcOption) {
              const matchedTplOpt = tplItem.options.find(
                (to) => normalizeCode(to.code) === normalizeCode(matchedSrcOption.code),
              );
              mappedNewOptionId = matchedTplOpt ? matchedTplOpt.sourceOptionId : null;
            }

            pass2Items.push({
              id: tplItem.sourceItemId,
              draftId: `item-${tplItem.sourceItemId}`,
              sourceId: srcItem.id,
              status: "UPDATED",
              code: srcItem.code,
              itemType: srcItem.itemType,
              responseType: srcItem.responseType,
              prompt: srcItem.prompt,
              instruction: srcItem.instruction,
              order: srcItem.order,
              baseScore: srcItem.baseScore,
              timeLimitSeconds: srcItem.timeLimitSeconds,
              required: srcItem.required,
              confidential: srcItem.confidential,
              images: [],
              options: [],
              answerKey: {
                id: null,
                draftId: `key-${tplItem.sourceItemId}`,
                sourceId: srcKey.id,
                status: "CREATED",
                ruleId: resolvedRuleId,
                correctOptionDraftId: null,
                correctOptionId: mappedNewOptionId,
                expectedText: srcKey.expectedText,
                expectedNumber: srcKey.expectedNumber,
                numericTolerance: srcKey.numericTolerance,
                score: srcKey.score,
                requiresManualReview: srcKey.requiresManualReview,
              },
            });
          }

          if (pass2Items.length > 0) {
            pass2Subtests.push({
              id: newSubtestId,
              draftId: `sub-${newSubtestId}`,
              sourceId: subtest.id,
              status: "UPDATED",
              code: subtest.code,
              name: subtest.name,
              description: subtest.description,
              instructions: subtest.instructions,
              order: subtest.order,
              timeLimitSeconds: subtest.timeLimitSeconds,
              randomizeItems: createdVersion.randomizeItems ? subtest.randomizeItems : false,
              randomizeOptions: subtest.randomizeOptions,
              required: subtest.required,
              strategyId: subtest.strategyId,
              items: pass2Items,
            });
          }
        }

        if (pass2Subtests.length > 0) {
          scope?.assertCurrent();
          await saveVersionConfiguration(createdVersion.id, { subtests: pass2Subtests });
          copiedAnswerKeys = true;
        }
      }
    } else {
      copiedAnswerKeys = true;
    }

    // Baremos (solo totales con dimensionId === null; omitir baremos por dimensión sin fallar)
    const activeBaremos = sourceLoaded.document.baremos.filter(isActiveDraftNode);
    let copiedBaremos = activeBaremos.length === 0 || copyBaremos === false;

    if (copyBaremos !== false && activeBaremos.length > 0) {
      if (!permissions.canConfigureBaremos) {
        copiedBaremos = false;
        warnings.push(
          "La versión se clonó sin baremos porque no cuentas con el permiso BAREMO_CONFIGURAR.",
        );
      } else {
        for (const omitted of plan.omittedBaremos) {
          warnings.push(
            `Baremo "${omitted.baremo.name || omitted.baremo.code}" (${omitted.baremo.code}) omitido: ${omitted.reason}`,
          );
        }

        copiedBaremos = plan.copiableBaremos.length > 0;

        for (const baremo of plan.copiableBaremos) {
          scope?.assertCurrent();
          const createdBaremo = await createBaremo({
            versionId: createdVersion.id,
            dimensionId: null,
            code: baremo.code.trim(),
            name: baremo.name.trim(),
            description: baremo.description.trim() ? baremo.description : null,
            normativeGroup: baremo.normativeGroup.trim() ? baremo.normativeGroup : null,
          });

          const activeRanges = baremo.ranges
            .filter(isActiveDraftNode)
            .sort((a, b) => a.order - b.order);

          for (const range of activeRanges) {
            scope?.assertCurrent();
            await createBaremoRange(createdBaremo.id, {
              minScore: range.minScore,
              maxScore: range.maxScore,
              percentile: range.percentile,
              category: range.category.trim(),
              interpretation: range.interpretation.trim() ? range.interpretation : null,
              recommendation: range.recommendation.trim() ? range.recommendation : null,
              order: range.order,
            });
          }
        }
      }
    }

    return {
      status: "cloned",
      version: createdVersion,
      copiedAnswerKeys,
      copiedBaremos,
      warnings,
    };
  } catch (error) {
    scope?.assertCurrent();
    const detail = error instanceof Error ? error.message : "Error al copiar la configuración.";
    throw new IncompleteVersionCloneError(createdVersion, detail);
  }
}
