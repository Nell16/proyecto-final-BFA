import { z } from "zod";
import { ApiError } from "../errors";
import { serverDateTime } from "./datetime";

// ---------------------------------------------------------------------------
// Códigos de error de bloqueo en runtime (409)
// ---------------------------------------------------------------------------

export const RUNTIME_ERROR_CODES = [
  "SESION_PAUSADA",
  "SESION_NO_ABIERTA",
  "SESION_FINALIZADA",
  "TIEMPO_AGOTADO",
  "TOKEN_EXPIRADO",
  "ASIGNACION_NO_OPERABLE",
] as const;

export type RuntimeErrorCode = (typeof RUNTIME_ERROR_CODES)[number];

const RUNTIME_ERROR_CODE_SET: ReadonlySet<string> = new Set(RUNTIME_ERROR_CODES);

export function isRuntimeBlocked(err: unknown): err is ApiError {
  return err instanceof ApiError && err.status === 409 && RUNTIME_ERROR_CODE_SET.has(err.code);
}

// ---------------------------------------------------------------------------
// Enums canónicos
// ---------------------------------------------------------------------------

export const SESSION_STATUSES = [
  "PROGRAMADA",
  "ABIERTA",
  "PAUSADA",
  "CERRADA",
  "CANCELADA",
] as const;

export const SessionStatusSchema = z
  .enum(SESSION_STATUSES)
  .or(z.literal("DESCONOCIDO"))
  .catch("DESCONOCIDO");

export type SessionStatus = z.output<typeof SessionStatusSchema>;

export const ATTEMPT_STATUSES = [
  "NO_INICIADO",
  "EN_PROGRESO",
  "COMPLETADO",
  "INTERRUMPIDO",
  "ANULADO",
] as const;

export const AttemptStatusSchema = z
  .enum(ATTEMPT_STATUSES)
  .or(z.literal("DESCONOCIDO"))
  .catch("DESCONOCIDO");

export type AttemptStatus = z.output<typeof AttemptStatusSchema>;

export const TIPO_ITEM_VALUES = [
  "SOLO_TEXTO",
  "SOLO_IMAGEN",
  "TEXTO_E_IMAGEN",
  "COMPARACION_IMAGENES",
  "RAZONAMIENTO_VERBAL",
] as const;

export const TipoItemSchema = z.enum(TIPO_ITEM_VALUES);
export type TipoItem = z.output<typeof TipoItemSchema>;

export const TIPO_RESPUESTA_VALUES = [
  "OPCION_UNICA",
  "OPCION_MULTIPLE",
  "TEXTO_ABIERTO",
  "NUMERICA",
  "VERDADERO_FALSO",
] as const;

export const TipoRespuestaSchema = z.enum(TIPO_RESPUESTA_VALUES);
export type TipoRespuesta = z.output<typeof TipoRespuestaSchema>;

// ---------------------------------------------------------------------------
// Helpers internos de transformación
// ---------------------------------------------------------------------------

function indexToOptionLabel(index: number): string {
  let current = index;
  let label = "";
  do {
    label = String.fromCharCode(65 + (current % 26)) + label;
    current = Math.floor(current / 26) - 1;
  } while (current >= 0);
  return label;
}

function sortByOrder<T extends { order: number }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.order - b.order);
}

// ---------------------------------------------------------------------------
// Tipos de dominio (shape explícito para preservar propiedades opcionales)
// ---------------------------------------------------------------------------

interface RuntimeImageDomain {
  id: number;
  url: string;
  altText?: string;
  order: number;
  role?: string;
}

interface RuntimeOptionDomain {
  id: number;
  code?: string;
  label: string;
  text?: string;
  order: number;
  images: RuntimeImageDomain[];
}

interface SavedAnswerDomain {
  selectedOptionIds: number[];
  textAnswer?: string;
  numericAnswer?: number;
  timeUsedSeconds?: number;
}

