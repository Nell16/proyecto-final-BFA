import type { CatalogType } from "../../api/schemas/academic";

/**
 * Permisos reales del backend por catálogo (`CatalogPermissionEvaluator` + `SecurityPermissions`):
 * `{RECURSO}_{LEER|CREAR|ELIMINAR}`. /auth/me los devuelve sin el prefijo `PERM_`.
 */
export interface CatalogPermissionSet {
  read: string;
  create: string;
  delete: string;
}

export const CATALOG_PERMISSIONS: Record<CatalogType, CatalogPermissionSet> = {
  sexos: { read: "CATALOGO_SEXO_LEER", create: "CATALOGO_SEXO_CREAR", delete: "CATALOGO_SEXO_ELIMINAR" },
  carreras: { read: "CARRERA_LEER", create: "CARRERA_CREAR", delete: "CARRERA_ELIMINAR" },
  cohortes: { read: "COHORTE_LEER", create: "COHORTE_CREAR", delete: "COHORTE_ELIMINAR" },
  "grupos-academicos": {
    read: "GRUPO_ACADEMICO_LEER",
    create: "GRUPO_ACADEMICO_CREAR",
    delete: "GRUPO_ACADEMICO_ELIMINAR",
  },
};

/** Nombre legible (plural) de cada catálogo para mensajes. */
export const CATALOG_LABELS: Record<CatalogType, string> = {
  sexos: "sexos",
  carreras: "carreras",
  cohortes: "cohortes",
  "grupos-academicos": "grupos académicos",
};
