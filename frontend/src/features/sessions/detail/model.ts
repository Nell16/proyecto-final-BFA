import { ApiError } from "../../../api/errors";
import type {
  Assignment,
  AssignmentAttemptState,
} from "../../../api/schemas/sessions";
import type { AttemptStatus } from "../../../app/components/ui/status-badge";
import { PERMISSIONS } from "../../../store/permissions";
import { useStaffAuth } from "../../../store/staffAuth";

/** El backend manda el estado del intento en kebab-case; `StatusBadge` usa el enum `AttemptStatus`. */
const ATTEMPT_STATE_TO_STATUS: Record<AssignmentAttemptState, AttemptStatus | "DESCONOCIDO"> = {
  "no-iniciado": "NO_INICIADO",
  "en-progreso": "EN_PROGRESO",
  completado: "COMPLETADO",
  interrumpido: "INTERRUMPIDO",
  anulado: "ANULADO",
  DESCONOCIDO: "DESCONOCIDO",
};

export function toAttemptStatus(state: AssignmentAttemptState): AttemptStatus | "DESCONOCIDO" {
  return ATTEMPT_STATE_TO_STATUS[state];
}

export interface MonitorKpis {
  assigned: number;
  inProgress: number;
  completed: number;
  interrupted: number;
  notStarted: number;
}

export type KpiKey = keyof MonitorKpis;

/** KPIs del monitor derivados de las asignaciones (fuente única: `Assignment.attemptState`). */
export function deriveKpis(assignments: readonly Assignment[]): MonitorKpis {
  const kpis: MonitorKpis = { assigned: assignments.length, inProgress: 0, completed: 0, interrupted: 0, notStarted: 0 };
  for (const a of assignments) {
    if (a.attemptState === "en-progreso") kpis.inProgress += 1;
    else if (a.attemptState === "completado") kpis.completed += 1;
    else if (a.attemptState === "interrumpido") kpis.interrupted += 1;
    else if (a.attemptState === "no-iniciado") kpis.notStarted += 1;
  }
  return kpis;
}

/** Qué asignaciones cuenta cada KPI (para el filtro por clic). `assigned` = todas. */
export function matchesKpi(assignment: Assignment, key: KpiKey): boolean {
  switch (key) {
    case "assigned":
      return true;
    case "inProgress":
      return assignment.attemptState === "en-progreso";
    case "completed":
      return assignment.attemptState === "completado";
    case "interrupted":
      return assignment.attemptState === "interrumpido";
    case "notStarted":
      return assignment.attemptState === "no-iniciado";
  }
}

const MONITOR_ORDER: Record<AssignmentAttemptState, number> = {
  interrumpido: 0,
  "en-progreso": 1,
  "no-iniciado": 2,
  completado: 3,
  anulado: 4,
  DESCONOCIDO: 5,
};

/** Orden del monitor: INTERRUMPIDO → EN_PROGRESO → NO_INICIADO → COMPLETADO → ANULADO; luego por nombre. */
export function sortForMonitor(assignments: readonly Assignment[]): Assignment[] {
  return [...assignments].sort(
    (a, b) =>
      MONITOR_ORDER[a.attemptState] - MONITOR_ORDER[b.attemptState] ||
      a.participantName.localeCompare(b.participantName, "es"),
  );
}

/** Mensaje legible de un error de la capa API (ApiError ya viene normalizado). */
export function errorMessage(error: unknown, fallback = "No se pudo completar la operación."): string {
  if (error instanceof ApiError && error.message) return error.message;
  return fallback;
}

function useHasPermission(permission: string): boolean {
  return useStaffAuth((s) => s.user?.permissions.includes(permission) ?? false);
}

/** Acciones de asignar, revocar, incidencias y transiciones de sesión exigen SESION_APLICAR. */
export const useCanApplySessions = (): boolean => useHasPermission(PERMISSIONS.SESION_APLICAR);
export const useCanCreateSessions = (): boolean => useHasPermission(PERMISSIONS.SESION_CREAR);
export const useCanViewResults = (): boolean => useHasPermission(PERMISSIONS.RESULTADO_VER);
export const useCanGrade = (): boolean => useHasPermission(PERMISSIONS.CALIFICACION_EJECUTAR);
