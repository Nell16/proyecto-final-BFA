import { participantClient } from "../client";
import { ApiError, unwrap, type ApiEnvelope } from "../errors";
import { z } from "zod";
import { parseOrThrow } from "../schemas/parse";
import {
  BulkSyncResultSchema,
  EvaluationSchema,
  ParticipantAccessSchema,
  RUNTIME_ERROR_CODES,
  RuntimeAttemptSchema,
  RuntimeSubtestSchema,
  SavedAnswerReceiptSchema,
  SubtestAttemptSchema,
  isRuntimeBlocked,
  type BulkSyncResult,
  type Evaluation,
  type ParticipantAccess,
  type RuntimeAttempt,
  type RuntimeErrorCode,
  type RuntimeSubtest,
  type SavedAnswerReceipt,
  type SubtestAttempt,
} from "../schemas/runtime";

export { RUNTIME_ERROR_CODES, isRuntimeBlocked };
export type { RuntimeErrorCode };

// ---------------------------------------------------------------------------
// Tipos de petición
// ---------------------------------------------------------------------------

export interface ParsedAccessCode {
  assignmentId: number;
  token: string;
}

export interface ValidateAccessRequest {
  assignmentId: number;
  token: string;
}

export interface StartAttemptRequest {
  assignmentId: number;
  deviceInfo: string;
}

export interface SaveAnswerRequest {
  itemId: number;
  selectedOptionIds: number[];
  textAnswer?: string;
  numericAnswer?: number;
  timeUsedSeconds?: number;
}

export interface FinishRequest {
  timeSeconds: number;
}

// ---------------------------------------------------------------------------
// Código de acceso
// ---------------------------------------------------------------------------

const INVALID_ACCESS_CODE_MESSAGE =
  "El código de acceso no es válido. Use el formato <asignacion>-<token> o una URL que termine en /evaluacion/<asignacion>-<token>.";

function invalidAccessCodeError(): ApiError {
  return new ApiError({
    status: 0,
    code: "INVALID_ACCESS_CODE",
    message: INVALID_ACCESS_CODE_MESSAGE,
  });
}

/**
 * Acepta códigos `"123-abc..."` o URLs completas que terminen en `/evaluacion/123-abc`.
 * Lanza `ApiError` con code `"INVALID_ACCESS_CODE"` si el formato no es válido.
 */
