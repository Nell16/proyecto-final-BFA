import { z } from "zod";
import { serverDateTime } from "./datetime";

// ---------------------------------------------------------------------------
// Enums canónicos del backend (psychoform/instrument/model/*)
// ---------------------------------------------------------------------------

/** EstadoGeneral.java */
export const GeneralStatusSchema = z.enum(["ACTIVO", "INACTIVO", "DESCONOCIDO"]).catch("DESCONOCIDO");
export type GeneralStatus = z.output<typeof GeneralStatusSchema>;

/**
 * EstadoVersionTest.java: BORRADOR, EN_REVISION, APROBADO, PUBLICADO, RETIRADO.
 * Nota: conventions-api.md §5 menciona PUBLICADA/HISTORICA (del types.ts legacy),
 * pero el enum real del backend y VersionTestService.publishVersion usa PUBLICADO/RETIRADO/EN_REVISION.
 */
export const VersionStatusSchema = z
  .enum(["BORRADOR", "EN_REVISION", "APROBADO", "PUBLICADO", "RETIRADO", "DESCONOCIDO"])
  .catch("DESCONOCIDO");
export type VersionStatus = z.output<typeof VersionStatusSchema>;

/** EstadoConfiguracion.java: BORRADOR, EN_REVISION, APROBADO, PUBLICADO, RETIRADO. */
export const ConfigurationStatusSchema = z
  .enum(["BORRADOR", "EN_REVISION", "APROBADO", "PUBLICADO", "RETIRADO", "DESCONOCIDO"])
  .catch("DESCONOCIDO");
export type ConfigurationStatus = z.output<typeof ConfigurationStatusSchema>;

/** TipoItem.java */
export const ItemTypeSchema = z.enum([
  "SOLO_TEXTO",
  "SOLO_IMAGEN",
  "TEXTO_E_IMAGEN",
  "COMPARACION_IMAGENES",
  "RAZONAMIENTO_VERBAL",
]);
export type ItemType = z.output<typeof ItemTypeSchema>;

/** TipoRespuesta.java */
export const ResponseTypeSchema = z.enum([
  "OPCION_UNICA",
  "OPCION_MULTIPLE",
  "TEXTO_ABIERTO",
  "NUMERICA",
  "VERDADERO_FALSO",
]);
export type ResponseType = z.output<typeof ResponseTypeSchema>;

/** TipoReglaCalificacion.java */
export const ScoringRuleTypeSchema = z.enum([
  "CLAVE_ITEM",
  "OPCION_DIMENSION",
  "LIKERT",
  "NUMERICA_RANGO",
  "REVISION_MANUAL",
  "RUBRICA",
  "FORMULA",
]);
export type ScoringRuleType = z.output<typeof ScoringRuleTypeSchema>;

/** TipoEstrategiaCalificacion.java */
export const StrategyTypeSchema = z.enum([
  "CLAVE_SIMPLE",
  "MATRIZ_DIMENSIONAL",
  "LIKERT_ESCALA",
  "RESPUESTA_NUMERICA",
  "REVISION_MANUAL",
  "RUBRICA_MANUAL",
  "FORMULA_CONTROLADA",
]);
export type StrategyType = z.output<typeof StrategyTypeSchema>;

// ---------------------------------------------------------------------------
// Wire schemas -> Modelos de dominio en camelCase inglés
// ---------------------------------------------------------------------------

/**
 * ImageResourceDTO.java: (Long id, Integer numeroOrden, String textoAlternativo,
 * String rutaAlmacenamiento, String url, String rol).
 * El backend NO envía ninguno de los 15 alias legacy (imagenId, order, altText, publicUrl, etc.).
 */
export const ImageResourceWireSchema = z
  .object({
    id: z.number().int(),
    numeroOrden: z.number().int().nullish(),
    textoAlternativo: z.string().nullish(),
    rutaAlmacenamiento: z.string(),
    url: z.string().nullish(),
    rol: z.string().nullish(),
  })
  .loose()
  .transform((wire) => ({
    id: wire.id,
    order: wire.numeroOrden ?? null,
    altText: wire.textoAlternativo ?? null,
    storagePath: wire.rutaAlmacenamiento,
    url: wire.url ?? null,
    role: wire.rol ?? null,
  }));
export type ImageResource = z.output<typeof ImageResourceWireSchema>;

/** TestPsicologico.java serializado vía EntityView.of(...) */
export const TestInstrumentWireSchema = z
  .object({
    id: z.number().int(),
    codigoTest: z.string(),
    nombreTest: z.string(),
    descripcion: z.string().nullish(),
    creadoPorId: z.string().nullish(),
    estado: GeneralStatusSchema,
    creadoEn: serverDateTime,
  })
  .loose()
  .transform((wire) => ({
    id: wire.id,
    code: wire.codigoTest,
    name: wire.nombreTest,
    description: wire.descripcion ?? null,
    createdById: wire.creadoPorId ?? null,
    status: wire.estado,
    createdAt: wire.creadoEn,
  }));
