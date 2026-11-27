import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from "@tanstack/react-router";
import { render } from "@testing-library/react";
import { HttpResponse } from "msw";

import { ConfirmProvider } from "../../../../app/components/ui/confirm-dialog";
import { Toaster } from "../../../../app/components/ui/sonner";
import { useStaffAuth } from "../../../../store/staffAuth";
import { IncidenceLogProvider } from "../incidenceLog";

export const API = "http://localhost:8080";

/** jsdom no implementa matchMedia (lo usa sonner): stub mínimo. */
function ensureMatchMedia(): void {
  if (typeof window.matchMedia === "function") return;
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

export const ok = <T,>(data: T) => HttpResponse.json({ success: true, data, message: "OK", error: null });

/** Sin zustand-persist de por medio: fija el usuario de staff con los permisos indicados. */
export function setStaffPermissions(permissions: string[]): void {
  useStaffAuth.setState({
    user: { id: "u-1", username: "aplicador", roles: ["APLICADOR"], permissions },
  });
}

export function clearStaffUser(): void {
  useStaffAuth.setState({ user: null });
}

/** Renderiza `ui` con QueryClient, router en memoria (para `<Link>`), ConfirmProvider y Toaster. */
export async function renderWithProviders(ui: ReactNode) {
  ensureMatchMedia();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const rootRoute = createRootRoute({
    component: () => (
      <ConfirmProvider>
        <IncidenceLogProvider>{ui}</IncidenceLogProvider>
        <Toaster />
      </ConfirmProvider>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  const result = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}
