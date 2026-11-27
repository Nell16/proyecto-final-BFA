import type { VersionDocument } from "../types";

export function makeDeterministicDraftIdFactory(prefixStart = 1): (prefix?: string) => string {
  let seq = prefixStart - 1;
  return (prefix = "draft") => {
    seq += 1;
    return `${prefix}-${seq}`;
  };
}

export function createCleanDocument(overrides?: Partial<VersionDocument>): VersionDocument {
  const base: VersionDocument = {
    version: {
      versionId: 10,
      testId: 1,
      testCode: "BFA-2026",
      testName: "Batería Factorial de Aptitudes",
      number: "1.0",
      status: "BORRADOR",
      strategyId: 1,
      instructions: "Lea atentamente las instrucciones generales.",
      timeLimitSeconds: 3600,
      randomizeSubtests: false,
      randomizeItems: true,
      metaDirty: false,
    },
    subtests: [
      {
        id: 20,
        draftId: "sub-20",
        sourceId: null,
        status: "EXISTING",
        code: "MEM",
        name: "Memoria Visual",
        description: "Subtest de memoria",
        instructions: "Observe las figuras.",
        order: 1,
        timeLimitSeconds: 600,
        randomizeItems: true,
        randomizeOptions: false,
        required: true,
        strategyId: 1,
        defaultRuleId: 80,
        items: [
          {
            id: 30,
            draftId: "item-30",
            sourceId: null,
            status: "EXISTING",
            code: "IT-1",
            itemType: "TEXTO_E_IMAGEN",
            responseType: "OPCION_UNICA",
            prompt: "¿Cuál figura continúa la serie?",
            instruction: "Seleccione una opción.",
            order: 1,
            baseScore: 1,
            timeLimitSeconds: null,
            required: true,
            confidential: true,
            images: [
              {
                id: 55,
                draftId: "img-55",
                sourceId: null,
                resourceId: 77,
                pendingFileId: null,
                previewUrl: "/items/images/resources/77",
                status: "EXISTING",
                order: 1,
                altText: "Figura estímulo",
                role: "ENUNCIADO",
                fileName: "estimulo.png",
              },
            ],
            options: [
              {
                id: 40,
                draftId: "opt-40",
                sourceId: null,
                status: "EXISTING",
                code: "A",
                text: "Opción A",
                order: 1,
                ordinalValue: 1,
                images: [],
              },
              {
                id: 41,
                draftId: "opt-41",
                sourceId: null,
                status: "EXISTING",
                code: "B",
                text: "Opción B",
                order: 2,
                ordinalValue: 2,
                images: [],
              },
            ],
            answerKey: {
              id: 50,
              draftId: "key-50",
              sourceId: null,
              status: "EXISTING",
              ruleId: 80,
              correctOptionDraftId: "opt-40",
              correctOptionId: 40,
              expectedText: null,
              expectedNumber: null,
              numericTolerance: null,
              score: 1,
              requiresManualReview: false,
            },
          },
        ],
      },
    ],
    baremos: [
      {
        id: 90,
        draftId: "bar-90",
        status: "EXISTING",
        dimensionId: null,
        code: "BAR-GEN",
        name: "Baremo General",
        description: "Normas generales",
        normativeGroup: "General",
        ranges: [
          {
            id: 100,
            draftId: "rng-100",
            status: "EXISTING",
            minScore: 0,
            maxScore: 10,
            percentile: 25,
            category: "Bajo",
            interpretation: "Por debajo del promedio",
            recommendation: "Reforzar",
            order: 1,
          },
          {
            id: 101,
            draftId: "rng-101",
            status: "EXISTING",
            minScore: 11,
            maxScore: 20,
            percentile: 75,
            category: "Alto",
            interpretation: "Por encima del promedio",
            recommendation: "Mantener",
            order: 2,
          },
        ],
      },
    ],
    dirtyNodeIds: [],
    loadedAt: "2026-11-25T12:00:00.000Z",
  };

  return { ...base, ...overrides };
}