export type TestInstrument = z.output<typeof TestInstrumentWireSchema>;
export const TestInstrumentListWireSchema = z.array(TestInstrumentWireSchema);

/** VersionTest.java serializado vía EntityView.of(...) */
export const TestVersionWireSchema = z
  .object({
    id: z.number().int(),
    testId: z.number().int().nullish(),
    estrategiaCalificacionId: z.number().int().nullish(),
    numeroVersion: z.string(),
    estado: VersionStatusSchema,
    instruccionesGenerales: z.string().nullish(),
    tiempoLimiteSegundos: z.number().int().nullish(),
    permiteAleatorizarSubtests: z.boolean(),
    permiteAleatorizarItems: z.boolean(),
    aprobadoPorId: z.string().nullish(),
    aprobadoEn: serverDateTime.nullish(),
    publicadoEn: serverDateTime.nullish(),
    creadoPorId: z.string().nullish(),
    creadoEn: serverDateTime,
  })
  .loose()
  .transform((wire) => ({
    id: wire.id,
    testId: wire.testId ?? null,
    strategyId: wire.estrategiaCalificacionId ?? null,
    number: wire.numeroVersion,
    status: wire.estado,
    instructions: wire.instruccionesGenerales ?? null,
    timeLimitSeconds: wire.tiempoLimiteSegundos ?? null,
    randomizeSubtests: wire.permiteAleatorizarSubtests,
    randomizeItems: wire.permiteAleatorizarItems,
    approvedById: wire.aprobadoPorId ?? null,
    approvedAt: wire.aprobadoEn ?? null,
    publishedAt: wire.publicadoEn ?? null,
    createdById: wire.creadoPorId ?? null,
    createdAt: wire.creadoEn,
  }));
export type TestVersion = z.output<typeof TestVersionWireSchema>;
export const TestVersionListWireSchema = z.array(TestVersionWireSchema);

/** Subtest.java serializado vía EntityView.of(...) */
export const SubtestWireSchema = z
  .object({
    id: z.number().int(),
    versionTestId: z.number().int().nullish(),
    estrategiaCalificacionId: z.number().int().nullish(),
    codigoSubtest: z.string(),
    nombreSubtest: z.string(),
    descripcion: z.string().nullish(),
    instrucciones: z.string().nullish(),
    numeroOrden: z.number().int(),
    tiempoLimiteSegundos: z.number().int().nullish(),
    permiteAleatorizarItems: z.boolean(),
    permiteAleatorizarOpciones: z.boolean(),
    esObligatorio: z.boolean(),
    estado: GeneralStatusSchema,
  })
  .loose()
  .transform((wire) => ({
    id: wire.id,
    versionId: wire.versionTestId ?? null,
    strategyId: wire.estrategiaCalificacionId ?? null,
    code: wire.codigoSubtest,
    name: wire.nombreSubtest,
    description: wire.descripcion ?? null,
    instructions: wire.instrucciones ?? null,
    order: wire.numeroOrden,
    timeLimitSeconds: wire.tiempoLimiteSegundos ?? null,
    randomizeItems: wire.permiteAleatorizarItems,
    randomizeOptions: wire.permiteAleatorizarOpciones,
    required: wire.esObligatorio,
    status: wire.estado,
  }));
export type Subtest = z.output<typeof SubtestWireSchema>;
export const SubtestListWireSchema = z.array(SubtestWireSchema);

/** ItemDTO.java (GET /subtests/{id}/items) e Item.java vía EntityView.of (POST/PATCH) */
export const ItemWireSchema = z
  .object({
    id: z.number().int(),
    subtestId: z.number().int().nullish(),
    codigoItem: z.string(),
    tipoItem: ItemTypeSchema,
    tipoRespuesta: ResponseTypeSchema,
    enunciado: z.string().nullish(),
    instruccion: z.string().nullish(),
    numeroOrden: z.number().int(),
    puntajeBase: z.number(),
    tiempoLimiteSegundos: z.number().int().nullish(),
    esObligatorio: z.boolean(),
    esConfidencial: z.boolean(),
    estado: GeneralStatusSchema,
    imagenes: z.array(ImageResourceWireSchema).nullish(),
  })
  .loose()
  .transform((wire) => ({
    id: wire.id,
    subtestId: wire.subtestId ?? null,
    code: wire.codigoItem,
    itemType: wire.tipoItem,
    responseType: wire.tipoRespuesta,
    prompt: wire.enunciado ?? null,
    instruction: wire.instruccion ?? null,
    order: wire.numeroOrden,
    baseScore: wire.puntajeBase,
    timeLimitSeconds: wire.tiempoLimiteSegundos ?? null,
    required: wire.esObligatorio,
    confidential: wire.esConfidencial,
    status: wire.estado,
    images: wire.imagenes ?? [],
  }));
export type Item = z.output<typeof ItemWireSchema>;
export const ItemListWireSchema = z.array(ItemWireSchema);

