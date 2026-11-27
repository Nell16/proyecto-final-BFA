import { z } from "zod";
import { serverDateTime } from "./datetime";

export const SessionStatusSchema = z
  .enum(["PROGRAMADA", "ABIERTA", "PAUSADA", "CERRADA", "CANCELADA", "DESCONOCIDO"])
  .catch("DESCONOCIDO");

export type SessionStatus = z.output<typeof SessionStatusSchema>;

export interface SessionTransitionFlags {
  open: boolean;
  pause: boolean;
  resume: boolean;
  close: boolean;
  cancel: boolean;
}

export const SESSION_TRANSITIONS: Record<SessionStatus, SessionTransitionFlags> = {
  PROGRAMADA: { open: true, pause: false, resume: false, close: false, cancel: true },
  ABIERTA: { open: false, pause: true, resume: false, close: true, cancel: true },
  PAUSADA: { open: false, pause: false, resume: true, close: true, cancel: true },
  CERRADA: { open: false, pause: false, resume: false, close: false, cancel: false },
  CANCELADA: { open: false, pause: false, resume: false, close: false, cancel: false },
  DESCONOCIDO: { open: false, pause: false, resume: false, close: false, cancel: false },
};

export const SessionWireSchema = z
  .object({
    id: z.number(),
    codigoSesion: z.string(),
    nombreSesion: z.string(),
    descripcion: z.string().nullish(),
    estado: SessionStatusSchema,
    inicioProgramado: serverDateTime,
    finProgramado: serverDateTime.nullish(),
    inicioReal: serverDateTime.nullish(),
    finReal: serverDateTime.nullish(),
    ubicacion: z.string().nullish(),
    versionTestId: z.number(),
    pausadoEn: serverDateTime.nullish(),
    creadoEn: serverDateTime.nullish(),
  })
  .loose();

export const SessionSchema = SessionWireSchema.transform((wire) => ({
  id: wire.id,
  code: wire.codigoSesion,
  name: wire.nombreSesion,
  ...(wire.descripcion != null ? { description: wire.descripcion } : {}),
  status: wire.estado,
  scheduledStart: wire.inicioProgramado,
  ...(wire.finProgramado != null ? { scheduledEnd: wire.finProgramado } : {}),
  ...(wire.inicioReal != null ? { actualStart: wire.inicioReal } : {}),
  ...(wire.finReal != null ? { actualEnd: wire.finReal } : {}),
  ...(wire.ubicacion != null ? { location: wire.ubicacion } : {}),
  versionTestId: wire.versionTestId,
  ...(wire.pausadoEn != null ? { pausedAt: wire.pausadoEn } : {}),
}));

export const SessionListSchema = z.array(SessionSchema);

export type Session = z.output<typeof SessionSchema>;

export const SessionPauseWireSchema = z
  .object({
    id: z.number(),
    pausadoEn: serverDateTime,
    reanudadoEn: serverDateTime.nullish(),
    pausadoPor: z.string().nullish(),
    motivo: z.string().nullish(),
  })
  .loose();

export const SessionPauseSchema = SessionPauseWireSchema.transform((wire) => ({
  id: wire.id,
  pausedAt: wire.pausadoEn,
  resumedAt: wire.reanudadoEn ?? null,
  pausedBy: wire.pausadoPor ?? null,
  reason: wire.motivo ?? null,
}));

export const SessionPauseListSchema = z.array(SessionPauseSchema);

export type SessionPause = z.output<typeof SessionPauseSchema>;

export const SessionSubtestWireSchema = z
  .object({
    id: z.number(),
    sesionAplicacionId: z.number().nullish(),
    versionTestId: z.number().nullish(),
    subtestId: z.number().nullish(),
    numeroOrden: z.number(),
    tiempoLimiteSegundos: z.number().nullish(),
    permiteAleatorizarItems: z.boolean(),
    permiteAleatorizarOpciones: z.boolean(),
  })
  .loose();

export const SessionSubtestSchema = SessionSubtestWireSchema.transform((wire) => ({
  id: wire.id,
  ...(wire.sesionAplicacionId != null ? { sessionId: wire.sesionAplicacionId } : {}),
  ...(wire.versionTestId != null ? { versionTestId: wire.versionTestId } : {}),
  ...(wire.subtestId != null ? { subtestId: wire.subtestId } : {}),
  order: wire.numeroOrden,
  ...(wire.tiempoLimiteSegundos != null ? { timeLimitSeconds: wire.tiempoLimiteSegundos } : {}),
  randomizeItems: wire.permiteAleatorizarItems,
  randomizeOptions: wire.permiteAleatorizarOpciones,
}));

