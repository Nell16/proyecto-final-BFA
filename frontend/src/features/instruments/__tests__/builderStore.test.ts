import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAccountScopedState } from "../../../store/accountReset";
import { useStaffAuth } from "../../../store/staffAuth";
import {
  BUILDER_DRAFT_STORAGE_PREFIX,
  getDraftStorageKey,
  MAX_HISTORY,
  useBuilderStore,
} from "../builderStore";
import { reconcileVersionDocumentThreeWay } from "../document/reconcile";
import { canonicalBaremo, createEmptySentSnapshot, sentKey, uploadSlotKey } from "../document/sent";
import { createCleanDocument } from "../document/__tests__/fixtures";

describe("builderStore", () => {
  let blobCounter = 0;
  let revokedUrls: string[] = [];

  beforeEach(() => {
    blobCounter = 0;
    revokedUrls = [];
    sessionStorage.clear();
    sessionStorage.clear();

    vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
      blobCounter += 1;
      return `blob:mock-${blobCounter}`;
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation((url: string) => {
      revokedUrls.push(url);
    });

    useStaffAuth.getState().setSession({
      token: "jwt-1",
      expiresAt: null,
      user: {
        id: "user-1",
        username: "ana",
        roles: ["PSICOLOGO"],
        permissions: ["TEST_CREAR"],
      },
    });
    useBuilderStore.getState().reset();
  });

  afterEach(() => {
    useBuilderStore.getState().reset();
    useStaffAuth.getState().clear();
    vi.restoreAllMocks();
  });

  it("soporta dispatch, undo, redo con tope MAX_HISTORY y preserva previewUrl tras undo de borrado de imagen", () => {
    const serverDoc = createCleanDocument();
    useBuilderStore.getState().initDocument(serverDoc);

    // Registrar archivo local pendiente y adjuntarlo al ítem
    const file = new File(["img"], "nueva.png", { type: "image/png" });
    const pending = useBuilderStore.getState().registerPendingFile(file);
    expect(pending.previewUrl).toBe("blob:mock-1");

    useBuilderStore.getState().dispatch({
      type: "ATTACH_ITEM_IMAGE",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      image: {
        draftId: "img-pending-1",
        pendingFileId: pending.pendingFileId,
        previewUrl: pending.previewUrl,
        fileName: pending.fileName,
        altText: "Nueva figura",
      },
    });

    // El editor avisa de la eliminación antes de aplicar la acción.
    useBuilderStore.getState().removePendingFile(pending.pendingFileId);
    useBuilderStore.getState().dispatch({
      type: "DELETE_ITEM_IMAGE",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      imageDraftId: "img-pending-1",
    });
    expect(revokedUrls).toEqual([]);
    expect(useBuilderStore.getState().document?.subtests[0]?.items[0]?.images).toHaveLength(1);

    useBuilderStore.getState().undo();
    const restoredImages = useBuilderStore.getState().document?.subtests[0]?.items[0]?.images;
    expect(restoredImages).toHaveLength(2);
    expect(restoredImages?.[1]?.previewUrl).toBe("blob:mock-1");
    expect(useBuilderStore.getState().getPendingFilesMap()[pending.pendingFileId]).toBe(file);

    useBuilderStore.getState().redo();
    expect(useBuilderStore.getState().document?.subtests[0]?.items[0]?.images).toHaveLength(1);

    // Límite MAX_HISTORY
    for (let i = 0; i < MAX_HISTORY + 15; i += 1) {
      useBuilderStore.getState().dispatch({
        type: "UPDATE_VERSION_META",
        patch: { instructions: `Inst ${i}` },
      });
    }
    expect(useBuilderStore.getState().past).toHaveLength(MAX_HISTORY);
  });

  it("bloquea ediciones en versiones no-BORRADOR y limpia autosave previo", () => {
    const key = getDraftStorageKey("user-1", 10);
    const dirtyDraft = createCleanDocument();
    dirtyDraft.version.metaDirty = true;
    sessionStorage.setItem(
      key,
      JSON.stringify({
        versionId: 10,
        userId: "user-1",
        savedAt: "2026-11-25T12:00:00.000Z",
        document: dirtyDraft,
      }),
    );

    const published = createCleanDocument();
    published.version.status = "PUBLICADO";
    useBuilderStore.getState().initDocument(published);

    expect(sessionStorage.getItem(key)).toBeNull();
    expect(useBuilderStore.getState().autosaveRestored).toBe(false);

    useBuilderStore.getState().dispatch({
      type: "UPDATE_VERSION_META",
      patch: { instructions: "No debe aplicar" },
    });
    expect(useBuilderStore.getState().document?.version.instructions).toBe(
      published.version.instructions,
    );
    expect(useBuilderStore.getState().past).toHaveLength(0);
  });

  it("persiste autosave al ensuciar, limpia al volver a limpio y restaura limpiando previewUrl de pendingFileId huérfano", () => {
    const serverDoc = createCleanDocument();
    const key = getDraftStorageKey("user-1", 10);

    useBuilderStore.getState().initDocument(serverDoc);
    expect(sessionStorage.getItem(key)).toBeNull();

    useBuilderStore.getState().dispatch({
      type: "ATTACH_ITEM_IMAGE",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      image: {
        draftId: "img-local",
        pendingFileId: "file-1",
        previewUrl: "blob:mock-old",
        fileName: "local.png",
      },
    });
    expect(sessionStorage.getItem(key)).not.toBeNull();

    // Simular recarga de página reiniciando el store en memoria sin borrar sessionStorage
    useBuilderStore.getState().reset();
    useBuilderStore.getState().initDocument(serverDoc);

    const stateAfterReload = useBuilderStore.getState();
    expect(stateAfterReload.autosaveRestored).toBe(true);
    const restoredImg = stateAfterReload.document?.subtests[0]?.items[0]?.images.find(
      (i) => i.draftId === "img-local",
    );
    expect(restoredImg?.pendingFileId).toBe("file-1");
    expect(restoredImg?.previewUrl).toBeNull();

    // discardAutosave revierte al baseline y limpia sessionStorage
    useBuilderStore.getState().discardAutosave();
    expect(useBuilderStore.getState().autosaveRestored).toBe(false);
    expect(sessionStorage.getItem(key)).toBeNull();
    expect(useBuilderStore.getState().document?.subtests[0]?.items[0]?.images).toHaveLength(1);

    // Si se ensucia y vuelve a quedar limpio con undo, borra la clave de autosave
    useBuilderStore.getState().dispatch({
      type: "UPDATE_VERSION_META",
      patch: { instructions: "Temporal" },
    });
    expect(sessionStorage.getItem(key)).not.toBeNull();
    useBuilderStore.getState().undo();
    expect(sessionStorage.getItem(key)).toBeNull();
  });

  it("commitSaved remapea selectedNode por código tras guardar subtest/ítem nuevos y revoca blob URLs", () => {
    const serverDoc = createCleanDocument();
    useBuilderStore.getState().initDocument(serverDoc);

    const pending = useBuilderStore
      .getState()
      .registerPendingFile(new File(["x"], "x.png", { type: "image/png" }));

    useBuilderStore.getState().dispatch({
      type: "ADD_SUBTEST",
      input: { draftId: "sub-temp", code: "ESP", name: "Espacial" },
    });
    useBuilderStore.getState().dispatch({
      type: "ADD_ITEM",
      subtestDraftId: "sub-temp",
      input: { draftId: "item-temp", code: "IT-ESP-1" },
    });
    useBuilderStore.getState().selectNode({
      kind: "item",
      subtestDraftId: "sub-temp",
      itemDraftId: "item-temp",
    });

    const freshServerDoc = createCleanDocument();
    freshServerDoc.subtests.push({
      ...freshServerDoc.subtests[0]!,
      id: 99,
      draftId: "sub-99",
      code: "ESP",
      name: "Espacial",
      order: 2,
      items: [
        {
          ...freshServerDoc.subtests[0]!.items[0]!,
          id: 555,
          draftId: "item-555",
          code: "IT-ESP-1",
          order: 1,
        },
      ],
    });

    useBuilderStore.getState().commitSaved(freshServerDoc);

    expect(revokedUrls).toEqual([pending.previewUrl]);
    expect(useBuilderStore.getState().pendingFiles).toEqual({});
    expect(useBuilderStore.getState().selectedNode).toEqual({
      kind: "item",
      subtestDraftId: "sub-99",
      itemDraftId: "item-555",
    });
    expect(sessionStorage.getItem(getDraftStorageKey("user-1", 10))).toBeNull();
  });

  it("resetAccountScopedState limpia store, revoca URLs, borra claves bfa-instrument-draft:* y preserva claves de participante", () => {
    const serverDoc = createCleanDocument();
    useBuilderStore.getState().initDocument(serverDoc);
    const pending = useBuilderStore
      .getState()
      .registerPendingFile(new File(["y"], "y.png", { type: "image/png" }));

    useBuilderStore.getState().dispatch({
      type: "UPDATE_VERSION_META",
      patch: { instructions: "Draft sucio" },
    });

    sessionStorage.setItem(`${BUILDER_DRAFT_STORAGE_PREFIX}other-user:99`, "{}");
    sessionStorage.setItem("runtime:assignment-42", '{"saved":true}');
    // Residuo de versiones anteriores que guardaban el borrador en localStorage.
    localStorage.setItem(`${BUILDER_DRAFT_STORAGE_PREFIX}legacy-user:7`, "{}");

    resetAccountScopedState();

    expect(localStorage.getItem(`${BUILDER_DRAFT_STORAGE_PREFIX}legacy-user:7`)).toBeNull();

    expect(useBuilderStore.getState().document).toBeNull();
    expect(useBuilderStore.getState().versionId).toBeNull();
    expect(revokedUrls).toEqual([pending.previewUrl]);
    expect(sessionStorage.getItem(getDraftStorageKey("user-1", 10))).toBeNull();
    expect(sessionStorage.getItem(`${BUILDER_DRAFT_STORAGE_PREFIX}other-user:99`)).toBeNull();
    expect(sessionStorage.getItem("runtime:assignment-42")).toBe('{"saved":true}');
  });

  it("el autosave del borrador (contenido confidencial) nunca escribe en localStorage", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    useBuilderStore.getState().initDocument(createCleanDocument());
    useBuilderStore.getState().dispatch({ type: "UPDATE_VERSION_META", patch: { instructions: "Borrador" } });
    const wroteDraftToLocal = setItem.mock.contexts.some(
      (ctx, i) => ctx === localStorage && String(setItem.mock.calls[i]?.[0]).startsWith(BUILDER_DRAFT_STORAGE_PREFIX),
    );
    setItem.mockRestore();
    expect(wroteDraftToLocal).toBe(false);
  });

  it("F3-FIX-4 (MEDIO): persiste y restaura reconciliationPending, serverBaseline y partialSave al reabrir aunque no haya cambios sucios", () => {
    const serverDoc = createCleanDocument();
    useBuilderStore.getState().initDocument(serverDoc);

    const savedDoc = {
      ...serverDoc,
      version: { ...serverDoc.version, instructions: "Ya guardado", metaDirty: false },
      dirtyNodeIds: [],
    };
    useBuilderStore.getState().reconcilePartialSave(savedDoc, savedDoc, undefined, {
      reconciliationPending: true,
      partialSave: {
        message: "No se pudo recargar el estado final.",
        completedSteps: ["metadata"],
        pendingSteps: [],
        reconciliationPending: true,
      },
    });

    const key = getDraftStorageKey("user-1", 10);
    expect(sessionStorage.getItem(key)).not.toBeNull();

    // Simular cierre y reapertura del editor
    useBuilderStore.getState().reset();
    useBuilderStore.getState().initDocument(serverDoc);

    const restored = useBuilderStore.getState();
    expect(restored.reconciliationPending).toBe(true);
    expect(restored.partialSave).toEqual({
      message: "No se pudo recargar el estado final.",
      completedSteps: ["metadata"],
      pendingSteps: [],
      reconciliationPending: true,
    });
    expect(restored.serverBaseline?.version.instructions).toBe("Ya guardado");
    expect(restored.document?.dirtyNodeIds).toEqual([]);
  });

  it("F3-FIX-5: persiste y restaura sentSnapshot junto con partialSave y lo preserva tras dispatch", () => {
    const serverDoc = createCleanDocument({ baremos: [] });
    useBuilderStore.getState().initDocument(serverDoc);

    useBuilderStore.getState().dispatch({
      type: "ADD_BAREMO",
      input: { draftId: "bar-new", code: "BAR-TOT", name: "Nombre enviado" },
    });
    const draftDoc = useBuilderStore.getState().document!;
    const sent = createEmptySentSnapshot();
    sent.nodes[sentKey.baremo("bar-new")] = {
      op: "CREATED",
      sig: canonicalBaremo(draftDoc.baremos[0]!),
    };

    useBuilderStore.getState().reconcilePartialSave(draftDoc, serverDoc, undefined, {
      reconciliationPending: true,
      partialSave: {
        message: "Error temporal",
        completedSteps: [],
        pendingSteps: ["baremos"],
        reconciliationPending: true,
      },
      sent,
    });

    // Editar baremo antes de reintentar debe conservar `sent`
    useBuilderStore.getState().dispatch({
      type: "UPDATE_BAREMO",
      baremoDraftId: "bar-new",
      patch: { name: "Nombre editado" },
    });

    // Simular cierre y reapertura
    useBuilderStore.getState().reset();
    useBuilderStore.getState().initDocument(serverDoc);

    const restored = useBuilderStore.getState();
    expect(restored.sent.nodes[sentKey.baremo("bar-new")]).toEqual(
      sent.nodes[sentKey.baremo("bar-new")],
    );
    expect(restored.document?.baremos[0]?.name).toBe("Nombre editado");
  });

  it("F3-FIX-8 (ALTO 2): resolveUncertainImageConflict en el store rechaza resolución obsoleta, pide resincronizar y nunca retira un File distinto al del snapshot", () => {
    const serverDoc = createCleanDocument({ baremos: [] });
    useBuilderStore.getState().initDocument(serverDoc);

    const oldFile = new File(["old"], "vieja.png", { type: "image/png" });
    const oldPending = useBuilderStore.getState().registerPendingFile(oldFile);

    useBuilderStore.getState().dispatch({
      type: "ATTACH_ITEM_IMAGE",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      image: {
        draftId: "img-old",
        pendingFileId: oldPending.pendingFileId,
        previewUrl: oldPending.previewUrl,
        order: 2,
        fileName: "vieja.png",
        altText: "Vieja",
        role: "ENUNCIADO",
      },
    });

    // POST incierto falla con 503 y el usuario elimina la imagen local antes de reconciliar
    const sent = createEmptySentSnapshot();
    const slotKey = uploadSlotKey({
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      optionDraftId: null,
      order: 2,
    });
    sent.uploads[slotKey] = {
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      optionDraftId: null,
      order: 2,
      pendingFileId: oldPending.pendingFileId,
      fileName: "vieja.png",
      altText: "Vieja",
      role: "ENUNCIADO",
    };

    useBuilderStore.getState().dispatch({
      type: "DELETE_ITEM_IMAGE",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      imageDraftId: "img-old",
    });

    const theirs = structuredClone(serverDoc);
    theirs.subtests[0]!.items[0]!.images.push({
      id: 88,
      draftId: "img-88",
      sourceId: null,
      resourceId: 905,
      pendingFileId: null,
      previewUrl: "/items/images/resources/905",
      status: "EXISTING",
      order: 2,
      altText: "Vieja",
      role: "ENUNCIADO",
      fileName: null,
      storagePath: "test-config/items/30/550e8400-e29b-41d4-a716-446655440000-vieja.png",
    });

    useBuilderStore.getState().reconcilePartialSave(
      useBuilderStore.getState().document!,
      serverDoc,
      undefined,
      { reconciliationPending: false, sent },
    );

    const reconcileRes = reconcileVersionDocumentThreeWay({
      base: serverDoc,
      mine: useBuilderStore.getState().document!,
      theirs,
      sent,
    });
    expect(reconcileRes.conflicts).toHaveLength(1);
    const oldResolution = reconcileRes.conflicts[0]!.resolution!;

    // El usuario adjunta un nuevo archivo en la posición libre (#2) después de detectarse el conflicto
    const newFile = new File(["new"], "nueva.png", { type: "image/png" });
    const newPending = useBuilderStore.getState().registerPendingFile(newFile);
    useBuilderStore.getState().dispatch({
      type: "ATTACH_ITEM_IMAGE",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      image: {
        draftId: "img-new",
        pendingFileId: newPending.pendingFileId,
        previewUrl: newPending.previewUrl,
        order: 2,
        fileName: "nueva.png",
        altText: "Nueva",
        role: "ENUNCIADO",
      },
    });

    const staleOutcome = useBuilderStore
      .getState()
      .resolveUncertainImageConflict(oldResolution, "keep_server");

    expect(staleOutcome.stale).toBe(true);
    expect(staleOutcome.applied).toBe(false);
    const stateAfterStale = useBuilderStore.getState();
    expect(stateAfterStale.reconciliationPending).toBe(true);
    expect(stateAfterStale.partialSave?.reconciliationPending).toBe(true);
    expect(stateAfterStale.getPendingFilesMap()[newPending.pendingFileId]).toBe(newFile);
    expect(stateAfterStale.document?.subtests[0]?.items[0]?.images.find((i) => i.order === 2)).toMatchObject({
      draftId: "img-new",
      pendingFileId: newPending.pendingFileId,
      status: "CREATED",
    });

    // Ahora probar que al resolver un conflicto vigente de img-new (keep_server) solo se retira el File del snapshot
    const otherFile = new File(["other"], "otro.png", { type: "image/png" });
    const otherPending = useBuilderStore.getState().registerPendingFile(otherFile);
    const freshReconcile = reconcileVersionDocumentThreeWay({
      base: serverDoc,
      mine: useBuilderStore.getState().document!,
      theirs,
      sent,
      pendingFiles: useBuilderStore.getState().getPendingFilesMap(),
    });
    const freshOutcome = useBuilderStore
      .getState()
      .resolveUncertainImageConflict(freshReconcile.conflicts[0]!.resolution!, "keep_server");

    expect(freshOutcome.stale).toBe(false);
    expect(freshOutcome.applied).toBe(true);
    expect(useBuilderStore.getState().getPendingFilesMap()[newPending.pendingFileId]).toBeUndefined();
    expect(useBuilderStore.getState().getPendingFilesMap()[otherPending.pendingFileId]).toBe(otherFile);
  });
});
