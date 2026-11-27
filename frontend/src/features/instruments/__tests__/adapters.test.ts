import { beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { ApiError } from "../../../api/errors";
import { useStaffAuth } from "../../../store/staffAuth";
import { server } from "../../../test/msw/server";
import {
  cloneVersionFromSource,
  inspectVersionClonePlan,
  loadVersionDocument,
  OrderCollisionError,
  PartialSaveError,
  saveVersionDocument,
  VersionConflictError,
} from "../document/adapters";
import { documentSignature, type VersionDocument } from "../document/types";
import { resolveUncertainImageConflict } from "../document/reconcile";
import { createDocumentReducer } from "../document/reducer";
import { createCleanDocument, makeDeterministicDraftIdFactory } from "../document/__tests__/fixtures";

const API = "http://localhost:8080";

const ok = <T>(data: T) => ({
  success: true,
  data,
  message: "OK",
  error: null,
  correlationId: "cid-test",
});

const fullPermissions = {
  canEdit: true,
  canConfigureScoring: true,
  canConfigureBaremos: true,
};

function makeTestWire(id = 1, code = "BFA-2026", name = "Batería Factorial") {
  return {
    id,
    codigoTest: code,
    nombreTest: name,
    descripcion: "Descripción",
    creadoPorId: "u1",
    estado: "ACTIVO",
    creadoEn: "2026-06-26T10:15:30.000Z",
  };
}

function makeVersionWire(
  id = 10,
  testId = 1,
  estado: "BORRADOR" | "PUBLICADO" = "BORRADOR",
  strategyId: number | null = 1,
) {
  return {
    id,
    testId,
    estrategiaCalificacionId: strategyId,
    numeroVersion: "1.0",
    estado,
    instruccionesGenerales: "Lea con atención",
    tiempoLimiteSegundos: 3600,
    permiteAleatorizarSubtests: false,
    permiteAleatorizarItems: true,
    aprobadoPorId: null,
    aprobadoEn: null,
    publicadoEn: null,
    creadoPorId: "u1",
    creadoEn: "2026-06-26T10:20:00.000Z",
  };
}

function makeSubtestWire(id: number, versionId: number, code: string, name: string, order: number) {
  return {
    id,
    versionTestId: versionId,
    estrategiaCalificacionId: 1,
    codigoSubtest: code,
    nombreSubtest: name,
    descripcion: "Desc",
    instrucciones: "Inst",
    numeroOrden: order,
    tiempoLimiteSegundos: 600 as number | null,
    permiteAleatorizarItems: true,
    permiteAleatorizarOpciones: false,
    esObligatorio: true,
    estado: "ACTIVO",
  };
}

function makeRuleWire(id: number, subtestId: number, active = true, ruleType = "CLAVE_ITEM") {
  return {
    id,
    versionTestId: 10,
    subtestId,
    itemId: null,
    estrategiaCalificacionId: 1,
    tipoRegla: ruleType,
    prioridad: 1,
    activa: active,
    estado: "BORRADOR",
    parametros: "{}",
    observacion: null,
    creadoPorId: "u1",
    creadoEn: "2026-06-26T10:30:00.000Z",
    aprobadoPorId: null,
    aprobadoEn: null,
  };
}

function makeTemplateWire(subtestId: number, code: string, options: { includeKey?: boolean } = {}) {
  return {
    sourceSubtestId: subtestId,
    code,
    name: `Subtest ${code}`,
    description: "Desc",
    instructions: "Inst",
    order: 1,
    timeLimitSeconds: 600,
    randomizeItems: true,
    randomizeOptions: false,
    required: true,
    strategyId: 1,
    estado: "ACTIVO",
    items: [
      {
        sourceItemId: subtestId * 10 + 1,
        code: "IT-1",
        itemType: "TEXTO_E_IMAGEN",
        responseType: "OPCION_UNICA",
        prompt: "Pregunta",
        instruction: "Elija",
        order: 1,
        baseScore: 1,
        timeLimitSeconds: null,
        required: true,
        confidential: true,
        estado: "ACTIVO",
        images: [
          {
            sourceImageId: subtestId * 100 + 1,
            resourceId: 77,
            order: 1,
            altText: "Estímulo",
            storagePath: "items/1.png",
            role: "ENUNCIADO",
          },
        ],
        options: [
          {
            sourceOptionId: subtestId * 100 + 10,
            code: "A",
            text: "Opción A",
            order: 1,
            ordinalValue: 1,
            estado: "ACTIVO",
            images: [],
          },
          {
            sourceOptionId: subtestId * 100 + 11,
            code: "B",
            text: "Opción B",
            order: 2,
            ordinalValue: 2,
            estado: "ACTIVO",
            images: [],
          },
        ],
        answerKey:
          options.includeKey === false
            ? null
            : {
                sourceAnswerKeyId: subtestId * 100 + 50,
                sourceRuleId: 80,
                correctOptionSourceId: subtestId * 100 + 10,
                expectedText: null,
                expectedNumber: null,
                numericTolerance: null,
                score: 1,
                requiresManualReview: false,
              },
      },
    ],
  };
}

function makeBaremoWire(id = 90, versionId = 10) {
  return {
    id,
    versionTestId: versionId,
    dimensionResultadoId: null,
    codigoBaremo: "BAR-GEN",
    nombre: "Baremo General",
    descripcion: "Normas",
    grupoNormativo: "General",
    criterioEdadMinima: null,
    criterioEdadMaxima: null,
    criterioSexoId: null,
    criterioCarreraId: null,
    vigenteDesde: null,
    vigenteHasta: null,
    estado: "BORRADOR",
    creadoPorId: "u1",
    creadoEn: "2026-06-26T10:40:00.000Z",
    aprobadoPorId: null,
    aprobadoEn: null,
  };
}

function makeRangeWire(id = 100, baremoId = 90) {
  return {
    id,
    baremoId,
    puntajeMinimo: 0,
    puntajeMaximo: 10,
    percentil: 25,
    categoria: "Bajo",
    interpretacion: "Por debajo",
    recomendacion: "Reforzar",
    orden: 1,
  };
}

beforeEach(() => {
  useStaffAuth.getState().setSession({
    token: "staff-jwt",
    expiresAt: null,
    user: {
      id: "u1",
      username: "ana",
      roles: ["PSICOLOGO_COORDINADOR"],
      permissions: ["TEST_CREAR", "CALIFICACION_CONFIGURAR", "BAREMO_CONFIGURAR"],
    },
  });
});

describe("loadVersionDocument", () => {
  it("ensambla test, versión, subtests ordenados, clone-templates, scoring rules, baremos y rangos", async () => {
    server.use(
      http.get(`${API}/tests`, () => HttpResponse.json(ok([makeTestWire(1)]))),
      http.get(`${API}/tests/1/versions`, () => HttpResponse.json(ok([makeVersionWire(10, 1)]))),
      http.get(`${API}/test-versions/10/subtests`, () =>
        HttpResponse.json(
          ok([
            makeSubtestWire(21, 10, "LOG", "Lógica", 2),
            makeSubtestWire(20, 10, "MEM", "Memoria", 1),
          ]),
        ),
      ),
      http.get(`${API}/subtests/20/clone-template`, () =>
        HttpResponse.json(ok(makeTemplateWire(20, "MEM"))),
      ),
      http.get(`${API}/subtests/21/clone-template`, () =>
        HttpResponse.json(ok(makeTemplateWire(21, "LOG", { includeKey: false }))),
      ),
      http.get(`${API}/subtests/20/scoring-rules`, () =>
        HttpResponse.json(ok([makeRuleWire(79, 20, false), makeRuleWire(80, 20, true, "CLAVE_ITEM")])),
      ),
      http.get(`${API}/subtests/21/scoring-rules`, () => HttpResponse.json(ok([]))),
      http.get(`${API}/test-versions/10/baremos`, () =>
        HttpResponse.json(ok([makeBaremoWire(90, 10)])),
      ),
      http.get(`${API}/baremos/90/ranges`, () =>
        HttpResponse.json(ok([makeRangeWire(100, 90)])),
      ),
    );

    const loaded = await loadVersionDocument(10, { testId: 1 });

    expect(loaded.test.code).toBe("BFA-2026");
    expect(loaded.version.id).toBe(10);
    expect(loaded.activeScoringRuleCount).toBe(1);
    expect(loaded.hasActiveScoringRules).toBe(true);
    expect(loaded.scoringRulesBySubtestId[20]).toHaveLength(2);
    expect(loaded.scoringRulesBySubtestId[21]).toHaveLength(0);

    const { document } = loaded;
    expect(document.dirtyNodeIds).toEqual([]);
    expect(document.version.metaDirty).toBe(false);
    expect(document.subtests.map((s) => s.code)).toEqual(["MEM", "LOG"]);
    expect(document.subtests[0]?.draftId).toBe("sub-20");
    expect(document.subtests[0]?.defaultRuleId).toBe(80);
    expect(document.subtests[1]?.defaultRuleId).toBeNull();

    const item = document.subtests[0]!.items[0]!;
    expect(item.draftId).toBe("item-201");
    expect(item.images[0]?.draftId).toBe("img-2001");
    expect(item.images[0]?.previewUrl).toBe("/items/images/resources/77");
    expect(item.options[0]?.draftId).toBe("opt-2010");
    expect(item.answerKey?.draftId).toBe("key-2050");
    expect(item.answerKey?.correctOptionDraftId).toBe("opt-2010");

    expect(document.baremos[0]?.draftId).toBe("baremo-90");
    expect(document.baremos[0]?.ranges[0]?.draftId).toBe("range-100");
  });

  it("lanza ApiError 404 VERSION_NOT_FOUND cuando la versión no existe", async () => {
    server.use(
      http.get(`${API}/tests`, () => HttpResponse.json(ok([makeTestWire(1)]))),
      http.get(`${API}/tests/1/versions`, () => HttpResponse.json(ok([makeVersionWire(10, 1)]))),
    );

    const err = await loadVersionDocument(999).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(404);
    expect((err as ApiError).code).toBe("VERSION_NOT_FOUND");
  });
});

describe("saveVersionDocument", () => {
  it("detiene un guardado sobre una versión que ya cambió en el servidor", async () => {
    let instructions = "Original";
    let writes = 0;
    server.use(
      http.get(`${API}/tests`, () => HttpResponse.json(ok([makeTestWire()]))),
      http.get(`${API}/tests/1/versions`, () =>
        HttpResponse.json(ok([{ ...makeVersionWire(), instruccionesGenerales: instructions }]))),
      http.get(`${API}/test-versions/10/subtests`, () => HttpResponse.json(ok([]))),
      http.get(`${API}/test-versions/10/baremos`, () => HttpResponse.json(ok([]))),
      http.patch(`${API}/test-versions/10`, () => {
        writes++;
        return HttpResponse.json(ok(makeVersionWire()));
      }),
    );
    const { document: baseline } = await loadVersionDocument(10, { testId: 1 });
    const document = createDocumentReducer(makeDeterministicDraftIdFactory())(baseline, {
      type: "UPDATE_VERSION_META",
      patch: { instructions: "Edición local" },
    });
    instructions = "Edición de otra sesión";

    await expect(saveVersionDocument({
      document,
      pendingFiles: {},
      permissions: fullPermissions,
      baselineSignature: documentSignature(baseline),
    })).rejects.toMatchObject({ status: 409, code: "VERSION_DOCUMENT_CHANGED" });
    expect(writes).toBe(0);
  });

  it("ejecuta guardado en 2 pasadas para subtest nuevo + clave sin ruleId sin duplicar opciones ni imágenes", async () => {
    const callOrder: string[] = [];
    const configPayloads: unknown[] = [];

    server.use(
      http.patch(`${API}/test-versions/10`, () => {
        callOrder.push("PATCH /test-versions/10");
        return HttpResponse.json(ok(makeVersionWire(10, 1)));
      }),
      http.post(`${API}/test-versions/10/configuration`, async ({ request }) => {
        const body = (await request.json()) as { subtests: Array<{ code?: string }> };
        configPayloads.push(body);
        callOrder.push(`POST /configuration#${configPayloads.length}`);
        return HttpResponse.json(
          ok([
            makeSubtestWire(20, 10, "MEM", "Memoria Visual", 1),
            makeSubtestWire(25, 10, "ESP", "Subtest ESP", 2),
          ]),
        );
      }),
      http.post(`${API}/subtests/25/scoring-rules`, () => {
        callOrder.push("POST /subtests/25/scoring-rules");
        return HttpResponse.json(ok(makeRuleWire(99, 25, true, "CLAVE_ITEM")));
      }),
      http.get(`${API}/subtests/25/clone-template`, () => {
        callOrder.push("GET /subtests/25/clone-template");
        return HttpResponse.json(ok(makeTemplateWire(25, "ESP", { includeKey: false })));
      }),
      http.get(`${API}/tests`, () => HttpResponse.json(ok([makeTestWire(1)]))),
      http.get(`${API}/tests/1/versions`, () => HttpResponse.json(ok([makeVersionWire(10, 1)]))),
      http.get(`${API}/test-versions/10/subtests`, () =>
        HttpResponse.json(
          ok([
            makeSubtestWire(20, 10, "MEM", "Memoria Visual", 1),
            makeSubtestWire(25, 10, "ESP", "Subtest ESP", 2),
          ]),
        ),
      ),
      http.get(`${API}/subtests/20/clone-template`, () =>
        HttpResponse.json(ok(makeTemplateWire(20, "MEM"))),
      ),
      http.get(`${API}/subtests/20/scoring-rules`, () =>
        HttpResponse.json(ok([makeRuleWire(80, 20, true)])),
      ),
      http.get(`${API}/subtests/25/scoring-rules`, () =>
        HttpResponse.json(ok([makeRuleWire(99, 25, true)])),
      ),
      http.get(`${API}/test-versions/10/baremos`, () => HttpResponse.json(ok([]))),
    );

    const reducer = createDocumentReducer(makeDeterministicDraftIdFactory(500));
    let doc = createCleanDocument({ baremos: [] });

    doc = reducer(doc, {
      type: "UPDATE_VERSION_META",
      patch: { instructions: "Instrucciones actualizadas" },
    });
    doc = reducer(doc, {
      type: "ADD_SUBTEST",
      input: { draftId: "sub-esp", code: "ESP", name: "Subtest ESP" },
    });
    doc = reducer(doc, {
      type: "ADD_ITEM",
      subtestDraftId: "sub-esp",
      input: { draftId: "item-esp", code: "IT-1" },
    });
    doc = reducer(doc, {
      type: "ADD_OPTION",
      subtestDraftId: "sub-esp",
      itemDraftId: "item-esp",
      input: { draftId: "opt-esp-a", code: "A", text: "Opción A", order: 1 },
    });
    doc = reducer(doc, {
      type: "ADD_OPTION",
      subtestDraftId: "sub-esp",
      itemDraftId: "item-esp",
      input: { draftId: "opt-esp-b", code: "B", text: "Opción B", order: 2 },
    });
    doc = reducer(doc, {
      type: "SET_CORRECT_OPTION",
      subtestDraftId: "sub-esp",
      itemDraftId: "item-esp",
      optionDraftId: "opt-esp-a",
    });

    const loaded = await saveVersionDocument({
      document: doc,
      pendingFiles: {},
      permissions: fullPermissions,
    });

    expect(callOrder).toEqual([
      "PATCH /test-versions/10",
      "POST /configuration#1",
      "POST /subtests/25/scoring-rules",
      "GET /subtests/25/clone-template",
      "POST /configuration#2",
      "GET /subtests/25/clone-template",
    ]);

    // Pass 1 omite answerKey sin ruleId
    const pass1 = configPayloads[0] as {
      subtests: Array<{ code: string; items: Array<{ answerKey?: unknown }> }>;
    };
    expect(pass1.subtests).toHaveLength(1);
    expect(pass1.subtests[0]?.code).toBe("ESP");
    expect(pass1.subtests[0]?.items[0]?.answerKey).toBeUndefined();

    // Pass 2 envía IDs persistidos y options: [] / images: [] sin duplicar
    const pass2 = configPayloads[1] as {
      subtests: Array<{
        id: number;
        status: string;
        items: Array<{
          id: number;
          status: string;
          images: unknown[];
          options: unknown[];
          answerKey: {
            id: number | null;
            status: string;
            ruleId: number;
            correctOptionDraftId: string | null;
            correctOptionId: number | null;
          };
        }>;
      }>;
    };
    expect(pass2.subtests[0]?.id).toBe(25);
    expect(pass2.subtests[0]?.status).toBe("UPDATED");
    expect(pass2.subtests[0]?.items[0]?.id).toBe(251);
    expect(pass2.subtests[0]?.items[0]?.status).toBe("UPDATED");
    expect(pass2.subtests[0]?.items[0]?.images).toEqual([]);
    expect(pass2.subtests[0]?.items[0]?.options).toEqual([]);
    expect(pass2.subtests[0]?.items[0]?.answerKey).toMatchObject({
      id: null,
      status: "CREATED",
      ruleId: 99,
      correctOptionDraftId: null,
      correctOptionId: 2510,
    });
    expect(loaded.document.subtests).toHaveLength(2);
  });

  it("sube imágenes pendientes (ítem y opción) y guarda baremos y rangos", async () => {
    const uploaded: string[] = [];
    const baremoCalls: string[] = [];

    server.use(
      http.get(`${API}/subtests/20/clone-template`, () =>
        HttpResponse.json(ok(makeTemplateWire(20, "MEM"))),
      ),
      http.post(`${API}/items/201/images`, () => {
        uploaded.push("item:201");
        return HttpResponse.json(
          ok({
            imageLinkId: 1,
            resourceId: 901,
            storagePath: "x",
            filename: "a.png",
            mimeType: "image/png",
            sizeBytes: 10,
            hash: "h1",
            order: 1,
            altText: "Img item",
            role: "ENUNCIADO",
          }),
        );
      }),
      http.post(`${API}/options/2010/images`, () => {
        uploaded.push("option:2010");
        return HttpResponse.json(
          ok({
            imageLinkId: 2,
            resourceId: 902,
            storagePath: "y",
            filename: "b.png",
            mimeType: "image/png",
            sizeBytes: 10,
            hash: "h2",
            order: 1,
            altText: "Img opt",
            role: null,
          }),
        );
      }),
      http.post(`${API}/baremos`, () => {
        baremoCalls.push("POST /baremos");
        return HttpResponse.json(ok(makeBaremoWire(95, 10)));
      }),
      http.patch(`${API}/baremos/90`, () => {
        baremoCalls.push("PATCH /baremos/90");
        return HttpResponse.json(ok(makeBaremoWire(90, 10)));
      }),
      http.post(`${API}/baremos/95/ranges`, () => {
        baremoCalls.push("POST /baremos/95/ranges");
        return HttpResponse.json(ok(makeRangeWire(201, 95)));
      }),
      http.patch(`${API}/baremo-ranges/100`, () => {
        baremoCalls.push("PATCH /baremo-ranges/100");
        return HttpResponse.json(ok(makeRangeWire(100, 90)));
      }),
      http.get(`${API}/tests`, () => HttpResponse.json(ok([makeTestWire(1)]))),
      http.get(`${API}/tests/1/versions`, () => HttpResponse.json(ok([makeVersionWire(10, 1)]))),
      http.get(`${API}/test-versions/10/subtests`, () =>
        HttpResponse.json(ok([makeSubtestWire(20, 10, "MEM", "Memoria", 1)])),
      ),
      http.get(`${API}/subtests/20/scoring-rules`, () =>
        HttpResponse.json(ok([makeRuleWire(80, 20, true)])),
      ),
      http.get(`${API}/test-versions/10/baremos`, () =>
        HttpResponse.json(ok([makeBaremoWire(90, 10), makeBaremoWire(95, 10)])),
      ),
      http.get(`${API}/baremos/90/ranges`, () =>
        HttpResponse.json(ok([makeRangeWire(100, 90)])),
      ),
      http.get(`${API}/baremos/95/ranges`, () =>
        HttpResponse.json(ok([makeRangeWire(201, 95)])),
      ),
    );

    const reducer = createDocumentReducer(makeDeterministicDraftIdFactory(600));
    let doc = createCleanDocument();
    // Alineamos IDs del item/opcion con templateWire(20)
    doc.subtests[0]!.items[0]!.id = 201;
    doc.subtests[0]!.items[0]!.options[0]!.id = 2010;

    doc = reducer(doc, {
      type: "ATTACH_ITEM_IMAGE",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      image: { pendingFileId: "f-item", altText: "Estímulo pendiente" },
    });
    doc = reducer(doc, {
      type: "ATTACH_OPTION_IMAGE",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      optionDraftId: "opt-40",
      image: { pendingFileId: "f-opt", altText: "Opción pendiente" },
    });
    doc = reducer(doc, {
      type: "UPDATE_BAREMO",
      baremoDraftId: "bar-90",
      patch: { name: "Baremo Editado" },
    });
    doc = reducer(doc, {
      type: "UPDATE_BAREMO_RANGE",
      baremoDraftId: "bar-90",
      rangeDraftId: "rng-100",
      patch: { category: "Muy Bajo" },
    });
    doc = reducer(doc, {
      type: "DELETE_BAREMO_RANGE",
      baremoDraftId: "bar-90",
      rangeDraftId: "rng-101",
    });
    doc = reducer(doc, {
      type: "ADD_BAREMO",
      input: { draftId: "bar-new", code: "BAR-2", name: "Baremo 2" },
    });
    doc = reducer(doc, {
      type: "ADD_BAREMO_RANGE",
      baremoDraftId: "bar-new",
      input: { minScore: 0, maxScore: 5, category: "Inicial", order: 1 },
    });

    await saveVersionDocument({
      document: doc,
      pendingFiles: {
        "f-item": new File(["a"], "a.png", { type: "image/png" }),
        "f-opt": new File(["b"], "b.png", { type: "image/png" }),
      },
      permissions: fullPermissions,
    });

    expect(uploaded).toEqual(["item:201", "option:2010"]);
    expect(baremoCalls).toEqual([
      "PATCH /baremos/90",
      "PATCH /baremo-ranges/100",
      "POST /baremos",
      "POST /baremos/95/ranges",
    ]);
  });

  it("falla fail-fast antes de emitir escrituras para MISSING_PENDING_FILE, permisos y estrategia faltante", async () => {
    let writeRequests = 0;
    server.use(
      http.patch(`${API}/*`, () => {
        writeRequests += 1;
        return HttpResponse.json(ok(null));
      }),
      http.post(`${API}/*`, () => {
        writeRequests += 1;
        return HttpResponse.json(ok(null));
      }),
    );

    const reducer = createDocumentReducer(makeDeterministicDraftIdFactory(700));

    // 1. MISSING_PENDING_FILE
    let docMissingFile = createCleanDocument();
    docMissingFile = reducer(docMissingFile, {
      type: "UPDATE_VERSION_META",
      patch: { instructions: "Cambio" },
    });
    docMissingFile = reducer(docMissingFile, {
      type: "ATTACH_ITEM_IMAGE",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      image: { pendingFileId: "file-lost", previewUrl: null },
    });
    await expect(
      saveVersionDocument({
        document: docMissingFile,
        pendingFiles: {},
        permissions: fullPermissions,
      }),
    ).rejects.toMatchObject({ status: 400, code: "MISSING_PENDING_FILE" });

    // 2. FORBIDDEN_EDIT
    const docMeta = reducer(createCleanDocument(), {
      type: "UPDATE_VERSION_META",
      patch: { number: "1.1" },
    });
    await expect(
      saveVersionDocument({
        document: docMeta,
        pendingFiles: {},
        permissions: { ...fullPermissions, canEdit: false },
      }),
    ).rejects.toMatchObject({ status: 403, code: "FORBIDDEN_EDIT" });

    // 3. FORBIDDEN_SCORING & MISSING_STRATEGY
    let docNeedRule = createCleanDocument();
    docNeedRule = reducer(docNeedRule, {
      type: "ADD_SUBTEST",
      input: { draftId: "sub-new", code: "ESP", name: "Espacial", strategyId: null },
    });
    docNeedRule = reducer(docNeedRule, {
      type: "ADD_ITEM",
      subtestDraftId: "sub-new",
      templateId: "bfa_espacial",
      input: { draftId: "item-esp" },
    });
    docNeedRule = reducer(docNeedRule, {
      type: "SET_CORRECT_OPTION",
      subtestDraftId: "sub-new",
      itemDraftId: "item-esp",
      optionDraftId: docNeedRule.subtests[1]!.items[0]!.options[0]!.draftId,
    });

    await expect(
      saveVersionDocument({
        document: docNeedRule,
        pendingFiles: {},
        permissions: { ...fullPermissions, canConfigureScoring: false },
      }),
    ).rejects.toMatchObject({ status: 403, code: "FORBIDDEN_SCORING" });

    docNeedRule.version.strategyId = null;
    await expect(
      saveVersionDocument({
        document: docNeedRule,
        pendingFiles: {},
        permissions: fullPermissions,
      }),
    ).rejects.toMatchObject({ status: 400, code: "MISSING_STRATEGY" });

    // 4. FORBIDDEN_BAREMO
    const docBaremo = reducer(createCleanDocument(), {
      type: "ADD_BAREMO",
      input: { code: "B2", name: "B2" },
    });
    await expect(
      saveVersionDocument({
        document: docBaremo,
        pendingFiles: {},
        permissions: { ...fullPermissions, canConfigureBaremos: false },
      }),
    ).rejects.toMatchObject({ status: 403, code: "FORBIDDEN_BAREMO" });

    // 5. VERSION_NOT_DRAFT
    const publishedDoc = createCleanDocument();
    publishedDoc.version.status = "PUBLICADO";
    await expect(
      saveVersionDocument({
        document: publishedDoc,
        pendingFiles: {},
        permissions: fullPermissions,
      }),
    ).rejects.toMatchObject({ status: 400, code: "VERSION_NOT_DRAFT" });

    expect(writeRequests).toBe(0);
  });

  it("ALTO 1: guardado parcial (PATCH OK + /configuration 503) reconcilia línea base y permite reintentar sin VERSION_DOCUMENT_CHANGED ni reenviar metadatos", async () => {
    let serverInstructions = "Lea con atención";
    let serverPrompt = "¿Cuál figura continúa la serie?";
    let patchCount = 0;
    let configCount = 0;
    const retryConfigPayloads: unknown[] = [];

    server.use(
      http.get(`${API}/tests`, () => HttpResponse.json(ok([makeTestWire(1)]))),
      http.get(`${API}/tests/1/versions`, () =>
        HttpResponse.json(
          ok([{ ...makeVersionWire(10, 1), instruccionesGenerales: serverInstructions }]),
        ),
      ),
      http.get(`${API}/test-versions/10/subtests`, () =>
        HttpResponse.json(ok([makeSubtestWire(20, 10, "MEM", "Memoria Visual", 1)])),
      ),
      http.get(`${API}/subtests/20/clone-template`, () => {
        const tpl = makeTemplateWire(20, "MEM");
        tpl.items[0]!.sourceItemId = 30;
        tpl.items[0]!.prompt = serverPrompt;
        tpl.items[0]!.options[0]!.sourceOptionId = 40;
        tpl.items[0]!.options[1]!.sourceOptionId = 41;
        tpl.items[0]!.answerKey!.sourceAnswerKeyId = 50;
        tpl.items[0]!.answerKey!.correctOptionSourceId = 40;
        return HttpResponse.json(ok(tpl));
      }),
      http.get(`${API}/subtests/20/scoring-rules`, () =>
        HttpResponse.json(ok([makeRuleWire(80, 20, true)])),
      ),
      http.get(`${API}/test-versions/10/baremos`, () => HttpResponse.json(ok([]))),
      http.patch(`${API}/test-versions/10`, async ({ request }) => {
        patchCount += 1;
        const body = (await request.json()) as { instructions?: string | null };
        serverInstructions = body.instructions ?? "";
        return HttpResponse.json(
          ok({ ...makeVersionWire(10, 1), instruccionesGenerales: serverInstructions }),
        );
      }),
      http.post(`${API}/test-versions/10/configuration`, async ({ request }) => {
        configCount += 1;
        const body = await request.json();
        if (configCount === 1) {
          return HttpResponse.json({ success: false, message: "Servicio no disponible" }, { status: 503 });
        }
        retryConfigPayloads.push(body);
        serverPrompt = "Enunciado actualizado";
        return HttpResponse.json(ok([makeSubtestWire(20, 10, "MEM", "Memoria Visual", 1)]));
      }),
    );

    const loaded = await loadVersionDocument(10, { testId: 1 });
    const baseline = loaded.document;
    const reducer = createDocumentReducer(makeDeterministicDraftIdFactory(900));
    let doc = reducer(baseline, {
      type: "UPDATE_VERSION_META",
      patch: { instructions: "Instrucciones actualizadas" },
    });
    doc = reducer(doc, {
      type: "UPDATE_ITEM",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      patch: { prompt: "Enunciado actualizado" },
    });

    const firstErr = await saveVersionDocument({
      document: doc,
      pendingFiles: {},
      baselineDocument: baseline,
      baselineSignature: documentSignature(baseline),
      permissions: fullPermissions,
    }).catch((e: unknown) => e);

    expect(firstErr).toBeInstanceOf(PartialSaveError);
    const partial = firstErr as PartialSaveError;
    expect(partial.completedSteps).toEqual(["metadata"]);
    expect(partial.pendingSteps).toEqual(["configuration"]);
    expect(partial.document.version.metaDirty).toBe(false);
    expect(patchCount).toBe(1);

    // Reintentar con el documento y línea base reconciliados: no reenvía PATCH ni lanza 409
    const retried = await saveVersionDocument({
      document: partial.document,
      pendingFiles: {},
      baselineDocument: partial.baselineDocument ?? undefined,
      baselineSignature: partial.baselineSignature,
      permissions: fullPermissions,
    });

    expect(patchCount).toBe(1);
    expect(configCount).toBe(2);
    expect(retryConfigPayloads).toHaveLength(1);
    expect(retried.document.version.instructions).toBe("Instrucciones actualizadas");
    expect(retried.document.subtests[0]?.items[0]?.prompt).toBe("Enunciado actualizado");

    // Y si otra sesión cambia el servidor después del PATCH parcial, la línea base reconciliada sigue detectándolo
    serverPrompt = "Cambio externo";
    await expect(
      saveVersionDocument({
        document: partial.document,
        pendingFiles: {},
        baselineDocument: partial.baselineDocument ?? undefined,
        baselineSignature: partial.baselineSignature,
        permissions: fullPermissions,
      }),
    ).rejects.toMatchObject({ status: 409, code: "VERSION_DOCUMENT_CHANGED" });
  });

  it("MEDIO 3: bloquea guardado antes de escribir cuando código/orden colisionan con opción existente o se rompe ck_clave_tipo, y permite borrador incompleto persistible", async () => {
    let writes = 0;
    server.use(
      http.patch(`${API}/*`, () => {
        writes += 1;
        return HttpResponse.json(ok(makeVersionWire(10, 1)));
      }),
      http.post(`${API}/test-versions/10/configuration`, () => {
        writes += 1;
        return HttpResponse.json(ok([makeSubtestWire(20, 10, "MEM", "Memoria", 1)]));
      }),
      http.get(`${API}/tests`, () => HttpResponse.json(ok([makeTestWire(1)]))),
      http.get(`${API}/tests/1/versions`, () => HttpResponse.json(ok([makeVersionWire(10, 1)]))),
      http.get(`${API}/test-versions/10/subtests`, () =>
        HttpResponse.json(ok([makeSubtestWire(20, 10, "MEM", "Memoria", 1)])),
      ),
      http.get(`${API}/subtests/20/clone-template`, () =>
        HttpResponse.json(ok(makeTemplateWire(20, "MEM", { includeKey: false }))),
      ),
      http.get(`${API}/subtests/20/scoring-rules`, () => HttpResponse.json(ok([]))),
      http.get(`${API}/test-versions/10/baremos`, () => HttpResponse.json(ok([]))),
    );

    const reducer = createDocumentReducer(makeDeterministicDraftIdFactory(950));

    // 1. Renombrar opción B -> A cuando A (EXISTING) no está en el diff
    const dupOptDoc = reducer(createCleanDocument(), {
      type: "UPDATE_OPTION",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      optionDraftId: "opt-41",
      patch: { code: "A" },
    });
    await expect(
      saveVersionDocument({
        document: dupOptDoc,
        pendingFiles: {},
        permissions: fullPermissions,
      }),
    ).rejects.toMatchObject({ status: 400, code: "INVALID_VERSION_DRAFT" });

    // 2. Eliminar opción correcta dejando clave existente sin opción, texto, número ni revisión manual
    const brokenKeyDoc = reducer(createCleanDocument(), {
      type: "DELETE_OPTION",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      optionDraftId: "opt-40",
    });
    await expect(
      saveVersionDocument({
        document: brokenKeyDoc,
        pendingFiles: {},
        permissions: fullPermissions,
      }),
    ).rejects.toMatchObject({ status: 400, code: "INVALID_VERSION_DRAFT" });
    expect(writes).toBe(0);

    // 3. Borrador incompleto pero persistible (sin strategyId y sin clave de respuesta) sí guarda
    let incompleteDoc = createCleanDocument({ baremos: [] });
    incompleteDoc = reducer(incompleteDoc, {
      type: "UPDATE_VERSION_META",
      patch: { strategyId: null },
    });
    incompleteDoc.subtests[0]!.items[0]!.answerKey = null;
    incompleteDoc.subtests[0]!.items[0]!.status = "UPDATED";
    const savedIncomplete = await saveVersionDocument({
      document: incompleteDoc,
      pendingFiles: {},
      permissions: fullPermissions,
    });
    expect(savedIncomplete.document.version.versionId).toBe(10);
    expect(writes).toBe(2);
  });

  it("MEDIO 5: bloquea permutaciones B18 antes de guardar metadatos y permite movimientos a posiciones libres sin colisión", async () => {
    let patchCount = 0;
    const configPayloads: Array<{ subtests: Array<{ id?: number | null; order?: number | null }> }> = [];
    let subtestsWire = [
      makeSubtestWire(20, 10, "MEM", "Memoria", 1),
      makeSubtestWire(21, 10, "ESP", "Espacial", 2),
    ];

    server.use(
      http.patch(`${API}/test-versions/10`, () => {
        patchCount += 1;
        return HttpResponse.json(ok(makeVersionWire(10, 1)));
      }),
      http.post(`${API}/test-versions/10/configuration`, async ({ request }) => {
        const body = (await request.json()) as {
          subtests: Array<{ id?: number | null; order?: number | null }>;
        };
        configPayloads.push(body);
        subtestsWire = [
          makeSubtestWire(20, 10, "MEM", "Memoria", 2),
          makeSubtestWire(21, 10, "ESP", "Espacial", 3),
        ];
        return HttpResponse.json(ok(subtestsWire));
      }),
      http.get(`${API}/tests`, () => HttpResponse.json(ok([makeTestWire(1)]))),
      http.get(`${API}/tests/1/versions`, () => HttpResponse.json(ok([makeVersionWire(10, 1)]))),
      http.get(`${API}/test-versions/10/subtests`, () => HttpResponse.json(ok(subtestsWire))),
      http.get(`${API}/subtests/20/clone-template`, () =>
        HttpResponse.json(ok(makeTemplateWire(20, "MEM"))),
      ),
      http.get(`${API}/subtests/21/clone-template`, () =>
        HttpResponse.json(ok(makeTemplateWire(21, "ESP"))),
      ),
      http.get(`${API}/subtests/20/scoring-rules`, () => HttpResponse.json(ok([makeRuleWire(80, 20, true)]))),
      http.get(`${API}/subtests/21/scoring-rules`, () => HttpResponse.json(ok([makeRuleWire(81, 21, true)]))),
      http.get(`${API}/test-versions/10/baremos`, () => HttpResponse.json(ok([]))),
    );

    const baseline = createCleanDocument({ baremos: [] });
    baseline.subtests.push({
      ...baseline.subtests[0]!,
      id: 21,
      draftId: "sub-21",
      code: "ESP",
      name: "Espacial",
      order: 2,
      items: [],
    });

    const reducer = createDocumentReducer(makeDeterministicDraftIdFactory(980));
    let doc = reducer(baseline, {
      type: "UPDATE_VERSION_META",
      patch: { instructions: "Editado junto con reordenamiento" },
    });
    doc = reducer(doc, {
      type: "MOVE_SUBTEST",
      subtestDraftId: "sub-21",
      toIndex: 0,
    });

    // El intercambio de posiciones ocupadas bloquea ANTES de emitir PATCH o /configuration
    await expect(
      saveVersionDocument({
        document: doc,
        pendingFiles: {},
        baselineDocument: baseline,
        permissions: fullPermissions,
      }),
    ).rejects.toBeInstanceOf(OrderCollisionError);
    expect(patchCount).toBe(0);
    expect(configPayloads).toHaveLength(0);

    // Un movimiento a una posición libre sin colisión sigue permitido
    const freeSlotBaseline = createCleanDocument({ baremos: [] });
    freeSlotBaseline.subtests.push({
      ...freeSlotBaseline.subtests[0]!,
      id: 21,
      draftId: "sub-21",
      code: "ESP",
      name: "Espacial",
      order: 3,
      items: [],
    });
    subtestsWire = [
      makeSubtestWire(20, 10, "MEM", "Memoria", 1),
      makeSubtestWire(21, 10, "ESP", "Espacial", 3),
    ];

    const freeMoveDoc: VersionDocument = {
      ...freeSlotBaseline,
      subtests: [
        { ...freeSlotBaseline.subtests[0]!, order: 2, status: "UPDATED" },
        freeSlotBaseline.subtests[1]!,
      ],
    };

    await saveVersionDocument({
      document: freeMoveDoc,
      pendingFiles: {},
      baselineDocument: freeSlotBaseline,
      permissions: fullPermissions,
    });
    expect(patchCount).toBe(0);
    expect(configPayloads).toHaveLength(1);
    expect(configPayloads[0]!.subtests.map((s) => [s.id, s.order])).toEqual([[20, 2]]);
  });

  it("ALTO 1: guardado parcial tras metadata + configuration reconcilia la línea base y permite reintentar solo baremos sin 409", async () => {
    let serverInstructions = "Instrucciones iniciales";
    let serverPrompt = "¿Cuál figura continúa la serie?";
    let patchCount = 0;
    let configCount = 0;
    let baremoPostCount = 0;
    let baremoCreated = false;

    server.use(
      http.get(`${API}/tests`, () => HttpResponse.json(ok([makeTestWire(1)]))),
      http.get(`${API}/tests/1/versions`, () =>
        HttpResponse.json(
          ok([{ ...makeVersionWire(10, 1), instruccionesGenerales: serverInstructions }]),
        ),
      ),
      http.get(`${API}/test-versions/10/subtests`, () =>
        HttpResponse.json(ok([makeSubtestWire(20, 10, "MEM", "Memoria Visual", 1)])),
      ),
      http.get(`${API}/subtests/20/clone-template`, () => {
        const tpl = makeTemplateWire(20, "MEM");
        tpl.items[0]!.sourceItemId = 30;
        tpl.items[0]!.prompt = serverPrompt;
        tpl.items[0]!.options[0]!.sourceOptionId = 40;
        tpl.items[0]!.options[1]!.sourceOptionId = 41;
        tpl.items[0]!.answerKey!.sourceAnswerKeyId = 50;
        tpl.items[0]!.answerKey!.correctOptionSourceId = 40;
        return HttpResponse.json(ok(tpl));
      }),
      http.get(`${API}/subtests/20/scoring-rules`, () =>
        HttpResponse.json(ok([makeRuleWire(80, 20, true)])),
      ),
      http.get(`${API}/test-versions/10/baremos`, () =>
        HttpResponse.json(ok(baremoCreated ? [makeBaremoWire(90, 10)] : [])),
      ),
      http.get(`${API}/baremos/90/ranges`, () => HttpResponse.json(ok([]))),
      http.patch(`${API}/test-versions/10`, async ({ request }) => {
        patchCount += 1;
        const body = (await request.json()) as { instructions?: string | null };
        serverInstructions = body.instructions ?? "";
        return HttpResponse.json(
          ok({ ...makeVersionWire(10, 1), instruccionesGenerales: serverInstructions }),
        );
      }),
      http.post(`${API}/test-versions/10/configuration`, () => {
        configCount += 1;
        serverPrompt = "Enunciado guardado";
        return HttpResponse.json(ok([makeSubtestWire(20, 10, "MEM", "Memoria Visual", 1)]));
      }),
      http.post(`${API}/baremos`, () => {
        baremoPostCount += 1;
        if (baremoPostCount === 1) {
          return HttpResponse.json({ success: false, message: "Error temporal baremos" }, { status: 503 });
        }
        baremoCreated = true;
        return HttpResponse.json(ok(makeBaremoWire(90, 10)));
      }),
    );

    const loaded = await loadVersionDocument(10, { testId: 1 });
    const baseline = loaded.document;
    const reducer = createDocumentReducer(makeDeterministicDraftIdFactory(990));

    let doc = reducer(baseline, {
      type: "UPDATE_VERSION_META",
      patch: { instructions: "Instrucciones nuevas" },
    });
    doc = reducer(doc, {
      type: "UPDATE_ITEM",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      patch: { prompt: "Enunciado guardado" },
    });
    doc = reducer(doc, { type: "ADD_BAREMO" });
    const addedBaremo = doc.baremos[0]!;
    doc = reducer(doc, {
      type: "UPDATE_BAREMO",
      baremoDraftId: addedBaremo.draftId,
      patch: { code: "BAR-TOT", name: "Baremo total" },
    });

    const firstErr = await saveVersionDocument({
      document: doc,
      pendingFiles: {},
      baselineDocument: baseline,
      baselineSignature: documentSignature(baseline),
      permissions: fullPermissions,
    }).catch((e: unknown) => e);

    expect(firstErr).toBeInstanceOf(PartialSaveError);
    const partial = firstErr as PartialSaveError;
    expect(partial.completedSteps).toEqual(["metadata", "configuration"]);
    expect(partial.pendingSteps).toEqual(["baremos"]);
    expect(patchCount).toBe(1);
    expect(configCount).toBe(1);
    expect(baremoPostCount).toBe(1);

    const retried = await saveVersionDocument({
      document: partial.document,
      pendingFiles: {},
      baselineDocument: partial.baselineDocument ?? undefined,
      baselineSignature: partial.baselineSignature,
      permissions: fullPermissions,
    });

    expect(patchCount).toBe(1);
    expect(configCount).toBe(1);
    expect(baremoPostCount).toBe(2);
    expect(retried.document.baremos).toHaveLength(1);
  });

  it("F3-FIX-3 (ALTO 1): guardado parcial con 503 en baremos y 503 en recarga registra reconciliación pendiente, reintenta en orden (a)→(b)→(c) sin VERSION_DOCUMENT_CHANGED y mantiene reintento si la recarga vuelve a fallar", async () => {
    let serverInstructions = "Instrucciones iniciales";
    let serverPrompt = "¿Cuál figura continúa la serie?";
    let patchCount = 0;
    let configCount = 0;
    let baremoPostCount = 0;
    let baremoCreated = false;
    let subtestsGetCalls = 0;
    let failReloadWith503 = false;
    let failNextRetryReload = false;
    const callOrder: string[] = [];

    server.use(
      http.get(`${API}/tests`, () => HttpResponse.json(ok([makeTestWire(1)]))),
      http.get(`${API}/tests/1/versions`, () =>
        HttpResponse.json(
          ok([{ ...makeVersionWire(10, 1), instruccionesGenerales: serverInstructions }]),
        ),
      ),
      http.get(`${API}/test-versions/10/subtests`, () => {
        subtestsGetCalls += 1;
        callOrder.push(`GET /subtests#${subtestsGetCalls}`);
        if (failReloadWith503 || failNextRetryReload) {
          failNextRetryReload = false;
          return HttpResponse.json({ success: false, message: "Recarga 503" }, { status: 503 });
        }
        return HttpResponse.json(ok([makeSubtestWire(20, 10, "MEM", "Memoria Visual", 1)]));
      }),
      http.get(`${API}/subtests/20/clone-template`, () => {
        const tpl = makeTemplateWire(20, "MEM");
        tpl.items[0]!.sourceItemId = 30;
        tpl.items[0]!.prompt = serverPrompt;
        tpl.items[0]!.options[0]!.sourceOptionId = 40;
        tpl.items[0]!.options[1]!.sourceOptionId = 41;
        tpl.items[0]!.answerKey!.sourceAnswerKeyId = 50;
        tpl.items[0]!.answerKey!.correctOptionSourceId = 40;
        return HttpResponse.json(ok(tpl));
      }),
      http.get(`${API}/subtests/20/scoring-rules`, () =>
        HttpResponse.json(ok([makeRuleWire(80, 20, true)])),
      ),
      http.get(`${API}/test-versions/10/baremos`, () =>
        HttpResponse.json(ok(baremoCreated ? [makeBaremoWire(90, 10)] : [])),
      ),
      http.get(`${API}/baremos/90/ranges`, () => HttpResponse.json(ok([]))),
      http.patch(`${API}/test-versions/10`, async ({ request }) => {
        patchCount += 1;
        callOrder.push(`PATCH /versions#${patchCount}`);
        const body = (await request.json()) as { instructions?: string | null };
        serverInstructions = body.instructions ?? "";
        return HttpResponse.json(
          ok({ ...makeVersionWire(10, 1), instruccionesGenerales: serverInstructions }),
        );
      }),
      http.post(`${API}/test-versions/10/configuration`, () => {
        configCount += 1;
        callOrder.push(`POST /configuration#${configCount}`);
        serverPrompt = "Enunciado guardado";
        return HttpResponse.json(ok([makeSubtestWire(20, 10, "MEM", "Memoria Visual", 1)]));
      }),
      http.post(`${API}/baremos`, () => {
        baremoPostCount += 1;
        callOrder.push(`POST /baremos#${baremoPostCount}`);
        if (baremoPostCount === 1) {
          failReloadWith503 = true;
          return HttpResponse.json({ success: false, message: "Error temporal baremos" }, { status: 503 });
        }
        baremoCreated = true;
        return HttpResponse.json(ok(makeBaremoWire(90, 10)));
      }),
    );

    const loaded = await loadVersionDocument(10, { testId: 1 });
    const baseline = loaded.document;
    const reducer = createDocumentReducer(makeDeterministicDraftIdFactory(995));

    let doc = reducer(baseline, {
      type: "UPDATE_VERSION_META",
      patch: { instructions: "Instrucciones nuevas" },
    });
    doc = reducer(doc, {
      type: "UPDATE_ITEM",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      patch: { prompt: "Enunciado guardado" },
    });
    doc = reducer(doc, { type: "ADD_BAREMO" });
    const addedBaremo = doc.baremos[0]!;
    doc = reducer(doc, {
      type: "UPDATE_BAREMO",
      baremoDraftId: addedBaremo.draftId,
      patch: { code: "BAR-TOT", name: "Baremo total" },
    });

    // 1. Primer intento: metadata + configuration OK, baremos 503 y recarga de reconciliación 503
    const firstErr = await saveVersionDocument({
      document: doc,
      pendingFiles: {},
      baselineDocument: baseline,
      baselineSignature: documentSignature(baseline),
      permissions: fullPermissions,
    }).catch((e: unknown) => e);

    expect(firstErr).toBeInstanceOf(PartialSaveError);
    const partial1 = firstErr as PartialSaveError;
    expect(partial1.reconciliationPending).toBe(true);
    expect(partial1.completedSteps).toEqual(["metadata", "configuration"]);
    expect(partial1.pendingSteps).toEqual(["baremos"]);

    // 2. Si la recarga en el reintento vuelve a fallar (503), sigue en reconciliación pendiente con mensaje explicativo
    failReloadWith503 = false;
    failNextRetryReload = true;
    const secondErr = await saveVersionDocument({
      document: partial1.document,
      pendingFiles: {},
      baselineDocument: partial1.baselineDocument ?? undefined,
      baselineSignature: partial1.baselineSignature,
      reconciliationPending: partial1.reconciliationPending,
      completedSteps: partial1.completedSteps,
      pendingSteps: partial1.pendingSteps,
      permissions: fullPermissions,
    }).catch((e: unknown) => e);

    expect(secondErr).toBeInstanceOf(PartialSaveError);
    const partial2 = secondErr as PartialSaveError;
    expect(partial2.reconciliationPending).toBe(true);
    expect(partial2.completedSteps).toEqual(["metadata", "configuration"]);
    expect(partial2.pendingSteps).toEqual(["baremos"]);
    expect(partial2.message).toMatch(/recargar.*reconciliar/i);
    expect(partial2.message).toMatch(/reintent/i);
    expect(baremoPostCount).toBe(1);

    // 3. Si otra sesión modificó externamente el servidor mientras no había conexión, (b) lo detecta tras (a)
    serverPrompt = "Cambio externo inesperado";
    await expect(
      saveVersionDocument({
        document: partial2.document,
        pendingFiles: {},
        baselineDocument: partial2.baselineDocument ?? undefined,
        baselineSignature: partial2.baselineSignature,
        reconciliationPending: partial2.reconciliationPending,
        completedSteps: partial2.completedSteps,
        pendingSteps: partial2.pendingSteps,
        permissions: fullPermissions,
      }),
    ).rejects.toMatchObject({ status: 409, code: "VERSION_DOCUMENT_CHANGED" });
    expect(baremoPostCount).toBe(1);

    // 4. Restaurar el estado propio del servidor y reintentar: (a) recarga -> (b) reconoce escrituras propias -> (c) guarda baremo
    serverPrompt = "Enunciado guardado";
    callOrder.length = 0;
    const retried = await saveVersionDocument({
      document: partial2.document,
      pendingFiles: {},
      baselineDocument: partial2.baselineDocument ?? undefined,
      baselineSignature: partial2.baselineSignature,
      reconciliationPending: partial2.reconciliationPending,
      completedSteps: partial2.completedSteps,
      pendingSteps: partial2.pendingSteps,
      permissions: fullPermissions,
    });

    expect(patchCount).toBe(1);
    expect(configCount).toBe(1);
    expect(baremoPostCount).toBe(2);
    expect(callOrder[0]).toMatch(/^GET \/subtests#/);
    expect(callOrder[1]).toBe("POST /baremos#2");
    expect(retried.document.baremos).toHaveLength(1);
  });

  it("F3-FIX-4 (Test 1 - ALTO): baremo creado en servidor + 503 al cliente + 503 en recarga se adopta al reintentar sin 409 ni duplicados (1 solo POST /baremos)", async () => {
    let baremoPostCount = 0;
    let persistedBaremo: ReturnType<typeof makeBaremoWire> | null = null;
    let failReload = false;

    server.use(
      http.get(`${API}/tests`, () => HttpResponse.json(ok([makeTestWire(1)]))),
      http.get(`${API}/tests/1/versions`, () => HttpResponse.json(ok([makeVersionWire(10, 1)]))),
      http.get(`${API}/test-versions/10/subtests`, () => {
        if (failReload) {
          return HttpResponse.json({ success: false, message: "Recarga 503" }, { status: 503 });
        }
        return HttpResponse.json(ok([makeSubtestWire(20, 10, "MEM", "Memoria Visual", 1)]));
      }),
      http.get(`${API}/subtests/20/clone-template`, () => {
        const tpl = makeTemplateWire(20, "MEM");
        tpl.items[0]!.sourceItemId = 30;
        tpl.items[0]!.options[0]!.sourceOptionId = 40;
        tpl.items[0]!.options[1]!.sourceOptionId = 41;
        tpl.items[0]!.answerKey!.sourceAnswerKeyId = 50;
        tpl.items[0]!.answerKey!.correctOptionSourceId = 40;
        return HttpResponse.json(ok(tpl));
      }),
      http.get(`${API}/subtests/20/scoring-rules`, () =>
        HttpResponse.json(ok([makeRuleWire(80, 20, true)])),
      ),
      http.get(`${API}/test-versions/10/baremos`, () =>
        HttpResponse.json(ok(persistedBaremo ? [persistedBaremo] : [])),
      ),
      http.get(`${API}/baremos/90/ranges`, () => HttpResponse.json(ok([]))),
      http.post(`${API}/baremos`, async ({ request }) => {
        baremoPostCount += 1;
        const body = (await request.json()) as {
          code: string;
          name: string;
          description?: string | null;
          normativeGroup?: string | null;
        };
        // El servidor SÍ crea el baremo pero devuelve 503 al cliente y la recarga también falla
        persistedBaremo = {
          ...makeBaremoWire(90, 10),
          codigoBaremo: body.code,
          nombre: body.name,
          descripcion: body.description ?? "",
          grupoNormativo: body.normativeGroup ?? "",
        };
        failReload = true;
        return HttpResponse.json({ success: false, message: "503 tras commit" }, { status: 503 });
      }),
    );

    const loaded = await loadVersionDocument(10, { testId: 1 });
    const baseline = loaded.document;
    const reducer = createDocumentReducer(makeDeterministicDraftIdFactory(1010));
    let doc = reducer(baseline, { type: "ADD_BAREMO" });
    const baremoDraftId = doc.baremos[0]!.draftId;
    doc = reducer(doc, {
      type: "UPDATE_BAREMO",
      baremoDraftId,
      patch: { code: "BAR-TOT", name: "Baremo total" },
    });

    const firstErr = await saveVersionDocument({
      document: doc,
      pendingFiles: {},
      baselineDocument: baseline,
      baselineSignature: documentSignature(baseline),
      permissions: fullPermissions,
    }).catch((e: unknown) => e);

    expect(firstErr).toBeInstanceOf(PartialSaveError);
    const partial = firstErr as PartialSaveError;
    expect(partial.reconciliationPending).toBe(true);
    expect(baremoPostCount).toBe(1);

    // Al recuperar, el reintento recarga, adopta el baremo como ya aplicado y termina sin 409 ni duplicados
    failReload = false;
    const retried = await saveVersionDocument({
      document: partial.document,
      pendingFiles: {},
      baselineDocument: partial.baselineDocument ?? undefined,
      baselineSignature: partial.baselineSignature,
      reconciliationPending: partial.reconciliationPending,
      completedSteps: partial.completedSteps,
      pendingSteps: partial.pendingSteps,
      permissions: fullPermissions,
    });

    expect(baremoPostCount).toBe(1);
    expect(retried.document.baremos).toHaveLength(1);
    expect(retried.document.baremos[0]?.id).toBe(90);
    expect(retried.document.baremos[0]?.code).toBe("BAR-TOT");
  });

  it("F3-FIX-4 (Test 2 - ALTO): configuración aplicada en servidor + 503 al cliente + 503 en recarga se adopta sin duplicados", async () => {
    let configPostCount = 0;
    let subtestEspPersisted = false;
    let failReload = false;

    server.use(
      http.get(`${API}/tests`, () => HttpResponse.json(ok([makeTestWire(1)]))),
      http.get(`${API}/tests/1/versions`, () => HttpResponse.json(ok([makeVersionWire(10, 1)]))),
      http.get(`${API}/test-versions/10/subtests`, () => {
        if (failReload) {
          return HttpResponse.json({ success: false, message: "Recarga 503" }, { status: 503 });
        }
        const subs = [makeSubtestWire(20, 10, "MEM", "Memoria Visual", 1)];
        if (subtestEspPersisted) {
          subs.push({
            ...makeSubtestWire(25, 10, "ESP", "Espacial", 2),
            descripcion: "",
            instrucciones: "",
            tiempoLimiteSegundos: null,
            permiteAleatorizarItems: false,
          });
        }
        return HttpResponse.json(ok(subs));
      }),
      http.get(`${API}/subtests/20/clone-template`, () => {
        const tpl = makeTemplateWire(20, "MEM");
        tpl.items[0]!.sourceItemId = 30;
        tpl.items[0]!.options[0]!.sourceOptionId = 40;
        tpl.items[0]!.options[1]!.sourceOptionId = 41;
        tpl.items[0]!.answerKey!.sourceAnswerKeyId = 50;
        tpl.items[0]!.answerKey!.correctOptionSourceId = 40;
        return HttpResponse.json(ok(tpl));
      }),
      http.get(`${API}/subtests/25/clone-template`, () =>
        HttpResponse.json(
          ok({
            sourceSubtestId: 25,
            code: "ESP",
            name: "Espacial",
            description: "",
            instructions: "",
            order: 2,
            timeLimitSeconds: null,
            randomizeItems: false,
            randomizeOptions: false,
            required: true,
            strategyId: 1,
            estado: "ACTIVO",
            items: [
              {
                sourceItemId: 251,
                code: "IT-ESP",
                itemType: "SOLO_TEXTO",
                responseType: "TEXTO_ABIERTO",
                prompt: "Explique",
                instruction: "",
                order: 1,
                baseScore: 1,
                timeLimitSeconds: null,
                required: true,
                confidential: true,
                estado: "ACTIVO",
                images: [],
                options: [],
                answerKey: {
                  sourceAnswerKeyId: 2550,
                  sourceRuleId: 80,
                  correctOptionSourceId: null,
                  expectedText: null,
                  expectedNumber: null,
                  numericTolerance: null,
                  score: 1,
                  requiresManualReview: true,
                },
              },
            ],
          }),
        ),
      ),
      http.get(`${API}/subtests/20/scoring-rules`, () =>
        HttpResponse.json(ok([makeRuleWire(80, 20, true)])),
      ),
      http.get(`${API}/subtests/25/scoring-rules`, () =>
        HttpResponse.json(ok([makeRuleWire(80, 25, true)])),
      ),
      http.get(`${API}/test-versions/10/baremos`, () => HttpResponse.json(ok([]))),
      http.post(`${API}/test-versions/10/configuration`, () => {
        configPostCount += 1;
        // El servidor persiste la configuración pero devuelve 503 al cliente y falla la recarga
        subtestEspPersisted = true;
        failReload = true;
        return HttpResponse.json({ success: false, message: "503 tras commit config" }, { status: 503 });
      }),
    );

    const loaded = await loadVersionDocument(10, { testId: 1 });
    const baseline = loaded.document;
    const reducer = createDocumentReducer(makeDeterministicDraftIdFactory(1020));
    let doc = reducer(baseline, {
      type: "ADD_SUBTEST",
      input: { draftId: "sub-esp", code: "ESP", name: "Espacial", defaultRuleId: 80 },
    });
    doc = reducer(doc, {
      type: "ADD_ITEM",
      subtestDraftId: "sub-esp",
      input: {
        draftId: "item-esp",
        code: "IT-ESP",
        responseType: "TEXTO_ABIERTO",
        prompt: "Explique",
      },
    });
    doc = reducer(doc, {
      type: "UPDATE_ANSWER_KEY",
      subtestDraftId: "sub-esp",
      itemDraftId: "item-esp",
      patch: { ruleId: 80, requiresManualReview: true },
    });

    const firstErr = await saveVersionDocument({
      document: doc,
      pendingFiles: {},
      baselineDocument: baseline,
      baselineSignature: documentSignature(baseline),
      permissions: fullPermissions,
    }).catch((e: unknown) => e);

    expect(firstErr).toBeInstanceOf(PartialSaveError);
    const partial = firstErr as PartialSaveError;
    expect(partial.reconciliationPending).toBe(true);
    expect(configPostCount).toBe(1);

    failReload = false;
    const retried = await saveVersionDocument({
      document: partial.document,
      pendingFiles: {},
      baselineDocument: partial.baselineDocument ?? undefined,
      baselineSignature: partial.baselineSignature,
      reconciliationPending: partial.reconciliationPending,
      completedSteps: partial.completedSteps,
      pendingSteps: partial.pendingSteps,
      permissions: fullPermissions,
    });

    expect(configPostCount).toBe(1);
    expect(retried.document.subtests).toHaveLength(2);
    expect(retried.document.subtests[1]?.id).toBe(25);
  });

  it("F3-FIX-4 (Test 3 - Conflicto real): otro usuario cambió el mismo nodo → 409 con ese nodo listado y sin perder nodos no conflictivos", async () => {
    let serverPrompt = "¿Cuál figura continúa la serie?";
    let writes = 0;

    server.use(
      http.get(`${API}/tests`, () => HttpResponse.json(ok([makeTestWire(1)]))),
      http.get(`${API}/tests/1/versions`, () => HttpResponse.json(ok([makeVersionWire(10, 1)]))),
      http.get(`${API}/test-versions/10/subtests`, () =>
        HttpResponse.json(ok([makeSubtestWire(20, 10, "MEM", "Memoria Visual", 1)])),
      ),
      http.get(`${API}/subtests/20/clone-template`, () => {
        const tpl = makeTemplateWire(20, "MEM");
        tpl.items[0]!.sourceItemId = 30;
        tpl.items[0]!.prompt = serverPrompt;
        tpl.items[0]!.options[0]!.sourceOptionId = 40;
        tpl.items[0]!.options[1]!.sourceOptionId = 41;
        tpl.items[0]!.answerKey!.sourceAnswerKeyId = 50;
        tpl.items[0]!.answerKey!.correctOptionSourceId = 40;
        return HttpResponse.json(ok(tpl));
      }),
      http.get(`${API}/subtests/20/scoring-rules`, () =>
        HttpResponse.json(ok([makeRuleWire(80, 20, true)])),
      ),
      http.get(`${API}/test-versions/10/baremos`, () => HttpResponse.json(ok([]))),
      http.patch(`${API}/test-versions/10`, () => {
        writes += 1;
        return HttpResponse.json(ok(makeVersionWire(10, 1)));
      }),
      http.post(`${API}/baremos`, () => {
        writes += 1;
        return HttpResponse.json(ok(makeBaremoWire(90, 10)));
      }),
    );

    const loaded = await loadVersionDocument(10, { testId: 1 });
    const baseline = loaded.document;
    const reducer = createDocumentReducer(makeDeterministicDraftIdFactory(1030));

    let doc = reducer(baseline, {
      type: "UPDATE_VERSION_META",
      patch: { instructions: "Instrucción local sin conflicto" },
    });
    doc = reducer(doc, {
      type: "UPDATE_ITEM",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      patch: { prompt: "Enunciado local en conflicto" },
    });
    doc = reducer(doc, { type: "ADD_BAREMO" });
    doc = reducer(doc, {
      type: "UPDATE_BAREMO",
      baremoDraftId: doc.baremos[0]!.draftId,
      patch: { code: "BAR-LOC", name: "Baremo local" },
    });

    // Otro usuario modifica el mismo ítem en el servidor
    serverPrompt = "Enunciado editado externamente";

    const err = await saveVersionDocument({
      document: doc,
      pendingFiles: {},
      baselineDocument: baseline,
      baselineSignature: documentSignature(baseline),
      permissions: fullPermissions,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(VersionConflictError);
    const conflictErr = err as VersionConflictError;
    expect(conflictErr.status).toBe(409);
    expect(conflictErr.code).toBe("VERSION_DOCUMENT_CHANGED");
    expect(conflictErr.conflicts).toHaveLength(1);
    expect(conflictErr.conflicts[0]?.kind).toBe("item");
    expect(conflictErr.conflicts[0]?.label).toContain("IT-1");
    expect(conflictErr.details?.join(" ")).toContain("IT-1");
    expect(writes).toBe(0);
    // Los nodos no conflictivos se conservan intactos en doc
    expect(doc.version.instructions).toBe("Instrucción local sin conflicto");
    expect(doc.baremos).toHaveLength(1);
    expect(doc.baremos[0]?.code).toBe("BAR-LOC");
  });

  it("F3-FIX-4 (Test 4 - MEDIO adapter): todo guardado y las dos recargas finales fallan → PartialSaveError con reconciliationPending y pendingSteps vacío", async () => {
    let serverInstructions = "Lea con atención";
    let failFinalReloads = false;

    server.use(
      http.get(`${API}/tests`, () => HttpResponse.json(ok([makeTestWire(1)]))),
      http.get(`${API}/tests/1/versions`, () =>
        HttpResponse.json(ok([{ ...makeVersionWire(10, 1), instruccionesGenerales: serverInstructions }])),
      ),
      http.get(`${API}/test-versions/10/subtests`, () => {
        if (failFinalReloads) {
          return HttpResponse.json({ success: false, message: "Recarga final 503" }, { status: 503 });
        }
        return HttpResponse.json(ok([makeSubtestWire(20, 10, "MEM", "Memoria Visual", 1)]));
      }),
      http.get(`${API}/subtests/20/clone-template`, () => {
        const tpl = makeTemplateWire(20, "MEM");
        tpl.items[0]!.sourceItemId = 30;
        tpl.items[0]!.options[0]!.sourceOptionId = 40;
        tpl.items[0]!.options[1]!.sourceOptionId = 41;
        tpl.items[0]!.answerKey!.sourceAnswerKeyId = 50;
        tpl.items[0]!.answerKey!.correctOptionSourceId = 40;
        return HttpResponse.json(ok(tpl));
      }),
      http.get(`${API}/subtests/20/scoring-rules`, () =>
        HttpResponse.json(ok([makeRuleWire(80, 20, true)])),
      ),
      http.get(`${API}/test-versions/10/baremos`, () => HttpResponse.json(ok([]))),
      http.patch(`${API}/test-versions/10`, async ({ request }) => {
        const body = (await request.json()) as { instructions?: string | null };
        serverInstructions = body.instructions ?? "";
        failFinalReloads = true;
        return HttpResponse.json(ok({ ...makeVersionWire(10, 1), instruccionesGenerales: serverInstructions }));
      }),
    );

    const loaded = await loadVersionDocument(10, { testId: 1 });
    const baseline = loaded.document;
    const reducer = createDocumentReducer(makeDeterministicDraftIdFactory(1040));
    const doc = reducer(baseline, {
      type: "UPDATE_VERSION_META",
      patch: { instructions: "Guardada" },
    });

    const err = await saveVersionDocument({
      document: doc,
      pendingFiles: {},
      baselineDocument: baseline,
      baselineSignature: documentSignature(baseline),
      permissions: fullPermissions,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(PartialSaveError);
    const partial = err as PartialSaveError;
    expect(partial.reconciliationPending).toBe(true);
    expect(partial.completedSteps).toEqual(["metadata"]);
    expect(partial.pendingSteps).toEqual([]);
    expect(partial.document.dirtyNodeIds).toEqual([]);

    failFinalReloads = false;
    const synced = await saveVersionDocument({
      document: partial.document,
      pendingFiles: {},
      baselineDocument: partial.baselineDocument ?? undefined,
      baselineSignature: partial.baselineSignature,
      reconciliationPending: partial.reconciliationPending,
      sent: partial.sent,
      completedSteps: partial.completedSteps,
      pendingSteps: partial.pendingSteps,
      permissions: fullPermissions,
    });
    expect(synced.document.version.instructions).toBe("Guardada");
  });

  it("F3-FIX-5 (Hallazgo 1 - ALTO): borrar un subtest localmente mientras el servidor edita un ítem hijo lanza 409 sin emitir escrituras", async () => {
    let serverPrompt = "¿Cuál figura continúa la serie?";
    let writes = 0;

    server.use(
      http.get(`${API}/tests`, () => HttpResponse.json(ok([makeTestWire(1)]))),
      http.get(`${API}/tests/1/versions`, () => HttpResponse.json(ok([makeVersionWire(10, 1)]))),
      http.get(`${API}/test-versions/10/subtests`, () =>
        HttpResponse.json(ok([makeSubtestWire(20, 10, "MEM", "Memoria Visual", 1)])),
      ),
      http.get(`${API}/subtests/20/clone-template`, () => {
        const tpl = makeTemplateWire(20, "MEM");
        tpl.items[0]!.sourceItemId = 30;
        tpl.items[0]!.prompt = serverPrompt;
        tpl.items[0]!.options[0]!.sourceOptionId = 40;
        tpl.items[0]!.options[1]!.sourceOptionId = 41;
        tpl.items[0]!.answerKey!.sourceAnswerKeyId = 50;
        tpl.items[0]!.answerKey!.correctOptionSourceId = 40;
        return HttpResponse.json(ok(tpl));
      }),
      http.get(`${API}/subtests/20/scoring-rules`, () =>
        HttpResponse.json(ok([makeRuleWire(80, 20, true)])),
      ),
      http.get(`${API}/test-versions/10/baremos`, () => HttpResponse.json(ok([]))),
      http.post(`${API}/test-versions/10/configuration`, () => {
        writes += 1;
        return HttpResponse.json(ok([]));
      }),
    );

    const loaded = await loadVersionDocument(10, { testId: 1 });
    const baseline = loaded.document;
    const reducer = createDocumentReducer(makeDeterministicDraftIdFactory(1100));
    const doc = reducer(baseline, {
      type: "DELETE_SUBTEST",
      subtestDraftId: "sub-20",
    });

    // Otro usuario edita un ítem hijo en el servidor
    serverPrompt = "Ítem editado por otro usuario";

    const err = await saveVersionDocument({
      document: doc,
      pendingFiles: {},
      baselineDocument: baseline,
      baselineSignature: documentSignature(baseline),
      permissions: fullPermissions,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(VersionConflictError);
    const conflictErr = err as VersionConflictError;
    expect(conflictErr.status).toBe(409);
    expect(conflictErr.conflicts.some((c) => c.kind === "subtest")).toBe(true);
    expect(conflictErr.conflicts.some((c) => c.kind === "item" && c.label.includes("IT-1"))).toBe(true);
    expect(writes).toBe(0);
  });

  it("F3-FIX-5 / F3-FIX-8 (ALTO 1): imagen subida al servidor + 503 + recarga 503 abre UNCERTAIN_IMAGE_OPERATION sin auto-adopción y conserva File y sent hasta resolver", async () => {
    let uploadCalls = 0;
    let persistedExtraImage: {
      sourceImageId: number;
      resourceId: number;
      order: number;
      altText: string;
      storagePath: string;
      role: string;
    } | null = null;
    let failReload = false;

    server.use(
      http.get(`${API}/tests`, () => HttpResponse.json(ok([makeTestWire(1)]))),
      http.get(`${API}/tests/1/versions`, () => HttpResponse.json(ok([makeVersionWire(10, 1)]))),
      http.get(`${API}/test-versions/10/subtests`, () => {
        if (failReload) {
          return HttpResponse.json({ success: false, message: "Recarga 503" }, { status: 503 });
        }
        return HttpResponse.json(ok([makeSubtestWire(20, 10, "MEM", "Memoria Visual", 1)]));
      }),
      http.get(`${API}/subtests/20/clone-template`, () => {
        const tpl = makeTemplateWire(20, "MEM");
        tpl.items[0]!.sourceItemId = 30;
        tpl.items[0]!.images = [
          {
            sourceImageId: 55,
            resourceId: 77,
            order: 1,
            altText: "Figura estímulo",
            storagePath: "items/1.png",
            role: "ENUNCIADO",
          },
          ...(persistedExtraImage ? [persistedExtraImage] : []),
        ];
        tpl.items[0]!.options[0]!.sourceOptionId = 40;
        tpl.items[0]!.options[1]!.sourceOptionId = 41;
        tpl.items[0]!.answerKey!.sourceAnswerKeyId = 50;
        tpl.items[0]!.answerKey!.correctOptionSourceId = 40;
        return HttpResponse.json(ok(tpl));
      }),
      http.get(`${API}/subtests/20/scoring-rules`, () =>
        HttpResponse.json(ok([makeRuleWire(80, 20, true)])),
      ),
      http.get(`${API}/test-versions/10/baremos`, () => HttpResponse.json(ok([]))),
      http.post(`${API}/items/30/images`, () => {
        uploadCalls += 1;
        persistedExtraImage = {
          sourceImageId: 88,
          resourceId: 905,
          order: 2,
          altText: "Segunda figura",
          storagePath: "test-config/items/30/550e8400-e29b-41d4-a716-446655440000-dos.png",
          role: "ENUNCIADO",
        };
        failReload = true;
        return HttpResponse.json({ success: false, message: "503 tras subir imagen" }, { status: 503 });
      }),
    );

    const loaded = await loadVersionDocument(10, { testId: 1 });
    const baseline = loaded.document;
    const reducer = createDocumentReducer(makeDeterministicDraftIdFactory(1120));
    const doc = reducer(baseline, {
      type: "ATTACH_ITEM_IMAGE",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      image: {
        draftId: "img-pending-2",
        pendingFileId: "f-2",
        order: 2,
        altText: "Segunda figura",
        role: "ENUNCIADO",
        fileName: "dos.png",
      },
    });
    const files = { "f-2": new File(["img"], "dos.png", { type: "image/png" }) };

    const firstErr = await saveVersionDocument({
      document: doc,
      pendingFiles: files,
      baselineDocument: baseline,
      baselineSignature: documentSignature(baseline),
      permissions: fullPermissions,
    }).catch((e: unknown) => e);

    expect(firstErr).toBeInstanceOf(PartialSaveError);
    const partial = firstErr as PartialSaveError;
    expect(partial.reconciliationPending).toBe(true);
    expect(uploadCalls).toBe(1);

    failReload = false;
    const conflictErr = await saveVersionDocument({
      document: partial.document,
      pendingFiles: files,
      baselineDocument: partial.baselineDocument ?? undefined,
      baselineSignature: partial.baselineSignature,
      reconciliationPending: partial.reconciliationPending,
      sent: partial.sent,
      completedSteps: partial.completedSteps,
      pendingSteps: partial.pendingSteps,
      permissions: fullPermissions,
    }).catch((e: unknown) => e);

    expect(uploadCalls).toBe(1);
    expect(conflictErr).toBeInstanceOf(VersionConflictError);
    const vErr = conflictErr as VersionConflictError;
    expect(vErr.conflicts).toHaveLength(1);
    expect(vErr.conflicts[0]?.kind).toBe("UNCERTAIN_IMAGE_OPERATION");
    expect(vErr.conflicts[0]?.resolution?.intention).toBe("reupload");

    const resolved = resolveUncertainImageConflict({
      document: partial.document,
      baseline: partial.baselineDocument,
      sent: partial.sent,
      resolution: vErr.conflicts[0]!.resolution!,
      choice: "keep_server",
    });
    const retried = await saveVersionDocument({
      document: resolved.document,
      pendingFiles: files,
      baselineDocument: resolved.baseline ?? undefined,
      baselineSignature: partial.baselineSignature,
      reconciliationPending: partial.reconciliationPending,
      sent: resolved.sent,
      completedSteps: partial.completedSteps,
      pendingSteps: partial.pendingSteps,
      permissions: fullPermissions,
    });

    expect(uploadCalls).toBe(1);
    expect(retried.document.subtests[0]?.items[0]?.images).toHaveLength(2);
    expect(retried.document.subtests[0]?.items[0]?.images[1]?.resourceId).toBe(905);
  });

  it("F3-FIX-5 (Hallazgo 3 - MEDIO): editar un baremo después de un guardado parcial (commit + 503 + recarga 503) envía PATCH sin 409", async () => {
    let baremoPostCalls = 0;
    let baremoPatchCalls = 0;
    let persistedBaremo: ReturnType<typeof makeBaremoWire> | null = null;
    let failReload = false;

    server.use(
      http.get(`${API}/tests`, () => HttpResponse.json(ok([makeTestWire(1)]))),
      http.get(`${API}/tests/1/versions`, () => HttpResponse.json(ok([makeVersionWire(10, 1)]))),
      http.get(`${API}/test-versions/10/subtests`, () => {
        if (failReload) {
          return HttpResponse.json({ success: false, message: "Recarga 503" }, { status: 503 });
        }
        return HttpResponse.json(ok([makeSubtestWire(20, 10, "MEM", "Memoria Visual", 1)]));
      }),
      http.get(`${API}/subtests/20/clone-template`, () => {
        const tpl = makeTemplateWire(20, "MEM");
        tpl.items[0]!.sourceItemId = 30;
        tpl.items[0]!.options[0]!.sourceOptionId = 40;
        tpl.items[0]!.options[1]!.sourceOptionId = 41;
        tpl.items[0]!.answerKey!.sourceAnswerKeyId = 50;
        tpl.items[0]!.answerKey!.correctOptionSourceId = 40;
        return HttpResponse.json(ok(tpl));
      }),
      http.get(`${API}/subtests/20/scoring-rules`, () =>
        HttpResponse.json(ok([makeRuleWire(80, 20, true)])),
      ),
      http.get(`${API}/test-versions/10/baremos`, () =>
        HttpResponse.json(ok(persistedBaremo ? [persistedBaremo] : [])),
      ),
      http.get(`${API}/baremos/90/ranges`, () => HttpResponse.json(ok([]))),
      http.post(`${API}/baremos`, async ({ request }) => {
        baremoPostCalls += 1;
        const body = (await request.json()) as {
          code: string;
          name: string;
          description?: string | null;
          normativeGroup?: string | null;
        };
        persistedBaremo = {
          ...makeBaremoWire(90, 10),
          codigoBaremo: body.code,
          nombre: body.name,
          descripcion: body.description ?? "",
          grupoNormativo: body.normativeGroup ?? "",
        };
        failReload = true;
        return HttpResponse.json({ success: false, message: "503 tras POST baremo" }, { status: 503 });
      }),
      http.patch(`${API}/baremos/90`, async ({ request }) => {
        baremoPatchCalls += 1;
        const body = (await request.json()) as { code: string; name: string };
        persistedBaremo = {
          ...persistedBaremo!,
          codigoBaremo: body.code,
          nombre: body.name,
        };
        return HttpResponse.json(ok(persistedBaremo));
      }),
    );

    const loaded = await loadVersionDocument(10, { testId: 1 });
    const baseline = loaded.document;
    const reducer = createDocumentReducer(makeDeterministicDraftIdFactory(1130));
    let doc = reducer(baseline, { type: "ADD_BAREMO" });
    const baremoDraftId = doc.baremos[0]!.draftId;
    doc = reducer(doc, {
      type: "UPDATE_BAREMO",
      baremoDraftId,
      patch: { code: "BAR-TOT", name: "Nombre inicial enviado" },
    });

    const firstErr = await saveVersionDocument({
      document: doc,
      pendingFiles: {},
      baselineDocument: baseline,
      baselineSignature: documentSignature(baseline),
      permissions: fullPermissions,
    }).catch((e: unknown) => e);

    expect(firstErr).toBeInstanceOf(PartialSaveError);
    const partial = firstErr as PartialSaveError;
    expect(partial.reconciliationPending).toBe(true);
    expect(baremoPostCalls).toBe(1);

    // Usuario edita el baremo antes de reintentar
    const editedAfterPartial = reducer(partial.document, {
      type: "UPDATE_BAREMO",
      baremoDraftId,
      patch: { name: "Nombre editado tras parcial" },
    });

    failReload = false;
    const retried = await saveVersionDocument({
      document: editedAfterPartial,
      pendingFiles: {},
      baselineDocument: partial.baselineDocument ?? undefined,
      baselineSignature: partial.baselineSignature,
      reconciliationPending: partial.reconciliationPending,
      sent: partial.sent,
      completedSteps: partial.completedSteps,
      pendingSteps: partial.pendingSteps,
      permissions: fullPermissions,
    });

    expect(baremoPostCalls).toBe(1);
    expect(baremoPatchCalls).toBe(1);
    expect(retried.document.baremos[0]?.name).toBe("Nombre editado tras parcial");
  });

  it("F3-FIX-5 (Hallazgo 4 - MEDIO): cambiar BAR-GEN a bar-gen genera PATCH y persiste el cambio de mayúsculas", async () => {
    let baremoCode = "BAR-GEN";
    let patchCalls = 0;

    server.use(
      http.get(`${API}/tests`, () => HttpResponse.json(ok([makeTestWire(1)]))),
      http.get(`${API}/tests/1/versions`, () => HttpResponse.json(ok([makeVersionWire(10, 1)]))),
      http.get(`${API}/test-versions/10/subtests`, () =>
        HttpResponse.json(ok([makeSubtestWire(20, 10, "MEM", "Memoria Visual", 1)])),
      ),
      http.get(`${API}/subtests/20/clone-template`, () => {
        const tpl = makeTemplateWire(20, "MEM");
        tpl.items[0]!.sourceItemId = 30;
        tpl.items[0]!.options[0]!.sourceOptionId = 40;
        tpl.items[0]!.options[1]!.sourceOptionId = 41;
        tpl.items[0]!.answerKey!.sourceAnswerKeyId = 50;
        tpl.items[0]!.answerKey!.correctOptionSourceId = 40;
        return HttpResponse.json(ok(tpl));
      }),
      http.get(`${API}/subtests/20/scoring-rules`, () =>
        HttpResponse.json(ok([makeRuleWire(80, 20, true)])),
      ),
      http.get(`${API}/test-versions/10/baremos`, () =>
        HttpResponse.json(ok([{ ...makeBaremoWire(90, 10), codigoBaremo: baremoCode }])),
      ),
      http.get(`${API}/baremos/90/ranges`, () => HttpResponse.json(ok([]))),
      http.patch(`${API}/baremos/90`, async ({ request }) => {
        patchCalls += 1;
        const body = (await request.json()) as { code: string };
        baremoCode = body.code;
        return HttpResponse.json(ok({ ...makeBaremoWire(90, 10), codigoBaremo: baremoCode }));
      }),
    );

    const loaded = await loadVersionDocument(10, { testId: 1 });
    const baseline = loaded.document;
    const reducer = createDocumentReducer(makeDeterministicDraftIdFactory(1140));
    const doc = reducer(baseline, {
      type: "UPDATE_BAREMO",
      baremoDraftId: baseline.baremos[0]!.draftId,
      patch: { code: "bar-gen" },
    });

    const saved = await saveVersionDocument({
      document: doc,
      pendingFiles: {},
      baselineDocument: baseline,
      baselineSignature: documentSignature(baseline),
      permissions: fullPermissions,
    });

    expect(patchCalls).toBe(1);
    expect(baremoCode).toBe("bar-gen");
    expect(saved.document.baremos[0]?.code).toBe("bar-gen");
  });

  it("F3-FIX-6 (Hallazgo 1 - ALTO): ítem A con opción B/C vs ítem A/B con opción C → 409 sin escrituras al borrar subtest", async () => {
    let optionText = "Opción B/C";
    let writes = 0;

    server.use(
      http.get(`${API}/tests`, () => HttpResponse.json(ok([makeTestWire(1)]))),
      http.get(`${API}/tests/1/versions`, () => HttpResponse.json(ok([makeVersionWire(10, 1)]))),
      http.get(`${API}/test-versions/10/subtests`, () =>
        HttpResponse.json(ok([makeSubtestWire(20, 10, "MEM", "Memoria Visual", 1)])),
      ),
      http.get(`${API}/subtests/20/clone-template`, () =>
        HttpResponse.json(
          ok({
            sourceSubtestId: 20,
            code: "MEM",
            name: "Memoria Visual",
            description: "Desc",
            instructions: "Inst",
            order: 1,
            timeLimitSeconds: 600,
            randomizeItems: true,
            randomizeOptions: false,
            required: true,
            strategyId: 1,
            estado: "ACTIVO",
            items: [
              {
                sourceItemId: 30,
                code: "A",
                itemType: "SOLO_TEXTO",
                responseType: "OPCION_UNICA",
                prompt: "Ítem A",
                instruction: "",
                order: 1,
                baseScore: 1,
                timeLimitSeconds: null,
                required: true,
                confidential: true,
                estado: "ACTIVO",
                images: [],
                options: [
                  {
                    sourceOptionId: 40,
                    code: "B/C",
                    text: optionText,
                    order: 1,
                    ordinalValue: 1,
                    estado: "ACTIVO",
                    images: [],
                  },
                ],
                answerKey: null,
              },
              {
                sourceItemId: 31,
                code: "A/B",
                itemType: "SOLO_TEXTO",
                responseType: "OPCION_UNICA",
                prompt: "Ítem A/B",
                instruction: "",
                order: 2,
                baseScore: 1,
                timeLimitSeconds: null,
                required: true,
                confidential: true,
                estado: "ACTIVO",
                images: [],
                options: [
                  {
                    sourceOptionId: 41,
                    code: "C",
                    text: "Opción C",
                    order: 1,
                    ordinalValue: 1,
                    estado: "ACTIVO",
                    images: [],
                  },
                ],
                answerKey: null,
              },
            ],
          }),
        ),
      ),
      http.get(`${API}/subtests/20/scoring-rules`, () =>
        HttpResponse.json(ok([makeRuleWire(80, 20, true)])),
      ),
      http.get(`${API}/test-versions/10/baremos`, () => HttpResponse.json(ok([]))),
      http.post(`${API}/test-versions/10/configuration`, () => {
        writes += 1;
        return HttpResponse.json(ok([]));
      }),
    );

    const loaded = await loadVersionDocument(10, { testId: 1 });
    const baseline = loaded.document;
    const reducer = createDocumentReducer(makeDeterministicDraftIdFactory(1300));
    const doc = reducer(baseline, {
      type: "DELETE_SUBTEST",
      subtestDraftId: "sub-20",
    });

    optionText = "Editada por otro usuario";

    const err = await saveVersionDocument({
      document: doc,
      pendingFiles: {},
      baselineDocument: baseline,
      baselineSignature: documentSignature(baseline),
      permissions: fullPermissions,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(VersionConflictError);
    expect((err as VersionConflictError).status).toBe(409);
    expect(writes).toBe(0);
  });

  it("F3-FIX-6 / F3-FIX-7b (Hallazgo 2 - ALTO): imagen reemplazada tras 503 con nombre coincidente exige resolución manual (sin PUT automático) y envía PUT by-order al elegir «Aplicar mi cambio»", async () => {
    let postCalls = 0;
    let putItemCalls = 0;
    let putOptionCalls = 0;
    let uploadedItemBody = "";
    let uploadedOptionBody = "";
    let failReload = false;

    let itemExtraImage: {
      sourceImageId: number;
      resourceId: number;
      order: number;
      altText: string;
      storagePath: string;
      role: string;
    } | null = null;
    let optExtraImage: {
      sourceImageId: number;
      resourceId: number;
      order: number;
      altText: string;
      storagePath: string;
      role: null;
    } | null = null;

    server.use(
      http.get(`${API}/tests`, () => HttpResponse.json(ok([makeTestWire(1)]))),
      http.get(`${API}/tests/1/versions`, () => HttpResponse.json(ok([makeVersionWire(10, 1)]))),
      http.get(`${API}/test-versions/10/subtests`, () => {
        if (failReload) {
          return HttpResponse.json({ success: false, message: "Recarga 503" }, { status: 503 });
        }
        return HttpResponse.json(ok([makeSubtestWire(20, 10, "MEM", "Memoria Visual", 1)]));
      }),
      http.get(`${API}/subtests/20/clone-template`, () => {
        const tpl = makeTemplateWire(20, "MEM");
        tpl.items[0]!.sourceItemId = 30;
        tpl.items[0]!.images = [
          {
            sourceImageId: 55,
            resourceId: 77,
            order: 1,
            altText: "Figura estímulo",
            storagePath: "items/1.png",
            role: "ENUNCIADO",
          },
          ...(itemExtraImage ? [itemExtraImage] : []),
        ];
        tpl.items[0]!.options[0]!.sourceOptionId = 40;
        (tpl.items[0]!.options[0] as { images: unknown[] }).images = optExtraImage ? [optExtraImage] : [];
        tpl.items[0]!.options[1]!.sourceOptionId = 41;
        tpl.items[0]!.answerKey!.sourceAnswerKeyId = 50;
        tpl.items[0]!.answerKey!.correctOptionSourceId = 40;
        return HttpResponse.json(ok(tpl));
      }),
      http.get(`${API}/subtests/20/scoring-rules`, () =>
        HttpResponse.json(ok([makeRuleWire(80, 20, true)])),
      ),
      http.get(`${API}/test-versions/10/baremos`, () => HttpResponse.json(ok([]))),
      http.post(`${API}/items/30/images`, () => {
        postCalls += 1;
        itemExtraImage = {
          sourceImageId: 88,
          resourceId: 905,
          order: 2,
          altText: "Vieja ítem",
          storagePath: "test-config/items/30/550e8400-e29b-41d4-a716-446655440000-vieja-item.png",
          role: "ENUNCIADO",
        };
        failReload = true;
        return HttpResponse.json({ success: false, message: "503 tras POST item" }, { status: 503 });
      }),
      http.post(`${API}/options/40/images`, () => {
        postCalls += 1;
        optExtraImage = {
          sourceImageId: 89,
          resourceId: 906,
          order: 1,
          altText: "Vieja opción",
          storagePath: "test-config/options/40/550e8400-e29b-41d4-a716-446655440001-vieja-opt.png",
          role: null,
        };
        failReload = true;
        return HttpResponse.json({ success: false, message: "503 tras POST opt" }, { status: 503 });
      }),
      http.put(`${API}/items/30/images/by-order/2`, async ({ request }) => {
        putItemCalls += 1;
        const bodyText = await request.text();
        uploadedItemBody = bodyText;
        itemExtraImage = {
          sourceImageId: 88,
          resourceId: 995,
          order: 2,
          altText: "Nueva ítem",
          storagePath: "test-config/items/30/550e8400-e29b-41d4-a716-446655440002-nueva-item.png",
          role: "ENUNCIADO",
        };
        return HttpResponse.json(
          ok({
            imageLinkId: 88,
            resourceId: 995,
            storagePath: "test-config/items/30/550e8400-e29b-41d4-a716-446655440002-nueva-item.png",
            filename: "nueva-item.png",
            mimeType: "image/png",
            sizeBytes: 14,
            hash: "h-new-item",
            order: 2,
            altText: "Nueva ítem",
            role: "ENUNCIADO",
          }),
        );
      }),
      http.put(`${API}/options/40/images/by-order/1`, async ({ request }) => {
        putOptionCalls += 1;
        const bodyText = await request.text();
        uploadedOptionBody = bodyText;
        optExtraImage = {
          sourceImageId: 89,
          resourceId: 996,
          order: 1,
          altText: "Nueva opción",
          storagePath: "test-config/options/40/550e8400-e29b-41d4-a716-446655440003-nueva-opt.png",
          role: null,
        };
        return HttpResponse.json(
          ok({
            imageLinkId: 89,
            resourceId: 996,
            storagePath: "test-config/options/40/550e8400-e29b-41d4-a716-446655440003-nueva-opt.png",
            filename: "nueva-opt.png",
            mimeType: "image/png",
            sizeBytes: 13,
            hash: "h-new-opt",
            order: 1,
            altText: "Nueva opción",
            role: null,
          }),
        );
      }),
    );

    const loaded = await loadVersionDocument(10, { testId: 1 });
    const baseline = loaded.document;
    const reducer = createDocumentReducer(makeDeterministicDraftIdFactory(1310));

    let doc = reducer(baseline, {
      type: "ATTACH_ITEM_IMAGE",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      image: {
        draftId: "img-item-old",
        pendingFileId: "f-item-old",
        order: 2,
        altText: "Vieja ítem",
        role: "ENUNCIADO",
        fileName: "vieja-item.png",
      },
    });
    doc = reducer(doc, {
      type: "ATTACH_OPTION_IMAGE",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      optionDraftId: "opt-40",
      image: {
        draftId: "img-opt-old",
        pendingFileId: "f-opt-old",
        order: 1,
        altText: "Vieja opción",
        fileName: "vieja-opt.png",
      },
    });

    const files1 = {
      "f-item-old": new File(["old-item"], "vieja-item.png", { type: "image/png", lastModified: 100 }),
      "f-opt-old": new File(["old-opt"], "vieja-opt.png", { type: "image/png", lastModified: 100 }),
    };

    const firstErr = await saveVersionDocument({
      document: doc,
      pendingFiles: files1,
      baselineDocument: baseline,
      baselineSignature: documentSignature(baseline),
      permissions: fullPermissions,
    }).catch((e: unknown) => e);

    expect(firstErr).toBeInstanceOf(PartialSaveError);
    const partial = firstErr as PartialSaveError;
    expect(postCalls).toBe(1);

    // El usuario elimina la imagen pendiente del ítem y adjunta un archivo nuevo en el mismo orden
    let editedDoc = reducer(partial.document, {
      type: "DELETE_ITEM_IMAGE",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      imageDraftId: "img-item-old",
    });
    editedDoc = reducer(editedDoc, {
      type: "ATTACH_ITEM_IMAGE",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      image: {
        draftId: "img-item-new",
        pendingFileId: "f-item-new",
        order: 2,
        altText: "Nueva ítem",
        role: "ENUNCIADO",
        fileName: "nueva-item.png",
      },
    });

    // También probamos PUT by-order en opción reemplazando cuando ya había una subida incierta en sent
    editedDoc = reducer(editedDoc, {
      type: "DELETE_OPTION_IMAGE",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      optionDraftId: "opt-40",
      imageDraftId: "img-opt-old",
    });
    editedDoc = reducer(editedDoc, {
      type: "ATTACH_OPTION_IMAGE",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      optionDraftId: "opt-40",
      image: {
        draftId: "img-opt-new",
        pendingFileId: "f-opt-new",
        order: 1,
        altText: "Nueva opción",
        fileName: "nueva-opt.png",
      },
    });
    optExtraImage = {
      sourceImageId: 89,
      resourceId: 906,
      order: 1,
      altText: "Vieja opción",
      storagePath: "test-config/options/40/550e8400-e29b-41d4-a716-446655440001-vieja-opt.png",
      role: null,
    };
    const sentWithBoth = structuredClone(partial.sent);
    sentWithBoth.uploads[
      JSON.stringify(["optionUpload", "sub-20", "item-30", "opt-40", 1])
    ] = {
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      optionDraftId: "opt-40",
      order: 1,
      pendingFileId: "f-opt-old",
      fileName: "vieja-opt.png",
      fileSize: 7,
      lastModified: 100,
      altText: "Vieja opción",
      role: null,
    };

    failReload = false;
    const files2 = {
      "f-item-new": new File(["new-item-bytes"], "nueva-item.png", { type: "image/png", lastModified: 200 }),
      "f-opt-new": new File(["new-opt-bytes"], "nueva-opt.png", { type: "image/png", lastModified: 200 }),
    };

    const conflictErr = await saveVersionDocument({
      document: editedDoc,
      pendingFiles: files2,
      baselineDocument: partial.baselineDocument ?? undefined,
      baselineSignature: partial.baselineSignature,
      reconciliationPending: partial.reconciliationPending,
      sent: sentWithBoth,
      completedSteps: partial.completedSteps,
      pendingSteps: partial.pendingSteps,
      permissions: fullPermissions,
    }).catch((e: unknown) => e);

    expect(conflictErr).toBeInstanceOf(VersionConflictError);
    const vErr = conflictErr as VersionConflictError;
    expect(vErr.conflicts).toHaveLength(2);
    expect(vErr.conflicts.every((c) => c.kind === "UNCERTAIN_IMAGE_OPERATION")).toBe(true);
    expect(putItemCalls).toBe(0);
    expect(putOptionCalls).toBe(0);

    // Resolver manualmente ambos conflictos eligiendo «Aplicar mi cambio»
    let resolvedDoc = editedDoc;
    let resolvedBaseline = partial.baselineDocument ?? null;
    let resolvedSent = sentWithBoth;
    for (const conflict of vErr.conflicts) {
      const next = resolveUncertainImageConflict({
        document: resolvedDoc,
        baseline: resolvedBaseline,
        sent: resolvedSent,
        resolution: conflict.resolution!,
        choice: "apply_mine",
      });
      resolvedDoc = next.document;
      resolvedBaseline = next.baseline;
      resolvedSent = next.sent;
    }

    const retried = await saveVersionDocument({
      document: resolvedDoc,
      pendingFiles: files2,
      baselineDocument: resolvedBaseline ?? undefined,
      baselineSignature: partial.baselineSignature,
      reconciliationPending: partial.reconciliationPending,
      sent: resolvedSent,
      completedSteps: partial.completedSteps,
      pendingSteps: partial.pendingSteps,
      permissions: fullPermissions,
    });

    expect(postCalls).toBe(1);
    expect(putItemCalls).toBe(1);
    expect(putOptionCalls).toBe(1);
    expect(uploadedItemBody).toContain('filename="nueva-item.png"');
    expect(uploadedItemBody).toContain("new-item-bytes");
    expect(uploadedOptionBody).toContain('filename="nueva-opt.png"');
    expect(uploadedOptionBody).toContain("new-opt-bytes");
    expect(retried.document.subtests[0]?.items[0]?.images[1]?.resourceId).toBe(995);
    expect(retried.document.subtests[0]?.items[0]?.options[0]?.images[0]?.resourceId).toBe(996);
  });

  it("F3-FIX-6 / F3-FIX-7b (Hallazgo 2 - ALTO, borrado): si mine quitó la imagen incierta con nombre coincidente, exige confirmación manual y elimina solo tras elegir «Aplicar mi cambio»", async () => {
    let deleteCalls = 0;
    let failReload = false;
    let itemExtraImage: {
      sourceImageId: number;
      resourceId: number;
      order: number;
      altText: string;
      storagePath: string;
      role: string;
    } | null = null;

    server.use(
      http.get(`${API}/tests`, () => HttpResponse.json(ok([makeTestWire(1)]))),
      http.get(`${API}/tests/1/versions`, () => HttpResponse.json(ok([makeVersionWire(10, 1)]))),
      http.get(`${API}/test-versions/10/subtests`, () => {
        if (failReload) {
          return HttpResponse.json({ success: false, message: "Recarga 503" }, { status: 503 });
        }
        return HttpResponse.json(ok([makeSubtestWire(20, 10, "MEM", "Memoria Visual", 1)]));
      }),
      http.get(`${API}/subtests/20/clone-template`, () => {
        const tpl = makeTemplateWire(20, "MEM");
        tpl.items[0]!.sourceItemId = 30;
        tpl.items[0]!.images = [
          {
            sourceImageId: 55,
            resourceId: 77,
            order: 1,
            altText: "Figura estímulo",
            storagePath: "items/1.png",
            role: "ENUNCIADO",
          },
          ...(itemExtraImage ? [itemExtraImage] : []),
        ];
        tpl.items[0]!.options[0]!.sourceOptionId = 40;
        tpl.items[0]!.options[1]!.sourceOptionId = 41;
        tpl.items[0]!.answerKey!.sourceAnswerKeyId = 50;
        tpl.items[0]!.answerKey!.correctOptionSourceId = 40;
        return HttpResponse.json(ok(tpl));
      }),
      http.get(`${API}/subtests/20/scoring-rules`, () =>
        HttpResponse.json(ok([makeRuleWire(80, 20, true)])),
      ),
      http.get(`${API}/test-versions/10/baremos`, () => HttpResponse.json(ok([]))),
      http.post(`${API}/items/30/images`, () => {
        itemExtraImage = {
          sourceImageId: 88,
          resourceId: 905,
          order: 2,
          altText: "Vieja ítem",
          storagePath: "test-config/items/30/550e8400-e29b-41d4-a716-446655440000-vieja-item.png",
          role: "ENUNCIADO",
        };
        failReload = true;
        return HttpResponse.json({ success: false, message: "503 tras POST item" }, { status: 503 });
      }),
      http.delete(`${API}/items/images/88`, () => {
        deleteCalls += 1;
        itemExtraImage = null;
        return HttpResponse.json(ok(null));
      }),
    );

    const loaded = await loadVersionDocument(10, { testId: 1 });
    const baseline = loaded.document;
    const reducer = createDocumentReducer(makeDeterministicDraftIdFactory(1320));
    const doc = reducer(baseline, {
      type: "ATTACH_ITEM_IMAGE",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      image: {
        draftId: "img-item-old",
        pendingFileId: "f-item-old",
        order: 2,
        altText: "Vieja ítem",
        role: "ENUNCIADO",
        fileName: "vieja-item.png",
      },
    });

    const firstErr = await saveVersionDocument({
      document: doc,
      pendingFiles: {
        "f-item-old": new File(["old-item"], "vieja-item.png", { type: "image/png" }),
      },
      baselineDocument: baseline,
      baselineSignature: documentSignature(baseline),
      permissions: fullPermissions,
    }).catch((e: unknown) => e);

    expect(firstErr).toBeInstanceOf(PartialSaveError);
    const partial = firstErr as PartialSaveError;

    const deletedDoc = reducer(partial.document, {
      type: "DELETE_ITEM_IMAGE",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      imageDraftId: "img-item-old",
    });

    failReload = false;
    const conflictErr = await saveVersionDocument({
      document: deletedDoc,
      pendingFiles: {},
      baselineDocument: partial.baselineDocument ?? undefined,
      baselineSignature: partial.baselineSignature,
      reconciliationPending: partial.reconciliationPending,
      sent: partial.sent,
      completedSteps: partial.completedSteps,
      pendingSteps: partial.pendingSteps,
      permissions: fullPermissions,
    }).catch((e: unknown) => e);

    expect(conflictErr).toBeInstanceOf(VersionConflictError);
    const vErr = conflictErr as VersionConflictError;
    expect(vErr.conflicts).toHaveLength(1);
    expect(vErr.conflicts[0]?.kind).toBe("UNCERTAIN_IMAGE_OPERATION");
    expect(deleteCalls).toBe(0);

    const resolved = resolveUncertainImageConflict({
      document: deletedDoc,
      baseline: partial.baselineDocument,
      sent: partial.sent,
      resolution: vErr.conflicts[0]!.resolution!,
      choice: "apply_mine",
    });

    const retried = await saveVersionDocument({
      document: resolved.document,
      pendingFiles: {},
      baselineDocument: resolved.baseline ?? undefined,
      baselineSignature: partial.baselineSignature,
      reconciliationPending: partial.reconciliationPending,
      sent: resolved.sent,
      completedSteps: partial.completedSteps,
      pendingSteps: partial.pendingSteps,
      permissions: fullPermissions,
    });

    expect(deleteCalls).toBe(1);
    expect(retried.document.subtests[0]?.items[0]?.images).toHaveLength(1);
  });

  it("F3-FIX-7b (ALTO variante 1 - quitar): POST incierto no aplicado + imagen ajena en mismo orden → 409 externo y nunca DELETE ajeno", async () => {
    let deleteCalls = 0;
    let failReload = false;
    let ajenaImage: {
      sourceImageId: number;
      resourceId: number;
      order: number;
      altText: string;
      storagePath: string;
      role: string;
    } | null = null;

    server.use(
      http.get(`${API}/tests`, () => HttpResponse.json(ok([makeTestWire(1)]))),
      http.get(`${API}/tests/1/versions`, () => HttpResponse.json(ok([makeVersionWire(10, 1)]))),
      http.get(`${API}/test-versions/10/subtests`, () => {
        if (failReload) {
          return HttpResponse.json({ success: false, message: "Recarga 503" }, { status: 503 });
        }
        return HttpResponse.json(ok([makeSubtestWire(20, 10, "MEM", "Memoria Visual", 1)]));
      }),
      http.get(`${API}/subtests/20/clone-template`, () => {
        const tpl = makeTemplateWire(20, "MEM");
        tpl.items[0]!.sourceItemId = 30;
        tpl.items[0]!.images = [
          {
            sourceImageId: 55,
            resourceId: 77,
            order: 1,
            altText: "Figura estímulo",
            storagePath: "items/1.png",
            role: "ENUNCIADO",
          },
          ...(ajenaImage ? [ajenaImage] : []),
        ];
        tpl.items[0]!.options[0]!.sourceOptionId = 40;
        tpl.items[0]!.options[1]!.sourceOptionId = 41;
        tpl.items[0]!.answerKey!.sourceAnswerKeyId = 50;
        tpl.items[0]!.answerKey!.correctOptionSourceId = 40;
        return HttpResponse.json(ok(tpl));
      }),
      http.get(`${API}/subtests/20/scoring-rules`, () =>
        HttpResponse.json(ok([makeRuleWire(80, 20, true)])),
      ),
      http.get(`${API}/test-versions/10/baremos`, () => HttpResponse.json(ok([]))),
      http.post(`${API}/items/30/images`, () => {
        // POST NO se aplicó, pero otro editor subió ajena.png en el mismo orden
        ajenaImage = {
          sourceImageId: 99,
          resourceId: 920,
          order: 2,
          altText: "Imagen ajena",
          storagePath: "test-config/items/30/550e8400-e29b-41d4-a716-446655440000-ajena.png",
          role: "ENUNCIADO",
        };
        failReload = true;
        return HttpResponse.json({ success: false, message: "503 sin aplicar" }, { status: 503 });
      }),
      http.delete(`${API}/items/images/99`, () => {
        deleteCalls += 1;
        return HttpResponse.json(ok(null));
      }),
    );

    const loaded = await loadVersionDocument(10, { testId: 1 });
    const baseline = loaded.document;
    const reducer = createDocumentReducer(makeDeterministicDraftIdFactory(1440));
    const doc = reducer(baseline, {
      type: "ATTACH_ITEM_IMAGE",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      image: {
        draftId: "img-a",
        pendingFileId: "f-a",
        order: 2,
        altText: "Mi imagen",
        role: "ENUNCIADO",
        fileName: "a.png",
      },
    });

    const partial = (await saveVersionDocument({
      document: doc,
      pendingFiles: { "f-a": new File(["a"], "a.png", { type: "image/png" }) },
      baselineDocument: baseline,
      baselineSignature: documentSignature(baseline),
      permissions: fullPermissions,
    }).catch((e: unknown) => e)) as PartialSaveError;

    const removedDoc = reducer(partial.document, {
      type: "DELETE_ITEM_IMAGE",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      imageDraftId: "img-a",
    });

    failReload = false;
    const err = await saveVersionDocument({
      document: removedDoc,
      pendingFiles: {},
      baselineDocument: partial.baselineDocument ?? undefined,
      baselineSignature: partial.baselineSignature,
      reconciliationPending: partial.reconciliationPending,
      sent: partial.sent,
      completedSteps: partial.completedSteps,
      pendingSteps: partial.pendingSteps,
      permissions: fullPermissions,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(VersionConflictError);
    const vErr = err as VersionConflictError;
    expect(vErr.conflicts).toHaveLength(1);
    expect(vErr.conflicts[0]?.kind).toBe("image");
    expect(vErr.conflicts[0]?.reason).toBe("Otro usuario adjuntó una imagen en el servidor.");
    expect(deleteCalls).toBe(0);
  });

  it("F3-FIX-7b (ALTO variante 2 - reemplazar): POST incierto no aplicado + imagen ajena en mismo orden → 409 externo y nunca PUT sobre recurso ajeno", async () => {
    let putCalls = 0;
    let failReload = false;
    let ajenaImage: {
      sourceImageId: number;
      resourceId: number;
      order: number;
      altText: string;
      storagePath: string;
      role: string;
    } | null = null;

    server.use(
      http.get(`${API}/tests`, () => HttpResponse.json(ok([makeTestWire(1)]))),
      http.get(`${API}/tests/1/versions`, () => HttpResponse.json(ok([makeVersionWire(10, 1)]))),
      http.get(`${API}/test-versions/10/subtests`, () => {
        if (failReload) {
          return HttpResponse.json({ success: false, message: "Recarga 503" }, { status: 503 });
        }
        return HttpResponse.json(ok([makeSubtestWire(20, 10, "MEM", "Memoria Visual", 1)]));
      }),
      http.get(`${API}/subtests/20/clone-template`, () => {
        const tpl = makeTemplateWire(20, "MEM");
        tpl.items[0]!.sourceItemId = 30;
        tpl.items[0]!.images = [
          {
            sourceImageId: 55,
            resourceId: 77,
            order: 1,
            altText: "Figura estímulo",
            storagePath: "items/1.png",
            role: "ENUNCIADO",
          },
          ...(ajenaImage ? [ajenaImage] : []),
        ];
        tpl.items[0]!.options[0]!.sourceOptionId = 40;
        tpl.items[0]!.options[1]!.sourceOptionId = 41;
        tpl.items[0]!.answerKey!.sourceAnswerKeyId = 50;
        tpl.items[0]!.answerKey!.correctOptionSourceId = 40;
        return HttpResponse.json(ok(tpl));
      }),
      http.get(`${API}/subtests/20/scoring-rules`, () =>
        HttpResponse.json(ok([makeRuleWire(80, 20, true)])),
      ),
      http.get(`${API}/test-versions/10/baremos`, () => HttpResponse.json(ok([]))),
      http.post(`${API}/items/30/images`, () => {
        ajenaImage = {
          sourceImageId: 99,
          resourceId: 920,
          order: 2,
          altText: "Imagen ajena",
          storagePath: "test-config/items/30/550e8400-e29b-41d4-a716-446655440000-ajena.png",
          role: "ENUNCIADO",
        };
        failReload = true;
        return HttpResponse.json({ success: false, message: "503 sin aplicar" }, { status: 503 });
      }),
      http.put(`${API}/items/30/images/by-order/2`, () => {
        putCalls += 1;
        return HttpResponse.json(ok({}));
      }),
    );

    const loaded = await loadVersionDocument(10, { testId: 1 });
    const baseline = loaded.document;
    const reducer = createDocumentReducer(makeDeterministicDraftIdFactory(1450));
    const doc = reducer(baseline, {
      type: "ATTACH_ITEM_IMAGE",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      image: {
        draftId: "img-a",
        pendingFileId: "f-a",
        order: 2,
        altText: "Mi imagen A",
        role: "ENUNCIADO",
        fileName: "a.png",
      },
    });

    const partial = (await saveVersionDocument({
      document: doc,
      pendingFiles: { "f-a": new File(["a"], "a.png", { type: "image/png" }) },
      baselineDocument: baseline,
      baselineSignature: documentSignature(baseline),
      permissions: fullPermissions,
    }).catch((e: unknown) => e)) as PartialSaveError;

    let replacedDoc = reducer(partial.document, {
      type: "DELETE_ITEM_IMAGE",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      imageDraftId: "img-a",
    });
    replacedDoc = reducer(replacedDoc, {
      type: "ATTACH_ITEM_IMAGE",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      image: {
        draftId: "img-b",
        pendingFileId: "f-b",
        order: 2,
        altText: "Mi imagen B",
        role: "ENUNCIADO",
        fileName: "b.png",
      },
    });

    failReload = false;
    const err = await saveVersionDocument({
      document: replacedDoc,
      pendingFiles: { "f-b": new File(["b"], "b.png", { type: "image/png" }) },
      baselineDocument: partial.baselineDocument ?? undefined,
      baselineSignature: partial.baselineSignature,
      reconciliationPending: partial.reconciliationPending,
      sent: partial.sent,
      completedSteps: partial.completedSteps,
      pendingSteps: partial.pendingSteps,
      permissions: fullPermissions,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(VersionConflictError);
    const vErr = err as VersionConflictError;
    expect(vErr.conflicts).toHaveLength(1);
    expect(vErr.conflicts[0]?.kind).toBe("image");
    expect(vErr.conflicts[0]?.reason).toBe("Otra imagen distinta ocupa el mismo orden en el servidor.");
    expect(putCalls).toBe(0);
  });

  it("F3-FIX-7b (MEDIO): PUT incierto aplicado + recarga 503 + borrado antes de reintentar → UNCERTAIN_IMAGE_OPERATION y permite borrar o conservar", async () => {
    let deleteCalls = 0;
    let failReload = false;
    let serverImage: {
      sourceImageId: number;
      resourceId: number;
      order: number;
      altText: string;
      storagePath: string;
      role: string;
    } | null = {
      sourceImageId: 55,
      resourceId: 77,
      order: 1,
      altText: "Figura estímulo",
      storagePath: "test-config/items/30/550e8400-e29b-41d4-a716-446655440000-estimulo.png",
      role: "ENUNCIADO",
    };

    server.use(
      http.get(`${API}/tests`, () => HttpResponse.json(ok([makeTestWire(1)]))),
      http.get(`${API}/tests/1/versions`, () => HttpResponse.json(ok([makeVersionWire(10, 1)]))),
      http.get(`${API}/test-versions/10/subtests`, () => {
        if (failReload) {
          return HttpResponse.json({ success: false, message: "Recarga 503" }, { status: 503 });
        }
        return HttpResponse.json(ok([makeSubtestWire(20, 10, "MEM", "Memoria Visual", 1)]));
      }),
      http.get(`${API}/subtests/20/clone-template`, () => {
        const tpl = makeTemplateWire(20, "MEM");
        tpl.items[0]!.sourceItemId = 30;
        tpl.items[0]!.images = serverImage ? [serverImage] : [];
        tpl.items[0]!.options[0]!.sourceOptionId = 40;
        tpl.items[0]!.options[1]!.sourceOptionId = 41;
        tpl.items[0]!.answerKey!.sourceAnswerKeyId = 50;
        tpl.items[0]!.answerKey!.correctOptionSourceId = 40;
        return HttpResponse.json(ok(tpl));
      }),
      http.get(`${API}/subtests/20/scoring-rules`, () =>
        HttpResponse.json(ok([makeRuleWire(80, 20, true)])),
      ),
      http.get(`${API}/test-versions/10/baremos`, () => HttpResponse.json(ok([]))),
      http.put(`${API}/items/30/images/by-order/1`, () => {
        serverImage = {
          sourceImageId: 55,
          resourceId: 995,
          order: 1,
          altText: "Figura estímulo",
          storagePath: "test-config/items/30/550e8400-e29b-41d4-a716-446655440001-nueva.png",
          role: "ENUNCIADO",
        };
        failReload = true;
        return HttpResponse.json({ success: false, message: "503 tras PUT" }, { status: 503 });
      }),
      http.delete(`${API}/items/images/55`, () => {
        deleteCalls += 1;
        serverImage = null;
        return HttpResponse.json(ok(null));
      }),
    );

    const loaded = await loadVersionDocument(10, { testId: 1 });
    const baseline = loaded.document;
    const reducer = createDocumentReducer(makeDeterministicDraftIdFactory(1460));
    const docWithReplace = reducer(baseline, {
      type: "UPDATE_ITEM_IMAGE",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      imageDraftId: "img-55",
      patch: {
        resourceId: null,
        pendingFileId: "f-new",
        fileName: "nueva.png",
      },
    });

    const partial = (await saveVersionDocument({
      document: docWithReplace,
      pendingFiles: { "f-new": new File(["new"], "nueva.png", { type: "image/png" }) },
      baselineDocument: baseline,
      baselineSignature: documentSignature(baseline),
      permissions: fullPermissions,
    }).catch((e: unknown) => e)) as PartialSaveError;

    expect(partial).toBeInstanceOf(PartialSaveError);

    const deletedBeforeRetry = reducer(partial.document, {
      type: "DELETE_ITEM_IMAGE",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      imageDraftId: "img-55",
    });

    failReload = false;
    const err = await saveVersionDocument({
      document: deletedBeforeRetry,
      pendingFiles: {},
      baselineDocument: partial.baselineDocument ?? undefined,
      baselineSignature: partial.baselineSignature,
      reconciliationPending: partial.reconciliationPending,
      sent: partial.sent,
      completedSteps: partial.completedSteps,
      pendingSteps: partial.pendingSteps,
      permissions: fullPermissions,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(VersionConflictError);
    const vErr = err as VersionConflictError;
    expect(vErr.conflicts).toHaveLength(1);
    expect(vErr.conflicts[0]?.kind).toBe("UNCERTAIN_IMAGE_OPERATION");
    expect(vErr.conflicts[0]?.reason).not.toMatch(/modificada externamente/i);
    expect(deleteCalls).toBe(0);

    // Opción 1: «Conservar la imagen del servidor» → guarda limpio sin DELETE
    const kept = resolveUncertainImageConflict({
      document: deletedBeforeRetry,
      baseline: partial.baselineDocument,
      sent: partial.sent,
      resolution: vErr.conflicts[0]!.resolution!,
      choice: "keep_server",
    });
    const savedKept = await saveVersionDocument({
      document: kept.document,
      pendingFiles: {},
      baselineDocument: kept.baseline ?? undefined,
      baselineSignature: partial.baselineSignature,
      reconciliationPending: partial.reconciliationPending,
      sent: kept.sent,
      completedSteps: partial.completedSteps,
      pendingSteps: partial.pendingSteps,
      permissions: fullPermissions,
    });
    expect(deleteCalls).toBe(0);
    expect(savedKept.document.subtests[0]?.items[0]?.images[0]?.resourceId).toBe(995);

    // Opción 2: «Aplicar mi cambio» → ejecuta DELETE /items/images/55
    const applied = resolveUncertainImageConflict({
      document: deletedBeforeRetry,
      baseline: partial.baselineDocument,
      sent: partial.sent,
      resolution: vErr.conflicts[0]!.resolution!,
      choice: "apply_mine",
    });
    const savedDeleted = await saveVersionDocument({
      document: applied.document,
      pendingFiles: {},
      baselineDocument: applied.baseline ?? undefined,
      baselineSignature: partial.baselineSignature,
      reconciliationPending: partial.reconciliationPending,
      sent: applied.sent,
      completedSteps: partial.completedSteps,
      pendingSteps: partial.pendingSteps,
      permissions: fullPermissions,
    });
    expect(deleteCalls).toBe(1);
    expect(savedDeleted.document.subtests[0]?.items[0]?.images).toHaveLength(0);
  });

  it("F3-FIX-6 (Hallazgo 3 - MEDIO): cambiar BAR-TOT a bar-tot tras 503 adopta el id y envía PATCH con bar-tot sin 409", async () => {
    let baremoPostCalls = 0;
    let baremoPatchCalls = 0;
    let patchedCode = "";
    let persistedBaremo: ReturnType<typeof makeBaremoWire> | null = null;
    let failReload = false;

    server.use(
      http.get(`${API}/tests`, () => HttpResponse.json(ok([makeTestWire(1)]))),
      http.get(`${API}/tests/1/versions`, () => HttpResponse.json(ok([makeVersionWire(10, 1)]))),
      http.get(`${API}/test-versions/10/subtests`, () => {
        if (failReload) {
          return HttpResponse.json({ success: false, message: "Recarga 503" }, { status: 503 });
        }
        return HttpResponse.json(ok([makeSubtestWire(20, 10, "MEM", "Memoria Visual", 1)]));
      }),
      http.get(`${API}/subtests/20/clone-template`, () => {
        const tpl = makeTemplateWire(20, "MEM");
        tpl.items[0]!.sourceItemId = 30;
        tpl.items[0]!.options[0]!.sourceOptionId = 40;
        tpl.items[0]!.options[1]!.sourceOptionId = 41;
        tpl.items[0]!.answerKey!.sourceAnswerKeyId = 50;
        tpl.items[0]!.answerKey!.correctOptionSourceId = 40;
        return HttpResponse.json(ok(tpl));
      }),
      http.get(`${API}/subtests/20/scoring-rules`, () =>
        HttpResponse.json(ok([makeRuleWire(80, 20, true)])),
      ),
      http.get(`${API}/test-versions/10/baremos`, () =>
        HttpResponse.json(ok(persistedBaremo ? [persistedBaremo] : [])),
      ),
      http.get(`${API}/baremos/90/ranges`, () => HttpResponse.json(ok([]))),
      http.post(`${API}/baremos`, async ({ request }) => {
        baremoPostCalls += 1;
        const body = (await request.json()) as {
          code: string;
          name: string;
          description?: string | null;
          normativeGroup?: string | null;
        };
        persistedBaremo = {
          ...makeBaremoWire(90, 10),
          codigoBaremo: body.code,
          nombre: body.name,
          descripcion: body.description ?? "",
          grupoNormativo: body.normativeGroup ?? "",
        };
        failReload = true;
        return HttpResponse.json({ success: false, message: "503 tras POST baremo" }, { status: 503 });
      }),
      http.patch(`${API}/baremos/90`, async ({ request }) => {
        baremoPatchCalls += 1;
        const body = (await request.json()) as { code: string; name: string };
        patchedCode = body.code;
        persistedBaremo = {
          ...persistedBaremo!,
          codigoBaremo: body.code,
          nombre: body.name,
        };
        return HttpResponse.json(ok(persistedBaremo));
      }),
    );

    const loaded = await loadVersionDocument(10, { testId: 1 });
    const baseline = loaded.document;
    const reducer = createDocumentReducer(makeDeterministicDraftIdFactory(1330));
    let doc = reducer(baseline, { type: "ADD_BAREMO" });
    const baremoDraftId = doc.baremos[0]!.draftId;
    doc = reducer(doc, {
      type: "UPDATE_BAREMO",
      baremoDraftId,
      patch: { code: "BAR-TOT", name: "Baremo total" },
    });

    const firstErr = await saveVersionDocument({
      document: doc,
      pendingFiles: {},
      baselineDocument: baseline,
      baselineSignature: documentSignature(baseline),
      permissions: fullPermissions,
    }).catch((e: unknown) => e);

    expect(firstErr).toBeInstanceOf(PartialSaveError);
    const partial = firstErr as PartialSaveError;

    // Usuario cambia el código de BAR-TOT a bar-tot antes de reintentar
    const renamedAfterPartial = reducer(partial.document, {
      type: "UPDATE_BAREMO",
      baremoDraftId,
      patch: { code: "bar-tot" },
    });

    failReload = false;
    const retried = await saveVersionDocument({
      document: renamedAfterPartial,
      pendingFiles: {},
      baselineDocument: partial.baselineDocument ?? undefined,
      baselineSignature: partial.baselineSignature,
      reconciliationPending: partial.reconciliationPending,
      sent: partial.sent,
      completedSteps: partial.completedSteps,
      pendingSteps: partial.pendingSteps,
      permissions: fullPermissions,
    });

    expect(baremoPostCalls).toBe(1);
    expect(baremoPatchCalls).toBe(1);
    expect(patchedCode).toBe("bar-tot");
    expect(retried.document.baremos[0]?.id).toBe(90);
    expect(retried.document.baremos[0]?.code).toBe("bar-tot");
  });
});

describe("cloneVersionFromSource", () => {
  function setupSourceHandlers(options: {
    onConfig?: (payload: unknown) => void;
    onRulePost?: (subtestId: number) => void;
    onBaremoPost?: () => void;
  } = {}) {
    let configCount = 0;
    server.use(
      http.get(`${API}/tests`, () => HttpResponse.json(ok([makeTestWire(1)]))),
      http.get(`${API}/tests/1/versions`, () => HttpResponse.json(ok([makeVersionWire(10, 1)]))),
      http.get(`${API}/test-versions/10/subtests`, () =>
        HttpResponse.json(ok([makeSubtestWire(20, 10, "MEM", "Memoria", 1)])),
      ),
      http.get(`${API}/subtests/20/clone-template`, () =>
        HttpResponse.json(ok(makeTemplateWire(20, "MEM"))),
      ),
      http.get(`${API}/subtests/20/scoring-rules`, () =>
        HttpResponse.json(ok([makeRuleWire(80, 20, true)])),
      ),
      http.get(`${API}/test-versions/10/baremos`, () =>
        HttpResponse.json(ok([makeBaremoWire(90, 10)])),
      ),
      http.get(`${API}/baremos/90/ranges`, () =>
        HttpResponse.json(ok([makeRangeWire(100, 90)])),
      ),
      http.post(`${API}/tests/1/versions`, () =>
        HttpResponse.json(ok(makeVersionWire(200, 1, "BORRADOR", 1))),
      ),
      http.post(`${API}/test-versions/200/configuration`, async ({ request }) => {
        configCount += 1;
        options.onConfig?.(await request.json());
        return HttpResponse.json(ok([makeSubtestWire(300, 200, "MEM", "Memoria", 1)]));
      }),
      http.post(`${API}/subtests/300/scoring-rules`, () => {
        options.onRulePost?.(300);
        return HttpResponse.json(ok(makeRuleWire(999, 300, true)));
      }),
      http.get(`${API}/subtests/300/clone-template`, () =>
        HttpResponse.json(ok(makeTemplateWire(300, "MEM", { includeKey: false }))),
      ),
      http.post(`${API}/baremos`, () => {
        options.onBaremoPost?.();
        return HttpResponse.json(ok(makeBaremoWire(400, 200)));
      }),
      http.post(`${API}/baremos/400/ranges`, () =>
        HttpResponse.json(ok(makeRangeWire(500, 400))),
      ),
    );
    return () => configCount;
  }

  it("clona en 2 pasadas creando regla nueva en destino, conserva resourceId y copia baremos/rangos", async () => {
    const configPayloads: unknown[] = [];
    const ruleTargets: number[] = [];
    let baremosCreated = 0;

    setupSourceHandlers({
      onConfig: (p) => configPayloads.push(p),
      onRulePost: (id) => ruleTargets.push(id),
      onBaremoPost: () => {
        baremosCreated += 1;
      },
    });

    const result = await cloneVersionFromSource({
      testId: 1,
      sourceVersionId: 10,
      versionPayload: { number: "2.0", strategyId: 1 },
      permissions: fullPermissions,
    });

    expect(result.status).toBe("cloned");
    if (result.status !== "cloned") throw new Error("Expected cloned");
    expect(result.version.id).toBe(200);
    expect(result.copiedAnswerKeys).toBe(true);
    expect(result.copiedBaremos).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(ruleTargets).toEqual([300]);
    expect(baremosCreated).toBe(1);
    expect(configPayloads).toHaveLength(2);

    // Pass 1 conserva resourceId y omite answerKey (nunca reutiliza ruleId=80 de origen)
    const pass1 = configPayloads[0] as {
      subtests: Array<{
        items: Array<{ images: Array<{ resourceId: number }>; answerKey?: unknown }>;
      }>;
    };
    expect(pass1.subtests[0]?.items[0]?.images[0]?.resourceId).toBe(77);
    expect(pass1.subtests[0]?.items[0]?.answerKey).toBeUndefined();

    // Pass 2 usa la regla nueva (999) y la opción nueva (3010)
    const pass2 = configPayloads[1] as {
      subtests: Array<{
        id: number;
        items: Array<{
          id: number;
          images: unknown[];
          options: unknown[];
          answerKey: { ruleId: number; correctOptionId: number };
        }>;
      }>;
    };
    expect(pass2.subtests[0]?.id).toBe(300);
    expect(pass2.subtests[0]?.items[0]?.id).toBe(3001);
    expect(pass2.subtests[0]?.items[0]?.images).toEqual([]);
    expect(pass2.subtests[0]?.items[0]?.options).toEqual([]);
    expect(pass2.subtests[0]?.items[0]?.answerKey).toMatchObject({
      ruleId: 999,
      correctOptionId: 30010,
    });
  });

  it("emite warnings sin hacer peticiones prohibidas cuando faltan CALIFICACION_CONFIGURAR o BAREMO_CONFIGURAR", async () => {
    let scoringCalled = false;
    let baremoCalled = false;
    const getConfigCount = setupSourceHandlers({
      onRulePost: () => {
        scoringCalled = true;
      },
      onBaremoPost: () => {
        baremoCalled = true;
      },
    });

    const result = await cloneVersionFromSource({
      testId: 1,
      sourceVersionId: 10,
      versionPayload: { number: "2.0", strategyId: 1 },
      permissions: {
        canEdit: true,
        canConfigureScoring: false,
        canConfigureBaremos: false,
      },
    });

    expect(scoringCalled).toBe(false);
    expect(baremoCalled).toBe(false);
    expect(getConfigCount()).toBe(1);
    expect(result.status).toBe("cloned");
    if (result.status !== "cloned") throw new Error("Expected cloned");
    expect(result.copiedAnswerKeys).toBe(false);
    expect(result.copiedBaremos).toBe(false);
    expect(result.warnings).toHaveLength(2);
  });

  it("ALTO 2: preserva tipo, prioridad, parámetros y reasigna claves; detecta reglas o parámetros no copiables en preflight", async () => {
    const createdRuleBodies: Array<{
      strategyId: number;
      ruleType: string;
      itemId?: number | null;
      priority?: number | null;
      parametersJson?: string | null;
      observation?: string | null;
    }> = [];
    const configPayloads: unknown[] = [];

    server.use(
      http.get(`${API}/tests`, () => HttpResponse.json(ok([makeTestWire(1)]))),
      http.get(`${API}/tests/1/versions`, () => HttpResponse.json(ok([makeVersionWire(10, 1)]))),
      http.get(`${API}/test-versions/10/subtests`, () =>
        HttpResponse.json(ok([makeSubtestWire(20, 10, "NUM", "Numérico", 1)])),
      ),
      http.get(`${API}/subtests/20/clone-template`, () => {
        const baseTpl = makeTemplateWire(20, "NUM");
        return HttpResponse.json(
          ok({
            ...baseTpl,
            items: [
              {
                ...baseTpl.items[0]!,
                responseType: "NUMERICA",
                answerKey: {
                  sourceAnswerKeyId: 2050,
                  sourceRuleId: 81,
                  correctOptionSourceId: null,
                  expectedText: null,
                  expectedNumber: 42,
                  numericTolerance: 0.5,
                  score: 1,
                  requiresManualReview: false,
                },
              },
            ],
          }),
        );
      }),
      http.get(`${API}/subtests/20/scoring-rules`, () =>
        HttpResponse.json(
          ok([
            {
              ...makeRuleWire(81, 20, true, "NUMERICA_RANGO"),
              estrategiaCalificacionId: 4,
              prioridad: 3,
              parametros: '{"min":0,"max":100,"inclusive":true}',
              observacion: "Rango numérico válido",
            },
            {
              ...makeRuleWire(82, 20, true, "OPCION_DIMENSION"),
              prioridad: 2,
              parametros: "{}",
            },
            {
              ...makeRuleWire(83, 20, true, "FORMULA"),
              prioridad: 4,
              parametros: '{"dimensionId":12}',
            },
          ]),
        ),
      ),
      http.get(`${API}/test-versions/10/baremos`, () => HttpResponse.json(ok([]))),
      http.post(`${API}/tests/1/versions`, () =>
        HttpResponse.json(ok(makeVersionWire(200, 1, "BORRADOR", 1))),
      ),
      http.post(`${API}/test-versions/200/configuration`, async ({ request }) => {
        configPayloads.push(await request.json());
        return HttpResponse.json(ok([makeSubtestWire(300, 200, "NUM", "Numérico", 1)]));
      }),
      http.get(`${API}/subtests/300/clone-template`, () => {
        const tpl = makeTemplateWire(300, "NUM", { includeKey: false });
        tpl.items[0]!.responseType = "NUMERICA";
        return HttpResponse.json(ok(tpl));
      }),
      http.post(`${API}/subtests/300/scoring-rules`, async ({ request }) => {
        const body = (await request.json()) as (typeof createdRuleBodies)[number];
        createdRuleBodies.push(body);
        return HttpResponse.json(
          ok({
            ...makeRuleWire(777, 300, true, body.ruleType),
            estrategiaCalificacionId: body.strategyId,
            prioridad: body.priority ?? 1,
            parametros: body.parametersJson ?? "{}",
            observacion: body.observation ?? null,
          }),
        );
      }),
    );

    const plan = await inspectVersionClonePlan(1, 10);
    expect(plan.copiableRules.map((r) => r.rule.id)).toEqual([81]);
    expect(plan.omittedRules.map((r) => [r.rule.id, r.rule.ruleType])).toEqual([
      [82, "OPCION_DIMENSION"],
      [83, "FORMULA"],
    ]);
    expect(plan.hasOmissions).toBe(true);

    const result = await cloneVersionFromSource({
      testId: 1,
      sourceVersionId: 10,
      versionPayload: { number: "2.0", strategyId: 1 },
      permissions: fullPermissions,
    });

    expect(createdRuleBodies).toEqual([
      {
        strategyId: 4,
        ruleType: "NUMERICA_RANGO",
        itemId: null,
        priority: 3,
        parametersJson: '{"min":0,"max":100,"inclusive":true}',
        observation: "Rango numérico válido",
      },
    ]);
    const pass2 = configPayloads[1] as {
      subtests: Array<{ items: Array<{ answerKey: { ruleId: number; expectedNumber: number } }> }>;
    };
    expect(pass2.subtests[0]?.items[0]?.answerKey).toMatchObject({
      ruleId: 777,
      expectedNumber: 42,
    });
    expect(result.status).toBe("cloned");
    if (result.status !== "cloned") throw new Error("Expected cloned");
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings.join(" ")).toContain("OPCION_DIMENSION");
    expect(result.warnings.join(" ")).toContain("dimensionId");
  });

  it("MEDIO 4: con datos semilla, detecta baremos por dimensión antes de clonar, los omite sin fallar y copia el baremo total", async () => {
    const createdBaremoPayloads: Array<{ dimensionId?: number | null; code: string }> = [];

    server.use(
      http.get(`${API}/tests`, () => HttpResponse.json(ok([makeTestWire(1, "BFA", "Batería Factorial")]))),
      http.get(`${API}/tests/1/versions`, () => HttpResponse.json(ok([makeVersionWire(1, 1, "PUBLICADO", 1)]))),
      http.get(`${API}/test-versions/1/subtests`, () =>
        HttpResponse.json(
          ok([
            makeSubtestWire(1, 1, "FI", "Figuras idénticas", 1),
            makeSubtestWire(2, 1, "DES", "Desplazamiento", 2),
          ]),
        ),
      ),
      http.get(`${API}/subtests/1/clone-template`, () => {
        const tpl = makeTemplateWire(1, "FI");
        tpl.items[0]!.answerKey!.sourceRuleId = 1;
        return HttpResponse.json(ok(tpl));
      }),
      http.get(`${API}/subtests/2/clone-template`, () => {
        const tpl = makeTemplateWire(2, "DES");
        tpl.items[0]!.answerKey!.sourceRuleId = 2;
        return HttpResponse.json(ok(tpl));
      }),
      http.get(`${API}/subtests/1/scoring-rules`, () =>
        HttpResponse.json(ok([makeRuleWire(1, 1, true)])),
      ),
      http.get(`${API}/subtests/2/scoring-rules`, () =>
        HttpResponse.json(ok([makeRuleWire(2, 2, true)])),
      ),
      http.get(`${API}/test-versions/1/baremos`, () =>
        HttpResponse.json(
          ok([
            { ...makeBaremoWire(1, 1), dimensionResultadoId: 1, codigoBaremo: "BAR-FI", nombre: "Baremo Figuras" },
            { ...makeBaremoWire(2, 1), dimensionResultadoId: 2, codigoBaremo: "BAR-DES", nombre: "Baremo Desplazamiento" },
            { ...makeBaremoWire(10, 1), dimensionResultadoId: null, codigoBaremo: "BAR-BFA-T", nombre: "Baremo total BFA" },
          ]),
        ),
      ),
      http.get(`${API}/baremos/1/ranges`, () => HttpResponse.json(ok([makeRangeWire(11, 1)]))),
      http.get(`${API}/baremos/2/ranges`, () => HttpResponse.json(ok([makeRangeWire(21, 2)]))),
      http.get(`${API}/baremos/10/ranges`, () => HttpResponse.json(ok([makeRangeWire(101, 10)]))),
      http.post(`${API}/tests/1/versions`, () =>
        HttpResponse.json(ok(makeVersionWire(201, 1, "BORRADOR", 1))),
      ),
      http.post(`${API}/test-versions/201/configuration`, () =>
        HttpResponse.json(
          ok([
            makeSubtestWire(101, 201, "FI", "Figuras idénticas", 1),
            makeSubtestWire(102, 201, "DES", "Desplazamiento", 2),
          ]),
        ),
      ),
      http.post(`${API}/subtests/101/scoring-rules`, () =>
        HttpResponse.json(ok(makeRuleWire(501, 101, true))),
      ),
      http.post(`${API}/subtests/102/scoring-rules`, () =>
        HttpResponse.json(ok(makeRuleWire(502, 102, true))),
      ),
      http.get(`${API}/subtests/101/clone-template`, () =>
        HttpResponse.json(ok(makeTemplateWire(101, "FI", { includeKey: false }))),
      ),
      http.get(`${API}/subtests/102/clone-template`, () =>
        HttpResponse.json(ok(makeTemplateWire(102, "DES", { includeKey: false }))),
      ),
      http.post(`${API}/baremos`, async ({ request }) => {
        const body = (await request.json()) as { dimensionId?: number | null; code: string };
        createdBaremoPayloads.push(body);
        if (body.dimensionId != null) {
          return HttpResponse.json({ success: false, message: "FK baremo_dimension_resultado" }, { status: 400 });
        }
        return HttpResponse.json(ok({ ...makeBaremoWire(400, 201), codigoBaremo: body.code }));
      }),
      http.post(`${API}/baremos/400/ranges`, () =>
        HttpResponse.json(ok(makeRangeWire(401, 400))),
      ),
    );

    const plan = await inspectVersionClonePlan(1, 1);
    expect(plan.omittedBaremos.map((b) => b.baremo.code)).toEqual(["BAR-FI", "BAR-DES"]);
    expect(plan.copiableBaremos.map((b) => b.code)).toEqual(["BAR-BFA-T"]);

    const result = await cloneVersionFromSource({
      testId: 1,
      sourceVersionId: 1,
      versionPayload: { number: "1.2", strategyId: 1 },
      permissions: fullPermissions,
    });

    expect(createdBaremoPayloads).toEqual([
      expect.objectContaining({ code: "BAR-BFA-T", dimensionId: null }),
    ]);
    expect(result.status).toBe("cloned");
    if (result.status !== "cloned") throw new Error("Expected cloned");
    expect(result.copiedBaremos).toBe(true);
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings.join(" ")).toContain("BAR-FI");
    expect(result.warnings.join(" ")).toContain("BAR-DES");
  });

  it("F3-FIX-2 (Hallazgo 2): cloneVersionFromSource verifica la firma antes de createVersion y devuelve plan_changed si cambió un baremo del origen", async () => {
    let createVersionCalls = 0;
    let sourceBaremos: Array<
      Omit<ReturnType<typeof makeBaremoWire>, "dimensionResultadoId"> & {
        dimensionResultadoId: number | null;
      }
    > = [
      { ...makeBaremoWire(10, 10), dimensionResultadoId: null, codigoBaremo: "BAR-TOT", nombre: "Baremo total" },
    ];

    server.use(
      http.get(`${API}/tests`, () => HttpResponse.json(ok([makeTestWire(1)]))),
      http.get(`${API}/tests/1/versions`, () => HttpResponse.json(ok([makeVersionWire(10, 1)]))),
      http.get(`${API}/test-versions/10/subtests`, () =>
        HttpResponse.json(ok([makeSubtestWire(20, 10, "MEM", "Memoria", 1)])),
      ),
      http.get(`${API}/subtests/20/clone-template`, () =>
        HttpResponse.json(ok(makeTemplateWire(20, "MEM"))),
      ),
      http.get(`${API}/subtests/20/scoring-rules`, () =>
        HttpResponse.json(ok([makeRuleWire(80, 20, true)])),
      ),
      http.get(`${API}/test-versions/10/baremos`, () => HttpResponse.json(ok(sourceBaremos))),
      http.get(`${API}/baremos/10/ranges`, () => HttpResponse.json(ok([makeRangeWire(100, 10)]))),
      http.post(`${API}/tests/1/versions`, () => {
        createVersionCalls += 1;
        return HttpResponse.json(ok(makeVersionWire(200, 1, "BORRADOR", 1)));
      }),
      http.post(`${API}/test-versions/200/configuration`, () =>
        HttpResponse.json(ok([makeSubtestWire(300, 200, "MEM", "Memoria", 1)])),
      ),
      http.post(`${API}/subtests/300/scoring-rules`, () =>
        HttpResponse.json(ok(makeRuleWire(999, 300, true))),
      ),
      http.get(`${API}/subtests/300/clone-template`, () =>
        HttpResponse.json(ok(makeTemplateWire(300, "MEM", { includeKey: false }))),
      ),
    );

    const initialPlan = await inspectVersionClonePlan(1, 10, { targetStrategyId: 1 });
    expect(initialPlan.hasOmissions).toBe(false);

    // Un baremo del origen pasa a estar ligado a dimensión entre la inspección y el envío
    sourceBaremos = [
      { ...makeBaremoWire(10, 10), dimensionResultadoId: 3, codigoBaremo: "BAR-TOT", nombre: "Baremo total" },
    ];

    const changedResult = await cloneVersionFromSource({
      testId: 1,
      sourceVersionId: 10,
      versionPayload: { number: "2.0", strategyId: 1 },
      permissions: fullPermissions,
      expectedPlanSignature: initialPlan.signature,
    });

    expect(createVersionCalls).toBe(0);
    expect(changedResult.status).toBe("plan_changed");
    if (changedResult.status !== "plan_changed") throw new Error("Expected plan_changed");
    expect(changedResult.plan.hasOmissions).toBe(true);
    expect(changedResult.plan.omittedBaremos.map((b) => b.baremo.code)).toEqual(["BAR-TOT"]);
    expect(changedResult.plan.signature).not.toBe(initialPlan.signature);

    // Con la firma nueva confirmada sí crea el borrador ejecutando el plan actualizado
    const clonedResult = await cloneVersionFromSource({
      testId: 1,
      sourceVersionId: 10,
      versionPayload: { number: "2.0", strategyId: 1 },
      permissions: fullPermissions,
      expectedPlanSignature: changedResult.plan.signature,
    });

    expect(createVersionCalls).toBe(1);
    expect(clonedResult.status).toBe("cloned");
    if (clonedResult.status !== "cloned") throw new Error("Expected cloned");
    expect(clonedResult.warnings.join(" ")).toContain("BAR-TOT");
  });
});
