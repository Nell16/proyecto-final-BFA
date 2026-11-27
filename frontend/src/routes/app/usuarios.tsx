import { createFileRoute } from "@tanstack/react-router";
import { UsersPage } from "../../features/admin/components/users-page";
import { requireRoutePermission } from "../../store/routePermissions";

export const Route = createFileRoute("/app/usuarios")({
  beforeLoad: requireRoutePermission("/app/usuarios"),
  component: UsersPage,
});
