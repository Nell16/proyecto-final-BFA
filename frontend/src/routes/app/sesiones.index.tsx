import { createFileRoute } from "@tanstack/react-router";
import { SessionsListPage } from "../../features/sessions/list/SessionsListPage";

export const Route = createFileRoute("/app/sesiones/")({
  component: SessionsListPage,
});
