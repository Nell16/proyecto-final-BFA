import { describe, expect, it } from "vitest";
import type { SessionSubtest } from "../../../../api/schemas/sessions";
import type { Subtest } from "../../../../api/schemas/instruments";
import { buildRows, rowsFromServer, savedSubtestIds, toSubtestRequests } from "../subtest-rows";

const catalog: Subtest[] = [
  { id: 1, versionId: 10, strategyId: null, code: "A", name: "Alfa", description: null, instructions: null, order: 1, timeLimitSeconds: 600, randomizeItems: true, randomizeOptions: false, required: true, status: "ACTIVO" },
  { id: 2, versionId: 10, strategyId: null, code: "B", name: "Beta", description: null, instructions: null, order: 2, timeLimitSeconds: null, randomizeItems: true, randomizeOptions: true, required: false, status: "ACTIVO" },
] as Subtest[];

describe("toSubtestRequests", () => {
  it("fuerza randomizeItems=false si la versión no lo permite o es desconocido", () => {
    const rows = buildRows(catalog);
    expect(toSubtestRequests(rows).every((r) => r.randomizeItems === true)).toBe(true);
    expect(toSubtestRequests(rows, { allowRandomizeItems: true })[0].randomizeItems).toBe(true);
    expect(toSubtestRequests(rows, { allowRandomizeItems: false }).every((r) => r.randomizeItems === false)).toBe(true);
    expect(toSubtestRequests(rows, { allowRandomizeItems: null }).every((r) => r.randomizeItems === false)).toBe(true);
  });
});

describe("rowsFromServer", () => {
  const saved = [
    { id: 9, subtestId: 2, order: 1, timeLimitSeconds: 90, randomizeItems: false, randomizeOptions: true },
  ] as SessionSubtest[];

  it("toma la respuesta del servidor como estado y deja sin seleccionar lo no devuelto", () => {
    const rows = rowsFromServer(saved, catalog, buildRows(catalog));
    expect(rows.map((r) => [r.subtestId, r.selected])).toEqual([
      [2, true],
      [1, false],
    ]);
    expect(rows[0]).toMatchObject({ name: "Beta", timeLimitMinutes: "1.5", randomizeItems: false });
    expect(savedSubtestIds(saved)).toEqual(new Set([2]));
  });

  it("conserva las filas previas si la respuesta viene vacía", () => {
    const previous = buildRows(catalog);
    expect(rowsFromServer([], catalog, previous)).toEqual(previous);
  });
});
