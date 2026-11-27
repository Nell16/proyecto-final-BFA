import { ApiError } from "../../../api/errors";
import type { BulkSyncResult } from "../../../api/schemas/runtime";
import { bulkSync, saveAnswer, type SaveAnswerRequest } from "../../../api/endpoints/runtime";

/**
 * Único punto de contacto del draft con la red. Se aísla aquí para poder cambiar el origen de las
 * llamadas sin tocar el motor de sincronización.
 */

/** Resultado por ítem de bulk-sync. `status`: `GUARDADA` | `RECHAZADA`; cualquier otro valor = no confirmado. */
export type BulkItemResult = BulkSyncResult;

/** PUT individual. Un 2xx cuyo cuerpo no se puede parsear cuenta como guardado: el servidor ya lo aceptó. */
export async function putAnswer(attemptId: number, body: SaveAnswerRequest): Promise<void> {
  try {
    await saveAnswer(attemptId, body);
  } catch (error) {
    if (error instanceof ApiError && error.status === 0 && error.code === "CONTRACT_MISMATCH") return;
    throw error;
  }
}

/** bulk-sync vía el endpoint tipado (`BulkSyncResultSchema`); las filas mal formadas ya vienen descartadas. */
export async function postBulk(attemptId: number, answers: SaveAnswerRequest[]): Promise<Map<number, BulkItemResult>> {
  const rows = await bulkSync(attemptId, answers);
  return new Map(rows.map((row) => [row.itemId, row]));
}
