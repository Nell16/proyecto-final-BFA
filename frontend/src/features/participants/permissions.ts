/**
 * Permisos de participante (SecurityPermissions.java). /auth/me los devuelve sin el prefijo `PERM_`.
 * `PARTICIPANTE_LEER` ya está en `store/permissions.ts`; aquí solo los de escritura.
 */
export const PARTICIPANT_PERMISSIONS = {
  CREATE: "PARTICIPANTE_CREAR",
  DELETE: "PARTICIPANTE_ELIMINAR",
} as const;
