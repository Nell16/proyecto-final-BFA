import { createFileRoute } from "@tanstack/react-router";
import { requireRoutePermission } from "../../store/routePermissions";
import { CatalogPage } from "../../features/catalogs/components/catalog-page";
import { COHORT_CATALOG } from "../../features/catalogs/definitions";

export const Route = createFileRoute("/app/cohortes")({
  beforeLoad: requireRoutePermission("/app/cohortes"),
  component: () => <CatalogPage definition={COHORT_CATALOG} />,
});
