import { parseServerDateTime } from "../../../api/schemas/datetime";

/** Fecha/hora local legible; el valor del backend sin offset se interpreta como UTC (regla 10). */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const time = parseServerDateTime(iso);
  if (time === null) return iso;
  return new Date(time).toLocaleString("es", { dateStyle: "medium", timeStyle: "short" });
}

export function formatTimeLimit(seconds: number | null | undefined): string {
  if (seconds == null) return "Sin límite";
  const minutes = seconds / 60;
  return `${Number.isInteger(minutes) ? minutes : minutes.toFixed(1)} min`;
}
