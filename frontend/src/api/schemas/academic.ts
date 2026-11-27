import { z } from "zod";

// ---------------------------------------------------------------------------
// Estado general
// ---------------------------------------------------------------------------

export const GeneralStatusSchema = z.enum(["ACTIVO", "INACTIVO", "DESCONOCIDO"]).catch("DESCONOCIDO");
export type GeneralStatus = z.output<typeof GeneralStatusSchema>;

// ---------------------------------------------------------------------------
// Helpers de fecha y edad
// ---------------------------------------------------------------------------

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseIsoDateParts(value: string): { year: number; month: number; day: number; date: Date } | null {
  const match = ISO_DATE_RE.exec(value.trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);

  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }

  return { year, month, day, date };
}

/**
 * Calcula la edad en años cumplidos a partir de una fecha ISO (`YYYY-MM-DD`).
 * Acepta `now` inyectable para pruebas deterministas.
 */
export function calculateAge(birthDate: string | null | undefined, now: Date = new Date()): number | undefined {
  if (!birthDate) return undefined;
  const parts = parseIsoDateParts(birthDate);
  if (!parts) return undefined;

  const refYear = now.getFullYear();
  const refMonth = now.getMonth() + 1;
  const refDay = now.getDate();

  let age = refYear - parts.year;
  if (refMonth < parts.month || (refMonth === parts.month && refDay < parts.day)) {
    age -= 1;
  }
  return age >= 0 ? age : undefined;
}

// ---------------------------------------------------------------------------
// Catálogos (Wire -> Dominio)
// ---------------------------------------------------------------------------

export const CATALOG_TYPES = ["sexos", "carreras", "cohortes", "grupos-academicos"] as const;
export type CatalogType = (typeof CATALOG_TYPES)[number];

export const SexWireSchema = z
  .object({
    id: z.number().int(),
    codigo: z.string(),
    nombre: z.string(),
    estado: GeneralStatusSchema,
  })
  .loose();

export const SexSchema = SexWireSchema.transform((raw) => ({
  id: raw.id,
  code: raw.codigo,
  name: raw.nombre,
  status: raw.estado,
}));
export type Sex = z.output<typeof SexSchema>;
export const SexListSchema = z.array(SexSchema);

export const CareerWireSchema = z
  .object({
    id: z.number().int(),
    codigoCarrera: z.string(),
    nombreCarrera: z.string(),
    estado: GeneralStatusSchema,
  })
  .loose();

export const CareerSchema = CareerWireSchema.transform((raw) => ({
  id: raw.id,
  code: raw.codigoCarrera,
  name: raw.nombreCarrera,
  status: raw.estado,
}));
export type Career = z.output<typeof CareerSchema>;
export const CareerListSchema = z.array(CareerSchema);

export const CohortWireSchema = z
  .object({
    id: z.number().int(),
    codigoCohorte: z.string(),
    nombreCohorte: z.string(),
    anio: z.number().int().nullable().optional(),
    periodo: z.string().nullable().optional(),
    estado: GeneralStatusSchema,
  })
  .loose();

export const CohortSchema = CohortWireSchema.transform((raw) => ({
  id: raw.id,
  code: raw.codigoCohorte,
  name: raw.nombreCohorte,
  year: raw.anio ?? undefined,
  period: raw.periodo ?? undefined,
  status: raw.estado,
}));
export type Cohort = z.output<typeof CohortSchema>;
export const CohortListSchema = z.array(CohortSchema);

export const AcademicGroupWireSchema = z
  .object({
    id: z.number().int(),
    carreraId: z.number().int().nullable().optional(),
    carrera: CareerWireSchema.nullable().optional(),
    codigoGrupo: z.string(),
    nombreGrupo: z.string().nullable().optional(),
    estado: GeneralStatusSchema,
  })
  .loose();

export const AcademicGroupSchema = AcademicGroupWireSchema.transform((raw) => ({
  id: raw.id,
  code: raw.codigoGrupo,
  name: raw.nombreGrupo ?? raw.codigoGrupo,
  careerId: raw.carreraId ?? raw.carrera?.id ?? undefined,
  status: raw.estado,
}));
export type AcademicGroup = z.output<typeof AcademicGroupSchema>;
export const AcademicGroupListSchema = z.array(AcademicGroupSchema);

export type CatalogItem = Sex | Career | Cohort | AcademicGroup;