interface RuntimeItemDomain {
  id: number;
  code?: string;
  order: number;
  itemType: TipoItem;
  responseType: TipoRespuesta;
  prompt?: string;
  instruction?: string;
  images: RuntimeImageDomain[];
  options: RuntimeOptionDomain[];
  savedAnswer?: SavedAnswerDomain;
}

interface SubtestTimingDomain {
  startedAt?: string;
  remainingSeconds?: number;
  paused?: boolean;
  serverNow?: string;
}

interface RuntimeSubtestDomain {
  id: number;
  code: string;
  name: string;
  instructions?: string;
  order: number;
  timeLimitSeconds: number | null;
  randomizeItems: boolean;
  randomizeOptions: boolean;
  status: AttemptStatus;
  items: RuntimeItemDomain[];
  timing?: SubtestTimingDomain;
}

interface EvaluationDomain {
  attemptId: number | null;
  assignmentId: number;
  sessionId: number;
  participantName: string;
  sessionName: string;
  sessionStatus: SessionStatus;
  attemptStatus: AttemptStatus;
  pausedAt?: string;
  subtests: RuntimeSubtestDomain[];
}

interface RuntimeAttemptDomain {
  id: number;
  assignmentId?: number;
  status: AttemptStatus;
  startedAt?: string;
  finishedAt?: string;
  lastSubtestId?: number;
  lastActivityAt?: string;
  totalTimeSeconds?: number;
  deviceInfo?: string;
}

interface SubtestAttemptDomain {
  id: number;
  attemptId?: number;
  subtestId?: number;
  status: AttemptStatus;
  startedAt?: string;
  finishedAt?: string;
  timeUsedSeconds?: number;
  timeLimitSeconds?: number | null;
  timing?: SubtestTimingDomain;
}

interface SavedAnswerReceiptDomain {
  id: number;
  attemptId?: number;
  itemId?: number;
  textAnswer?: string;
  numericAnswer?: number;
  answeredAt?: string;
  timeUsedSeconds?: number;
  isFinal?: boolean;
  requiresManualReview?: boolean;
}

// ---------------------------------------------------------------------------
// Acceso del participante
// ---------------------------------------------------------------------------

export const ParticipantAccessWireSchema = z
  .object({
    assignmentId: z.number().int(),
    participantId: z.string(),
    accessToken: z.string(),
    tokenType: z.string(),
  })
  .loose();

export const ParticipantAccessSchema = ParticipantAccessWireSchema.transform((raw) => ({
  assignmentId: raw.assignmentId,
  participantId: raw.participantId,
  accessToken: raw.accessToken,
  tokenType: raw.tokenType,
}));

export type ParticipantAccess = z.output<typeof ParticipantAccessSchema>;

// ---------------------------------------------------------------------------
// Imágenes, opciones, ítems, subtests y evaluación (/evaluacion-participante/yo)
// ---------------------------------------------------------------------------

export const RuntimeImageWireSchema = z
  .object({
    imageId: z.number().int(),
    url: z.string(),
    altText: z.string().nullish(),
    order: z.number().int(),
    role: z.string().nullish(),
  })
  .loose();

export const RuntimeImageSchema = RuntimeImageWireSchema.transform(
  (raw): RuntimeImageDomain => ({
    id: raw.imageId,
    url: raw.url,
    order: raw.order,
    ...(raw.altText != null ? { altText: raw.altText } : {}),
    ...(raw.role != null ? { role: raw.role } : {}),
  }),
);

export type RuntimeImage = z.output<typeof RuntimeImageSchema>;

export const RuntimeOptionWireSchema = z
  .object({
    optionId: z.number().int(),
    code: z.string().nullish(),
    label: z.string().nullish(),
    text: z.string().nullish(),
    order: z.number().int(),
    ordinalValue: z.number().nullish(),
    images: z
      .array(RuntimeImageSchema)
      .nullish()
      .transform((list) => sortByOrder(list ?? [])),
  })
  .loose();

function toRuntimeOption(
  raw: z.output<typeof RuntimeOptionWireSchema>,
  index: number,
): RuntimeOptionDomain {
  const explicitLabel = raw.label?.trim();
  return {
    id: raw.optionId,
    label: explicitLabel || indexToOptionLabel(index),
    order: raw.order,
    images: raw.images,
    ...(raw.code != null ? { code: raw.code } : {}),
    ...(raw.text != null ? { text: raw.text } : {}),
  };
}

