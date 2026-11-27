import { describe, expect, it } from "vitest";
import { createDocumentReducer } from "../reducer";
import {
  extractSanitizedFilenameFromStoragePath,
  reconcileVersionDocumentThreeWay,
  resolveUncertainImageConflict,
  sanitizeImageFilename,
} from "../reconcile";
import {
  baremoNaturalKey,
  canonicalBaremo,
  canonicalItem,
  canonicalOption,
  canonicalSubtest,
  createEmptySentSnapshot,
  itemNaturalKey,
  optionNaturalKey,
  sentKey,
  subtestNaturalKey,
  uploadSlotKey,
} from "../sent";
import type { DocumentBaremo, DocumentImage } from "../types";
import { createCleanDocument, makeDeterministicDraftIdFactory } from "./fixtures";

describe("reconcileVersionDocumentThreeWay (F3-FIX-5)", () => {
  it("Hallazgo 1 (ALTO): borrar un subtest localmente mientras el servidor edita un ítem hijo produce 409 listando los descendientes", () => {
    const base = createCleanDocument({ baremos: [] });
    const reducer = createDocumentReducer(makeDeterministicDraftIdFactory(100));

    const mine = reducer(base, {
      type: "DELETE_SUBTEST",
      subtestDraftId: "sub-20",
    });

    const theirs = reducer(base, {
      type: "UPDATE_ITEM",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      patch: { prompt: "Enunciado editado por otro usuario" },
    });

    const result = reconcileVersionDocumentThreeWay({ base, mine, theirs });

    expect(result.conflicts.length).toBeGreaterThanOrEqual(2);
    expect(result.conflicts.some((c) => c.kind === "subtest" && c.label.includes("MEM"))).toBe(true);
    expect(result.conflicts.some((c) => c.kind === "item" && c.label.includes("IT-1"))).toBe(true);
  });

  it("Decision 4 (inversa): editar un ítem hijo localmente mientras el servidor borró el subtest padre produce 409 listando el cambio local", () => {
    const base = createCleanDocument({ baremos: [] });
    const reducer = createDocumentReducer(makeDeterministicDraftIdFactory(110));

    const mine = reducer(base, {
      type: "UPDATE_ITEM",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      patch: { prompt: "Edición local en hijo" },
    });

    const theirs = structuredClone(base);
    theirs.subtests = [];

    const result = reconcileVersionDocumentThreeWay({ base, mine, theirs });

    expect(result.conflicts.length).toBeGreaterThanOrEqual(1);
    expect(result.conflicts.some((c) => c.kind === "subtest")).toBe(true);
    expect(
      result.conflicts.some((c) => c.reason.includes("IT-1") && c.reason.includes("eliminó")),
    ).toBe(true);
  });

  it("Hallazgo 2 (MEDIO) / F3-FIX-8 (ALTO 1): imagen pendiente con error incierto no se adopta automáticamente aunque coincida nombre, altText y role; abre UNCERTAIN_IMAGE_OPERATION y conserva File y sent", () => {
    const base = createCleanDocument({ baremos: [] });
    const reducer = createDocumentReducer(makeDeterministicDraftIdFactory(120));

    const mine = reducer(base, {
      type: "ATTACH_ITEM_IMAGE",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      image: {
        draftId: "img-local-2",
        pendingFileId: "file-2",
        order: 2,
        altText: "Estímulo 2",
        role: "ENUNCIADO",
        fileName: "dos.png",
      },
    });

    const theirs = structuredClone(base);
    const persistedImg: DocumentImage = {
      id: 777,
      draftId: "img-777",
      sourceId: null,
      resourceId: 901,
      pendingFileId: null,
      previewUrl: "/items/images/resources/901",
      status: "EXISTING",
      order: 2,
      altText: "Estímulo 2",
      role: "ENUNCIADO",
      fileName: "dos.png",
      storagePath: "test-config/items/30/550e8400-e29b-41d4-a716-446655440000-dos.png",
    };
    theirs.subtests[0]!.items[0]!.images.push(persistedImg);

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
      pendingFileId: "file-2",
      fileName: "dos.png",
      fileSize: 3,
      lastModified: 1000,
      altText: "Estímulo 2",
      role: "ENUNCIADO",
    };

    const result = reconcileVersionDocumentThreeWay({
      base,
      mine,
      theirs,
      sent,
      pendingFiles: {
        "file-2": new File(["img"], "dos.png", { type: "image/png", lastModified: 1000 }),
      },
    });
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]?.kind).toBe("UNCERTAIN_IMAGE_OPERATION");
    expect(result.conflicts[0]?.resolution?.intention).toBe("reupload");
    const pendingImg = result.document.subtests[0]!.items[0]!.images.find(
      (img) => img.order === 2,
    );
    expect(pendingImg).toMatchObject({
      id: null,
      resourceId: null,
      pendingFileId: "file-2",
      status: "CREATED",
    });
    expect(result.sent.uploads[slotKey]).toBeDefined();

    const kept = resolveUncertainImageConflict({
      document: mine,
      baseline: base,
      sent,
      resolution: result.conflicts[0]!.resolution!,
      choice: "keep_server",
    });
    expect(kept.stale).toBe(false);
    expect(kept.document.subtests[0]!.items[0]!.images.find((img) => img.order === 2)).toMatchObject({
      id: 777,
      resourceId: 901,
      pendingFileId: null,
      status: "EXISTING",
    });
    expect(kept.sent.uploads[slotKey]).toBeUndefined();
  });

  it("Hallazgo 3 (MEDIO): editar baremo tras guardado parcial cuyo primer envío sí aplicó deja la diferencia como UPDATED sin 409", () => {
    const base = createCleanDocument({ baremos: [] });
    const reducer = createDocumentReducer(makeDeterministicDraftIdFactory(130));

    let mine = reducer(base, {
      type: "ADD_BAREMO",
      input: { draftId: "bar-new", code: "BAR-TOT", name: "Nombre enviado", dimensionId: null },
    });

    const sent = createEmptySentSnapshot();
    sent.nodes[sentKey.baremo("bar-new")] = {
      op: "CREATED",
      sig: canonicalBaremo(mine.baremos[0]!),
    };

    // Usuario edita el nombre antes de reintentar
    mine = reducer(mine, {
      type: "UPDATE_BAREMO",
      baremoDraftId: "bar-new",
      patch: { name: "Nombre editado después" },
    });

    // El servidor sí había persistido "Nombre enviado" con id 95
    const theirs = structuredClone(base);
    theirs.baremos.push({
      id: 95,
      draftId: "baremo-95",
      status: "EXISTING",
      dimensionId: null,
      code: "BAR-TOT",
      name: "Nombre enviado",
      description: "",
      normativeGroup: "General",
      ranges: [],
    });

    const result = reconcileVersionDocumentThreeWay({ base, mine, theirs, sent });
    expect(result.conflicts).toEqual([]);
    expect(result.document.baremos[0]).toMatchObject({
      id: 95,
      status: "UPDATED",
      code: "BAR-TOT",
      name: "Nombre editado después",
    });
    expect(result.sent.nodes[sentKey.baremo("bar-new")]).toBeUndefined();
  });

  it("Hallazgo 4 (MEDIO): cambiar solo mayúsculas (BAR-GEN → bar-gen) se conserva como cambio pendiente real", () => {
    const base = createCleanDocument();
    const reducer = createDocumentReducer(makeDeterministicDraftIdFactory(140));
    const mine = reducer(base, {
      type: "UPDATE_BAREMO",
      baremoDraftId: "bar-90",
      patch: { code: "bar-gen" },
    });
    const theirs = structuredClone(base);

    const result = reconcileVersionDocumentThreeWay({ base, mine, theirs });
    expect(result.conflicts).toEqual([]);
    expect(result.document.baremos[0]?.code).toBe("bar-gen");
    expect(result.document.baremos[0]?.status).toBe("UPDATED");
  });

  it("Baremos con el mismo code en dos dimensiones y candidatos en orden invertido: sin conflictos", () => {
    const base = createCleanDocument({ baremos: [] });
    const makeDimBaremo = (
      id: number | null,
      draftId: string,
      dimensionId: number,
      name: string,
    ): DocumentBaremo => ({
      id,
      draftId,
      status: id === null ? "CREATED" : "EXISTING",
      dimensionId,
      code: "BAR-DIM",
      name,
      description: "",
      normativeGroup: "General",
      ranges: [],
    });

    const mine = {
      ...base,
      baremos: [
        makeDimBaremo(null, "bar-d1", 1, "Dimensión 1"),
        makeDimBaremo(null, "bar-d2", 2, "Dimensión 2"),
      ],
    };

    // Orden invertido en theirs
    const theirs = {
      ...base,
      baremos: [
        makeDimBaremo(92, "baremo-92", 2, "Dimensión 2"),
        makeDimBaremo(91, "baremo-91", 1, "Dimensión 1"),
      ],
    };

    const result = reconcileVersionDocumentThreeWay({ base, mine, theirs });
    expect(result.conflicts).toEqual([]);
    expect(result.document.baremos).toHaveLength(2);
    expect(result.document.baremos.find((b) => b.dimensionId === 1)?.id).toBe(91);
    expect(result.document.baremos.find((b) => b.dimensionId === 2)?.id).toBe(92);
    expect(result.document.baremos.every((b) => b.status === "EXISTING")).toBe(true);
  });

  it("Clave ambigua (code vacío o duplicado): conflicto manual y nunca adopta id", () => {
    const base = createCleanDocument({ baremos: [] });

    // 1. Code vacío
    const mineEmpty = {
      ...base,
      baremos: [
        {
          id: null,
          draftId: "bar-empty",
          status: "CREATED" as const,
          dimensionId: null,
          code: "   ",
          name: "Sin código",
          description: "",
          normativeGroup: "",
          ranges: [],
        },
      ],
    };
    const theirsOne = {
      ...base,
      baremos: [
        {
          id: 99,
          draftId: "baremo-99",
          status: "EXISTING" as const,
          dimensionId: null,
          code: "BAR-99",
          name: "Otro",
          description: "",
          normativeGroup: "",
          ranges: [],
        },
      ],
    };

    const resEmpty = reconcileVersionDocumentThreeWay({
      base,
      mine: mineEmpty,
      theirs: theirsOne,
    });
    expect(resEmpty.conflicts.length).toBeGreaterThanOrEqual(1);
    expect(resEmpty.conflicts[0]?.reason).toMatch(/ambigua|vacía|recarga/i);
    expect(resEmpty.document.baremos[0]?.id).toBeNull();

    // 2. Code duplicado en mine (misma dimensión)
    const mineDup = {
      ...base,
      baremos: [
        {
          id: null,
          draftId: "bar-dup-1",
          status: "CREATED" as const,
          dimensionId: 1,
          code: "BAR-DUP",
          name: "Dup 1",
          description: "",
          normativeGroup: "",
          ranges: [],
        },
        {
          id: null,
          draftId: "bar-dup-2",
          status: "CREATED" as const,
          dimensionId: 1,
          code: "BAR-DUP",
          name: "Dup 2",
          description: "",
          normativeGroup: "",
          ranges: [],
        },
      ],
    };
    const theirsDupMatch = {
      ...base,
      baremos: [
        {
          id: 105,
          draftId: "baremo-105",
          status: "EXISTING" as const,
          dimensionId: 1,
          code: "BAR-DUP",
          name: "Dup 1",
          description: "",
          normativeGroup: "",
          ranges: [],
        },
      ],
    };

    const resDup = reconcileVersionDocumentThreeWay({
      base,
      mine: mineDup,
      theirs: theirsDupMatch,
    });
    expect(resDup.conflicts.length).toBeGreaterThanOrEqual(2);
    expect(resDup.conflicts.every((c) => /recarga/i.test(c.reason))).toBe(true);
    expect(resDup.document.baremos.every((b) => b.id === null)).toBe(true);
  });
});

