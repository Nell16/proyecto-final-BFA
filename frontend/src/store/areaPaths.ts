/**
 * Pertenencia de una ruta a un área de la app. Comparar por prefijo de texto
 * (`startsWith("/app")`) acepta rutas ajenas como `/application`; aquí solo cuenta
 * el segmento exacto o sus descendientes.
 */
const stripQueryAndHash = (path: string): string => path.split(/[?#]/, 1)[0];

function isInArea(path: string, area: string): boolean {
  const pathname = stripQueryAndHash(path);
  return pathname === area || pathname.startsWith(`${area}/`);
}

/** `/app` exacto o `/app/...` (con o sin query/hash). `/application` NO cuenta. */
export const isAppPath = (path: string): boolean => isInArea(path, "/app");

/** `/evaluacion` exacto o `/evaluacion/...` (área del participante). */
export const isEvaluationPath = (path: string): boolean => isInArea(path, "/evaluacion");
