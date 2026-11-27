import type { VersionStatus } from "../../../api/schemas/instruments";

/** Instrumento elegido en el paso 1 (solo se conoce en la visita en que se creó la sesión). */
export interface InstrumentInfo {
  testId: number;
  testName: string;
  versionId: number;
  versionNumber: string;
  versionStatus: VersionStatus;
  /** `permiteAleatorizarItems` de la versión; si es `false` el backend fuerza `randomizeItems=false`. */
  allowRandomizeItems?: boolean;
}

/**
 * Acceso generado al asignar un participante. Vive SOLO en memoria del wizard:
 * `rawToken` nunca se escribe en stores, localStorage ni sessionStorage.
 */
export interface AccessEntry {
  participantId: string;
  participantName: string;
  participantCode: string;
  assignmentId: number;
  rawToken: string;
  expiresAt: string;
}

export interface AssignmentFailure {
  participantId: string;
  participantName: string;
  message: string;
}
