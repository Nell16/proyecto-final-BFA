import { z } from "zod";
import { staffClient } from "../client";
import { type ApiEnvelope, unwrap } from "../errors";
import { parseOrThrow } from "../schemas/parse";
import {
  type AnswerKey,
  type AnswerKeyPayload,
  AnswerKeyWireSchema,
  type Baremo,
  BaremoListWireSchema,
  type BaremoPayload,
  type BaremoRange,
  BaremoRangeListWireSchema,
  type BaremoRangePayload,
  BaremoRangeWireSchema,
  BaremoWireSchema,
  type Item,
  type ItemImage,
  ItemImageListWireSchema,
  ItemListWireSchema,
  type ItemPayload,
  ItemWireSchema,
  NullableAnswerKeyWireSchema,
  type Option,
  OptionListWireSchema,
  type OptionPayload,
  OptionWireSchema,
  type ScoringRule,
  ScoringRuleListWireSchema,
  type ScoringRulePayload,
  ScoringRuleWireSchema,
  type ScoringStrategy,
  ScoringStrategyListWireSchema,
  type Subtest,
  type SubtestCloneTemplate,
  SubtestCloneTemplateWireSchema,
  SubtestListWireSchema,
  type SubtestPayload,
  SubtestWireSchema,
  type TestInstrument,
  TestInstrumentListWireSchema,
  TestInstrumentWireSchema,
  type TestPayload,
  type TestVersion,
  TestVersionListWireSchema,
  type VersionConfigurationPayload,
  VersionConfigurationRequestSchema,
  type VersionPayload,
  TestVersionWireSchema,
  type UploadedImage,
  UploadedImageWireSchema,
} from "../schemas/instruments";

export interface UploadItemImageInput {
  file: Blob;
  order?: number;
  altText?: string;
  role?: string;
}

export interface UploadOptionImageInput {
  file: Blob;
  order?: number;
  altText?: string;
}

const EmptyResponseSchema = z.null().optional();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

export async function listTests(): Promise<TestInstrument[]> {
  const res = await staffClient.get<ApiEnvelope<unknown>>("/tests");
  return parseOrThrow(TestInstrumentListWireSchema, unwrap(res), "GET /tests");
}

export async function createTest(payload: TestPayload): Promise<TestInstrument> {
  const res = await staffClient.post<ApiEnvelope<unknown>>("/tests", payload);
  return parseOrThrow(TestInstrumentWireSchema, unwrap(res), "POST /tests");
}

// ---------------------------------------------------------------------------
// Versiones
// ---------------------------------------------------------------------------

export async function listVersions(testId: number): Promise<TestVersion[]> {
  const res = await staffClient.get<ApiEnvelope<unknown>>(`/tests/${testId}/versions`);
  return parseOrThrow(TestVersionListWireSchema, unwrap(res), "GET /tests/{id}/versions");
}

export async function createVersion(testId: number, payload: VersionPayload): Promise<TestVersion> {
  const res = await staffClient.post<ApiEnvelope<unknown>>(`/tests/${testId}/versions`, payload);
  return parseOrThrow(TestVersionWireSchema, unwrap(res), "POST /tests/{id}/versions");
}

export async function updateVersion(versionId: number, payload: VersionPayload): Promise<TestVersion> {
  const res = await staffClient.patch<ApiEnvelope<unknown>>(`/test-versions/${versionId}`, payload);
  return parseOrThrow(TestVersionWireSchema, unwrap(res), "PATCH /test-versions/{id}");
}

export async function approveVersion(versionId: number): Promise<TestVersion> {
  const res = await staffClient.post<ApiEnvelope<unknown>>(`/test-versions/${versionId}/approve`);
  return parseOrThrow(TestVersionWireSchema, unwrap(res), "POST /test-versions/{id}/approve");
}

export async function publishVersion(versionId: number): Promise<TestVersion> {
  const res = await staffClient.post<ApiEnvelope<unknown>>(`/test-versions/${versionId}/publish`);
  return parseOrThrow(TestVersionWireSchema, unwrap(res), "POST /test-versions/{id}/publish");
}

/**
 * Guarda la configuración completa (borrador) de subtests, ítems, opciones,
 * imágenes y claves de respuesta de una versión en estado BORRADOR.
 * Valida el payload antes de enviarlo con `VersionConfigurationRequestSchema`.
 * Devuelve los subtests persistidos (excluyendo los marcados como `DELETED`).
 */
export async function saveVersionConfiguration(
  versionId: number,
  payload: VersionConfigurationPayload,
): Promise<Subtest[]> {
  const validPayload = parseOrThrow(VersionConfigurationRequestSchema, payload, "request");
  const res = await staffClient.post<ApiEnvelope<unknown>>(
    `/test-versions/${versionId}/configuration`,
    validPayload,
  );
  return parseOrThrow(SubtestListWireSchema, unwrap(res), "POST /test-versions/{id}/configuration");
}

