import type { Participant } from "../../../api/schemas/academic";

export interface ParticipantFilters {
  search: string;
  careerId: string;
  cohortId: string;
  groupId: string;
}

export const EMPTY_FILTERS: ParticipantFilters = { search: "", careerId: "", cohortId: "", groupId: "" };

export const hasActiveFilters = (f: ParticipantFilters): boolean =>
  f.search.trim() !== "" || f.careerId !== "" || f.cohortId !== "" || f.groupId !== "";

const normalize = (text: string): string =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** Filtra en cliente (el backend aún no pagina ni filtra: B10). Solo participantes activos. */
export function filterParticipants(participants: readonly Participant[], filters: ParticipantFilters): Participant[] {
  const query = normalize(filters.search.trim());
  return participants.filter((p) => {
    if (p.status !== "ACTIVO") return false;
    if (filters.careerId !== "" && String(p.career?.id ?? "") !== filters.careerId) return false;
    if (filters.cohortId !== "" && String(p.cohort?.id ?? "") !== filters.cohortId) return false;
    if (filters.groupId !== "" && String(p.group?.id ?? "") !== filters.groupId) return false;
    if (query === "") return true;
    return normalize(p.fullName).includes(query) || normalize(p.code).includes(query);
  });
}
