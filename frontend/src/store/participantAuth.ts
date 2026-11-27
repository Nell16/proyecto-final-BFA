import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { clearDeliveredMarkersExcept } from "./deliveredMarker";

interface ParticipantAuthState {
  token: string | null;
  assignmentId: number | null;
  setSession: (session: { token: string; assignmentId: number }) => void;
  clear: () => void;
}

export const PARTICIPANT_AUTH_STORAGE_KEY = "bfa-participant-auth";

/**
 * Sesión del participante: vive en sessionStorage (por pestaña) y en una clave
 * distinta a la del staff, para que nunca se pisen entre sí.
 */
export const useParticipantAuth = create<ParticipantAuthState>()(
  persist(
    (set) => ({
      token: null,
      assignmentId: null,
      setSession: ({ token, assignmentId }) => {
        // Canjear un código de otra asignación descarta el marcador de «entregada» de las demás.
        clearDeliveredMarkersExcept(assignmentId);
        set({ token, assignmentId });
      },
      clear: () => set({ token: null, assignmentId: null }),
    }),
    {
      name: PARTICIPANT_AUTH_STORAGE_KEY,
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({ token: state.token, assignmentId: state.assignmentId }),
    },
  ),
);
