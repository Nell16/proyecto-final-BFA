import { create } from "zustand";
import { persist } from "zustand/middleware";
import { toast } from "sonner";
import { resetAccountScopedState } from "./accountReset";

export interface StaffUser {
  id: string;
  username: string;
  /** Roles tal como los devuelve el backend (p. ej. "ADMINISTRADOR"). */
  roles: string[];
  /** Códigos de permiso de /auth/me (sin prefijo PERM_). */
  permissions: string[];
}

export interface StaffSession {
  token: string;
  /** Fecha ISO de expiración del JWT (LoginResult.expiresAt). */
  expiresAt: string | null;
  user?: StaffUser | null;
}

interface StaffAuthState {
  token: string | null;
  expiresAt: string | null;
  user: StaffUser | null;
  /**
   * Identidad de la sesión: un id ALEATORIO nuevo con cada `setSession` de token distinto y con
   * cada cierre. Al ser único entre pestañas (a diferencia de un contador, que dos pestañas
   * pueden repetir para tokens distintos), sirve de clave de caché (`['auth','me', sessionId]`)
   * sin exponer el token y para detectar carreras.
   */
  sessionId: string;
  setSession: (session: StaffSession) => void;
  /**
   * Guarda el usuario de /auth/me SOLO si `forToken` (el token con el que se pidió) sigue siendo
   * el de la memoria Y el persistido. Nunca escribe token ni credenciales: no puede restaurar
   * una sesión que otra pestaña ya reemplazó. Devuelve `true` si lo aplicó.
   */
  setUser: (user: StaffUser | null, forToken: string) => boolean;
  clear: () => void;
  hasPermission: (permission: string) => boolean;
  hasAnyPermission: (permissions: readonly string[]) => boolean;
}

export const STAFF_AUTH_STORAGE_KEY = "bfa-staff-auth";

/** Versión del formato persistido: 1 = `sessionId` aleatorio (string) en lugar de contador numérico. */
const STAFF_AUTH_STORAGE_VERSION = 1;