export const SessionSubtestListSchema = z.array(SessionSubtestSchema);

export type SessionSubtest = z.output<typeof SessionSubtestSchema>;

export const AssignedParticipantWireSchema = z
  .object({
    assignmentId: z.number(),
    rawToken: z.string(),
    expiresAt: serverDateTime,
  })
  .loose();

export const AssignedParticipantSchema = AssignedParticipantWireSchema.transform((wire) => ({
  assignmentId: wire.assignmentId,
  rawToken: wire.rawToken,
  expiresAt: wire.expiresAt,
}));

export type AssignedParticipant = z.output<typeof AssignedParticipantSchema>;

export const AssignmentLinkStatusSchema = z
  .enum(["GENERADO", "ACTIVO", "VENCIDO", "REVOCADO", "DESCONOCIDO"])
  .catch("DESCONOCIDO");

export type AssignmentLinkStatus = z.output<typeof AssignmentLinkStatusSchema>;

export const AssignmentAttemptStateSchema = z
  .enum(["no-iniciado", "en-progreso", "completado", "interrumpido", "anulado", "DESCONOCIDO"])
  .catch("DESCONOCIDO");

export type AssignmentAttemptState = z.output<typeof AssignmentAttemptStateSchema>;

const normalizeSentinel = (value: string | null | undefined, sentinels: readonly string[]): string | null => {
  if (value == null) return null;
  const trimmed = value.trim();
  if (trimmed === "" || sentinels.includes(trimmed)) return null;
  return value;
};

export const AssignmentRejectedAnswerWireSchema = z
  .object({
    itemId: z.number().int(),
    code: z.string(),
    rejectedAt: serverDateTime.nullish(),
  })
  .loose()
  .transform((wire) => ({
    itemId: wire.itemId,
    code: wire.code,
    rejectedAt: wire.rejectedAt ?? null,
  }));

export type AssignmentRejectedAnswer = z.output<typeof AssignmentRejectedAnswerWireSchema>;

export const AssignmentWireSchema = z
  .object({
    assignmentId: z.number(),
    attemptId: z.number().nullish(),
    participantId: z.string(),
    participantName: z.string(),
    participantCode: z.string().nullish(),
    status: AssignmentLinkStatusSchema,
    state: AssignmentAttemptStateSchema,
    currentSubtestId: z.string().nullish(),
    overallProgress: z.number().min(0).max(100),
    lastActivity: z
      .string()
      .nullish()
      .transform((value) => normalizeSentinel(value, ["Nunca"]))
      .pipe(serverDateTime.nullable()),
    tokenExpiraEn: serverDateTime.nullish(),
    rejectedAnswersCount: z.number().int().min(0).nullish(),
    rejectedAnswers: z.array(AssignmentRejectedAnswerWireSchema).nullish(),
  })
  .loose();

export const AssignmentSchema = AssignmentWireSchema.transform((wire) => {
  const rejectedAnswers = wire.rejectedAnswers ?? [];
  return {
    assignmentId: wire.assignmentId,
    attemptId: wire.attemptId ?? null,
    participantId: wire.participantId,
    participantName: wire.participantName,
    ...(wire.participantCode != null ? { participantCode: wire.participantCode } : {}),
    linkStatus: wire.status,
    attemptState: wire.state,
    currentSubtestId: normalizeSentinel(wire.currentSubtestId, ["—", "-"]),
    progress: wire.overallProgress,
    lastActivityAt: wire.lastActivity,
    tokenExpiresAt: wire.tokenExpiraEn ?? null,
    rejectedAnswersCount: wire.rejectedAnswersCount ?? rejectedAnswers.length,
    rejectedAnswers,
  };
});

export const AssignmentListSchema = z.array(AssignmentSchema);

export type Assignment = z.output<typeof AssignmentSchema>;

export interface CreateSessionRequest {
  versionTestId: number;
  code: string;
  name: string;
  description?: string;
  scheduledStart: string;
  scheduledEnd?: string;
  location?: string;
}

export interface PauseSessionInput {
  motivo?: string;
  reason?: string;
}

export interface SessionSubtestRequest {
  subtestId: number;
  order: number;
  timeLimitSeconds?: number;
  randomizeItems?: boolean;
  randomizeOptions?: boolean;
}

export interface AssignParticipantRequest {
  participantId: string;
  ttlHours?: number;
}

export interface RecordIncidenceRequest {
  participantId: string;
  text: string;
}
