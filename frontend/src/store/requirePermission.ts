import { redirect } from "@tanstack/react-router";
import { useStaffAuth } from "./staffAuth";

/**
 * Guard para `beforeLoad` de rutas hijas de /app. Pasa si el usuario tiene
 * AL MENOS UNO de los permisos indicados; si no, redirige a /no-autorizado.
 * Una lista vacía significa "cualquier usuario autenticado".
 * (El `beforeLoad` de /app corre antes y ya hidrató el usuario desde /auth/me.)
 *
 * @example beforeLoad: requirePermission(PERMISSIONS.USUARIO_LEER)
 */
export function requirePermission(permission: string | readonly string[]) {
  const required = typeof permission === "string" ? [permission] : permission;
  return (): void => {
    if (required.length === 0) return;
    if (!useStaffAuth.getState().hasAnyPermission(required)) {
      throw redirect({ to: "/no-autorizado" });
    }
  };
}
