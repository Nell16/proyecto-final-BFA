import { createFileRoute, Outlet } from "@tanstack/react-router";
import { requireRoutePermission } from "../../store/routePermissions";

export const Route = createFileRoute("/app/participantes")({
  beforeLoad: requireRoutePermission("/app/participantes"),
  component: () => <Outlet />,
});