describe("reconcileVersionDocumentThreeWay (F3-FIX-6)", () => {
  it("Hallazgo 1 (ALTO): ítem A con opción B/C vs ítem A/B con opción C no colisionan al borrar el subtest", () => {
    const base = createCleanDocument({ baremos: [] });
    base.subtests[0]!.items = [
      {
        ...base.subtests[0]!.items[0]!,
        id: 30,
        draftId: "item-a",
        code: "A",
        order: 1,
        answerKey: null,
        options: [
          {
            id: 40,
            draftId: "opt-bc",
            sourceId: null,
            status: "EXISTING",
            code: "B/C",
            text: "Original",
            order: 1,
            ordinalValue: 1,
            images: [],
          },
        ],
      },
      {
        ...base.subtests[0]!.items[0]!,
        id: 31,
        draftId: "item-ab",
        code: "A/B",
        order: 2,
        answerKey: null,
        options: [
          {
            id: 41,
            draftId: "opt-c",
            sourceId: null,
            status: "EXISTING",
            code: "C",
            text: "Sin cambios",
            order: 1,
            ordinalValue: 1,
            images: [],
          },
        ],
      },
    ];

    const reducer = createDocumentReducer(makeDeterministicDraftIdFactory(1200));
    const mine = reducer(base, {
      type: "DELETE_SUBTEST",
      subtestDraftId: "sub-20",
    });

    const theirs = reducer(base, {
      type: "UPDATE_OPTION",
      subtestDraftId: "sub-20",
      itemDraftId: "item-a",
      optionDraftId: "opt-bc",
      patch: { text: "Editada en servidor" },
    });

    const result = reconcileVersionDocumentThreeWay({ base, mine, theirs });
    expect(result.conflicts.some((c) => c.kind === "subtest")).toBe(true);
    expect(
      result.conflicts.some((c) => c.kind === "option" && c.label.includes("B/C")),
    ).toBe(true);

    // Claves compuestas con separadores en sent.ts tampoco colisionan
    expect(sentKey.itemImage("sub", "A/B", "C")).not.toBe(
      sentKey.optionImage("sub", "A", "B", "C"),
    );
    expect(
      uploadSlotKey({ subtestDraftId: "sub", itemDraftId: "A/B", optionDraftId: null, order: 1 }),
    ).not.toBe(
      uploadSlotKey({ subtestDraftId: "sub", itemDraftId: "A", optionDraftId: "B", order: 1 }),
    );
    expect(baremoNaturalKey({ code: "total|X", dimensionId: null })).not.toBe(
      baremoNaturalKey({ code: "dim:1|X", dimensionId: 1 }),
    );
  });

  it("Hallazgo 2 (ALTO, F3-FIX-7b): imagen reemplazada tras 503 con nombre coincidente genera UNCERTAIN_IMAGE_OPERATION y solo prepara PUT tras elegir «Aplicar mi cambio»", () => {
    const base = createCleanDocument({ baremos: [] });
    const reducer = createDocumentReducer(makeDeterministicDraftIdFactory(1210));

    let mine = reducer(base, {
      type: "ATTACH_ITEM_IMAGE",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      image: {
        draftId: "img-old",
        pendingFileId: "file-old",
        order: 2,
        altText: "Estímulo viejo",
        role: "ENUNCIADO",
        fileName: "vieja.png",
      },
    });

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
      pendingFileId: "file-old",
      fileName: "vieja.png",
      fileSize: 100,
      lastModified: 1000,
      altText: "Estímulo viejo",
      role: "ENUNCIADO",
    };

    // Usuario borra la imagen pendiente y adjunta otro archivo en el mismo orden
    mine = reducer(mine, {
      type: "DELETE_ITEM_IMAGE",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      imageDraftId: "img-old",
    });
    mine = reducer(mine, {
      type: "ATTACH_ITEM_IMAGE",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      image: {
        draftId: "img-new",
        pendingFileId: "file-new",
        order: 2,
        altText: "Estímulo nuevo",
        role: "ENUNCIADO",
        fileName: "nueva.png",
      },
    });

    // El servidor tiene una imagen con el mismo nombre saneado (ambigua)
    const theirs = structuredClone(base);
    theirs.subtests[0]!.items[0]!.images.push({
      id: 777,
      draftId: "img-777",
      sourceId: null,
      resourceId: 901,
      pendingFileId: null,
      previewUrl: "/items/images/resources/901",
      status: "EXISTING",
      order: 2,
      altText: "Estímulo viejo",
      role: "ENUNCIADO",
      fileName: null,
      storagePath: "test-config/items/30/550e8400-e29b-41d4-a716-446655440000-vieja.png",
    });

    const pendingFiles = {
      "file-new": new File(["new-bytes"], "nueva.png", { type: "image/png", lastModified: 2000 }),
    };

    const result = reconcileVersionDocumentThreeWay({
      base,
      mine,
      theirs,
      sent,
      pendingFiles,
    });
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]?.kind).toBe("UNCERTAIN_IMAGE_OPERATION");
    expect(result.conflicts[0]?.resolution?.intention).toBe("replace");
    // Nunca prepara PUT automático: la imagen en mine sigue sin id remoto
    const pendingImg = result.document.subtests[0]!.items[0]!.images.find((img) => img.order === 2);
    expect(pendingImg?.id).toBeNull();
    expect(result.sent.uploads[slotKey]).toBeDefined();

    // Resolver aplicando el cambio local prepara PUT by-order sobre id=777
    const applied = resolveUncertainImageConflict({
      document: mine,
      baseline: base,
      sent,
      resolution: result.conflicts[0]!.resolution!,
      choice: "apply_mine",
    });
    const appliedImg = applied.document.subtests[0]!.items[0]!.images.find((img) => img.order === 2);
    expect(appliedImg).toMatchObject({
      id: 777,
      resourceId: null,
      pendingFileId: "file-new",
      status: "UPDATED",
      fileName: "nueva.png",
    });
    expect(applied.sent.uploads[slotKey]).toBeUndefined();

    // Resolver conservando el servidor descarta la intención local
    const kept = resolveUncertainImageConflict({
      document: mine,
      baseline: base,
      sent,
      resolution: result.conflicts[0]!.resolution!,
      choice: "keep_server",
    });
    const keptImg = kept.document.subtests[0]!.items[0]!.images.find((img) => img.order === 2);
    expect(keptImg).toMatchObject({
      id: 777,
      resourceId: 901,
      pendingFileId: null,
      status: "EXISTING",
    });
    expect(kept.sent.uploads[slotKey]).toBeUndefined();
  });

  it("Hallazgo 2 (ALTO, F3-FIX-7b): si mine quitó la imagen incierta con nombre coincidente, genera UNCERTAIN_IMAGE_OPERATION y nunca marca DELETED automático", () => {
    const base = createCleanDocument({ baremos: [] });
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
      pendingFileId: "file-old",
      fileName: "vieja.png",
    };

    const theirs = structuredClone(base);
    theirs.subtests[0]!.items[0]!.images.push({
      id: 777,
      draftId: "img-777",
      sourceId: null,
      resourceId: 901,
      pendingFileId: null,
      previewUrl: "/items/images/resources/901",
      status: "EXISTING",
      order: 2,
      altText: "Estímulo viejo",
      role: "ENUNCIADO",
      fileName: null,
      storagePath: "test-config/items/30/550e8400-e29b-41d4-a716-446655440000-vieja.png",
    });

    const result = reconcileVersionDocumentThreeWay({ base, mine: base, theirs, sent });
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]?.kind).toBe("UNCERTAIN_IMAGE_OPERATION");
    expect(result.conflicts[0]?.resolution?.intention).toBe("delete");
    expect(result.document.subtests[0]!.items[0]!.images.find((img) => img.id === 777)).toBeUndefined();
    expect(result.sent.uploads[slotKey]).toBeDefined();

    const applied = resolveUncertainImageConflict({
      document: base,
      baseline: base,
      sent,
      resolution: result.conflicts[0]!.resolution!,
      choice: "apply_mine",
    });
    expect(applied.document.subtests[0]!.items[0]!.images.find((img) => img.id === 777)).toMatchObject({
      id: 777,
      status: "DELETED",
    });
    expect(applied.sent.uploads[slotKey]).toBeUndefined();
  });

  it("Hallazgo 3 (MEDIO): código cambiado después del envío empareja por clave natural de sent en baremos, subtests, ítems y opciones", () => {
    const base = createCleanDocument({ baremos: [] });
    const reducer = createDocumentReducer(makeDeterministicDraftIdFactory(1230));

    let mine = reducer(base, {
      type: "ADD_BAREMO",
      input: { draftId: "bar-new", code: "BAR-TOT", name: "Total", dimensionId: null },
    });
    mine = reducer(mine, {
      type: "ADD_SUBTEST",
      input: { draftId: "sub-new", code: "ESP", name: "Espacial" },
    });
    mine = reducer(mine, {
      type: "ADD_ITEM",
      subtestDraftId: "sub-new",
      input: { draftId: "item-new", code: "IT-ESP" },
    });
    mine = reducer(mine, {
      type: "ADD_OPTION",
      subtestDraftId: "sub-new",
      itemDraftId: "item-new",
      input: { draftId: "opt-new", code: "OPT-A", text: "Uno", order: 1 },
    });

    const sentBaremo = mine.baremos[0]!;
    const sentSub = mine.subtests[1]!;
    const sentItem = sentSub.items[0]!;
    const sentOpt = sentItem.options[0]!;

    const sent = createEmptySentSnapshot();
    sent.nodes[sentKey.baremo("bar-new")] = {
      op: "CREATED",
      sig: canonicalBaremo(sentBaremo),
      naturalKey: baremoNaturalKey(sentBaremo),
    };
    sent.nodes[sentKey.subtest("sub-new")] = {
      op: "CREATED",
      sig: canonicalSubtest(sentSub, mine.version.randomizeItems),
      naturalKey: subtestNaturalKey(sentSub),
    };
    sent.nodes[sentKey.item("sub-new", "item-new")] = {
      op: "CREATED",
      sig: canonicalItem(sentItem),
      naturalKey: itemNaturalKey(sentItem),
    };
    sent.nodes[sentKey.option("sub-new", "item-new", "opt-new")] = {
      op: "CREATED",
      sig: canonicalOption(sentOpt),
      naturalKey: optionNaturalKey(sentOpt),
    };

    const theirs = structuredClone(base);
    theirs.baremos.push({ ...structuredClone(sentBaremo), id: 95, draftId: "baremo-95", status: "EXISTING" });
    theirs.subtests.push({
      ...structuredClone(sentSub),
      id: 25,
      draftId: "sub-25",
      status: "EXISTING",
      items: [
        {
          ...structuredClone(sentItem),
          id: 251,
          draftId: "item-251",
          status: "EXISTING",
          options: [
            {
              ...structuredClone(sentOpt),
              id: 2510,
              draftId: "opt-2510",
              status: "EXISTING",
            },
          ],
        },
      ],
    });

    // Usuario cambia los códigos después del envío incierto
    mine = reducer(mine, {
      type: "UPDATE_BAREMO",
      baremoDraftId: "bar-new",
      patch: { code: "bar-tot" },
    });
    mine = reducer(mine, {
      type: "UPDATE_SUBTEST",
      subtestDraftId: "sub-new",
      patch: { code: "esp" },
    });
    mine = reducer(mine, {
      type: "UPDATE_ITEM",
      subtestDraftId: "sub-new",
      itemDraftId: "item-new",
      patch: { code: "it-esp" },
    });
    mine = reducer(mine, {
      type: "UPDATE_OPTION",
      subtestDraftId: "sub-new",
      itemDraftId: "item-new",
      optionDraftId: "opt-new",
      patch: { code: "opt-a" },
    });

    const result = reconcileVersionDocumentThreeWay({ base, mine, theirs, sent });
    expect(result.conflicts).toEqual([]);
    expect(result.document.baremos[0]).toMatchObject({
      id: 95,
      code: "bar-tot",
      status: "UPDATED",
    });
    expect(result.document.subtests[1]).toMatchObject({
      id: 25,
      code: "esp",
      status: "UPDATED",
    });
    expect(result.document.subtests[1]!.items[0]).toMatchObject({
      id: 251,
      code: "it-esp",
      status: "UPDATED",
    });
    expect(result.document.subtests[1]!.items[0]!.options[0]).toMatchObject({
      id: 2510,
      code: "opt-a",
      status: "UPDATED",
    });
  });
});

