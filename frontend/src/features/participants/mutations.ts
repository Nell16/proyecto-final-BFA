import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createParticipant, deleteParticipant } from "../../api/endpoints/academic";
import type { ParticipantInput } from "../../api/schemas/academic";
import { createAccountScopedMutation, isScopeCurrent } from "../accountScopedMutation";
import { participantKeys } from "./queries";

const scoped = createAccountScopedMutation();

export function useCreateParticipant() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: [...participantKeys.all, "create"],
    onMutate: scoped.onMutate,
    mutationFn: (input: ParticipantInput, ctx) => {
      scoped.guard(ctx);
      return createParticipant(input);
    },
    onSuccess: (_data, _vars, context) =>
      isScopeCurrent(context) ? qc.invalidateQueries({ queryKey: participantKeys.lists() }) : undefined,
  });
}

/** `DELETE /participantes/{id}` DESACTIVA al participante (estado INACTIVO); no lo borra. */
export function useDeactivateParticipant() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: [...participantKeys.all, "deactivate"],
    onMutate: scoped.onMutate,
    mutationFn: (id: string, ctx) => {
      scoped.guard(ctx);
      return deleteParticipant(id);
    },
    onSuccess: (_data, id, context) =>
      isScopeCurrent(context)
        ? Promise.all([
            qc.invalidateQueries({ queryKey: participantKeys.lists() }),
            qc.invalidateQueries({ queryKey: participantKeys.detail(id) }),
          ])
        : undefined,
  });
}
