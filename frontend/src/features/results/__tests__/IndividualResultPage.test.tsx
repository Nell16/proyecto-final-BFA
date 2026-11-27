import { afterEach, describe, expect, it } from "vitest";
import { http } from "msw";
import { fireEvent, screen } from "@testing-library/react";

import attemptResultFixture from "../../../api/schemas/__fixtures__/results/attempt-result.json";
import detailedFixture from "../../../api/schemas/__fixtures__/results/detailed-result.json";
import { server } from "../../../test/msw/server";
import { IndividualResultPage } from "../individual/IndividualResultPage";
import { API, clearStaff, fail, ok, renderWithProviders, setPermissions } from "./testSupport";

afterEach(() => clearStaff());

describe("IndividualResultPage", () => {
  it("muestra participante, interpretación, dimensiones y aviso", async () => {
    setPermissions(["RESULTADO_VER"]);
    server.use(
      http.get(`${API}/attempts/42/result`, () => ok(attemptResultFixture)),
      http.get(`${API}/attempts/42/detailed-result`, () => ok(detailedFixture)),
    );
    await renderWithProviders(<IndividualResultPage attemptId="42" />);

    expect(await screen.findByText("María López")).toBeInTheDocument();
    expect(screen.getByText("Psicología")).toBeInTheDocument();
    expect(screen.getByText("Calculado")).toBeInTheDocument();
    expect(screen.getByText("Baremo BAR-TOT-01")).toBeInTheDocument();
    expect(screen.getByText("Nivel moderado dentro del rango esperado.")).toBeInTheDocument();
    const table = screen.getByRole("table", { name: /puntaje, percentil y categoría por dimensión/i });
    expect(table).toHaveTextContent("Somática");
    expect(screen.getByText("Aviso de uso")).toBeInTheDocument();
  });

  it("el resultado se muestra aunque falle el detalle del participante (con aviso y Reintentar)", async () => {
    setPermissions(["RESULTADO_VER"]);
    server.use(
      http.get(`${API}/attempts/42/result`, () => ok(attemptResultFixture)),
      http.get(`${API}/attempts/42/detailed-result`, () => fail(500, "boom")),
    );
    await renderWithProviders(<IndividualResultPage attemptId="42" />);
    expect(await screen.findByText("No se pudieron cargar los datos del participante")).toBeInTheDocument();
    expect(screen.getByText("Baremo BAR-TOT-01")).toBeInTheDocument();
  });

  it("404 en el resultado: «aún no tiene resultado»; la acción de calificar solo con CALIFICACION_EJECUTAR", async () => {
    setPermissions(["RESULTADO_VER"]);
    server.use(
      http.get(`${API}/attempts/42/result`, () => fail(404, "Resultado no encontrado")),
      http.get(`${API}/attempts/42/detailed-result`, () => ok(detailedFixture)),
    );
    const first = await renderWithProviders(<IndividualResultPage attemptId="42" />);
    expect(await screen.findByText("Este intento aún no tiene resultado")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /ir a calificaciones/i })).not.toBeInTheDocument();
    first.unmount();

    setPermissions(["RESULTADO_VER", "CALIFICACION_EJECUTAR"]);
    await renderWithProviders(<IndividualResultPage attemptId="42" />);
    expect(await screen.findByRole("link", { name: /ir a calificaciones/i })).toBeInTheDocument();
  });

  it("error del servidor: alerta con Reintentar que recupera", async () => {
    setPermissions(["RESULTADO_VER"]);
    let broken = true;
    server.use(
      http.get(`${API}/attempts/42/result`, () => (broken ? fail(500, "Fallo del servidor") : ok(attemptResultFixture))),
      http.get(`${API}/attempts/42/detailed-result`, () => ok(detailedFixture)),
    );
    await renderWithProviders(<IndividualResultPage attemptId="42" />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/fallo del servidor/i);
    broken = false;
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Baremo BAR-TOT-01")).toBeInTheDocument();
  });

  it("identificador inválido: no consulta nada y avisa", async () => {
    setPermissions(["RESULTADO_VER"]);
    await renderWithProviders(<IndividualResultPage attemptId="abc" />);
    expect(await screen.findByText("Intento no válido")).toBeInTheDocument();
  });
});
