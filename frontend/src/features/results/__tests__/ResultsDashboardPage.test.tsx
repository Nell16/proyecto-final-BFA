import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { http } from "msw";
import { fireEvent, screen, waitFor } from "@testing-library/react";

import overviewFixture from "../../../api/schemas/__fixtures__/results/dashboard-overview.json";
import { server } from "../../../test/msw/server";
import { ResultsDashboardPage } from "../dashboard/ResultsDashboardPage";
import type { SessionSearch } from "../gradingSearch";
import { API, clearStaff, fail, ok, renderWithProviders, sessionWire, setPermissions } from "./testSupport";

function Harness({ initial = {} }: { initial?: SessionSearch }) {
  const [search, setSearch] = useState(initial);
  return <ResultsDashboardPage search={search} onSessionChange={(sessionId) => setSearch({ sessionId })} />;
}

afterEach(() => clearStaff());

const analytics = [
  { dimensionId: 5, name: "Somática", count: 12, averageDirectScore: 10.5, suppressedByPrivacyThreshold: false },
  { dimensionId: 6, name: "Cognitiva", count: 3, averageDirectScore: null, suppressedByPrivacyThreshold: true },
];

function handlers(seen: { overview: string[]; analytics: string[] } = { overview: [], analytics: [] }) {
  server.use(
    http.get(`${API}/sesiones`, () => ok([sessionWire(1, "Cohorte A"), sessionWire(2, "Cohorte B")])),
    http.get(`${API}/dashboard/overview`, ({ request }) => {
      seen.overview.push(new URL(request.url).searchParams.get("sessionId") ?? "");
      return ok({ ...overviewFixture, sessionId: Number(new URL(request.url).searchParams.get("sessionId")) });
    }),
    http.get(`${API}/analytics/results`, ({ request }) => {
      seen.analytics.push(new URL(request.url).searchParams.get("sessionId") ?? "");
      return ok(analytics);
    }),
  );
  return seen;
}

describe("ResultsDashboardPage", () => {
  it("con lista de sesiones: usa /dashboard/overview y /analytics/results de la sesión más reciente", async () => {
    setPermissions(["SESION_APLICAR", "RESULTADO_AGREGADO_VER"]);
    const seen = handlers();
    await renderWithProviders(<Harness />);

    const summary = await screen.findByRole("region", { name: "Resumen de la sesión" });
    expect(summary).toHaveTextContent("Asignados");
    expect(summary).toHaveTextContent("30");
    expect(summary).toHaveTextContent("73% de los asignados"); // 22/30 completados
    expect(seen.overview).toEqual(["2"]);
    expect(seen.analytics).toEqual(["2"]);

    const table = await screen.findByRole("table", { name: /promedio de puntaje directo/i });
    expect(table).toHaveTextContent("Somática");
    expect(table).toHaveTextContent("10.5");
    expect(table).toHaveTextContent("Reservado"); // umbral de privacidad: no se muestra 0 ni el valor
    expect(screen.getByText("Datos reservados por privacidad")).toBeInTheDocument();
  });

  it("cambiar de sesión consulta los agregados de la nueva sesión", async () => {
    setPermissions(["SESION_APLICAR", "RESULTADO_AGREGADO_VER"]);
    const seen = handlers();
    await renderWithProviders(<Harness initial={{ sessionId: 1 }} />);
    await screen.findByRole("table", { name: /promedio/i });
    expect(seen.overview).toEqual(["1"]);
    fireEvent.change(screen.getByLabelText("Sesión"), { target: { value: "2" } });
    await waitFor(() => expect(seen.overview).toEqual(["1", "2"]));
  });

  it("consultor sin lectura de sesiones: pide el número de sesión con validación y consulta esa sesión", async () => {
    setPermissions(["RESULTADO_AGREGADO_VER"]);
    const seen = handlers();
    await renderWithProviders(<Harness />);

    expect(await screen.findByText("Elige una sesión")).toBeInTheDocument();
    expect(screen.queryByLabelText("Sesión")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Número de sesión"), { target: { value: "abc" } });
    fireEvent.click(screen.getByRole("button", { name: "Consultar" }));
    expect(await screen.findByText(/entero positivo/i)).toBeInTheDocument();
    expect(seen.overview).toEqual([]);

    fireEvent.change(screen.getByLabelText("Número de sesión"), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "Consultar" }));
    await screen.findByRole("region", { name: "Resumen de la sesión" });
    expect(seen.overview).toEqual(["7"]);
    expect(seen.analytics).toEqual(["7"]);
  });

  it("error en el resumen o en los promedios: cada bloque muestra su error con Reintentar", async () => {
    setPermissions(["SESION_APLICAR", "RESULTADO_AGREGADO_VER"]);
    let broken = true;
    server.use(
      http.get(`${API}/sesiones`, () => ok([sessionWire(1)])),
      http.get(`${API}/dashboard/overview`, () => (broken ? fail(500, "Resumen no disponible") : ok(overviewFixture))),
      http.get(`${API}/analytics/results`, () => ok([])),
    );
    await renderWithProviders(<Harness />);
    expect(await screen.findByText("No se pudo cargar el resumen")).toBeInTheDocument();
    expect(await screen.findByText("Sin datos agregados")).toBeInTheDocument();
    broken = false;
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("region", { name: "Resumen de la sesión" })).toBeInTheDocument();
  });

  it("error al listar sesiones y sesión pedida inexistente", async () => {
    setPermissions(["SESION_APLICAR", "RESULTADO_VER"]);
    let broken = true;
    handlers();
    server.use(http.get(`${API}/sesiones`, () => (broken ? fail(500, "Sin sesiones") : ok([sessionWire(1, "Cohorte A")]))));
    await renderWithProviders(<Harness initial={{ sessionId: 99 }} />);
    expect(await screen.findByText("No se pudo cargar la lista de sesiones")).toBeInTheDocument();
    broken = false;
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Sesión no encontrada")).toBeInTheDocument();
    expect(screen.getByLabelText("Sesión")).toHaveValue("1");
  });
});
