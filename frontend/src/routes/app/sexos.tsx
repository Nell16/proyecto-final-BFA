import { createFileRoute } from "@tanstack/react-router";
import { requireRoutePermission } from "../../store/routePermissions";
import { CatalogPage } from "../../features/catalogs/components/catalog-page";
import { SEX_CATALOG } from "../../features/catalogs/definitions";

export const Route = createFileRoute("/app/sexos")({
  beforeLoad: requireRoutePermission("/app/sexos"),
  component: () => <CatalogPage definition={SEX_CATALOG} />,
});
