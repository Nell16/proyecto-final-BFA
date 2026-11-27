import {
  createDefaultDraftId,
  type DocumentAnswerKey,
  type DocumentItem,
  type DocumentOption,
  type DraftIdFactory,
  type ItemType,
  type ResponseType,
} from "./types";

export type ItemTemplateId =
  | "bfa_comparacion_imagenes"
  | "bfa_desplazamiento"
  | "bfa_espacial"
  | "razonamiento_verbal"
  | "opcion_multiple"
  | "verdadero_falso"
  | "numerica"
  | "texto_abierto";

export interface ItemTemplateOptionSpec {
  code: string;
  text: string;
  ordinalValue: number;
}

export interface ItemTemplateDefinition {
  id: ItemTemplateId;
  label: string;
  description: string;
  itemType: ItemType;
  responseType: ResponseType;
  stimulusRole: string;
  defaultInstruction: string;
  options: readonly ItemTemplateOptionSpec[];
  createInitialAnswerKey: boolean;
  requiresManualReview: boolean;
}

const FOUR_IMAGE_OPTIONS: readonly ItemTemplateOptionSpec[] = [
  { code: "A", text: "", ordinalValue: 1 },
  { code: "B", text: "", ordinalValue: 2 },
  { code: "C", text: "", ordinalValue: 3 },
  { code: "D", text: "", ordinalValue: 4 },
];

const FOUR_TEXT_OPTIONS: readonly ItemTemplateOptionSpec[] = [
  { code: "A", text: "Opción A", ordinalValue: 1 },
  { code: "B", text: "Opción B", ordinalValue: 2 },
  { code: "C", text: "Opción C", ordinalValue: 3 },
  { code: "D", text: "Opción D", ordinalValue: 4 },
];

export const ITEM_TEMPLATES: Record<ItemTemplateId, ItemTemplateDefinition> = {
  bfa_comparacion_imagenes: {
    id: "bfa_comparacion_imagenes",
    label: "BFA · Comparación de imágenes",
    description: "Estímulo visual con 4 opciones de imagen (A–D) y respuesta única.",
    itemType: "COMPARACION_IMAGENES",
    responseType: "OPCION_UNICA",
    stimulusRole: "ESTIMULO",
    defaultInstruction: "Compare la figura modelo y seleccione la opción equivalente.",
    options: FOUR_IMAGE_OPTIONS,
    createInitialAnswerKey: false,
    requiresManualReview: false,
  },
  bfa_desplazamiento: {
    id: "bfa_desplazamiento",
    label: "BFA · Desplazamiento",
    description: "Texto e imagen con 4 opciones (A–D) y respuesta única.",
    itemType: "TEXTO_E_IMAGEN",
    responseType: "OPCION_UNICA",
    stimulusRole: "ENUNCIADO",
    defaultInstruction: "Observe el desplazamiento indicado y seleccione la opción correcta.",
    options: FOUR_IMAGE_OPTIONS,
    createInitialAnswerKey: false,
    requiresManualReview: false,
  },
  bfa_espacial: {
    id: "bfa_espacial",
    label: "BFA · Espacial",
    description: "Solo imagen con 4 opciones visuales (A–D) y respuesta única.",
    itemType: "SOLO_IMAGEN",
    responseType: "OPCION_UNICA",
    stimulusRole: "ESTIMULO",
    defaultInstruction: "Observe la figura y seleccione la opción espacial correcta.",
    options: FOUR_IMAGE_OPTIONS,
    createInitialAnswerKey: false,
    requiresManualReview: false,
  },
  razonamiento_verbal: {
    id: "razonamiento_verbal",
    label: "Razonamiento verbal",
    description: "Ítem verbal con 4 opciones de texto (A–D) y respuesta única.",
    itemType: "RAZONAMIENTO_VERBAL",
    responseType: "OPCION_UNICA",
    stimulusRole: "ENUNCIADO",
    defaultInstruction: "Lea el enunciado y seleccione la opción correcta.",
    options: FOUR_TEXT_OPTIONS,
    createInitialAnswerKey: false,
    requiresManualReview: false,
  },
  opcion_multiple: {
    id: "opcion_multiple",
    label: "Opción múltiple",
    description: "Texto con 4 opciones (A–D) permitiendo seleccionar varias respuestas.",
    itemType: "SOLO_TEXTO",
    responseType: "OPCION_MULTIPLE",
    stimulusRole: "ENUNCIADO",
    defaultInstruction: "Seleccione todas las opciones correctas.",
    options: FOUR_TEXT_OPTIONS,
    createInitialAnswerKey: false,
    requiresManualReview: false,
  },
  verdadero_falso: {
    id: "verdadero_falso",
    label: "Verdadero / Falso",
    description: "Ítem dicotómico con opciones V (Verdadero) y F (Falso).",
    itemType: "SOLO_TEXTO",
    responseType: "VERDADERO_FALSO",
    stimulusRole: "ENUNCIADO",
    defaultInstruction: "Indique si la afirmación es verdadera o falsa.",
    options: [
      { code: "V", text: "Verdadero", ordinalValue: 1 },
      { code: "F", text: "Falso", ordinalValue: 2 },
    ],
    createInitialAnswerKey: false,
    requiresManualReview: false,
  },
  numerica: {
    id: "numerica",
    label: "Numérica",
    description: "Respuesta numérica exacta o con tolerancia.",
    itemType: "SOLO_TEXTO",
    responseType: "NUMERICA",
    stimulusRole: "ENUNCIADO",
    defaultInstruction: "Ingrese el valor numérico correspondiente.",
    options: [],
    createInitialAnswerKey: true,
    requiresManualReview: false,
  },
  texto_abierto: {
    id: "texto_abierto",
    label: "Texto abierto",
    description: "Respuesta libre marcada para revisión manual.",
    itemType: "SOLO_TEXTO",
    responseType: "TEXTO_ABIERTO",
    stimulusRole: "ENUNCIADO",
    defaultInstruction: "Escriba su respuesta en el espacio proporcionado.",
    options: [],
    createInitialAnswerKey: true,
    requiresManualReview: true,
  },
};

