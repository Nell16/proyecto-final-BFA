import { useMutation, useQueryClient } from "@tanstack/react-query";
import { scoreAttempt, submitReview, type SubmitReviewInput } from "../../api/endpoints/results";
import { createAccountScopedMutation, isScopeCurrent } from "../accountScopedMutation";
import { resultKeys } from "./queries";

const scoped = createAccountScopedMutation();

/**
 * `POST /attempts/{id}/score` (CALIFICACION_EJECUTAR). Es idempotente en el backend: si el intento ya
 * tiene resultado, devuelve el existente. Si la cuenta cambia durante la petición no se publica nada.
 */
export function useScoreAttempt() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: [...resultKeys.all, "score"],
    onMutate: scoped.onMutate,
    mutationFn: (attemptId: number, ctx) => {
      scoped.guard(ctx);
      return scoreAttempt(attemptId);
    },
    onSuccess: (_result, attemptId, context) => {
      if (!isScopeCurrent(context)) return;
      void qc.invalidateQueries({ queryKey: resultKeys.attemptResult(attemptId) });
      void qc.invalidateQueries({ queryKey: resultKeys.detailedResult(attemptId) });
      void qc.invalidateQueries({ queryKey: [...resultKeys.all, "attempts"] });
      void qc.invalidateQueries({ queryKey: resultKeys.pendingReviews() });
      void qc.invalidateQueries({ queryKey: [...resultKeys.all, "dashboard"] });
    },
  });
}

export interface ResolveReviewVariables {
  reviewId: number;
  input: SubmitReviewInput;
}

/** `PUT /manual-review/{reviewId}` (CALIFICACION_EJECUTAR). */
export function useResolveReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: [...resultKeys.all, "resolve-review"],
    onMutate: scoped.onMutate,
    mutationFn: ({ reviewId, input }: ResolveReviewVariables, ctx) => {
      scoped.guard(ctx);
      return submitReview(reviewId, input);
    },
    onSuccess: (review, _vars, context) => {
      if (!isScopeCurrent(context)) return;
      void qc.invalidateQueries({ queryKey: resultKeys.pendingReviews() });
      void qc.invalidateQueries({ queryKey: resultKeys.detailedResult(review.attemptId) });
      void qc.invalidateQueries({ queryKey: [...resultKeys.all, "attempts"] });
    },
  });
}
