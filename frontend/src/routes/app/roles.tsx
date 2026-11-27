import { createFileRoute } from "@tanstack/react-router";
import { RolesPage } from "../../features/admin/components/roles-page";
import { requireRoutePermission } from "../../store/routePermissions";

export const Route = createFileRoute("/app/roles")({
  beforeLoad: requireRoutePermission("/app/roles"),
  component: RolesPage,
});
