import { createFileRoute } from "@tanstack/react-router";
import { ParticipantsPage } from "../../features/participants/components/participants-page";

export const Route = createFileRoute("/app/participantes/")({
  component: ParticipantsPage,
});