// ---------------------------------------------------------------------------
// Participante (Wire -> Dominio)
// ---------------------------------------------------------------------------

export const ParticipantWireSchema = z
  .object({
    id: z.uuid(),
    codigoParticipante: z.string(),
    nombres: z.string(),
    apellidos: z.string(),
    fechaNacimiento: z.string().nullable().optional(),
    sexo: SexWireSchema.nullable().optional(),
    carrera: CareerWireSchema.nullable().optional(),
    cohorte: CohortWireSchema.nullable().optional(),
    grupoAcademico: AcademicGroupWireSchema.nullable().optional(),
    sexoId: z.number().int().nullable().optional(),
    carreraId: z.number().int().nullable().optional(),
    cohorteId: z.number().int().nullable().optional(),
    grupoAcademicoId: z.number().int().nullable().optional(),
    estado: GeneralStatusSchema,
    creadoEn: z.string().nullable().optional(),
    actualizadoEn: z.string().nullable().optional(),
  })
  .loose();

export type ParticipantWire = z.output<typeof ParticipantWireSchema>;

export interface ParticipantSexRef {
  id: number;
  code: string;
  name: string;
}

export interface ParticipantCareerRef {
  id: number;
  code: string;
  name: string;
}

export interface ParticipantCohortRef {
  id: number;
  code: string;
  name: string;
  year?: number;
  period?: string;
}

export interface ParticipantGroupRef {
  id: number;
  code: string;
  name: string;
  careerId?: number;
}

export interface Participant {
  id: string;
  code: string;
  firstNames: string;
  lastNames: string;
  fullName: string;
  birthDate?: string;
  age?: number;
  sex?: ParticipantSexRef;
  career?: ParticipantCareerRef;
  cohort?: ParticipantCohortRef;
  group?: ParticipantGroupRef;
  /** Ids de catálogo: vienen planos en `GET /participantes` y anidados en `POST`/detalle. */
  sexId?: number;
  careerId?: number;
  cohortId?: number;
  groupId?: number;
  status: GeneralStatus;
  createdAt?: string;
}

/**
 * Transforma un payload wire de participante al modelo de dominio.
 * Acepta `now` opcional para pruebas deterministas de `age`.
 */
export function toParticipant(raw: ParticipantWire, now: Date = new Date()): Participant {
  return {
    id: raw.id,
    code: raw.codigoParticipante,
    firstNames: raw.nombres,
    lastNames: raw.apellidos,
    fullName: [raw.nombres.trim(), raw.apellidos.trim()].filter(Boolean).join(" "),
    birthDate: raw.fechaNacimiento ?? undefined,
    age: calculateAge(raw.fechaNacimiento, now),
    sex: raw.sexo
      ? {
          id: raw.sexo.id,
          code: raw.sexo.codigo,
          name: raw.sexo.nombre,
        }
      : undefined,
    career: raw.carrera
      ? {
          id: raw.carrera.id,
          code: raw.carrera.codigoCarrera,
          name: raw.carrera.nombreCarrera,
        }
      : undefined,
    cohort: raw.cohorte
      ? {
          id: raw.cohorte.id,
          code: raw.cohorte.codigoCohorte,
          name: raw.cohorte.nombreCohorte,
          year: raw.cohorte.anio ?? undefined,
          period: raw.cohorte.periodo ?? undefined,
        }
      : undefined,
    group: raw.grupoAcademico
      ? {
          id: raw.grupoAcademico.id,
          code: raw.grupoAcademico.codigoGrupo,
          name: raw.grupoAcademico.nombreGrupo ?? raw.grupoAcademico.codigoGrupo,
          careerId: raw.grupoAcademico.carreraId ?? raw.grupoAcademico.carrera?.id ?? undefined,
        }
      : undefined,
    sexId: raw.sexo?.id ?? raw.sexoId ?? undefined,
    careerId: raw.carrera?.id ?? raw.carreraId ?? undefined,
    cohortId: raw.cohorte?.id ?? raw.cohorteId ?? undefined,
    groupId: raw.grupoAcademico?.id ?? raw.grupoAcademicoId ?? undefined,
    status: raw.estado,
    createdAt: raw.creadoEn ?? undefined,
  };
}

export const ParticipantSchema = ParticipantWireSchema.transform((raw) => toParticipant(raw));

