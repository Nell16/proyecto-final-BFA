import { z } from "zod";
import { serverDateTime } from "./datetime";

export const AttemptStatusSchema = z
  .enum(["NO_INICIADO", "EN_PROGRESO", "COMPLETADO", "INTERRUMPIDO", "ANULADO", "DESCONOCIDO"])
  .catch("DESCONOCIDO");

export const ManualReviewStatusSchema = z
  .enum(["PENDIENTE", "EN_REVISION", "REVISADO", "OBSERVADO", "ANULADO", "DESCONOCIDO"])
  .catch("DESCONOCIDO");

export const ReportFormatSchema = z.enum(["PDF", "XLSX", "CSV"]);

const TotalInterpretationWireSchema = z
  .object({
    baremoId: z.number(),
    baremoCode: z.string(),
    rangeId: z.number(),
    category: z.string().nullable().optional(),
    percentile: z.number().nullable().optional(),
    interpretation: z.string().nullable().optional(),
    recommendation: z.string().nullable().optional(),
  })
  .loose();

export const TotalInterpretationSchema = TotalInterpretationWireSchema.transform((w) => ({
  baremoId: w.baremoId,
  baremoCode: w.baremoCode,
  rangeId: w.rangeId,
  category: w.category ?? null,
  percentile: w.percentile ?? null,
  interpretation: w.interpretation ?? null,
  recommendation: w.recommendation ?? null,
}));
export type TotalInterpretation = z.output<typeof TotalInterpretationSchema>;

const DimensionResultWireSchema = z
  .object({
    dimensionId: z.number(),
    name: z.string(),
    directScore: z.number(),
    category: z.string().nullable().optional(),
    percentile: z.number().nullable().optional(),
    interpretation: z.string().nullable().optional(),
  })
  .loose();

export const DimensionResultSchema = DimensionResultWireSchema.transform((w) => ({
  dimensionId: w.dimensionId,
  name: w.name,
  directScore: w.directScore,
  category: w.category ?? null,
  percentile: w.percentile ?? null,
  interpretation: w.interpretation ?? null,
}));
export type DimensionResult = z.output<typeof DimensionResultSchema>;

// POST /attempts/{id}/score -> EntityView.of(Resultado)
export const ScoreAttemptResultSchema = z
  .object({
    id: z.number(),
    intentoId: z.number(),
    estrategiaCalificacionId: z.number().nullable().optional(),
    calculadoEn: serverDateTime,
    calculadoPorId: z.string().nullable().optional(),
    puntajeTotalDirecto: z.number(),
    cantidadItems: z.number(),
    cantidadCorrectas: z.number(),
    cantidadIncorrectas: z.number(),
    cantidadPendientesRevision: z.number(),
    requiereRevisionManual: z.boolean(),
    estado: z.string(),
  })
  .loose()
  .transform((w) => ({
    id: w.id,
    attemptId: w.intentoId,
    scoringStrategyId: w.estrategiaCalificacionId ?? null,
    scoredAt: w.calculadoEn,
    scoredById: w.calculadoPorId ?? null,
    totalDirectScore: w.puntajeTotalDirecto,
    itemCount: w.cantidadItems,
    correctCount: w.cantidadCorrectas,
    incorrectCount: w.cantidadIncorrectas,
    pendingReviewCount: w.cantidadPendientesRevision,
    requiresManualReview: w.requiereRevisionManual,
    status: w.estado,
  }));
export type ScoreAttemptResult = z.output<typeof ScoreAttemptResultSchema>;

// GET /attempts/{id}/result -> IndividualResultView
export const AttemptResultSchema = z
  .object({
    attemptId: z.number(),
    resultId: z.number(),
    status: z.string(),
    totalScore: z.number(),
    totalInterpretation: TotalInterpretationSchema.nullable().optional(),
    dimensions: z.array(DimensionResultSchema),
    disclaimer: z.string(),
  })
  .loose()
  .transform((w) => ({
    attemptId: w.attemptId,
    resultId: w.resultId,
    status: w.status,
    totalScore: w.totalScore,
    totalInterpretation: w.totalInterpretation ?? null,
    dimensions: w.dimensions,
    disclaimer: w.disclaimer,
  }));
export type AttemptResult = z.output<typeof AttemptResultSchema>;

const ItemImageSchema = z
  .object({
    imageId: z.number(),
    url: z.string(),
    role: z.string(),
    order: z.number(),
    altText: z.string().nullable().optional(),
  })
  .loose()
  .transform((w) => ({
    imageId: w.imageId,
    url: w.url,
    role: w.role,
    order: w.order,
    altText: w.altText ?? null,
  }));

