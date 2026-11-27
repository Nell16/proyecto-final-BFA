import { describe, expect, it } from "vitest";
import { PERMISSIONS } from "../../../store/permissions";
import { ROUTE_PERMISSIONS } from "../../../store/routePermissions";

describe("permisos de las rutas de resultados (alineados con los @PreAuthorize del backend)", () => {
  it("calificar exige CALIFICACION_EJECUTAR; resultados exige RESULTADO_VER", () => {
    expect(ROUTE_PERMISSIONS["/app/calificaciones"]).toEqual([PERMISSIONS.CALIFICACION_EJECUTAR]);
    expect(ROUTE_PERMISSIONS["/app/resultados"]).toEqual([PERMISSIONS.RESULTADO_VER]);
  });

  it("la bandeja admite CALIFICACION_EJECUTAR o RESULTADO_VER (GET /manual-review/pending)", () => {
    expect([...ROUTE_PERMISSIONS["/app/revision-manual"]].sort()).toEqual(
      [PERMISSIONS.CALIFICACION_EJECUTAR, PERMISSIONS.RESULTADO_VER].sort(),
    );
  });

  it("el dashboard admite RESULTADO_AGREGADO_VER o RESULTADO_VER (/analytics/results, /dashboard/overview)", () => {
    expect([...ROUTE_PERMISSIONS["/app/dashboard-resultados"]].sort()).toEqual(
      [PERMISSIONS.RESULTADO_AGREGADO_VER, PERMISSIONS.RESULTADO_VER].sort(),
    );
  });
});
