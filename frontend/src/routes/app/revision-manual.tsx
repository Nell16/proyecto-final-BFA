import { createFileRoute } from "@tanstack/react-router";
import { ReviewTrayPage } from "../../features/results/review/ReviewTrayPage";
import { requireRoutePermission } from "../../store/routePermissions";

export const Route = createFileRoute("/app/revision-manual")({
  beforeLoad: requireRoutePermission("/app/revision-manual"),
  component: ReviewTrayPage,
});
