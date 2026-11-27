import { buildAccessCode } from "../../../api/endpoints/sessions";

/**
 * Datos de una fila de la hoja de accesos. Viven SOLO en estado de React mientras la hoja está abierta:
 * el `rawToken` llega una única vez desde el backend y nunca se persiste (store, storage ni URL).
 */
export interface AccessEntry {
  assignmentId: number;
  participantName: string;
  participantCode: string;
  rawToken: string;
  expiresAt: string;
}

export function buildAccessLink(entry: Pick<AccessEntry, "assignmentId" | "rawToken">): string {
  return `${window.location.origin}/evaluacion/${buildAccessCode(entry.assignmentId, entry.rawToken)}`;
}

export function accessSheetAsText(entries: readonly AccessEntry[]): string {
  return entries
    .map((entry) => `${entry.participantName} (${entry.participantCode})\t${buildAccessLink(entry)}`)
    .join("\n");
}
