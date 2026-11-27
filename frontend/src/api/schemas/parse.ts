import type { z } from "zod";
import { ApiError } from "../errors";

/**
 * Valida `data` contra `schema`. Si el backend envía una forma inesperada lanza
 * `ApiError` con code `CONTRACT_MISMATCH` en vez de propagar datos corruptos a la UI.
 */
export function parseOrThrow<S extends z.ZodTypeAny>(schema: S, data: unknown, ctx: string): z.output<S> {
  const result = schema.safeParse(data);
  if (result.success) return result.data;

  if (import.meta.env.DEV) {
    console.error(`[contract] ${ctx}`, result.error.issues);
  }
  throw new ApiError({
    status: 0,
    code: "CONTRACT_MISMATCH",
    message: `Respuesta inesperada del servidor (${ctx}).`,
    details: result.error.issues.map((issue) => `${issue.path.join(".") || "(raíz)"}: ${issue.message}`),
  });
}
