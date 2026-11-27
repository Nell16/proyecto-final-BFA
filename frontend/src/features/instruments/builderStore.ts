import { create } from "zustand";
import { registerAccountReset } from "../../store/accountReset";
import { useStaffAuth } from "../../store/staffAuth";
import type { SaveStepId } from "./document/adapters";
import { collectPendingImageUploads } from "./document/diff";
import {
  resolveUncertainImageConflict as resolveUncertainImageConflictInDoc,
  type UncertainImageResolutionChoice,
  type UncertainImageResolutionContext,
} from "./document/reconcile";
import { documentReducer, isDocumentDirty, type DocumentAction } from "./document/reducer";
import {
  baremoNaturalKey,
  cloneSentSnapshot,
  codeKey,
  createEmptySentSnapshot,
  isSentSnapshot,
  type SentSnapshot,
} from "./document/sent";
import {
  createDefaultDraftId,
  documentSignature,
  isActiveDraftNode,
  type DocumentImage,
  type DocumentNodeRef,
  type VersionDocument,
} from "./document/types";

export const BUILDER_DRAFT_STORAGE_PREFIX = "bfa-instrument-draft:v1:";
export const MAX_HISTORY = 50;

export function getDraftStorageKey(userId: string, versionId: number): string {
  return `${BUILDER_DRAFT_STORAGE_PREFIX}${userId}:${versionId}`;
}

export interface PendingFileEntry {
  file: File;
  previewUrl: string;
  fileName: string;
}

export interface PersistedPartialSaveInfo {
  message: string;
  completedSteps: SaveStepId[];
  pendingSteps: SaveStepId[];
  reconciliationPending: boolean;
}

interface PersistedDraftPayload {
  versionId: number;
  userId: string;
  savedAt: string;
  document: VersionDocument;
  serverBaseline?: VersionDocument | null;
  baselineSignature?: string;
  reconciliationPending?: boolean;
  partialSave?: PersistedPartialSaveInfo | null;
  sent?: SentSnapshot;
}

export interface BuilderState {
  versionId: number | null;
  document: VersionDocument | null;
  serverBaseline: VersionDocument | null;
  selectedNode: DocumentNodeRef;
  past: VersionDocument[];
  future: VersionDocument[];
  pendingFiles: Record<string, PendingFileEntry>;
  autosaveRestored: boolean;
  autosaveSavedAt: string | null;
  baselineSignature: string | undefined;
  reconciliationPending: boolean;
  partialSave: PersistedPartialSaveInfo | null;
  sent: SentSnapshot;
  initDocument: (serverDoc: VersionDocument) => void;
  dispatch: (action: DocumentAction) => void;
  undo: () => void;
  redo: () => void;
  selectNode: (ref: DocumentNodeRef) => void;
  registerPendingFile: (file: File) => {
    pendingFileId: string;
    previewUrl: string;
    fileName: string;
  };
  removePendingFile: (pendingFileId: string) => void;
  getPendingFilesMap: () => Record<string, File>;
  discardAutosave: () => void;
  reconcilePartialSave: (
    reconciledDoc: VersionDocument,
    reconciledBaseline: VersionDocument | null,
    reconciledBaselineSignature?: string,
    options?: {
      reconciliationPending?: boolean;
      partialSave?: PersistedPartialSaveInfo | null;
      sent?: SentSnapshot;
    },
  ) => void;
  resolveUncertainImageConflict: (
    resolution: UncertainImageResolutionContext,
    choice: UncertainImageResolutionChoice,
    options?: { clearPartialIfClean?: boolean },
  ) => { applied: boolean; stale: boolean; staleReason?: string };
  commitSaved: (freshServerDoc: VersionDocument) => void;
  reset: () => void;
}

const DEFAULT_SELECTED_NODE: DocumentNodeRef = { kind: "version" };

function getCurrentUserId(): string | null {
  return useStaffAuth.getState().user?.id ?? null;
}

