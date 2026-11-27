import type { VersionConfigurationPayload } from "../../../api/schemas/instruments";
import {
  isActiveDraftNode,
  type DocumentAnswerKey,
  type DocumentBaremo,
  type DocumentBaremoRange,
  type DocumentImage,
  type DocumentItem,
  type DocumentOption,
  type DocumentSubtest,
  type DocumentVersionMeta,
  type VersionDocument,
} from "./types";

// ---------------------------------------------------------------------------
// Claves naturales
//
// El servidor guarda el `code` tal como lo envía el cliente (el esquema de
// petición hace `trim()`, sin cambiar mayúsculas) y las restricciones UNIQUE de
// la BD distinguen mayúsculas (sin lower()/citext). Por eso la clave es solo
// `trim()`: `BAR-GEN` y `bar-gen` son claves distintas y un cambio de
// mayúsculas es un cambio real.
// ---------------------------------------------------------------------------

export const codeKey = (value: string): string => value.trim();

const tupleKey = (...parts: readonly (string | number | null)[]): string => JSON.stringify(parts);

/** UNIQUE (version_test_id, codigo_subtest) */
export const subtestNaturalKey = (s: Pick<DocumentSubtest, "code">): string => {
  const code = codeKey(s.code);
  return code === "" ? "" : tupleKey("subtest", code);
};

/** UNIQUE (subtest_id, codigo_item) */
export const itemNaturalKey = (i: Pick<DocumentItem, "code">): string => {
  const code = codeKey(i.code);
  return code === "" ? "" : tupleKey("item", code);
};

/** UNIQUE (item_id, codigo_opcion) */
export const optionNaturalKey = (o: Pick<DocumentOption, "code">): string => {
  const code = codeKey(o.code);
  return code === "" ? "" : tupleKey("option", code);
};

/**
 * uq_baremo_dimension_codigo (version_test_id, dimension_resultado_id, codigo_baremo) cuando hay
 * dimensión; uq_baremo_total_codigo (version_test_id, codigo_baremo) cuando no la hay.
 */
export function baremoNaturalKey(b: Pick<DocumentBaremo, "code" | "dimensionId">): string {
  const code = codeKey(b.code);
  if (code === "") return "";
  return b.dimensionId === null ? tupleKey("total", code) : tupleKey("dim", b.dimensionId, code);
}

/** UNIQUE (baremo_id, orden) */
export const rangeNaturalKey = (r: Pick<DocumentBaremoRange, "order">): string =>
  tupleKey("range", r.order);

/** UNIQUE (item_id, numero_orden) / UNIQUE (opcion_id, numero_orden): el «slot» de una imagen. */
export const imageSlotKey = (img: Pick<DocumentImage, "order">): string =>
  tupleKey("image", img.order);

// ---------------------------------------------------------------------------
// Firmas canónicas (lo que el servidor persiste de cada nodo)
// ---------------------------------------------------------------------------

const trimOrEmpty = (value: string): string => (value.trim() ? value : "");
const normalizeNullableText = (value: string | null): string | null =>
  value !== null && value.trim() !== "" ? value : null;

export function canonicalVersionMeta(v: DocumentVersionMeta): string {
  return JSON.stringify({
    number: v.number.trim(),
    status: v.status,
    strategyId: v.strategyId,
    instructions: trimOrEmpty(v.instructions),
    timeLimitSeconds: v.timeLimitSeconds,
    randomizeSubtests: v.randomizeSubtests,
    randomizeItems: v.randomizeItems,
  });
}

export function canonicalSubtest(s: DocumentSubtest, versionRandomizeItems: boolean): string {
  return JSON.stringify({
    code: codeKey(s.code),
    name: s.name.trim(),
    description: trimOrEmpty(s.description),
    instructions: trimOrEmpty(s.instructions),
    order: s.order,
    timeLimitSeconds: s.timeLimitSeconds,
    randomizeItems: versionRandomizeItems ? s.randomizeItems : false,
    randomizeOptions: s.randomizeOptions,
    required: s.required,
    strategyId: s.strategyId,
  });
}

export function canonicalItem(i: DocumentItem): string {
  return JSON.stringify({
    code: codeKey(i.code),
    itemType: i.itemType,
    responseType: i.responseType,
    prompt: trimOrEmpty(i.prompt),
    instruction: trimOrEmpty(i.instruction),
    order: i.order,
    baseScore: i.baseScore,
    timeLimitSeconds: i.timeLimitSeconds,
    required: i.required,
    confidential: i.confidential,
  });
}