export const ITEM_TEMPLATE_LIST: readonly ItemTemplateDefinition[] = Object.values(ITEM_TEMPLATES);

export interface CreateItemFromTemplateInput {
  code: string;
  order: number;
  draftIdFactory?: DraftIdFactory;
  defaultRuleId?: number | null;
}

export function createItemFromTemplate(
  templateId: ItemTemplateId,
  input: CreateItemFromTemplateInput,
): DocumentItem {
  const template = ITEM_TEMPLATES[templateId];
  const makeId = input.draftIdFactory ?? createDefaultDraftId;

  const options: DocumentOption[] = template.options.map((opt, idx) => ({
    id: null,
    draftId: makeId("opt"),
    sourceId: null,
    status: "CREATED",
    code: opt.code,
    text: opt.text,
    order: idx + 1,
    ordinalValue: opt.ordinalValue,
    images: [],
  }));

  const answerKey: DocumentAnswerKey | null = template.createInitialAnswerKey
    ? {
        id: null,
        draftId: makeId("key"),
        sourceId: null,
        status: "CREATED",
        ruleId: input.defaultRuleId ?? null,
        correctOptionDraftId: null,
        correctOptionId: null,
        expectedText: null,
        expectedNumber: null,
        numericTolerance: template.responseType === "NUMERICA" ? 0 : null,
        score: 1,
        requiresManualReview: template.requiresManualReview,
      }
    : null;

  return {
    id: null,
    draftId: makeId("item"),
    sourceId: null,
    status: "CREATED",
    code: input.code,
    itemType: template.itemType,
    responseType: template.responseType,
    prompt: "",
    instruction: template.defaultInstruction,
    order: input.order,
    baseScore: 1,
    timeLimitSeconds: null,
    required: true,
    confidential: true,
    images: [],
    options,
    answerKey,
  };
}
