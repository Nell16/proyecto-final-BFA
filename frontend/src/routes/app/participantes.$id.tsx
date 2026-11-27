import { createFileRoute } from "@tanstack/react-router";
import { ParticipantDetailPage } from "../../features/participants/components/participant-detail-page";

export const Route = createFileRoute("/app/participantes/$id")({
  component: ParticipantDetailRoute,
});

function ParticipantDetailRoute() {
  const { id } = Route.useParams();
  return <ParticipantDetailPage id={id} />;
}
