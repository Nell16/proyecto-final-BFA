import { createFileRoute } from "@tanstack/react-router";
import { ReportsPage } from "../../features/reports/components/ReportsPage";
import { requireRoutePermission } from "../../store/routePermissions";

export const Route = createFileRoute("/app/reportes")({
  beforeLoad: requireRoutePermission("/app/reportes"),
  component: ReportsRoute,
});

function ReportsRoute() {
  return <ReportsPage />;
}
