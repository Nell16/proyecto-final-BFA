import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from "@tanstack/react-router";
import { render } from "@testing-library/react";
import { HttpResponse } from "msw";
import { ConfirmProvider } from "../../../app/components/ui/confirm-dialog";
import { Toaster } from "../../../app/components/ui/sonner";
import { TooltipProvider } from "../../../app/components/ui/tooltip";
import { useStaffAuth } from "../../../store/staffAuth";

export const API = "http://localhost:8080";

/** jsdom no implementa matchMedia (lo usa sonner) ni ResizeObserver/scrollIntoView (Radix/cmdk). */
function ensureBrowserStubs(): void {
  if (typeof window.matchMedia !== "function") {
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
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.releasePointerCapture = () => {};
    Element.prototype.setPointerCapture = () => {};
  }
}

export const ok = <T,>(data: T) => HttpResponse.json({ success: true, data, message: "OK", error: null });

export const forbidden = () =>
  HttpResponse.json(
    { success: false, data: null, message: "Acceso denegado", error: { code: "FORBIDDEN", details: [] } },
    { status: 403 },
  );

export function setStaffPermissions(permissions: string[]): void {
  useStaffAuth.setState({
    user: { id: "u-1", username: "admin", roles: ["ADMINISTRADOR"], permissions },
  });
}

export function clearStaffUser(): void {
  useStaffAuth.setState({ user: null });
}

/** Renderiza `ui` con QueryClient, router en memoria (para `<Link>`), ConfirmProvider y Toaster. */
export async function renderWithProviders(ui: ReactNode) {
  ensureBrowserStubs();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const rootRoute = createRootRoute({
    component: () => (
      <TooltipProvider>
        <ConfirmProvider>
          {ui}
          <Toaster />
        </ConfirmProvider>
      </TooltipProvider>
    ),
  });
  const router = createRouter({ routeTree: rootRoute, history: createMemoryHistory({ initialEntries: ["/"] }) });
  await router.load();
  const result = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}