describe("sanitizeImageFilename y extractSanitizedFilenameFromStoragePath (F3-FIX-7b / F3-FIX-8)", () => {
  it("replica exactamente el saneamiento por punto de código de InstrumentImageService.java (~346-361)", () => {
    expect(sanitizeImageFilename(null)).toBe("image");
    expect(sanitizeImageFilename(undefined)).toBe("image");
    expect(sanitizeImageFilename("")).toBe("image");
    expect(sanitizeImageFilename("   \t\n ")).toBe("image");
    expect(sanitizeImageFilename("foto_1-test.webp")).toBe("foto_1-test.webp");
    expect(sanitizeImageFilename("C:\\Users\\Ana\\mi foto (1)@2x.png")).toBe(
      "mi_foto__1__2x.png",
    );
    expect(sanitizeImageFilename("carpeta/sub/árbol-ñ#.jpg")).toBe("_rbol-__.jpg");
    // Java Pattern.replaceAll opera por punto de código Unicode, no por unidad UTF-16
    expect(sanitizeImageFilename("estímulo😀.png")).toBe("est_mulo_.png");
    expect(sanitizeImageFilename("a👨‍👩‍👧b.png")).toBe("a_____b.png");
    const longName = `${"a".repeat(300)}.png`;
    expect(sanitizeImageFilename(longName)).toBe(longName);
  });

  it("extrae el nombre saneado tras {uuid}- y devuelve null cuando storagePath no es parseable", () => {
    expect(
      extractSanitizedFilenameFromStoragePath(
        "test-config/items/30/550e8400-e29b-41d4-a716-446655440000-mi_foto__1_.png",
      ),
    ).toBe("mi_foto__1_.png");
    expect(
      extractSanitizedFilenameFromStoragePath(
        "test-config/options/40/550E8400-E29B-41D4-A716-446655440000-opt-a.webp",
      ),
    ).toBe("opt-a.webp");
    expect(extractSanitizedFilenameFromStoragePath("items/1.png")).toBeNull();
    expect(extractSanitizedFilenameFromStoragePath("test-config/items/30/no-uuid-a.png")).toBeNull();
    expect(
      extractSanitizedFilenameFromStoragePath(
        "test-config/items/30/550e8400-e29b-41d4-a716-446655440000-",
      ),
    ).toBeNull();
    expect(extractSanitizedFilenameFromStoragePath("")).toBeNull();
    expect(extractSanitizedFilenameFromStoragePath(null)).toBeNull();
  });
});