export function canonicalOption(o: DocumentOption): string {
  return JSON.stringify({
    code: codeKey(o.code),
    text: trimOrEmpty(o.text),
    order: o.order,
    ordinalValue: o.ordinalValue,
  });
}

export function canonicalImage(img: DocumentImage, ownerKind: "item" | "option"): string {
  const defaultRole = ownerKind === "item" ? "ENUNCIADO" : null;
  return JSON.stringify({
    resourceId: img.resourceId,
    order: img.order,
    altText: trimOrEmpty(img.altText),
    role: img.role ?? defaultRole,
  });
}

export function canonicalBaremo(b: DocumentBaremo): string {
  return JSON.stringify({
    dimensionId: b.dimensionId,
    code: codeKey(b.code),
    name: b.name.trim(),
    description: trimOrEmpty(b.description),
    normativeGroup: trimOrEmpty(b.normativeGroup),
  });
}

export function canonicalBaremoRange(r: DocumentBaremoRange): string {
  return JSON.stringify({
    minScore: r.minScore,
    maxScore: r.maxScore,
    percentile: r.percentile,
    category: r.category.trim(),
    interpretation: trimOrEmpty(r.interpretation),
    recommendation: trimOrEmpty(r.recommendation),
    order: r.order,
  });
}

/** Código de la opción activa a la que apunta la clave (independiente de ids y draftIds). */
export function referencedOptionCode(key: DocumentAnswerKey, item: DocumentItem): string | null {
  const active = item.options.filter(isActiveDraftNode);
  const matched =
    (key.correctOptionDraftId !== null
      ? active.find((o) => o.draftId === key.correctOptionDraftId)
      : undefined) ??
    (key.correctOptionId !== null ? active.find((o) => o.id === key.correctOptionId) : undefined);
  return matched ? codeKey(matched.code) : null;
}

export function canonicalAnswerKey(params: {
  key: DocumentAnswerKey;
  item: DocumentItem;
  effectiveRuleId: number | null;
}): string {
  const { key, item, effectiveRuleId } = params;
  return JSON.stringify({
    ruleId: effectiveRuleId,
    optionCode: referencedOptionCode(key, item),
    expectedText: normalizeNullableText(key.expectedText),
    expectedNumber: key.expectedNumber,
    numericTolerance: key.numericTolerance,
    score: key.score,
    requiresManualReview: key.requiresManualReview,
  });
}

// ---------------------------------------------------------------------------
// Snapshot «enviado»
//
// Antes de cada escritura se guarda el valor de cada nodo tal como va en el
// request. La reconciliación usa 4 entradas por nodo (base, sent, mine, theirs).
// Las claves se construyen con los draftId del documento local, que no cambian
// entre reintentos. Todo es JSON serializable para persistirlo con el guardado
// parcial.
// ---------------------------------------------------------------------------

export type SentOperation = "CREATED" | "UPDATED" | "DELETED";

export interface SentNodeRecord {
  op: SentOperation;
  /** Firma canónica del nodo tal como se envió (vacía para borrados). */
  sig: string;
  /** Clave natural del nodo tal como se envió (permite emparejar tras editar el código/orden antes de reintentar). */
  naturalKey?: string;
}

export interface SentUploadRecord {
  subtestDraftId: string;
  itemDraftId: string;
  optionDraftId: string | null;
  order: number;
  pendingFileId?: string;
  fileName?: string | null;
  fileSize?: number;
  lastModified?: number;
  altText?: string;
  role?: string | null;
}

export interface SentSnapshot {
  nodes: Record<string, SentNodeRecord>;
  /**
   * Subidas de imagen cuyo resultado es incierto (red / 5xx): el servidor pudo haberlas aplicado.
   * Clave: `uploadSlotKey`.
   */
  uploads: Record<string, SentUploadRecord>;
}

export function createEmptySentSnapshot(): SentSnapshot {
  return { nodes: {}, uploads: {} };
}

export function cloneSentSnapshot(snapshot: SentSnapshot | undefined | null): SentSnapshot {
  if (!snapshot) return createEmptySentSnapshot();
  return {
    nodes: { ...snapshot.nodes },
    uploads: { ...snapshot.uploads },
  };
}

export function isSentSnapshot(value: unknown): value is SentSnapshot {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<SentSnapshot>;
  return (
    !!record.nodes &&
    typeof record.nodes === "object" &&
    !Array.isArray(record.nodes) &&
    !!record.uploads &&
    typeof record.uploads === "object" &&
    !Array.isArray(record.uploads)
  );
}

