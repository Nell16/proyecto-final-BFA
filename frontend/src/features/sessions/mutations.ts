import { useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../../api/errors";
import {
  SESSION_TRANSITIONS,
  assignParticipant,
  cancelSession,
  closeSession,
  createSession,
  openSession,
  pauseSession,
  recordIncidence,
  replaceSessionSubtests,
  resumeSession,
  revokeAssignment,
} from "../../api/endpoints/sessions";
import type {
  CreateSessionRequest,
  RecordIncidenceRequest,
  Session,
  SessionSubtestRequest,
} from "../../api/schemas/sessions";
import { createAccountScopedMutation, isScopeCurrent } from "../accountScopedMutation";
import { sessionKeys } from "./queries";

/** Feature flag hasta validar el contrato de pausa del backend contra el frontend. */
export const PAUSE_ENABLED = import.meta.env.VITE_FEATURE_SESSION_PAUSE === "true";

export type SessionAction = "open" | "pause" | "resume" | "close" | "cancel";

/** Acciones disponibles según la máquina de estados del backend (única fuente: SESSION_TRANSITIONS). */
export function availableActions(status: Session["status"]): Record<SessionAction, boolean> {
  const t = SESSION_TRANSITIONS[status];
  return {
    open: t.open,
    pause: t.pause && PAUSE_ENABLED,
    resume: t.resume,
    close: t.close,
    cancel: t.cancel,
  };
}

const scoped = createAccountScopedMutation();

export function useSessionTransition(sessionId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: [...sessionKeys.detail(sessionId), "transition"],
    onMutate: scoped.onMutate,
    mutationFn: ({ action, reason }: { action: SessionAction; reason?: string }, ctx) => {
      scoped.guard(ctx);
      switch (action) {
        case "open":
          return openSession(sessionId);
        case "pause":
          return pauseSession(sessionId, reason ? { motivo: reason } : undefined);
        case "resume":
          return resumeSession(sessionId);
        case "close":
          return closeSession(sessionId);
        case "cancel":
          return cancelSession(sessionId);
      }
    },
    onSuccess: (session, _vars, context) => {
      if (!isScopeCurrent(context)) return; // la cuenta cambió: no se publica nada en la caché
      qc.setQueryData(sessionKeys.detail(sessionId), session);
      void qc.invalidateQueries({ queryKey: sessionKeys.detail(sessionId) });
      void qc.invalidateQueries({ queryKey: sessionKeys.list() });
    },
  });
}

export function useCreateSession() {
  const qc = useQueryClient();
  return useMutation({
    onMutate: scoped.onMutate,
    mutationFn: (input: CreateSessionRequest, ctx) => {
      scoped.guard(ctx);
      return createSession(input);
    },
    onSuccess: (_data, _vars, context) => {
      if (isScopeCurrent(context)) void qc.invalidateQueries({ queryKey: sessionKeys.list() });
    },
  });
}

export function useReplaceSessionSubtests(sessionId: number) {
  const qc = useQueryClient();
  return useMutation({
    onMutate: scoped.onMutate,
    mutationFn: (subtests: SessionSubtestRequest[], ctx) => {
      scoped.guard(ctx);
      return replaceSessionSubtests(sessionId, subtests);
    },
    onSuccess: (_data, _vars, context) => {
      if (isScopeCurrent(context)) void qc.invalidateQueries({ queryKey: sessionKeys.detail(sessionId) });
    },
  });
}

export interface AssignParticipantVariables {
  participantId: string;
  ttlHours?: number;
  signal?: AbortSignal;
  /**
   * Comprobación síncrona evaluada en el punto de envío (también al reanudar una mutación pausada sin conexión).
   * Si devuelve `false`, no se envía el POST y se lanza `CANCELED`. Ej.: el permiso de lectura vigente en caché.
   */
  canSend?: () => boolean;
}

export const isCanceledError = (error: unknown): boolean => error instanceof ApiError && error.code === "CANCELED";

/**
 * Devuelve el `rawToken` UNA sola vez (mostrarlo en la hoja de accesos). Nunca se persiste en el cliente:
 * ni en storage ni en la MutationCache. Las variables y el contexto (`{ scope }`) nunca contienen el token; el
 * resultado (`state.data`) sí, así que `mutateAsync` retira la mutación de la caché en cuanto termina, ANTES de
 * entregar el resultado al llamador. Garantía: tras resolverse `mutateAsync`, la caché no conserva el token.
 * Un suscriptor síncrono de la MutationCache todavía puede leerlo durante el evento `success`; no registrar
 * suscriptores que lean `state.data` de esta mutación. `gcTime: 0` cubre cualquier otra vía (p. ej. `mutate`).
 */
export function useAssignParticipant(sessionId: number) {
  const qc = useQueryClient();
  const mutation = useMutation({
    gcTime: 0,
    onMutate: scoped.onMutate,
    mutationFn: ({ participantId, ttlHours, signal, canSend }: AssignParticipantVariables, ctx) => {
      scoped.guard(ctx);
      // Una mutación pausada (sin conexión) que se reanuda tras abortar el lote no debe enviar el POST.
      // La señal solo se comprueba ANTES de enviar: una petición ya enviada nunca se aborta (su token es único).
      if (signal?.aborted || (canSend !== undefined && !canSend())) {
        throw new ApiError({ status: 0, code: "CANCELED", message: "La solicitud fue cancelada." });
      }
      return assignParticipant(sessionId, { participantId, ttlHours });
    },
    onSettled: (_data, _error, _vars, context) => {
      if (isScopeCurrent(context)) void qc.invalidateQueries({ queryKey: sessionKeys.assignments(sessionId) });
    },
  });

  const { mutateAsync: rawMutateAsync } = mutation;
  const mutateAsync = useCallback(
    async (variables: AssignParticipantVariables) => {
      try {
        return await rawMutateAsync(variables);
      } finally {
        // Se identifica la mutación por la identidad del objeto de variables (TanStack lo guarda tal cual).
        const cache = qc.getMutationCache();
        for (const m of cache.getAll()) {
          if (m.state.variables === variables) cache.remove(m);
        }
      }
    },
    [rawMutateAsync, qc],
  );

  return { ...mutation, mutateAsync };
}

export function useRevokeAssignment(sessionId: number) {
  const qc = useQueryClient();
  return useMutation({
    onMutate: scoped.onMutate,
    mutationFn: (assignmentId: number, ctx) => {
      scoped.guard(ctx);
      return revokeAssignment(sessionId, assignmentId);
    },
    onSettled: (_data, _error, _vars, context) => {
      if (isScopeCurrent(context)) void qc.invalidateQueries({ queryKey: sessionKeys.assignments(sessionId) });
    },
  });
}

export function useRecordIncidence(sessionId: number) {
  return useMutation({
    onMutate: scoped.onMutate,
    mutationFn: (input: RecordIncidenceRequest, ctx) => {
      scoped.guard(ctx);
      return recordIncidence(sessionId, input);
    },
  });
}
