import { createFileRoute } from "@tanstack/react-router";
import { DashboardPage } from "../../features/dashboard/components/DashboardPage";
import { requireRoutePermission } from "../../store/routePermissions";

export const Route = createFileRoute("/app/dashboard")({
  beforeLoad: requireRoutePermission("/app/dashboard"),
  component: DashboardRoute,
});

function DashboardRoute() {
  return <DashboardPage />;
}
