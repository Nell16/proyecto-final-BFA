import axios, { type AxiosInstance } from "axios";
import { toast } from "sonner";
import { toApiError, ApiError } from "./errors";
import { invalidateStaffSession, setSessionExpiredHandler, useStaffAuth } from "../store/staffAuth";
import { isAppPath, isEvaluationPath } from "../store/areaPaths";
import { useParticipantAuth } from "../store/participantAuth";

// ---------------------------------------------------------------------------
// Navegación inyectada (evita ciclos de import con el router).
// main.tsx llama a `setNavigator` tras crear el router.
// ---------------------------------------------------------------------------

export interface NavigateOptions {
  to: string;
  search?: Record<string, string>;
  replace?: boolean;
}

export type NavigateFn = (options: NavigateOptions) => void | Promise<void>;

let navigator: NavigateFn | null = null;
let getCurrentPath: () => string = () => window.location.pathname + window.location.search;

/** Registra la función de navegación del router y, opcionalmente, cómo leer la ruta actual. */
export function setNavigator(fn: NavigateFn | null, currentPath?: () => string): void {
  navigator = fn;
  if (currentPath) getCurrentPath = currentPath;
}

const navigateTo = (options: NavigateOptions): void => {
  if (!navigator) return;
  void navigator(options);
};

// ---------------------------------------------------------------------------
// Fábrica de clientes
// ---------------------------------------------------------------------------

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8080/";

/**
 * Endpoints de credenciales: se envían SIN Authorization (un bearer viejo no debe
 * viajar con un login) y un 401 significa "credenciales inválidas", no "sesión expirada".
 */
const CREDENTIAL_ENDPOINTS = ["/auth/login", "/acceso-participante/validar"];

const isCredentialUrl = (url: string | undefined): boolean =>
  CREDENTIAL_ENDPOINTS.some((endpoint) => (url ?? "").includes(endpoint));

declare module "axios" {
  // TS exige repetir los parámetros de tipo idénticos al declarar la interfaz original.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
  interface AxiosRequestConfig<D = any> {
    /** Uso interno del interceptor: token con el que realmente se envió la petición. */
    metadata?: { sentToken: string | null };
    /** Desactiva el toast automático de 403 (staff, métodos no-GET). */
    silent403?: boolean;
    /**
     * Predicado opcional que fija quien emite la petición (F2-FIX-7): si al volver con 401 devuelve `false`, la
     * respuesta quedó obsoleta para quien la pidió y el interceptor NO cierra la sesión ni navega; el error sube y
     * quien emitió la petición lo descarta. Mantiene `api/` desacoplado de `features/`.
     */
    isStillRelevant?: () => boolean;
  }
}

export interface ApiClientOptions {
  timeoutMs?: number;
  /** Muestra `toast.error` ante un 403 en métodos no-GET (solo staff). */
  toastOnForbidden?: boolean;
}

const READ_ONLY_METHODS = new Set(["get", "head", "options"]);

