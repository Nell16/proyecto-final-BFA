import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createAggregateReport,
  createIndividualReport,
  type CreateReportInput,
} from "../../api/endpoints/reports";
import { createAccountScopedMutation, isScopeCurrent } from "../accountScopedMutation";
import { reportKeys } from "./queries";

const scoped = createAccountScopedMutation();

export function useCreateIndividualReport() {
  const qc = useQueryClient();
  return useMutation({
    onMutate: scoped.onMutate,
    mutationFn: (input: CreateReportInput, ctx) => {
      scoped.guard(ctx);
      return createIndividualReport(input);
    },
    onSuccess: (_report, _vars, context) => {
      if (isScopeCurrent(context)) {
        void qc.invalidateQueries({ queryKey: reportKeys.all });
      }
    },
  });
}

export function useCreateAggregateReport() {
  const qc = useQueryClient();
  return useMutation({
    onMutate: scoped.onMutate,
    mutationFn: (input: CreateReportInput, ctx) => {
      scoped.guard(ctx);
      return createAggregateReport(input);
    },
    onSuccess: (_report, _vars, context) => {
      if (isScopeCurrent(context)) {
        void qc.invalidateQueries({ queryKey: reportKeys.all });
      }
    },
  });
}