export const RuntimeOptionSchema = RuntimeOptionWireSchema.transform((raw) => toRuntimeOption(raw, 0));
export type RuntimeOption = z.output<typeof RuntimeOptionSchema>;

export const SavedAnswerWireSchema = z
  .object({
    selectedOptionIds: z
      .array(z.number().int())
      .nullish()
      .transform((ids) => ids ?? []),
    textAnswer: z.string().nullish(),
    numericAnswer: z.number().nullish(),
    timeUsedSeconds: z.number().int().nullish(),
  })
  .loose();

export const SavedAnswerSchema = SavedAnswerWireSchema.transform(
  (raw): SavedAnswerDomain => ({
    selectedOptionIds: raw.selectedOptionIds,
    ...(raw.textAnswer != null ? { textAnswer: raw.textAnswer } : {}),
    ...(raw.numericAnswer != null ? { numericAnswer: raw.numericAnswer } : {}),
    ...(raw.timeUsedSeconds != null ? { timeUsedSeconds: raw.timeUsedSeconds } : {}),
  }),
);

export type SavedAnswer = z.output<typeof SavedAnswerSchema>;

export const RuntimeItemWireSchema = z
  .object({
    itemId: z.number().int(),
    code: z.string().nullish(),
    itemType: TipoItemSchema,
    responseType: TipoRespuestaSchema,
    prompt: z.string().nullish(),
    instruction: z.string().nullish(),
    order: z.number().int(),
    timeLimitSeconds: z.number().int().nullish(),
    required: z.boolean().optional(),
    images: z
      .array(RuntimeImageSchema)
      .nullish()
      .transform((list) => sortByOrder(list ?? [])),
    options: z
      .array(RuntimeOptionWireSchema)
      .nullish()
      .transform((list) => sortByOrder(list ?? []).map((opt, idx) => toRuntimeOption(opt, idx))),
    savedAnswer: SavedAnswerSchema.nullish(),
  })
  .loose();

export const RuntimeItemSchema = RuntimeItemWireSchema.transform(
  (raw): RuntimeItemDomain => ({
    id: raw.itemId,
    order: raw.order,
    itemType: raw.itemType,
    responseType: raw.responseType,
    images: raw.images,
    options: raw.options,
    ...(raw.code != null ? { code: raw.code } : {}),
    ...(raw.prompt != null ? { prompt: raw.prompt } : {}),
    ...(raw.instruction != null ? { instruction: raw.instruction } : {}),
    ...(raw.savedAnswer != null ? { savedAnswer: raw.savedAnswer } : {}),
  }),
);

export type RuntimeItem = z.output<typeof RuntimeItemSchema>;

function extractSubtestTiming(raw: {
  startedAt?: string | null;
  remainingSeconds?: number | null;
  paused?: boolean | null;
  serverNow?: string | null;
}): SubtestTimingDomain | undefined {
  const timing: SubtestTimingDomain = {};
  if (raw.startedAt != null) timing.startedAt = raw.startedAt;
  if (raw.remainingSeconds != null) timing.remainingSeconds = raw.remainingSeconds;
  if (raw.paused != null) timing.paused = raw.paused;
  if (raw.serverNow != null) timing.serverNow = raw.serverNow;
  return Object.keys(timing).length > 0 ? timing : undefined;
}

export const RuntimeSubtestWireSchema = z
  .object({
    subtestId: z.number().int(),
    code: z.string(),
    name: z.string(),
    instructions: z.string().nullish(),
    order: z.number().int(),
    timeLimitSeconds: z.number().int().nullish(),
    randomizeItems: z.boolean().default(false),
    randomizeOptions: z.boolean().default(false),
    status: AttemptStatusSchema,
    startedAt: serverDateTime.nullish(),
    remainingSeconds: z.number().int().nullish(),
    paused: z.boolean().nullish(),
    serverNow: serverDateTime.nullish(),
    items: z
      .array(RuntimeItemSchema)
      .nullish()
      .transform((list) => sortByOrder(list ?? [])),
  })
  .loose();

