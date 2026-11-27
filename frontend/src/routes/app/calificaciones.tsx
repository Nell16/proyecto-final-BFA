import { createFileRoute } from "@tanstack/react-router";
import { GradingPage } from "../../features/results/grading/GradingPage";
import { gradingSearchSchema } from "../../features/results/gradingSearch";
import { requireRoutePermission } from "../../store/routePermissions";

export const Route = createFileRoute("/app/calificaciones")({
  validateSearch: gradingSearchSchema,
  beforeLoad: requireRoutePermission("/app/calificaciones"),
  component: AttemptScoringRoute,
});

function AttemptScoringRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <GradingPage
      search={search}
      // Cambiar de sesión descarta el intento destacado (pertenece a la sesión anterior).
      onSessionChange={(sessionId) => void navigate({ search: { sessionId }, replace: true })}
    />
  );
}
