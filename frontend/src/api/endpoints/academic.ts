import { staffClient } from "../client";
import { unwrap, type ApiEnvelope } from "../errors";
import {
  AcademicGroupListSchema,
  AcademicGroupSchema,
  CareerListSchema,
  CareerSchema,
  CohortListSchema,
  CohortSchema,
  ParticipantPageSchema,
  ParticipantSchema,
  SexListSchema,
  SexSchema,
  toParticipantRequest,
  type AcademicGroup,
  type AcademicGroupInput,
  type Career,
  type CareerInput,
  type CatalogItem,
  type CatalogType,
  type Cohort,
  type CohortInput,
  type Participant,
  type ParticipantInput,
  type ParticipantPage,
  type Sex,
  type SexInput,
} from "../schemas/academic";
import { parseOrThrow } from "../schemas/parse";

export interface ListParticipantsParams {
  page?: number;
  size?: number;
}

export async function listParticipants(params: ListParticipantsParams = {}): Promise<ParticipantPage> {
  const res = await staffClient.get<ApiEnvelope<unknown>>("/participantes", { params });
  return parseOrThrow(ParticipantPageSchema, unwrap(res), "GET /participantes");
}

export async function getParticipant(id: string): Promise<Participant> {
  const res = await staffClient.get<ApiEnvelope<unknown>>(`/participantes/${id}`);
  return parseOrThrow(ParticipantSchema, unwrap(res), `GET /participantes/${id}`);
}

export async function createParticipant(input: ParticipantInput): Promise<Participant> {
  const payload = toParticipantRequest(input);
  const res = await staffClient.post<ApiEnvelope<unknown>>("/participantes", payload);
  return parseOrThrow(ParticipantSchema, unwrap(res), "POST /participantes");
}

export async function deleteParticipant(id: string): Promise<void> {
  const res = await staffClient.delete<ApiEnvelope<null>>(`/participantes/${id}`);
  unwrap(res);
}

export async function listCatalog(type: "sexos", q?: string): Promise<Sex[]>;
export async function listCatalog(type: "carreras", q?: string): Promise<Career[]>;
export async function listCatalog(type: "cohortes", q?: string): Promise<Cohort[]>;
export async function listCatalog(type: "grupos-academicos", q?: string): Promise<AcademicGroup[]>;
export async function listCatalog(type: CatalogType, q?: string): Promise<CatalogItem[]>;
export async function listCatalog(type: CatalogType, q?: string): Promise<CatalogItem[]> {
  const params = q !== undefined && q !== "" ? { q } : undefined;
  const res = await staffClient.get<ApiEnvelope<unknown>>(`/catalogos/${type}`, { params });
  const data = unwrap(res);

  switch (type) {
    case "sexos":
      return parseOrThrow(SexListSchema, data, "GET /catalogos/sexos");
    case "carreras":
      return parseOrThrow(CareerListSchema, data, "GET /catalogos/carreras");
    case "cohortes":
      return parseOrThrow(CohortListSchema, data, "GET /catalogos/cohortes");
    case "grupos-academicos":
      return parseOrThrow(AcademicGroupListSchema, data, "GET /catalogos/grupos-academicos");
  }
}

export async function createSex(input: SexInput): Promise<Sex> {
  const res = await staffClient.post<ApiEnvelope<unknown>>("/catalogos/sexos", {
    codigo: input.code.trim(),
    nombre: input.name.trim(),
  });
  return parseOrThrow(SexSchema, unwrap(res), "POST /catalogos/sexos");
}

export async function createCareer(input: CareerInput): Promise<Career> {
  const res = await staffClient.post<ApiEnvelope<unknown>>("/catalogos/carreras", {
    codigoCarrera: input.code.trim(),
    nombreCarrera: input.name.trim(),
  });
  return parseOrThrow(CareerSchema, unwrap(res), "POST /catalogos/carreras");
}

export async function createCohort(input: CohortInput): Promise<Cohort> {
  const period = input.period?.trim();
  const res = await staffClient.post<ApiEnvelope<unknown>>("/catalogos/cohortes", {
    codigoCohorte: input.code.trim(),
    nombreCohorte: input.name.trim(),
    ...(input.year !== undefined ? { anio: input.year } : {}),
    ...(period ? { periodo: period } : {}),
  });
  return parseOrThrow(CohortSchema, unwrap(res), "POST /catalogos/cohortes");
}

export async function createAcademicGroup(input: AcademicGroupInput): Promise<AcademicGroup> {
  const name = input.name?.trim();
  const res = await staffClient.post<ApiEnvelope<unknown>>("/catalogos/grupos-academicos", {
    codigoGrupo: input.code.trim(),
    ...(name ? { nombreGrupo: name } : {}),
    ...(input.careerId !== undefined ? { carrera: { id: input.careerId } } : {}),
  });
  return parseOrThrow(AcademicGroupSchema, unwrap(res), "POST /catalogos/grupos-academicos");
}

export async function deleteCatalogItem(type: CatalogType, id: number): Promise<void> {
  const res = await staffClient.delete<ApiEnvelope<null>>(`/catalogos/${type}/${id}`);
  unwrap(res);
}
