import { PERMISSIONS, SESION_LEER, TEST_LEER } from "./permissions";
import { requirePermission } from "./requirePermission";

/**
 * Fuente única ruta → permisos de /app/*. La usan la navegación (NavItem) y el
 * `beforeLoad` de cada ruta, de modo que lo que se oculta del menú también se bloquea
 * al escribir la URL. "Al menos uno"; vacío = cualquier usuario autenticado.
 *
 * Las rutas hijas heredan el guard de su layout padre (`/app/sesiones/$id`,
 * `/app/resultados/intento/…`, …); solo se declaran aquí las que exigen un permiso propio
 * (p. ej. `/app/sesiones/nueva`).
 */
export const ROUTE_PERMISSIONS = {
  "/app/dashboard": [],
  // Catálogos
  "/app/carreras": [PERMISSIONS.CARRERA_LEER],
  "/app/grupos": [PERMISSIONS.GRUPO_ACADEMICO_LEER],
  "/app/cohortes": [PERMISSIONS.COHORTE_LEER],
  "/app/sexos": [PERMISSIONS.CATALOGO_SEXO_LEER],
  // Aplicación
  "/app/sesiones": SESION_LEER,
  // Ruta hija con guard propio: además de SESION_LEER (layout padre) exige poder crear sesiones.
  "/app/sesiones/nueva": [PERMISSIONS.SESION_CREAR],
  "/app/participantes": [PERMISSIONS.PARTICIPANTE_LEER],
  // Instrumentos
  "/app/instrumentos": TEST_LEER,
  // Resultados
  "/app/calificaciones": [PERMISSIONS.CALIFICACION_EJECUTAR],
  // GET /manual-review/pending admite CALIFICACION_EJECUTAR o RESULTADO_VER; resolver exige CALIFICACION_EJECUTAR
  // (la pantalla oculta «Revisar» sin él).
  "/app/revision-manual": [PERMISSIONS.CALIFICACION_EJECUTAR, PERMISSIONS.RESULTADO_VER],
  "/app/resultados": [PERMISSIONS.RESULTADO_VER],
  "/app/dashboard-resultados": [PERMISSIONS.RESULTADO_AGREGADO_VER, PERMISSIONS.RESULTADO_VER],
  "/app/reportes": [PERMISSIONS.REPORTE_EXPORTAR, PERMISSIONS.RESULTADO_VER],
  // Administración
  "/app/auditoria": [PERMISSIONS.AUDITORIA_VER],
  "/app/usuarios": [PERMISSIONS.USUARIO_LEER],
  "/app/roles": [PERMISSIONS.ROL_LEER],
  "/app/respaldos": [PERMISSIONS.REPORTE_EXPORTAR],
} as const satisfies Record<string, readonly string[]>;

export type GuardedAppRoute = keyof typeof ROUTE_PERMISSIONS;

/** `beforeLoad` de una ruta /app/*: aplica los permisos centralizados de `ROUTE_PERMISSIONS`. */
export const requireRoutePermission = (route: GuardedAppRoute) => requirePermission(ROUTE_PERMISSIONS[route]);