/** OptionDTO.java (GET /items/{id}/options) y OpcionItem.java vía EntityView.of (POST/PATCH) */
export const OptionWireSchema = z
  .object({
    id: z.number().int(),
    itemId: z.number().int().nullish(),
    codigoOpcion: z.string(),
    textoOpcion: z.string().nullish(),
    numeroOrden: z.number().int(),
    valorOrdinal: z.number().nullish(),
    estado: GeneralStatusSchema,
    imagenes: z.array(ImageResourceWireSchema).nullish(),
  })
  .loose()
  .transform((wire) => ({
    id: wire.id,
    itemId: wire.itemId ?? null,
    code: wire.codigoOpcion,
    text: wire.textoOpcion ?? null,
    order: wire.numeroOrden,
    ordinalValue: wire.valorOrdinal ?? null,
    status: wire.estado,
    images: wire.imagenes ?? [],
  }));
export type Option = z.output<typeof OptionWireSchema>;
export const OptionListWireSchema = z.array(OptionWireSchema);

/** ItemImageStorageService.ImageView (GET /items/{itemId}/images) */
export const ItemImageWireSchema = z
  .object({
    id: z.number().int(),
    resourceId: z.number().int(),
    testId: z.number().int(),
    versionId: z.number().int(),
    subtestId: z.number().int(),
    itemId: z.number().int(),
    itemOrder: z.number().int(),
    role: z.string(),
    order: z.number().int(),
    altText: z.string().nullish(),
    fileName: z.string(),
    mimeType: z.string(),
    sizeBytes: z.number().int(),
    url: z.string(),
  })
  .loose()
  .transform((wire) => ({
    id: wire.id,
    resourceId: wire.resourceId,
    testId: wire.testId,
    versionId: wire.versionId,
    subtestId: wire.subtestId,
    itemId: wire.itemId,
    itemOrder: wire.itemOrder,
    role: wire.role,
    order: wire.order,
    altText: wire.altText ?? null,
    fileName: wire.fileName,
    mimeType: wire.mimeType,
    sizeBytes: wire.sizeBytes,
    url: wire.url,
  }));
export type ItemImage = z.output<typeof ItemImageWireSchema>;
export const ItemImageListWireSchema = z.array(ItemImageWireSchema);

/** ImageUploadResponse.java vía EntityView.of (POST /items/{id}/images y /options/{id}/images) */
export const UploadedImageWireSchema = z
  .object({
    imageLinkId: z.number().int(),
    resourceId: z.number().int(),
    storagePath: z.string(),
    filename: z.string(),
    mimeType: z.string(),
    sizeBytes: z.number().int(),
    hash: z.string(),
    order: z.number().int(),
    altText: z.string().nullish(),
    role: z.string().nullish(),
  })
  .loose()
  .transform((wire) => ({
    imageLinkId: wire.imageLinkId,
    resourceId: wire.resourceId,
    storagePath: wire.storagePath,
    fileName: wire.filename,
    mimeType: wire.mimeType,
    sizeBytes: wire.sizeBytes,
    hash: wire.hash,
    order: wire.order,
    altText: wire.altText ?? null,
    role: wire.role ?? null,
  }));
export type UploadedImage = z.output<typeof UploadedImageWireSchema>;

/** SubtestCloneTemplateDTO.java (GET /subtests/{id}/clone-template) */
export const SubtestCloneImageTemplateWireSchema = z
  .object({
    sourceImageId: z.number().int(),
    resourceId: z.number().int(),
    order: z.number().int().nullish(),
    altText: z.string().nullish(),
    storagePath: z.string(),
    role: z.string().nullish(),
  })
  .loose()
  .transform((wire) => ({
    sourceImageId: wire.sourceImageId,
    resourceId: wire.resourceId,
    order: wire.order ?? null,
    altText: wire.altText ?? null,
    storagePath: wire.storagePath,
    role: wire.role ?? null,
  }));
export type SubtestCloneImageTemplate = z.output<typeof SubtestCloneImageTemplateWireSchema>;

export const SubtestCloneOptionTemplateWireSchema = z
  .object({
    sourceOptionId: z.number().int(),
    code: z.string(),
    text: z.string().nullish(),
    order: z.number().int(),
    ordinalValue: z.number().nullish(),
    estado: GeneralStatusSchema,
    images: z.array(SubtestCloneImageTemplateWireSchema),
  })
  .loose()
  .transform((wire) => ({
    sourceOptionId: wire.sourceOptionId,
    code: wire.code,
    text: wire.text ?? null,
    order: wire.order,
    ordinalValue: wire.ordinalValue ?? null,
    status: wire.estado,
    images: wire.images,
  }));
export type SubtestCloneOptionTemplate = z.output<typeof SubtestCloneOptionTemplateWireSchema>;

export const SubtestCloneAnswerKeyTemplateWireSchema = z
  .object({
    sourceAnswerKeyId: z.number().int(),
    sourceRuleId: z.number().int().nullish(),
    correctOptionSourceId: z.number().int().nullish(),
    expectedText: z.string().nullish(),
    expectedNumber: z.number().nullish(),
    numericTolerance: z.number().nullish(),
    score: z.number(),
    requiresManualReview: z.boolean(),
  })
  .loose()
  .transform((wire) => ({
    sourceAnswerKeyId: wire.sourceAnswerKeyId,
    sourceRuleId: wire.sourceRuleId ?? null,
    correctOptionSourceId: wire.correctOptionSourceId ?? null,
    expectedText: wire.expectedText ?? null,
    expectedNumber: wire.expectedNumber ?? null,
    numericTolerance: wire.numericTolerance ?? null,
    score: wire.score,
    requiresManualReview: wire.requiresManualReview,
  }));
