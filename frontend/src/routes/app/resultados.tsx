import { createFileRoute, Outlet } from "@tanstack/react-router";
import { requireRoutePermission } from "../../store/routePermissions";

export const Route = createFileRoute("/app/resultados")({
  beforeLoad: requireRoutePermission("/app/resultados"),
  component: () => <Outlet />,
});