function revokePendingUrls(pendingFiles: Record<string, PendingFileEntry>): void {
  for (const entry of Object.values(pendingFiles)) {
    try {
      URL.revokeObjectURL(entry.previewUrl);
    } catch {
      // Ignorar si el entorno no soporta revokeObjectURL o ya fue revocada
    }
  }
}

function removeAutosave(userId: string | null, versionId: number | null): void {
  if (!userId || versionId === null) return;
  try {
    sessionStorage.removeItem(getDraftStorageKey(userId, versionId));
  } catch {
    // storage no disponible
  }
}

function writeAutosave(
  userId: string | null,
  doc: VersionDocument,
  serverBaseline: VersionDocument | null,
  baselineSignature: string | undefined,
  reconciliationPending?: boolean,
  partialSave?: PersistedPartialSaveInfo | null,
  sent?: SentSnapshot,
): string | null {
  if (!userId) return null;
  const savedAt = new Date().toISOString();
  const hasSent =
    sent !== undefined &&
    (Object.keys(sent.nodes).length > 0 || Object.keys(sent.uploads).length > 0);
  const payload: PersistedDraftPayload = {
    versionId: doc.version.versionId,
    userId,
    savedAt,
    document: doc,
    ...(serverBaseline ? { serverBaseline } : {}),
    baselineSignature,
    ...(reconciliationPending ? { reconciliationPending: true } : {}),
    ...(partialSave ? { partialSave } : {}),
    ...(hasSent ? { sent } : {}),
  };
  try {
    sessionStorage.setItem(
      getDraftStorageKey(userId, doc.version.versionId),
      JSON.stringify(payload),
    );
    return savedAt;
  } catch {
    return null;
  }
}

function sanitizeRestoredImage(image: DocumentImage): DocumentImage {
  if (image.pendingFileId !== null && image.resourceId === null) {
    return { ...image, previewUrl: null };
  }
  return image;
}

function sanitizeRestoredDocument(doc: VersionDocument): VersionDocument {
  return {
    ...doc,
    subtests: doc.subtests.map((subtest) => ({
      ...subtest,
      items: subtest.items.map((item) => ({
        ...item,
        images: item.images.map(sanitizeRestoredImage),
        options: item.options.map((opt) => ({
          ...opt,
          images: opt.images.map(sanitizeRestoredImage),
        })),
      })),
    })),
  };
}

function isValidPartialSaveInfo(value: unknown): value is PersistedPartialSaveInfo {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<PersistedPartialSaveInfo>;
  return (
    typeof record.message === "string" &&
    Array.isArray(record.completedSteps) &&
    Array.isArray(record.pendingSteps) &&
    typeof record.reconciliationPending === "boolean"
  );
}

