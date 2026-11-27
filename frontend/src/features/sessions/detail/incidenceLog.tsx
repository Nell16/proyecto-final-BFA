import * as React from "react";

export interface LocalIncidence {
  key: string;
  participantId: string;
  participantName: string;
  text: string;
  /** ISO local del momento de registro en esta visita. */
  recordedAt: string;
}

interface IncidenceLogValue {
  entries: LocalIncidence[];
  add: (entry: Omit<LocalIncidence, "key">) => void;
}

const IncidenceLogContext = React.createContext<IncidenceLogValue | null>(null);

/**
 * Bitácora de incidencias registradas en ESTA visita. Vive solo en estado de React (el backend no expone
 * el listado: B3); no se persiste en ningún store ni storage y se pierde al salir del detalle.
 */
export function IncidenceLogProvider({ children }: { children: React.ReactNode }) {
  const [entries, setEntries] = React.useState<LocalIncidence[]>([]);
  const counter = React.useRef(0);
  const add = React.useCallback((entry: Omit<LocalIncidence, "key">) => {
    counter.current += 1;
    const key = `inc-${counter.current}`;
    setEntries((prev) => [{ ...entry, key }, ...prev]);
  }, []);
  const value = React.useMemo(() => ({ entries, add }), [entries, add]);
  return <IncidenceLogContext.Provider value={value}>{children}</IncidenceLogContext.Provider>;
}

export function useIncidenceLog(): IncidenceLogValue {
  const ctx = React.useContext(IncidenceLogContext);
  if (!ctx) throw new Error("useIncidenceLog debe usarse dentro de <IncidenceLogProvider>.");
  return ctx;
}
