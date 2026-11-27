import { createFileRoute } from "@tanstack/react-router";
import { SessionIncidencesTab } from "../../features/sessions/detail/SessionIncidencesTab";

export const Route = createFileRoute("/app/sesiones/$id/incidencias")({
  component: SessionIncidencesRoute,
});

function SessionIncidencesRoute() {
  const { id } = Route.useParams();
  return <SessionIncidencesTab sessionId={Number(id)} />;
}
