import { format, isValid } from "date-fns";
import { es } from "date-fns/locale";
import { parseServerDateTime } from "../../api/schemas/datetime";

const parse = (iso: string | null | undefined): Date | null => {
  const time = parseServerDateTime(iso);
  if (time === null) return null;
  const date = new Date(time);
  return isValid(date) ? date : null;
};

/** `dd/MM/yyyy HH:mm:ss` en zona local del navegador. Devuelve "—" si no hay fecha válida. */
export function formatAdminDateTime(iso: string | null | undefined): string {
  const date = parse(iso);
  return date ? format(date, "dd/MM/yyyy HH:mm:ss", { locale: es }) : "—";
}

/** `YYYY-MM-DD` del día local en que cae el instante; `null` si no es válido. */
export function localDayOf(iso: string | null | undefined): string | null {
  const date = parse(iso);
  return date ? format(date, "yyyy-MM-dd") : null;
}
