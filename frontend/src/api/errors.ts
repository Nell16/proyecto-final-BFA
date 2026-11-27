import axios, { type AxiosResponse } from "axios";

/** Envelope estándar del backend: `{ success, data, message, error, correlationId }`. */
export interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  message?: string;
  error?: {
    code?: string;
    message?: string;
    details?: string[];
  } | null;
  correlationId?: string;
}

interface ApiErrorInit {
  status: number;
  code: string;
  message: string;
  details?: string[];
  correlationId?: string;
  /** Causa original; se SANEA (solo name/message/code) antes de retenerla. Nunca se conserva tal cual. */
  cause?: unknown;
}

/**
 * Reduce una causa a un `Error` plano con `name`, `message` y (si es string) `code`. Un `AxiosError`
 * arrastra `config` (con `Authorization: Bearer <JWT>` y el body enviado), `request` y `response`:
 * nada de eso debe sobrevivir en un `ApiError`, que acaba en estados de mutación, caché y consola.
 */
function sanitizeCause(cause: unknown): Error | undefined {
  if (!(cause instanceof Error)) return undefined;
  const plain = new Error(cause.message);
  plain.name = cause.name;
  const code = (cause as { code?: unknown }).code;
  if (typeof code === "string") Object.defineProperty(plain, "code", { value: code, enumerable: true });
  return plain;
}

/**
 * Error normalizado de la capa API. Todas las promesas rechazadas por
 * `staffClient`/`participantClient` salen con esta clase.
 *
 * - `status` 0 => no hubo respuesta HTTP (code "NETWORK" | "TIMEOUT" | "CANCELED" | "UNKNOWN").
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: string[];
  readonly correlationId?: string;

  constructor(init: ApiErrorInit) {
    const cause = sanitizeCause(init.cause);
    super(init.message, cause === undefined ? undefined : { cause });
    this.name = "ApiError";
    this.status = init.status;
    this.code = init.code;
    this.details = init.details;
    this.correlationId = init.correlationId;
  }
}

/**
 * Descripción de un error APTA PARA LOGS (`console.error`/`warn`): solo campos seguros. Nunca pasar el error
 * completo al console: un `AxiosError` crudo lleva `config.headers.Authorization` y el body enviado.
 */
export function safeErrorLog(error: unknown): Record<string, unknown> {
  if (error instanceof ApiError) {
    return {
      name: error.name,
      status: error.status,
      code: error.code,
      message: error.message,
      details: error.details,
      correlationId: error.correlationId,
    };
  }
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return { name: error.name, message: error.message, ...(typeof code === "string" ? { code } : {}) };
  }
  return { type: typeof error };
}

const DEFAULT_MESSAGES: Record<number, string> = {
  400: "La solicitud no es válida.",
  401: "Su sesión no es válida o ha expirado.",
  403: "No tiene permisos para realizar esta acción.",
  404: "El recurso solicitado no existe.",
  409: "La operación entra en conflicto con el estado actual del recurso.",
  422: "Los datos enviados no son válidos.",
  500: "Error interno del servidor.",
  502: "El servidor no está disponible.",
  503: "El servicio no está disponible temporalmente.",
  504: "El servidor tardó demasiado en responder.",
};

const defaultMessageFor = (status: number): string =>
  DEFAULT_MESSAGES[status] ?? (status >= 500 ? DEFAULT_MESSAGES[500] : "No se pudo completar la solicitud.");

const defaultCodeFor = (status: number): string => `HTTP_${status}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value : undefined;

const asStringArray = (value: unknown): string[] | undefined =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : undefined;

/** Lee un cuerpo de error con forma de envelope (o parcial) sin asumir nada. */
const readEnvelope = (body: unknown) => {
  if (!isRecord(body)) return {};
  const err = isRecord(body.error) ? body.error : undefined;
  return {
    code: asString(err?.code),
    message: asString(err?.message) ?? asString(body.message),
    details: asStringArray(err?.details),
    correlationId: asString(body.correlationId),
  };
};

/** Convierte cualquier valor lanzado en un `ApiError`. Idempotente. */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;

  if (axios.isAxiosError(error)) {
    const response = error.response;
    if (response) {
      const env = readEnvelope(response.data);
      return new ApiError({
        status: response.status,
        code: env.code ?? defaultCodeFor(response.status),
        message: env.message ?? defaultMessageFor(response.status),
        details: env.details,
        correlationId: env.correlationId,
        cause: error,
      });
    }

    if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") {
      return new ApiError({
        status: 0,
        code: "TIMEOUT",
        message: "El servidor tardó demasiado en responder. Intente nuevamente.",
        cause: error,
      });
    }

    if (error.code === "ERR_CANCELED") {
      return new ApiError({ status: 0, code: "CANCELED", message: "La solicitud fue cancelada.", cause: error });
    }

    return new ApiError({
      status: 0,
      code: "NETWORK",
      message: "No hay conexión con el servidor. Verifique su red e intente nuevamente.",
      cause: error,
    });
  }

  if (error instanceof Error) {
    return new ApiError({ status: 0, code: "UNKNOWN", message: error.message, cause: error });
  }

  return new ApiError({ status: 0, code: "UNKNOWN", message: "Ocurrió un error inesperado.", cause: error });
}

/**
 * Devuelve `res.data.data` o lanza `ApiError` si el envelope indica `success: false`.
 */
export function unwrap<T>(res: Pick<AxiosResponse<ApiEnvelope<T>>, "data" | "status">): T {
  const body = res.data;
  if (!isRecord(body) || body.success === false) {
    const env = readEnvelope(body);
    throw new ApiError({
      status: res.status,
      code: env.code ?? "API_ERROR",
      message: env.message ?? "La operación no se pudo completar.",
      details: env.details,
      correlationId: env.correlationId,
    });
  }
  return body.data as T;
}