export type SubtestCloneAnswerKeyTemplate = z.output<typeof SubtestCloneAnswerKeyTemplateWireSchema>;

export const SubtestCloneItemTemplateWireSchema = z
  .object({
    sourceItemId: z.number().int(),
    code: z.string(),
    itemType: ItemTypeSchema,
    responseType: ResponseTypeSchema,
    prompt: z.string().nullish(),
    instruction: z.string().nullish(),
    order: z.number().int(),
    baseScore: z.number(),
    timeLimitSeconds: z.number().int().nullish(),
    required: z.boolean(),
    confidential: z.boolean(),
    estado: GeneralStatusSchema,
    images: z.array(SubtestCloneImageTemplateWireSchema),
    options: z.array(SubtestCloneOptionTemplateWireSchema),
    answerKey: SubtestCloneAnswerKeyTemplateWireSchema.nullish(),
  })
  .loose()
  .transform((wire) => ({
    sourceItemId: wire.sourceItemId,
    code: wire.code,
    itemType: wire.itemType,
    responseType: wire.responseType,
    prompt: wire.prompt ?? null,
    instruction: wire.instruction ?? null,
    order: wire.order,
    baseScore: wire.baseScore,
    timeLimitSeconds: wire.timeLimitSeconds ?? null,
    required: wire.required,
    confidential: wire.confidential,
    status: wire.estado,
    images: wire.images,
    options: wire.options,
    answerKey: wire.answerKey ?? null,
  }));
export type SubtestCloneItemTemplate = z.output<typeof SubtestCloneItemTemplateWireSchema>;

export const SubtestCloneTemplateWireSchema = z
  .object({
    sourceSubtestId: z.number().int(),
    code: z.string(),
    name: z.string(),
    description: z.string().nullish(),
    instructions: z.string().nullish(),
    order: z.number().int(),
    timeLimitSeconds: z.number().int().nullish(),
    randomizeItems: z.boolean(),
    randomizeOptions: z.boolean(),
    required: z.boolean(),
    strategyId: z.number().int().nullish(),
    estado: GeneralStatusSchema,
    items: z.array(SubtestCloneItemTemplateWireSchema),
  })
  .loose()
  .transform((wire) => ({
    sourceSubtestId: wire.sourceSubtestId,
    code: wire.code,
    name: wire.name,
    description: wire.description ?? null,
    instructions: wire.instructions ?? null,
    order: wire.order,
    timeLimitSeconds: wire.timeLimitSeconds ?? null,
    randomizeItems: wire.randomizeItems,
    randomizeOptions: wire.randomizeOptions,
    required: wire.required,
    strategyId: wire.strategyId ?? null,
    status: wire.estado,
    items: wire.items,
  }));
export type SubtestCloneTemplate = z.output<typeof SubtestCloneTemplateWireSchema>;

/** EstrategiaCalificacion.java vía EntityView.of(...) */
export const ScoringStrategyWireSchema = z
  .object({
    id: z.number().int(),
    codigo: z.string(),
    nombre: z.string(),
    descripcion: z.string().nullish(),
    tipoEstrategia: StrategyTypeSchema,
    activa: z.boolean(),
    requiereRevisionManual: z.boolean(),
    permiteBaremo: z.boolean(),
    fechaCreacion: serverDateTime,
  })
  .loose()
  .transform((wire) => ({
    id: wire.id,
    code: wire.codigo,
    name: wire.nombre,
    description: wire.descripcion ?? null,
    strategyType: wire.tipoEstrategia,
    active: wire.activa,
    requiresManualReview: wire.requiereRevisionManual,
    allowsBaremo: wire.permiteBaremo,
    createdAt: wire.fechaCreacion,
  }));
export type ScoringStrategy = z.output<typeof ScoringStrategyWireSchema>;
export const ScoringStrategyListWireSchema = z.array(ScoringStrategyWireSchema);

/** ReglaCalificacion.java vía EntityView.of(...) */
export const ScoringRuleWireSchema = z
  .object({
    id: z.number().int(),
    versionTestId: z.number().int().nullish(),
    subtestId: z.number().int().nullish(),
    itemId: z.number().int().nullish(),
    estrategiaCalificacionId: z.number().int().nullish(),
    tipoRegla: ScoringRuleTypeSchema,
    prioridad: z.number().int(),
    activa: z.boolean(),
    estado: ConfigurationStatusSchema,
    parametros: z.string(),
    observacion: z.string().nullish(),
    creadoPorId: z.string().nullish(),
    creadoEn: serverDateTime,
    aprobadoPorId: z.string().nullish(),
    aprobadoEn: serverDateTime.nullish(),
  })
  .loose()
  .transform((wire) => ({
    id: wire.id,
    versionId: wire.versionTestId ?? null,
    subtestId: wire.subtestId ?? null,
    itemId: wire.itemId ?? null,
    strategyId: wire.estrategiaCalificacionId ?? null,
    ruleType: wire.tipoRegla,
    priority: wire.prioridad,
    active: wire.activa,
    status: wire.estado,
    parametersJson: wire.parametros,
    observation: wire.observacion ?? null,
    createdById: wire.creadoPorId ?? null,
    createdAt: wire.creadoEn,
    approvedById: wire.aprobadoPorId ?? null,
    approvedAt: wire.aprobadoEn ?? null,
  }));
