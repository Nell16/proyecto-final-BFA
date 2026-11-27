import { ApiError } from "../../../api/errors";
import { isRuntimeBlocked } from "../../../api/schemas/runtime";

/**
 * Rechazos DEFINITIVOS: reenviar nunca los aceptará (ver `ParticipantAnswerService`):
 * - `SUBTEST_FINALIZADO`: el subtest ya se cerró.
 * - `TIEMPO_AGOTADO`: se agotó el tiempo del subtest.
 * - `ITEM_NO_ENCONTRADO`: el ítem no existe.
 * - `OPCION_INVALIDA`: alguna opción no existe o no pertenece al ítem.
 * - `RESPUESTA_INVALIDA`: la respuesta es incompatible con el tipo del ítem.
 */
export const DEFINITIVE_REJECTION_CODES = [
  "SUBTEST_FINALIZADO",
  "TIEMPO_AGOTADO",
  "ITEM_NO_ENCONTRADO",
  "OPCION_INVALIDA",
  "RESPUESTA_INVALIDA",
] as const;

export type DefinitiveRejectionCode = (typeof DEFINITIVE_REJECTION_CODES)[number];

const DEFINITIVE_SET: ReadonlySet<string> = new Set(DEFINITIVE_REJECTION_CODES);

export const SUBTEST_NO_INICIADO = "SUBTEST_NO_INICIADO";
export const SESION_PAUSADA = "SESION_PAUSADA";

export const isDefinitiveCode = (code: string | null | undefined): code is DefinitiveRejectionCode =>
  code != null && DEFINITIVE_SET.has(code);

/**
 * Qué hacer con una respuesta/lote según el motivo del fallo:
 * - `retry`: sin conexión, timeout, 5xx, 408 o 429. Cola intacta, `isOffline`, backoff acotado.
 * - `paused`: 409 `SESION_PAUSADA`. Cola intacta, sondeo lento, sin `isOffline`.
 * - `blocked`: 409 de runtime bloqueado (`SESION_NO_ABIERTA`…) o 401/403. Cola intacta, sin reintento automático.
 * - `definitive`: el backend nunca aceptará esa respuesta → `rejectedAnswers`.
 * - `not-started`: `SUBTEST_NO_INICIADO`. Transitorio, con reintentos acotados.
 * - `client`: otro 4xx desconocido. El servidor es alcanzable (no es `isOffline`); en un lote se aísla
 *   reenviando ítem por ítem, y en un ítem se trata como transitorio.
 */
export type FailureClass =
  | { kind: "retry" }
  | { kind: "paused" }
  | { kind: "blocked"; code: string }
  | { kind: "definitive"; code: DefinitiveRejectionCode }
  | { kind: "not-started" }
  | { kind: "client"; code: string };

export type FailureScope = "item" | "batch";

/**
 * Clasifica un error de red/HTTP.
 *
 * `scope: "item"` es el PUT individual: el backend responde 409 con el código estable
 * (`SUBTEST_FINALIZADO`, `TIEMPO_AGOTADO`, `SUBTEST_NO_INICIADO`…), 400 `BAD_REQUEST` para
 * `RESPUESTA_INVALIDA`/`OPCION_INVALIDA` y 404 `NOT_FOUND` para `ITEM_NO_ENCONTRADO`.
 *
 * `scope: "batch"` es el bulk-sync entero: esos mismos códigos NO se interpretan como veredicto del
 * ítem (el backend los informa por ítem con HTTP 200), así que un 4xx del lote se clasifica `client`
 * y se aísla ítem por ítem. Los fallos de transporte, pausa y bloqueo valen para todo el lote.
 */
export function classifyError(error: unknown, scope: FailureScope): FailureClass {
  if (!(error instanceof ApiError)) return { kind: "retry" };
  const { status, code } = error;

  if (status === 0) return { kind: "retry" };

  if (code === SESION_PAUSADA) return { kind: "paused" };

  if (scope === "item") {
    if (isDefinitiveCode(code)) return { kind: "definitive", code };
    if (code === SUBTEST_NO_INICIADO) return { kind: "not-started" };
    if (status === 400 && (code === "BAD_REQUEST" || code === "VALIDATION_ERROR")) {
      return { kind: "definitive", code: "RESPUESTA_INVALIDA" };
    }
    if (status === 404 && code === "NOT_FOUND") return { kind: "definitive", code: "ITEM_NO_ENCONTRADO" };
  }

  // TIEMPO_AGOTADO también es un código de runtime bloqueado, pero en un lote no es veredicto por ítem.
  if (code !== "TIEMPO_AGOTADO" && isRuntimeBlocked(error)) return { kind: "blocked", code };
  if (status === 401 || status === 403) return { kind: "blocked", code };

  if (status >= 500 || status === 408 || status === 429) return { kind: "retry" };

  return { kind: "client", code };
}
