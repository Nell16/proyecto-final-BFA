import { createFileRoute } from "@tanstack/react-router";
import { requireRoutePermission } from "../../store/routePermissions";
import { CatalogPage } from "../../features/catalogs/components/catalog-page";
import { GROUP_CATALOG } from "../../features/catalogs/definitions";

export const Route = createFileRoute("/app/grupos")({
  beforeLoad: requireRoutePermission("/app/grupos"),
  component: () => <CatalogPage definition={GROUP_CATALOG} />,
});
