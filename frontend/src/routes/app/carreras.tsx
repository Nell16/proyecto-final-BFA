import { createFileRoute } from "@tanstack/react-router";
import { requireRoutePermission } from "../../store/routePermissions";
import { CatalogPage } from "../../features/catalogs/components/catalog-page";
import { CAREER_CATALOG } from "../../features/catalogs/definitions";

export const Route = createFileRoute("/app/carreras")({
  beforeLoad: requireRoutePermission("/app/carreras"),
  component: () => <CatalogPage definition={CAREER_CATALOG} />,
});