function readRestoredAutosave(
  userId: string | null,
  versionId: number,
): {
  document: VersionDocument;
  serverBaseline?: VersionDocument;
  savedAt: string | null;
  baselineSignature?: string;
  reconciliationPending?: boolean;
  partialSave?: PersistedPartialSaveInfo | null;
  sent?: SentSnapshot;
} | null {
  if (!userId) return null;
  try {
    const raw = sessionStorage.getItem(getDraftStorageKey(userId, versionId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedDraftPayload> | null;
    if (
      !parsed ||
      parsed.versionId !== versionId ||
      parsed.userId !== userId ||
      !parsed.document ||
      parsed.document.version?.versionId !== versionId
    ) {
      return null;
    }
    if (!isDocumentDirty(parsed.document) && !parsed.reconciliationPending) {
      removeAutosave(userId, versionId);
      return null;
    }
    const restoredBaseline =
      parsed.serverBaseline && parsed.serverBaseline.version?.versionId === versionId
        ? sanitizeRestoredDocument(parsed.serverBaseline)
        : undefined;
    return {
      document: sanitizeRestoredDocument(parsed.document),
      serverBaseline: restoredBaseline,
      baselineSignature: typeof parsed.baselineSignature === "string" ? parsed.baselineSignature : undefined,
      reconciliationPending: parsed.reconciliationPending === true,
      partialSave: isValidPartialSaveInfo(parsed.partialSave) ? parsed.partialSave : null,
      sent: isSentSnapshot(parsed.sent) ? cloneSentSnapshot(parsed.sent) : undefined,
      savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : null,
    };
  } catch {
    return null;
  }
}

function reconcileSelectedNode(doc: VersionDocument | null, ref: DocumentNodeRef): DocumentNodeRef {
  if (!doc) return DEFAULT_SELECTED_NODE;

  switch (ref.kind) {
    case "version":
    case "publish":
      return ref;

    case "subtest": {
      const exists = doc.subtests.some(
        (s) => s.draftId === ref.subtestDraftId && isActiveDraftNode(s),
      );
      return exists ? ref : DEFAULT_SELECTED_NODE;
    }

    case "item": {
      const subtest = doc.subtests.find(
        (s) => s.draftId === ref.subtestDraftId && isActiveDraftNode(s),
      );
      if (!subtest) return DEFAULT_SELECTED_NODE;
      const itemExists = subtest.items.some(
        (i) => i.draftId === ref.itemDraftId && isActiveDraftNode(i),
      );
      return itemExists ? ref : { kind: "subtest", subtestDraftId: subtest.draftId };
    }

    case "baremos": {
      if (!ref.baremoDraftId) return ref;
      const baremoExists = doc.baremos.some(
        (b) => b.draftId === ref.baremoDraftId && isActiveDraftNode(b),
      );
      return baremoExists ? ref : { kind: "baremos" };
    }
  }
}

function remapSelectedNodeAfterSave(
  prevDoc: VersionDocument | null,
  freshDoc: VersionDocument,
  ref: DocumentNodeRef,
): DocumentNodeRef {
  if (!prevDoc) return reconcileSelectedNode(freshDoc, ref);

  switch (ref.kind) {
    case "version":
    case "publish":
      return ref;

    case "subtest": {
      const direct = freshDoc.subtests.find(
        (s) => s.draftId === ref.subtestDraftId && isActiveDraftNode(s),
      );
      if (direct) return { kind: "subtest", subtestDraftId: direct.draftId };

      const prevSubtest = prevDoc.subtests.find((s) => s.draftId === ref.subtestDraftId);
      if (!prevSubtest) return DEFAULT_SELECTED_NODE;

      const byCode = freshDoc.subtests.find(
        (s) => isActiveDraftNode(s) && codeKey(s.code) === codeKey(prevSubtest.code),
      );
      return byCode ? { kind: "subtest", subtestDraftId: byCode.draftId } : DEFAULT_SELECTED_NODE;
    }

    case "item": {
      const prevSubtest = prevDoc.subtests.find((s) => s.draftId === ref.subtestDraftId);
      const freshSubtest =
        freshDoc.subtests.find(
          (s) => s.draftId === ref.subtestDraftId && isActiveDraftNode(s),
        ) ??
        (prevSubtest
          ? freshDoc.subtests.find(
              (s) =>
                isActiveDraftNode(s) &&
                codeKey(s.code) === codeKey(prevSubtest.code),
            )
          : undefined);

      if (!freshSubtest) return DEFAULT_SELECTED_NODE;

      const directItem = freshSubtest.items.find(
        (i) => i.draftId === ref.itemDraftId && isActiveDraftNode(i),
      );
      if (directItem) {
        return {
          kind: "item",
          subtestDraftId: freshSubtest.draftId,
          itemDraftId: directItem.draftId,
        };
      }

      const prevItem = prevSubtest?.items.find((i) => i.draftId === ref.itemDraftId);
      if (prevItem) {
        const byCodeItem = freshSubtest.items.find(
          (i) => isActiveDraftNode(i) && codeKey(i.code) === codeKey(prevItem.code),
        );
        if (byCodeItem) {
          return {
            kind: "item",
            subtestDraftId: freshSubtest.draftId,
            itemDraftId: byCodeItem.draftId,
          };
        }
      }

      return { kind: "subtest", subtestDraftId: freshSubtest.draftId };
    }

    case "baremos": {
      if (!ref.baremoDraftId) return ref;
      const direct = freshDoc.baremos.find(
        (b) => b.draftId === ref.baremoDraftId && isActiveDraftNode(b),
      );
      if (direct) return { kind: "baremos", baremoDraftId: direct.draftId };

      const prevBaremo = prevDoc.baremos.find((b) => b.draftId === ref.baremoDraftId);
      if (!prevBaremo) return { kind: "baremos" };

      const prevNatural = baremoNaturalKey(prevBaremo);
      const byNatural =
        prevNatural !== ""
          ? freshDoc.baremos.find(
              (b) => isActiveDraftNode(b) && baremoNaturalKey(b) === prevNatural,
            )
          : undefined;
      return byNatural ? { kind: "baremos", baremoDraftId: byNatural.draftId } : { kind: "baremos" };
    }
  }
}

function syncAutosaveForDocument(
  userId: string | null,
  doc: VersionDocument,
  serverBaseline: VersionDocument | null,
  baselineSignature: string | undefined,
  reconciliationPending?: boolean,
  partialSave?: PersistedPartialSaveInfo | null,
  sent?: SentSnapshot,
): { autosaveSavedAt: string | null } {
  if (doc.version.status !== "BORRADOR") {
    removeAutosave(userId, doc.version.versionId);
    return { autosaveSavedAt: null };
  }
  if (isDocumentDirty(doc) || reconciliationPending) {
    const savedAt = writeAutosave(
      userId,
      doc,
      serverBaseline,
      baselineSignature,
      reconciliationPending,
      partialSave,
      sent,
    );
    return { autosaveSavedAt: savedAt };
  }
  removeAutosave(userId, doc.version.versionId);
  return { autosaveSavedAt: null };
}

export const useBuilderStore = create<BuilderState>()((set, get) => ({
  versionId: null,
  document: null,
  serverBaseline: null,
  selectedNode: DEFAULT_SELECTED_NODE,
  past: [],
  future: [],
  pendingFiles: {},
  autosaveRestored: false,
  autosaveSavedAt: null,
  baselineSignature: undefined,
  reconciliationPending: false,
  partialSave: null,
  sent: createEmptySentSnapshot(),

  initDocument: (serverDoc) => {
    const userId = getCurrentUserId();
    revokePendingUrls(get().pendingFiles);

    if (serverDoc.version.status !== "BORRADOR") {
      removeAutosave(userId, serverDoc.version.versionId);
      set({
        versionId: serverDoc.version.versionId,
        document: serverDoc,
        serverBaseline: serverDoc,
        baselineSignature: documentSignature(serverDoc),
        reconciliationPending: false,
        partialSave: null,
        sent: createEmptySentSnapshot(),
        selectedNode: DEFAULT_SELECTED_NODE,
        past: [],
        future: [],
        pendingFiles: {},
        autosaveRestored: false,
        autosaveSavedAt: null,
      });
      return;
    }

    const restored = readRestoredAutosave(userId, serverDoc.version.versionId);
    if (restored) {
      set({
        versionId: serverDoc.version.versionId,
        document: restored.document,
        serverBaseline: restored.serverBaseline ?? serverDoc,
        baselineSignature: restored.baselineSignature ?? documentSignature(serverDoc),
        reconciliationPending: restored.reconciliationPending ?? false,
        partialSave: restored.partialSave ?? null,
        sent: restored.sent ?? createEmptySentSnapshot(),
        selectedNode: DEFAULT_SELECTED_NODE,
        past: [],
        future: [],
        pendingFiles: {},
        autosaveRestored: true,
        autosaveSavedAt: restored.savedAt,
      });
      return;
    }

    set({
      versionId: serverDoc.version.versionId,
      document: serverDoc,
      serverBaseline: serverDoc,
      baselineSignature: documentSignature(serverDoc),
      reconciliationPending: false,
      partialSave: null,
      sent: createEmptySentSnapshot(),
      selectedNode: DEFAULT_SELECTED_NODE,
      past: [],
      future: [],
      pendingFiles: {},
      autosaveRestored: false,
      autosaveSavedAt: null,
    });
  },

  dispatch: (action) => {
    const state = get();
    const currentDoc = state.document;
    if (!currentDoc) return;

    const nextDoc = documentReducer(currentDoc, action);
    if (nextDoc === currentDoc) return;

    const nextPast = [...state.past, currentDoc].slice(-MAX_HISTORY);
    const nextSelected = reconcileSelectedNode(nextDoc, state.selectedNode);
    const { autosaveSavedAt } = syncAutosaveForDocument(
      getCurrentUserId(),
      nextDoc,
      state.serverBaseline,
      state.baselineSignature,
      state.reconciliationPending,
      state.partialSave,
      state.sent,
    );

    set({
      document: nextDoc,
      past: nextPast,
      future: [],
      selectedNode: nextSelected,
      autosaveSavedAt,
    });
  },

  undo: () => {
    const state = get();
    if (!state.document || state.past.length === 0) return;
    if (state.document.version.status !== "BORRADOR") return;

    const previousDoc = state.past[state.past.length - 1]!;
    const nextPast = state.past.slice(0, -1);
    const nextFuture = [state.document, ...state.future].slice(0, MAX_HISTORY);
    const nextSelected = reconcileSelectedNode(previousDoc, state.selectedNode);
    const { autosaveSavedAt } = syncAutosaveForDocument(
      getCurrentUserId(),
      previousDoc,
      state.serverBaseline,
      state.baselineSignature,
      state.reconciliationPending,
      state.partialSave,
      state.sent,
    );

    set({
      document: previousDoc,
      past: nextPast,
      future: nextFuture,
      selectedNode: nextSelected,
      autosaveSavedAt,
    });
  },

  redo: () => {
    const state = get();
    if (!state.document || state.future.length === 0) return;
    if (state.document.version.status !== "BORRADOR") return;

    const nextDoc = state.future[0]!;
    const nextFuture = state.future.slice(1);
    const nextPast = [...state.past, state.document].slice(-MAX_HISTORY);
    const nextSelected = reconcileSelectedNode(nextDoc, state.selectedNode);
    const { autosaveSavedAt } = syncAutosaveForDocument(
      getCurrentUserId(),
      nextDoc,
      state.serverBaseline,
      state.baselineSignature,
      state.reconciliationPending,
      state.partialSave,
      state.sent,
    );

    set({
      document: nextDoc,
      past: nextPast,
      future: nextFuture,
      selectedNode: nextSelected,
      autosaveSavedAt,
    });
  },

  selectNode: (ref) => {
    const nextSelected = reconcileSelectedNode(get().document, ref);
    set({ selectedNode: nextSelected });
  },

  registerPendingFile: (file) => {
    const pendingFileId = createDefaultDraftId("file");
    const previewUrl = URL.createObjectURL(file);
    const fileName = file.name;

    set((state) => ({
      pendingFiles: {
        ...state.pendingFiles,
        [pendingFileId]: { file, previewUrl, fileName },
      },
    }));

    return { pendingFileId, previewUrl, fileName };
  },

  removePendingFile: (pendingFileId) => {
    const state = get();
    const entry = state.pendingFiles[pendingFileId];
    if (!entry) return;
    // Una imagen del documento o de su historial debe seguir disponible al deshacer.
    const retained = [state.document, ...state.past, ...state.future].some(
      (doc) => doc && collectPendingImageUploads(doc).some((upload) => upload.pendingFileId === pendingFileId),
    );
    if (retained) return;

    try {
      URL.revokeObjectURL(entry.previewUrl);
    } catch {
      // Ignorar si ya estaba revocada
    }

    set((state) => {
      const rest = { ...state.pendingFiles };
      delete rest[pendingFileId];
      return { pendingFiles: rest };
    });
  },

  getPendingFilesMap: () => {
    const map: Record<string, File> = {};
    for (const [id, entry] of Object.entries(get().pendingFiles)) {
      map[id] = entry.file;
    }
    return map;
  },

  discardAutosave: () => {
    const state = get();
    const userId = getCurrentUserId();
    revokePendingUrls(state.pendingFiles);
    removeAutosave(userId, state.versionId);

    const baseline = state.serverBaseline;
    set({
      document: baseline,
      baselineSignature: baseline ? documentSignature(baseline) : undefined,
      reconciliationPending: false,
      partialSave: null,
      sent: createEmptySentSnapshot(),
      selectedNode: reconcileSelectedNode(baseline, state.selectedNode),
      past: [],
      future: [],
      pendingFiles: {},
      autosaveRestored: false,
      autosaveSavedAt: null,
    });
  },

  reconcilePartialSave: (reconciledDoc, reconciledBaseline, reconciledBaselineSignature, options) => {
    const state = get();
    const userId = getCurrentUserId();
    const stillNeededFileIds = new Set(
      collectPendingImageUploads(reconciledDoc).map((u) => u.pendingFileId),
    );
    const nextPendingFiles: Record<string, PendingFileEntry> = {};
    for (const [id, entry] of Object.entries(state.pendingFiles)) {
      if (stillNeededFileIds.has(id)) {
        nextPendingFiles[id] = entry;
      } else {
        try {
          URL.revokeObjectURL(entry.previewUrl);
        } catch {
          // Ignorar si ya estaba revocada
        }
      }
    }

    const nextBaseline = reconciledBaseline ?? state.serverBaseline;
    const nextBaselineSignature =
      reconciledBaselineSignature ??
      (nextBaseline ? documentSignature(nextBaseline) : state.baselineSignature);
    const nextReconciliationPending =
      options?.reconciliationPending ?? state.reconciliationPending;
    const nextPartialSave =
      options?.partialSave !== undefined ? options.partialSave : state.partialSave;
    const nextSent =
      options?.sent !== undefined ? cloneSentSnapshot(options.sent) : state.sent;
    const remappedSelection = remapSelectedNodeAfterSave(
      state.document,
      reconciledDoc,
      state.selectedNode,
    );
    const { autosaveSavedAt } = syncAutosaveForDocument(
      userId,
      reconciledDoc,
      nextBaseline,
      nextBaselineSignature,
      nextReconciliationPending,
      nextPartialSave,
      nextSent,
    );

    set({
      document: reconciledDoc,
      serverBaseline: nextBaseline,
      baselineSignature: nextBaselineSignature,
      reconciliationPending: nextReconciliationPending,
      partialSave: nextPartialSave,
      sent: nextSent,
      selectedNode: remappedSelection,
      past: [],
      future: [],
      pendingFiles: nextPendingFiles,
      autosaveSavedAt,
    });
  },

  resolveUncertainImageConflict: (resolution, choice, options) => {
    const state = get();
    const currentDoc = state.document;
    if (!currentDoc) {
      return { applied: false, stale: true, staleReason: "No hay documento cargado." };
    }

    const resolved = resolveUncertainImageConflictInDoc({
      document: currentDoc,
      baseline: state.serverBaseline,
      sent: state.sent,
      resolution,
      choice,
    });
    const userId = getCurrentUserId();

    if (resolved.stale) {
      const staleMessage =
        resolved.staleReason ??
        "La imagen local cambió desde que se detectó el conflicto; vuelve a sincronizar antes de continuar.";
      const nextPartialSave: PersistedPartialSaveInfo = state.partialSave
        ? {
            ...state.partialSave,
            message: staleMessage,
            reconciliationPending: true,
          }
        : {
            message: staleMessage,
            completedSteps: [],
            pendingSteps: [],
            reconciliationPending: true,
          };
      const { autosaveSavedAt } = syncAutosaveForDocument(
        userId,
        currentDoc,
        state.serverBaseline,
        state.baselineSignature,
        true,
        nextPartialSave,
        state.sent,
      );
      set({
        reconciliationPending: true,
        partialSave: nextPartialSave,
        autosaveSavedAt,
      });
      return { applied: false, stale: true, staleReason: staleMessage };
    }

    // Nunca retirar un File pendiente que no sea exactamente el del snapshot de origen.
    const snapshotPendingFileId = resolution.origin.localImage?.pendingFileId ?? null;
    const stillNeededFileIds = new Set(
      collectPendingImageUploads(resolved.document).map((u) => u.pendingFileId),
    );
    const nextPendingFiles: Record<string, PendingFileEntry> = {};
    for (const [id, entry] of Object.entries(state.pendingFiles)) {
      const isSnapshotFile = snapshotPendingFileId !== null && id === snapshotPendingFileId;
      if (!isSnapshotFile || stillNeededFileIds.has(id)) {
        nextPendingFiles[id] = entry;
      } else {
        try {
          URL.revokeObjectURL(entry.previewUrl);
        } catch {
          // Ignorar si ya estaba revocada
        }
      }
    }

    const nextBaseline = resolved.baseline ?? state.serverBaseline;
    const nextBaselineSignature = nextBaseline
      ? documentSignature(nextBaseline)
      : state.baselineSignature;
    const nextSent = cloneSentSnapshot(resolved.sent);
    const shouldClearPartial =
      Boolean(options?.clearPartialIfClean) &&
      !isDocumentDirty(resolved.document) &&
      !state.reconciliationPending;
    const nextPartialSave = shouldClearPartial ? null : state.partialSave;
    const remappedSelection = remapSelectedNodeAfterSave(
      currentDoc,
      resolved.document,
      state.selectedNode,
    );
    const { autosaveSavedAt } = syncAutosaveForDocument(
      userId,
      resolved.document,
      nextBaseline,
      nextBaselineSignature,
      state.reconciliationPending,
      nextPartialSave,
      nextSent,
    );

    set({
      document: resolved.document,
      serverBaseline: nextBaseline,
      baselineSignature: nextBaselineSignature,
      partialSave: nextPartialSave,
      sent: nextSent,
      selectedNode: remappedSelection,
      past: [],
      future: [],
      pendingFiles: nextPendingFiles,
      autosaveSavedAt,
    });

    return { applied: true, stale: false };
  },

  commitSaved: (freshServerDoc) => {
    const state = get();
    const userId = getCurrentUserId();
    revokePendingUrls(state.pendingFiles);
    removeAutosave(userId, freshServerDoc.version.versionId);
    if (state.versionId !== null && state.versionId !== freshServerDoc.version.versionId) {
      removeAutosave(userId, state.versionId);
    }

    const remappedSelection = remapSelectedNodeAfterSave(
      state.document,
      freshServerDoc,
      state.selectedNode,
    );

    set({
      versionId: freshServerDoc.version.versionId,
      document: freshServerDoc,
      serverBaseline: freshServerDoc,
      baselineSignature: documentSignature(freshServerDoc),
      reconciliationPending: false,
      partialSave: null,
      sent: createEmptySentSnapshot(),
      selectedNode: remappedSelection,
      past: [],
      future: [],
      pendingFiles: {},
      autosaveRestored: false,
      autosaveSavedAt: null,
    });
  },

  reset: () => {
    revokePendingUrls(get().pendingFiles);
    set({
      versionId: null,
      document: null,
      serverBaseline: null,
      baselineSignature: undefined,
      reconciliationPending: false,
      partialSave: null,
      sent: createEmptySentSnapshot(),
      selectedNode: DEFAULT_SELECTED_NODE,
      past: [],
      future: [],
      pendingFiles: {},
      autosaveRestored: false,
      autosaveSavedAt: null,
    });
  },
}));

registerAccountReset(() => useBuilderStore.getState().reset());
