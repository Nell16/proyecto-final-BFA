import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { render } from "@testing-library/react";
import { HttpResponse } from "msw";
import { ConfirmProvider } from "../../../app/components/ui/confirm-dialog";
import { Toaster } from "../../../app/components/ui/sonner";
import { TooltipProvider } from "../../../app/components/ui/tooltip";
import { useStaffAuth } from "../../../store/staffAuth";

export const API = "http://localhost:8080";

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

export const serverError = (message = "Error interno del servidor") =>
  HttpResponse.json(
    { success: false, data: null, message, error: { code: "INTERNAL_ERROR", message, details: [] } },
    { status: 500 },
  );

export function setStaffUser(options: {
  id?: string;
  username?: string;
  roles?: string[];
  permissions: string[];
  token?: string;
}): void {
  useStaffAuth.setState({
    token: options.token ?? "test-jwt",
    expiresAt: null,
    user: {
      id: options.id ?? "11111111-1111-1111-1111-111111111111",
      username: options.username ?? "admin",
      roles: options.roles ?? ["ADMIN"],
      permissions: options.permissions,
    },
  });
}

export function clearStaffUser(): void {
  useStaffAuth.setState({ token: null, expiresAt: null, user: null });
}

export interface ExtraRoute {
  path: string;
  render: () => ReactNode;
}

export async function renderWithProviders(
  ui: ReactNode,
  options: {
    initialPath?: string;
    extraRoutes?: ExtraRoute[];
  } = {},
) {
  ensureBrowserStubs();
  const initialPath = options.initialPath ?? "/";
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });

  const rootRoute = createRootRoute();
  const mainRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: initialPath,
    component: () => (
      <TooltipProvider>
        <ConfirmProvider>
          {ui}
          <Toaster />
        </ConfirmProvider>
      </TooltipProvider>
    ),
  });

  const extras = (options.extraRoutes ?? []).map((extra) =>
    createRoute({
      getParentRoute: () => rootRoute,
      path: extra.path,
      component: extra.render,
    }),
  );

  const routeTree = rootRoute.addChildren([mainRoute, ...extras]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });
  await router.load();

  const result = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  return { ...result, queryClient, router };
}