const OptionImageSchema = z
  .object({
    imageId: z.number(),
    url: z.string(),
    order: z.number(),
    altText: z.string().nullable().optional(),
  })
  .loose()
  .transform((w) => ({
    imageId: w.imageId,
    url: w.url,
    order: w.order,
    altText: w.altText ?? null,
  }));

const OptionDetailedResponseSchema = z
  .object({
    optionId: z.number(),
    code: z.string().nullable().optional(),
    text: z.string(),
    order: z.number(),
    ordinalValue: z.number().nullable().optional(),
    images: z.array(OptionImageSchema),
    isCorrect: z.boolean(),
    selected: z.boolean(),
  })
  .loose()
  .transform((w) => ({
    optionId: w.optionId,
    code: w.code ?? null,
    text: w.text,
    order: w.order,
    ordinalValue: w.ordinalValue ?? null,
    images: w.images,
    isCorrect: w.isCorrect,
    selected: w.selected,
  }));

const ResponseDetailSchema = z
  .object({
    respuestaId: z.number().nullable().optional(),
    textAnswer: z.string().nullable().optional(),
    numericAnswer: z.number().nullable().optional(),
    timeUsedSeconds: z.number().nullable().optional(),
    answeredAt: serverDateTime.nullable().optional(),
    graded: z.boolean().nullable().optional(),
    scoreObtained: z.number().nullable().optional(),
    isCorrect: z.boolean().nullable().optional(),
    requiresManualReview: z.boolean().nullable().optional(),
    observation: z.string().nullable().optional(),
  })
  .loose()
  .transform((w) => ({
    responseId: w.respuestaId ?? null,
    textAnswer: w.textAnswer ?? null,
    numericAnswer: w.numericAnswer ?? null,
    timeUsedSeconds: w.timeUsedSeconds ?? null,
    answeredAt: w.answeredAt ?? null,
    graded: w.graded ?? null,
    scoreObtained: w.scoreObtained ?? null,
    isCorrect: w.isCorrect ?? null,
    requiresManualReview: w.requiresManualReview ?? null,
    observation: w.observation ?? null,
  }));

const ItemDetailedResponseSchema = z
  .object({
    itemId: z.number(),
    code: z.string(),
    order: z.number(),
    prompt: z.string(),
    itemType: z.string(),
    responseType: z.string(),
    baseScore: z.number().nullable().optional(),
    timeLimitSeconds: z.number().nullable().optional(),
    required: z.boolean(),
    images: z.array(ItemImageSchema),
    options: z.array(OptionDetailedResponseSchema),
    response: ResponseDetailSchema.nullable().optional(),
  })
  .loose()
  .transform((w) => ({
    itemId: w.itemId,
    code: w.code,
    order: w.order,
    prompt: w.prompt,
    itemType: w.itemType,
    responseType: w.responseType,
    baseScore: w.baseScore ?? null,
    timeLimitSeconds: w.timeLimitSeconds ?? null,
    required: w.required,
    images: w.images,
    options: w.options,
    response: w.response ?? null,
  }));

const SubtestDetailedResponseSchema = z
  .object({
    subtestId: z.number(),
    name: z.string(),
    code: z.string(),
    order: z.number(),
    items: z.array(ItemDetailedResponseSchema),
  })
  .loose();

