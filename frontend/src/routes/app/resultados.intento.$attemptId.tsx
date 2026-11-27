import { createFileRoute } from "@tanstack/react-router";
import { AttemptDetailPage } from "../../features/results/detail/AttemptDetailPage";

export const Route = createFileRoute("/app/resultados/intento/$attemptId")({
  component: AttemptDetailRoute,
});

function AttemptDetailRoute() {
  const { attemptId } = Route.useParams();
  return <AttemptDetailPage key={attemptId} attemptId={attemptId} />;
}
