import type { Subtest } from "../../../api/schemas/instruments";
import type { SessionSubtest, SessionSubtestRequest } from "../../../api/schemas/sessions";

/** Fila editable del paso "Subtests". El tiempo se edita en minutos (texto vacío = sin límite). */
export interface SubtestRow {
  subtestId: number;
  code: string;
  name: string;
  required: boolean;
  selected: boolean;
  timeLimitMinutes: string;
  randomizeItems: boolean;
  randomizeOptions: boolean;
}

const formatMinutes = (seconds: number): string => String(Math.round((seconds / 60) * 100) / 100);

/** Valores por defecto tomados del subtest de la versión (tiempo y aleatorización). */
export function buildRows(subtests: readonly Subtest[]): SubtestRow[] {
  return [...subtests]
    .filter((s) => s.status !== "INACTIVO")
    .sort((a, b) => a.order - b.order)
    .map((s) => ({
      subtestId: s.id,
      code: s.code,
      name: s.name,
      required: s.required,
      selected: true,
      timeLimitMinutes: s.timeLimitSeconds != null ? formatMinutes(s.timeLimitSeconds) : "",
      randomizeItems: s.randomizeItems,
      randomizeOptions: s.randomizeOptions,
    }));
}

export function moveRow(rows: readonly SubtestRow[], index: number, delta: -1 | 1): SubtestRow[] {
  const target = index + delta;
  if (index < 0 || index >= rows.length || target < 0 || target >= rows.length) return [...rows];
  const next = [...rows];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved);
  return next;
}

/** Devuelve los segundos del texto de minutos, `null` si está vacío o `"invalid"` si no es un número > 0. */
export function parseTimeLimit(text: string): number | null | "invalid" {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const minutes = Number(trimmed.replace(",", "."));
  if (!Number.isFinite(minutes) || minutes <= 0) return "invalid";
  const seconds = Math.round(minutes * 60);
  return seconds >= 1 ? seconds : "invalid";
}

export interface SubtestRowsValidation {
  noneSelected: boolean;
  /** Errores por `subtestId` (solo filas seleccionadas). */
  errors: Record<number, string>;
  valid: boolean;
}

export function validateRows(rows: readonly SubtestRow[]): SubtestRowsValidation {
  const selected = rows.filter((r) => r.selected);
  const errors: Record<number, string> = {};
  for (const row of selected) {
    if (parseTimeLimit(row.timeLimitMinutes) === "invalid") {
      errors[row.subtestId] = "Ingrese un número de minutos mayor que 0 o deje vacío para no limitar.";
    }
  }
  const noneSelected = selected.length === 0;
  return { noneSelected, errors, valid: !noneSelected && Object.keys(errors).length === 0 };
}

export interface SubtestRequestOptions {
  /**
   * Si la versión permite aleatorizar ítems. `undefined` = no restringir (compatibilidad); `false`/`null`
   * (no permitido o desconocido) fuerzan `randomizeItems: false`, igual que hace el backend.
   */
  allowRandomizeItems?: boolean | null;
}

/** El orden se numera 1..n según la posición entre los subtests seleccionados. */
export function toSubtestRequests(rows: readonly SubtestRow[], options: SubtestRequestOptions = {}): SessionSubtestRequest[] {
  const allowItems = options.allowRandomizeItems === undefined ? true : options.allowRandomizeItems === true;
  return rows
    .filter((r) => r.selected)
    .map((row, index) => {
      const seconds = parseTimeLimit(row.timeLimitMinutes);
      return {
        subtestId: row.subtestId,
        order: index + 1,
        ...(typeof seconds === "number" ? { timeLimitSeconds: seconds } : {}),
        randomizeItems: allowItems ? row.randomizeItems : false,
        randomizeOptions: row.randomizeOptions,
      };
    });
}

/**
 * Estado de las filas tras el PUT: la respuesta del servidor manda (filas efectivas, con la aleatorización ya
 * normalizada). Las filas no devueltas quedan sin seleccionar. Una respuesta vacía conserva `previous`.
 */
export function rowsFromServer(
  saved: readonly SessionSubtest[],
  catalog: readonly Subtest[],
  previous: readonly SubtestRow[],
): SubtestRow[] {
  const effective = saved.filter((s) => s.subtestId !== undefined).sort((a, b) => a.order - b.order);
  if (effective.length === 0) return [...previous];
  const byId = new Map(catalog.map((s) => [s.id, s]));
  const prevById = new Map(previous.map((r) => [r.subtestId, r]));
  const savedIds = new Set<number>();
  const fromServer: SubtestRow[] = effective.map((s) => {
    const id = s.subtestId as number;
    savedIds.add(id);
    const base = byId.get(id);
    const prev = prevById.get(id);
    return {
      subtestId: id,
      code: base?.code ?? prev?.code ?? `#${id}`,
      name: base?.name ?? prev?.name ?? `Subtest #${id}`,
      required: base?.required ?? prev?.required ?? false,
      selected: true,
      timeLimitMinutes: s.timeLimitSeconds != null ? formatMinutes(s.timeLimitSeconds) : "",
      randomizeItems: s.randomizeItems,
      randomizeOptions: s.randomizeOptions,
    };
  });
  const rest = previous.filter((r) => !savedIds.has(r.subtestId)).map((r) => ({ ...r, selected: false }));
  return [...fromServer, ...rest];
}

/** Ids de subtests que el servidor ya tiene guardados (no se pueden quitar: el PUT no borra omitidos). */
export const savedSubtestIds = (saved: readonly SessionSubtest[]): Set<number> =>
  new Set(saved.flatMap((s) => (s.subtestId !== undefined ? [s.subtestId] : [])));

/** Firma estable del payload: permite no repetir el PUT si nada cambió desde el último guardado. */
export function subtestsSignature(requests: readonly SessionSubtestRequest[]): string {
  return JSON.stringify(requests);
}
