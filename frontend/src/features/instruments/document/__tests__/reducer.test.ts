import { describe, expect, it } from "vitest";
import type { SubtestCloneTemplate } from "../../../../api/schemas/instruments";
import { createItemFromTemplate, ITEM_TEMPLATE_LIST, ITEM_TEMPLATES } from "../templates";
import {
  createDocumentReducer,
  detectOrderCollisions,
  documentReducer,
  isDocumentDirty,
} from "../reducer";
import { createCleanDocument, makeDeterministicDraftIdFactory } from "./fixtures";

describe("templates psicométricos", () => {
  it("expone las 8 plantillas requeridas con configuración coherente", () => {
    expect(ITEM_TEMPLATE_LIST).toHaveLength(8);
    expect(ITEM_TEMPLATES.bfa_comparacion_imagenes.itemType).toBe("COMPARACION_IMAGENES");
    expect(ITEM_TEMPLATES.bfa_comparacion_imagenes.stimulusRole).toBe("ESTIMULO");
    expect(ITEM_TEMPLATES.bfa_desplazamiento.itemType).toBe("TEXTO_E_IMAGEN");
    expect(ITEM_TEMPLATES.bfa_espacial.itemType).toBe("SOLO_IMAGEN");
    expect(ITEM_TEMPLATES.razonamiento_verbal.itemType).toBe("RAZONAMIENTO_VERBAL");
    expect(ITEM_TEMPLATES.opcion_multiple.responseType).toBe("OPCION_MULTIPLE");
    expect(ITEM_TEMPLATES.verdadero_falso.responseType).toBe("VERDADERO_FALSO");
    expect(ITEM_TEMPLATES.numerica.responseType).toBe("NUMERICA");
    expect(ITEM_TEMPLATES.texto_abierto.responseType).toBe("TEXTO_ABIERTO");
  });

  it("createItemFromTemplate construye opciones y claves según la plantilla", () => {
    const factory = makeDeterministicDraftIdFactory(1);
    const cmp = createItemFromTemplate("bfa_comparacion_imagenes", {
      code: "IT-CMP",
      order: 1,
      draftIdFactory: factory,
    });
    expect(cmp.status).toBe("CREATED");
    expect(cmp.options.map((o) => o.code)).toEqual(["A", "B", "C", "D"]);
    expect(cmp.answerKey).toBeNull();

    const vf = createItemFromTemplate("verdadero_falso", {
      code: "IT-VF",
      order: 2,
      draftIdFactory: factory,
    });
    expect(vf.options.map((o) => [o.code, o.text])).toEqual([
      ["V", "Verdadero"],
      ["F", "Falso"],
    ]);

    const num = createItemFromTemplate("numerica", {
      code: "IT-NUM",
      order: 3,
      draftIdFactory: factory,
      defaultRuleId: 80,
    });
    expect(num.options).toEqual([]);
    expect(num.answerKey?.ruleId).toBe(80);
    expect(num.answerKey?.numericTolerance).toBe(0);
    expect(num.answerKey?.requiresManualReview).toBe(false);

    const open = createItemFromTemplate("texto_abierto", {
      code: "IT-TXT",
      order: 4,
      draftIdFactory: factory,
    });
    expect(open.options).toEqual([]);
    expect(open.answerKey?.requiresManualReview).toBe(true);
  });
});

