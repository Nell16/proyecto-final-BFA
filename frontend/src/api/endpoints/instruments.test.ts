import { beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { staffClient } from "../client";
import { ApiError } from "../errors";
import { useStaffAuth } from "../../store/staffAuth";
import {
  approveVersion,
  createAnswerKey,
  createBaremo,
  createBaremoRange,
  createItem,
  createOption,
  createScoringRule,
  createSubtest,
  createTest,
  createVersion,
  deleteItemImage,
  getAnswerKey,
  getSubtestCloneTemplate,
  listBaremoRanges,
  listBaremos,
  listItemImages,
  listItems,
  listOptions,
  listScoringRules,
  listScoringStrategies,
  listSubtests,
  listTests,
  listVersions,
  publishVersion,
  saveVersionConfiguration,
  updateAnswerKey,
  updateBaremo,
  updateBaremoRange,
  updateItem,
  updateOption,
  updateScoringRule,
  updateSubtest,
  updateVersion,
  uploadItemImage,
  uploadOptionImage,
} from "./instruments";
import type { VersionConfigurationPayload } from "../schemas/instruments";

import testsFixture from "../schemas/__fixtures__/instruments/tests.json";
import versionsFixture from "../schemas/__fixtures__/instruments/versions.json";
import subtestsFixture from "../schemas/__fixtures__/instruments/subtests.json";
import cloneTemplateFixture from "../schemas/__fixtures__/instruments/clone-template.json";
import itemsFixture from "../schemas/__fixtures__/instruments/items.json";
import optionsFixture from "../schemas/__fixtures__/instruments/options.json";
import itemImagesFixture from "../schemas/__fixtures__/instruments/item-images.json";
import imageUploadFixture from "../schemas/__fixtures__/instruments/image-upload.json";
import scoringStrategiesFixture from "../schemas/__fixtures__/instruments/scoring-strategies.json";
import scoringRulesFixture from "../schemas/__fixtures__/instruments/scoring-rules.json";
import answerKeyFixture from "../schemas/__fixtures__/instruments/answer-key.json";
import baremosFixture from "../schemas/__fixtures__/instruments/baremos.json";
import baremoRangesFixture from "../schemas/__fixtures__/instruments/baremo-ranges.json";
import versionConfigFixture from "../schemas/__fixtures__/instruments/version-configuration-request.json";

const API = "http://localhost:8080";

const ok = <T>(data: T) => ({
  success: true,
  data,
  message: "Operacion completada",
  error: null,
  correlationId: "cid-test",
});

beforeEach(() => {
  useStaffAuth.getState().setSession({
    token: "staff-jwt",
    expiresAt: null,
    user: { id: "u1", username: "ana", roles: ["PSICOLOGO_COORDINADOR"], permissions: ["TEST_CREAR"] },
  });
});

describe("instruments endpoints: parseo de listas principales y entidades", () => {
  it("parsea todas las listas principales al modelo de dominio en camelCase", async () => {
    server.use(
      http.get(`${API}/tests`, () => HttpResponse.json(ok(testsFixture))),
      http.get(`${API}/tests/1/versions`, () => HttpResponse.json(ok(versionsFixture))),
      http.get(`${API}/test-versions/10/subtests`, () => HttpResponse.json(ok(subtestsFixture))),
      http.get(`${API}/subtests/20/clone-template`, () => HttpResponse.json(ok(cloneTemplateFixture))),
      http.get(`${API}/subtests/20/items`, () => HttpResponse.json(ok(itemsFixture))),
      http.get(`${API}/items/30/options`, () => HttpResponse.json(ok(optionsFixture))),
      http.get(`${API}/items/30/images`, () => HttpResponse.json(ok(itemImagesFixture))),
      http.get(`${API}/scoring/strategies`, () => HttpResponse.json(ok(scoringStrategiesFixture))),
      http.get(`${API}/subtests/20/scoring-rules`, () => HttpResponse.json(ok(scoringRulesFixture))),
      http.get(`${API}/items/30/answer-key`, () => HttpResponse.json(ok(answerKeyFixture))),
      http.get(`${API}/test-versions/10/baremos`, () => HttpResponse.json(ok(baremosFixture))),
      http.get(`${API}/baremos/90/ranges`, () => HttpResponse.json(ok(baremoRangesFixture))),
    );

    const tests = await listTests();
    expect(tests).toEqual([
      {
        id: 1,
        code: "BFA-2026",
        name: "Batería Factorial de Aptitudes",
        description: "Evaluación integral de aptitudes cognitivas",
        createdById: "44444444-4444-4444-4444-444444444444",
        status: "ACTIVO",
        createdAt: "2026-06-26T10:15:30.000Z",
      },
    ]);

    const versions = await listVersions(1);
    expect(versions).toHaveLength(2);
    expect(versions[0]).toMatchObject({
      id: 10,
      testId: 1,
      strategyId: 1,
      number: "1.0",
      status: "BORRADOR",
      randomizeSubtests: false,
      randomizeItems: true,
      approvedById: null,
      approvedAt: null,
      publishedAt: null,
      createdAt: "2026-06-26T10:20:00.000Z",
    });
    expect(versions[1]?.status).toBe("PUBLICADO");
    expect(versions[1]?.approvedAt).toBe("2026-06-27T09:00:00.000Z");
    expect(versions[1]?.publishedAt).toBe("2026-06-27T09:30:00.000Z");
    expect(versions[1]?.createdAt).toBe("2026-06-26T11:00:00.000Z");

    const subtests = await listSubtests(10);
    expect(subtests[0]).toMatchObject({
      id: 20,
      versionId: 10,
      code: "MEM",
      name: "Memoria Visual",
      order: 1,
      randomizeOptions: false,
      required: true,
      status: "ACTIVO",
    });

    const template = await getSubtestCloneTemplate(20);
    expect(template.sourceSubtestId).toBe(20);
    expect(template.status).toBe("ACTIVO");
    expect(template.items[0]?.answerKey?.correctOptionSourceId).toBe(40);
    expect(template.items[0]?.options[0]?.status).toBe("ACTIVO");

    const items = await listItems(20);
    expect(items[0]).toMatchObject({
      id: 30,
      subtestId: null,
      code: "IT-1",
      itemType: "TEXTO_E_IMAGEN",
      responseType: "OPCION_UNICA",
      order: 1,
      baseScore: 1,
      required: true,
      confidential: true,
      status: "ACTIVO",
    });
    expect(items[0]?.images[0]).toEqual({
      id: 55,
      order: 1,
      altText: "Figura",
      storagePath: "test-config/items/30/file.png",
      url: null,
      role: "ENUNCIADO",
    });

    const options = await listOptions(30);
    expect(options[0]).toMatchObject({
      id: 40,
      itemId: null,
      code: "A",
      text: "Opción A",
      order: 1,
      ordinalValue: 1,
      status: "ACTIVO",
    });
    expect(options[0]?.images[0]?.storagePath).toBe("test-config/options/40/file.png");

    const itemImages = await listItemImages(30);
    expect(itemImages[0]).toMatchObject({
      id: 55,
      resourceId: 77,
      itemId: 30,
      role: "ENUNCIADO",
      fileName: "file.png",
      url: "/items/images/resources/77",
    });

    const strategies = await listScoringStrategies();
    expect(strategies[0]).toMatchObject({
      id: 1,
      code: "CLAVE_SIMPLE",
      strategyType: "CLAVE_SIMPLE",
      active: true,
      allowsBaremo: true,
      createdAt: "2026-06-01T08:00:00.000Z",
    });

    const rules = await listScoringRules(20);
    expect(rules[0]).toMatchObject({
      id: 80,
      versionId: 10,
      subtestId: 20,
      itemId: null,
      strategyId: 1,
      ruleType: "CLAVE_ITEM",
      priority: 1,
      status: "BORRADOR",
      parametersJson: "{}",
      createdAt: "2026-06-26T10:30:00.000Z",
      approvedAt: null,
    });

    const key = await getAnswerKey(30);
    expect(key).toMatchObject({
      id: 50,
      ruleId: 80,
      itemId: 30,
      correctOptionId: 40,
      score: 1,
      requiresManualReview: false,
      createdAt: "2026-06-26T10:35:00.000Z",
    });

    const baremos = await listBaremos(10);
    expect(baremos[0]).toMatchObject({
      id: 90,
      versionId: 10,
      code: "BAR-GEN",
      name: "Baremo General 2026",
      normativeGroup: "General",
      minAgeCriteria: 17,
      maxAgeCriteria: 30,
      validFrom: "2026-01-01",
      validTo: "2026-12-31",
      status: "BORRADOR",
      createdAt: "2026-06-26T10:40:00.000Z",
      approvedAt: null,
    });

    const ranges = await listBaremoRanges(90);
    expect(ranges[0]).toMatchObject({
      id: 100,
      baremoId: 90,
      minScore: 0,
      maxScore: 10,
      percentile: 25,
      category: "Bajo",
      order: 1,
    });
  });

  it("tolera campos extra desconocidos y estados desconocidos hacia DESCONOCIDO", async () => {
    server.use(
      http.get(`${API}/tests`, () =>
        HttpResponse.json(
          ok([
            {
              ...testsFixture[0],
              estado: "ARCHIVADO_FUTURO",
              campoExtraBackend: "valor-extra",
            },
          ]),
        ),
      ),
      http.get(`${API}/items/99/answer-key`, () => HttpResponse.json(ok(null))),
    );

    const tests = await listTests();
    expect(tests[0]?.status).toBe("DESCONOCIDO");
    expect(tests[0]?.code).toBe("BFA-2026");
    expect(await getAnswerKey(99)).toBeNull();
  });

  it("propaga ApiError en error de envelope y CONTRACT_MISMATCH en contrato roto", async () => {
    server.use(
      http.get(`${API}/tests`, () =>
        HttpResponse.json({
          success: false,
          data: null,
          error: { code: "FORBIDDEN", message: "Sin permisos" },
        }),
      ),
      http.get(`${API}/tests/1/versions`, () => HttpResponse.json(ok([{ id: "no-numerico" }]))),
    );

    await expect(listTests()).rejects.toMatchObject({
      name: "ApiError",
      code: "FORBIDDEN",
      message: "Sin permisos",
    });

    const err = await listVersions(1).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("CONTRACT_MISMATCH");
  });

  it("lanza CONTRACT_MISMATCH si llega una fecha inválida en creadoEn", async () => {
    server.use(
      http.get(`${API}/tests`, () =>
        HttpResponse.json(ok([{ ...testsFixture[0], creadoEn: "fecha-invalida" }])),
      ),
    );

    const err = await listTests().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("CONTRACT_MISMATCH");
  });
});

describe("instruments endpoints: mutaciones CRUD y ciclo de versión", () => {
  it("ejecuta mutaciones de tests, versiones, subtests, ítems, opciones, scoring, claves y baremos", async () => {
    server.use(
      http.post(`${API}/tests`, () => HttpResponse.json(ok(testsFixture[0]))),
      http.post(`${API}/tests/1/versions`, () => HttpResponse.json(ok(versionsFixture[0]))),
      http.patch(`${API}/test-versions/10`, () => HttpResponse.json(ok(versionsFixture[0]))),
      http.post(`${API}/test-versions/10/approve`, () =>
        HttpResponse.json(ok({ ...versionsFixture[0], estado: "APROBADO" })),
      ),
      http.post(`${API}/test-versions/10/publish`, () => HttpResponse.json(ok(versionsFixture[1]))),
      http.post(`${API}/test-versions/10/subtests`, () => HttpResponse.json(ok(subtestsFixture[0]))),
      http.patch(`${API}/subtests/20`, () => HttpResponse.json(ok(subtestsFixture[0]))),
      http.post(`${API}/subtests/20/items`, () => HttpResponse.json(ok({ ...itemsFixture[0], subtestId: 20 }))),
      http.patch(`${API}/items/30`, () => HttpResponse.json(ok({ ...itemsFixture[0], subtestId: 20 }))),
      http.post(`${API}/items/30/options`, () => HttpResponse.json(ok({ ...optionsFixture[0], itemId: 30 }))),
      http.patch(`${API}/options/40`, () => HttpResponse.json(ok({ ...optionsFixture[0], itemId: 30 }))),
      http.post(`${API}/subtests/20/scoring-rules`, () => HttpResponse.json(ok(scoringRulesFixture[0]))),
      http.patch(`${API}/scoring-rules/80`, () => HttpResponse.json(ok(scoringRulesFixture[0]))),
      http.post(`${API}/items/30/answer-key`, () => HttpResponse.json(ok(answerKeyFixture))),
      http.patch(`${API}/answer-keys/50`, () => HttpResponse.json(ok(answerKeyFixture))),
      http.post(`${API}/baremos`, () => HttpResponse.json(ok(baremosFixture[0]))),
      http.patch(`${API}/baremos/90`, () => HttpResponse.json(ok(baremosFixture[0]))),
      http.post(`${API}/baremos/90/ranges`, () => HttpResponse.json(ok(baremoRangesFixture[0]))),
      http.patch(`${API}/baremo-ranges/100`, () => HttpResponse.json(ok(baremoRangesFixture[0]))),
      http.delete(`${API}/items/images/55`, () => HttpResponse.json(ok(null))),
    );

    expect((await createTest({ code: "BFA-2026", name: "Batería" })).id).toBe(1);
    expect((await createVersion(1, { number: "1.0" })).id).toBe(10);
    expect((await updateVersion(10, { number: "1.0", randomizeItems: true })).number).toBe("1.0");
    expect((await approveVersion(10)).status).toBe("APROBADO");
    expect((await publishVersion(10)).status).toBe("PUBLICADO");
    expect((await createSubtest(10, { code: "MEM", name: "Memoria", order: 1 })).id).toBe(20);
    expect((await updateSubtest(20, { code: "MEM", name: "Memoria", order: 1 })).id).toBe(20);
    expect(
      (
        await createItem(20, {
          code: "IT-1",
          itemType: "TEXTO_E_IMAGEN",
          responseType: "OPCION_UNICA",
          order: 1,
        })
      ).subtestId,
    ).toBe(20);
    expect(
      (
        await updateItem(30, {
          code: "IT-1",
          itemType: "TEXTO_E_IMAGEN",
          responseType: "OPCION_UNICA",
          order: 1,
        })
      ).id,
    ).toBe(30);
    expect((await createOption(30, { code: "A", order: 1 })).itemId).toBe(30);
    expect((await updateOption(40, { code: "A", order: 1 })).id).toBe(40);
    expect((await createScoringRule(20, { strategyId: 1, ruleType: "CLAVE_ITEM" })).id).toBe(80);
    expect((await updateScoringRule(80, { strategyId: 1, ruleType: "CLAVE_ITEM" })).id).toBe(80);
    expect((await createAnswerKey(30, { ruleId: 80, correctOptionId: 40 })).id).toBe(50);
    expect((await updateAnswerKey(50, { ruleId: 80, correctOptionId: 40 })).id).toBe(50);
    expect((await createBaremo({ versionId: 10, code: "BAR-GEN", name: "Baremo" })).id).toBe(90);
    expect((await updateBaremo(90, { versionId: 10, code: "BAR-GEN", name: "Baremo" })).id).toBe(90);
    expect((await createBaremoRange(90, { minScore: 0, maxScore: 10, category: "Bajo", order: 1 })).id).toBe(100);
    expect((await updateBaremoRange(100, { minScore: 0, maxScore: 10, category: "Bajo", order: 1 })).id).toBe(100);
    await expect(deleteItemImage(55)).resolves.toBeUndefined();
  });
});

describe("saveVersionConfiguration: validación previa y envío", () => {
  it("envía payload válido y parsea los subtests guardados", async () => {
    const spy = vi.fn();
    server.use(
      http.post(`${API}/test-versions/10/configuration`, async ({ request }) => {
        spy(await request.json());
        return HttpResponse.json(ok(subtestsFixture));
      }),
    );

    const payload = versionConfigFixture as VersionConfigurationPayload;
    const saved = await saveVersionConfiguration(10, payload);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(payload);
    expect(saved).toHaveLength(1);
    expect(saved[0]?.code).toBe("MEM");
  });

  it("rechaza payload inválido sin realizar petición HTTP", async () => {
    const spy = vi.fn();
    server.use(
      http.post(`${API}/test-versions/10/configuration`, () => {
        spy();
        return HttpResponse.json(ok(subtestsFixture));
      }),
    );

    const duplicateSubtestCode: VersionConfigurationPayload = {
      subtests: [
        { draftId: "s1", status: "CREATED", code: "mem", name: "Subtest 1", order: 1, items: [] },
        { draftId: "s2", status: "CREATED", code: "MEM", name: "Subtest 2", order: 2, items: [] },
      ],
    };
    await expect(saveVersionConfiguration(10, duplicateSubtestCode)).rejects.toMatchObject({
      name: "ApiError",
      code: "CONTRACT_MISMATCH",
    });

    const missingDraftOption: VersionConfigurationPayload = {
      subtests: [
        {
          draftId: "s1",
          status: "CREATED",
          code: "MEM",
          name: "Memoria",
          order: 1,
          items: [
            {
              draftId: "i1",
              status: "CREATED",
              code: "IT-1",
              itemType: "SOLO_TEXTO",
              responseType: "OPCION_UNICA",
              order: 1,
              options: [{ draftId: "opt-1", status: "DELETED", code: "A", order: 1 }],
              answerKey: {
                draftId: "k1",
                status: "CREATED",
                ruleId: 80,
                correctOptionDraftId: "opt-1",
              },
            },
          ],
        },
      ],
    };
    await expect(saveVersionConfiguration(10, missingDraftOption)).rejects.toMatchObject({
      name: "ApiError",
      code: "CONTRACT_MISMATCH",
    });

    const missingResourceOnImage: VersionConfigurationPayload = {
      subtests: [
        {
          draftId: "s1",
          status: "CREATED",
          code: "MEM",
          name: "Memoria",
          order: 1,
          items: [
            {
              draftId: "i1",
              status: "CREATED",
              code: "IT-1",
              itemType: "SOLO_IMAGEN",
              responseType: "OPCION_UNICA",
              order: 1,
              images: [{ draftId: "img-1", status: "CREATED", order: 1 }],
            },
          ],
        },
      ],
    };
    await expect(saveVersionConfiguration(10, missingResourceOnImage)).rejects.toMatchObject({
      name: "ApiError",
      code: "CONTRACT_MISMATCH",
    });

    expect(spy).not.toHaveBeenCalled();
  });

  it("permite nodos DELETED sin campos obligatorios de creación y no los cuenta como duplicados", async () => {
    const spy = vi.fn();
    server.use(
      http.post(`${API}/test-versions/10/configuration`, () => {
        spy();
        return HttpResponse.json(ok(subtestsFixture));
      }),
    );

    const payload: VersionConfigurationPayload = {
      subtests: [
        { id: 20, status: "DELETED" },
        { draftId: "s-new", status: "CREATED", code: "MEM", name: "Memoria", order: 1, items: [] },
      ],
    };

    const result = await saveVersionConfiguration(10, payload);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(1);
  });
});

describe("multipart de imágenes", () => {
  it("uploadItemImage envía FormData con file, order, altText y role sin fijar boundary manual", async () => {
    let seenContentType: string | null = null;
    let seenBody = "";
    const postSpy = vi.spyOn(staffClient, "post");

    server.use(
      http.post(`${API}/items/30/images`, async ({ request }) => {
        seenContentType = request.headers.get("content-type");
        seenBody = await request.text();
        return HttpResponse.json(ok(imageUploadFixture));
      }),
    );

    const file = new File(["img-bytes"], "estimulo.png", { type: "image/png" });
    const uploaded = await uploadItemImage(30, {
      file,
      order: 1,
      altText: "Figura",
      role: "ENUNCIADO",
    });

    const sentForm = postSpy.mock.calls[0]?.[1];
    postSpy.mockRestore();

    expect(sentForm).toBeInstanceOf(FormData);
    if (sentForm instanceof FormData) {
      expect(sentForm.get("file")).toBe(file);
      expect(sentForm.get("order")).toBe("1");
      expect(sentForm.get("altText")).toBe("Figura");
      expect(sentForm.get("role")).toBe("ENUNCIADO");
    }

    expect(seenContentType).toMatch(/^multipart\/form-data; boundary=/);
    expect(seenBody).toContain('name="file"; filename="estimulo.png"');
    expect(seenBody).toContain("img-bytes");
    expect(seenBody).toContain('name="order"');
    expect(seenBody).toContain('name="altText"');
    expect(seenBody).toContain("Figura");
    expect(seenBody).toContain('name="role"');
    expect(seenBody).toContain("ENUNCIADO");
    expect(uploaded).toEqual({
      imageLinkId: 55,
      resourceId: 77,
      storagePath: "test-config/items/30/file.png",
      fileName: "file.png",
      mimeType: "image/png",
      sizeBytes: 1024,
      hash: "abc123def456",
      order: 1,
      altText: "Figura",
      role: "ENUNCIADO",
    });
  });

  it("uploadOptionImage envía FormData con file, order y altText", async () => {
    let seenContentType: string | null = null;
    let seenBody = "";
    const postSpy = vi.spyOn(staffClient, "post");

    server.use(
      http.post(`${API}/options/40/images`, async ({ request }) => {
        seenContentType = request.headers.get("content-type");
        seenBody = await request.text();
        return HttpResponse.json(ok({ ...imageUploadFixture, role: null }));
      }),
    );

    const file = new File(["opt-bytes"], "opcion.png", { type: "image/png" });
    const uploaded = await uploadOptionImage(40, {
      file,
      order: 2,
      altText: "Opción A",
    });

    const sentForm = postSpy.mock.calls[0]?.[1];
    postSpy.mockRestore();

    expect(sentForm).toBeInstanceOf(FormData);
    if (sentForm instanceof FormData) {
      expect(sentForm.get("file")).toBe(file);
      expect(sentForm.get("order")).toBe("2");
      expect(sentForm.get("altText")).toBe("Opción A");
      expect(sentForm.has("role")).toBe(false);
    }

    expect(seenContentType).toMatch(/^multipart\/form-data; boundary=/);
    expect(seenBody).toContain('name="file"; filename="opcion.png"');
    expect(seenBody).toContain("opt-bytes");
    expect(seenBody).toContain('name="order"');
    expect(seenBody).toContain('name="altText"');
    expect(seenBody).not.toContain('name="role"');
    expect(uploaded.role).toBeNull();
  });
});
