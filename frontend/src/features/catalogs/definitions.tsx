import { BookOpen, Calendar, Layers, Users, type LucideIcon } from "lucide-react";
import { z } from "zod";
import {
  AcademicGroupInputSchema,
  CareerInputSchema,
  CohortInputSchema,
  SexInputSchema,
  type CatalogType,
  type Career,
} from "../../api/schemas/academic";
import type { DataTableColumn } from "../../app/components/ui/data-table";
import type { CatalogItemByType } from "./queries";

/** Valores del formulario de cualquier catálogo (cada tipo usa un subconjunto). */
export interface CatalogFormValues {
  code: string;
  name?: string;
  year?: number;
  period?: string;
  careerId?: number;
}

export interface CatalogFieldDef {
  name: "code" | "name" | "year" | "period" | "careerId";
  label: string;
  kind: "text" | "number" | "career";
  placeholder?: string;
  required?: boolean;
  help?: string;
}

export interface CatalogColumnContext {
  careersById: ReadonlyMap<number, Career>;
  careersUnavailable: boolean;
}

export interface CatalogDefinition<T extends CatalogType> {
  type: T;
  title: string;
  description: string;
  /** Singular en minúscula para mensajes ("carrera"). */
  singular: string;
  newLabel: string;
  icon: LucideIcon;
  schema: z.ZodType<CatalogFormValues, CatalogFormValues>;
  fields: CatalogFieldDef[];
  defaultValues: CatalogFormValues;
  /** El formulario y la tabla necesitan el catálogo de carreras (grupos académicos). */
  needsCareers?: boolean;
  /** Columnas adicionales entre «Nombre» y «Estado». */
  columns: (ctx: CatalogColumnContext) => DataTableColumn<CatalogItemByType[T]>[];
}

export const CAREER_CATALOG: CatalogDefinition<"carreras"> = {
  type: "carreras",
  title: "Carreras",
  description: "Catálogo de carreras y programas académicos registrados.",
  singular: "carrera",
  newLabel: "Nueva carrera",
  icon: BookOpen,
  schema: CareerInputSchema,
  defaultValues: { code: "", name: "" },
  fields: [
    { name: "code", label: "Código", kind: "text", placeholder: "Ej.: PSI", required: true },
    { name: "name", label: "Nombre", kind: "text", placeholder: "Ej.: Psicología", required: true },
  ],
  columns: () => [],
};

export const SEX_CATALOG: CatalogDefinition<"sexos"> = {
  type: "sexos",
  title: "Sexos",
  description: "Catálogo de sexos utilizado en el registro de participantes.",
  singular: "sexo",
  newLabel: "Nuevo sexo",
  icon: Users,
  schema: SexInputSchema,
  defaultValues: { code: "", name: "" },
  fields: [
    { name: "code", label: "Código", kind: "text", placeholder: "Ej.: F", required: true },
    { name: "name", label: "Nombre", kind: "text", placeholder: "Ej.: Femenino", required: true },
  ],
  columns: () => [],
};

export const COHORT_CATALOG: CatalogDefinition<"cohortes"> = {
  type: "cohortes",
  title: "Cohortes",
  description: "Catálogo de cohortes de ingreso.",
  singular: "cohorte",
  newLabel: "Nueva cohorte",
  icon: Calendar,
  schema: CohortInputSchema,
  defaultValues: { code: "", name: "", period: "" },
  fields: [
    { name: "code", label: "Código", kind: "text", placeholder: "Ej.: 2026-1", required: true },
    { name: "name", label: "Nombre", kind: "text", placeholder: "Ej.: Cohorte 2026-I", required: true },
    { name: "year", label: "Año", kind: "number", placeholder: "Ej.: 2026" },
    { name: "period", label: "Período", kind: "text", placeholder: "Ej.: I" },
  ],
  columns: () => [
    {
      id: "year",
      header: "Año",
      className: "text-right tabular-nums",
      headerClassName: "text-right",
      cell: (row) => row.year ?? "—",
    },
    { id: "period", header: "Período", cell: (row) => row.period ?? "—" },
  ],
};

/** Los grupos académicos EXIGEN carrera (a diferencia del schema base, donde es opcional). */
const GroupFormSchema = AcademicGroupInputSchema.extend({
  careerId: z
    .number({ error: "Seleccione una carrera." })
    .int("Seleccione una carrera.")
    .positive("Seleccione una carrera."),
});

export const GROUP_CATALOG: CatalogDefinition<"grupos-academicos"> = {
  type: "grupos-academicos",
  title: "Grupos académicos",
  description: "Catálogo de grupos académicos, cada uno asociado a una carrera.",
  singular: "grupo académico",
  newLabel: "Nuevo grupo",
  icon: Layers,
  schema: GroupFormSchema,
  needsCareers: true,
  defaultValues: { code: "", name: "" },
  fields: [
    { name: "code", label: "Código", kind: "text", placeholder: "Ej.: PSI-A", required: true },
    { name: "name", label: "Nombre", kind: "text", placeholder: "Ej.: Grupo A" },
    { name: "careerId", label: "Carrera", kind: "career", required: true },
  ],
  columns: ({ careersById, careersUnavailable }) => [
    {
      id: "career",
      header: "Carrera",
      cell: (row) => {
        if (row.careerId === undefined) return "—";
        const career = careersById.get(row.careerId);
        if (career) return career.name;
        return careersUnavailable ? `Carrera #${row.careerId}` : "—";
      },
    },
  ],
};