export type ScoringRule = z.output<typeof ScoringRuleWireSchema>;
export const ScoringRuleListWireSchema = z.array(ScoringRuleWireSchema);

/** ClaveRespuesta.java vía EntityView.of(...) */
export const AnswerKeyWireSchema = z
  .object({
    id: z.number().int(),
    reglaCalificacionId: z.number().int().nullish(),
    itemId: z.number().int().nullish(),
    opcionCorrectaId: z.number().int().nullish(),
    textoEsperado: z.string().nullish(),
    valorNumericoEsperado: z.number().nullish(),
    toleranciaNumerica: z.number().nullish(),
    puntaje: z.number(),
    requiereRevisionManual: z.boolean(),
    creadoPorId: z.string().nullish(),
    creadoEn: serverDateTime,
  })
  .loose()
  .transform((wire) => ({
    id: wire.id,
    ruleId: wire.reglaCalificacionId ?? null,
    itemId: wire.itemId ?? null,
    correctOptionId: wire.opcionCorrectaId ?? null,
    expectedText: wire.textoEsperado ?? null,
    expectedNumber: wire.valorNumericoEsperado ?? null,
    numericTolerance: wire.toleranciaNumerica ?? null,
    score: wire.puntaje,
    requiresManualReview: wire.requiereRevisionManual,
    createdById: wire.creadoPorId ?? null,
    createdAt: wire.creadoEn,
  }));
export type AnswerKey = z.output<typeof AnswerKeyWireSchema>;
export const NullableAnswerKeyWireSchema = AnswerKeyWireSchema.nullable();

/** Baremo.java vía EntityView.of(...) */
export const BaremoWireSchema = z
  .object({
    id: z.number().int(),
    versionTestId: z.number().int().nullish(),
    dimensionResultadoId: z.number().int().nullish(),
    codigoBaremo: z.string(),
    nombre: z.string(),
    descripcion: z.string().nullish(),
    grupoNormativo: z.string().nullish(),
    criterioEdadMinima: z.number().int().nullish(),
    criterioEdadMaxima: z.number().int().nullish(),
    criterioSexoId: z.number().int().nullish(),
    criterioCarreraId: z.number().int().nullish(),
    vigenteDesde: z.string().nullish(),
    vigenteHasta: z.string().nullish(),
    estado: ConfigurationStatusSchema,
    creadoPorId: z.string().nullish(),
    creadoEn: serverDateTime,
    aprobadoPorId: z.string().nullish(),
    aprobadoEn: serverDateTime.nullish(),
  })
  .loose()
  .transform((wire) => ({
    id: wire.id,
    versionId: wire.versionTestId ?? null,
    dimensionId: wire.dimensionResultadoId ?? null,
    code: wire.codigoBaremo,
    name: wire.nombre,
    description: wire.descripcion ?? null,
    normativeGroup: wire.grupoNormativo ?? null,
    minAgeCriteria: wire.criterioEdadMinima ?? null,
    maxAgeCriteria: wire.criterioEdadMaxima ?? null,
    sexCriteriaId: wire.criterioSexoId ?? null,
    careerCriteriaId: wire.criterioCarreraId ?? null,
    validFrom: wire.vigenteDesde ?? null,
    validTo: wire.vigenteHasta ?? null,
    status: wire.estado,
    createdById: wire.creadoPorId ?? null,
    createdAt: wire.creadoEn,
    approvedById: wire.aprobadoPorId ?? null,
    approvedAt: wire.aprobadoEn ?? null,
  }));
export type Baremo = z.output<typeof BaremoWireSchema>;
export const BaremoListWireSchema = z.array(BaremoWireSchema);

/** RangoBaremo.java vía EntityView.of(...) */
export const BaremoRangeWireSchema = z
  .object({
    id: z.number().int(),
    baremoId: z.number().int().nullish(),
    puntajeMinimo: z.number(),
    puntajeMaximo: z.number(),
    percentil: z.number().nullish(),
    categoria: z.string(),
    interpretacion: z.string().nullish(),
    recomendacion: z.string().nullish(),
    orden: z.number().int(),
  })
  .loose()
  .transform((wire) => ({
    id: wire.id,
    baremoId: wire.baremoId ?? null,
    minScore: wire.puntajeMinimo,
    maxScore: wire.puntajeMaximo,
    percentile: wire.percentil ?? null,
    category: wire.categoria,
    interpretation: wire.interpretacion ?? null,
    recommendation: wire.recomendacion ?? null,
    order: wire.orden,
  }));
