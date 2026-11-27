import { z } from "zod";
import { staffClient } from "../client";
import { unwrap, type ApiEnvelope } from "../errors";
import { parseOrThrow } from "../schemas/parse";
import {
  AssignedParticipantSchema,
  AssignmentListSchema,
  SESSION_TRANSITIONS,
  SessionListSchema,
  SessionPauseListSchema,
  SessionSchema,
  SessionSubtestListSchema,
  type AssignParticipantRequest,
  type AssignedParticipant,
  type Assignment,
  type CreateSessionRequest,
  type PauseSessionInput,
  type RecordIncidenceRequest,
  type Session,
  type SessionPause,
  type SessionSubtest,
  type SessionSubtestRequest,
} from "../schemas/sessions";

const VoidDataSchema = z.null().nullish();

export { SESSION_TRANSITIONS };

export function buildAccessCode(assignmentId: number, rawToken: string): string {
  return `${assignmentId}-${rawToken}`;
}

export async function listSessions(): Promise<Session[]> {
  const res = await staffClient.get<ApiEnvelope<unknown>>("/sesiones");
  return parseOrThrow(SessionListSchema, unwrap(res), "GET /sesiones");
}

export async function getSession(sessionId: number): Promise<Session> {
  const res = await staffClient.get<ApiEnvelope<unknown>>(`/sesiones/${sessionId}`);
  return parseOrThrow(SessionSchema, unwrap(res), `GET /sesiones/${sessionId}`);
}

export async function createSession(input: CreateSessionRequest): Promise<Session> {
  const res = await staffClient.post<ApiEnvelope<unknown>>("/sesiones", input);
  return parseOrThrow(SessionSchema, unwrap(res), "POST /sesiones");
}

export async function openSession(sessionId: number): Promise<Session> {
  const res = await staffClient.post<ApiEnvelope<unknown>>(`/sesiones/${sessionId}/activar`);
  return parseOrThrow(SessionSchema, unwrap(res), `POST /sesiones/${sessionId}/activar`);
}

export async function pauseSession(sessionId: number, input?: PauseSessionInput): Promise<Session> {
  const motivo = input?.motivo ?? input?.reason;
  const body = motivo !== undefined ? { motivo } : {};
  const res = await staffClient.post<ApiEnvelope<unknown>>(`/sesiones/${sessionId}/pausar`, body);
  return parseOrThrow(SessionSchema, unwrap(res), `POST /sesiones/${sessionId}/pausar`);
}

export async function resumeSession(sessionId: number): Promise<Session> {
  const res = await staffClient.post<ApiEnvelope<unknown>>(`/sesiones/${sessionId}/reanudar`);
  return parseOrThrow(SessionSchema, unwrap(res), `POST /sesiones/${sessionId}/reanudar`);
}

export async function listPauses(sessionId: number): Promise<SessionPause[]> {
  const res = await staffClient.get<ApiEnvelope<unknown>>(`/sesiones/${sessionId}/pausas`);
  return parseOrThrow(SessionPauseListSchema, unwrap(res), `GET /sesiones/${sessionId}/pausas`);
}

export async function closeSession(sessionId: number): Promise<Session> {
  const res = await staffClient.post<ApiEnvelope<unknown>>(`/sesiones/${sessionId}/cerrar`);
  return parseOrThrow(SessionSchema, unwrap(res), `POST /sesiones/${sessionId}/cerrar`);
}

export async function cancelSession(sessionId: number): Promise<Session> {
  const res = await staffClient.post<ApiEnvelope<unknown>>(`/sesiones/${sessionId}/cancelar`);
  return parseOrThrow(SessionSchema, unwrap(res), `POST /sesiones/${sessionId}/cancelar`);
}

export async function replaceSessionSubtests(
  sessionId: number,
  subtests: SessionSubtestRequest[],
): Promise<SessionSubtest[]> {
  const res = await staffClient.put<ApiEnvelope<unknown>>(`/sesiones/${sessionId}/subtests`, subtests);
  return parseOrThrow(SessionSubtestListSchema, unwrap(res), `PUT /sesiones/${sessionId}/subtests`);
}

export async function assignParticipant(
  sessionId: number,
  input: AssignParticipantRequest,
): Promise<AssignedParticipant> {
  // Sin AbortSignal a propósito: una asignación ya enviada crea un token único (no regenerable) y su
  // respuesta siempre debe procesarse. La cancelación solo impide ENVIAR peticiones nuevas.
  const res = await staffClient.post<ApiEnvelope<unknown>>(`/sesiones/${sessionId}/asignaciones`, input);
  return parseOrThrow(AssignedParticipantSchema, unwrap(res), `POST /sesiones/${sessionId}/asignaciones`);
}

export async function listAssignments(sessionId: number): Promise<Assignment[]> {
  const res = await staffClient.get<ApiEnvelope<unknown>>(`/sesiones/${sessionId}/asignaciones`);
  return parseOrThrow(AssignmentListSchema, unwrap(res), `GET /sesiones/${sessionId}/asignaciones`);
}

export async function revokeAssignment(sessionId: number, assignmentId: number): Promise<void> {
  const res = await staffClient.post<ApiEnvelope<unknown>>(
    `/sesiones/${sessionId}/asignaciones/${assignmentId}/revocar`,
  );
  parseOrThrow(VoidDataSchema, unwrap(res), `POST /sesiones/${sessionId}/asignaciones/${assignmentId}/revocar`);
}

export async function recordIncidence(sessionId: number, input: RecordIncidenceRequest): Promise<void> {
  const res = await staffClient.post<ApiEnvelope<unknown>>(`/sesiones/${sessionId}/incidencias`, input);
  parseOrThrow(VoidDataSchema, unwrap(res), `POST /sesiones/${sessionId}/incidencias`);
}
