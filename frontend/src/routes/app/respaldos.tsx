import { createFileRoute } from "@tanstack/react-router";
import { BackupsPage } from "../../features/backups/components/BackupsPage";
import { requireRoutePermission } from "../../store/routePermissions";

export const Route = createFileRoute("/app/respaldos")({
  beforeLoad: requireRoutePermission("/app/respaldos"),
  component: RespaldosRoute,
});

function RespaldosRoute() {
  return <BackupsPage />;
}
