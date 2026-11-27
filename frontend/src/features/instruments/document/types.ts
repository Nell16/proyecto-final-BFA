import type {
  ConfigurationStatus,
  DraftStatus,
  GeneralStatus,
  ItemType,
  ResponseType,
  VersionStatus,
} from "../../../api/schemas/instruments";

export type {
  ConfigurationStatus,
  DraftStatus,
  GeneralStatus,
  ItemType,
  ResponseType,
  VersionStatus,
};

export type DraftIdFactory = (prefix?: string) => string;

let fallbackDraftSeq = 0;

export function createDefaultDraftId(prefix = "draft"): string {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (typeof randomUuid === "string" && randomUuid.length > 0) {
    return `${prefix}-${randomUuid}`;
  }
  fallbackDraftSeq += 1;
  return `${prefix}-${Date.now()}-${fallbackDraftSeq}`;
}

export const OPTION_RESPONSE_TYPES: ReadonlySet<ResponseType> = new Set([
  "OPCION_UNICA",
  "OPCION_MULTIPLE",
  "VERDADERO_FALSO",
]);

export const SINGLE_KEY_OPTION_RESPONSE_TYPES: ReadonlySet<ResponseType> = new Set([
  "OPCION_UNICA",
  "VERDADERO_FALSO",
]);

export const IMAGE_ITEM_TYPES: ReadonlySet<ItemType> = new Set([
  "SOLO_IMAGEN",
  "COMPARACION_IMAGENES",
  "TEXTO_E_IMAGEN",
]);

export interface DocumentImage {
  id: number | null;
  draftId: string;
  sourceId: number | null;
  resourceId: number | null;
  pendingFileId: string | null;
  previewUrl: string | null;
  status: DraftStatus;
  order: number;
  altText: string;
  role: string | null;
  fileName: string | null;
  storagePath?: string | null;
}

export interface DocumentAnswerKey {
  id: number | null;
  draftId: string;
  sourceId: number | null;
  status: DraftStatus;
  ruleId: number | null;
  correctOptionDraftId: string | null;
  correctOptionId: number | null;
  expectedText: string | null;
  expectedNumber: number | null;
  numericTolerance: number | null;
  score: number;
  requiresManualReview: boolean;
}

export interface DocumentOption {
  id: number | null;
  draftId: string;
  sourceId: number | null;
  status: DraftStatus;
  code: string;
  text: string;
  order: number;
  ordinalValue: number | null;
  images: DocumentImage[];
}

export interface DocumentItem {
  id: number | null;
  draftId: string;
  sourceId: number | null;
  status: DraftStatus;
  code: string;
  itemType: ItemType;
  responseType: ResponseType;
  prompt: string;
  instruction: string;
  order: number;
  baseScore: number;
  timeLimitSeconds: number | null;
  required: boolean;
  confidential: boolean;
  images: DocumentImage[];
  options: DocumentOption[];
  answerKey: DocumentAnswerKey | null;
}

export interface DocumentSubtest {
  id: number | null;
  draftId: string;
  sourceId: number | null;
  status: DraftStatus;
  code: string;
  name: string;
  description: string;
  instructions: string;
  order: number;
  timeLimitSeconds: number | null;
  randomizeItems: boolean;
  randomizeOptions: boolean;
  required: boolean;
  strategyId: number | null;
  defaultRuleId: number | null;
  items: DocumentItem[];
}

export interface DocumentVersionMeta {
  versionId: number;
  testId: number;
  testCode: string;
  testName: string;
  number: string;
  status: VersionStatus;
  strategyId: number | null;
  instructions: string;
  timeLimitSeconds: number | null;
  randomizeSubtests: boolean;
  randomizeItems: boolean;
  metaDirty: boolean;
}

export interface DocumentBaremoRange {
  id: number | null;
  draftId: string;
  status: DraftStatus;
  minScore: number;
  maxScore: number;
  percentile: number | null;
  category: string;
  interpretation: string;
  recommendation: string;
  order: number;
}

export interface DocumentBaremo {
  id: number | null;
  draftId: string;
  status: DraftStatus;
  dimensionId: number | null;
  code: string;
  name: string;
  description: string;
  normativeGroup: string;
  ranges: DocumentBaremoRange[];
}

export interface VersionDocument {
  version: DocumentVersionMeta;
  subtests: DocumentSubtest[];
  baremos: DocumentBaremo[];
  dirtyNodeIds: string[];
  loadedAt: string;
}

export type DocumentNodeRef =
  | { kind: "version" }
  | { kind: "subtest"; subtestDraftId: string }
  | { kind: "item"; subtestDraftId: string; itemDraftId: string }
  | { kind: "baremos"; baremoDraftId?: string }
  | { kind: "publish" };

export interface DocumentProblem {
  id: string;
  severity: "error" | "warning";
  code: string;
  message: string;
  node: DocumentNodeRef;
  nodeKey: string;
  field?: string;
  blocksSave?: boolean;
}

export function nodeKeyOf(ref: DocumentNodeRef): string {
  switch (ref.kind) {
    case "version":
      return "version";
    case "subtest":
      return `subtest:${ref.subtestDraftId}`;
    case "item":
      return `item:${ref.itemDraftId}`;
    case "baremos":
      return ref.baremoDraftId ? `baremo:${ref.baremoDraftId}` : "baremos";
    case "publish":
      return "publish";
  }
}

export function isActiveDraftNode(node: { status: DraftStatus }): boolean {
  return node.status !== "DELETED";
}

export function documentSignature(doc: VersionDocument): string {
  return JSON.stringify([doc.version, doc.subtests, doc.baremos]);
}
