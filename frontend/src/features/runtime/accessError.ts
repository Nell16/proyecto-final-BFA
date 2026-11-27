/**
 * Estado efímero en memoria para transferir mensajes de error de canje de enlace directo
 * (`/evaluacion/$code`) hacia `/evaluacion/acceso` tras limpiar el código de la URL.
 * Nunca se persiste en storage ni se serializa en la URL.
 */
let pendingAccessError: string | null = null;

export function setPendingAccessError(message: string): void {
  pendingAccessError = message;
}

export function peekPendingAccessError(): string | null {
  return pendingAccessError;
}

export function consumePendingAccessError(): string | null {
  const current = pendingAccessError;
  pendingAccessError = null;
  return current;
}

export function clearPendingAccessError(): void {
  pendingAccessError = null;
}
