import { ApiError } from "../../api/errors";

export { formatDateTime } from "../sessions/detail/format";

/** `1 h 05 min`, `18 min 30 s`, `45 s`. `—` si no hay dato. */
export function formatSeconds(totalSeconds: number | null | undefined): string {
  if (totalSeconds == null || !Number.isFinite(totalSeconds)) return "—";
  const total = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours} h ${String(minutes).padStart(2, "0")} min`;
  if (minutes > 0) return `${minutes} min ${String(seconds).padStart(2, "0")} s`;
  return `${seconds} s`;
}

const scoreFormat = new Intl.NumberFormat("es-NI", { maximumFractionDigits: 2 });

/** Puntaje con hasta 2 decimales. `—` si no hay dato. */
export function formatScore(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "—" : scoreFormat.format(value);
}

/** Mensaje legible de un error de la capa API (ya normalizado por `ApiError`). */
export function errorMessage(error: unknown, fallback = "No se pudo completar la operación."): string {
  if (error instanceof ApiError && error.message) return error.message;
  return fallback;
}

/** `true` si el error es un 404/400 del backend (EntityNotFound: el recurso no existe todavía). */
export const isMissingError = (error: unknown): boolean =>
  error instanceof ApiError && (error.status === 404 || error.status === 400);

/** Interpreta el id de la URL: entero positivo o `null`. */
export function parseAttemptId(raw: string): number | null {
  return /^\d+$/.test(raw) && Number(raw) > 0 ? Number(raw) : null;
}