describe("reconcileVersionDocumentThreeWay (F3-FIX-7b)", () => {
  it("ALTO variante 1 (quitar): POST incierto no aplicado + imagen ajena distinta en mismo orden → descarte negativo (Regla 1), nunca marca DELETED", () => {
    const base = createCleanDocument({ baremos: [] });
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
      pendingFileId: "f-a",
      fileName: "a.png",
      altText: "Propia",
      role: "ENUNCIADO",
    };

    // Otro editor subió ajena.png en el orden 2
    const theirs = structuredClone(base);
    theirs.subtests[0]!.items[0]!.images.push({
      id: 888,
      draftId: "img-888",
      sourceId: null,
      resourceId: 910,
      pendingFileId: null,
      previewUrl: "/items/images/resources/910",
      status: "EXISTING",
      order: 2,
      altText: "Ajena",
      role: "ENUNCIADO",
      fileName: null,
      storagePath: "test-config/items/30/550e8400-e29b-41d4-a716-446655440000-ajena.png",
    });

    const result = reconcileVersionDocumentThreeWay({ base, mine: base, theirs, sent });
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]?.kind).toBe("image");
    expect(result.conflicts[0]?.reason).toBe("Otro usuario adjuntó una imagen en el servidor.");
    expect(
      result.document.subtests[0]!.items[0]!.images.some((img) => img.status === "DELETED"),
    ).toBe(false);
    expect(result.sent.uploads[slotKey]).toBeUndefined();
  });

  it("ALTO variante 2 (reemplazar): POST incierto no aplicado + imagen ajena distinta en mismo orden → descarte negativo (Regla 1), nunca prepara PUT sobre recurso ajeno", () => {
    const base = createCleanDocument({ baremos: [] });
    const reducer = createDocumentReducer(makeDeterministicDraftIdFactory(1400));

    const mine = reducer(base, {
      type: "ATTACH_ITEM_IMAGE",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      image: {
        draftId: "img-b",
        pendingFileId: "f-b",
        order: 2,
        altText: "Reemplazo B",
        role: "ENUNCIADO",
        fileName: "b.png",
      },
    });

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
      pendingFileId: "f-a",
      fileName: "a.png",
      altText: "Propia",
      role: "ENUNCIADO",
    };

    const theirs = structuredClone(base);
    theirs.subtests[0]!.items[0]!.images.push({
      id: 888,
      draftId: "img-888",
      sourceId: null,
      resourceId: 910,
      pendingFileId: null,
      previewUrl: "/items/images/resources/910",
      status: "EXISTING",
      order: 2,
      altText: "Ajena",
      role: "ENUNCIADO",
      fileName: null,
      storagePath: "test-config/items/30/550e8400-e29b-41d4-a716-446655440000-ajena.png",
    });

    const result = reconcileVersionDocumentThreeWay({
      base,
      mine,
      theirs,
      sent,
      pendingFiles: {
        "f-b": new File(["b"], "b.png", { type: "image/png" }),
      },
    });
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]?.kind).toBe("image");
    expect(result.conflicts[0]?.reason).toBe("Otra imagen distinta ocupa el mismo orden en el servidor.");
    const pendingImg = result.document.subtests[0]!.items[0]!.images.find((img) => img.order === 2);
    expect(pendingImg).toMatchObject({
      id: null,
      resourceId: null,
      pendingFileId: "f-b",
      status: "CREATED",
    });
    expect(result.sent.uploads[slotKey]).toBeUndefined();
  });

  it("MEDIO: PUT incierto aplicado + recarga fallida + imagen borrada antes de reintentar → UNCERTAIN_IMAGE_OPERATION (no falso «edición externa»)", () => {
    const base = createCleanDocument({ baremos: [] });
    const reducer = createDocumentReducer(makeDeterministicDraftIdFactory(1410));

    // Imagen existente id=55 en order=1 se reemplaza por nueva.png, falla con 503 y luego se borra
    let mine = reducer(base, {
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
    const sent = createEmptySentSnapshot();
    const slotKey = uploadSlotKey({
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      optionDraftId: null,
      order: 1,
    });
    sent.uploads[slotKey] = {
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      optionDraftId: null,
      order: 1,
      pendingFileId: "f-new",
      fileName: "nueva.png",
      altText: "Figura estímulo",
      role: "ENUNCIADO",
    };

    mine = reducer(mine, {
      type: "DELETE_ITEM_IMAGE",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      imageDraftId: "img-55",
    });

    // El PUT sí aplicó en el servidor (resourceId 77 -> 995, storagePath con nueva.png)
    const theirs = structuredClone(base);
    theirs.subtests[0]!.items[0]!.images[0] = {
      ...theirs.subtests[0]!.items[0]!.images[0]!,
      resourceId: 995,
      previewUrl: "/items/images/resources/995",
      storagePath: "test-config/items/30/550e8400-e29b-41d4-a716-446655440000-nueva.png",
    };

    const result = reconcileVersionDocumentThreeWay({ base, mine, theirs, sent });
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]?.kind).toBe("UNCERTAIN_IMAGE_OPERATION");
    expect(result.conflicts[0]?.reason).not.toMatch(/modificada externamente/i);
    expect(result.conflicts[0]?.resolution?.intention).toBe("delete");

    // Aplicar mi cambio -> deja DELETED contra el nuevo baseline
    const applied = resolveUncertainImageConflict({
      document: mine,
      baseline: base,
      sent,
      resolution: result.conflicts[0]!.resolution!,
      choice: "apply_mine",
    });
    expect(applied.document.subtests[0]!.items[0]!.images[0]).toMatchObject({
      id: 55,
      resourceId: 995,
      status: "DELETED",
    });
    expect(applied.baseline?.subtests[0]!.items[0]!.images[0]).toMatchObject({
      id: 55,
      resourceId: 995,
      status: "EXISTING",
    });

    // Conservar imagen del servidor -> descarta el borrado y adopta 995 como EXISTING
    const kept = resolveUncertainImageConflict({
      document: mine,
      baseline: base,
      sent,
      resolution: result.conflicts[0]!.resolution!,
      choice: "keep_server",
    });
    expect(kept.document.subtests[0]!.items[0]!.images[0]).toMatchObject({
      id: 55,
      resourceId: 995,
      status: "EXISTING",
    });
  });

  it("Regla 1: sin intención posterior y nombre distinto en servidor → recurso ajeno sin UNCERTAIN_IMAGE_OPERATION", () => {
    const base = createCleanDocument({ baremos: [] });
    const reducer = createDocumentReducer(makeDeterministicDraftIdFactory(1420));

    const mine = reducer(base, {
      type: "ATTACH_ITEM_IMAGE",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      image: {
        draftId: "img-a",
        pendingFileId: "f-a",
        order: 2,
        altText: "Propia",
        role: "ENUNCIADO",
        fileName: "a.png",
      },
    });
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
      pendingFileId: "f-a",
      fileName: "a.png",
      altText: "Propia",
      role: "ENUNCIADO",
    };

    const theirs = structuredClone(base);
    theirs.subtests[0]!.items[0]!.images.push({
      id: 888,
      draftId: "img-888",
      sourceId: null,
      resourceId: 910,
      pendingFileId: null,
      previewUrl: "/items/images/resources/910",
      status: "EXISTING",
      order: 2,
      altText: "Propia",
      role: "ENUNCIADO",
      fileName: null,
      storagePath: "test-config/items/30/550e8400-e29b-41d4-a716-446655440000-ajena.png",
    });

    const result = reconcileVersionDocumentThreeWay({
      base,
      mine,
      theirs,
      sent,
      pendingFiles: { "f-a": new File(["a"], "a.png", { type: "image/png" }) },
    });
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]?.kind).toBe("image");
    expect(result.conflicts[0]?.reason).toBe("Otra imagen distinta ocupa el mismo orden en el servidor.");
    expect(result.sent.uploads[slotKey]).toBeUndefined();
  });

  it("Reglas 2 y 4: storagePath no parseable o metadatos editados tras 503 → conflicto manual UNCERTAIN_IMAGE_OPERATION sin escritura automática", () => {
    const base = createCleanDocument({ baremos: [] });
    const reducer = createDocumentReducer(makeDeterministicDraftIdFactory(1430));

    const mineUntouched = reducer(base, {
      type: "ATTACH_ITEM_IMAGE",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      image: {
        draftId: "img-a",
        pendingFileId: "f-a",
        order: 2,
        altText: "Propia",
        role: "ENUNCIADO",
        fileName: "a.png",
      },
    });
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
      pendingFileId: "f-a",
      fileName: "a.png",
      altText: "Propia",
      role: "ENUNCIADO",
    };

    // 1. storagePath sin formato {uuid}-...
    const theirsUnparseable = structuredClone(base);
    theirsUnparseable.subtests[0]!.items[0]!.images.push({
      id: 888,
      draftId: "img-888",
      sourceId: null,
      resourceId: 910,
      pendingFileId: null,
      previewUrl: "/items/images/resources/910",
      status: "EXISTING",
      order: 2,
      altText: "Propia",
      role: "ENUNCIADO",
      fileName: null,
      storagePath: "items/a.png",
    });

    const unparseableRes = reconcileVersionDocumentThreeWay({
      base,
      mine: mineUntouched,
      theirs: theirsUnparseable,
      sent,
      pendingFiles: { "f-a": new File(["a"], "a.png", { type: "image/png" }) },
    });
    expect(unparseableRes.conflicts).toHaveLength(1);
    expect(unparseableRes.conflicts[0]?.kind).toBe("UNCERTAIN_IMAGE_OPERATION");
    expect(unparseableRes.conflicts[0]?.resolution?.intention).toBe("reupload");

    // 2. storagePath válido pero altText editado después del error (requeriría escribir sobre el recurso)
    const mineEditedMeta = reducer(mineUntouched, {
      type: "UPDATE_ITEM_IMAGE",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      imageDraftId: "img-a",
      patch: { altText: "Alt editado tras 503" },
    });
    const theirsValid = structuredClone(base);
    theirsValid.subtests[0]!.items[0]!.images.push({
      id: 888,
      draftId: "img-888",
      sourceId: null,
      resourceId: 910,
      pendingFileId: null,
      previewUrl: "/items/images/resources/910",
      status: "EXISTING",
      order: 2,
      altText: "Propia",
      role: "ENUNCIADO",
      fileName: null,
      storagePath: "test-config/items/30/550e8400-e29b-41d4-a716-446655440000-a.png",
    });

    const editedMetaRes = reconcileVersionDocumentThreeWay({
      base,
      mine: mineEditedMeta,
      theirs: theirsValid,
      sent,
      pendingFiles: { "f-a": new File(["a"], "a.png", { type: "image/png" }) },
    });
    expect(editedMetaRes.conflicts).toHaveLength(1);
    expect(editedMetaRes.conflicts[0]?.kind).toBe("UNCERTAIN_IMAGE_OPERATION");
    expect(editedMetaRes.conflicts[0]?.resolution?.intention).toBe("reupload");
  });

  it("F3-FIX-8 (ALTO 1 - PUT): PUT incierto con coincidencia exacta de nombre, altText y role abre UNCERTAIN_IMAGE_OPERATION y conserva File y sent", () => {
    const base = createCleanDocument({ baremos: [] });
    const reducer = createDocumentReducer(makeDeterministicDraftIdFactory(1440));
    const file = new File(["new"], "estimulo.png", { type: "image/png", lastModified: 1234 });

    const mine = reducer(base, {
      type: "UPDATE_ITEM_IMAGE",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      imageDraftId: "img-55",
      patch: {
        resourceId: null,
        pendingFileId: "f-put",
        fileName: "estimulo.png",
        altText: "Figura estímulo",
        role: "ENUNCIADO",
      },
    });
    const sent = createEmptySentSnapshot();
    const slotKey = uploadSlotKey({
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      optionDraftId: null,
      order: 1,
    });
    sent.uploads[slotKey] = {
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      optionDraftId: null,
      order: 1,
      pendingFileId: "f-put",
      fileName: "estimulo.png",
      fileSize: file.size,
      lastModified: file.lastModified,
      altText: "Figura estímulo",
      role: "ENUNCIADO",
    };

    const theirs = structuredClone(base);
    theirs.subtests[0]!.items[0]!.images[0] = {
      ...theirs.subtests[0]!.items[0]!.images[0]!,
      resourceId: 950,
      previewUrl: "/items/images/resources/950",
      storagePath: "test-config/items/30/550e8400-e29b-41d4-a716-446655440000-estimulo.png",
    };

    const result = reconcileVersionDocumentThreeWay({
      base,
      mine,
      theirs,
      sent,
      pendingFiles: { "f-put": file },
    });
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]?.kind).toBe("UNCERTAIN_IMAGE_OPERATION");
    expect(result.conflicts[0]?.resolution?.intention).toBe("reupload");
    expect(result.document.subtests[0]!.items[0]!.images[0]).toMatchObject({
      resourceId: null,
      pendingFileId: "f-put",
    });
    expect(result.sent.uploads[slotKey]).toBeDefined();
  });

  it("F3-FIX-8 (ALTO 2): resolución antigua queda obsoleta si se adjunta otro archivo en la posición libre y no reemplaza al nuevo", () => {
    const base = createCleanDocument({ baremos: [] });
    const reducer = createDocumentReducer(makeDeterministicDraftIdFactory(1450));

    // POST incierto seguido de borrado local -> conflicto con localImage === null en order=2
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
      pendingFileId: "f-old",
      fileName: "vieja.png",
    };

    const theirs = structuredClone(base);
    theirs.subtests[0]!.items[0]!.images.push({
      id: 777,
      draftId: "img-777",
      sourceId: null,
      resourceId: 901,
      pendingFileId: null,
      previewUrl: "/items/images/resources/901",
      status: "EXISTING",
      order: 2,
      altText: "Vieja",
      role: "ENUNCIADO",
      fileName: null,
      storagePath: "test-config/items/30/550e8400-e29b-41d4-a716-446655440000-vieja.png",
    });

    const initial = reconcileVersionDocumentThreeWay({ base, mine: base, theirs, sent });
    expect(initial.conflicts).toHaveLength(1);
    const oldResolution = initial.conflicts[0]!.resolution!;
    expect(oldResolution.origin.localImage).toBeNull();
    expect(oldResolution.origin.remoteResourceId).toBe(901);

    // Después de aparecer el conflicto, el editor adjunta un archivo nuevo en la posición libre (#2)
    const afterAttach = reducer(base, {
      type: "ATTACH_ITEM_IMAGE",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      image: {
        draftId: "img-new-b",
        pendingFileId: "f-new-b",
        order: 2,
        altText: "Nueva B",
        role: "ENUNCIADO",
        fileName: "nueva-b.png",
      },
    });

    const resolved = resolveUncertainImageConflict({
      document: afterAttach,
      baseline: base,
      sent,
      resolution: oldResolution,
      choice: "keep_server",
    });

    expect(resolved.stale).toBe(true);
    expect(resolved.document).toBe(afterAttach);
    expect(resolved.document.subtests[0]!.items[0]!.images.find((img) => img.order === 2)).toMatchObject({
      draftId: "img-new-b",
      pendingFileId: "f-new-b",
      status: "CREATED",
    });
    expect(resolved.sent.uploads[slotKey]).toBeDefined();
  });

  it("F3-FIX-8 (MEDIO 1): POST aplicado con nombre no ASCII (estímulo😀.png) abre UNCERTAIN_IMAGE_OPERATION, nunca «ajena»", () => {
    const base = createCleanDocument({ baremos: [] });
    const reducer = createDocumentReducer(makeDeterministicDraftIdFactory(1460));
    const mine = reducer(base, {
      type: "ATTACH_ITEM_IMAGE",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      image: {
        draftId: "img-emoji",
        pendingFileId: "f-emoji",
        order: 2,
        altText: "Estímulo emoji",
        role: "ENUNCIADO",
        fileName: "estímulo😀.png",
      },
    });

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
      pendingFileId: "f-emoji",
      fileName: "estímulo😀.png",
      altText: "Estímulo emoji",
      role: "ENUNCIADO",
    };

    const theirs = structuredClone(base);
    theirs.subtests[0]!.items[0]!.images.push({
      id: 888,
      draftId: "img-888",
      sourceId: null,
      resourceId: 910,
      pendingFileId: null,
      previewUrl: "/items/images/resources/910",
      status: "EXISTING",
      order: 2,
      altText: "Estímulo emoji",
      role: "ENUNCIADO",
      fileName: null,
      storagePath: "test-config/items/30/550e8400-e29b-41d4-a716-446655440000-est_mulo_.png",
    });

    const result = reconcileVersionDocumentThreeWay({
      base,
      mine,
      theirs,
      sent,
      pendingFiles: { "f-emoji": new File(["x"], "estímulo😀.png", { type: "image/png" }) },
    });
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]?.kind).toBe("UNCERTAIN_IMAGE_OPERATION");
    expect(result.conflicts[0]?.reason).not.toMatch(/ajena|Otro usuario/i);

    // Incluso si el almacenamiento normalizara distinto un nombre no ASCII, Regla 1 no lo descarta
    const theirsDifferentNormalization = structuredClone(theirs);
    theirsDifferentNormalization.subtests[0]!.items[0]!.images[1]!.storagePath =
      "test-config/items/30/550e8400-e29b-41d4-a716-446655440000-estimulo.png";
    const nonAsciiAmbiguous = reconcileVersionDocumentThreeWay({
      base,
      mine,
      theirs: theirsDifferentNormalization,
      sent,
      pendingFiles: { "f-emoji": new File(["x"], "estímulo😀.png", { type: "image/png" }) },
    });
    expect(nonAsciiAmbiguous.conflicts).toHaveLength(1);
    expect(nonAsciiAmbiguous.conflicts[0]?.kind).toBe("UNCERTAIN_IMAGE_OPERATION");
  });

  it("F3-FIX-8 (MEDIO 1): PUT aplicado con nombre no ASCII seguido de borrado local abre UNCERTAIN_IMAGE_OPERATION", () => {
    const base = createCleanDocument({ baremos: [] });
    const reducer = createDocumentReducer(makeDeterministicDraftIdFactory(1470));

    let mine = reducer(base, {
      type: "UPDATE_ITEM_IMAGE",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      imageDraftId: "img-55",
      patch: {
        resourceId: null,
        pendingFileId: "f-emoji",
        fileName: "estímulo😀.png",
      },
    });
    const sent = createEmptySentSnapshot();
    const slotKey = uploadSlotKey({
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      optionDraftId: null,
      order: 1,
    });
    sent.uploads[slotKey] = {
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      optionDraftId: null,
      order: 1,
      pendingFileId: "f-emoji",
      fileName: "estímulo😀.png",
      altText: "Figura estímulo",
      role: "ENUNCIADO",
    };

    mine = reducer(mine, {
      type: "DELETE_ITEM_IMAGE",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      imageDraftId: "img-55",
    });

    const theirs = structuredClone(base);
    theirs.subtests[0]!.items[0]!.images[0] = {
      ...theirs.subtests[0]!.items[0]!.images[0]!,
      resourceId: 995,
      previewUrl: "/items/images/resources/995",
      storagePath: "test-config/items/30/550e8400-e29b-41d4-a716-446655440000-est_mulo_.png",
    };

    const result = reconcileVersionDocumentThreeWay({ base, mine, theirs, sent });
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]?.kind).toBe("UNCERTAIN_IMAGE_OPERATION");
    expect(result.conflicts[0]?.resolution?.intention).toBe("delete");
    expect(result.conflicts[0]?.reason).not.toMatch(/modificada externamente/i);
  });
});
