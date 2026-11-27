import { z } from "zod";

/**
 * Fechas y horas del backend (regla 10 de docs/refactor/conventions-api.md).
 * El backend usa `Clock.systemUTC()` y `LocalDateTime`: todo valor SIN offset es hora de pared UTC.
 */

const HAS_OFFSET = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/i;
const HAS_TIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;

/**
 * Normaliza un valor del backend a ISO con zona (`...Z`). Si no trae offset se asume UTC.
 * Devuelve `null` si no es una fecha válida.
 */
export function normalizeServerDateTime(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const withZone = HAS_TIME.test(trimmed) && !HAS_OFFSET.test(trimmed) ? `${trimmed.replace(" ", "T")}Z` : trimmed;
  const time = new Date(withZone).getTime();
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

/** Epoch ms de un valor del backend (sin offset = UTC) o `null` si no es válido. */
export function parseServerDateTime(value: string | null | undefined): number | null {
  const iso = normalizeServerDateTime(value);
  return iso === null ? null : new Date(iso).getTime();
}

/** Lectura: string del backend (con o sin offset) → ISO con zona. Falla si no es una fecha válida. */
export const serverDateTime = z.string().transform((value, ctx) => {
  const iso = normalizeServerDateTime(value);
  if (iso === null) {
    ctx.addIssue({ code: "custom", message: "Fecha y hora inválida." });
    return z.NEVER;
  }
  return iso;
});

const pad = (n: number, size = 2): string => String(n).padStart(size, "0");

/** Escritura: `YYYY-MM-DDTHH:mm:ss` en UTC, sin `Z` (formato `LocalDateTime` del backend). */
export function toServerDateTime(date: Date): string {
  return (
    `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
  );
}
