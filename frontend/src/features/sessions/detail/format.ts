import { formatDistanceToNowStrict, format, isValid } from "date-fns";
import { es } from "date-fns/locale";
import { parseServerDateTime } from "../../../api/schemas/datetime";

/** Instante del valor del backend (sin offset = UTC, regla 10); se muestra siempre en la zona del navegador. */
const parse = (iso: string | null | undefined): Date | null => {
  const time = parseServerDateTime(iso);
  if (time === null) return null;
  const date = new Date(time);
  return isValid(date) ? date : null;
};

/** `YYYY-MM-DD` del día LOCAL (zona del navegador) en que cae el instante; `null` si no es válido. */
export function localDayOf(iso: string | null | undefined): string | null {
  const date = parse(iso);
  return date ? format(date, "yyyy-MM-dd") : null;
}

/** `dd/MM/yyyy HH:mm` (convención es-NI). Devuelve "—" si no hay fecha válida. */
export function formatDateTime(iso: string | null | undefined): string {
  const date = parse(iso);
  return date ? format(date, "dd/MM/yyyy HH:mm", { locale: es }) : "—";
}

/** `HH:mm:ss` para marcas de hora de bitácora. */
export function formatTime(iso: string | null | undefined): string {
  const date = parse(iso);
  return date ? format(date, "HH:mm:ss", { locale: es }) : "—";
}

/** "hace 4 minutos". Devuelve "Sin actividad" si no hay fecha. */
export function formatRelative(iso: string | null | undefined): string {
  const date = parse(iso);
  return date ? formatDistanceToNowStrict(date, { locale: es, addSuffix: true }) : "Sin actividad";
}

/** Duración entre dos instantes ISO en formato corto ("1 h 05 min", "4 min 10 s"). `null` si falta alguno. */
export function formatDurationBetween(startIso: string, endIso: string | null | undefined): string | null {
  const start = parse(startIso);
  const end = parse(endIso);
  if (!start || !end) return null;
  const totalSeconds = Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours} h ${String(minutes).padStart(2, "0")} min`;
  if (minutes > 0) return `${minutes} min ${String(seconds).padStart(2, "0")} s`;
  return `${seconds} s`;
}
