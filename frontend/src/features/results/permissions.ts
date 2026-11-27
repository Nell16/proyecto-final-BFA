import { PERMISSIONS } from "../../store/permissions";
import { ROUTE_PERMISSIONS } from "../../store/routePermissions";
import { useStaffAuth } from "../../store/staffAuth";
import { attemptsSource } from "./attempts-source";

function useHasPermission(permission: string): boolean {
  return useStaffAuth((s) => s.user?.permissions.includes(permission) ?? false);
}

/** `CALIFICACION_EJECUTAR`: calificar (`POST /attempts/{id}/score`) y resolver revisiones manuales. */
export const useCanGradeAttempts = (): boolean => useHasPermission(PERMISSIONS.CALIFICACION_EJECUTAR);
/** `RESULTADO_VER`: resultado individual y detallado (`GET /attempts/{id}/result|detailed-result`). */
export const useCanViewAttemptResults = (): boolean => useHasPermission(PERMISSIONS.RESULTADO_VER);

/** `true` si la fuente de intentos vigente es usable con los permisos de la cuenta (puente: SESION_LEER). */
export function useAttemptsSourceAvailable(): boolean {
  return useStaffAuth((s) => attemptsSource.isAvailable(s.user?.permissions ?? []));
}

/**
 * ¿Puede abrir `/app/revision-manual`? Misma regla que su ruta y su entrada de menú (CALIFICACION_EJECUTAR o
 * RESULTADO_VER): la bandeja se lista con cualquiera de los dos; resolver sigue exigiendo CALIFICACION_EJECUTAR.
 */
export const useCanOpenManualReview = (): boolean =>
  useStaffAuth((s) => ROUTE_PERMISSIONS["/app/revision-manual"].some((p) => s.user?.permissions.includes(p) ?? false));
