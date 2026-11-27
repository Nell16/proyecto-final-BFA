import { createFileRoute } from "@tanstack/react-router";
import { AuditPage } from "../../features/admin/components/audit-page";
import { requireRoutePermission } from "../../store/routePermissions";

export const Route = createFileRoute("/app/auditoria")({
  beforeLoad: requireRoutePermission("/app/auditoria"),
  component: AuditPage,
});
