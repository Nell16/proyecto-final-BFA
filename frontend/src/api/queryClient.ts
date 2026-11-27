import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "./errors";

/**
 * Prefijo reservado para las query keys del participante (runner). `resetAccountScopedState`
 * (cambio de cuenta de staff) NO las elimina: pertenecen a otra audiencia.
 * Ver docs/refactor/conventions-api.md.
 */
export const RUNTIME_QUERY_KEY_PREFIX = "runtime";

/** ¿La key (de query o mutation) es del participante? Solo cuenta su primer segmento. */
export const isRuntimeKey = (key: readonly unknown[] | undefined): boolean => key?.[0] === RUNTIME_QUERY_KEY_PREFIX;

const MAX_RETRIES = 2;

/**
 * Política de reintentos (plan F1): 0 en 4xx (la petición es inválida o no autorizada, repetirla
 * no cambia nada) y hasta 2 ante fallos de red/timeout o 5xx. Cualquier otro error (contrato
 * inválido, cancelación, bug) no se reintenta.
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_RETRIES) return false;
  if (!(error instanceof ApiError)) return false;
  if (error.status >= 400 && error.status <= 499) return false;
  return error.status >= 500 || error.code === "NETWORK" || error.code === "TIMEOUT";
}

export const DEFAULT_STALE_TIME_MS = 30_000;

/**
 * Singleton compartido por la app (main.tsx) y por la capa de sesión: al cambiar de
 * cuenta o cerrar sesión hay que vaciar la caché desde fuera de React.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: shouldRetryQuery,
      refetchOnWindowFocus: false,
      staleTime: DEFAULT_STALE_TIME_MS,
    },
  },
});
