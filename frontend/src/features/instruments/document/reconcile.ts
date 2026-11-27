import { getDirtyNodeIds } from "./reducer";
import {
  baremoNaturalKey,
  canonicalAnswerKey,
  canonicalBaremo,
  canonicalBaremoRange,
  canonicalImage,
  canonicalItem,
  canonicalOption,
  canonicalSubtest,
  canonicalVersionMeta,
  cloneSentSnapshot,
  codeKey,
  imageSlotKey,
  itemNaturalKey,
  optionNaturalKey,
  rangeNaturalKey,
  sentKey,
  subtestNaturalKey,
  uploadSlotKey,
  type SentNodeRecord,
  type SentSnapshot,
  type SentUploadRecord,
} from "./sent";
import {
  isActiveDraftNode,
  nodeKeyOf,
  type DraftStatus,
  type DocumentAnswerKey,
  type DocumentBaremo,
  type DocumentBaremoRange,
  type DocumentImage,
  type DocumentItem,
  type DocumentNodeRef,
  type DocumentOption,
  type DocumentSubtest,
  type DocumentVersionMeta,
  type VersionDocument,
} from "./types";

export type DocumentConflictKind =
  | "version"
  | "subtest"
  | "scoringRule"
  | "item"
  | "option"
  | "answerKey"
  | "image"
  | "UNCERTAIN_IMAGE_OPERATION"
  | "baremo"
  | "baremoRange";

export type UncertainImageIntention = "delete" | "replace" | "reupload";

export type UncertainImageResolutionChoice = "keep_server" | "apply_mine";

export interface UncertainImageLocalSnapshot {
  draftId: string;
  id: number | null;
  pendingFileId: string | null;
  status: DraftStatus;
}

export interface UncertainImageOriginSnapshot {
  remoteResourceId: number | null;
  uploadKey: string;
  sentPendingFileId: string | null;
  /** Huella de la imagen local al crear el conflicto (`null` si el slot estaba vacío). */
  localImage: UncertainImageLocalSnapshot | null;
}

export interface UncertainImageResolutionContext {
  ownerKind: "item" | "option";
  subtestDraftId: string;
  itemDraftId: string;
  optionDraftId: string | null;
  order: number;
  uploadKey: string;
  intention: UncertainImageIntention;
  serverImage: DocumentImage;
  localImageDraftId?: string;
  origin: UncertainImageOriginSnapshot;
}

export interface DocumentConflictNode {
  kind: DocumentConflictKind;
  node: DocumentNodeRef;
  nodeKey: string;
  label: string;
  reason: string;
  resolution?: UncertainImageResolutionContext;
  stale?: boolean;
}

export interface ThreeWayReconcileResult {
  document: VersionDocument;
  conflicts: DocumentConflictNode[];
  adoptedNodeCount: number;
  /** Snapshot «enviado» sin los nodos que ya quedaron resueltos (aplicados) en esta reconciliación. */
  sent: SentSnapshot;
}

// ---------------------------------------------------------------------------
// Contexto compartido
// ---------------------------------------------------------------------------

interface ReconcileContext {
  conflicts: DocumentConflictNode[];
  sent: SentSnapshot;
  remainingSent: SentSnapshot;
  adopted: number;
  pendingFiles?: Readonly<Record<string, File>>;
}

function pushConflict(
  ctx: ReconcileContext,
  conflict: Omit<DocumentConflictNode, "nodeKey">,
): void {
  ctx.conflicts.push({
    ...conflict,
    nodeKey: nodeKeyOf(conflict.node),
  });
}

const AMBIGUOUS_HINT = "No se adoptó ningún id del servidor: recarga la versión manualmente.";

function ambiguityReason(detail: string): string {
  return `Clave de emparejamiento ambigua (${detail}). ${AMBIGUOUS_HINT}`;
}

// ---------------------------------------------------------------------------
// Emparejamiento de listas
// ---------------------------------------------------------------------------

interface MatchedSlot<T> {
  base?: T;
  mine?: T;
  theirs?: T;
  /** Solo en nodos nuevos de mine: no se puede emparejar con certeza con el servidor. */
  ambiguity?: string;
}

