import { staffClient } from "./client";
import { ApiError, unwrap, type ApiEnvelope } from "./errors";
import {
  isSamePersistedSession,
  readPersistedStaffSession,
  useStaffAuth,
  type StaffUser,
} from "../store/staffAuth";
import type { LoginRequest, LoginResult, MeResponse } from "./types";

export const authKeys = {
  all: ["auth"] as const,
  /** Una clave por sesión (sessionId aleatorio, nunca el token): evita restaurar la identidad de otra cuenta. */
  me: (sessionId: string) => ["auth", "me", sessionId] as const,
};

const toStaffUser = (me: MeResponse): StaffUser => ({
  id: me.userId,
  username: me.username,
  roles: me.roles,
  permissions: me.permissions,
});

export interface LoginOutcome {
  token: string;
  expiresAt: string;
  user: StaffUser;
}

/** Código del `ApiError` con que `login` descarta un intento reemplazado por otro login o por otra sesión. */
export const LOGIN_SUPERSEDED = "LOGIN_SUPERSEDED";

/** Contador de intentos de login: solo el último intento iniciado puede publicar sesión. */
let latestLoginAttempt = 0;

export const authService = {
  /**
   * Login contra el backend; deja la sesión (token, expiresAt, usuario) en `staffAuth`.
   *
   * Cada llamada captura su "generación" (intento de login + `sessionId` en memoria + sesión
   * PERSISTIDA {token, sessionId}) antes de empezar. Si al volver de `/auth/login` o `/auth/me`
   * ya se inició otro login, la sesión en memoria cambió (401, logout) o la persistida cambió
   * (otra pestaña cuyo evento `storage` aún está pendiente), el resultado se DESCARTA con
   * `ApiError(LOGIN_SUPERSEDED)` y no toca el store: nunca pisa una sesión ajena.
   */
  async login(username: string, password: string): Promise<LoginOutcome> {
    const attempt = (latestLoginAttempt += 1);
    const generation = useStaffAuth.getState().sessionId;
    const persistedAtStart = readPersistedStaffSession();
    const isCurrent = (): boolean =>
      attempt === latestLoginAttempt &&
      useStaffAuth.getState().sessionId === generation &&
      isSamePersistedSession(persistedAtStart, readPersistedStaffSession());
    const supersededError = (): ApiError =>
      new ApiError({ status: 0, code: LOGIN_SUPERSEDED, message: "El inicio de sesión fue reemplazado por otro más reciente." });

    const loginRequest: LoginRequest = { username, password };
    const loginResult = unwrap(await staffClient.post<ApiEnvelope<LoginResult>>("/auth/login", loginRequest));
    if (!isCurrent()) throw supersededError();
    const token = loginResult.accessToken;

    // Se envía el token explícitamente: aún no está en el store, y así un /auth/me fallido no deja sesión a medias.
    const me = unwrap(
      await staffClient.get<ApiEnvelope<MeResponse>>("/auth/me", {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );

    if (!isCurrent()) throw supersededError();
    const user = toStaffUser(me);
    useStaffAuth.getState().setSession({ token, expiresAt: loginResult.expiresAt, user });
    return { token, expiresAt: loginResult.expiresAt, user };
  },

  async getCurrentUser(): Promise<StaffUser> {
    return toStaffUser(unwrap(await staffClient.get<ApiEnvelope<MeResponse>>("/auth/me")));
  },
};
