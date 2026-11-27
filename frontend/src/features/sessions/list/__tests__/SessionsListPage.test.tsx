import { afterEach, describe, expect, it } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";

import sessionsFixture from "../../../../api/schemas/__fixtures__/sessions/sessions.json";
import { SessionSchema } from "../../../../api/schemas/sessions";
import { PERMISSIONS } from "../../../../store/permissions";
import { useStaffAuth } from "../../../../store/staffAuth";
import { server } from "../../../../test/msw/server";
import { SessionsListPage, filterSessions } from "../SessionsListPage";

const API = "http://localhost:8080";
const sessions = sessionsFixture.map((s) => SessionSchema.parse(s));

describe("filterSessions", () => {
  it("filtra por rango de fecha programada (inclusive) y por versión", () => {
    const withDates = [
      { ...sessions[0], id: 1, scheduledStart: "2026-11-24T09:00:00", versionTestId: 10 },
      { ...sessions[0], id: 2, scheduledStart: "2026-11-26T09:00:00", versionTestId: 11 },
      { ...sessions[0], id: 3, scheduledStart: "2026-11-28T09:00:00", versionTestId: 10 },
    ];
    expect(filterSessions(withDates, "", "ALL", { from: "2026-11-25" }).map((s) => s.id)).toEqual([2, 3]);
    expect(filterSessions(withDates, "", "ALL", { to: "2026-11-26" }).map((s) => s.id)).toEqual([1, 2]);
    expect(filterSessions(withDates, "", "ALL", { from: "2026-11-24", to: "2026-11-24" }).map((s) => s.id)).toEqual([1]);
    expect(filterSessions(withDates, "", "ALL", { versionId: 10 }).map((s) => s.id)).toEqual([1, 3]);
    expect(filterSessions(withDates, "", "ALL").map((s) => s.id)).toEqual([1, 2, 3]);
  });
});

async function renderList() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute({ component: SessionsListPage });
  const router = createRouter({ routeTree: rootRoute, history: createMemoryHistory({ initialEntries: ["/"] }) });
  await router.load();
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe("SessionsListPage", () => {
  afterEach(() => useStaffAuth.setState({ user: null }));

  it("ofrece Reanudar configuración solo para PROGRAMADA y con SESION_CREAR; siempre Ver detalle", async () => {
    useStaffAuth.setState({
      user: { id: "u", username: "u", roles: [], permissions: [PERMISSIONS.SESION_CREAR] },
    });
    server.use(http.get(`${API}/sesiones`, () => HttpResponse.json({ success: true, data: sessionsFixture, message: "OK", error: null })));
    await renderList();
    await screen.findByText("Evaluación Ingreso 2026");

    const resume = screen.getAllByRole("link", { name: /reanudar configuración de/i });
    expect(resume).toHaveLength(sessions.filter((s) => s.status === "PROGRAMADA").length);
    expect(resume[0].getAttribute("href")).toContain("sessionId=1");
    expect(screen.getAllByRole("link", { name: /ver detalle de/i })).toHaveLength(sessions.length);
  });

  it("sin SESION_CREAR no ofrece reanudar y el filtro de fecha puede vaciar la lista", async () => {
    useStaffAuth.setState({ user: { id: "u", username: "u", roles: [], permissions: [] } });
    server.use(http.get(`${API}/sesiones`, () => HttpResponse.json({ success: true, data: sessionsFixture, message: "OK", error: null })));
    await renderList();
    await screen.findByText("Evaluación Ingreso 2026");
    expect(screen.queryByRole("link", { name: /reanudar configuración/i })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Programada desde"), { target: { value: "2030-01-01" } });
    await waitFor(() => expect(screen.getByText("Sin resultados para este filtro")).toBeInTheDocument());
  });
});
