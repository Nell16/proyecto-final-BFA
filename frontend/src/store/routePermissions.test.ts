import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PERMISSIONS } from "./permissions";
import { ROUTE_PERMISSIONS } from "./routePermissions";

const ROUTES_DIR = path.resolve(__dirname, "../routes/app");
// Rutas de primer nivel (sin puntos en el nombre): las hijas heredan el guard del layout padre,
// salvo que el mapa declare una clave propia para ellas.
// Las rutas retiradas que solo redirigen (sin pantalla propia) no tienen permiso: lo aplica el destino.
const REDIRECT_ONLY = ["carga-imagenes"];
const topLevel = readdirSync(ROUTES_DIR)
  .filter((f) => f.endsWith(".tsx") && !f.slice(0, -4).includes("."))
  .map((f) => f.slice(0, -4))
  .filter((name) => !REDIRECT_ONLY.includes(name));

/** `/app/sesiones/nueva` -> `sesiones.nueva.tsx` (convención de archivos de TanStack Router). */
const routeFile = (route: string): string => `${route.slice("/app/".length).replaceAll("/", ".")}.tsx`;

const mapKeys = Object.keys(ROUTE_PERMISSIONS);
const declaredChildren = mapKeys.filter((key) => key.slice("/app/".length).includes("/"));

describe("ROUTE_PERMISSIONS", () => {
  it("toda ruta /app/* de primer nivel está en el mapa", () => {
    for (const name of topLevel) expect(ROUTE_PERMISSIONS).toHaveProperty([`/app/${name}`]);
  });

  it("toda ruta /app/* de primer nivel aplica requireRoutePermission con su propia clave", () => {
    for (const name of topLevel) {
      const source = readFileSync(path.join(ROUTES_DIR, `${name}.tsx`), "utf8");
      expect(source, name).toContain(`beforeLoad: requireRoutePermission("/app/${name}")`);
    }
  });

  it("hay rutas hijas declaradas en el mapa (si no, este test no cubre nada)", () => {
    expect(declaredChildren).toContain("/app/sesiones/nueva");
  });

  it("toda clave del mapa (también las hijas) tiene su archivo de ruta con ese path y su propio guard", () => {
    for (const route of mapKeys) {
      const file = path.join(ROUTES_DIR, routeFile(route));
      expect(existsSync(file), `${route} -> ${routeFile(route)}`).toBe(true);
      const source = readFileSync(file, "utf8");
      expect(source, route).toContain(`createFileRoute("${route}")`);
      expect(source, route).toContain(`beforeLoad: requireRoutePermission("${route}")`);
    }
  });

  it("las rutas retiradas redirigen a /app/instrumentos y no declaran permiso propio", () => {
    for (const name of REDIRECT_ONLY) {
      expect(ROUTE_PERMISSIONS).not.toHaveProperty([`/app/${name}`]);
      const source = readFileSync(path.join(ROUTES_DIR, `${name}.tsx`), "utf8");
      expect(source, name).toContain('redirect({ to: "/app/instrumentos" })');
    }
  });

  it("permisos asignados: crear sesión exige SESION_CREAR", () => {
    expect(ROUTE_PERMISSIONS["/app/sesiones/nueva"]).toEqual([PERMISSIONS.SESION_CREAR]);
  });
});
