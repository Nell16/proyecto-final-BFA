export interface BackoffOptions {
  baseDelayMs: number;
  maxDelayMs: number;
  /** Devuelve un número en [0, 1). Inyectable para tests. */
  random: () => number;
}

/**
 * Backoff exponencial con jitter ("equal jitter"): el techo crece como `base * 2^attempt` hasta
 * `maxDelayMs` y el retraso real cae en [techo/2, techo). `attempt` empieza en 0.
 */
export function computeBackoffMs(attempt: number, { baseDelayMs, maxDelayMs, random }: BackoffOptions): number {
  const safeAttempt = Math.max(0, Math.min(attempt, 30));
  const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** safeAttempt);
  return Math.round(ceiling / 2 + random() * (ceiling / 2));
}
