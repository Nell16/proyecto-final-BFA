import { describe, expect, it } from "vitest";
import { VersionConfigurationRequestSchema } from "../../../../api/schemas/instruments";
import {
  buildCloneConfiguration,
  buildConfigurationDiff,
  collectPendingImageUploads,
  collectSubtestsNeedingScoringRule,
} from "../diff";
import { createDocumentReducer } from "../reducer";
import { createCleanDocument, makeDeterministicDraftIdFactory } from "./fixtures";

describe("buildConfigurationDiff & helpers", () => {
  it("genera diff vacío cuando el documento está limpio y pasa VersionConfigurationRequestSchema", () => {
    const doc = createCleanDocument();
    const diff = buildConfigurationDiff(doc);

    expect(diff).toEqual({ subtests: [] });
    expect(VersionConfigurationRequestSchema.safeParse(diff).success).toBe(true);
  });

  it("emite solo los nodos modificados en diff parcial y valida contra VersionConfigurationRequestSchema", () => {
    const reducer = createDocumentReducer(makeDeterministicDraftIdFactory(100));
    let doc = createCleanDocument();

    // Agregamos un subtest limpio adicional que NO debería entrar en el diff
    doc.subtests.push({
      ...doc.subtests[0]!,
      id: 21,
      draftId: "sub-21",
      status: "EXISTING",
      code: "LOG",
      name: "Razonamiento Lógico",
      order: 2,
      items: [],
    });

    // Solo modificamos una opción del primer ítem de sub-20
    doc = reducer(doc, {
      type: "UPDATE_OPTION",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      optionDraftId: "opt-41",
      patch: { text: "Opción B actualizada" },
    });

    const diff = buildConfigurationDiff(doc);
    expect(VersionConfigurationRequestSchema.safeParse(diff).success).toBe(true);
    expect(diff.subtests).toHaveLength(1);
    expect(diff.subtests[0]?.id).toBe(20);
    expect(diff.subtests[0]?.items).toHaveLength(1);
    expect(diff.subtests[0]?.items?.[0]?.options).toHaveLength(1);
    expect(diff.subtests[0]?.items?.[0]?.options?.[0]?.id).toBe(41);
    expect(diff.subtests[0]?.items?.[0]?.answerKey).toBeUndefined();
  });

  it("resuelve correctOptionDraftId para opción recién creada y correctOptionId para opción existente", () => {
    const reducer = createDocumentReducer(makeDeterministicDraftIdFactory(200));
    let doc = createCleanDocument();

    // Caso 1: clave apuntando a opción existente (id=41) sin modificar opt-41
    doc = reducer(doc, {
      type: "SET_CORRECT_OPTION",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      optionDraftId: "opt-41",
    });
    const diffExistingOpt = buildConfigurationDiff(doc);
    expect(VersionConfigurationRequestSchema.safeParse(diffExistingOpt).success).toBe(true);
    const keyExisting = diffExistingOpt.subtests[0]?.items?.[0]?.answerKey;
    expect(keyExisting?.correctOptionId).toBe(41);
    expect(keyExisting?.correctOptionDraftId).toBeNull();

    // Caso 2: ítem nuevo con opción nueva como correcta -> correctOptionDraftId
    doc = reducer(doc, {
      type: "ADD_ITEM",
      subtestDraftId: "sub-20",
      templateId: "bfa_comparacion_imagenes",
      input: { draftId: "item-new" },
    });
    const newOptDraftId = doc.subtests[0]!.items[1]!.options[2]!.draftId;
    doc = reducer(doc, {
      type: "SET_CORRECT_OPTION",
      subtestDraftId: "sub-20",
      itemDraftId: "item-new",
      optionDraftId: newOptDraftId,
    });

    const diffNewOpt = buildConfigurationDiff(doc);
    expect(VersionConfigurationRequestSchema.safeParse(diffNewOpt).success).toBe(true);
    const newItemPayload = diffNewOpt.subtests[0]?.items?.find((i) => i.draftId === "item-new");
    expect(newItemPayload?.answerKey?.correctOptionDraftId).toBe(newOptDraftId);
    expect(newItemPayload?.answerKey?.correctOptionId).toBeNull();
  });

  it("omite imágenes pendientes de subir y las reporta vía collectPendingImageUploads", () => {
    const reducer = createDocumentReducer(makeDeterministicDraftIdFactory(300));
    let doc = createCleanDocument();

    doc = reducer(doc, {
      type: "ATTACH_ITEM_IMAGE",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      image: {
        draftId: "img-pending-item",
        pendingFileId: "file-item-1",
        altText: "Pendiente ítem",
        fileName: "pend1.png",
      },
    });
    doc = reducer(doc, {
      type: "ATTACH_OPTION_IMAGE",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      optionDraftId: "opt-40",
      image: {
        draftId: "img-pending-opt",
        pendingFileId: "file-opt-1",
        altText: "Pendiente opción",
        fileName: "pend2.png",
      },
    });

    const pending = collectPendingImageUploads(doc);
    expect(pending).toHaveLength(2);
    expect(pending[0]).toMatchObject({
      ownerKind: "item",
      imageDraftId: "img-pending-item",
      pendingFileId: "file-item-1",
    });
    expect(pending[1]).toMatchObject({
      ownerKind: "option",
      optionDraftId: "opt-40",
      imageDraftId: "img-pending-opt",
      pendingFileId: "file-opt-1",
    });

    // Como nada más cambió excepto las imágenes pendientes, el diff es válido y no incluye imágenes sin resourceId
    const diff = buildConfigurationDiff(doc);
    expect(VersionConfigurationRequestSchema.safeParse(diff).success).toBe(true);
    expect(diff.subtests).toEqual([]);
  });

  it("soporta guardado en 2 pases para subtests nuevos sin regla de calificación", () => {
    const reducer = createDocumentReducer(makeDeterministicDraftIdFactory(400));
    let doc = createCleanDocument();

    doc = reducer(doc, {
      type: "ADD_SUBTEST",
      input: { draftId: "sub-new", code: "ESP", name: "Espacial" },
    });
    doc = reducer(doc, {
      type: "ADD_ITEM",
      subtestDraftId: "sub-new",
      templateId: "bfa_espacial",
      input: { draftId: "item-esp" },
    });
    const correctOpt = doc.subtests[1]!.items[0]!.options[0]!.draftId;
    doc = reducer(doc, {
      type: "SET_CORRECT_OPTION",
      subtestDraftId: "sub-new",
      itemDraftId: "item-esp",
      optionDraftId: correctOpt,
    });

    expect(collectSubtestsNeedingScoringRule(doc).map((s) => s.draftId)).toEqual(["sub-new"]);

    // Pase 1: omite answerKeys sin ruleId para crear subtests, ítems y opciones primero
    const pass1 = buildConfigurationDiff(doc, { omitAnswerKeysWithoutRuleId: true });
    expect(VersionConfigurationRequestSchema.safeParse(pass1).success).toBe(true);
    expect(pass1.subtests[0]?.items?.[0]?.answerKey).toBeUndefined();

    // Se inyecta el ruleId recién creado para sub-new
    doc = reducer(doc, {
      type: "APPLY_SUBTEST_RULE_IDS",
      ruleIdBySubtestDraftId: { "sub-new": 999 },
    });
    expect(collectSubtestsNeedingScoringRule(doc)).toEqual([]);

    // Pase 2: ahora la clave lleva ruleId: 999
    const pass2 = buildConfigurationDiff(doc);
    expect(VersionConfigurationRequestSchema.safeParse(pass2).success).toBe(true);
    expect(pass2.subtests[0]?.items?.[0]?.answerKey?.ruleId).toBe(999);
  });

  it("no emite nodos DELETED sin id pero sí emite nodos DELETED con id != null", () => {
    const reducer = createDocumentReducer(makeDeterministicDraftIdFactory(500));
    let doc = createCleanDocument();

    doc = reducer(doc, { type: "DELETE_OPTION", subtestDraftId: "sub-20", itemDraftId: "item-30", optionDraftId: "opt-41" });
    doc = reducer(doc, {
      type: "ADD_SUBTEST",
      input: { draftId: "sub-temp", code: "TMP", name: "Temp" },
    });
    doc = reducer(doc, { type: "DELETE_SUBTEST", subtestDraftId: "sub-temp" });

    const diff = buildConfigurationDiff(doc);
    expect(VersionConfigurationRequestSchema.safeParse(diff).success).toBe(true);
    expect(diff.subtests).toHaveLength(1);
    expect(diff.subtests[0]?.items?.[0]?.options).toEqual([
      expect.objectContaining({ id: 41, status: "DELETED" }),
    ]);
  });
});

