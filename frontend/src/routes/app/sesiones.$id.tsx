import { createFileRoute } from "@tanstack/react-router";
import { SessionDetailLayout } from "../../features/sessions/detail/SessionDetailLayout";

// Layout del detalle: cabecera + pestañas (enlaces) + <Outlet /> para las rutas hijas.
// Lectura SESION_LEER heredada de /app/sesiones; las acciones se protegen por permiso en la UI.
export const Route = createFileRoute("/app/sesiones/$id")({
  component: SessionDetailRoute,
});

function SessionDetailRoute() {
  const { id } = Route.useParams();
  return <SessionDetailLayout sessionId={Number(id)} />;
}
