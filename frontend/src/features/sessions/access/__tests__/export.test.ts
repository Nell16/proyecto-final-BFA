import { describe, expect, it } from "vitest";
import { UTF8_BOM, accessLinkFor, accessSheetCsv, accessSheetText, neutralizeFormula } from "../export";
import { countUnexported } from "../exportTracker";

const entries = [
  { assignmentId: 5, participantName: '=Ana "X"', participantCode: "P1", rawToken: "tok", expiresAt: "2026-11-24T22:00:00" },
  { assignmentId: 6, participantName: "Beto", participantCode: "P2", rawToken: "tok2", expiresAt: "2026-11-24T22:00:00" },
];

describe("export de hoja de accesos", () => {
  it("construye el enlace /evaluacion con assignmentId-token", () => {
    expect(accessLinkFor(entries[0])).toBe(`${window.location.origin}/evaluacion/5-tok`);
  });

  it("texto tabulado con encabezado", () => {
    const lines = accessSheetText(entries).split("\n");
    expect(lines[0]).toBe("Nombre\tCódigo\tEnlace\tVence");
    expect(lines).toHaveLength(3);
  });

  it("CSV neutraliza fórmulas y escapa comillas", () => {
    const csv = accessSheetCsv(entries);
    expect(csv).toContain(`"'=Ana ""X"""`);
    expect(csv.startsWith(UTF8_BOM)).toBe(true);
  });
});

describe("neutralización de fórmulas (CSV y portapapeles comparten la regla)", () => {
  const entry = (participantName: string, participantCode = "P1") => ({
    assignmentId: 5,
    participantName,
    participantCode,
    rawToken: "tok",
    expiresAt: "2026-11-24T22:00:00",
  });

  it("antepone ' a = + - @ y a cualquier carácter de control inicial (tab, CR…)", () => {
    for (const value of ["=SUM(A1)", "+1", "-2", "@cmd", "\tx", "\rx", "\u0001x"]) {
      expect(neutralizeFormula(value)).toBe(`'${value}`);
    }
    expect(neutralizeFormula("Ana")).toBe("Ana");
    expect(neutralizeFormula("")).toBe("");
  });

  it("«Copiar todo» neutraliza cada campo con la misma regla que el CSV", () => {
    const text = accessSheetText([entry("=HYPERLINK(1)", "+9"), entry("-x", "@y"), entry("\tTab", "\rCR")]);
    const rows = text.split("\n").slice(1).map((line) => line.split("\t"));
    expect(rows[0].slice(0, 2)).toEqual(["'=HYPERLINK(1)", "'+9"]);
    expect(rows[1].slice(0, 2)).toEqual(["'-x", "'@y"]);
    expect(rows[2].slice(0, 2)).toEqual(["' Tab", "' CR"]); // control inicial neutralizado y luego aplanado

    const csv = accessSheetCsv([entry("=HYPERLINK(1)", "+9")]);
    expect(csv).toContain(`"'=HYPERLINK(1)","'+9"`);
  });

  it("elimina tabs y saltos de línea internos para conservar las columnas", () => {
    const text = accessSheetText([entry("Ana\tLópez\nRuiz\r\nSegunda", "P\t1")]);
    const lines = text.split("\n");
    expect(lines).toHaveLength(2); // encabezado + 1 fila: ningún salto interno
    const cols = lines[1].split("\t");
    expect(cols).toHaveLength(4);
    expect(cols[0]).toBe("Ana López Ruiz Segunda");
    expect(cols[1]).toBe("P 1");
  });
});

describe("countUnexported", () => {
  it("cuenta por asignación: los enlaces nuevos quedan sin exportar", () => {
    expect(countUnexported(entries, new Set([5]))).toBe(1);
    expect(countUnexported(entries, new Set([5, 6]))).toBe(0);
    expect(countUnexported(null, new Set())).toBe(0);
  });
});