export const sentKey = {
  subtest: (subtestDraftId: string) => tupleKey("subtest", subtestDraftId),
  scoringRule: (subtestDraftId: string) => tupleKey("rule", subtestDraftId),
  item: (subtestDraftId: string, itemDraftId: string) =>
    tupleKey("item", subtestDraftId, itemDraftId),
  option: (subtestDraftId: string, itemDraftId: string, optionDraftId: string) =>
    tupleKey("option", subtestDraftId, itemDraftId, optionDraftId),
  answerKey: (subtestDraftId: string, itemDraftId: string) =>
    tupleKey("key", subtestDraftId, itemDraftId),
  itemImage: (subtestDraftId: string, itemDraftId: string, imageDraftId: string) =>
    tupleKey("itemImage", subtestDraftId, itemDraftId, imageDraftId),
  optionImage: (
    subtestDraftId: string,
    itemDraftId: string,
    optionDraftId: string,
    imageDraftId: string,
  ) => tupleKey("optionImage", subtestDraftId, itemDraftId, optionDraftId, imageDraftId),
  baremo: (baremoDraftId: string) => tupleKey("baremo", baremoDraftId),
  range: (baremoDraftId: string, rangeDraftId: string) =>
    tupleKey("range", baremoDraftId, rangeDraftId),
  version: tupleKey("version"),
} as const;

export function uploadSlotKey(params: {
  subtestDraftId: string;
  itemDraftId: string;
  optionDraftId: string | null;
  order: number;
}): string {
  return params.optionDraftId === null
    ? tupleKey("itemUpload", params.subtestDraftId, params.itemDraftId, params.order)
    : tupleKey(
        "optionUpload",
        params.subtestDraftId,
        params.itemDraftId,
        params.optionDraftId,
        params.order,
      );
}

export function recordSentVersion(snapshot: SentSnapshot, version: DocumentVersionMeta): void {
  snapshot.nodes[sentKey.version] = { op: "UPDATED", sig: canonicalVersionMeta(version) };
}

export function recordSentScoringRule(
  snapshot: SentSnapshot,
  subtestDraftId: string,
  ruleSig: string,
): void {
  snapshot.nodes[sentKey.scoringRule(subtestDraftId)] = { op: "CREATED", sig: ruleSig };
}

/**
 * Registra lo que va en el request de `saveVersionConfiguration`: recorre el diff y, por cada nodo
 * con cambio, guarda la firma del valor del documento local (que es de donde sale el diff).
 */
export function recordSentConfiguration(
  snapshot: SentSnapshot,
  doc: VersionDocument,
  diff: VersionConfigurationPayload,
): void {
  const versionRandomizeItems = doc.version.randomizeItems;
  for (const subDraft of diff.subtests) {
    const sub = doc.subtests.find((s) => s.draftId === subDraft.draftId);
    if (!sub) continue;
    if (subDraft.status === "DELETED") {
      snapshot.nodes[sentKey.subtest(sub.draftId)] = { op: "DELETED", sig: "" };
      continue;
    }
    if (subDraft.status !== "EXISTING") {
      snapshot.nodes[sentKey.subtest(sub.draftId)] = {
        op: subDraft.status,
        sig: canonicalSubtest(sub, versionRandomizeItems),
        naturalKey: subtestNaturalKey(sub),
      };
    }

    for (const itemDraft of subDraft.items ?? []) {
      const item = sub.items.find((i) => i.draftId === itemDraft.draftId);
      if (!item) continue;
      const itemKey = sentKey.item(sub.draftId, item.draftId);
      if (itemDraft.status === "DELETED") {
        snapshot.nodes[itemKey] = { op: "DELETED", sig: "" };
        continue;
      }
      if (itemDraft.status !== "EXISTING") {
        snapshot.nodes[itemKey] = {
          op: itemDraft.status,
          sig: canonicalItem(item),
          naturalKey: itemNaturalKey(item),
        };
      }

      for (const imgDraft of itemDraft.images ?? []) {
        const img = item.images.find((i) => i.draftId === imgDraft.draftId);
        if (!img) continue;
        const imgKey = sentKey.itemImage(sub.draftId, item.draftId, img.draftId);
        if (imgDraft.status === "DELETED") {
          snapshot.nodes[imgKey] = { op: "DELETED", sig: "" };
        } else if (imgDraft.status !== "EXISTING") {
          snapshot.nodes[imgKey] = {
            op: imgDraft.status,
            sig: canonicalImage(img, "item"),
            naturalKey: imageSlotKey(img),
          };
        }
      }

      for (const optDraft of itemDraft.options ?? []) {
        const opt = item.options.find((o) => o.draftId === optDraft.draftId);
        if (!opt) continue;
        const optKey = sentKey.option(sub.draftId, item.draftId, opt.draftId);
        if (optDraft.status === "DELETED") {
          snapshot.nodes[optKey] = { op: "DELETED", sig: "" };
          continue;
        }
        if (optDraft.status !== "EXISTING") {
          snapshot.nodes[optKey] = {
            op: optDraft.status,
            sig: canonicalOption(opt),
            naturalKey: optionNaturalKey(opt),
          };
        }
        for (const imgDraft of optDraft.images ?? []) {
          const img = opt.images.find((i) => i.draftId === imgDraft.draftId);
          if (!img) continue;
          const optImgKey = sentKey.optionImage(sub.draftId, item.draftId, opt.draftId, img.draftId);
          if (imgDraft.status === "DELETED") {
            snapshot.nodes[optImgKey] = { op: "DELETED", sig: "" };
          } else if (imgDraft.status !== "EXISTING") {
            snapshot.nodes[optImgKey] = {
              op: imgDraft.status,
              sig: canonicalImage(img, "option"),
              naturalKey: imageSlotKey(img),
            };
          }
        }
      }

      const keyDraft = itemDraft.answerKey;
      if (keyDraft && item.answerKey) {
        const keyNodeKey = sentKey.answerKey(sub.draftId, item.draftId);
        if (keyDraft.status === "DELETED") {
          snapshot.nodes[keyNodeKey] = { op: "DELETED", sig: "" };
        } else if (keyDraft.status !== "EXISTING") {
          snapshot.nodes[keyNodeKey] = {
            op: keyDraft.status,
            sig: canonicalAnswerKey({
              key: item.answerKey,
              item,
              effectiveRuleId: keyDraft.ruleId ?? null,
            }),
          };
        }
      }
    }
  }
}