/** Genera la identidad de una sesión: única entre pestañas y entre cierres. */
export function newSessionId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch {
    // sin crypto.randomUUID: se usa el respaldo
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

/** Límite de setTimeout (2^31 - 1 ms); si el plazo es mayor se reprograma al vencer. */
const MAX_TIMEOUT_MS = 2_147_483_647;

/** Antelación del aviso previo a la expiración. */
export const EXPIRY_WARNING_MS = 2 * 60_000;
export const EXPIRY_WARNING_TOAST_ID = "staff-session-expiry-warning";

let expiryTimer: ReturnType<typeof setTimeout> | null = null;
let onSessionExpired: (() => void) | null = null;

/** Registra qué hacer (p. ej. navegar a /login) cuando la sesión expira por tiempo. */
export function setSessionExpiredHandler(handler: (() => void) | null): void {
  onSessionExpired = handler;
}

/** Identidad de la sesión persistida (par token + sessionId). */
export interface PersistedStaffSession {
  token: string;
  sessionId: string | null;
}

/**
 * Sesión PERSISTIDA (localStorage), que es la fuente de verdad compartida entre pestañas.
 * `undefined` si el storage no se puede leer; `null` si no hay sesión guardada (sin token).
 */
export function readPersistedStaffSession(): PersistedStaffSession | null | undefined {
  try {
    const raw = localStorage.getItem(STAFF_AUTH_STORAGE_KEY);
    if (!raw) return null;
    const state = (JSON.parse(raw) as { state?: { token?: unknown; sessionId?: unknown } } | null)?.state;
    if (typeof state?.token !== "string") return null;
    return { token: state.token, sessionId: typeof state.sessionId === "string" ? state.sessionId : null };
  } catch {
    return undefined;
  }
}

/**
 * ¿Es la misma sesión persistida? Compara el par {token, sessionId}. Con el storage ilegible
 * (`undefined`) no se puede contradecir: se asume que sí.
 */
export function isSamePersistedSession(
  a: PersistedStaffSession | null | undefined,
  b: PersistedStaffSession | null | undefined,
): boolean {
  if (a === undefined || b === undefined) return true;
  if (a === null || b === null) return a === b;
  return a.token === b.token && a.sessionId === b.sessionId;
}

/**
 * ¿Sigue siendo `token` la sesión persistida? Si otra pestaña ya guardó otra sesión, quien
 * actúe sobre `token` (401, timer, toast) no debe borrar ni cerrar la sesión nueva.
 * Con el storage ilegible no se puede contradecir a la memoria: se asume que sí.
 */
function isPersistedSession(token: string): boolean {
  const persisted = readPersistedStaffSession();
  return persisted === undefined || persisted?.token === token;
}

/**
 * Invalida la sesión `sentToken` tras un 401 (o expiración) SOLO si sigue siendo la sesión
 * vigente en memoria Y en el storage. Si otra pestaña persistió otra sesión, no se borra:
 * se re-hidrata desde el storage. Devuelve `true` si se cerró la sesión.
 */
export function invalidateStaffSession(sentToken: string | null): boolean {
  const state = useStaffAuth.getState();
  if (!state.token || state.token !== sentToken) return false;
  if (!isPersistedSession(sentToken)) {
    void syncStaffAuthFromStorage();
    return false;
  }
  state.clear();
  return true;
}

/** Cancela el temporizador pendiente y el aviso previo (si estaba visible). */
function cancelExpiryTimer(): void {
  if (expiryTimer !== null) {
    clearTimeout(expiryTimer);
    expiryTimer = null;
  }
  toast.dismiss(EXPIRY_WARNING_TOAST_ID);
}

function showExpiryWarning(token: string): void {
  toast.warning("Su sesión expirará en 2 minutos", {
    id: EXPIRY_WARNING_TOAST_ID,
    duration: Infinity,
    action: {
      label: "Cerrar sesión",
      onClick: () => {
        // Solo si la sesión que avisó sigue vigente (el toast pudo quedar de otra).
        if (invalidateStaffSession(token)) onSessionExpired?.();
      },
    },
  });
}

/**
 * Programa el aviso previo y el logout automático de la sesión `token`.
 * Un temporizador solo actúa si el token que lo programó sigue siendo el actual.
 */
function scheduleExpiry(token: string | null, expiresAt: string | null): void {
  cancelExpiryTimer();
  if (!token || !expiresAt) return;
  const expiresMs = Date.parse(expiresAt);
  if (Number.isNaN(expiresMs)) return;

  const remaining = expiresMs - Date.now();
  if (remaining <= 0) {
    expireNow(token);
    return;
  }

  let delay = remaining;
  if (remaining > EXPIRY_WARNING_MS) {
    delay = remaining - EXPIRY_WARNING_MS;
  } else {
    showExpiryWarning(token);
  }

  expiryTimer = setTimeout(() => {
    expiryTimer = null;
    const current = useStaffAuth.getState();
    if (current.token !== token) return; // la sesión cambió: este timer ya no aplica
    if (!isPersistedSession(token)) {
      // Otra pestaña persistió otra sesión: se adopta en vez de actuar sobre la que programó el timer.
      void syncStaffAuthFromStorage();
      return;
    }
    scheduleExpiry(token, current.expiresAt);
  }, Math.min(delay, MAX_TIMEOUT_MS));
}

function expireNow(token: string): void {
  if (invalidateStaffSession(token)) onSessionExpired?.();
}

export const useStaffAuth = create<StaffAuthState>()(
  persist(
    (set, get) => ({
      token: null,
      expiresAt: null,
      user: null,
      sessionId: newSessionId(),

      setSession: ({ token, expiresAt, user }) => {
        const previous = get();
        const nextUser = user ?? null;
        const tokenChanged = previous.token !== token;
        const accountChanged =
          tokenChanged || (previous.user !== null && nextUser !== null && previous.user.id !== nextUser.id);

        // Descarta datos de la cuenta anterior ANTES de publicar la nueva.
        if (accountChanged) resetAccountScopedState();

        set({
          token,
          expiresAt,
          user: nextUser,
          sessionId: tokenChanged ? newSessionId() : previous.sessionId,
        });
        scheduleExpiry(token, expiresAt);
      },

      setUser: (user, forToken) => {
        const current = get();
        // Solo si la memoria y el storage siguen en la sesión con la que se pidió /auth/me.
        if (current.token === null || current.token !== forToken || !isPersistedSession(forToken)) return false;
        // `set` pasa por persist y re-serializa token/expiresAt/sessionId de la MEMORIA: si otra
        // pestaña acaba de escribir otra sesión, se pisaría. Se compara el par {token, sessionId}.
        if (!isSamePersistedSession({ token: current.token, sessionId: current.sessionId }, readPersistedStaffSession())) {
          void syncStaffAuthFromStorage();
          return false;
        }
        set({ user });
        return true;
      },

      clear: () => {
        cancelExpiryTimer();
        resetAccountScopedState();
        // Identidad nueva al cerrar: nunca se reutiliza una clave de caché ni se comparte con otra pestaña.
        set({ token: null, expiresAt: null, user: null, sessionId: newSessionId() });
      },

      // Sin "admin tiene todo": se confía en la lista de permisos de /auth/me.
      hasPermission: (permission) => get().user?.permissions.includes(permission) ?? false,

      hasAnyPermission: (permissions) => permissions.some((p) => get().hasPermission(p)),
    }),
    {
      name: STAFF_AUTH_STORAGE_KEY,
      version: STAFF_AUTH_STORAGE_VERSION,
      // v0 guardaba un contador numérico (que dos pestañas podían repetir con tokens distintos): se renueva.
      migrate: (persisted) => ({ ...(persisted as object), sessionId: newSessionId() }) as StaffAuthState,
      partialize: (state) => ({
        token: state.token,
        expiresAt: state.expiresAt,
        user: state.user,
        sessionId: state.sessionId,
      }),
      onRehydrateStorage: () => () => {
        // `useStaffAuth` aún puede no estar asignado durante una hidratación síncrona.
        queueMicrotask(() => {
          const { token, expiresAt } = useStaffAuth.getState();
          if (token) scheduleExpiry(token, expiresAt);
        });
      },
    },
  ),
);

// ---------------------------------------------------------------------------
// Coordinación entre pestañas: otra pestaña hizo login/logout/cambió de cuenta.
// ---------------------------------------------------------------------------

/**
 * Re-hidrata la sesión desde localStorage y reprograma los temporizadores.
 * Si otra pestaña cambió de sesión, también se descarta el estado de la cuenta anterior.
 */
export async function syncStaffAuthFromStorage(): Promise<void> {
  const before = useStaffAuth.getState();
  let storedState: unknown = null;
  try {
    const raw = localStorage.getItem(STAFF_AUTH_STORAGE_KEY);
    storedState = raw ? (JSON.parse(raw) as { state?: unknown }).state : null;
  } catch {
    storedState = null;
  }

  if (!storedState) {
    // La otra pestaña cerró sesión (clave borrada): se refleja aquí sin volver a escribir.
    if (before.token !== null) {
      cancelExpiryTimer();
      resetAccountScopedState();
      useStaffAuth.setState({ token: null, expiresAt: null, user: null, sessionId: newSessionId() });
      onSessionExpired?.();
    }
    return;
  }

  await useStaffAuth.persist.rehydrate();
  const after = useStaffAuth.getState();

  if (after.token !== before.token) {
    resetAccountScopedState();
    scheduleExpiry(after.token, after.expiresAt);
    if (before.token !== null && after.token === null) onSessionExpired?.();
  } else if (after.expiresAt !== before.expiresAt) {
    scheduleExpiry(after.token, after.expiresAt);
  }
}

let storageListener: ((event: StorageEvent) => void) | null = null;

/** Registra (una sola vez) el listener global de `storage`. Devuelve su baja. */
export function startStaffAuthStorageSync(): () => void {
  if (typeof window === "undefined") return () => undefined;
  if (storageListener === null) {
    const listener = (event: StorageEvent): void => {
      // `key === null` => localStorage.clear() en otra pestaña.
      if (event.key !== null && event.key !== STAFF_AUTH_STORAGE_KEY) return;
      void syncStaffAuthFromStorage();
    };
    storageListener = listener;
    window.addEventListener("storage", listener);
  }
  return stopStaffAuthStorageSync;
}

/** Da de baja el listener global de `storage` (idempotente). */
export function stopStaffAuthStorageSync(): void {
  if (storageListener === null || typeof window === "undefined") return;
  window.removeEventListener("storage", storageListener);
  storageListener = null;
}

startStaffAuthStorageSync();

// HMR: evita acumular un listener por cada recarga del módulo.
if (import.meta.hot) import.meta.hot.dispose(stopStaffAuthStorageSync);
