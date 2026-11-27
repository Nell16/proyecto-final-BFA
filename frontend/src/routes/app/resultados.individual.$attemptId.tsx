import { createFileRoute } from "@tanstack/react-router";
import { IndividualResultPage } from "../../features/results/individual/IndividualResultPage";

export const Route = createFileRoute("/app/resultados/individual/$attemptId")({
  component: IndividualResultRoute,
});

function IndividualResultRoute() {
  const { attemptId } = Route.useParams();
  return <IndividualResultPage key={attemptId} attemptId={attemptId} />;
}
