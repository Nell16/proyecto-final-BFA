import type { QueryClient } from "@tanstack/react-query";
import { authKeys, authService } from "../api/authService";
import { ApiError } from "../api/errors";
import { syncStaffAuthFromStorage, useStaffAuth } from "./staffAuth";

export const ME_STALE_TIME_MS = 5 * 60 * 1000;
/** Cuántas veces se reintenta si la sesión cambia mientras /auth/me está en vuelo. */
const MAX_SESSION_CHANGES = 3;

/**
 * Hidrata el usuario de la sesión actual desde /auth/me (clave por sesión) y devuelve
 * `"ok"`, o `"login"` si no hay sesión válida.
 *
 * Si la sesión cambia mientras /auth/me está en vuelo (logout, 401, otro login), la
 * respuesta pertenece a la identidad anterior: NO se escribe y se reevalúa el estado actual.
 */
export async function ensureStaffUser(queryClient: QueryClient): Promise<"ok" | "login"> {
  for (let attempt = 0; attempt <= MAX_SESSION_CHANGES; attempt += 1) {
    const before = useStaffAuth.getState();
    if (!before.token) return "login";

    try {
      // fetchQuery (no ensureQueryData): respeta staleTime y refetchea si el dato está viejo.
      const user = await queryClient.fetchQuery({
        queryKey: authKeys.me(before.sessionId),
        queryFn: authService.getCurrentUser,
        staleTime: ME_STALE_TIME_MS,
      });

      const after = useStaffAuth.getState();
      if (after.token !== before.token || after.sessionId !== before.sessionId) continue; // sesión cambió

      // setUser no escribe credenciales y solo aplica si memoria, storage y el token con el que se
      // pidió /auth/me coinciden. Si otra pestaña ya persistió otra sesión, se adopta y se reevalúa.
      if (!after.setUser(user, before.token)) {
        await syncStaffAuthFromStorage();
        continue;
      }
      return "ok";
    } catch (error) {
      // Primero la pertenencia: si la sesión cambió durante el vuelo, el error (incluido un
      // 401) es de la identidad anterior; se ignora y se reevalúa la sesión actual.
      const after = useStaffAuth.getState();
      if (after.token !== before.token || after.sessionId !== before.sessionId) continue;
      // El interceptor ya cerró la sesión ante un 401 vigente; aquí solo se corta la navegación.
      if (error instanceof ApiError && error.status === 401) return "login";
      throw error;
    }
  }
  return "login";
}