// GET /attempts/{id}/detailed-result -> DetailedAttemptResultView
export const DetailedAttemptResultSchema = z
  .object({
    attemptId: z.number(),
    resultId: z.number().nullable().optional(),
    testName: z.string(),
    testVersion: z.string(),
    participantName: z.string(),
    participantCode: z.string(),
    academicGroup: z.string().nullable().optional(),
    carrera: z.string().nullable().optional(),
    cohorte: z.string().nullable().optional(),
    attemptStatus: AttemptStatusSchema,
    startedAt: serverDateTime.nullable().optional(),
    finishedAt: serverDateTime.nullable().optional(),
    totalTimeSeconds: z.number().nullable().optional(),
    deviceInfo: z.string().nullable().optional(),
    ipAddress: z.string().nullable().optional(),
    totalScore: z.number().nullable().optional(),
    scoredAt: serverDateTime.nullable().optional(),
    correctCount: z.number().nullable().optional(),
    incorrectCount: z.number().nullable().optional(),
    pendingReviewCount: z.number().nullable().optional(),
    requiresManualReview: z.boolean().nullable().optional(),
    totalInterpretation: TotalInterpretationSchema.nullable().optional(),
    dimensions: z.array(DimensionResultSchema),
    subtests: z.array(SubtestDetailedResponseSchema),
    disclaimer: z.string(),
  })
  .loose()
  .transform((w) => ({
    attemptId: w.attemptId,
    resultId: w.resultId ?? null,
    testName: w.testName,
    testVersion: w.testVersion,
    participantName: w.participantName,
    participantCode: w.participantCode,
    academicGroup: w.academicGroup ?? null,
    career: w.carrera ?? null,
    cohort: w.cohorte ?? null,
    attemptStatus: w.attemptStatus,
    startedAt: w.startedAt ?? null,
    finishedAt: w.finishedAt ?? null,
    totalTimeSeconds: w.totalTimeSeconds ?? null,
    deviceInfo: w.deviceInfo ?? null,
    ipAddress: w.ipAddress ?? null,
    totalScore: w.totalScore ?? null,
    scoredAt: w.scoredAt ?? null,
    correctCount: w.correctCount ?? null,
    incorrectCount: w.incorrectCount ?? null,
    pendingReviewCount: w.pendingReviewCount ?? null,
    requiresManualReview: w.requiresManualReview ?? null,
    totalInterpretation: w.totalInterpretation ?? null,
    dimensions: w.dimensions,
    subtests: w.subtests,
    disclaimer: w.disclaimer,
  }));
export type DetailedAttemptResult = z.output<typeof DetailedAttemptResultSchema>;

// GET /analytics/sessions/{id}/summary & GET /dashboard/overview -> SessionResultSummary
export const SessionResultSummarySchema = z
  .object({
    sessionId: z.number(),
    assignedCount: z.number(),
    startedCount: z.number(),
    completedCount: z.number(),
    scoredCount: z.number(),
  })
  .loose();
export type SessionResultSummary = z.output<typeof SessionResultSummarySchema>;

// GET /analytics/results -> DimensionAggregateView[]
export const DimensionAggregateSchema = z
  .object({
    dimensionId: z.number(),
    name: z.string(),
    count: z.number(),
    averageDirectScore: z.number().nullable().optional(),
    suppressedByPrivacyThreshold: z.boolean(),
  })
  .loose()
  .transform((w) => ({
    dimensionId: w.dimensionId,
    name: w.name,
    count: w.count,
    averageDirectScore: w.averageDirectScore ?? null,
    suppressedByPrivacyThreshold: w.suppressedByPrivacyThreshold,
  }));
export type DimensionAggregate = z.output<typeof DimensionAggregateSchema>;
export const DimensionAggregateListSchema = z.array(DimensionAggregateSchema);

// GET /reports, POST /reports/individual, POST /reports/aggregate -> EntityView.of(ReporteGenerado)
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

// GET /manual-review/pending, POST /manual-review/answers/{id}/pending, PUT /manual-review/{id}
export const PendingReviewSchema = z
  .object({
    reviewId: z.number(),
    answerId: z.number(),
    attemptId: z.number(),
    participantId: z.string(),
    participantName: z.string(),
    itemId: z.number(),
    itemCode: z.string(),
    prompt: z.string(),
    textAnswer: z.string().nullable().optional(),
    numericAnswer: z.number().nullable().optional(),
    status: ManualReviewStatusSchema,
    score: z.number().nullable().optional(),
    comment: z.string().nullable().optional(),
    createdAt: serverDateTime,
    reviewedAt: serverDateTime.nullable().optional(),
  })
  .loose()
  .transform((w) => ({
    reviewId: w.reviewId,
    answerId: w.answerId,
    attemptId: w.attemptId,
    participantId: w.participantId,
    participantName: w.participantName,
    itemId: w.itemId,
    itemCode: w.itemCode,
    prompt: w.prompt,
    textAnswer: w.textAnswer ?? null,
    numericAnswer: w.numericAnswer ?? null,
    status: w.status,
    score: w.score ?? null,
    comment: w.comment ?? null,
    createdAt: w.createdAt,
    reviewedAt: w.reviewedAt ?? null,
  }));
export type PendingReview = z.output<typeof PendingReviewSchema>;
export const PendingReviewListSchema = z.array(PendingReviewSchema);

export type ReportFormat = z.output<typeof ReportFormatSchema>;
export type AttemptStatus = z.output<typeof AttemptStatusSchema>;
export type ManualReviewStatus = z.output<typeof ManualReviewStatusSchema>;
