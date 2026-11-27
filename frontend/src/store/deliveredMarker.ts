/**
 * Marcador de «evaluación entregada» por asignación (sessionStorage, una clave por asignación, igual que el
 * draft y la sesión del participante). Solo se escribe cuando el servidor confirmó el finalizar del intento;
 * permite mostrar «entregada» (y no un bloqueo genérico) si al recargar el backend responde
 * 409 ASIGNACION_NO_OPERABLE. Todo acceso a storage va en try/catch: sin storage, simplemente no hay marcador.
 */
export const DELIVERED_MARKER_PREFIX = "bfa-runtime-delivered:";

const getStorage = (): Storage | null => {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
};

export const deliveredMarkerKey = (assignmentId: number): string => `${DELIVERED_MARKER_PREFIX}${assignmentId}`;

/** Valores del marcador: "1" = entregada; "1:pendientes" = entregada con respuestas sin confirmar (marcadores antiguos: "1"). */
const MARKER_DELIVERED = "1";
const MARKER_DELIVERED_UNCONFIRMED = "1:pendientes";

export function markDelivered(assignmentId: number, options?: { hadUnconfirmed?: boolean }): void {
  try {
    getStorage()?.setItem(
      deliveredMarkerKey(assignmentId),
      options?.hadUnconfirmed ? MARKER_DELIVERED_UNCONFIRMED : MARKER_DELIVERED,
    );
  } catch {
    // sin storage disponible: no hay marcador
  }
}

export function isDelivered(assignmentId: number | null): boolean {
  if (assignmentId === null) return false;
  try {
    const value = getStorage()?.getItem(deliveredMarkerKey(assignmentId));
    return value === MARKER_DELIVERED || value === MARKER_DELIVERED_UNCONFIRMED;
  } catch {
    return false;
  }
}

/** true si al entregar quedaban respuestas sin confirmar o rechazadas (bandera guardada en el marcador). */
export function deliveredHadUnconfirmed(assignmentId: number | null): boolean {
  if (assignmentId === null) return false;
  try {
    return getStorage()?.getItem(deliveredMarkerKey(assignmentId)) === MARKER_DELIVERED_UNCONFIRMED;
  } catch {
    return false;
  }
}

/** Elimina los marcadores de toda asignación distinta de `keepAssignmentId` (canje de un código de otra asignación). */
export function clearDeliveredMarkersExcept(keepAssignmentId: number | null): void {
  try {
    const storage = getStorage();
    if (!storage) return;
    const keep = keepAssignmentId === null ? null : deliveredMarkerKey(keepAssignmentId);
    const toRemove: string[] = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key?.startsWith(DELIVERED_MARKER_PREFIX) && key !== keep) toRemove.push(key);
    }
    toRemove.forEach((key) => storage.removeItem(key));
  } catch {
    // ignorar
  }
}