// ---------------------------------------------------------------------------
// Subtests
// ---------------------------------------------------------------------------

export async function listSubtests(versionId: number): Promise<Subtest[]> {
  const res = await staffClient.get<ApiEnvelope<unknown>>(`/test-versions/${versionId}/subtests`);
  return parseOrThrow(SubtestListWireSchema, unwrap(res), "GET /test-versions/{id}/subtests");
}

export async function createSubtest(versionId: number, payload: SubtestPayload): Promise<Subtest> {
  const res = await staffClient.post<ApiEnvelope<unknown>>(`/test-versions/${versionId}/subtests`, payload);
  return parseOrThrow(SubtestWireSchema, unwrap(res), "POST /test-versions/{id}/subtests");
}

export async function updateSubtest(subtestId: number, payload: SubtestPayload): Promise<Subtest> {
  const res = await staffClient.patch<ApiEnvelope<unknown>>(`/subtests/${subtestId}`, payload);
  return parseOrThrow(SubtestWireSchema, unwrap(res), "PATCH /subtests/{id}");
}

export async function getSubtestCloneTemplate(subtestId: number): Promise<SubtestCloneTemplate> {
  const res = await staffClient.get<ApiEnvelope<unknown>>(`/subtests/${subtestId}/clone-template`);
  return parseOrThrow(SubtestCloneTemplateWireSchema, unwrap(res), "GET /subtests/{id}/clone-template");
}

// ---------------------------------------------------------------------------
// Ítems
// ---------------------------------------------------------------------------

export async function listItems(subtestId: number): Promise<Item[]> {
  const res = await staffClient.get<ApiEnvelope<unknown>>(`/subtests/${subtestId}/items`);
  return parseOrThrow(ItemListWireSchema, unwrap(res), "GET /subtests/{id}/items");
}

export async function createItem(subtestId: number, payload: ItemPayload): Promise<Item> {
  const res = await staffClient.post<ApiEnvelope<unknown>>(`/subtests/${subtestId}/items`, payload);
  return parseOrThrow(ItemWireSchema, unwrap(res), "POST /subtests/{id}/items");
}

export async function updateItem(itemId: number, payload: ItemPayload): Promise<Item> {
  const res = await staffClient.patch<ApiEnvelope<unknown>>(`/items/${itemId}`, payload);
  return parseOrThrow(ItemWireSchema, unwrap(res), "PATCH /items/{id}");
}

// ---------------------------------------------------------------------------
// Opciones
// ---------------------------------------------------------------------------

export async function listOptions(itemId: number): Promise<Option[]> {
  const res = await staffClient.get<ApiEnvelope<unknown>>(`/items/${itemId}/options`);
  return parseOrThrow(OptionListWireSchema, unwrap(res), "GET /items/{id}/options");
}

export async function createOption(itemId: number, payload: OptionPayload): Promise<Option> {
  const res = await staffClient.post<ApiEnvelope<unknown>>(`/items/${itemId}/options`, payload);
  return parseOrThrow(OptionWireSchema, unwrap(res), "POST /items/{id}/options");
}

export async function updateOption(optionId: number, payload: OptionPayload): Promise<Option> {
  const res = await staffClient.patch<ApiEnvelope<unknown>>(`/options/${optionId}`, payload);
  return parseOrThrow(OptionWireSchema, unwrap(res), "PATCH /options/{id}");
}

// ---------------------------------------------------------------------------
// Imágenes
// ---------------------------------------------------------------------------

export async function listItemImages(itemId: number): Promise<ItemImage[]> {
  const res = await staffClient.get<ApiEnvelope<unknown>>(`/items/${itemId}/images`);
  return parseOrThrow(ItemImageListWireSchema, unwrap(res), "GET /items/{id}/images");
}

export async function uploadItemImage(itemId: number, input: UploadItemImageInput): Promise<UploadedImage> {
  const form = new FormData();
  form.append("file", input.file);
  if (input.order !== undefined) form.append("order", String(input.order));
  if (input.altText !== undefined) form.append("altText", input.altText);
  if (input.role !== undefined) form.append("role", input.role);

  const res = await staffClient.post<ApiEnvelope<unknown>>(`/items/${itemId}/images`, form);
  return parseOrThrow(UploadedImageWireSchema, unwrap(res), "POST /items/{id}/images");
}

export async function uploadOptionImage(optionId: number, input: UploadOptionImageInput): Promise<UploadedImage> {
  const form = new FormData();
  form.append("file", input.file);
  if (input.order !== undefined) form.append("order", String(input.order));
  if (input.altText !== undefined) form.append("altText", input.altText);

  const res = await staffClient.post<ApiEnvelope<unknown>>(`/options/${optionId}/images`, form);
  return parseOrThrow(UploadedImageWireSchema, unwrap(res), "POST /options/{id}/images");
}

