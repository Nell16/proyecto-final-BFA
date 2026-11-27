import { createFileRoute } from "@tanstack/react-router";
import { SessionAccessTab } from "../../features/sessions/detail/SessionAccessTab";

export const Route = createFileRoute("/app/sesiones/$id/asignaciones")({
  component: SessionAccessRoute,
});

function SessionAccessRoute() {
  const { id } = Route.useParams();
  return <SessionAccessTab sessionId={Number(id)} />;
}
