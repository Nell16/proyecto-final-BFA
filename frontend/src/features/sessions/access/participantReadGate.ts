import { PERMISSIONS } from "../../../store/permissions";
import { useStaffAuth } from "../../../store/staffAuth";

/** Mismo gate para el detalle (AddParticipantsDialog) y el wizard: sin PARTICIPANTE_LEER no se consulta la lista. */
export const useCanReadParticipants = (): boolean =>
  useStaffAuth((s) => s.user?.permissions.includes(PERMISSIONS.PARTICIPANTE_LEER) ?? false);

export const PARTICIPANT_READ_MISSING_MESSAGE =
  "Tu rol no tiene el permiso PARTICIPANTE_LEER, necesario para elegir participantes desde aquí. Solicítalo al administrador.";
