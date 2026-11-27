import { afterEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import overviewFixture from "../../../api/schemas/__fixtures__/dashboard/overview.json";
import sessionsFixture from "../../../api/schemas/__fixtures__/sessions/sessions.json";
import { useStaffAuth } from "../../../store/staffAuth";
import { server } from "../../../test/msw/server";
import { API, clearStaffUser, ok, renderWithProviders } from "../../participants/__tests__/testUtils";
import { DashboardPage } from "../components/DashboardPage";

function setUser(permissions: string[], username = "admin") {
  useStaffAuth.getState().setSession({
    token: "staff-jwt",
    expiresAt: null,
    user: { id: "u-1", username, roles: ["STAFF"], permissions },
  });
}

describe("DashboardPage", () => {
  afterEach(() => {
    clearStaffUser();
    useStaffAuth.getState().clear();
  });

  it("muestra KPIs de /dashboard/overview cuando el rol tiene RESULTADO_AGREGADO_VER y SESION_APLICAR, y permite reintentar ante error", async () => {
    let overviewCalls = 0;
    server.use(
      http.get(`${API}/sesiones`, () => ok(sessionsFixture)),
      http.get(`${API}/dashboard/overview`, () => {
        overviewCalls += 1;
        if (overviewCalls === 1) {
          return HttpResponse.json(
            { success: false, data: null, error: { code: "ERR", message: "Fallo temporal de resumen" } },
            { status: 500 },
          );
        }
        return ok({ ...overviewFixture, sessionId: 1 });
      }),
    );

    setUser(["RESULTADO_AGREGADO_VER", "SESION_APLICAR", "REPORTE_EXPORTAR"]);

    await renderWithProviders(<DashboardPage />);

    expect(await screen.findByText(/fallo temporal de resumen/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /reintentar/i }));

    expect(await screen.findByText("30")).toBeInTheDocument();
    expect(screen.getByText("25")).toBeInTheDocument();
    expect(screen.getByText("22")).toBeInTheDocument();
    expect(screen.getByText("20")).toBeInTheDocument();

    // Módulos filtrados por permisos
    expect(screen.getByText("Monitor de sesiones")).toBeInTheDocument();
    expect(screen.getByText("Centro de reportes")).toBeInTheDocument();
    expect(screen.queryByText("Usuarios")).not.toBeInTheDocument();
  });

  it("no llama a /sesiones ni a /dashboard/overview si el rol carece de permisos de resultados", async () => {
    let overviewRequested = false;
    let sessionsRequested = false;
    server.use(
      http.get(`${API}/sesiones`, () => {
        sessionsRequested = true;
        return ok(sessionsFixture);
      }),
      http.get(`${API}/dashboard/overview`, () => {
        overviewRequested = true;
        return ok(overviewFixture);
      }),
    );

    setUser(["SESION_CREAR", "PARTICIPANTE_LEER"], "aplicador");

    await renderWithProviders(<DashboardPage />);

    expect(await screen.findByText("Bienvenido, aplicador")).toBeInTheDocument();
    expect(screen.getByText("Monitor de sesiones")).toBeInTheDocument();
    expect(screen.getByText("Participantes")).toBeInTheDocument();
    expect(screen.queryByText(/resumen de evaluación/i)).not.toBeInTheDocument();
    expect(sessionsRequested).toBe(false);
    expect(overviewRequested).toBe(false);
  });

  it("permite consultar /dashboard/overview ingresando sessionId cuando el rol tiene RESULTADO_VER sin SESION_LEER", async () => {
    let sessionsRequested = false;
    server.use(
      http.get(`${API}/sesiones`, () => {
        sessionsRequested = true;
        return ok([]);
      }),
      http.get(`${API}/dashboard/overview`, ({ request }) => {
        const sid = Number(new URL(request.url).searchParams.get("sessionId"));
        return ok({ ...overviewFixture, sessionId: sid });
      }),
    );

    setUser(["RESULTADO_VER"], "psicologo");

    await renderWithProviders(<DashboardPage />);

    expect(await screen.findByText(/indique una sesión para consultar/i)).toBeInTheDocument();
    expect(sessionsRequested).toBe(false);

    fireEvent.change(screen.getByLabelText(/id de sesión/i), { target: { value: "10" } });
    await waitFor(() => expect(screen.getByText("30")).toBeInTheDocument());
  });
});
