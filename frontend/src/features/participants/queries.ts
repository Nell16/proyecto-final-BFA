import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import { getParticipant, listParticipants, type ListParticipantsParams } from "../../api/endpoints/academic";

export const PARTICIPANT_PAGE_SIZE = 20;

export const participantKeys = {
  all: ["participants"] as const,
  lists: () => [...participantKeys.all, "list"] as const,
  list: (params: Required<ListParticipantsParams>) => [...participantKeys.lists(), params] as const,
  details: () => [...participantKeys.all, "detail"] as const,
  detail: (id: string) => [...participantKeys.details(), id] as const,
};

/**
 * Página del servidor (`GET /participantes?page&size`, `page` base 0). El endpoint no admite
 * búsqueda ni filtros: solo paginación.
 */
export const participantListQuery = (params: ListParticipantsParams = {}) => {
  const normalized = { page: params.page ?? 0, size: params.size ?? PARTICIPANT_PAGE_SIZE };
  return queryOptions({
    queryKey: participantKeys.list(normalized),
    queryFn: () => listParticipants(normalized),
    placeholderData: keepPreviousData,
  });
};

export const participantDetailQuery = (id: string) =>
  queryOptions({ queryKey: participantKeys.detail(id), queryFn: () => getParticipant(id) });
