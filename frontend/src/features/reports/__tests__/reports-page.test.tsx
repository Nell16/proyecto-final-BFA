import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { delay, http, HttpResponse } from "msw";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import reportsFixture from "../../../api/schemas/__fixtures__/reports/reports.json";
import sessionsFixture from "../../../api/schemas/__fixtures__/sessions/sessions.json";
import { useStaffAuth } from "../../../store/staffAuth";
import { server } from "../../../test/msw/server";
import { API, clearStaffUser, ok, renderWithProviders } from "../../participants/__tests__/testUtils";
import { reportKeys } from "../queries";
import { ReportsPage } from "../components/ReportsPage";

function setUser(permissions: string[], token = "token-a") {
  useStaffAuth.getState().setSession({
    token,
    expiresAt: null,
    user: { id: "u-1", username: "consultor", roles: ["CONSULTOR"], permissions },
  });
}

describe("ReportsPage", () => {
  beforeEach(() => {
    setUser(["REPORTE_EXPORTAR", "RESULTADO_VER", "SESION_APLICAR"]);
    server.use(
      http.get(`${API}/reports`, () => ok(reportsFixture)),
      http.get(`${API}/sesiones`, () => ok(sessionsFixture)),
    );
  });

  afterEach(() => {
    clearStaffUser();
    useStaffAuth.getState().clear();
  });

  it("oculta las acciones de generación cuando el usuario solo tiene RESULTADO_VER (sin REPORTE_EXPORTAR)", async () => {
    setUser(["RESULTADO_VER"]);

    await renderWithProviders(<ReportsPage />);
    await screen.findByText("/reports/individual-42.pdf");

    expect(screen.getByText(/modo de solo consulta/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /nuevo reporte individual/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /nuevo reporte agregado/i })).not.toBeInTheDocument();
  });

  it("valida formulario individual con RHF + zod y registra un reporte individual", async () => {
    let sentBody: unknown = null;
    server.use(
      http.post(`${API}/reports/individual`, async ({ request }) => {
        sentBody = await request.json();
        return ok({ ...reportsFixture[0], id: 99 });
      }),
    );

    await renderWithProviders(<ReportsPage />);
    await screen.findByText("/reports/individual-42.pdf");

    fireEvent.click(screen.getByRole("button", { name: /nuevo reporte individual/i }));
    const dialog = await screen.findByRole("dialog");

    fireEvent.click(within(dialog).getByRole("button", { name: /generar reporte/i }));
    expect(
      await within(dialog).findByText(/indique al menos un id de intento o un id de resultado/i),
    ).toBeInTheDocument();
    expect(sentBody).toBeNull();

    fireEvent.change(within(dialog).getByLabelText(/id de intento/i), { target: { value: "42" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /generar reporte/i }));

    await waitFor(() => expect(sentBody).not.toBeNull());
    expect(sentBody).toMatchObject({
      type: "INDIVIDUAL",
      format: "PDF",
      storagePath: "/reports/individual.pdf",
      attemptId: 42,
    });
    expect(await screen.findByText(/reporte individual #99 registrado/i)).toBeInTheDocument();
  });

  it("muestra error con reintento cuando falla la carga de reportes", async () => {
    let calls = 0;
    server.use(
      http.get(`${API}/reports`, () => {
        calls += 1;
        if (calls === 1) {
          return HttpResponse.json(
            { success: false, data: null, error: { code: "ERR", message: "Error al listar reportes" } },
            { status: 500 },
          );
        }
        return ok(reportsFixture);
      }),
    );

    await renderWithProviders(<ReportsPage />);
    expect(await screen.findByText(/error al listar reportes/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /reintentar/i }));
    expect(await screen.findByText("/reports/individual-42.pdf")).toBeInTheDocument();
  });

  it("no invalida la caché de reportes si cambia la cuenta durante el envío", async () => {
    let started = false;
    server.use(
      http.post(`${API}/reports/individual`, async () => {
        started = true;
        await delay(120);
        return ok({ ...reportsFixture[0], id: 77 });
      }),
    );

    const { queryClient } = await renderWithProviders(<ReportsPage />);
    await screen.findByText("/reports/individual-42.pdf");

    fireEvent.click(screen.getByRole("button", { name: /nuevo reporte individual/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/id de intento/i), { target: { value: "42" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /generar reporte/i }));

    await waitFor(() => expect(started).toBe(true));

    act(() => {
      setUser(["REPORTE_EXPORTAR"], "token-b");
    });

    await new Promise((resolve) => setTimeout(resolve, 160));
    const queryState = queryClient.getQueryState(reportKeys.list({}));
    expect(queryState?.isInvalidated).toBe(false);
  });
});
