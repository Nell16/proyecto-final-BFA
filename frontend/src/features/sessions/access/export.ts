import { buildAccessCode } from "../../../api/endpoints/sessions";

/**
 * Campos mínimos de una fila de hoja de accesos. Viven SOLO en memoria: el `rawToken` nunca se escribe en
 * stores, storage, logs ni URL distinta del enlace `/evaluacion/...`.
 */
export interface AccessLinkEntry {
  assignmentId: number;
  participantName: string;
  participantCode: string;
  rawToken: string;
  expiresAt: string;
}

export const accessLinkFor = (entry: Pick<AccessLinkEntry, "assignmentId" | "rawToken">): string =>
  `${window.location.origin}/evaluacion/${buildAccessCode(entry.assignmentId, entry.rawToken)}`;

/** Caracteres de control (incluye tab, CR y LF). */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
// eslint-disable-next-line no-control-regex
const CONTROL_RUNS = /[\u0000-\u001f\u007f]+/g;
/** Prefijos que una hoja de cálculo interpreta como fórmula: = + - @ y cualquier control inicial (tab, CR…). */
const FORMULA_PREFIX = /^[=+\-@]/;

/**
 * Neutraliza fórmulas: si el valor empieza por = + - @ o por un carácter de control (tab, CR, etc.) se
 * antepone `'`. Es la MISMA regla para el CSV y para el texto copiado al portapapeles.
 */
export const neutralizeFormula = (value: string): string =>
  FORMULA_PREFIX.test(value) || (value !== "" && CONTROL_CHARS.test(value[0])) ? `'${value}` : value;

/** Campo de texto tabulado: neutralizado y sin tabs/saltos de línea internos (conserva las columnas). */
const textField = (value: string): string => neutralizeFormula(value).replace(CONTROL_RUNS, " ");

/** Texto tabulado (pegable en una hoja de cálculo) con encabezado. */
export function accessSheetText(entries: readonly AccessLinkEntry[]): string {
  return [
    "Nombre\tCódigo\tEnlace\tVence",
    ...entries.map((e) =>
      [e.participantName, e.participantCode, accessLinkFor(e), e.expiresAt].map(textField).join("\t"),
    ),
  ].join("\n");
}

/** BOM para que Excel interprete el CSV como UTF-8. */
export const UTF8_BOM = String.fromCharCode(0xfeff);

/** Neutraliza fórmulas (misma regla que el portapapeles) y escapa comillas para abrir el CSV en hojas de cálculo. */
const csvCell = (value: string): string => `"${neutralizeFormula(value).replaceAll('"', '""')}"`;

export function accessSheetCsv(entries: readonly AccessLinkEntry[]): string {
  const lines = [
    ["Nombre", "Código", "Enlace", "Vence"].map(csvCell).join(","),
    ...entries.map((e) =>
      [e.participantName, e.participantCode, accessLinkFor(e), e.expiresAt].map(csvCell).join(","),
    ),
  ];
  return `${UTF8_BOM}${lines.join("\r\n")}`;
}

/** Descarga explícita pedida por el usuario; el archivo no se conserva en ningún almacén de la app. */
export function downloadTextFile(filename: string, content: string, mime = "text/csv;charset=utf-8"): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
