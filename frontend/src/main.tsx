import { createRoot } from "react-dom/client";
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';
import { setNavigator } from './api/client';
import { queryClient } from './api/queryClient';
import "./styles/index.css";

// El QueryClient es un singleton (api/queryClient): la capa de sesión lo vacía al cambiar de cuenta.

// Crear una instancia de router
const router = createRouter({
  routeTree,
  context: {
    queryClient,
  },
});

// Los interceptores de axios navegan con el router (no con window.location).
setNavigator(
  (options) => router.navigate(options as Parameters<typeof router.navigate>[0]),
  () => router.state.location.href,
);

// Registrar el tipo del router para Type Safety
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <RouterProvider router={router} />
  </QueryClientProvider>
);