export type BaremoRange = z.output<typeof BaremoRangeWireSchema>;
export const BaremoRangeListWireSchema = z.array(BaremoRangeWireSchema);

// ---------------------------------------------------------------------------
// Request schemas individuales (DTOs de entrada Java)
// ---------------------------------------------------------------------------

export const TestRequestSchema = z.object({
  code: z.string().trim().min(1),
  name: z.string().trim().min(1),
  description: z.string().nullish(),
});
export type TestPayload = z.output<typeof TestRequestSchema>;

export const VersionRequestSchema = z.object({
  number: z.string().trim().min(1),
  strategyId: z.number().int().positive().nullish(),
  instructions: z.string().nullish(),
  timeLimitSeconds: z.number().int().positive().nullish(),
  randomizeSubtests: z.boolean().nullish(),
  randomizeItems: z.boolean().nullish(),
});
export type VersionPayload = z.output<typeof VersionRequestSchema>;

export const SubtestRequestSchema = z.object({
  code: z.string().trim().min(1),
  name: z.string().trim().min(1),
  description: z.string().nullish(),
  instructions: z.string().nullish(),
  order: z.number().int(),
  timeLimitSeconds: z.number().int().positive().nullish(),
  randomizeItems: z.boolean().nullish(),
  randomizeOptions: z.boolean().nullish(),
  required: z.boolean().nullish(),
  strategyId: z.number().int().positive().nullish(),
});
export type SubtestPayload = z.output<typeof SubtestRequestSchema>;

export const ItemRequestSchema = z.object({
  code: z.string().trim().min(1),
  itemType: ItemTypeSchema,
  responseType: ResponseTypeSchema,
  prompt: z.string().nullish(),
  instruction: z.string().nullish(),
  order: z.number().int(),
  baseScore: z.number().min(0).nullish(),
  timeLimitSeconds: z.number().int().positive().nullish(),
  required: z.boolean().nullish(),
  confidential: z.boolean().nullish(),
});
export type ItemPayload = z.output<typeof ItemRequestSchema>;

export const OptionRequestSchema = z.object({
  code: z.string().trim().min(1),
  text: z.string().nullish(),
  order: z.number().int(),
  ordinalValue: z.number().nullish(),
});
export type OptionPayload = z.output<typeof OptionRequestSchema>;

export const ScoringRuleRequestSchema = z.object({
  strategyId: z.number().int().positive(),
  ruleType: ScoringRuleTypeSchema,
  itemId: z.number().int().positive().nullish(),
  priority: z.number().int().positive().nullish(),
  parametersJson: z.string().nullish(),
  observation: z.string().nullish(),
});
export type ScoringRulePayload = z.output<typeof ScoringRuleRequestSchema>;

export const AnswerKeyRequestSchema = z.object({
  ruleId: z.number().int().positive(),
  correctOptionId: z.number().int().positive().nullish(),
  expectedText: z.string().nullish(),
  expectedNumber: z.number().nullish(),
  numericTolerance: z.number().min(0).nullish(),
  score: z.number().min(0).nullish(),
  requiresManualReview: z.boolean().nullish(),
});
export type AnswerKeyPayload = z.output<typeof AnswerKeyRequestSchema>;

export const BaremoRequestSchema = z.object({
  versionId: z.number().int().positive(),
  dimensionId: z.number().int().positive().nullish(),
  code: z.string().trim().min(1),
  name: z.string().trim().min(1),
  description: z.string().nullish(),
  normativeGroup: z.string().nullish(),
});
export type BaremoPayload = z.output<typeof BaremoRequestSchema>;

export const BaremoRangeRequestSchema = z.object({
  minScore: z.number(),
  maxScore: z.number(),
  percentile: z.number().min(0).max(100).nullish(),
  category: z.string().trim().min(1),
  interpretation: z.string().nullish(),
  recommendation: z.string().nullish(),
  order: z.number().int(),
});
export type BaremoRangePayload = z.output<typeof BaremoRangeRequestSchema>;