export function parseAccessCode(input: string): ParsedAccessCode {
  const trimmed = input.trim();
  if (!trimmed) {
    throw invalidAccessCodeError();
  }

  let codePart = trimmed;

  if (trimmed.includes("://") || trimmed.startsWith("/")) {
    let pathname: string;
    if (trimmed.startsWith("/")) {
      pathname = trimmed.split(/[?#]/, 1)[0] ?? "";
    } else {
      try {
        pathname = new URL(trimmed).pathname;
      } catch {
        throw invalidAccessCodeError();
      }
    }
    const normalizedPath = pathname.replace(/\/+$/, "");
    const match = /\/evaluacion\/([^/]+)$/.exec(normalizedPath);
    if (!match?.[1]) {
      throw invalidAccessCodeError();
    }
    try {
      codePart = decodeURIComponent(match[1]);
    } catch {
      throw invalidAccessCodeError();
    }
  } else if (trimmed.includes("/")) {
    const withoutQuery = (trimmed.split(/[?#]/, 1)[0] ?? "").replace(/\/+$/, "");
    const match = /(?:^|\/)evaluacion\/([^/]+)$/.exec(withoutQuery);
    if (!match?.[1]) {
      throw invalidAccessCodeError();
    }
    try {
      codePart = decodeURIComponent(match[1]);
    } catch {
      throw invalidAccessCodeError();
    }
  }

  const separatorIndex = codePart.indexOf("-");
  if (separatorIndex <= 0 || separatorIndex === codePart.length - 1) {
    throw invalidAccessCodeError();
  }

  const assignmentPart = codePart.slice(0, separatorIndex);
  const token = codePart.slice(separatorIndex + 1).trim();

  if (!/^\d+$/.test(assignmentPart) || !token || /\s/.test(token)) {
    throw invalidAccessCodeError();
  }

  const assignmentId = Number(assignmentPart);
  if (!Number.isSafeInteger(assignmentId) || assignmentId <= 0) {
    throw invalidAccessCodeError();
  }

  return { assignmentId, token };
}

// ---------------------------------------------------------------------------
// Endpoints de runtime del participante
// ---------------------------------------------------------------------------

export async function validateAccess(input: string | ValidateAccessRequest): Promise<ParticipantAccess> {
  const payload = typeof input === "string" ? parseAccessCode(input) : input;
  const res = await participantClient.post<ApiEnvelope<unknown>>("/acceso-participante/validar", payload);
  return parseOrThrow(ParticipantAccessSchema, unwrap(res), "POST /acceso-participante/validar");
}

export interface GetEvaluationOptions {
  /** Ver `AxiosRequestConfig.isStillRelevant`: un 401 de una petición ya obsoleta no cierra la sesión. */
  isStillRelevant?: () => boolean;
}

export async function getEvaluation(options: GetEvaluationOptions = {}): Promise<Evaluation> {
  const res = await participantClient.get<ApiEnvelope<unknown>>("/evaluacion-participante/yo", {
    isStillRelevant: options.isStillRelevant,
  });
  return parseOrThrow(EvaluationSchema, unwrap(res), "GET /evaluacion-participante/yo");
}

export async function startAttempt(body: StartAttemptRequest): Promise<RuntimeAttempt> {
  const res = await participantClient.post<ApiEnvelope<unknown>>("/evaluacion-participante/iniciar", body);
  return parseOrThrow(RuntimeAttemptSchema, unwrap(res), "POST /evaluacion-participante/iniciar");
}

export async function startSubtest(attemptId: number, subtestId: number): Promise<SubtestAttempt> {
  const res = await participantClient.post<ApiEnvelope<unknown>>(
    `/intentos/${attemptId}/subtests/${subtestId}/iniciar`,
  );
  return parseOrThrow(
    SubtestAttemptSchema,
    unwrap(res),
    `POST /intentos/${attemptId}/subtests/${subtestId}/iniciar`,
  );
}

export async function getSubtestItems(attemptId: number, subtestId: number): Promise<RuntimeSubtest> {
  const res = await participantClient.get<ApiEnvelope<unknown>>(
    `/intentos/${attemptId}/subtests/${subtestId}/items`,
  );
  return parseOrThrow(
    RuntimeSubtestSchema,
    unwrap(res),
    `GET /intentos/${attemptId}/subtests/${subtestId}/items`,
  );
}

export async function saveAnswer(attemptId: number, body: SaveAnswerRequest): Promise<SavedAnswerReceipt> {
  const res = await participantClient.put<ApiEnvelope<unknown>>(
    `/intentos/${attemptId}/items/${body.itemId}/respuesta`,
    body,
  );
  return parseOrThrow(
    SavedAnswerReceiptSchema,
    unwrap(res),
    `PUT /intentos/${attemptId}/items/${body.itemId}/respuesta`,
  );
}

/**
 * bulk-sync: HTTP 200 con un resultado por ítem. La raíz debe ser un array (si no, CONTRACT_MISMATCH); las filas
 * mal formadas se descartan una a una, de modo que el ítem quede "sin confirmar" y siga en la cola del llamador.
 */
export async function bulkSync(attemptId: number, answers: SaveAnswerRequest[]): Promise<BulkSyncResult[]> {
  const res = await participantClient.post<ApiEnvelope<unknown>>(
    `/intentos/${attemptId}/respuestas/bulk-sync`,
    answers,
  );
  const rows = parseOrThrow(z.array(z.unknown()), unwrap(res), `POST /intentos/${attemptId}/respuestas/bulk-sync`);
  const results: BulkSyncResult[] = [];
  for (const row of rows) {
    const parsed = BulkSyncResultSchema.safeParse(row);
    if (parsed.success) results.push(parsed.data);
    else if (import.meta.env.DEV) console.error("[contract] bulk-sync: fila descartada", parsed.error.issues);
  }
  return results;
}

export async function finishSubtest(
  attemptId: number,
  subtestId: number,
  body: FinishRequest,
): Promise<SubtestAttempt> {
  const res = await participantClient.post<ApiEnvelope<unknown>>(
    `/intentos/${attemptId}/subtests/${subtestId}/finalizar`,
    body,
  );
  return parseOrThrow(
    SubtestAttemptSchema,
    unwrap(res),
    `POST /intentos/${attemptId}/subtests/${subtestId}/finalizar`,
  );
}

export async function finishAttempt(attemptId: number, body: FinishRequest): Promise<RuntimeAttempt> {
  const res = await participantClient.post<ApiEnvelope<unknown>>(`/intentos/${attemptId}/finalizar`, body);
  return parseOrThrow(RuntimeAttemptSchema, unwrap(res), `POST /intentos/${attemptId}/finalizar`);
}