function countBy<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyOf(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * Empareja base / mine / theirs.
 *
 * - Nodos de mine con id: por id.
 * - Nodos nuevos de mine (id null): por clave natural, que coincide exactamente con la restricción
 *   UNIQUE del servidor. Si la clave es vacía, está duplicada en mine o tiene varios candidatos en
 *   theirs/base, NO se adopta nada y el slot queda marcado como ambiguo.
 * - El resultado no depende del orden de los candidatos: solo de cuántos hay por clave.
 */
function matchNodeLists<T extends { id: number | null; status: string }>(
  baseList: readonly T[],
  mineList: readonly T[],
  theirsList: readonly T[],
  getNaturalKey: (node: T) => string,
  getSentNaturalKey?: (node: T) => string | undefined,
): MatchedSlot<T>[] {
  const activeBase = baseList.filter((n) => n.status !== "DELETED");
  const activeTheirs = theirsList.filter((n) => n.status !== "DELETED");
  const relevantMine = mineList.filter((n) => n.status !== "DELETED" || n.id !== null);

  const baseById = new Map<number, T>();
  for (const b of activeBase) {
    if (b.id !== null) baseById.set(b.id, b);
  }
  const theirsById = new Map<number, T>();
  for (const t of activeTheirs) {
    if (t.id !== null) theirsById.set(t.id, t);
  }

  const usedBase = new Set<T>();
  const usedTheirs = new Set<T>();
  const slots: MatchedSlot<T>[] = [];
  const pendingNewMine: { slotIndex: number; mine: T }[] = [];

  // 1. Nodos de mine con id: por id
  for (const mine of relevantMine) {
    if (mine.id !== null) {
      const base = baseById.get(mine.id);
      const theirs = theirsById.get(mine.id);
      if (base) usedBase.add(base);
      if (theirs) usedTheirs.add(theirs);
      slots.push({ base, mine, theirs });
    } else {
      pendingNewMine.push({ slotIndex: slots.length, mine });
      slots.push({ mine });
    }
  }

  // 2. Nodos nuevos de mine: por clave natural registrada al enviar (si existe en sent) o la actual
  const mineMatchKeyOf = (mine: T): string => {
    const sentNatural = getSentNaturalKey?.(mine);
    return sentNatural !== undefined ? sentNatural : getNaturalKey(mine);
  };
  const mineNewCounts = countBy(
    pendingNewMine.map((entry) => entry.mine),
    mineMatchKeyOf,
  );
  for (const { slotIndex, mine } of pendingNewMine) {
    const natKey = mineMatchKeyOf(mine);
    if (natKey === "") {
      slots[slotIndex] = { mine, ambiguity: "clave vacía" };
      continue;
    }
    const theirsCandidates = activeTheirs.filter(
      (t) => !usedTheirs.has(t) && getNaturalKey(t) === natKey,
    );
    const baseCandidates = activeBase.filter(
      (b) => !usedBase.has(b) && getNaturalKey(b) === natKey,
    );
    const duplicatedInMine = (mineNewCounts.get(natKey) ?? 0) > 1;
    if (duplicatedInMine || theirsCandidates.length > 1 || baseCandidates.length > 1) {
      // No se adopta ninguno, pero se reclaman para no emitir conflictos duplicados por los mismos nodos.
      for (const t of theirsCandidates) usedTheirs.add(t);
      for (const b of baseCandidates) usedBase.add(b);
      slots[slotIndex] = {
        mine,
        ambiguity: duplicatedInMine
          ? "clave duplicada en los cambios locales"
          : "varios candidatos con la misma clave en el servidor",
      };
      continue;
    }
    const matchedTheirs = theirsCandidates[0];
    const matchedBase = baseCandidates[0];
    if (matchedTheirs) usedTheirs.add(matchedTheirs);
    if (matchedBase) usedBase.add(matchedBase);
    slots[slotIndex] = { base: matchedBase, mine, theirs: matchedTheirs };
  }

  // 3. Nodos restantes en theirs (p. ej. creados por otro usuario)
  const remainingTheirs = activeTheirs.filter((t) => !usedTheirs.has(t));
  const remainingTheirsCounts = countBy(remainingTheirs, getNaturalKey);
  for (const theirs of remainingTheirs) {
    usedTheirs.add(theirs);
    let matchedBase: T | undefined =
      theirs.id !== null ? baseById.get(theirs.id) : undefined;
    if (matchedBase && usedBase.has(matchedBase)) matchedBase = undefined;
    if (!matchedBase) {
      const natKey = getNaturalKey(theirs);
      if (natKey !== "" && remainingTheirsCounts.get(natKey) === 1) {
        const candidates = activeBase.filter(
          (b) => !usedBase.has(b) && getNaturalKey(b) === natKey,
        );
        if (candidates.length === 1) matchedBase = candidates[0];
      }
    }
    if (matchedBase) {
      usedBase.add(matchedBase);
      slots.push({ base: matchedBase, theirs });
    } else {
      slots.push({ theirs });
    }
  }

  // 4. Nodos en base que no quedaron en mine ni en theirs: coinciden como ausentes
  for (const base of activeBase) {
    if (usedBase.has(base)) continue;
    usedBase.add(base);
    slots.push({ base });
  }

  return slots;
}

// ---------------------------------------------------------------------------
// Clasificación de un nodo con 4 entradas
// ---------------------------------------------------------------------------

type HeadOutcome = "adopt" | "applied-pending" | "keep" | "conflict";

/**
 * - theirs == mine: ya coincide → adoptar.
 * - Si el nodo se envió (sent):
 *     theirs == sent → aplicado: se adopta el id; si mine ≠ sent, mine − theirs es un cambio nuevo.
 *     theirs == base → no aplicado: se reenvía mine.
 *     otro valor → conflicto.
 * - Si no se envió: regla de 3 vías (theirs == base → conservar mine; otro valor → conflicto).
 *
 * `sentSig` es undefined cuando el nodo no se envió.
 */
function classify(params: {
  baseSig: string | null;
  mineSig: string;
  theirsSig: string | null;
  sentSig: string | undefined;
}): HeadOutcome {
  const { baseSig, mineSig, theirsSig, sentSig } = params;
  if (theirsSig !== null && theirsSig === mineSig) return "adopt";
  if (sentSig !== undefined && theirsSig !== null && theirsSig === sentSig) {
    return "applied-pending";
  }
  if (theirsSig === baseSig) return "keep";
  return "conflict";
}

function sentSigOf(record: SentNodeRecord | undefined): string | undefined {
  return record && record.op !== "DELETED" ? record.sig : undefined;
}

function consumeSent(ctx: ReconcileContext, key: string): void {
  delete ctx.remainingSent.nodes[key];
}

interface HeadResult<T> {
  outcome: HeadOutcome;
  head: T;
}

function reconcileHead<T extends { id: number | null; status: string }>(params: {
  ctx: ReconcileContext;
  sentNodeKey: string;
  mine: T;
  base: T | undefined;
  theirs: T | undefined;
  sigOf: (side: "base" | "mine" | "theirs", node: T) => string;
  adoptPatch?: (mine: T, theirs: T) => T;
}): HeadResult<T> {
  const { ctx, sentNodeKey, mine, base, theirs, sigOf, adoptPatch } = params;
  const mineSig = sigOf("mine", mine);
  const theirsSig = theirs ? sigOf("theirs", theirs) : null;
  const baseSig = base ? sigOf("base", base) : null;
  const outcome = classify({
    baseSig,
    mineSig,
    theirsSig,
    sentSig: sentSigOf(ctx.sent.nodes[sentNodeKey]),
  });

  switch (outcome) {
    case "adopt": {
      if (mine.id !== theirs!.id || mine.status !== "EXISTING") ctx.adopted += 1;
      consumeSent(ctx, sentNodeKey);
      const adopted = { ...structuredClone(mine), id: theirs!.id, status: "EXISTING" } as T;
      return { outcome, head: adoptPatch ? adoptPatch(adopted, theirs!) : adopted };
    }
    case "applied-pending": {
      ctx.adopted += 1;
      consumeSent(ctx, sentNodeKey);
      return {
        outcome,
        head: { ...structuredClone(mine), id: theirs!.id, status: "UPDATED" } as T,
      };
    }
    case "keep":
      return {
        outcome,
        head: { ...structuredClone(mine), id: theirs?.id ?? mine.id } as T,
      };
    case "conflict":
      return { outcome, head: structuredClone(mine) };
  }
}

// ---------------------------------------------------------------------------
// Subárboles: cambios de theirs respecto de base (para borrados) y de mine respecto de base
// ---------------------------------------------------------------------------

interface FlatEntry {
  label: string;
  sig: string;
  kind: DocumentConflictKind;
}
type FlatMap = Map<string, FlatEntry>;

const flatKey = (...parts: readonly (string | number | null)[]): string => JSON.stringify(parts);

function flattenOption(opt: DocumentOption, itemCode: string, itemLabel: string, out: FlatMap) {
  const optCode = codeKey(opt.code);
  const label = `Opción ${opt.code} (${itemLabel})`;
  out.set(flatKey("option", itemCode, optCode), {
    label,
    sig: canonicalOption(opt),
    kind: "option",
  });
  for (const img of opt.images.filter(isActiveDraftNode)) {
    out.set(flatKey("optionImage", itemCode, optCode, img.order), {
      label: `Imagen #${img.order} (${label})`,
      sig: canonicalImage(img, "option"),
      kind: "image",
    });
  }
}

function flattenItem(item: DocumentItem, subtestLabel: string, out: FlatMap) {
  const itemCode = codeKey(item.code);
  const label = `Ítem ${item.code} (${subtestLabel})`;
  out.set(flatKey("item", itemCode), { label, sig: canonicalItem(item), kind: "item" });
  for (const img of item.images.filter(isActiveDraftNode)) {
    out.set(flatKey("itemImage", itemCode, img.order), {
      label: `Imagen #${img.order} (${label})`,
      sig: canonicalImage(img, "item"),
      kind: "image",
    });
  }
  for (const opt of item.options.filter(isActiveDraftNode)) {
    flattenOption(opt, itemCode, label, out);
  }
  if (item.answerKey && isActiveDraftNode(item.answerKey)) {
    out.set(flatKey("key", itemCode), {
      label: `Clave de respuesta (${label})`,
      sig: canonicalAnswerKey({
        key: item.answerKey,
        item,
        effectiveRuleId: item.answerKey.ruleId,
      }),
      kind: "answerKey",
    });
  }
}

function flattenSubtest(sub: DocumentSubtest, versionRandomizeItems: boolean): FlatMap {
  const out: FlatMap = new Map();
  const label = `Subtest ${sub.code}`;
  out.set(flatKey("subtest"), {
    label,
    sig: canonicalSubtest(sub, versionRandomizeItems),
    kind: "subtest",
  });
  if (sub.defaultRuleId !== null) {
    out.set(flatKey("scoringRule"), {
      label: `Regla de calificación (${label})`,
      sig: String(sub.defaultRuleId),
      kind: "scoringRule",
    });
  }
  for (const item of sub.items.filter(isActiveDraftNode)) flattenItem(item, label, out);
  return out;
}

function flattenItemSubtree(item: DocumentItem, subtestLabel: string): FlatMap {
  const out: FlatMap = new Map();
  flattenItem(item, subtestLabel, out);
  return out;
}

function flattenOptionSubtree(opt: DocumentOption, itemLabel: string): FlatMap {
  const out: FlatMap = new Map();
  flattenOption(opt, "", itemLabel, out);
  return out;
}

function flattenBaremo(b: DocumentBaremo): FlatMap {
  const out: FlatMap = new Map();
  const label = `Baremo ${b.code}`;
  out.set(flatKey("baremo"), { label, sig: canonicalBaremo(b), kind: "baremo" });
  for (const r of b.ranges.filter(isActiveDraftNode)) {
    out.set(flatKey("range", r.order), {
      label: `Rango #${r.order} (${label})`,
      sig: canonicalBaremoRange(r),
      kind: "baremoRange",
    });
  }
  return out;
}

/** Entradas (de `a` o de `b`) cuyo valor difiere, falta o sobra. Usa la etiqueta del lado donde existe. */
function changedEntries(a: FlatMap, b: FlatMap): FlatEntry[] {
  const changed: FlatEntry[] = [];
  for (const [key, entry] of a) {
    const other = b.get(key);
    if (!other || other.sig !== entry.sig) changed.push(other ?? entry);
  }
  for (const [key, entry] of b) {
    if (!a.has(key)) changed.push(entry);
  }
  return changed;
}

/**
 * Un nodo borrado en mine: theirs debe ser idéntico a base en el nodo Y en TODOS sus descendientes.
 * Devuelve las etiquetas afectadas (vacío si se puede reenviar el borrado).
 */
function subtreeChangedSinceBase(baseFlat: FlatMap | null, theirsFlat: FlatMap): FlatEntry[] {
  if (!baseFlat) return [...theirsFlat.values()];
  return changedEntries(baseFlat, theirsFlat);
}

function reportDeletedSubtreeConflict(params: {
  ctx: ReconcileContext;
  kind: DocumentConflictKind;
  node: DocumentNodeRef;
  label: string;
  affected: FlatEntry[];
  noun: string;
}): void {
  const { ctx, kind, node, label, affected, noun } = params;
  const descendants = affected.filter((entry) => entry.label !== label);
  pushConflict(ctx, {
    kind,
    node,
    label,
    reason:
      descendants.length > 0
        ? `Otro usuario modificó el ${noun} o su contenido en el servidor: ${descendants
            .map((d) => d.label)
            .join("; ")}.`
        : `Otro usuario modificó este ${noun} en el servidor.`,
  });
  for (const descendant of descendants) {
    pushConflict(ctx, {
      kind: descendant.kind,
      node,
      label: descendant.label,
      reason: `Otro usuario cambió este elemento en el servidor y tú eliminaste su ${noun}.`,
    });
  }
}

function describeLocalEdits(
  baseFlat: FlatMap | null,
  mineFlat: FlatMap,
  excludeKind?: DocumentConflictKind,
): string[] {
  if (!baseFlat) return [];
  return changedEntries(baseFlat, mineFlat)
    .filter((entry) => entry.kind !== excludeKind)
    .map((entry) => entry.label);
}

function deletedByOtherReason(noun: string, localEdits: string[]): string {
  return localEdits.length > 0
    ? `Otro usuario eliminó este ${noun} en el servidor y tienes cambios locales en: ${localEdits.join("; ")}.`
    : `Otro usuario eliminó este ${noun} en el servidor.`;
}

// ---------------------------------------------------------------------------
// Imágenes
// ---------------------------------------------------------------------------

const STORAGE_UUID_FILENAME_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-(.+)$/i;
const PRINTABLE_ASCII_PATTERN = /^[\u0020-\u007E]+$/;

function originalFilename(filename: string | null | undefined): string {
  if (!filename || filename.trim() === "") {
    return "image";
  }
  const normalized = filename.replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  return slash >= 0 ? normalized.slice(slash + 1) : normalized;
}

/**
 * Replica exactamente el saneamiento de nombres de archivo del backend
 * (`InstrumentImageService.java` ~346-361). El flag `/u` empareja por punto
 * de código Unicode al igual que `java.util.regex.Pattern` en `String.replaceAll`.
 */
export function sanitizeImageFilename(filename: string | null | undefined): string {
  return originalFilename(filename).replace(/[^A-Za-z0-9._-]/gu, "_");
}

/**
 * Extrae el nombre saneado del segmento final `{uuid}-{sanitizedFilename}` de `storagePath`.
 * Devuelve `null` si la ruta está vacía o no cumple el formato `{uuid}-...`.
 */
export function extractSanitizedFilenameFromStoragePath(
  storagePath: string | null | undefined,
): string | null {
  if (!storagePath || storagePath.trim() === "") return null;
  const normalized = storagePath.trim().replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  const lastSegment = slash >= 0 ? normalized.slice(slash + 1) : normalized;
  const match = STORAGE_UUID_FILENAME_PATTERN.exec(lastSegment);
  return match ? match[1]! : null;
}

type UncertainUploadMatch = "mismatch" | "ambiguous";

function classifyUncertainUpload(
  theirs: DocumentImage,
  sentUpload: SentUploadRecord,
): UncertainUploadMatch {
  const remoteSanitized = extractSanitizedFilenameFromStoragePath(theirs.storagePath);
  if (
    remoteSanitized === null ||
    sentUpload.fileName == null ||
    !PRINTABLE_ASCII_PATTERN.test(sentUpload.fileName)
  ) {
    return "ambiguous";
  }
  const sentSanitized = sanitizeImageFilename(sentUpload.fileName);
  return remoteSanitized === sentSanitized ? "ambiguous" : "mismatch";
}

function uncertainImageReason(intention: UncertainImageIntention): string {
  switch (intention) {
    case "delete":
      return "No se pudo confirmar si la operación anterior sobre esta imagen se aplicó en el servidor; hay una imagen en esta posición que podría ser tuya o de otro editor.";
    case "replace":
      return "No se pudo confirmar si la subida anterior se aplicó en el servidor antes de reemplazar la imagen; la imagen actual del servidor podría ser tuya o de otro editor.";
    case "reupload":
      return "No se pudo confirmar si la subida anterior de esta imagen se aplicó en el servidor.";
  }
}

function pushUncertainImageConflict(params: {
  ctx: ReconcileContext;
  ownerKind: "item" | "option";
  ownerLabel: string;
  itemNode: DocumentNodeRef;
  subtestDraftId: string;
  itemDraftId: string;
  optionDraftId: string | null;
  uploadKey: string;
  sentUpload: SentUploadRecord;
  intention: UncertainImageIntention;
  serverImage: DocumentImage;
  localImage?: DocumentImage;
}): void {
  const {
    ctx,
    ownerKind,
    ownerLabel,
    itemNode,
    subtestDraftId,
    itemDraftId,
    optionDraftId,
    uploadKey,
    sentUpload,
    intention,
    serverImage,
    localImage,
  } = params;
  const origin: UncertainImageOriginSnapshot = {
    remoteResourceId: serverImage.resourceId,
    uploadKey,
    sentPendingFileId: sentUpload.pendingFileId ?? null,
    localImage: localImage
      ? {
          draftId: localImage.draftId,
          id: localImage.id,
          pendingFileId: localImage.pendingFileId,
          status: localImage.status,
        }
      : null,
  };
  pushConflict(ctx, {
    kind: "UNCERTAIN_IMAGE_OPERATION",
    node: itemNode,
    label: `Imagen #${serverImage.order} (${ownerLabel})`,
    reason: uncertainImageReason(intention),
    resolution: {
      ownerKind,
      subtestDraftId,
      itemDraftId,
      optionDraftId,
      order: serverImage.order,
      uploadKey,
      intention,
      serverImage: structuredClone(serverImage),
      ...(localImage !== undefined ? { localImageDraftId: localImage.draftId } : {}),
      origin,
    },
  });
}

function resolveImageListForChoice(
  images: readonly DocumentImage[],
  resolution: UncertainImageResolutionContext,
  choice: UncertainImageResolutionChoice,
): DocumentImage[] {
  const { serverImage, localImageDraftId, intention } = resolution;

  if (choice === "keep_server") {
    const kept: DocumentImage = {
      ...structuredClone(serverImage),
      draftId: localImageDraftId ?? serverImage.draftId,
      status: "EXISTING",
    };
    let inserted = false;
    const next: DocumentImage[] = [];
    for (const img of images) {
      const matchesTarget =
        (localImageDraftId !== undefined && img.draftId === localImageDraftId) ||
        (serverImage.id !== null && img.id === serverImage.id);
      if (matchesTarget) {
        if (!inserted) {
          next.push(kept);
          inserted = true;
        }
        continue;
      }
      next.push(img);
    }
    if (!inserted) next.push(kept);
    return next;
  }

  if (intention === "delete") {
    const deleted: DocumentImage = {
      ...structuredClone(serverImage),
      draftId: localImageDraftId ?? serverImage.draftId,
      status: "DELETED",
    };
    let inserted = false;
    const next: DocumentImage[] = [];
    for (const img of images) {
      const matchesTarget =
        (localImageDraftId !== undefined && img.draftId === localImageDraftId) ||
        (serverImage.id !== null && img.id === serverImage.id);
      if (matchesTarget) {
        if (!inserted) {
          next.push(deleted);
          inserted = true;
        }
        continue;
      }
      next.push(img);
    }
    if (!inserted) next.push(deleted);
    return next;
  }

  // intention === "replace" | "reupload": preparar PUT .../by-order/{order} sobre serverImage.id
  let inserted = false;
  const next: DocumentImage[] = [];
  for (const img of images) {
    if (localImageDraftId !== undefined && img.draftId === localImageDraftId) {
      next.push({
        ...structuredClone(img),
        id: serverImage.id,
        resourceId: null,
        status: "UPDATED",
      });
      inserted = true;
      continue;
    }
    if (serverImage.id !== null && img.id === serverImage.id) {
      continue;
    }
    next.push(img);
  }
  if (!inserted) {
    next.push({
      ...structuredClone(serverImage),
      status: "UPDATED",
    });
  }
  return next;
}

function upsertBaselineImageList(
  images: readonly DocumentImage[],
  serverImage: DocumentImage,
): DocumentImage[] {
  const baselineEntry: DocumentImage = {
    ...structuredClone(serverImage),
    status: "EXISTING",
  };
  let inserted = false;
  const next: DocumentImage[] = [];
  for (const img of images) {
    const matches =
      (serverImage.id !== null && img.id === serverImage.id) ||
      (isActiveDraftNode(img) && img.order === serverImage.order);
    if (matches) {
      if (!inserted) {
        next.push(baselineEntry);
        inserted = true;
      }
      continue;
    }
    next.push(img);
  }
  if (!inserted) next.push(baselineEntry);
  return next;
}

export interface ResolveUncertainImageConflictResult {
  stale: boolean;
  staleReason?: string;
  document: VersionDocument;
  baseline: VersionDocument | null;
  sent: SentSnapshot;
}

function findOwnerImages(
  document: VersionDocument,
  resolution: Pick<
    UncertainImageResolutionContext,
    "ownerKind" | "subtestDraftId" | "itemDraftId" | "optionDraftId"
  >,
): readonly DocumentImage[] | null {
  const sub = document.subtests.find(
    (s) => s.draftId === resolution.subtestDraftId && isActiveDraftNode(s),
  );
  if (!sub) return null;
  const item = sub.items.find(
    (i) => i.draftId === resolution.itemDraftId && isActiveDraftNode(i),
  );
  if (!item) return null;
  if (resolution.ownerKind === "item") {
    return item.images;
  }
  const opt =
    resolution.optionDraftId !== null
      ? item.options.find(
          (o) => o.draftId === resolution.optionDraftId && isActiveDraftNode(o),
        )
      : undefined;
  return opt ? opt.images : null;
}

function getStaleUncertainImageReason(params: {
  document: VersionDocument;
  sent: SentSnapshot;
  resolution: UncertainImageResolutionContext;
}): string | null {
  const { document, sent, resolution } = params;
  const { origin, order, serverImage } = resolution;

  if (origin.remoteResourceId !== serverImage.resourceId) {
    return "El recurso remoto del conflicto ya no coincide con el snapshot original.";
  }

  const currentSentUpload = sent.uploads[origin.uploadKey];
  if (
    currentSentUpload === undefined ||
    (currentSentUpload.pendingFileId ?? null) !== origin.sentPendingFileId
  ) {
    return "El registro de envío pendiente cambió desde que se detectó el conflicto.";
  }

  const images = findOwnerImages(document, resolution);
  if (images === null) {
    return "El ítem u opción dueño de la imagen ya no está activo en el borrador.";
  }

  const activeAtOrder = images.filter(
    (img) => isActiveDraftNode(img) && img.order === order,
  );

  if (origin.localImage === null) {
    if (activeAtOrder.length > 0) {
      return `La posición #${order} ahora está ocupada por otra imagen local.`;
    }
    if (serverImage.id !== null && images.some((img) => img.id === serverImage.id)) {
      return "La imagen del servidor ya fue incorporada al borrador local.";
    }
    return null;
  }

  const expected = origin.localImage;
  const currentLocal = images.find((img) => img.draftId === expected.draftId);
  if (!currentLocal) {
    return "La imagen local original fue eliminada del borrador.";
  }
  if (
    currentLocal.id !== expected.id ||
    currentLocal.pendingFileId !== expected.pendingFileId ||
    currentLocal.status !== expected.status
  ) {
    return "El estado de la imagen local cambió desde que se detectó el conflicto.";
  }

  if (expected.status === "DELETED") {
    if (activeAtOrder.length > 0) {
      return `Se adjuntó una nueva imagen en la posición #${order} después de detectar el conflicto.`;
    }
    return null;
  }

  if (currentLocal.order !== order) {
    return "El orden de la imagen local cambió desde que se detectó el conflicto.";
  }
  if (activeAtOrder.some((img) => img.draftId !== expected.draftId)) {
    return `Otra imagen local ocupa ahora la posición #${order}.`;
  }
  return null;
}

/**
 * Resuelve manualmente un conflicto `UNCERTAIN_IMAGE_OPERATION` aplicando la elección del usuario
 * sobre el documento local, su línea base y el snapshot `sent`, siempre que la huella de origen
 * siga coincidiendo con el estado actual.
 */
export function resolveUncertainImageConflict(params: {
  document: VersionDocument;
  baseline: VersionDocument | null;
  sent: SentSnapshot;
  resolution: UncertainImageResolutionContext;
  choice: UncertainImageResolutionChoice;
}): ResolveUncertainImageConflictResult {
  const { document, baseline, sent, resolution, choice } = params;
  const staleReason = getStaleUncertainImageReason({ document, sent, resolution });
  if (staleReason !== null) {
    return {
      stale: true,
      staleReason,
      document,
      baseline,
      sent,
    };
  }

  const { ownerKind, subtestDraftId, itemDraftId, optionDraftId, uploadKey, localImageDraftId, serverImage } =
    resolution;

  const docSub = document.subtests.find((s) => s.draftId === subtestDraftId);
  const docItem = docSub?.items.find((i) => i.draftId === itemDraftId);
  const docOpt =
    ownerKind === "option" && optionDraftId !== null
      ? docItem?.options.find((o) => o.draftId === optionDraftId)
      : undefined;

  const nextSubtests = document.subtests.map((sub) => {
    if (sub.draftId !== subtestDraftId) return sub;
    return {
      ...sub,
      items: sub.items.map((item) => {
        if (item.draftId !== itemDraftId) return item;
        if (ownerKind === "item") {
          return {
            ...item,
            images: resolveImageListForChoice(item.images, resolution, choice),
          };
        }
        return {
          ...item,
          options: item.options.map((opt) =>
            opt.draftId !== optionDraftId
              ? opt
              : {
                  ...opt,
                  images: resolveImageListForChoice(opt.images, resolution, choice),
                },
          ),
        };
      }),
    };
  });

  const nextDocBase: VersionDocument = {
    ...document,
    subtests: nextSubtests,
  };
  const nextDocument: VersionDocument = {
    ...nextDocBase,
    dirtyNodeIds: getDirtyNodeIds(nextDocBase),
  };

  let nextBaseline: VersionDocument | null = baseline ? structuredClone(baseline) : null;
  if (nextBaseline) {
    nextBaseline = {
      ...nextBaseline,
      subtests: nextBaseline.subtests.map((sub) => {
        const subMatch =
          sub.draftId === subtestDraftId ||
          (docSub?.id != null && sub.id === docSub.id) ||
          (docSub !== undefined && codeKey(sub.code) === codeKey(docSub.code));
        if (!subMatch) return sub;
        return {
          ...sub,
          items: sub.items.map((item) => {
            const itemMatch =
              item.draftId === itemDraftId ||
              (docItem?.id != null && item.id === docItem.id) ||
              (docItem !== undefined && codeKey(item.code) === codeKey(docItem.code));
            if (!itemMatch) return item;
            if (ownerKind === "item") {
              return {
                ...item,
                images: upsertBaselineImageList(item.images, serverImage),
              };
            }
            return {
              ...item,
              options: item.options.map((opt) => {
                const optMatch =
                  opt.draftId === optionDraftId ||
                  (docOpt?.id != null && opt.id === docOpt.id) ||
                  (docOpt !== undefined && codeKey(opt.code) === codeKey(docOpt.code));
                return optMatch
                  ? { ...opt, images: upsertBaselineImageList(opt.images, serverImage) }
                  : opt;
              }),
            };
          }),
        };
      }),
    };
  }

  const nextSent = cloneSentSnapshot(sent);
  delete nextSent.uploads[uploadKey];
  if (localImageDraftId !== undefined) {
    const key =
      ownerKind === "item"
        ? sentKey.itemImage(subtestDraftId, itemDraftId, localImageDraftId)
        : sentKey.optionImage(subtestDraftId, itemDraftId, optionDraftId ?? "", localImageDraftId);
    delete nextSent.nodes[key];
  }

  return {
    stale: false,
    document: nextDocument,
    baseline: nextBaseline,
    sent: nextSent,
  };
}

function isSameUploadedFile(
  mine: DocumentImage,
  sentUpload: SentUploadRecord,
  pendingFiles?: Readonly<Record<string, File>>,
): boolean {
  const currentFile =
    mine.pendingFileId !== null && pendingFiles ? pendingFiles[mine.pendingFileId] : undefined;

  if (sentUpload.pendingFileId === undefined) {
    if (sentUpload.fileName != null && mine.fileName !== null && mine.fileName !== sentUpload.fileName) {
      return false;
    }
    if (currentFile && sentUpload.fileSize !== undefined && currentFile.size !== sentUpload.fileSize) {
      return false;
    }
    if (
      currentFile &&
      sentUpload.lastModified !== undefined &&
      currentFile.lastModified !== sentUpload.lastModified
    ) {
      return false;
    }
    return true;
  }

  if (mine.pendingFileId !== sentUpload.pendingFileId) {
    return false;
  }

  if (sentUpload.fileName != null && mine.fileName !== null && mine.fileName !== sentUpload.fileName) {
    return false;
  }
  if (currentFile) {
    if (sentUpload.fileName != null && currentFile.name !== sentUpload.fileName) return false;
    if (sentUpload.fileSize !== undefined && currentFile.size !== sentUpload.fileSize) return false;
    if (sentUpload.lastModified !== undefined && currentFile.lastModified !== sentUpload.lastModified) {
      return false;
    }
  }
  return true;
}

function reconcileImages(params: {
  ctx: ReconcileContext;
  baseImages: readonly DocumentImage[];
  mineImages: readonly DocumentImage[];
  theirsImages: readonly DocumentImage[];
  ownerKind: "item" | "option";
  ownerLabel: string;
  itemNode: DocumentNodeRef;
  subtestDraftId: string;
  itemDraftId: string;
  optionDraftId: string | null;
}): DocumentImage[] {
  const {
    ctx,
    baseImages,
    mineImages,
    theirsImages,
    ownerKind,
    ownerLabel,
    itemNode,
    subtestDraftId,
    itemDraftId,
    optionDraftId,
  } = params;
  const sentImageKey = (img: DocumentImage): string =>
    ownerKind === "item"
      ? sentKey.itemImage(subtestDraftId, itemDraftId, img.draftId)
      : sentKey.optionImage(subtestDraftId, itemDraftId, optionDraftId ?? "", img.draftId);
  const slots = matchNodeLists(
    baseImages,
    mineImages,
    theirsImages,
    imageSlotKey,
    (img) => ctx.sent.nodes[sentImageKey(img)]?.naturalKey,
  );
  const reconciled: DocumentImage[] = [];

  for (const slot of slots) {
    const { base, mine, theirs } = slot;

    if (!mine) {
      if (theirs && !base) {
        const uploadKey = uploadSlotKey({
          subtestDraftId,
          itemDraftId,
          optionDraftId,
          order: theirs.order,
        });
        const sentUpload = ctx.sent.uploads[uploadKey];
        if (sentUpload !== undefined) {
          if (classifyUncertainUpload(theirs, sentUpload) === "mismatch") {
            // Regla 1: el nombre saneado difiere → el recurso remoto es ajeno, el POST no se aplicó.
            delete ctx.remainingSent.uploads[uploadKey];
            pushConflict(ctx, {
              kind: "image",
              node: itemNode,
              label: `Imagen #${theirs.order} (${ownerLabel})`,
              reason: "Otro usuario adjuntó una imagen en el servidor.",
            });
          } else {
            // Regla 2 y 3: coincidencia de nombre o storagePath no parseable → conflicto manual, nunca DELETE automático.
            pushUncertainImageConflict({
              ctx,
              ownerKind,
              ownerLabel,
              itemNode,
              subtestDraftId,
              itemDraftId,
              optionDraftId,
              uploadKey,
              sentUpload,
              intention: "delete",
              serverImage: theirs,
            });
          }
        } else {
          pushConflict(ctx, {
            kind: "image",
            node: itemNode,
            label: `Imagen #${theirs.order} (${ownerLabel})`,
            reason: "Otro usuario adjuntó una imagen en el servidor.",
          });
        }
      } else if (theirs && base) {
        pushConflict(ctx, {
          kind: "image",
          node: itemNode,
          label: `Imagen #${theirs.order} (${ownerLabel})`,
          reason: "La imagen del servidor difiere de la copia local.",
        });
      }
      continue;
    }

    if (slot.ambiguity) {
      pushConflict(ctx, {
        kind: "image",
        node: itemNode,
        label: `Imagen #${mine.order} (${ownerLabel})`,
        reason: ambiguityReason(slot.ambiguity),
      });
      reconciled.push(structuredClone(mine));
      continue;
    }

    if (mine.status === "DELETED") {
      const primaryUploadKey = uploadSlotKey({
        subtestDraftId,
        itemDraftId,
        optionDraftId,
        order: theirs?.order ?? mine.order,
      });
      const fallbackUploadKey = uploadSlotKey({
        subtestDraftId,
        itemDraftId,
        optionDraftId,
        order: mine.order,
      });
      const matchedUploadKey =
        ctx.sent.uploads[primaryUploadKey] !== undefined
          ? primaryUploadKey
          : ctx.sent.uploads[fallbackUploadKey] !== undefined
            ? fallbackUploadKey
            : null;
      const sentUpload = matchedUploadKey ? ctx.sent.uploads[matchedUploadKey] : undefined;

      if (!theirs) {
        ctx.adopted += 1;
        consumeSent(ctx, sentImageKey(mine));
        if (matchedUploadKey) delete ctx.remainingSent.uploads[matchedUploadKey];
        continue;
      }
      if (base && canonicalImage(theirs, ownerKind) === canonicalImage(base, ownerKind)) {
        if (matchedUploadKey) delete ctx.remainingSent.uploads[matchedUploadKey];
        reconciled.push(structuredClone(mine));
      } else if (sentUpload !== undefined && matchedUploadKey !== null) {
        if (classifyUncertainUpload(theirs, sentUpload) === "mismatch") {
          // Regla 1: el nombre saneado difiere → el PUT incierto no aplicó, es una edición externa real.
          delete ctx.remainingSent.uploads[matchedUploadKey];
          pushConflict(ctx, {
            kind: "image",
            node: itemNode,
            label: `Imagen #${mine.order} (${ownerLabel})`,
            reason: "La imagen fue modificada externamente antes de eliminarse.",
          });
          reconciled.push(structuredClone(mine));
        } else {
          // Regla 2 y 3 (Finding MEDIO): PUT incierto + borrado local → conflicto manual, nunca falso «edición externa».
          pushUncertainImageConflict({
            ctx,
            ownerKind,
            ownerLabel,
            itemNode,
            subtestDraftId,
            itemDraftId,
            optionDraftId,
            uploadKey: matchedUploadKey,
            sentUpload,
            intention: "delete",
            serverImage: theirs,
            localImage: mine,
          });
          reconciled.push(structuredClone(mine));
        }
      } else {
        pushConflict(ctx, {
          kind: "image",
          node: itemNode,
          label: `Imagen #${mine.order} (${ownerLabel})`,
          reason: "La imagen fue modificada externamente antes de eliminarse.",
        });
        reconciled.push(structuredClone(mine));
      }
      continue;
    }

    if (mine.resourceId === null) {
      // Subida pendiente local: su slot (dueño + orden) es la clave UNIQUE del servidor.
      const uploadKey = uploadSlotKey({
        subtestDraftId,
        itemDraftId,
        optionDraftId,
        order: mine.order,
      });
      if (!theirs) {
        if (!base) {
          // No aparece en el servidor: se vuelve a subir.
          delete ctx.remainingSent.uploads[uploadKey];
          reconciled.push(structuredClone(mine));
        } else {
          pushConflict(ctx, {
            kind: "image",
            node: itemNode,
            label: `Imagen #${mine.order} (${ownerLabel})`,
            reason: "La imagen cambió en el servidor.",
          });
          reconciled.push(structuredClone(mine));
        }
        continue;
      }

      const sentUpload = ctx.sent.uploads[uploadKey];
      const isUnchangedBaseSlot =
        base !== undefined &&
        mine.id !== null &&
        mine.id === base.id &&
        canonicalImage(theirs, ownerKind) === canonicalImage(base, ownerKind);

      if (isUnchangedBaseSlot) {
        delete ctx.remainingSent.uploads[uploadKey];
        reconciled.push({
          ...structuredClone(mine),
          id: theirs.id,
          status: "UPDATED",
        });
      } else if ((!base || theirs.resourceId !== base.resourceId) && sentUpload !== undefined) {
        if (classifyUncertainUpload(theirs, sentUpload) === "mismatch") {
          // Regla 1: el nombre saneado difiere → el recurso remoto es ajeno, mi subida sigue pendiente y choca por orden.
          delete ctx.remainingSent.uploads[uploadKey];
          pushConflict(ctx, {
            kind: "image",
            node: itemNode,
            label: `Imagen #${mine.order} (${ownerLabel})`,
            reason: "Otra imagen distinta ocupa el mismo orden en el servidor.",
          });
          reconciled.push(structuredClone(mine));
          continue;
        }

        const sameFile = isSameUploadedFile(mine, sentUpload, ctx.pendingFiles);
        // Sin identidad remota verificable se elimina la adopción automática: toda coincidencia
        // (nombre igual o ruta no legible) abre conflicto manual, haya o no intención local posterior.
        pushUncertainImageConflict({
          ctx,
          ownerKind,
          ownerLabel,
          itemNode,
          subtestDraftId,
          itemDraftId,
          optionDraftId,
          uploadKey,
          sentUpload,
          intention: sameFile ? "reupload" : "replace",
          serverImage: theirs,
          localImage: mine,
        });
        reconciled.push(structuredClone(mine));
      } else {
        if (sentUpload !== undefined && base && theirs.resourceId === base.resourceId) {
          delete ctx.remainingSent.uploads[uploadKey];
        }
        pushConflict(ctx, {
          kind: "image",
          node: itemNode,
          label: `Imagen #${mine.order} (${ownerLabel})`,
          reason: "Otra imagen distinta ocupa el mismo orden en el servidor.",
        });
        reconciled.push(structuredClone(mine));
      }
      continue;
    }

    // Imagen con resourceId
    const { outcome, head } = reconcileHead({
      ctx,
      sentNodeKey: sentImageKey(mine),
      mine,
      base,
      theirs,
      sigOf: (_side, node) => canonicalImage(node, ownerKind),
    });
    if (outcome === "conflict") {
      pushConflict(ctx, {
        kind: "image",
        node: itemNode,
        label: `Imagen #${mine.order} (${ownerLabel})`,
        reason: theirs
          ? "Otro usuario modificó la misma imagen en el servidor."
          : "Otro usuario eliminó la imagen en el servidor.",
      });
      reconciled.push(head);
    } else if (outcome === "adopt") {
      reconciled.push({ ...structuredClone(theirs!), draftId: mine.draftId, status: "EXISTING" });
    } else {
      reconciled.push(head);
    }
  }

  return reconciled;
}

// ---------------------------------------------------------------------------
// Baremos
// ---------------------------------------------------------------------------

function reconcileBaremos(params: {
  ctx: ReconcileContext;
  baseBaremos: readonly DocumentBaremo[];
  mineBaremos: readonly DocumentBaremo[];
  theirsBaremos: readonly DocumentBaremo[];
}): DocumentBaremo[] {
  const { ctx, baseBaremos, mineBaremos, theirsBaremos } = params;
  const slots = matchNodeLists(
    baseBaremos,
    mineBaremos,
    theirsBaremos,
    baremoNaturalKey,
    (b) => ctx.sent.nodes[sentKey.baremo(b.draftId)]?.naturalKey,
  );
  const reconciled: DocumentBaremo[] = [];

  for (const slot of slots) {
    const { base, mine, theirs } = slot;

    if (!mine) {
      if (theirs) {
        pushConflict(ctx, {
          kind: "baremo",
          node: { kind: "baremos" },
          label: `Baremo ${theirs.code} (${theirs.name})`,
          reason: base
            ? "El baremo cambió en el servidor."
            : "Otro usuario creó un baremo en el servidor.",
        });
      }
      continue;
    }

    const baremoNode: DocumentNodeRef = { kind: "baremos", baremoDraftId: mine.draftId };
    const baremoLabel = `Baremo ${mine.code || mine.name || "sin código"}`;

    if (slot.ambiguity) {
      pushConflict(ctx, {
        kind: "baremo",
        node: baremoNode,
        label: baremoLabel,
        reason: ambiguityReason(slot.ambiguity),
      });
      reconciled.push(structuredClone(mine));
      continue;
    }

    if (mine.status === "DELETED") {
      if (!theirs) {
        ctx.adopted += 1;
        consumeSent(ctx, sentKey.baremo(mine.draftId));
        continue;
      }
      const affected = subtreeChangedSinceBase(base ? flattenBaremo(base) : null, flattenBaremo(theirs));
      if (base && affected.length === 0) {
        reconciled.push(structuredClone(mine));
      } else {
        reportDeletedSubtreeConflict({
          ctx,
          kind: "baremo",
          node: baremoNode,
          label: baremoLabel,
          affected: affected.map((entry) =>
            entry.kind === "baremo" ? { ...entry, label: baremoLabel } : entry,
          ),
          noun: "baremo",
        });
        reconciled.push(structuredClone(mine));
      }
      continue;
    }

    const headRes = reconcileHead({
      ctx,
      sentNodeKey: sentKey.baremo(mine.draftId),
      mine,
      base,
      theirs,
      sigOf: (_side, node) => canonicalBaremo(node),
      adoptPatch: (adopted, t) => ({
        ...adopted,
        code: t.code,
        name: t.name,
        description: t.description,
        normativeGroup: t.normativeGroup,
      }),
    });
    if (headRes.outcome === "conflict") {
      pushConflict(ctx, {
        kind: "baremo",
        node: baremoNode,
        label: baremoLabel,
        reason: theirs
          ? "Otro usuario modificó este baremo en el servidor."
          : "Otro usuario eliminó este baremo en el servidor.",
      });
    }

    if (!theirs && base) {
      // El baremo fue eliminado en el servidor: ya es conflicto; los rangos locales se listan aquí.
      const localEdits = describeLocalEdits(flattenBaremo(base), flattenBaremo(mine), "baremo");
      if (localEdits.length > 0) {
        pushConflict(ctx, {
          kind: "baremoRange",
          node: baremoNode,
          label: `Rangos locales de ${baremoLabel}`,
          reason: deletedByOtherReason("baremo", localEdits),
        });
      }
      reconciled.push(structuredClone(mine));
      continue;
    }

    // Reconciliar rangos dentro del baremo
    const rangeSlots = matchNodeLists(
      base?.ranges ?? [],
      mine.ranges,
      theirs?.ranges ?? [],
      rangeNaturalKey,
      (r) => ctx.sent.nodes[sentKey.range(mine.draftId, r.draftId)]?.naturalKey,
    );
    const reconciledRanges: DocumentBaremoRange[] = [];

    for (const rSlot of rangeSlots) {
      const rBase = rSlot.base;
      const rMine = rSlot.mine;
      const rTheirs = rSlot.theirs;

      if (!rMine) {
        if (rTheirs) {
          pushConflict(ctx, {
            kind: "baremoRange",
            node: baremoNode,
            label: `Rango #${rTheirs.order} (${baremoLabel})`,
            reason: rBase
              ? "El rango cambió en el servidor."
              : "Otro usuario agregó un rango en el servidor.",
          });
        }
        continue;
      }

      const rangeLabel = `Rango #${rMine.order} (${baremoLabel})`;

      if (rSlot.ambiguity) {
        pushConflict(ctx, {
          kind: "baremoRange",
          node: baremoNode,
          label: rangeLabel,
          reason: ambiguityReason(rSlot.ambiguity),
        });
        reconciledRanges.push(structuredClone(rMine));
        continue;
      }

      if (rMine.status === "DELETED") {
        if (!rTheirs) {
          ctx.adopted += 1;
          consumeSent(ctx, sentKey.range(mine.draftId, rMine.draftId));
          continue;
        }
        if (rBase && canonicalBaremoRange(rTheirs) === canonicalBaremoRange(rBase)) {
          reconciledRanges.push(structuredClone(rMine));
        } else {
          pushConflict(ctx, {
            kind: "baremoRange",
            node: baremoNode,
            label: rangeLabel,
            reason: "Otro usuario modificó el rango en el servidor.",
          });
          reconciledRanges.push(structuredClone(rMine));
        }
        continue;
      }

      const rangeRes = reconcileHead({
        ctx,
        sentNodeKey: sentKey.range(mine.draftId, rMine.draftId),
        mine: rMine,
        base: rBase,
        theirs: rTheirs,
        sigOf: (_side, node) => canonicalBaremoRange(node),
      });
      if (rangeRes.outcome === "conflict") {
        pushConflict(ctx, {
          kind: "baremoRange",
          node: baremoNode,
          label: rangeLabel,
          reason: rTheirs
            ? "Otro usuario modificó este rango en el servidor."
            : "Otro usuario eliminó este rango en el servidor.",
        });
        reconciledRanges.push(rangeRes.head);
      } else if (rangeRes.outcome === "adopt") {
        reconciledRanges.push({
          ...structuredClone(rTheirs!),
          draftId: rMine.draftId,
          status: "EXISTING",
        });
      } else {
        reconciledRanges.push(rangeRes.head);
      }
    }

    reconciled.push({
      ...headRes.head,
      ranges: reconciledRanges,
    });
  }

  return reconciled;
}

// ---------------------------------------------------------------------------
// Documento completo
// ---------------------------------------------------------------------------

export function reconcileVersionDocumentThreeWay(params: {
  base: VersionDocument;
  mine: VersionDocument;
  theirs: VersionDocument;
  /** Lo enviado en escrituras previas (guardado parcial). Sin él rige la regla de 3 vías. */
  sent?: SentSnapshot;
  /** Archivos locales pendientes para validar identidad en subidas inciertas. */
  pendingFiles?: Readonly<Record<string, File>>;
}): ThreeWayReconcileResult {
  const { base, mine, theirs, pendingFiles } = params;
  const sentInput = cloneSentSnapshot(params.sent);
  const ctx: ReconcileContext = {
    conflicts: [],
    sent: sentInput,
    remainingSent: cloneSentSnapshot(sentInput),
    adopted: 0,
    pendingFiles,
  };

  // 1. Metadatos de la versión
  const baseVerSig = canonicalVersionMeta(base.version);
  const mineVerSig = canonicalVersionMeta(mine.version);
  const theirsVerSig = canonicalVersionMeta(theirs.version);

  let reconciledVersion: DocumentVersionMeta;
  const versionOutcome = classify({
    baseSig: baseVerSig,
    mineSig: mineVerSig,
    theirsSig: theirsVerSig,
    sentSig: sentSigOf(ctx.sent.nodes[sentKey.version]),
  });
  switch (versionOutcome) {
    case "adopt":
      if (mine.version.metaDirty) ctx.adopted += 1;
      consumeSent(ctx, sentKey.version);
      reconciledVersion = { ...structuredClone(theirs.version), metaDirty: false };
      break;
    case "applied-pending":
      ctx.adopted += 1;
      consumeSent(ctx, sentKey.version);
      reconciledVersion = { ...structuredClone(mine.version), metaDirty: true };
      break;
    case "keep":
      reconciledVersion = {
        ...structuredClone(mine.version),
        metaDirty: mineVerSig !== baseVerSig,
      };
      break;
    case "conflict":
      pushConflict(ctx, {
        kind: "version",
        node: { kind: "version" },
        label: "Metadatos de la versión",
        reason: "Otro usuario modificó los metadatos de la versión en el servidor.",
      });
      reconciledVersion = structuredClone(mine.version);
      break;
  }

  // 2. Subtests, reglas, ítems, opciones, imágenes y claves
  const subtestSlots = matchNodeLists(
    base.subtests,
    mine.subtests,
    theirs.subtests,
    subtestNaturalKey,
    (sub) => ctx.sent.nodes[sentKey.subtest(sub.draftId)]?.naturalKey,
  );
  const reconciledSubtests: DocumentSubtest[] = [];

  for (const sSlot of subtestSlots) {
    const baseSub = sSlot.base;
    const mineSub = sSlot.mine;
    const theirsSub = sSlot.theirs;

    if (!mineSub) {
      if (theirsSub) {
        pushConflict(ctx, {
          kind: "subtest",
          node: { kind: "version" },
          label: `Subtest ${theirsSub.code} (${theirsSub.name})`,
          reason: baseSub
            ? "El subtest cambió en el servidor."
            : "Otro usuario creó este subtest en el servidor.",
        });
      }
      continue;
    }

    const subtestNode: DocumentNodeRef = { kind: "subtest", subtestDraftId: mineSub.draftId };
    const subtestLabel = `Subtest ${mineSub.code || mineSub.name || "sin código"}`;

    if (sSlot.ambiguity) {
      pushConflict(ctx, {
        kind: "subtest",
        node: subtestNode,
        label: subtestLabel,
        reason: ambiguityReason(sSlot.ambiguity),
      });
      reconciledSubtests.push(structuredClone(mineSub));
      continue;
    }

    if (mineSub.status === "DELETED") {
      if (!theirsSub) {
        ctx.adopted += 1;
        consumeSent(ctx, sentKey.subtest(mineSub.draftId));
        continue;
      }
      // El borrado es en cascada (subtest → ítems → opciones, claves e imágenes): cualquier cambio
      // de theirs respecto de base en el subtest o en cualquier descendiente es un conflicto.
      const affected = subtreeChangedSinceBase(
        baseSub ? flattenSubtest(baseSub, base.version.randomizeItems) : null,
        flattenSubtest(theirsSub, theirs.version.randomizeItems),
      );
      if (baseSub && affected.length === 0) {
        reconciledSubtests.push(structuredClone(mineSub));
      } else {
        reportDeletedSubtreeConflict({
          ctx,
          kind: "subtest",
          node: subtestNode,
          label: subtestLabel,
          affected: affected.map((entry) =>
            entry.kind === "subtest" ? { ...entry, label: subtestLabel } : entry,
          ),
          noun: "subtest",
        });
        reconciledSubtests.push(structuredClone(mineSub));
      }
      continue;
    }

    const subRes = reconcileHead({
      ctx,
      sentNodeKey: sentKey.subtest(mineSub.draftId),
      mine: mineSub,
      base: baseSub,
      theirs: theirsSub,
      sigOf: (side, node) =>
        canonicalSubtest(
          node,
          side === "mine"
            ? mine.version.randomizeItems
            : side === "theirs"
              ? theirs.version.randomizeItems
              : base.version.randomizeItems,
        ),
      adoptPatch: (adopted, t) => ({ ...adopted, randomizeItems: t.randomizeItems }),
    });
    const reconciledSubHead = subRes.head;
    if (subRes.outcome === "conflict") {
      pushConflict(ctx, {
        kind: "subtest",
        node: subtestNode,
        label: subtestLabel,
        reason: theirsSub
          ? "Otro usuario modificó este subtest en el servidor."
          : "Otro usuario eliminó este subtest en el servidor.",
      });
    }

    if (!theirsSub && baseSub) {
      // El padre fue eliminado en el servidor: se lista lo que mine editó en sus descendientes.
      const localEdits = describeLocalEdits(
        flattenSubtest(baseSub, base.version.randomizeItems),
        flattenSubtest(mineSub, mine.version.randomizeItems),
        "subtest",
      );
      if (localEdits.length > 0) {
        pushConflict(ctx, {
          kind: "subtest",
          node: subtestNode,
          label: `Cambios locales en ${subtestLabel}`,
          reason: deletedByOtherReason("subtest", localEdits),
        });
      }
      reconciledSubtests.push(structuredClone(mineSub));
      continue;
    }

    // Regla de calificación por defecto del subtest
    const mineNeedsRule =
      mineSub.defaultRuleId === null &&
      mineSub.items.some(
        (it) =>
          isActiveDraftNode(it) &&
          it.answerKey !== null &&
          isActiveDraftNode(it.answerKey) &&
          it.answerKey.ruleId === null,
      );
    const baseRuleId = baseSub?.defaultRuleId ?? null;
    const theirsRuleId = theirsSub?.defaultRuleId ?? null;
    const mineRuleId = mineSub.defaultRuleId;
    const ruleSentKey = sentKey.scoringRule(mineSub.draftId);
    const sentRuleRecord = ctx.sent.nodes[ruleSentKey];
    let adoptedRuleId: number | null = null;
    let reconciledDefaultRuleId: number | null = mineRuleId;

    if (mineNeedsRule) {
      if (theirsRuleId !== null && baseRuleId === null && sentRuleRecord !== undefined) {
        adoptedRuleId = theirsRuleId;
        reconciledDefaultRuleId = theirsRuleId;
        consumeSent(ctx, ruleSentKey);
        ctx.adopted += 1;
      } else if (theirsRuleId !== null || baseRuleId !== null) {
        pushConflict(ctx, {
          kind: "scoringRule",
          node: subtestNode,
          label: `Regla de calificación (${subtestLabel})`,
          reason: "La regla de calificación cambió en el servidor.",
        });
      }
    } else if (theirsRuleId === mineRuleId) {
      consumeSent(ctx, ruleSentKey);
      reconciledDefaultRuleId = theirsRuleId;
    } else if (theirsRuleId === baseRuleId) {
      reconciledDefaultRuleId = mineRuleId;
    } else if (theirsSub) {
      pushConflict(ctx, {
        kind: "scoringRule",
        node: subtestNode,
        label: `Regla de calificación (${subtestLabel})`,
        reason: "Otro usuario modificó la regla de calificación en el servidor.",
      });
    }

    // Ítems del subtest
    const itemSlots = matchNodeLists(
      baseSub?.items ?? [],
      mineSub.items,
      theirsSub?.items ?? [],
      itemNaturalKey,
      (item) => ctx.sent.nodes[sentKey.item(mineSub.draftId, item.draftId)]?.naturalKey,
    );
    const reconciledItems: DocumentItem[] = [];

    for (const iSlot of itemSlots) {
      const baseItem = iSlot.base;
      const mineItem = iSlot.mine;
      const theirsItem = iSlot.theirs;

      if (!mineItem) {
        if (theirsItem) {
          pushConflict(ctx, {
            kind: "item",
            node: subtestNode,
            label: `Ítem ${theirsItem.code} (${subtestLabel})`,
            reason: baseItem
              ? "El ítem cambió en el servidor."
              : "Otro usuario creó este ítem en el servidor.",
          });
        }
        continue;
      }

      const itemNode: DocumentNodeRef = {
        kind: "item",
        subtestDraftId: mineSub.draftId,
        itemDraftId: mineItem.draftId,
      };
      const itemLabel = `Ítem ${mineItem.code || "sin código"} (${subtestLabel})`;

      if (iSlot.ambiguity) {
        pushConflict(ctx, {
          kind: "item",
          node: itemNode,
          label: itemLabel,
          reason: ambiguityReason(iSlot.ambiguity),
        });
        reconciledItems.push(structuredClone(mineItem));
        continue;
      }

      if (mineItem.status === "DELETED") {
        if (!theirsItem) {
          ctx.adopted += 1;
          consumeSent(ctx, sentKey.item(mineSub.draftId, mineItem.draftId));
          continue;
        }
        // Un ítem borrado arrastra sus opciones, claves e imágenes.
        const affected = subtreeChangedSinceBase(
          baseItem ? flattenItemSubtree(baseItem, subtestLabel) : null,
          flattenItemSubtree(theirsItem, subtestLabel),
        );
        if (baseItem && affected.length === 0) {
          reconciledItems.push(structuredClone(mineItem));
        } else {
          reportDeletedSubtreeConflict({
            ctx,
            kind: "item",
            node: itemNode,
            label: itemLabel,
            affected: affected.map((entry) =>
              entry.kind === "item" ? { ...entry, label: itemLabel } : entry,
            ),
            noun: "ítem",
          });
          reconciledItems.push(structuredClone(mineItem));
        }
        continue;
      }

      const itemRes = reconcileHead({
        ctx,
        sentNodeKey: sentKey.item(mineSub.draftId, mineItem.draftId),
        mine: mineItem,
        base: baseItem,
        theirs: theirsItem,
        sigOf: (_side, node) => canonicalItem(node),
      });
      const reconciledItemHead = itemRes.head;
      if (itemRes.outcome === "conflict") {
        pushConflict(ctx, {
          kind: "item",
          node: itemNode,
          label: itemLabel,
          reason: theirsItem
            ? "Otro usuario modificó este ítem en el servidor."
            : "Otro usuario eliminó este ítem en el servidor.",
        });
      }

      if (!theirsItem && baseItem) {
        const localEdits = describeLocalEdits(
          flattenItemSubtree(baseItem, subtestLabel),
          flattenItemSubtree(mineItem, subtestLabel),
          "item",
        );
        if (localEdits.length > 0) {
          pushConflict(ctx, {
            kind: "item",
            node: itemNode,
            label: `Cambios locales en ${itemLabel}`,
            reason: deletedByOtherReason("ítem", localEdits),
          });
        }
        reconciledItems.push(structuredClone(mineItem));
        continue;
      }

      // Imágenes del ítem
      const reconciledItemImages = reconcileImages({
        ctx,
        baseImages: baseItem?.images ?? [],
        mineImages: mineItem.images,
        theirsImages: theirsItem?.images ?? [],
        ownerKind: "item",
        ownerLabel: itemLabel,
        itemNode,
        subtestDraftId: mineSub.draftId,
        itemDraftId: mineItem.draftId,
        optionDraftId: null,
      });

      // Opciones del ítem
      const optionSlots = matchNodeLists(
        baseItem?.options ?? [],
        mineItem.options,
        theirsItem?.options ?? [],
        optionNaturalKey,
        (opt) =>
          ctx.sent.nodes[sentKey.option(mineSub.draftId, mineItem.draftId, opt.draftId)]?.naturalKey,
      );
      const persistedOptIdByMineDraftId = new Map<string, number>();
      const reconciledOptions: DocumentOption[] = [];

      for (const oSlot of optionSlots) {
        const baseOpt = oSlot.base;
        const mineOpt = oSlot.mine;
        const theirsOpt = oSlot.theirs;

        if (!mineOpt) {
          if (theirsOpt) {
            pushConflict(ctx, {
              kind: "option",
              node: itemNode,
              label: `Opción ${theirsOpt.code} (${itemLabel})`,
              reason: baseOpt
                ? "La opción cambió en el servidor."
                : "Otro usuario agregó esta opción en el servidor.",
            });
          }
          continue;
        }

        const optLabel = `Opción ${mineOpt.code || "sin código"} (${itemLabel})`;

        if (oSlot.ambiguity) {
          pushConflict(ctx, {
            kind: "option",
            node: itemNode,
            label: optLabel,
            reason: ambiguityReason(oSlot.ambiguity),
          });
          reconciledOptions.push(structuredClone(mineOpt));
          continue;
        }

        if (mineOpt.status === "DELETED") {
          if (!theirsOpt) {
            ctx.adopted += 1;
            consumeSent(ctx, sentKey.option(mineSub.draftId, mineItem.draftId, mineOpt.draftId));
            continue;
          }
          const affected = subtreeChangedSinceBase(
            baseOpt ? flattenOptionSubtree(baseOpt, itemLabel) : null,
            flattenOptionSubtree(theirsOpt, itemLabel),
          );
          if (baseOpt && affected.length === 0) {
            reconciledOptions.push(structuredClone(mineOpt));
          } else {
            reportDeletedSubtreeConflict({
              ctx,
              kind: "option",
              node: itemNode,
              label: optLabel,
              affected: affected.map((entry) =>
                entry.kind === "option" ? { ...entry, label: optLabel } : entry,
              ),
              noun: "opción",
            });
            reconciledOptions.push(structuredClone(mineOpt));
          }
          continue;
        }

        const optRes = reconcileHead({
          ctx,
          sentNodeKey: sentKey.option(mineSub.draftId, mineItem.draftId, mineOpt.draftId),
          mine: mineOpt,
          base: baseOpt,
          theirs: theirsOpt,
          sigOf: (_side, node) => canonicalOption(node),
        });
        const reconciledOptHead = optRes.head;
        if (optRes.outcome === "conflict") {
          pushConflict(ctx, {
            kind: "option",
            node: itemNode,
            label: optLabel,
            reason: theirsOpt
              ? "Otro usuario modificó esta opción en el servidor."
              : "Otro usuario eliminó esta opción en el servidor.",
          });
        } else {
          const resolvedId = reconciledOptHead.id;
          if (resolvedId !== null) {
            persistedOptIdByMineDraftId.set(mineOpt.draftId, resolvedId);
          }
        }

        if (!theirsOpt && baseOpt) {
          const localEdits = describeLocalEdits(
            flattenOptionSubtree(baseOpt, itemLabel),
            flattenOptionSubtree(mineOpt, itemLabel),
            "option",
          );
          if (localEdits.length > 0) {
            pushConflict(ctx, {
              kind: "option",
              node: itemNode,
              label: `Cambios locales en ${optLabel}`,
              reason: deletedByOtherReason("opción", localEdits),
            });
          }
          reconciledOptions.push(structuredClone(mineOpt));
          continue;
        }

        const optImages = reconcileImages({
          ctx,
          baseImages: baseOpt?.images ?? [],
          mineImages: mineOpt.images,
          theirsImages: theirsOpt?.images ?? [],
          ownerKind: "option",
          ownerLabel: optLabel,
          itemNode,
          subtestDraftId: mineSub.draftId,
          itemDraftId: mineItem.draftId,
          optionDraftId: mineOpt.draftId,
        });

        reconciledOptions.push({
          ...reconciledOptHead,
          images: optImages,
        });
      }

      // Clave de respuesta del ítem
      const baseKey =
        baseItem?.answerKey && isActiveDraftNode(baseItem.answerKey) ? baseItem.answerKey : null;
      const mineKey = mineItem.answerKey;
      const theirsKey =
        theirsItem?.answerKey && isActiveDraftNode(theirsItem.answerKey)
          ? theirsItem.answerKey
          : null;

      const baseKeySig =
        baseKey && baseItem
          ? canonicalAnswerKey({ key: baseKey, item: baseItem, effectiveRuleId: baseKey.ruleId })
          : null;
      const theirsKeySig =
        theirsKey && theirsItem
          ? canonicalAnswerKey({
              key: theirsKey,
              item: theirsItem,
              effectiveRuleId: theirsKey.ruleId,
            })
          : null;

      let reconciledKey: DocumentAnswerKey | null = null;
      if (!mineKey) {
        if (theirsKey) {
          pushConflict(ctx, {
            kind: "answerKey",
            node: itemNode,
            label: `Clave de respuesta (${itemLabel})`,
            reason: baseKey
              ? "La clave de respuesta cambió en el servidor."
              : "Otro usuario creó una clave de respuesta en el servidor.",
          });
        }
      } else if (mineKey.status === "DELETED") {
        const keySentKey = sentKey.answerKey(mineSub.draftId, mineItem.draftId);
        if (!theirsKey) {
          ctx.adopted += 1;
          consumeSent(ctx, keySentKey);
          reconciledKey = null;
        } else if (theirsKeySig === baseKeySig) {
          reconciledKey = structuredClone(mineKey);
        } else {
          pushConflict(ctx, {
            kind: "answerKey",
            node: itemNode,
            label: `Clave de respuesta (${itemLabel})`,
            reason: "Otro usuario modificó la clave de respuesta en el servidor.",
          });
          reconciledKey = structuredClone(mineKey);
        }
      } else {
        const effectiveMineRuleId = mineKey.ruleId ?? reconciledDefaultRuleId ?? adoptedRuleId;
        const mineKeySig = canonicalAnswerKey({
          key: mineKey,
          item: mineItem,
          effectiveRuleId: effectiveMineRuleId,
        });
        const keySentKey = sentKey.answerKey(mineSub.draftId, mineItem.draftId);

        const matchedCorrectDraftId =
          mineKey.correctOptionDraftId !== null
            ? mineKey.correctOptionDraftId
            : theirsKey && theirsKey.correctOptionId !== null
              ? (reconciledOptions.find(
                  (opt) => isActiveDraftNode(opt) && opt.id === theirsKey.correctOptionId,
                )?.draftId ?? null)
              : null;

        const mappedPersistedOptionId =
          (mineKey.correctOptionDraftId !== null
            ? persistedOptIdByMineDraftId.get(mineKey.correctOptionDraftId)
            : undefined) ??
          theirsKey?.correctOptionId ??
          mineKey.correctOptionId;

        const keyOutcome = classify({
          baseSig: baseKeySig,
          mineSig: mineKeySig,
          theirsSig: theirsKeySig,
          sentSig: sentSigOf(ctx.sent.nodes[keySentKey]),
        });

        if (keyOutcome === "adopt") {
          if (mineKey.id !== theirsKey!.id || mineKey.status !== "EXISTING") {
            ctx.adopted += 1;
          }
          consumeSent(ctx, keySentKey);
          reconciledKey = {
            ...structuredClone(theirsKey!),
            draftId: mineKey.draftId,
            status: "EXISTING",
            correctOptionDraftId: matchedCorrectDraftId,
            correctOptionId: mappedPersistedOptionId ?? theirsKey!.correctOptionId,
          };
        } else if (keyOutcome === "applied-pending") {
          ctx.adopted += 1;
          consumeSent(ctx, keySentKey);
          reconciledKey = {
            ...structuredClone(mineKey),
            id: theirsKey!.id,
            status: "UPDATED",
            ruleId: effectiveMineRuleId,
            correctOptionId: mappedPersistedOptionId ?? null,
          };
        } else if (keyOutcome === "keep") {
          reconciledKey = {
            ...structuredClone(mineKey),
            id: theirsKey?.id ?? mineKey.id,
            ruleId: effectiveMineRuleId,
            correctOptionId: mappedPersistedOptionId ?? null,
          };
        } else {
          pushConflict(ctx, {
            kind: "answerKey",
            node: itemNode,
            label: `Clave de respuesta (${itemLabel})`,
            reason: theirsKey
              ? "Otro usuario modificó la clave de respuesta en el servidor."
              : "Otro usuario eliminó la clave de respuesta en el servidor.",
          });
          reconciledKey = structuredClone(mineKey);
        }
      }

      reconciledItems.push({
        ...reconciledItemHead,
        images: reconciledItemImages,
        options: reconciledOptions,
        answerKey: reconciledKey,
      });
    }

    reconciledSubtests.push({
      ...reconciledSubHead,
      defaultRuleId: reconciledDefaultRuleId,
      items: reconciledItems,
    });
  }

  // 3. Baremos y rangos
  const reconciledBaremos = reconcileBaremos({
    ctx,
    baseBaremos: base.baremos,
    mineBaremos: mine.baremos,
    theirsBaremos: theirs.baremos,
  });

  const nextDoc: VersionDocument = {
    ...mine,
    version: reconciledVersion,
    subtests: reconciledSubtests,
    baremos: reconciledBaremos,
    loadedAt: theirs.loadedAt,
  };

  return {
    document: { ...nextDoc, dirtyNodeIds: getDirtyNodeIds(nextDoc) },
    conflicts: ctx.conflicts,
    adoptedNodeCount: ctx.adopted,
    sent: ctx.remainingSent,
  };
}