// ---------------------------------------------------------------------------
// VersionConfigurationRequest (POST /test-versions/{id}/configuration)
// ---------------------------------------------------------------------------
//
// Reglas reales descubiertas en InstrumentAdminService.java (saveConfiguration):
// 1. La versión destino debe existir y estar en estado BORRADOR (requireDraft),
//    de lo contrario el backend rechaza con IllegalStateException.
// 2. Validación previa (validateConfigurationRequest) antes de persistir:
//    - Entre nodos con status !== "DELETED", `code` (trim + case-insensitive) y
//      `order` (cuando != null) deben ser únicos por nivel (subtests en versión,
//      ítems por subtest, opciones por ítem).
// 3. Comportamiento de `status === "DELETED"`:
//    - SubtestDraft / ItemDraft / OptionDraft / ImageDraft: si `id != null`, hace
//      `em.remove(find(...))` y salta sus hijos (`continue`). Si `id == null`, es no-op.
//      En ImageDraft solo borra el vínculo ImagenItem/ImagenOpcion, no el RecursoMultimedia.
//    - AnswerKeyDraft con `status === "DELETED"`: `persistDraftItems` lo IGNORA
//      (`if (draft.answerKey() != null && draft.answerKey().status() != DELETED)`),
//      es decir, NO elimina una clave existente.
// 4. Creación vs actualización:
//    - El backend decide crear (`em.persist`) o actualizar (`em.find`) según `id == null`
//      vs `id != null`, independientemente de si `status` es EXISTING, CREATED o UPDATED.
//    - `sourceId` es metadata de clonación y no se persiste.
//    - En SubtestDraft con `id != null`, valida que pertenezca a `versionId`.
//    - `SubtestDraft.randomizeItems` se fuerza a `false` si `version.permiteAleatorizarItems !== true`.
//    - Defaults de nulabilidad en backend: `required` -> true, `confidential` -> true,
//      `baseScore` -> 1, `ImageDraft.role` (solo ítems) -> "ENUNCIADO",
//      `AnswerKeyDraft.score` -> 1, `requiresManualReview` -> false.
// 5. Resolución de `correctOptionDraftId`:
//    - `persistDraftItems` construye un mapa `optionsByDraftId` por subtest con todas
//      las opciones NO eliminadas que tengan `draftId != null` (tras persistirlas).
//    - Las AnswerKeyDraft se persisten al final del subtest; si `correctOptionDraftId != null`
//      busca en `optionsByDraftId` (y lanza EntityNotFoundException si no existe, p. ej. si la
//      opción fue DELETED). Solo si `correctOptionDraftId == null` usa `correctOptionId`.
// 6. Respuesta del endpoint:
//    - Devuelve `List<Subtest>` (solo los subtests no eliminados) vía `EntityView.of(...)`.

export const DraftStatusSchema = z.enum(["EXISTING", "CREATED", "UPDATED", "DELETED"]);
export type DraftStatus = z.output<typeof DraftStatusSchema>;

const normalizeDraftCode = (value: string | null | undefined): string => (value ?? "").trim().toUpperCase();

interface DraftCodeOrderNode {
  status: DraftStatus;
  code?: string | null | undefined;
  order?: number | null | undefined;
}

function validateUniqueCodesAndOrders(
  nodes: readonly DraftCodeOrderNode[],
  label: string,
  basePath: PropertyKey[],
  ctx: z.RefinementCtx,
): void {
  const seenCodes = new Set<string>();
  const seenOrders = new Set<number>();

  nodes.forEach((node, index) => {
    if (node.status === "DELETED") return;

    const normalizedCode = normalizeDraftCode(node.code);
    if (seenCodes.has(normalizedCode)) {
      ctx.addIssue({
        code: "custom",
        path: [...basePath, index, "code"],
        message: `Código de ${label} duplicado: ${node.code ?? ""}`,
      });
    } else {
      seenCodes.add(normalizedCode);
    }

    if (node.order !== null && node.order !== undefined) {
      if (seenOrders.has(node.order)) {
        ctx.addIssue({
          code: "custom",
          path: [...basePath, index, "order"],
          message: `Orden de ${label} duplicado: ${node.order}`,
        });
      } else {
        seenOrders.add(node.order);
      }
    }
  });
}

function requireNonBlankWhenActive(
  value: string | null | undefined,
  field: string,
  label: string,
  ctx: z.RefinementCtx,
): void {
  if (!value || value.trim() === "") {
    ctx.addIssue({
      code: "custom",
      path: [field],
      message: `${label} es requerido cuando status no es DELETED`,
    });
  }
}

export const ImageDraftSchema = z
  .object({
    id: z.number().int().positive().nullish(),
    draftId: z.string().nullish(),
    sourceId: z.number().int().positive().nullish(),
    resourceId: z.number().int().positive().nullish(),
    status: DraftStatusSchema,
    order: z.number().int().nullish(),
    altText: z.string().nullish(),
    role: z.string().nullish(),
  })
  .superRefine((draft, ctx) => {
    if (draft.status !== "DELETED" && (draft.resourceId === null || draft.resourceId === undefined)) {
      ctx.addIssue({
        code: "custom",
        path: ["resourceId"],
        message: "resourceId es requerido cuando status no es DELETED",
      });
    }
  });
export type ImageDraft = z.output<typeof ImageDraftSchema>;

export const OptionDraftSchema = z
  .object({
    id: z.number().int().positive().nullish(),
    draftId: z.string().nullish(),
    sourceId: z.number().int().positive().nullish(),
    status: DraftStatusSchema,
    code: z.string().nullish(),
    text: z.string().nullish(),
    order: z.number().int().nullish(),
    ordinalValue: z.number().nullish(),
    images: z.array(ImageDraftSchema).nullish(),
  })
  .superRefine((draft, ctx) => {
    if (draft.status !== "DELETED") {
      requireNonBlankWhenActive(draft.code, "code", "code", ctx);
    }
  });
export type OptionDraft = z.output<typeof OptionDraftSchema>;

