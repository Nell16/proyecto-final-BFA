import { describe, expect, it } from "vitest";
import { PERMISSIONS } from "../store/permissions";
import { ROUTE_PERMISSIONS } from "../store/routePermissions";
import { NAV_GROUPS, visibleNavItems } from "./navigation";

const allItems = NAV_GROUPS.flatMap((g) => g.items);
const hasAny = (granted: string[]) => (required: readonly string[]) => required.some((p) => granted.includes(p));
const visibleFor = (granted: string[]) =>
  NAV_GROUPS.flatMap((g) => visibleNavItems(g.items, hasAny(granted))).map((i) => i.to);

describe("menú lateral — «Revisión manual» (sugerencia 6a)", () => {
  it("existe en el grupo Resultados con los mismos permisos que su ruta", () => {
    const group = NAV_GROUPS.find((g) => g.group === "Resultados");
    const item = group?.items.find((i) => i.to === "/app/revision-manual");
    expect(item?.label).toBe("Revisión manual");
    expect(item?.permissions).toEqual(ROUTE_PERMISSIONS["/app/revision-manual"]);
    expect([...(item?.permissions ?? [])].sort()).toEqual(
      [PERMISSIONS.CALIFICACION_EJECUTAR, PERMISSIONS.RESULTADO_VER].sort(),
    );
  });

  it("se muestra con CALIFICACION_EJECUTAR o con RESULTADO_VER, y se oculta sin ninguno", () => {
    expect(visibleFor([PERMISSIONS.CALIFICACION_EJECUTAR])).toContain("/app/revision-manual");
    expect(visibleFor([PERMISSIONS.RESULTADO_VER])).toContain("/app/revision-manual");
    expect(visibleFor([PERMISSIONS.SESION_APLICAR])).not.toContain("/app/revision-manual");
  });

  it("toda entrada del menú usa exactamente los permisos de su ruta", () => {
    for (const item of allItems) {
      expect(item.permissions, item.to).toEqual(ROUTE_PERMISSIONS[item.to as keyof typeof ROUTE_PERMISSIONS]);
    }
  });
});
