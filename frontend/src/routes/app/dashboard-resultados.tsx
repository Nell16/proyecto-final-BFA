import { createFileRoute } from "@tanstack/react-router";
import { ResultsDashboardPage } from "../../features/results/dashboard/ResultsDashboardPage";
import { sessionSearchSchema } from "../../features/results/gradingSearch";
import { requireRoutePermission } from "../../store/routePermissions";

export const Route = createFileRoute("/app/dashboard-resultados")({
  validateSearch: sessionSearchSchema,
  beforeLoad: requireRoutePermission("/app/dashboard-resultados"),
  component: ResultsDashboardRoute,
});

function ResultsDashboardRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return <ResultsDashboardPage search={search} onSessionChange={(sessionId) => void navigate({ search: { sessionId }, replace: true })} />;
}