export const AnswerKeyDraftSchema = z
  .object({
    id: z.number().int().positive().nullish(),
    draftId: z.string().nullish(),
    sourceId: z.number().int().positive().nullish(),
    status: DraftStatusSchema,
    ruleId: z.number().int().positive().nullish(),
    correctOptionDraftId: z.string().nullish(),
    correctOptionId: z.number().int().positive().nullish(),
    expectedText: z.string().nullish(),
    expectedNumber: z.number().nullish(),
    numericTolerance: z.number().min(0).nullish(),
    score: z.number().min(0).nullish(),
    requiresManualReview: z.boolean().nullish(),
  })
  .superRefine((draft, ctx) => {
    if (draft.status !== "DELETED" && (draft.ruleId === null || draft.ruleId === undefined)) {
      ctx.addIssue({
        code: "custom",
        path: ["ruleId"],
        message: "ruleId es requerido cuando status no es DELETED",
      });
    }
  });
export type AnswerKeyDraft = z.output<typeof AnswerKeyDraftSchema>;

export const ItemDraftSchema = z
  .object({
    id: z.number().int().positive().nullish(),
    draftId: z.string().nullish(),
    sourceId: z.number().int().positive().nullish(),
    status: DraftStatusSchema,
    code: z.string().nullish(),
    itemType: ItemTypeSchema.nullish(),
    responseType: ResponseTypeSchema.nullish(),
    prompt: z.string().nullish(),
    instruction: z.string().nullish(),
    order: z.number().int().nullish(),
    baseScore: z.number().min(0).nullish(),
    timeLimitSeconds: z.number().int().positive().nullish(),
    required: z.boolean().nullish(),
    confidential: z.boolean().nullish(),
    images: z.array(ImageDraftSchema).nullish(),
    options: z.array(OptionDraftSchema).nullish(),
    answerKey: AnswerKeyDraftSchema.nullish(),
  })
  .superRefine((draft, ctx) => {
    if (draft.status === "DELETED") return;
    requireNonBlankWhenActive(draft.code, "code", "code", ctx);
    if (!draft.itemType) {
      ctx.addIssue({ code: "custom", path: ["itemType"], message: "itemType es requerido" });
    }
    if (!draft.responseType) {
      ctx.addIssue({ code: "custom", path: ["responseType"], message: "responseType es requerido" });
    }
    if (draft.options) {
      validateUniqueCodesAndOrders(draft.options, "opción", ["options"], ctx);
    }
  });
export type ItemDraft = z.output<typeof ItemDraftSchema>;

export const SubtestDraftSchema = z
  .object({
    id: z.number().int().positive().nullish(),
    draftId: z.string().nullish(),
    sourceId: z.number().int().positive().nullish(),
    status: DraftStatusSchema,
    code: z.string().nullish(),
    name: z.string().nullish(),
    description: z.string().nullish(),
    instructions: z.string().nullish(),
    order: z.number().int().nullish(),
    timeLimitSeconds: z.number().int().positive().nullish(),
    randomizeItems: z.boolean().nullish(),
    randomizeOptions: z.boolean().nullish(),
    required: z.boolean().nullish(),
    strategyId: z.number().int().positive().nullish(),
    items: z.array(ItemDraftSchema).nullish(),
  })
  .superRefine((draft, ctx) => {
    if (draft.status === "DELETED") return;
    requireNonBlankWhenActive(draft.code, "code", "code", ctx);
    requireNonBlankWhenActive(draft.name, "name", "name", ctx);
    if (draft.items) {
      validateUniqueCodesAndOrders(draft.items, "ítem", ["items"], ctx);
    }
  });
export type SubtestDraft = z.output<typeof SubtestDraftSchema>;

export const VersionConfigurationRequestSchema = z
  .object({
    subtests: z.array(SubtestDraftSchema),
  })
  .superRefine((req, ctx) => {
    validateUniqueCodesAndOrders(req.subtests, "subtest", ["subtests"], ctx);

    req.subtests.forEach((subtest, subtestIdx) => {
      if (subtest.status === "DELETED" || !subtest.items) return;

      const optionsByDraftId = new Set<string>();
      for (const item of subtest.items) {
        if (item.status === "DELETED" || !item.options) continue;
        for (const option of item.options) {
          if (option.status !== "DELETED" && option.draftId) {
            optionsByDraftId.add(option.draftId);
          }
        }
      }

      subtest.items.forEach((item, itemIdx) => {
        if (item.status === "DELETED" || !item.answerKey || item.answerKey.status === "DELETED") return;
        const draftRef = item.answerKey.correctOptionDraftId;
        if (draftRef !== null && draftRef !== undefined && !optionsByDraftId.has(draftRef)) {
          ctx.addIssue({
            code: "custom",
            path: ["subtests", subtestIdx, "items", itemIdx, "answerKey", "correctOptionDraftId"],
            message: `correctOptionDraftId no encontrado entre las opciones activas del subtest: ${draftRef}`,
          });
        }
      });
    });
  });

export type VersionConfigurationPayload = z.output<typeof VersionConfigurationRequestSchema>;
