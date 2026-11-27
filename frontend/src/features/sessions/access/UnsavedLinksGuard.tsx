import { useEffect, useRef, type MutableRefObject, type ReactNode } from "react";
import { useBlocker } from "@tanstack/react-router";
import { ConfirmDialog } from "../../../app/components/ui/confirm-dialog";
import { UNEXPORTED_LINKS_DESCRIPTION } from "./exportTracker";

const IN_FLIGHT_NOTICE = "Todavía se espera un enlace: hay una asignación en curso cuyo token llegará en unos instantes.";

interface UnsavedLinksGuard {
  /** Renderizar en el árbol del componente: ConfirmDialog que aparece cuando se bloquea una navegación. */
  dialog: ReactNode;
  /** Poner en `true` justo antes de navegar tras una confirmación propia para no pedirla dos veces. */
  bypassRef: MutableRefObject<boolean>;
}

/**
 * Bloquea la navegación (breadcrumb, menú lateral, Atrás del navegador) y el cierre/recarga de la pestaña
 * mientras `pendingCount > 0` enlaces emitidos no se hayan exportado. Con `inFlight` (peticiones de asignación
 * en vuelo) el diálogo de salida avisa de que aún se espera un enlace.
 */
export function useUnsavedLinksGuard(pendingCount: number, inFlight = false): UnsavedLinksGuard {
  const pendingRef = useRef(pendingCount);
  const bypassRef = useRef(false);
  const proceedingRef = useRef(false);

  useEffect(() => {
    pendingRef.current = pendingCount;
  }, [pendingCount]);

  const blocker = useBlocker({
    shouldBlockFn: ({ current, next }) =>
      !bypassRef.current && pendingRef.current > 0 && current.pathname !== next.pathname,
    enableBeforeUnload: () => !bypassRef.current && pendingRef.current > 0,
    withResolver: true,
  });

  useEffect(() => {
    if (blocker.status === "idle") proceedingRef.current = false;
  }, [blocker.status]);

  const dialog = (
    <ConfirmDialog
      open={blocker.status === "blocked"}
      onOpenChange={(open) => {
        if (!open && blocker.status === "blocked" && !proceedingRef.current) blocker.reset();
      }}
      tone="danger"
      title="Salir sin exportar los enlaces"
      description={inFlight ? `${IN_FLIGHT_NOTICE} ${UNEXPORTED_LINKS_DESCRIPTION}` : UNEXPORTED_LINKS_DESCRIPTION}
      confirmLabel="Salir sin exportar"
      cancelLabel="Quedarme aquí"
      onConfirm={() => {
        if (blocker.status !== "blocked") return;
        proceedingRef.current = true;
        blocker.proceed();
      }}
    />
  );

  return { dialog, bypassRef };
}