export const ParticipantPageSchema = z
  .object({
    content: z.array(ParticipantSchema),
    number: z.number().int(),
    size: z.number().int(),
    numberOfElements: z.number().int(),
    totalElements: z.number().int(),
    totalPages: z.number().int(),
    first: z.boolean(),
    last: z.boolean(),
  })
  .loose()
  .transform((raw) => ({
    content: raw.content,
    page: raw.number,
    size: raw.size,
    numberOfElements: raw.numberOfElements,
    totalElements: raw.totalElements,
    totalPages: raw.totalPages,
    first: raw.first,
    last: raw.last,
  }));

export type ParticipantPage = z.output<typeof ParticipantPageSchema>;

// ---------------------------------------------------------------------------
// Inputs de formulario (RHF) y mapeo a request del backend
// ---------------------------------------------------------------------------

function isIsoDateNotFuture(value: string): boolean {
  const parts = parseIsoDateParts(value);
  if (!parts) return false;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return parts.date.getTime() <= today.getTime();
}

export const ParticipantInputSchema = z.object({
  code: z.string().trim().min(1, "El código es requerido.").max(80, "Máximo 80 caracteres."),
  firstNames: z.string().trim().min(1, "Los nombres son requeridos.").max(100, "Máximo 100 caracteres."),
  lastNames: z.string().trim().min(1, "Los apellidos son requeridos.").max(100, "Máximo 100 caracteres."),
  birthDate: z
    .string()
    .trim()
    .refine(
      (value) => value === "" || isIsoDateNotFuture(value),
      "La fecha de nacimiento debe tener formato YYYY-MM-DD y no puede ser futura.",
    )
    .optional(),
  sexId: z.number().int().positive().optional(),
  careerId: z.number().int().positive().optional(),
  cohortId: z.number().int().positive().optional(),
  groupId: z.number().int().positive().optional(),
});

export type ParticipantInput = z.output<typeof ParticipantInputSchema>;

export interface ParticipantRequestWire {
  code: string;
  firstNames: string;
  lastNames: string;
  fechaNacimiento?: string;
  sexoId?: number;
  carreraId?: number;
  cohorteId?: number;
  grupoAcademicoId?: number;
}

export function toParticipantRequest(input: ParticipantInput): ParticipantRequestWire {
  const birthDate = input.birthDate?.trim();
  return {
    code: input.code.trim(),
    firstNames: input.firstNames.trim(),
    lastNames: input.lastNames.trim(),
    ...(birthDate ? { fechaNacimiento: birthDate } : {}),
    ...(input.sexId !== undefined ? { sexoId: input.sexId } : {}),
    ...(input.careerId !== undefined ? { carreraId: input.careerId } : {}),
    ...(input.cohortId !== undefined ? { cohorteId: input.cohortId } : {}),
    ...(input.groupId !== undefined ? { grupoAcademicoId: input.groupId } : {}),
  };
}

export const SexInputSchema = z.object({
  code: z.string().trim().min(1, "El código es requerido.").max(20, "Máximo 20 caracteres."),
  name: z.string().trim().min(1, "El nombre es requerido.").max(80, "Máximo 80 caracteres."),
});
export type SexInput = z.output<typeof SexInputSchema>;

export const CareerInputSchema = z.object({
  code: z.string().trim().min(1, "El código es requerido.").max(30, "Máximo 30 caracteres."),
  name: z.string().trim().min(1, "El nombre es requerido.").max(150, "Máximo 150 caracteres."),
});
export type CareerInput = z.output<typeof CareerInputSchema>;

export const CohortInputSchema = z.object({
  code: z.string().trim().min(1, "El código es requerido.").max(30, "Máximo 30 caracteres."),
  name: z.string().trim().min(1, "El nombre es requerido.").max(100, "Máximo 100 caracteres."),
  year: z.number().int().min(1900).max(2100).optional(),
  period: z.string().trim().max(30, "Máximo 30 caracteres.").optional(),
});
export type CohortInput = z.output<typeof CohortInputSchema>;

export const AcademicGroupInputSchema = z.object({
  code: z.string().trim().min(1, "El código es requerido.").max(50, "Máximo 50 caracteres."),
  name: z.string().trim().max(100, "Máximo 100 caracteres.").optional(),
  careerId: z.number().int().positive().optional(),
});
export type AcademicGroupInput = z.output<typeof AcademicGroupInputSchema>;
