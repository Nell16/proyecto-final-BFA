import { createFileRoute } from "@tanstack/react-router";
import { SessionPausesTab } from "../../features/sessions/detail/SessionPausesTab";

export const Route = createFileRoute("/app/sesiones/$id/pausas")({
  component: SessionPausesRoute,
});

function SessionPausesRoute() {
  const { id } = Route.useParams();
  return <SessionPausesTab sessionId={Number(id)} />;
}
