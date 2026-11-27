import { describe, expect, it } from "vitest";
import { UNSUPPORTED_SCORING_KEY_MESSAGE, validateVersionDocument } from "../schema";
import { nodeKeyOf, type DocumentAnswerKey } from "../types";
import { createCleanDocument } from "./fixtures";

describe("validateVersionDocument", () => {
  it("aprueba documento válido y calcula canApprove / canPublish según estado y opciones", () => {
    const doc = createCleanDocument();

    const rDraft = validateVersionDocument(doc);
    expect(rDraft.valid).toBe(true);
    expect(rDraft.errors).toEqual([]);
    expect(rDraft.warnings).toEqual([]);
    expect(rDraft.canApprove).toBe(true);
    expect(rDraft.canPublish).toBe(false);
    expect(rDraft.checklist.every((c) => c.passed)).toBe(true);

    const rUnsaved = validateVersionDocument(doc, { hasUnsavedChanges: true });
    expect(rUnsaved.canApprove).toBe(false);

    expect(validateVersionDocument(doc, { hasActiveScoringRules: false }).canApprove).toBe(false);

    doc.version.status = "APROBADO";
    const rApproved = validateVersionDocument(doc);
    expect(rApproved.canApprove).toBe(false);
    expect(rApproved.canPublish).toBe(true);

    const rNoRules = validateVersionDocument(doc, { hasActiveScoringRules: false });
    expect(rNoRules.canPublish).toBe(false);

    doc.version.status = "PUBLICADO";
    const rPublished = validateVersionDocument(doc);
    expect(rPublished.canApprove).toBe(false);
    expect(rPublished.canPublish).toBe(false);
  });

  it("reporta errores bloqueantes de versión, subtests, códigos/órdenes duplicados y tiempos", () => {
    const doc = createCleanDocument();
    doc.version.number = "   ";
    doc.version.strategyId = null;
    doc.version.timeLimitSeconds = 0;

    doc.subtests.push({
      ...doc.subtests[0]!,
      id: null,
      draftId: "sub-dup",
      status: "CREATED",
      code: " mem ",
      name: "  ",
      order: 1,
      timeLimitSeconds: -5,
      items: [],
    });

    // Un nodo DELETED con mismo código/orden NO debe contar como duplicado
    doc.subtests.push({
      ...doc.subtests[0]!,
      id: 999,
      draftId: "sub-del",
      status: "DELETED",
      code: "MEM",
      order: 1,
      items: [],
    });

    const report = validateVersionDocument(doc);
    expect(report.valid).toBe(false);
    const codes = new Set(report.errors.map((e) => e.code));

    expect(codes.has("VERSION_NUMBER_REQUIRED")).toBe(true);
    expect(codes.has("VERSION_STRATEGY_REQUIRED")).toBe(true);
    expect(codes.has("INVALID_VERSION_TIME_LIMIT")).toBe(true);
    expect(codes.has("DUPLICATE_CODE")).toBe(true);
    expect(codes.has("DUPLICATE_ORDER")).toBe(true);
    expect(codes.has("SUBTEST_NAME_REQUIRED")).toBe(true);
    expect(codes.has("INVALID_SUBTEST_TIME_LIMIT")).toBe(true);
    expect(codes.has("SUBTEST_WITHOUT_ITEMS")).toBe(true);
    expect(report.byNodeKey[nodeKeyOf({ kind: "version" })]?.length).toBeGreaterThan(0);
    expect(
      report.byNodeKey[nodeKeyOf({ kind: "subtest", subtestDraftId: "sub-dup" })]?.length,
    ).toBeGreaterThan(0);
  });

  it("reporta error cuando no hay subtests activos", () => {
    const doc = createCleanDocument();
    doc.subtests[0]!.status = "DELETED";
    const report = validateVersionDocument(doc);
    expect(report.valid).toBe(false);
    expect(report.errors.some((e) => e.code === "NO_ACTIVE_SUBTESTS")).toBe(true);
  });

  it("valida ítems de opciones, claves OPCION_UNICA/VF/NUMERICA, puntajes y códigos/órdenes de ítems y opciones", () => {
    const doc = createCleanDocument();
    const sub = doc.subtests[0]!;
    const item1 = sub.items[0]!;

    // Puntaje y tiempo inválidos + opción borrada que deja clave colgante
    item1.baseScore = -1;
    item1.timeLimitSeconds = 0;
    item1.options[0]!.status = "DELETED"; // Solo queda 1 opción activa y además era la correcta!
    item1.answerKey!.score = -2;

    // Segundo ítem NUMERICA sin expectedNumber y con tolerancia negativa
    sub.items.push({
      id: null,
      draftId: "item-num",
      sourceId: null,
      status: "CREATED",
      code: " it-1 ",
      itemType: "SOLO_TEXTO",
      responseType: "NUMERICA",
      prompt: "2+2?",
      instruction: "",
      order: 1,
      baseScore: 1,
      timeLimitSeconds: null,
      required: true,
      confidential: true,
      images: [],
      options: [],
      answerKey: {
        id: null,
        draftId: "key-num",
        sourceId: null,
        status: "CREATED",
        ruleId: 80,
        correctOptionDraftId: null,
        correctOptionId: null,
        expectedText: null,
        expectedNumber: null,
        numericTolerance: -0.5,
        score: 1,
        requiresManualReview: false,
      },
    });

    const report = validateVersionDocument(doc);
    const codes = new Set(report.errors.map((e) => e.code));
    expect(codes.has("NEGATIVE_ITEM_BASE_SCORE")).toBe(true);
    expect(codes.has("INVALID_ITEM_TIME_LIMIT")).toBe(true);
    expect(codes.has("INSUFFICIENT_OPTIONS")).toBe(true);
    expect(codes.has("MISSING_CORRECT_OPTION")).toBe(true);
    expect(codes.has("NEGATIVE_KEY_SCORE")).toBe(true);
    expect(codes.has("DUPLICATE_CODE")).toBe(true);
    expect(codes.has("DUPLICATE_ORDER")).toBe(true);
    expect(codes.has("MISSING_EXPECTED_NUMBER")).toBe(true);
    expect(codes.has("NEGATIVE_NUMERIC_TOLERANCE")).toBe(true);
  });

  it("valida errores de baremos y rangos invertidos, inválidos o solapados", () => {
    const doc = createCleanDocument();
    const baremo = doc.baremos[0]!;
    baremo.code = "";
    baremo.name = "";
    baremo.ranges = [
      {
        id: 1,
        draftId: "r1",
        status: "EXISTING",
        minScore: 15,
        maxScore: 10,
        percentile: 120,
        category: "",
        interpretation: "",
        recommendation: "",
        order: 1,
      },
      {
        id: 2,
        draftId: "r2",
        status: "EXISTING",
        minScore: 0,
        maxScore: 10,
        percentile: 20,
        category: "Bajo",
        interpretation: "",
        recommendation: "",
        order: 2,
      },
      {
        id: 3,
        draftId: "r3",
        status: "EXISTING",
        minScore: 10,
        maxScore: 20,
        percentile: 80,
        category: "Alto",
        interpretation: "",
        recommendation: "",
        order: 3,
      },
    ];

    const report = validateVersionDocument(doc);
    const codes = new Set(report.errors.map((e) => e.code));
    expect(codes.has("BAREMO_CODE_REQUIRED")).toBe(true);
    expect(codes.has("BAREMO_NAME_REQUIRED")).toBe(true);
    expect(codes.has("BAREMO_RANGE_INVERTED")).toBe(true);
    expect(codes.has("BAREMO_RANGE_CATEGORY_REQUIRED")).toBe(true);
    expect(codes.has("BAREMO_RANGE_PERCENTILE_OUT_OF_RANGE")).toBe(true);
    expect(codes.has("BAREMO_RANGES_OVERLAP")).toBe(true);
  });

  it("emite advertencias no bloqueantes sin invalidar el documento", () => {
    const doc = createCleanDocument();
    doc.version.instructions = "";
    doc.subtests[0]!.timeLimitSeconds = null;
    doc.subtests[0]!.instructions = "";
    doc.baremos = [];

    const item1 = doc.subtests[0]!.items[0]!;
    item1.images = []; // ítem TEXTO_E_IMAGEN sin imágenes

    // Imagen en opción sin altText
    item1.options[0]!.images = [
      {
        id: null,
        draftId: "img-opt-noalt",
        sourceId: null,
        resourceId: 123,
        pendingFileId: null,
        previewUrl: "/items/images/resources/123",
        status: "CREATED",
        order: 1,
        altText: "   ",
        role: null,
        fileName: "opt.png",
      },
    ];
    // No cuenta como estímulo si tiene imagen en opción, así que agreguemos un SOLO_IMAGEN vacío
    doc.subtests[0]!.items.push({
      id: null,
      draftId: "item-img-empty",
      sourceId: null,
      status: "CREATED",
      code: "IT-IMG",
      itemType: "SOLO_IMAGEN",
      responseType: "VERDADERO_FALSO",
      prompt: "",
      instruction: "",
      order: 2,
      baseScore: 1,
      timeLimitSeconds: null,
      required: true,
      confidential: true,
      images: [],
      options: [
        {
          id: null,
          draftId: "vf-1",
          sourceId: null,
          status: "CREATED",
          code: "V",
          text: "Verdadero",
          order: 1,
          ordinalValue: 1,
          images: [],
        },
        {
          id: null,
          draftId: "vf-2",
          sourceId: null,
          status: "CREATED",
          code: "F",
          text: "Falso",
          order: 2,
          ordinalValue: 2,
          images: [],
        },
        {
          id: null,
          draftId: "vf-3",
          sourceId: null,
          status: "CREATED",
          code: "X",
          text: "Extra",
          order: 3,
          ordinalValue: 3,
          images: [],
        },
      ],
      answerKey: {
        id: null,
        draftId: "key-vf",
        sourceId: null,
        status: "CREATED",
        ruleId: 80,
        correctOptionDraftId: "vf-1",
        correctOptionId: null,
        expectedText: null,
        expectedNumber: null,
        numericTolerance: null,
        score: 1,
        requiresManualReview: false,
      },
    });

    // Texto abierto sin revisión manual ni expectedText
    doc.subtests[0]!.items.push({
      id: null,
      draftId: "item-open",
      sourceId: null,
      status: "CREATED",
      code: "IT-OPEN",
      itemType: "SOLO_TEXTO",
      responseType: "TEXTO_ABIERTO",
      prompt: "Explique",
      instruction: "",
      order: 3,
      baseScore: 1,
      timeLimitSeconds: null,
      required: true,
      confidential: true,
      images: [],
      options: [],
      answerKey: null,
    });

    const report = validateVersionDocument(doc);
    expect(report.valid).toBe(true);
    expect(report.errors).toEqual([]);

    const warnCodes = new Set(report.warnings.map((w) => w.code));
    expect(warnCodes.has("MISSING_VERSION_INSTRUCTIONS")).toBe(true);
    expect(warnCodes.has("MISSING_SUBTEST_TIME_LIMIT")).toBe(true);
    expect(warnCodes.has("MISSING_SUBTEST_INSTRUCTIONS")).toBe(true);
    expect(warnCodes.has("NO_BAREMOS")).toBe(true);
    expect(warnCodes.has("MISSING_IMAGE_ALT_TEXT")).toBe(true);
    expect(warnCodes.has("MISSING_ITEM_IMAGES")).toBe(true);
    expect(warnCodes.has("VF_OPTION_COUNT")).toBe(true);
    expect(warnCodes.has("OPEN_TEXT_WITHOUT_REVIEW_OR_EXPECTED")).toBe(true);
  });

  it("nodeKeyOf genera claves deterministas para todos los nodos", () => {
    expect(nodeKeyOf({ kind: "version" })).toBe("version");
    expect(nodeKeyOf({ kind: "subtest", subtestDraftId: "s1" })).toBe("subtest:s1");
    expect(nodeKeyOf({ kind: "item", subtestDraftId: "s1", itemDraftId: "i1" })).toBe("item:i1");
    expect(nodeKeyOf({ kind: "baremos" })).toBe("baremos");
    expect(nodeKeyOf({ kind: "baremos", baremoDraftId: "b1" })).toBe("baremo:b1");
    expect(nodeKeyOf({ kind: "publish" })).toBe("publish");
  });

  it("MEDIO 3: bloquea guardado por colisión de código/orden con opción existente o clave vacía (ck_clave_tipo), pero permite guardar borrador incompleto persistible", () => {
    // 1. Cambiar código de opción B a "A" (opción A existente) bloquea guardado
    const dupCodeDoc = createCleanDocument();
    dupCodeDoc.subtests[0]!.items[0]!.options[1]!.code = "A";
    dupCodeDoc.subtests[0]!.items[0]!.options[1]!.status = "UPDATED";
    const dupCodeReport = validateVersionDocument(dupCodeDoc);
    expect(dupCodeReport.canSave).toBe(false);
    expect(dupCodeReport.saveErrors.some((e) => e.code === "DUPLICATE_CODE")).toBe(true);

    // 2. Cambiar orden de opción B a 1 (colisiona con orden 1 de A) bloquea guardado
    const dupOrderDoc = createCleanDocument();
    dupOrderDoc.subtests[0]!.items[0]!.options[1]!.order = 1;
    dupOrderDoc.subtests[0]!.items[0]!.options[1]!.status = "UPDATED";
    const dupOrderReport = validateVersionDocument(dupOrderDoc);
    expect(dupOrderReport.canSave).toBe(false);
    expect(dupOrderReport.saveErrors.some((e) => e.code === "DUPLICATE_ORDER")).toBe(true);

    // 3. Clave de respuesta existente que queda sin opción correcta, sin valor esperado y sin revisión manual (viola ck_clave_tipo)
    const brokenKeyDoc = createCleanDocument();
    brokenKeyDoc.subtests[0]!.items[0]!.options[0]!.status = "DELETED";
    brokenKeyDoc.subtests[0]!.items[0]!.answerKey!.correctOptionDraftId = null;
    brokenKeyDoc.subtests[0]!.items[0]!.answerKey!.correctOptionId = null;
    brokenKeyDoc.subtests[0]!.items[0]!.answerKey!.status = "UPDATED";
    const brokenKeyReport = validateVersionDocument(brokenKeyDoc);
    expect(brokenKeyReport.canSave).toBe(false);
    expect(
      brokenKeyReport.saveErrors.some(
        (e) => e.code === "MISSING_CORRECT_OPTION" && e.nodeKey === "item:item-30",
      ),
    ).toBe(true);

    // 4. Borrador incompleto pero persistible (sin strategyId, subtest vacío o ítem sin clave ni suficientes opciones) SÍ permite guardar
    const incompleteDoc = createCleanDocument();
    incompleteDoc.version.strategyId = null;
    incompleteDoc.subtests[0]!.items[0]!.answerKey = null;
    incompleteDoc.subtests[0]!.items[0]!.options = [incompleteDoc.subtests[0]!.items[0]!.options[0]!];
    const incompleteReport = validateVersionDocument(incompleteDoc);
    expect(incompleteReport.valid).toBe(false);
    expect(incompleteReport.canApprove).toBe(false);
    expect(incompleteReport.canSave).toBe(true);
    expect(incompleteReport.saveErrors).toEqual([]);
  });

  describe("claves que la calificación oficial no admite (UNSUPPORTED_SCORING_KEY)", () => {
    const keyBase: DocumentAnswerKey = {
      id: null,
      draftId: "key-x",
      sourceId: null,
      status: "CREATED",
      ruleId: 80,
      correctOptionDraftId: null,
      correctOptionId: null,
      expectedText: null,
      expectedNumber: null,
      numericTolerance: null,
      score: 1,
      requiresManualReview: false,
    };

    function withKey(
      responseType: "OPCION_MULTIPLE" | "NUMERICA" | "TEXTO_ABIERTO",
      key: Partial<DocumentAnswerKey>,
    ) {
      const doc = createCleanDocument();
      const item = doc.subtests[0]!.items[0]!;
      item.responseType = responseType;
      item.answerKey = { ...keyBase, ...key };
      return doc;
    }

    it("bloquea aprobar y publicar pero no guardar para OPCION_MULTIPLE con expectedText 'A,B'", () => {
      const doc = withKey("OPCION_MULTIPLE", { expectedText: "A,B" });
      const report = validateVersionDocument(doc);
      const problem = report.errors.find((e) => e.code === "UNSUPPORTED_SCORING_KEY");
      expect(problem?.message).toBe(UNSUPPORTED_SCORING_KEY_MESSAGE);
      expect(problem?.blocksSave).toBeFalsy();
      expect(report.canSave).toBe(true);
      expect(report.canApprove).toBe(false);
      expect(report.checklist.find((c) => c.id === "options-keys")?.passed).toBe(false);

      doc.version.status = "APROBADO";
      expect(validateVersionDocument(doc).canPublish).toBe(false);
    });

    it("bloquea única con A correcta que pasa a múltiple con códigos 'A,B' (correctOption heredado)", () => {
      const doc = withKey("OPCION_MULTIPLE", { correctOptionDraftId: "opt-40", expectedText: "A,B" });
      const report = validateVersionDocument(doc);
      expect(report.errors.map((e) => e.code)).toContain("UNSUPPORTED_SCORING_KEY");
      expect(report.canSave).toBe(true);
      expect(report.canApprove).toBe(false);
      doc.version.status = "APROBADO";
      expect(validateVersionDocument(doc).canPublish).toBe(false);
    });

    it("bloquea NUMERICA/TEXTO_ABIERTO con valor o texto esperado aunque haya correctOption heredado", () => {
      const num = validateVersionDocument(
        withKey("NUMERICA", { correctOptionDraftId: "opt-40", expectedNumber: 42 }),
      );
      expect(num.errors.map((e) => e.code)).toContain("UNSUPPORTED_SCORING_KEY");
      const txt = validateVersionDocument(
        withKey("TEXTO_ABIERTO", { correctOptionDraftId: "opt-40", expectedText: "hola" }),
      );
      expect(txt.errors.map((e) => e.code)).toContain("UNSUPPORTED_SCORING_KEY");
      expect(txt.canSave).toBe(true);
    });

    it("bloquea NUMERICA con valor esperado 42", () => {
      const report = validateVersionDocument(withKey("NUMERICA", { expectedNumber: 42 }));
      expect(report.errors.map((e) => e.code)).toContain("UNSUPPORTED_SCORING_KEY");
      expect(report.canApprove).toBe(false);
      expect(report.canSave).toBe(true);
    });

    it("no bloquea con revisión manual ni con una única opción correcta", () => {
      const manual = validateVersionDocument(
        withKey("OPCION_MULTIPLE", { expectedText: "A,B", requiresManualReview: true }),
      );
      expect(manual.errors.map((e) => e.code)).not.toContain("UNSUPPORTED_SCORING_KEY");
      expect(manual.canApprove).toBe(true);

      const clean = validateVersionDocument(createCleanDocument());
      expect(clean.errors.map((e) => e.code)).not.toContain("UNSUPPORTED_SCORING_KEY");
      expect(clean.canApprove).toBe(true);

      const multipleWithOne = validateVersionDocument(
        withKey("OPCION_MULTIPLE", { correctOptionDraftId: "opt-40" }),
      );
      expect(multipleWithOne.errors.map((e) => e.code)).not.toContain("UNSUPPORTED_SCORING_KEY");
    });
  });
});