export const RuntimeSubtestSchema = RuntimeSubtestWireSchema.transform((raw): RuntimeSubtestDomain => {
  const timing = extractSubtestTiming(raw);
  return {
    id: raw.subtestId,
    code: raw.code,
    name: raw.name,
    order: raw.order,
    timeLimitSeconds: raw.timeLimitSeconds ?? null,
    randomizeItems: raw.randomizeItems,
    randomizeOptions: raw.randomizeOptions,
    status: raw.status,
    items: raw.items,
    ...(raw.instructions != null ? { instructions: raw.instructions } : {}),
    ...(timing !== undefined ? { timing } : {}),
  };
});

export type RuntimeSubtest = z.output<typeof RuntimeSubtestSchema>;

export const EvaluationWireSchema = z
  .object({
    id: z.number().int().nullish(),
    assignmentId: z.number().int(),
    sessionId: z.number().int(),
    participantDisplayName: z.string(),
    sessionName: z.string(),
    sessionStatus: SessionStatusSchema,
    pausedAt: serverDateTime.nullish(),
    attemptStatus: AttemptStatusSchema,
    subtests: z
      .array(RuntimeSubtestSchema)
      .nullish()
      .transform((list) => sortByOrder(list ?? [])),
  })
  .loose();

export const EvaluationSchema = EvaluationWireSchema.transform(
  (raw): EvaluationDomain => ({
    attemptId: raw.id ?? null,
    assignmentId: raw.assignmentId,
    sessionId: raw.sessionId,
    participantName: raw.participantDisplayName,
    sessionName: raw.sessionName,
    sessionStatus: raw.sessionStatus,
    attemptStatus: raw.attemptStatus,
    subtests: raw.subtests,
    ...(raw.pausedAt != null ? { pausedAt: raw.pausedAt } : {}),
  }),
);

export type Evaluation = z.output<typeof EvaluationSchema>;

// ---------------------------------------------------------------------------
// Respuestas de endpoints de ejecución (EntityView de intento, subtest, respuesta)
// ---------------------------------------------------------------------------

export const RuntimeAttemptWireSchema = z
  .object({
    id: z.number().int(),
    asignacionId: z.number().int().nullish(),
    iniciadoEn: serverDateTime.nullish(),
    finalizadoEn: serverDateTime.nullish(),
    estado: AttemptStatusSchema,
    ultimoSubtestId: z.number().int().nullish(),
    ultimaActividadEn: serverDateTime.nullish(),
    tiempoTotalSegundos: z.number().int().nullish(),
    informacionDispositivo: z.string().nullish(),
  })
  .loose();

export const RuntimeAttemptSchema = RuntimeAttemptWireSchema.transform(
  (raw): RuntimeAttemptDomain => ({
    id: raw.id,
    status: raw.estado,
    ...(raw.asignacionId != null ? { assignmentId: raw.asignacionId } : {}),
    ...(raw.iniciadoEn != null ? { startedAt: raw.iniciadoEn } : {}),
    ...(raw.finalizadoEn != null ? { finishedAt: raw.finalizadoEn } : {}),
    ...(raw.ultimoSubtestId != null ? { lastSubtestId: raw.ultimoSubtestId } : {}),
    ...(raw.ultimaActividadEn != null ? { lastActivityAt: raw.ultimaActividadEn } : {}),
    ...(raw.tiempoTotalSegundos != null ? { totalTimeSeconds: raw.tiempoTotalSegundos } : {}),
    ...(raw.informacionDispositivo != null ? { deviceInfo: raw.informacionDispositivo } : {}),
  }),
);

export type RuntimeAttempt = z.output<typeof RuntimeAttemptSchema>;

