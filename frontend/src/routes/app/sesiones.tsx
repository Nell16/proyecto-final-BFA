import { createFileRoute, Outlet } from "@tanstack/react-router";
import { requireRoutePermission } from "../../store/routePermissions";

export const Route = createFileRoute("/app/sesiones")({
  beforeLoad: requireRoutePermission("/app/sesiones"),
  component: () => <Outlet />,
});
