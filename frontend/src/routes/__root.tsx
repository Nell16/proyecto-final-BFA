import { lazy, Suspense } from "react";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { Toaster } from "../app/components/ui/sonner";
import { ConfirmProvider } from "../app/components/ui/confirm-dialog";

// Las devtools solo existen en desarrollo: en producción ni siquiera se descargan.
const TanStackRouterDevtools = import.meta.env.DEV
  ? lazy(() =>
      import("@tanstack/router-devtools").then((m) => ({ default: m.TanStackRouterDevtools })),
    )
  : null;

const ReactQueryDevtools = import.meta.env.DEV
  ? lazy(() =>
      import("@tanstack/react-query-devtools").then((m) => ({ default: m.ReactQueryDevtools })),
    )
  : null;

export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: () => (
    <ConfirmProvider>
      <Outlet />
      <Toaster richColors closeButton />
      {import.meta.env.DEV && (
        <Suspense fallback={null}>
          {TanStackRouterDevtools && <TanStackRouterDevtools position="bottom-right" />}
          {ReactQueryDevtools && <ReactQueryDevtools buttonPosition="bottom-left" />}
        </Suspense>
      )}
    </ConfirmProvider>
  ),
});
