import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { requireRoutePermission } from "../../store/routePermissions";
import { InstrumentList } from "../../features/instruments/versions/InstrumentList";

export const Route = createFileRoute("/app/instrumentos")({
  beforeLoad: requireRoutePermission("/app/instrumentos"),
  // Equivale a TEST_LEER del backend (TEST_CREAR o TEST_PUBLICAR). Cubre las rutas hijas.
  component: InstrumentosRoute,
});

function InstrumentosRoute() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  if (pathname !== "/app/instrumentos") {
    return <Outlet />;
  }
  return <InstrumentList />;
}
