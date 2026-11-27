import { z } from "zod";
import { serverDateTime } from "./datetime";

export const ReportFormatSchema = z.enum(["PDF", "XLSX", "CSV"]);
export type ReportFormat = z.output<typeof ReportFormatSchema>;

/** GET /reports, POST /reports/individual, POST /reports/aggregate -> EntityView.of(ReporteGenerado) */
export const GeneratedReportSchema = z
  .object({
    id: z.number(),
    tipoReporte: z.string(),
    intentoId: z.number().nullable().optional(),
    resultadoId: z.number().nullable().optional(),
    sesionAplicacionId: z.number().nullable().optional(),
    generadoPorId: z.string().nullable().optional(),
    generadoEn: serverDateTime,
    formato: ReportFormatSchema,
    rutaAlmacenamiento: z.string(),
    resumenFiltros: z.string().nullable().optional(),
  })
  .loose()
  .transform((w) => ({
    id: w.id,
    reportType: w.tipoReporte,
    attemptId: w.intentoId ?? null,
    resultId: w.resultadoId ?? null,
    sessionId: w.sesionAplicacionId ?? null,
    generatedById: w.generadoPorId ?? null,
    generatedAt: w.generadoEn,
    format: w.formato,
    storagePath: w.rutaAlmacenamiento,
    filtersSummary: w.resumenFiltros ?? null,
  }));
export type GeneratedReport = z.output<typeof GeneratedReportSchema>;
export const GeneratedReportListSchema = z.array(GeneratedReportSchema);

const optionalPositiveIntString = z.string().refine(
  (value) => {
    const trimmed = value.trim();
    if (trimmed === "") return true;
    const num = Number(trimmed);
    return Number.isInteger(num) && num > 0;
  },
  { message: "Debe ser un número entero positivo." },
);

const optionalJsonString = z.string().refine(
  (value) => {
    const trimmed = value.trim();
    if (trimmed === "") return true;
    try {
      JSON.parse(trimmed);
      return true;
    } catch {
      return false;
    }
  },
  { message: "El JSON de filtros no es válido." },
);

export const IndividualReportFormSchema = z
  .object({
    type: z.string().trim().min(1, "Indique el tipo de reporte.").max(50, "Máximo 50 caracteres."),
    format: ReportFormatSchema,
    storagePath: z.string().trim().min(1, "Indique la ruta de almacenamiento."),
    attemptId: optionalPositiveIntString,
    resultId: optionalPositiveIntString,
    filtersJson: optionalJsonString,
  })
  .superRefine((values, ctx) => {
    if (values.attemptId.trim() === "" && values.resultId.trim() === "") {
      ctx.addIssue({
        code: "custom",
        path: ["attemptId"],
        message: "Indique al menos un ID de intento o un ID de resultado.",
      });
    }
  });
export type IndividualReportFormValues = z.output<typeof IndividualReportFormSchema>;

export const AggregateReportFormSchema = z.object({
  type: z.string().trim().min(1, "Indique el tipo de reporte.").max(50, "Máximo 50 caracteres."),
  format: ReportFormatSchema,
  storagePath: z.string().trim().min(1, "Indique la ruta de almacenamiento."),
  sessionId: z
    .string()
    .trim()
    .min(1, "Indique el ID de la sesión.")
    .refine(
      (value) => {
        const num = Number(value);
        return Number.isInteger(num) && num > 0;
      },
      { message: "Debe ser un ID de sesión válido." },
    ),
  filtersJson: optionalJsonString,
});
export type AggregateReportFormValues = z.output<typeof AggregateReportFormSchema>;