export async function deleteItemImage(imageId: number): Promise<void> {
  const res = await staffClient.delete<ApiEnvelope<unknown>>(`/items/images/${imageId}`);
  parseOrThrow(EmptyResponseSchema, unwrap(res), "DELETE /items/images/{imageId}");
}

// ---------------------------------------------------------------------------
// Scoring y claves de respuesta
// ---------------------------------------------------------------------------

export async function listScoringStrategies(): Promise<ScoringStrategy[]> {
  const res = await staffClient.get<ApiEnvelope<unknown>>("/scoring/strategies");
  return parseOrThrow(ScoringStrategyListWireSchema, unwrap(res), "GET /scoring/strategies");
}

export async function listScoringRules(subtestId: number): Promise<ScoringRule[]> {
  const res = await staffClient.get<ApiEnvelope<unknown>>(`/subtests/${subtestId}/scoring-rules`);
  return parseOrThrow(ScoringRuleListWireSchema, unwrap(res), "GET /subtests/{id}/scoring-rules");
}

export async function createScoringRule(subtestId: number, payload: ScoringRulePayload): Promise<ScoringRule> {
  const res = await staffClient.post<ApiEnvelope<unknown>>(`/subtests/${subtestId}/scoring-rules`, payload);
  return parseOrThrow(ScoringRuleWireSchema, unwrap(res), "POST /subtests/{id}/scoring-rules");
}

export async function updateScoringRule(ruleId: number, payload: ScoringRulePayload): Promise<ScoringRule> {
  const res = await staffClient.patch<ApiEnvelope<unknown>>(`/scoring-rules/${ruleId}`, payload);
  return parseOrThrow(ScoringRuleWireSchema, unwrap(res), "PATCH /scoring-rules/{id}");
}

export async function getAnswerKey(itemId: number): Promise<AnswerKey | null> {
  const res = await staffClient.get<ApiEnvelope<unknown>>(`/items/${itemId}/answer-key`);
  return parseOrThrow(NullableAnswerKeyWireSchema, unwrap(res), "GET /items/{id}/answer-key");
}

export async function createAnswerKey(itemId: number, payload: AnswerKeyPayload): Promise<AnswerKey> {
  const res = await staffClient.post<ApiEnvelope<unknown>>(`/items/${itemId}/answer-key`, payload);
  return parseOrThrow(AnswerKeyWireSchema, unwrap(res), "POST /items/{id}/answer-key");
}

export async function updateAnswerKey(keyId: number, payload: AnswerKeyPayload): Promise<AnswerKey> {
  const res = await staffClient.patch<ApiEnvelope<unknown>>(`/answer-keys/${keyId}`, payload);
  return parseOrThrow(AnswerKeyWireSchema, unwrap(res), "PATCH /answer-keys/{id}");
}

// ---------------------------------------------------------------------------
// Baremos y rangos
// ---------------------------------------------------------------------------

export async function listBaremos(versionId: number): Promise<Baremo[]> {
  const res = await staffClient.get<ApiEnvelope<unknown>>(`/test-versions/${versionId}/baremos`);
  return parseOrThrow(BaremoListWireSchema, unwrap(res), "GET /test-versions/{id}/baremos");
}

export async function createBaremo(payload: BaremoPayload): Promise<Baremo> {
  const res = await staffClient.post<ApiEnvelope<unknown>>("/baremos", payload);
  return parseOrThrow(BaremoWireSchema, unwrap(res), "POST /baremos");
}

export async function updateBaremo(baremoId: number, payload: BaremoPayload): Promise<Baremo> {
  const res = await staffClient.patch<ApiEnvelope<unknown>>(`/baremos/${baremoId}`, payload);
  return parseOrThrow(BaremoWireSchema, unwrap(res), "PATCH /baremos/{id}");
}

export async function listBaremoRanges(baremoId: number): Promise<BaremoRange[]> {
  const res = await staffClient.get<ApiEnvelope<unknown>>(`/baremos/${baremoId}/ranges`);
  return parseOrThrow(BaremoRangeListWireSchema, unwrap(res), "GET /baremos/{id}/ranges");
}

export async function createBaremoRange(baremoId: number, payload: BaremoRangePayload): Promise<BaremoRange> {
  const res = await staffClient.post<ApiEnvelope<unknown>>(`/baremos/${baremoId}/ranges`, payload);
  return parseOrThrow(BaremoRangeWireSchema, unwrap(res), "POST /baremos/{id}/ranges");
}

export async function updateBaremoRange(rangeId: number, payload: BaremoRangePayload): Promise<BaremoRange> {
  const res = await staffClient.patch<ApiEnvelope<unknown>>(`/baremo-ranges/${rangeId}`, payload);
  return parseOrThrow(BaremoRangeWireSchema, unwrap(res), "PATCH /baremo-ranges/{id}");
}
