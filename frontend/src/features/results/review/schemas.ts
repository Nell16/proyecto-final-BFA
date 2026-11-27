import { z } from "zod";
import type { SubmitReviewInput } from "../../../api/endpoints/results";

const parseScore = (raw: string): number => Number(raw.trim().replace(",", "."));
const isValidScore = (raw: string): boolean => {
  const value = parseScore(raw);
  return raw.trim() !== "" && Number.isFinite(value) && value >= 0;
};

/**
 * Formulario de revisión manual (`PUT /manual-review/{id}` → `{ score, comment, approved }`).
 * Reglas de UI (el backend no las impone): aprobar exige puntaje ≥ 0; observar exige un comentario.
 * `score` es texto para distinguir «vacío» de «0».
 */
export const ResolveReviewFormSchema = z
  .object({
    decision: z.enum(["approve", "observe"]),
    score: z.string(),
    comment: z.string(),
  })
  .superRefine((values, ctx) => {
    const score = values.score.trim();
    if (values.decision === "approve") {
      if (score === "") ctx.addIssue({ code: "custom", path: ["score"], message: "Indica el puntaje asignado." });
      else if (!isValidScore(score)) ctx.addIssue({ code: "custom", path: ["score"], message: "El puntaje debe ser un número mayor o igual a 0." });
    } else {
      if (score !== "" && !isValidScore(score)) {
        ctx.addIssue({ code: "custom", path: ["score"], message: "El puntaje debe ser un número mayor o igual a 0." });
      }
      if (values.comment.trim() === "") {
        ctx.addIssue({ code: "custom", path: ["comment"], message: "Explica por qué se observa la respuesta." });
      }
    }
  });

export type ResolveReviewFormValues = z.input<typeof ResolveReviewFormSchema>;

export const EMPTY_REVIEW_FORM: ResolveReviewFormValues = { decision: "approve", score: "", comment: "" };

/** Valores ya validados → cuerpo del PUT. */
export function toSubmitReviewInput(values: ResolveReviewFormValues): SubmitReviewInput {
  const score = values.score.trim();
  const comment = values.comment.trim();
  return {
    approved: values.decision === "approve",
    score: score === "" ? null : parseScore(score),
    comment: comment === "" ? null : comment,
  };
}
