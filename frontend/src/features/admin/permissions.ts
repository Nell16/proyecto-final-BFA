/**
 * Permisos reales de administración (psycho-form: SecurityPermissions.java).
 * `/auth/me` los devuelve sin el prefijo `PERM_`.
 */
export const ADMIN_PERMISSIONS = {
  USER_READ: "USUARIO_LEER",
  USER_CREATE: "USUARIO_CREAR",
  USER_UPDATE: "USUARIO_MODIFICAR",
  ROLE_READ: "ROL_LEER",
  ROLE_UPDATE: "ROL_MODIFICAR",
  AUDIT_READ: "AUDITORIA_VER",
} as const;

/** Determina si el nombre de un rol corresponde al rol de administrador. */
export function isAdminRoleName(roleName: string): boolean {
  const clean = roleName.trim().toUpperCase().replace(/^ROLE_/, "");
  return clean === "ADMIN" || clean === "ADMINISTRADOR" || clean.includes("ADMINISTRADOR");
}
