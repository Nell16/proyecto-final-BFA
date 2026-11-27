import { ApiError } from "../api/errors";
import { useStaffAuth } from "./staffAuth";

/** Código con el que se aborta una operación cuya cuenta de staff cambió en mitad del flujo. */
export const ACCOUNT_CHANGED = "ACCOUNT_CHANGED";

/**
 * Identidad de la cuenta de staff vigente al iniciar una operación. `sessionId` cambia en
 * login, logout, expiración y cambio de cuenta desde otra pestaña (ver staffAuth.ts).
 *
 * Uso:
 *   const scope = captureAccountScope();          // al iniciar (mutate / inicio de lote)
 *   scope.assertCurrent();                         // antes de cada nuevo envío
 *   if (!scope.isCurrent()) return;                // antes de publicar resultados (setQueryData, estado local)
 */
export interface AccountScope {
  readonly sessionId: string;
  isCurrent(): boolean;
  /** Lanza `ApiError{code: ACCOUNT_CHANGED}` si la cuenta cambió. */
  assertCurrent(): void;
}

export function captureAccountScope(): AccountScope {
  const sessionId = useStaffAuth.getState().sessionId;
  const isCurrent = () => useStaffAuth.getState().sessionId === sessionId;
  return {
    sessionId,
    isCurrent,
    assertCurrent() {
      if (!isCurrent()) {
        throw new ApiError({
          status: 0,
          code: ACCOUNT_CHANGED,
          message: "La sesión de staff cambió; la operación se canceló.",
        });
      }
    },
  };
}

export const isAccountChangedError = (error: unknown): boolean =>
  error instanceof ApiError && error.code === ACCOUNT_CHANGED;
