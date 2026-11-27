import { isAppPath } from "./areaPaths";

export const DEFAULT_AFTER_LOGIN = "/app/dashboard";

/**
 * Normaliza el parámetro `redirect` de /login y solo acepta destinos internos bajo /app.
 * Rechaza otros orígenes, `//`, backslashes y `..` (incluidos %2e%2e); ante cualquier duda
 * devuelve `/app/dashboard`.
 */
export function resolveSafeRedirect(
  candidate: string | null | undefined,
  origin: string = window.location.origin,
): string {
  if (typeof candidate !== "string" || candidate === "") return DEFAULT_AFTER_LOGIN;
  if (candidate.includes("\\") || candidate.includes("..") || candidate.startsWith("//")) {
    return DEFAULT_AFTER_LOGIN;
  }

  let url: URL;
  try {
    url = new URL(candidate, origin);
  } catch {
    return DEFAULT_AFTER_LOGIN;
  }

  if (url.origin !== origin) return DEFAULT_AFTER_LOGIN;
  if (url.pathname.includes("//") || /%2e%2e|%5c|%2f%2f/i.test(url.pathname)) return DEFAULT_AFTER_LOGIN;
  if (!isAppPath(url.pathname)) return DEFAULT_AFTER_LOGIN;

  return `${url.pathname}${url.search}${url.hash}`;
}
