import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";

import { ConfirmProvider } from "../../../../app/components/ui/confirm-dialog";
import { AccessSheetDialog } from "../AccessSheetDialog";
import type { AccessEntry } from "../accessSheet";

import { useStaffAuth } from "../../../../store/staffAuth";
import { PERMISSIONS } from "../../../../store/permissions";
import { server } from "../../../../test/msw/server";
import sessionsFixture from "../../../../api/schemas/__fixtures__/sessions/sessions.json";
import { SessionDetailLayout } from "../SessionDetailLayout";
import { API, clearStaffUser, ok, renderWithProviders, setStaffPermissions } from "./testUtils";

describe("SessionDetailLayout — transiciones", () => {
  let cancelCalls = 0;

  beforeEach(() => {
    cancelCalls = 0;
    setStaffPermissions([PERMISSIONS.SESION_APLICAR]);
    server.use(
      http.get(`${API}/sesiones/1`, () => ok(sessionsFixture[0])),
      http.post(`${API}/sesiones/1/cancelar`, () => {
        cancelCalls += 1;
        return ok({ ...sessionsFixture[0], estado: "CANCELADA" });
      }),
    );
  });
  afterEach(() => clearStaffUser());

  it("Cancelar exige confirmación y no llama al backend hasta confirmar", async () => {
    await renderWithProviders(<SessionDetailLayout sessionId={1} />);

    fireEvent.click(await screen.findByRole("button", { name: /cancelar sesión/i }));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(/irreversible/i);
    expect(cancelCalls).toBe(0);

    // Volver: se cierra sin cancelar.
    fireEvent.click(screen.getByRole("button", { name: /^volver$/i }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(cancelCalls).toBe(0);

    // Confirmar: ahora sí se llama a POST /cancelar.
    fireEvent.click(screen.getByRole("button", { name: /cancelar sesión/i }));
    fireEvent.click(await screen.findByRole("button", { name: /sí, cancelar sesión/i }));
    await waitFor(() => expect(cancelCalls).toBe(1));
  });

  it("sin SESION_APLICAR no se muestran las acciones de transición", async () => {
    setStaffPermissions([PERMISSIONS.SESION_CREAR]); // lectura sin SESION_APLICAR
    await renderWithProviders(<SessionDetailLayout sessionId={1} />);
    expect((await screen.findAllByText("Evaluación Ingreso 2026")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /cancelar sesión/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /abrir sesión/i })).not.toBeInTheDocument();
  });

  it("si cambia la cuenta con la confirmación abierta, el diálogo se cierra y no se envía la cancelación", async () => {
    await renderWithProviders(<SessionDetailLayout sessionId={1} />);
    fireEvent.click(await screen.findByRole("button", { name: /cancelar sesión/i }));
    await screen.findByRole("alertdialog");

    act(() => useStaffAuth.getState().setSession({ token: "otra-cuenta", expiresAt: null }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(cancelCalls).toBe(0);
    useStaffAuth.getState().clear();
  });

  it("un refetch fallido con datos cargados no desmonta la hoja: muestra aviso con reintento", async () => {
    let fail = false;
    server.use(
      http.get(`${API}/sesiones/1`, () =>
        fail ? HttpResponse.json({ success: false, message: "boom" }, { status: 500 }) : ok(sessionsFixture[0]),
      ),
    );
    const { queryClient } = await renderWithProviders(<SessionDetailLayout sessionId={1} />);
    expect((await screen.findAllByText("Evaluación Ingreso 2026")).length).toBeGreaterThan(0);

    fail = true;
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ["sessions"] }).catch(() => undefined);
    });

    expect(await screen.findByTestId("reload-error")).toBeInTheDocument();
    expect(screen.getAllByText("Evaluación Ingreso 2026").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /reintentar/i })).toBeInTheDocument();
  });

  it("con una ruta hija y la hoja de accesos abierta, un refetch fallido no la cierra ni pierde el enlace", async () => {
    let fail = false;
    server.use(
      http.get(`${API}/sesiones/1`, () =>
        fail ? HttpResponse.json({ success: false, message: "boom" }, { status: 500 }) : ok(sessionsFixture[0]),
      ),
    );
    const entries: AccessEntry[] = [
      { assignmentId: 901, participantName: "Ana López", participantCode: "P-0001", rawToken: "tok-a", expiresAt: "2026-11-24T22:00:00" },
    ];
    function Child() {
      const [open, setOpen] = useState<AccessEntry[] | null>(null);
      return (
        <>
          <button type="button" onClick={() => setOpen(entries)}>
            abrir hoja
          </button>
          <AccessSheetDialog
            sessionName="Evaluación Ingreso 2026"
            entries={open}
            exportedIds={new Set()}
            onExported={() => undefined}
            onClose={() => setOpen(null)}
          />
        </>
      );
    }
    const rootRoute = createRootRoute();
    const layoutRoute = createRoute({
      getParentRoute: () => rootRoute,
      id: "detalle",
      component: () => (
        <ConfirmProvider>
          <SessionDetailLayout sessionId={1} />
        </ConfirmProvider>
      ),
    });
    const childRoute = createRoute({ getParentRoute: () => layoutRoute, path: "/", component: Child });
    const router = createRouter({
      routeTree: rootRoute.addChildren([layoutRoute.addChildren([childRoute])]),
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    await router.load();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "abrir hoja" }));
    const link = `${window.location.origin}/evaluacion/901-tok-a`;
    expect(await screen.findByText(link)).toBeInTheDocument();

    fail = true;
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ["sessions"] }).catch(() => undefined);
    });

    expect(await screen.findByTestId("reload-error")).toBeInTheDocument();
    expect(screen.getByText(link)).toBeInTheDocument();
  });
});
