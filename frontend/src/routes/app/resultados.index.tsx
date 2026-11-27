import { createFileRoute } from "@tanstack/react-router";
import { sessionSearchSchema } from "../../features/results/gradingSearch";
import { ResultsListPage } from "../../features/results/list/ResultsListPage";

export const Route = createFileRoute("/app/resultados/")({
  validateSearch: sessionSearchSchema,
  component: ResultsRoute,
});

function ResultsRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <ResultsListPage
      search={search}
      onSessionChange={(sessionId) => void navigate({ search: sessionId === undefined ? {} : { sessionId }, replace: true })}
    />
  );
}
