import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createAcademicGroup,
  createCareer,
  createCohort,
  createSex,
  deleteCatalogItem,
} from "../../api/endpoints/academic";
import {
  AcademicGroupInputSchema,
  CareerInputSchema,
  CohortInputSchema,
  SexInputSchema,
  type CatalogType,
} from "../../api/schemas/academic";
import { createAccountScopedMutation, isScopeCurrent } from "../accountScopedMutation";
import { catalogKeys } from "./queries";

const scoped = createAccountScopedMutation();

/**
 * Crea un elemento del catálogo. `values` se re-valida con el schema del tipo (los formularios ya
 * lo hicieron con RHF; esto protege a cualquier otro llamador y evita casts).
 */
export function createCatalogItem(type: CatalogType, values: unknown): Promise<unknown> {
  switch (type) {
    case "sexos":
      return createSex(SexInputSchema.parse(values));
    case "carreras":
      return createCareer(CareerInputSchema.parse(values));
    case "cohortes":
      return createCohort(CohortInputSchema.parse(values));
    case "grupos-academicos":
      return createAcademicGroup(AcademicGroupInputSchema.parse(values));
  }
}

export function useCreateCatalogItem(type: CatalogType) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: [...catalogKeys.type(type), "create"],
    onMutate: scoped.onMutate,
    mutationFn: (values: unknown, ctx) => {
      scoped.guard(ctx);
      return createCatalogItem(type, values);
    },
    onSuccess: (_data, _vars, context) =>
      isScopeCurrent(context) ? qc.invalidateQueries({ queryKey: catalogKeys.list(type) }) : undefined,
  });
}

export function useDeleteCatalogItem(type: CatalogType) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: [...catalogKeys.type(type), "delete"],
    onMutate: scoped.onMutate,
    mutationFn: (id: number, ctx) => {
      scoped.guard(ctx);
      return deleteCatalogItem(type, id);
    },
    onSuccess: (_data, _id, context) =>
      isScopeCurrent(context) ? qc.invalidateQueries({ queryKey: catalogKeys.list(type) }) : undefined,
  });
}
