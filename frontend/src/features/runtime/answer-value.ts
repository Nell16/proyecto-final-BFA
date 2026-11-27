import type { SaveAnswerRequest } from "../../api/endpoints/runtime";
import type { RuntimeItem, SavedAnswer, TipoRespuesta } from "../../api/schemas/runtime";

/**
 * Contrato compartido del runner (orquestador): valor de respuesta por `TipoRespuesta`.
 * Lo producen los renderers (R-03), lo guarda `runtimeDraft` (R-02) y lo traduce a `SaveAnswerRequest`.
 *
 * Reglas del backend (ParticipantAnswerService.validar):
 * - OPCION_UNICA / VERDADERO_FALSO: a lo sumo una opción (VERDADERO_FALSO usa las opciones del ítem).
 * - OPCION_MULTIPLE: 0..n opciones.
 * - TEXTO_ABIERTO: texto; solo espacios ' ' cuentan como vacío; sin '\u0000'.
 * - NUMERICA: número finito, |valor| < 1e8, se normaliza a 4 decimales en servidor.
 * Cualquier otra combinación es `RESPUESTA_INVALIDA` (rechazo definitivo).
 */
export type AnswerValue =
  | { kind: "OPCION_UNICA"; optionId: number | null }
  | { kind: "VERDADERO_FALSO"; optionId: number | null }
  | { kind: "OPCION_MULTIPLE"; optionIds: readonly number[] }
  | { kind: "TEXTO_ABIERTO"; text: string }
  | { kind: "NUMERICA"; value: number | null };

export const NUMERIC_ABS_LIMIT = 1e8;

/** Valor vacío inicial para un tipo de respuesta. */
export function emptyAnswer(kind: TipoRespuesta): AnswerValue {
  switch (kind) {
    case "OPCION_UNICA":
    case "VERDADERO_FALSO":
      return { kind, optionId: null };
    case "OPCION_MULTIPLE":
      return { kind, optionIds: [] };
    case "TEXTO_ABIERTO":
      return { kind, text: "" };
    case "NUMERICA":
      return { kind, value: null };
  }
}

/** ¿Cuenta como respondido? (mapa de ítems y resumen previo a finalizar). */
export function isAnswered(value: AnswerValue | undefined): boolean {
  if (!value) return false;
  switch (value.kind) {
    case "OPCION_UNICA":
    case "VERDADERO_FALSO":
      return value.optionId !== null;
    case "OPCION_MULTIPLE":
      return value.optionIds.length > 0;
    case "TEXTO_ABIERTO":
      return value.text.replace(/ /g, "").length > 0;
    case "NUMERICA":
      return value.value !== null;
  }
}

/** Valida contra las reglas del backend; devuelve un mensaje para la UI o `null` si es válido. */
export function validateAnswer(value: AnswerValue): string | null {
  if (value.kind === "NUMERICA" && value.value !== null) {
    if (!Number.isFinite(value.value)) return "Ingrese un número válido.";
    if (Math.abs(value.value) >= NUMERIC_ABS_LIMIT) return "El número excede el rango permitido.";
  }
  if (value.kind === "TEXTO_ABIERTO" && value.text.includes("\u0000")) return "El texto contiene caracteres no permitidos.";
  return null;
}

/** Traduce al request del backend. `timeUsedSeconds` lo agrega quien mide el tiempo por ítem. */
export function toSaveAnswerRequest(itemId: number, value: AnswerValue, timeUsedSeconds?: number): SaveAnswerRequest {
  const base: SaveAnswerRequest = { itemId, selectedOptionIds: [] };
  if (timeUsedSeconds !== undefined) base.timeUsedSeconds = Math.max(0, Math.round(timeUsedSeconds));
  switch (value.kind) {
    case "OPCION_UNICA":
    case "VERDADERO_FALSO":
      return { ...base, selectedOptionIds: value.optionId === null ? [] : [value.optionId] };
    case "OPCION_MULTIPLE":
      return { ...base, selectedOptionIds: [...value.optionIds] };
    case "TEXTO_ABIERTO":
      return { ...base, textAnswer: value.text };
    case "NUMERICA":
      return value.value === null ? base : { ...base, numericAnswer: value.value };
  }
}

/** Reconstruye el valor desde la respuesta guardada en servidor (`item.savedAnswer`). */
export function fromSavedAnswer(kind: TipoRespuesta, saved: SavedAnswer | undefined): AnswerValue {
  if (!saved) return emptyAnswer(kind);
  switch (kind) {
    case "OPCION_UNICA":
    case "VERDADERO_FALSO":
      return { kind, optionId: saved.selectedOptionIds[0] ?? null };
    case "OPCION_MULTIPLE":
      return { kind, optionIds: [...saved.selectedOptionIds] };
    case "TEXTO_ABIERTO":
      return { kind, text: saved.textAnswer ?? "" };
    case "NUMERICA":
      return { kind, value: saved.numericAnswer ?? null };
  }
}

/** Props comunes de todo renderer de respuesta (R-03). */
export interface AnswerRendererProps<K extends AnswerValue["kind"] = AnswerValue["kind"]> {
  item: RuntimeItem;
  value: Extract<AnswerValue, { kind: K }>;
  onChange: (value: Extract<AnswerValue, { kind: K }>) => void;
  /** Deshabilitado: tiempo agotado, finalizando, sesión pausada o sin permiso de escritura. */
  disabled?: boolean;
}
