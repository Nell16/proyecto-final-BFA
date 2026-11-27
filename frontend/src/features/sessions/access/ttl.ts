import { normalizeServerDateTime, parseServerDateTime } from "../../../api/schemas/datetime";
import type { Session } from "../../../api/schemas/sessions";

export const MIN_TTL_HOURS = 8;
export const MAX_TTL_HOURS = 336;
/** Margen tras el fin programado para que el enlace no venza justo al terminar. */
export const END_MARGIN_HOURS = 1;
/** Ventana asumida desde el inicio cuando la sesión no tiene fin programado. */
export const NO_END_WINDOW_HOURS = 8;

const HOUR_MS = 3_600_000;

type TtlSession = Pick<Session, "scheduledStart" | "scheduledEnd">;

/** Epoch ms de una fecha del backend (sin offset = UTC, regla 10). */
const parse = parseServerDateTime;

/**
 * Horas de vigencia (`ttlHours`) del enlace emitido en `now`: hasta `finProgramado` + 1 h; si no hay fin,
 * hasta `inicioProgramado` + 8 h. Mínimo 8 h, máximo 336 h (14 días). Siempre se redondea hacia arriba.
 */
export function computeTtlHours(session: TtlSession, now: Date = new Date()): number {
  const end = parse(session.scheduledEnd);
  const start = parse(session.scheduledStart);
  const target = end !== null ? end + END_MARGIN_HOURS * HOUR_MS : start !== null ? start + NO_END_WINDOW_HOURS * HOUR_MS : null;
  if (target === null) return MIN_TTL_HOURS;
  const hours = Math.ceil((target - now.getTime()) / HOUR_MS);
  if (!Number.isFinite(hours)) return MIN_TTL_HOURS;
  return Math.min(MAX_TTL_HOURS, Math.max(MIN_TTL_HOURS, hours));
}

/** Vencimiento mostrado: el `expiresAt` de la respuesta si es válido; si no, el calculado con `ttlHours`. */
export function resolveExpiresAt(responseExpiresAt: string | null | undefined, ttlHours: number, now: Date): string {
  const normalized = normalizeServerDateTime(responseExpiresAt);
  if (normalized !== null) return normalized;
  return new Date(now.getTime() + ttlHours * HOUR_MS).toISOString();
}

/** `true` si el enlace vence antes del inicio programado de la sesión (nadie podría usarlo). */
export function expiresBeforeStart(expiresAt: string | null | undefined, scheduledStart: string | null | undefined): boolean {
  const expiry = parse(expiresAt);
  const start = parse(scheduledStart);
  return expiry !== null && start !== null && expiry < start;
}
