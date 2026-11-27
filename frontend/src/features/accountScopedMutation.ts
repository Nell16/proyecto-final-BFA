import type { MutationFunctionContext } from "@tanstack/react-query";
import { captureAccountScope, type AccountScope } from "../store/accountScope";

/** Contexto que `onMutate` devuelve a `onSuccess`/`onSettled`/`onError`. */
export interface AccountScopedContext {
  scope: AccountScope;
}

/**
 * Ata una mutación a la cuenta de staff vigente al iniciarla. TanStack comparte el mismo objeto
 * `MutationFunctionContext` entre `onMutate` y `mutationFn`, así que la clave del WeakMap permite
 * validar la cuenta justo antes de la petición sin pasar el scope por las variables.
 *
 * - `onMutate`: captura el scope (y lo devuelve como `context`).
 * - `guard(ctx)`: llamar al inicio de `mutationFn`; lanza ACCOUNT_CHANGED si la cuenta cambió.
 * - En `onSuccess`/`onSettled`: `if (!context?.scope.isCurrent()) return;` antes de tocar la caché.
 */
export function createAccountScopedMutation() {
  const scopes = new WeakMap<object, AccountScope>();
  return {
    onMutate: (_variables: unknown, fnContext: MutationFunctionContext): AccountScopedContext => {
      const scope = captureAccountScope();
      scopes.set(fnContext, scope);
      return { scope };
    },
    guard: (fnContext: MutationFunctionContext): void => {
      // Sin onMutate previo (reanudación tras pausa): se valida contra la cuenta actual.
      (scopes.get(fnContext) ?? captureAccountScope()).assertCurrent();
    },
  };
}

/** `true` si la cuenta de staff sigue siendo la que inició la mutación. */
export const isScopeCurrent = (context: AccountScopedContext | undefined): boolean =>
  context?.scope.isCurrent() ?? false;