export function clearSentConfiguration(
  snapshot: SentSnapshot,
  diff: VersionConfigurationPayload,
): void {
  for (const subDraft of diff.subtests) {
    if (!subDraft.draftId) continue;
    if (subDraft.status === "DELETED") {
      delete snapshot.nodes[sentKey.subtest(subDraft.draftId)];
      continue;
    }
    if (subDraft.status !== "EXISTING") {
      delete snapshot.nodes[sentKey.subtest(subDraft.draftId)];
    }
    for (const itemDraft of subDraft.items ?? []) {
      if (!itemDraft.draftId) continue;
      if (itemDraft.status === "DELETED") {
        delete snapshot.nodes[sentKey.item(subDraft.draftId, itemDraft.draftId)];
        continue;
      }
      if (itemDraft.status !== "EXISTING") {
        delete snapshot.nodes[sentKey.item(subDraft.draftId, itemDraft.draftId)];
      }
      for (const imgDraft of itemDraft.images ?? []) {
        if (!imgDraft.draftId) continue;
        delete snapshot.nodes[sentKey.itemImage(subDraft.draftId, itemDraft.draftId, imgDraft.draftId)];
      }
      for (const optDraft of itemDraft.options ?? []) {
        if (!optDraft.draftId) continue;
        if (optDraft.status === "DELETED") {
          delete snapshot.nodes[sentKey.option(subDraft.draftId, itemDraft.draftId, optDraft.draftId)];
          continue;
        }
        if (optDraft.status !== "EXISTING") {
          delete snapshot.nodes[sentKey.option(subDraft.draftId, itemDraft.draftId, optDraft.draftId)];
        }
        for (const imgDraft of optDraft.images ?? []) {
          if (!imgDraft.draftId) continue;
          delete snapshot.nodes[
            sentKey.optionImage(subDraft.draftId, itemDraft.draftId, optDraft.draftId, imgDraft.draftId)
          ];
        }
      }
      if (itemDraft.answerKey && itemDraft.answerKey.status !== "EXISTING") {
        delete snapshot.nodes[sentKey.answerKey(subDraft.draftId, itemDraft.draftId)];
      }
    }
  }
}

export function recordSentBaremo(
  snapshot: SentSnapshot,
  baremo: DocumentBaremo,
  op: "CREATED" | "UPDATED",
): void {
  snapshot.nodes[sentKey.baremo(baremo.draftId)] = {
    op,
    sig: canonicalBaremo(baremo),
    naturalKey: baremoNaturalKey(baremo),
  };
}

export function recordSentRange(
  snapshot: SentSnapshot,
  baremoDraftId: string,
  range: DocumentBaremoRange,
  op: "CREATED" | "UPDATED",
): void {
  snapshot.nodes[sentKey.range(baremoDraftId, range.draftId)] = {
    op,
    sig: canonicalBaremoRange(range),
    naturalKey: rangeNaturalKey(range),
  };
}
