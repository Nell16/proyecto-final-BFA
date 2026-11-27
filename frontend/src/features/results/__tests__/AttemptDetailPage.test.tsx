import { afterEach, describe, expect, it } from "vitest";
import { http } from "msw";
import { fireEvent, screen } from "@testing-library/react";

import detailedFixture from "../../../api/schemas/__fixtures__/results/detailed-result.json";
import { server } from "../../../test/msw/server";
import { AttemptDetailPage } from "../detail/AttemptDetailPage";
import { API, clearStaff, fail, ok, renderWithProviders, setPermissions } from "./testSupport";

afterEach(() => clearStaff());

describe("AttemptDetailPage", () => {
  it("muestra datos, métricas, calificación global y las opciones con selección y clave en texto", async () => {
    setPermissions(["RESULTADO_VER"]);
    server.use(http.get(`${API}/attempts/42/detailed-result`, () => ok(detailedFixture)));
    await renderWithProviders(<AttemptDetailPage attemptId="42" />);

    expect(await screen.findByText("María López")).toBeInTheDocument();
    expect(screen.getByText("Completado")).toBeInTheDocument();
    expect(screen.getByText("18 min 30 s")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Calificación global" })).toHaveTextContent("18 pts");

    const options = screen.getByRole("list", { name: "Opciones del ítem 1" });
    expect(options).toHaveTextContent("Frecuentemente");
    expect(options.querySelector('[data-selected="true"]')).toHaveTextContent("Seleccionada");
    expect(options).toHaveTextContent("Correcta"); // intento completado: se muestra la clave
    expect(screen.getByText("Correcto (2 pts)")).toBeInTheDocument();
  });

  it("intento sin calificación: aviso informativo", async () => {
    setPermissions(["RESULTADO_VER"]);
    server.use(
      http.get(`${API}/attempts/42/detailed-result`, () =>
        ok({ ...detailedFixture, resultId: null, totalScore: null, scoredAt: null, correctCount: null, incorrectCount: null, pendingReviewCount: null, requiresManualReview: null }),
      ),
    );
    await renderWithProviders(<AttemptDetailPage attemptId="42" />);
    expect(await screen.findByText("Intento sin calificación")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Calificación global" })).not.toBeInTheDocument();
  });

  it("requiere revisión: el enlace a la bandeja sigue la regla de su ruta (CALIFICACION_EJECUTAR o RESULTADO_VER)", async () => {
    server.use(
      http.get(`${API}/attempts/42/detailed-result`, () => ok({ ...detailedFixture, requiresManualReview: true, pendingReviewCount: 1 })),
    );
    for (const permissions of [["RESULTADO_VER"], ["CALIFICACION_EJECUTAR"], ["RESULTADO_VER", "CALIFICACION_EJECUTAR"]]) {
      setPermissions(permissions);
      const view = await renderWithProviders(<AttemptDetailPage attemptId="42" />);
      expect(await screen.findByRole("link", { name: /ir a revisión manual/i }), permissions.join("+")).toBeInTheDocument();
      view.unmount();
    }

    // Sin ninguno de los dos permisos de la ruta, el enlace no se ofrece (llevaría a /no-autorizado).
    setPermissions(["SESION_APLICAR"]);
    await renderWithProviders(<AttemptDetailPage attemptId="42" />);
    await screen.findByText("Requiere revisión");
    expect(screen.queryByRole("link", { name: /revisión manual/i })).not.toBeInTheDocument();
  });

  it("requiere revisión: avisa que las revisiones automáticas y el puntaje resuelto dependen del servidor; calificado normal no lo muestra", async () => {
    setPermissions(["RESULTADO_VER"]);
    server.use(
      http.get(`${API}/attempts/42/detailed-result`, () => ok({ ...detailedFixture, requiresManualReview: true, pendingReviewCount: 1 })),
    );
    const view = await renderWithProviders(<AttemptDetailPage attemptId="42" />);
    expect(await screen.findByText("Soporte pendiente en el servidor")).toBeInTheDocument();
    expect(screen.getByText(/servidor todavía no genera las revisiones al calificar/i)).toBeInTheDocument();
    view.unmount();

    server.use(http.get(`${API}/attempts/42/detailed-result`, () => ok({ ...detailedFixture, requiresManualReview: false })));
    await renderWithProviders(<AttemptDetailPage attemptId="42" />);
    await screen.findByText("Calificado");
    expect(screen.queryByText("Soporte pendiente en el servidor")).not.toBeInTheDocument();
  });

  it("404: intento no encontrado; 500: error con Reintentar; id inválido: aviso", async () => {
    setPermissions(["RESULTADO_VER"]);
    server.use(http.get(`${API}/attempts/42/detailed-result`, () => fail(404, "Intento no encontrado: 42")));
    const first = await renderWithProviders(<AttemptDetailPage attemptId="42" />);
    expect(await screen.findByText("Intento no encontrado")).toBeInTheDocument();
    first.unmount();

    let broken = true;
    server.use(http.get(`${API}/attempts/43/detailed-result`, () => (broken ? fail(500, "Fallo") : ok({ ...detailedFixture, attemptId: 43 }))));
    const second = await renderWithProviders(<AttemptDetailPage attemptId="43" />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/fallo/i);
    broken = false;
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("María López")).toBeInTheDocument();
    second.unmount();

    await renderWithProviders(<AttemptDetailPage attemptId="0" />);
    expect(await screen.findByText("Intento no válido")).toBeInTheDocument();
  });
});
