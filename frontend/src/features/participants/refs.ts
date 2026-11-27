import type { Participant } from "../../api/schemas/academic";

export interface ParticipantCatalogIds {
  sex?: number;
  career?: number;
  cohort?: number;
  group?: number;
}

/** Ids de catálogo de un participante (planos o anidados según el endpoint). */
export function participantCatalogIds(participant: Participant): ParticipantCatalogIds {
  return {
    sex: participant.sexId,
    career: participant.careerId,
    cohort: participant.cohortId,
    group: participant.groupId,
  };
}