export const SubtestAttemptWireSchema = z
  .object({
    id: z.number().int(),
    intentoId: z.number().int().nullish(),
    sesionSubtestId: z.number().int().nullish(),
    subtestId: z.number().int().nullish(),
    iniciadoEn: serverDateTime.nullish(),
    finalizadoEn: serverDateTime.nullish(),
    estado: AttemptStatusSchema,
    tiempoUsadoSegundos: z.number().int().nullish(),
    startedAt: serverDateTime.nullish(),
    timeLimitSeconds: z.number().int().nullish(),
    remainingSeconds: z.number().int().nullish(),
    paused: z.boolean().nullish(),
    serverNow: serverDateTime.nullish(),
  })
  .loose();

export const SubtestAttemptSchema = SubtestAttemptWireSchema.transform((raw): SubtestAttemptDomain => {
  const timing = extractSubtestTiming(raw);
  const startedAt = raw.startedAt ?? raw.iniciadoEn ?? undefined;
  return {
    id: raw.id,
    status: raw.estado,
    ...(raw.intentoId != null ? { attemptId: raw.intentoId } : {}),
    ...(raw.subtestId != null ? { subtestId: raw.subtestId } : {}),
    ...(startedAt !== undefined ? { startedAt } : {}),
    ...(raw.finalizadoEn != null ? { finishedAt: raw.finalizadoEn } : {}),
    ...(raw.tiempoUsadoSegundos != null ? { timeUsedSeconds: raw.tiempoUsadoSegundos } : {}),
    ...(raw.timeLimitSeconds !== undefined ? { timeLimitSeconds: raw.timeLimitSeconds } : {}),
    ...(timing !== undefined ? { timing } : {}),
  };
});

export type SubtestAttempt = z.output<typeof SubtestAttemptSchema>;

export const SavedAnswerReceiptWireSchema = z
  .object({
    id: z.number().int(),
    intentoId: z.number().int().nullish(),
    itemId: z.number().int().nullish(),
    respuestaTextoAbierto: z.string().nullish(),
    respuestaNumerica: z.number().nullish(),
    respondidoEn: serverDateTime.nullish(),
    tiempoUsadoSegundos: z.number().int().nullish(),
    esFinal: z.boolean().nullish(),
    requiereRevisionManual: z.boolean().nullish(),
  })
  .loose();

export const SavedAnswerReceiptSchema = SavedAnswerReceiptWireSchema.transform(
  (raw): SavedAnswerReceiptDomain => ({
    id: raw.id,
    ...(raw.intentoId != null ? { attemptId: raw.intentoId } : {}),
    ...(raw.itemId != null ? { itemId: raw.itemId } : {}),
    ...(raw.respuestaTextoAbierto != null ? { textAnswer: raw.respuestaTextoAbierto } : {}),
    ...(raw.respuestaNumerica != null ? { numericAnswer: raw.respuestaNumerica } : {}),
    ...(raw.respondidoEn != null ? { answeredAt: raw.respondidoEn } : {}),
    ...(raw.tiempoUsadoSegundos != null ? { timeUsedSeconds: raw.tiempoUsadoSegundos } : {}),
    ...(raw.esFinal != null ? { isFinal: raw.esFinal } : {}),
    ...(raw.requiereRevisionManual != null ? { requiresManualReview: raw.requiereRevisionManual } : {}),
  }),
);

export const SavedAnswerReceiptListSchema = z.array(SavedAnswerReceiptSchema);

export type SavedAnswerReceipt = z.output<typeof SavedAnswerReceiptSchema>;

/**
 * Resultado por ítem de `POST /intentos/{id}/respuestas/bulk-sync` (backend `BulkSyncResult`):
 * `{ itemId, status: "GUARDADA" | "RECHAZADA", code, answerId }`. Un `status` desconocido se conserva como string
 * para que el llamador lo trate como "no confirmado".
 */
export const BulkSyncResultSchema = z
  .object({
    itemId: z.number().int(),
    status: z.string(),
    code: z.string().nullish().transform((v) => v ?? null),
    answerId: z.number().int().nullish().transform((v) => v ?? null),
  })
  .loose();
export type BulkSyncResult = z.output<typeof BulkSyncResultSchema>;