export function createApiClient(
  getToken: () => string | null,
  onUnauthorized: (sentToken: string | null) => void,
  options: ApiClientOptions = {},
): AxiosInstance {
  const client = axios.create({
    baseURL: BASE_URL,
    timeout: options.timeoutMs ?? 60_000,
    headers: { "Content-Type": "application/json" },
  });

  client.interceptors.request.use((config) => {
    if (typeof FormData !== "undefined" && config.data instanceof FormData) {
      // El navegador debe fijar el boundary multipart.
      config.headers.delete("Content-Type");
    }
    if (isCredentialUrl(config.url)) {
      config.headers.delete("Authorization");
    } else {
      const token = getToken();
      if (token && !config.headers.has("Authorization")) {
        config.headers.set("Authorization", `Bearer ${token}`);
      }
    }
    // Se recuerda el token realmente enviado: un 401 tardío de una sesión anterior no debe
    // cerrar la sesión nueva.
    const authorization = config.headers.get("Authorization");
    config.metadata = {
      sentToken: typeof authorization === "string" ? authorization.replace(/^Bearer\s+/i, "") : null,
    };
    return config;
  });

  client.interceptors.response.use(
    (response) => response,
    (error: unknown) => {
      const apiError = toApiError(error);
      const config = axios.isAxiosError(error) ? error.config : undefined;
      if (apiError.status === 401) {
        // Solo si la petición salió con el token vigente: si la sesión cambió mientras
        // volaba, el 401 pertenece a la sesión anterior y se rechaza sin limpiar.
        const sentToken = config?.metadata?.sentToken ?? null;
        // Si quien emitió la petición ya la considera obsoleta (`isStillRelevant() === false`), el 401 no cierra la
        // sesión: el error sube y el emisor lo descarta.
        const stillRelevant = config?.isStillRelevant?.() ?? true;
        if (!isCredentialUrl(config?.url) && sentToken === getToken() && stillRelevant) onUnauthorized(sentToken);
      }
      // 403: la sesión es válida pero sin permiso. NO se hace logout; se avisa al usuario
      // una sola vez por petición (el interceptor corre una vez) si fue una acción de escritura.
      if (
        apiError.status === 403 &&
        options.toastOnForbidden &&
        !config?.silent403 &&
        !READ_ONLY_METHODS.has((config?.method ?? "get").toLowerCase())
      ) {
        toast.error(apiError.message);
      }
      return Promise.reject(apiError);
    },
  );

  return client;
}

// ---------------------------------------------------------------------------
// Instancias
// ---------------------------------------------------------------------------

const redirectToLogin = (): void => {
  const current = getCurrentPath();
  // Fuera de /app (p. ej. el participante en /evaluacion) no se toca la navegación.
  if (!isAppPath(current)) return;
  navigateTo({ to: "/login", search: { redirect: current }, replace: true });
};

const handleStaffUnauthorized = (sentToken: string | null): void => {
  // Solo cierra si `sentToken` sigue siendo la sesión en memoria Y la persistida: si otra
  // pestaña ya guardó otra sesión, se re-hidrata desde el storage en lugar de borrarla.
  if (!invalidateStaffSession(sentToken)) return; // ya limpia, ajena o reemplazada en otra pestaña
  redirectToLogin();
};

// Logout automático por expiración del JWT: misma salida que un 401.
setSessionExpiredHandler(redirectToLogin);

/** Rutas fijas del área del participante; cualquier otro `/evaluacion/<segmento>` es el canje `/evaluacion/$code`. */
const PARTICIPANT_FIXED_SEGMENTS = new Set(["acceso", "sesion", "subtests"]);

/** ¿La pestaña está canjeando un código (`/evaluacion/$code`)? */
export function isParticipantRedeemPath(path: string): boolean {
  const match = /^\/evaluacion\/([^/?#]+)\/?(?:[?#].*)?$/.exec(path);
  return match !== null && !PARTICIPANT_FIXED_SEGMENTS.has(match[1]!);
}

const handleParticipantUnauthorized = (): void => {
  const { token, clear } = useParticipantAuth.getState();
  if (!token) return;
  clear();
  // Solo se navega si el participante está en su área: si la pestaña está en /app (staff) o en
  // otra ruta, el 401 tardío de una petición del participante no debe arrastrar la navegación.
  const path = getCurrentPath();
  if (!isEvaluationPath(path)) return;
  // Durante el canje de OTRO código (401 tardío del participante anterior mientras el nuevo canje sigue en
  // vuelo) no se navega: basta con limpiar la sesión anterior; el canje en curso guarda la nueva.
  if (isParticipantRedeemPath(path)) return;
  navigateTo({ to: "/evaluacion/acceso", replace: true });
};

export const staffClient = createApiClient(() => useStaffAuth.getState().token, handleStaffUnauthorized, {
  toastOnForbidden: true,
});

export const participantClient = createApiClient(
  () => useParticipantAuth.getState().token,
  handleParticipantUnauthorized,
);

export { ApiError };
