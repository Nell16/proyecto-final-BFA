import { createFileRoute } from "@tanstack/react-router";
import { SessionMonitorTab } from "../../features/sessions/detail/SessionMonitorTab";

export const Route = createFileRoute("/app/sesiones/$id/")({
  component: SessionMonitorRoute,
});

function SessionMonitorRoute() {
  const { id } = Route.useParams();
  return <SessionMonitorTab sessionId={Number(id)} />;
}
