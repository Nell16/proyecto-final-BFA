import { z } from "zod";

/**
 * Search de `/app/calificaciones`. «Calificar» en el monitor de sesiones envía `{ sessionId, attemptId }`;
 * cada valor se valida por separado y uno inválido se ignora (la pantalla queda sin preselección).
 */
export const gradingSearchSchema = z.object({
  sessionId: z.coerce.number().int().positive().optional().catch(undefined),
  attemptId: z.coerce.number().int().positive().optional().catch(undefined),
});

export type GradingSearch = z.output<typeof gradingSearchSchema>;

/** Search de `/app/resultados` y `/app/dashboard-resultados`: solo la sesión (opcional). */
export const sessionSearchSchema = z.object({
  sessionId: z.coerce.number().int().positive().optional().catch(undefined),
});

export type SessionSearch = z.output<typeof sessionSearchSchema>;

export interface GradingSelection {
  /** Sesión que rige la pantalla: la pedida si existe en la lista fresca, si no la más reciente. */
  sessionId: number | undefined;
  /** Se pidió una sesión que no está en la lista fresca (se avisa y se cae en la más reciente). */
  requestedMissing: boolean;
}

/**
 * Resuelve la sesión de la pantalla de calificación contra la lista de sesiones FRESCA (la de la carga
 * actual, nunca una caché). Función pura: la selección se DERIVA de la URL y de la lista, sin estado local
 * que una respuesta tardía pueda desincronizar.
 */
export function resolveGradingSelection(options: readonly { id: number }[], requested: number | undefined): GradingSelection {
  if (options.length === 0) return { sessionId: undefined, requestedMissing: requested !== undefined };
  if (requested !== undefined && options.some((option) => option.id === requested)) {
    return { sessionId: requested, requestedMissing: false };
  }
  return { sessionId: options[0].id, requestedMissing: requested !== undefined };
}
