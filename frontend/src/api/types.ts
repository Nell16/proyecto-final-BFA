/**
 * DTOs de autenticación del staff que consume `authService.ts`.
 * El resto de contratos vive en `src/api/schemas/*` (zod) y `src/api/endpoints/*`.
 */

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResult {
  accessToken: string;
  tokenType: string;
  expiresAt: string;
  userId: string;
  username: string;
  permissions: string[];
}

export interface MeResponse {
  userId: string;
  username: string;
  permissions: string[];
  roles: string[];
}