describe("buildCloneConfiguration", () => {
  it("clona toda la versión activa a CREATED sin id, conservando resourceId y remapeando correctOptionDraftId", () => {
    const doc = createCleanDocument();
    // Agregamos un ítem DELETED que NO debe incluirse en el clon
    doc.subtests[0]!.items.push({
      ...doc.subtests[0]!.items[0]!,
      id: 999,
      draftId: "item-deleted",
      status: "DELETED",
      code: "DEL",
      order: 2,
    });

    const cloneFactory = makeDeterministicDraftIdFactory(1);
    const cloned = buildCloneConfiguration(doc, { draftIdFactory: cloneFactory });

    expect(VersionConfigurationRequestSchema.safeParse(cloned).success).toBe(true);
    expect(cloned.subtests).toHaveLength(1);

    const sub = cloned.subtests[0]!;
    expect(sub.id).toBeNull();
    expect(sub.sourceId).toBe(20);
    expect(sub.status).toBe("CREATED");
    expect(sub.items).toHaveLength(1);

    const item = sub.items![0]!;
    expect(item.id).toBeNull();
    expect(item.sourceId).toBe(30);
    expect(item.status).toBe("CREATED");
    expect(item.images?.[0]?.id).toBeNull();
    expect(item.images?.[0]?.sourceId).toBe(55);
    expect(item.images?.[0]?.resourceId).toBe(77);

    expect(item.options).toHaveLength(2);
    expect(item.options?.[0]?.id).toBeNull();
    expect(item.options?.[0]?.sourceId).toBe(40);
    expect(item.options?.[0]?.status).toBe("CREATED");

    expect(item.answerKey?.id).toBeNull();
    expect(item.answerKey?.sourceId).toBe(50);
    expect(item.answerKey?.status).toBe("CREATED");
    expect(item.answerKey?.correctOptionId).toBeNull();
    expect(item.answerKey?.correctOptionDraftId).toBe(item.options?.[0]?.draftId);
  });

  it("soporta ruleIdBySubtestDraftId y omitAnswerKeysWithoutRuleId al clonar en 2 pasos", () => {
    const doc = createCleanDocument();

    const pass1 = buildCloneConfiguration(doc, {
      ruleIdBySubtestDraftId: {},
      omitAnswerKeysWithoutRuleId: true,
      draftIdFactory: makeDeterministicDraftIdFactory(10),
    });
    expect(VersionConfigurationRequestSchema.safeParse(pass1).success).toBe(true);
    expect(pass1.subtests[0]?.items?.[0]?.answerKey).toBeUndefined();

    const pass2 = buildCloneConfiguration(doc, {
      ruleIdBySubtestDraftId: { "sub-20": 777 },
      draftIdFactory: makeDeterministicDraftIdFactory(50),
    });
    expect(VersionConfigurationRequestSchema.safeParse(pass2).success).toBe(true);
    expect(pass2.subtests[0]?.items?.[0]?.answerKey?.ruleId).toBe(777);
  });
});