describe("documentReducer", () => {
  it("bloquea ediciones si la versión no está en BORRADOR, pero permite LOAD/MARK_SAVED/APPLY_SUBTEST_RULE_IDS", () => {
    const reducer = createDocumentReducer(makeDeterministicDraftIdFactory(1));
    for (const status of ["EN_REVISION", "APROBADO", "PUBLICADO", "RETIRADO"] as const) {
      const base = createCleanDocument();
      base.version.status = status;

      const afterAdd = reducer(base, { type: "ADD_SUBTEST" });
      expect(afterAdd).toBe(base);

      const afterMeta = reducer(base, {
        type: "UPDATE_VERSION_META",
        patch: { instructions: "Cambio bloqueado" },
      });
      expect(afterMeta).toBe(base);
    }

    const approvedDoc = createCleanDocument();
    approvedDoc.version.status = "APROBADO";
    const reloaded = reducer(approvedDoc, {
      type: "LOAD_DOCUMENT",
      document: createCleanDocument(),
    });
    expect(reloaded.version.status).toBe("BORRADOR");
  });

  it("mantiene inmutabilidad y transiciones de estado EXISTING -> UPDATED / CREATED -> CREATED", () => {
    const reducer = createDocumentReducer(makeDeterministicDraftIdFactory(100));
    const doc0 = createCleanDocument();
    const snapshot = structuredClone(doc0);

    const doc1 = reducer(doc0, {
      type: "UPDATE_SUBTEST",
      subtestDraftId: "sub-20",
      patch: { name: "Memoria Editada" },
    });

    expect(doc0).toEqual(snapshot);
    expect(doc1.subtests[0]?.status).toBe("UPDATED");
    expect(isDocumentDirty(doc1)).toBe(true);
    expect(doc1.dirtyNodeIds).toContain("subtest:sub-20");

    const doc2 = reducer(doc1, {
      type: "ADD_SUBTEST",
      input: { code: "ESP", name: "Espacial" },
    });
    const added = doc2.subtests[1];
    expect(added?.status).toBe("CREATED");
    expect(added?.id).toBeNull();
    expect(added?.order).toBe(2);

    const doc3 = reducer(doc2, {
      type: "UPDATE_SUBTEST",
      subtestDraftId: added!.draftId,
      patch: { name: "Espacial Editado" },
    });
    expect(doc3.subtests[1]?.status).toBe("CREATED");
  });

  it("sincroniza randomizeItems en subtests activos cuando version.randomizeItems cambia a false", () => {
    const reducer = createDocumentReducer(makeDeterministicDraftIdFactory(1));
    const doc0 = createCleanDocument();
    expect(doc0.subtests[0]?.randomizeItems).toBe(true);

    const doc1 = reducer(doc0, {
      type: "UPDATE_VERSION_META",
      patch: { randomizeItems: false },
    });

    expect(doc1.version.metaDirty).toBe(true);
    expect(doc1.version.randomizeItems).toBe(false);
    expect(doc1.subtests[0]?.randomizeItems).toBe(false);
    expect(doc1.subtests[0]?.status).toBe("UPDATED");
  });

  it("borra físicamente nodos CREATED y marca DELETED nodos EXISTING/UPDATED", () => {
    const reducer = createDocumentReducer(makeDeterministicDraftIdFactory(200));
    let doc = createCleanDocument();

    doc = reducer(doc, {
      type: "ADD_SUBTEST",
      input: { draftId: "sub-temp", code: "TEMP", name: "Temporal" },
    });
    expect(doc.subtests).toHaveLength(2);

    doc = reducer(doc, { type: "DELETE_SUBTEST", subtestDraftId: "sub-temp" });
    expect(doc.subtests).toHaveLength(1);

    doc = reducer(doc, { type: "DELETE_SUBTEST", subtestDraftId: "sub-20" });
    expect(doc.subtests).toHaveLength(1);
    expect(doc.subtests[0]?.status).toBe("DELETED");
    expect(doc.subtests[0]?.id).toBe(20);
  });

  it("reordena subtests, ítems y opciones renumerando 1..n y marcando UPDATED solo los que cambian", () => {
    const reducer = createDocumentReducer(makeDeterministicDraftIdFactory(300));
    let doc = createCleanDocument();

    // Agregamos 2 subtests más: orden 2 (s2) y 3 (s3)
    doc = reducer(doc, {
      type: "ADD_SUBTEST",
      input: { draftId: "sub-2", code: "S2", name: "Sub 2" },
    });
    doc = reducer(doc, {
      type: "ADD_SUBTEST",
      input: { draftId: "sub-3", code: "S3", name: "Sub 3" },
    });

    // Movemos sub-3 (index 2) a index 0 -> [sub-3 (order 1), sub-20 (order 2), sub-2 (order 3)]
    doc = reducer(doc, { type: "MOVE_SUBTEST", subtestDraftId: "sub-3", toIndex: 0 });
    expect(doc.subtests.map((s) => [s.draftId, s.order, s.status])).toEqual([
      ["sub-3", 1, "CREATED"],
      ["sub-20", 2, "UPDATED"],
      ["sub-2", 3, "CREATED"],
    ]);

    // Agregamos ítem 2 y movemos por índice
    doc = reducer(doc, {
      type: "ADD_ITEM",
      subtestDraftId: "sub-20",
      input: { draftId: "item-2", code: "IT-2" },
    });
    doc = reducer(doc, {
      type: "MOVE_ITEM",
      subtestDraftId: "sub-20",
      fromIndex: 1,
      toIndex: 0,
    });
    const sub20 = doc.subtests.find((s) => s.draftId === "sub-20")!;
    expect(sub20.items.map((i) => [i.draftId, i.order, i.status])).toEqual([
      ["item-2", 1, "CREATED"],
      ["item-30", 2, "UPDATED"],
    ]);

    // Movemos opción B (opt-41) a índice 0 dentro de item-30
    doc = reducer(doc, {
      type: "MOVE_OPTION",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      optionDraftId: "opt-41",
      toIndex: 0,
    });
    const item30 = doc.subtests
      .find((s) => s.draftId === "sub-20")!
      .items.find((i) => i.draftId === "item-30")!;
    expect(item30.options.map((o) => [o.draftId, o.order, o.status])).toEqual([
      ["opt-41", 1, "UPDATED"],
      ["opt-40", 2, "UPDATED"],
    ]);

    // Movimiento inválido no cambia referencia
    const sameDoc = reducer(doc, { type: "MOVE_SUBTEST", fromIndex: 0, toIndex: 99 });
    expect(sameDoc).toBe(doc);
  });

  it("limpia answerKey automáticamente al borrar la opción correcta o cambiar responseType a no-opción", () => {
    const reducer = createDocumentReducer(makeDeterministicDraftIdFactory(400));
    const doc0 = createCleanDocument();

    // Borrar opt-40 que era la correcta en item-30
    const docAfterDeleteOpt = reducer(doc0, {
      type: "DELETE_OPTION",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      optionDraftId: "opt-40",
    });
    const itemAfterDeleteOpt = docAfterDeleteOpt.subtests[0]!.items[0]!;
    expect(itemAfterDeleteOpt.options[0]?.status).toBe("DELETED");
    expect(itemAfterDeleteOpt.answerKey?.correctOptionDraftId).toBeNull();
    expect(itemAfterDeleteOpt.answerKey?.correctOptionId).toBeNull();
    expect(itemAfterDeleteOpt.answerKey?.status).toBe("UPDATED");

    // Cambiar responseType a NUMERICA desde doc0
    const docAfterNumeric = reducer(doc0, {
      type: "UPDATE_ITEM",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      patch: { responseType: "NUMERICA" },
    });
    const itemNumeric = docAfterNumeric.subtests[0]!.items[0]!;
    expect(itemNumeric.answerKey?.correctOptionDraftId).toBeNull();
    expect(itemNumeric.answerKey?.correctOptionId).toBeNull();
    expect(itemNumeric.answerKey?.status).toBe("UPDATED");
  });

  it("SET_CORRECT_OPTION y CLEAR_ANSWER_KEY manejan claves nuevas y existentes", () => {
    const reducer = createDocumentReducer(makeDeterministicDraftIdFactory(500));
    let doc = createCleanDocument();

    // Limpiar clave existente (id=50) -> status DELETED
    doc = reducer(doc, {
      type: "CLEAR_ANSWER_KEY",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
    });
    expect(doc.subtests[0]!.items[0]!.answerKey?.status).toBe("DELETED");
    expect(doc.subtests[0]!.items[0]!.answerKey?.id).toBe(50);

    // Reactivarla fijando opt-41 como correcta -> status UPDATED conservando id=50
    doc = reducer(doc, {
      type: "SET_CORRECT_OPTION",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      optionDraftId: "opt-41",
    });
    const key = doc.subtests[0]!.items[0]!.answerKey!;
    expect(key.id).toBe(50);
    expect(key.status).toBe("UPDATED");
    expect(key.correctOptionDraftId).toBe("opt-41");
    expect(key.correctOptionId).toBe(41);
    expect(key.requiresManualReview).toBe(false);

    // Ítem nuevo desde plantilla -> CLEAR_ANSWER_KEY lo vuelve null
    doc = reducer(doc, {
      type: "ADD_ITEM",
      subtestDraftId: "sub-20",
      templateId: "bfa_comparacion_imagenes",
      input: { draftId: "item-cmp" },
    });
    const cmpOptId = doc.subtests[0]!.items[1]!.options[2]!.draftId;
    doc = reducer(doc, {
      type: "SET_CORRECT_OPTION",
      subtestDraftId: "sub-20",
      itemDraftId: "item-cmp",
      optionDraftId: cmpOptId,
    });
    expect(doc.subtests[0]!.items[1]!.answerKey?.status).toBe("CREATED");
    doc = reducer(doc, {
      type: "CLEAR_ANSWER_KEY",
      subtestDraftId: "sub-20",
      itemDraftId: "item-cmp",
    });
    expect(doc.subtests[0]!.items[1]!.answerKey).toBeNull();
  });

  it("DUPLICATE_ITEM e IMPORT_SUBTEST_CLONE crean nodos CREATED con sourceId y remapeo de claves", () => {
    const reducer = createDocumentReducer(makeDeterministicDraftIdFactory(600));
    let doc = createCleanDocument();

    doc = reducer(doc, {
      type: "DUPLICATE_ITEM",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
    });

    const duplicated = doc.subtests[0]!.items[1]!;
    expect(duplicated.id).toBeNull();
    expect(duplicated.sourceId).toBe(30);
    expect(duplicated.status).toBe("CREATED");
    expect(duplicated.code).toBe("IT-1-COPIA");
    expect(duplicated.order).toBe(2);
    expect(duplicated.images[0]?.resourceId).toBe(77);
    expect(duplicated.images[0]?.id).toBeNull();
    expect(duplicated.answerKey?.id).toBeNull();
    expect(duplicated.answerKey?.correctOptionId).toBeNull();
    expect(duplicated.answerKey?.correctOptionDraftId).toBe(duplicated.options[0]?.draftId);

    const template: SubtestCloneTemplate = {
      sourceSubtestId: 99,
      code: "MEM",
      name: "Memoria Importada",
      description: "Desc",
      instructions: "Inst",
      order: 1,
      timeLimitSeconds: 300,
      randomizeItems: true,
      randomizeOptions: false,
      required: true,
      strategyId: 1,
      status: "ACTIVO",
      items: [
        {
          sourceItemId: 130,
          code: "I-1",
          itemType: "SOLO_IMAGEN",
          responseType: "OPCION_UNICA",
          prompt: "P1",
          instruction: "I1",
          order: 1,
          baseScore: 2,
          timeLimitSeconds: null,
          required: true,
          confidential: true,
          status: "ACTIVO",
          images: [
            {
              sourceImageId: 160,
              resourceId: 700,
              order: 1,
              altText: "Estímulo",
              storagePath: "a.png",
              role: "ESTIMULO",
            },
          ],
          options: [
            {
              sourceOptionId: 140,
              code: "A",
              text: "Opt A",
              order: 1,
              ordinalValue: 1,
              status: "ACTIVO",
              images: [],
            },
            {
              sourceOptionId: 141,
              code: "B",
              text: "Opt B",
              order: 2,
              ordinalValue: 2,
              status: "ACTIVO",
              images: [],
            },
          ],
          answerKey: {
            sourceAnswerKeyId: 150,
            sourceRuleId: 88,
            correctOptionSourceId: 141,
            expectedText: null,
            expectedNumber: null,
            numericTolerance: null,
            score: 2,
            requiresManualReview: false,
          },
        },
      ],
    };

    doc = reducer(doc, { type: "IMPORT_SUBTEST_CLONE", template });
    const imported = doc.subtests[1]!;
    expect(imported.id).toBeNull();
    expect(imported.sourceId).toBe(99);
    expect(imported.status).toBe("CREATED");
    expect(imported.code).toBe("MEM-COPIA");
    expect(imported.defaultRuleId).toBeNull();
    expect(imported.items[0]?.answerKey?.ruleId).toBeNull();
    expect(imported.items[0]?.answerKey?.correctOptionDraftId).toBe(
      imported.items[0]?.options[1]?.draftId,
    );
    expect(imported.items[0]?.images[0]?.resourceId).toBe(700);
  });

  it("gestiona imágenes de ítems/opciones, baremos, rangos, APPLY_SUBTEST_RULE_IDS y MARK_SAVED", () => {
    const reducer = createDocumentReducer(makeDeterministicDraftIdFactory(700));
    let doc = createCleanDocument();

    // Imágenes de ítem y opción
    doc = reducer(doc, {
      type: "ATTACH_ITEM_IMAGE",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      image: { draftId: "img-new", pendingFileId: "file-1", altText: "Nueva", fileName: "n.png" },
    });
    doc = reducer(doc, {
      type: "UPDATE_ITEM_IMAGE",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      imageDraftId: "img-new",
      patch: { resourceId: 888, pendingFileId: null },
    });
    expect(doc.subtests[0]!.items[0]!.images[1]?.previewUrl).toBe("/items/images/resources/888");

    doc = reducer(doc, {
      type: "ATTACH_OPTION_IMAGE",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      optionDraftId: "opt-40",
      image: { draftId: "opt-img-1", resourceId: 901, altText: "Opt img" },
    });
    expect(doc.subtests[0]!.items[0]!.options[0]!.images).toHaveLength(1);
    doc = reducer(doc, {
      type: "DELETE_OPTION_IMAGE",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      optionDraftId: "opt-40",
      imageDraftId: "opt-img-1",
    });
    expect(doc.subtests[0]!.items[0]!.options[0]!.images).toHaveLength(0);

    // Baremos y rangos
    doc = reducer(doc, {
      type: "ADD_BAREMO",
      input: { draftId: "bar-new", code: "BAR-2", name: "Baremo 2" },
    });
    doc = reducer(doc, {
      type: "ADD_BAREMO_RANGE",
      baremoDraftId: "bar-new",
      input: { draftId: "rng-new", minScore: 0, maxScore: 5, category: "Bajo" },
    });
    doc = reducer(doc, {
      type: "UPDATE_BAREMO_RANGE",
      baremoDraftId: "bar-new",
      rangeDraftId: "rng-new",
      patch: { maxScore: 8 },
    });
    expect(doc.baremos[1]?.ranges[0]?.maxScore).toBe(8);
    expect(doc.dirtyNodeIds).toContain("baremo:bar-new");

    doc = reducer(doc, {
      type: "DELETE_BAREMO_RANGE",
      baremoDraftId: "bar-90",
      rangeDraftId: "rng-100",
    });
    expect(doc.baremos[0]?.ranges[0]?.status).toBe("DELETED");

    // APPLY_SUBTEST_RULE_IDS sobre subtest sin regla
    doc = reducer(doc, {
      type: "ADD_SUBTEST",
      input: { draftId: "sub-norule", code: "NR", name: "Sin regla" },
    });
    doc = reducer(doc, {
      type: "ADD_ITEM",
      subtestDraftId: "sub-norule",
      templateId: "numerica",
      input: { draftId: "it-nr" },
    });
    doc = reducer(doc, {
      type: "APPLY_SUBTEST_RULE_IDS",
      ruleIdBySubtestDraftId: { "sub-norule": 555 },
    });
    expect(doc.subtests[1]?.defaultRuleId).toBe(555);
    expect(doc.subtests[1]?.items[0]?.answerKey?.ruleId).toBe(555);

    const saved = documentReducer(doc, { type: "MARK_SAVED" });
    expect(isDocumentDirty(saved)).toBe(false);
    expect(saved.dirtyNodeIds).toEqual([]);
  });

  it("MEDIO 5: detectOrderCollisions detecta permutaciones bajo B18 y REVERT_REORDERING revierte solo el orden conservando demás cambios", () => {
    const reducer = createDocumentReducer(makeDeterministicDraftIdFactory(800));
    const baseline = createCleanDocument();
    baseline.subtests.push({
      ...baseline.subtests[0]!,
      id: 21,
      draftId: "sub-21",
      code: "ESP",
      name: "Espacial",
      order: 2,
      items: [],
    });

    // Intercambiar sub-20 y sub-21 + editar nombre de sub-20 + intercambiar opciones de item-30
    let doc = reducer(baseline, {
      type: "MOVE_SUBTEST",
      subtestDraftId: "sub-21",
      toIndex: 0,
    });
    doc = reducer(doc, {
      type: "UPDATE_SUBTEST",
      subtestDraftId: "sub-20",
      patch: { name: "Memoria Editada" },
    });
    doc = reducer(doc, {
      type: "MOVE_OPTION",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      optionDraftId: "opt-41",
      toIndex: 0,
    });

    const collisions = detectOrderCollisions(doc, baseline);
    expect(collisions.map((c) => c.level)).toEqual(["subtest", "option"]);

    const reverted = reducer(doc, { type: "REVERT_REORDERING", baseline });
    expect(detectOrderCollisions(reverted, baseline)).toEqual([]);
    expect(reverted.subtests.map((s) => [s.id, s.order, s.status])).toEqual([
      [20, 1, "UPDATED"],
      [21, 2, "EXISTING"],
    ]);
    expect(reverted.subtests[0]?.name).toBe("Memoria Editada");
    expect(reverted.subtests[0]?.items[0]?.options.map((o) => [o.id, o.order, o.status])).toEqual([
      [40, 1, "EXISTING"],
      [41, 2, "EXISTING"],
    ]);
  });
});
