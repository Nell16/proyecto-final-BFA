import { ApiError } from "../../api/errors";

/** Mensaje legible para toasts a partir de cualquier error de una mutación. */
export function errorMessage(error: unknown, fallback = "No se pudo completar la operación."): string {
  if (error instanceof ApiError) {
    const detail = error.details?.length ? ` ${error.details.join(" ")}` : "";
    return `${error.message}${detail}`;
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

/** El interceptor de staff ya muestra su propio toast ante un 403 de escritura. */
export const isForbidden = (error: unknown): boolean => error instanceof ApiError && error.status === 403;
