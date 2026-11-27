import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from "@tanstack/react-router";
import { render } from "@testing-library/react";
import { HttpResponse, http } from "msw";

import { Toaster } from "../../../app/components/ui/sonner";
import { useStaffAuth } from "../../../store/staffAuth";
import { server } from "../../../test/msw/server";

export const API = "http://localhost:8080";

export const ok = <T,>(data: T) => HttpResponse.json({ success: true, data, message: "OK", error: null });
export const fail = (status: number, message: string, code = "ERROR") =>
  HttpResponse.json({ success: false, data: null, message, error: { code, message } }, { status });

/** jsdom no implementa matchMedia (lo usa sonner). */
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

export function setPermissions(permissions: string[]): void {
  useStaffAuth.setState({ user: { id: "u-1", username: "psicologo", roles: [], permissions } });
}

export function clearStaff(): void {
  useStaffAuth.getState().clear();
}

export async function renderWithProviders(
  ui: ReactNode,
  options: {
    seed?: (queryClient: QueryClient) => void;
    /** `staleTime` por defecto del QueryClient (producción: 30 s; los tests lo usan para simular su caché). */
    staleTime?: number;
  } = {},
) {
  ensureMatchMedia();
  window.scrollTo = () => {}; // jsdom no lo implementa (lo invoca el router al navegar)
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, ...(options.staleTime !== undefined ? { staleTime: options.staleTime } : {}) },
      mutations: { retry: false },
    },
  });
  options.seed?.(queryClient); // datos de caché previos al montaje (p. ej. de una visita anterior)
  const rootRoute = createRootRoute({
    component: () => (
      <>
        {ui}
        <Toaster />
      </>
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

// ---- datos de prueba (wire del backend) ----

export const sessionWire = (id: number, name = `Sesión ${id}`, start = `2026-11-${String(10 + id).padStart(2, "0")}T09:00:00`) => ({
  id,
  codigoSesion: `SES-${id}`,
  nombreSesion: name,
  estado: "CERRADA",
  inicioProgramado: start,
  versionTestId: 10,
});

export const assignmentWire = (
  assignmentId: number,
  attemptId: number | null,
  name: string,
  state: "no-iniciado" | "en-progreso" | "completado" | "interrumpido" | "anulado" = "completado",
  code: string | null = `P-${assignmentId}`,
) => ({
  assignmentId,
  attemptId,
  participantId: `00000000-0000-0000-0000-${String(assignmentId).padStart(12, "0")}`,
  participantName: name,
  participantCode: code,
  status: "ACTIVO",
  state,
  currentSubtestId: "—",
  overallProgress: state === "completado" ? 100 : 10,
  lastActivity: "2026-11-24T14:20:00",
  tokenExpiraEn: null,
});

export const resultWire = (attemptId: number) => ({
  attemptId,
  resultId: attemptId + 1000,
  status: "CALCULADO",
  totalScore: 18,
  totalInterpretation: null,
  dimensions: [],
  disclaimer: "Aviso.",
});

export const scoreWire = (attemptId: number, pending = 0) => ({
  id: attemptId + 1000,
  intentoId: attemptId,
  estrategiaCalificacionId: 1,
  calculadoEn: "2026-11-24T10:00:00",
  calculadoPorId: null,
  puntajeTotalDirecto: 18,
  cantidadItems: 10,
  cantidadCorrectas: 9,
  cantidadIncorrectas: 1,
  cantidadPendientesRevision: pending,
  requiereRevisionManual: pending > 0,
  estado: "CALCULADO",
});

/** Registra los handlers base: 2 sesiones; la 1 tiene dos completados (9001 calificado, 9002 sin calificar). */
export function useBaseHandlers(overrides: { scored?: Set<number> } = {}) {
  const scored = overrides.scored ?? new Set([9001]);
  const calls = { assignments: [] as string[], result: [] as number[], sessionGet: [] as string[] };
  server.use(
    http.get(`${API}/sesiones`, () => ok([sessionWire(1, "Cohorte A"), sessionWire(2, "Cohorte B")])),
    http.get(`${API}/sesiones/:id`, ({ params }) => {
      calls.sessionGet.push(String(params.id));
      const id = Number(params.id);
      return id === 1 || id === 2 ? ok(sessionWire(id, id === 1 ? "Cohorte A" : "Cohorte B")) : fail(404, "Sesión no encontrada");
    }),
    http.get(`${API}/sesiones/:id/asignaciones`, ({ params }) => {
      calls.assignments.push(String(params.id));
      if (params.id === "1") {
        return ok([
          assignmentWire(1, 9001, "Ana López"),
          assignmentWire(2, 9002, "Bruno Díaz"),
          assignmentWire(3, 9003, "Carla Ruiz", "en-progreso"),
          assignmentWire(4, null, "Diego Paz", "no-iniciado"),
        ]);
      }
      return ok([assignmentWire(5, 9101, "Elena Soto")]);
    }),
    http.get(`${API}/attempts/:id/result`, ({ params }) => {
      const id = Number(params.id);
      calls.result.push(id);
      return scored.has(id) ? ok(resultWire(id)) : fail(404, "Resultado no encontrado");
    }),
  );
  return { calls, scored };
}

export const ALL_RESULT_PERMISSIONS = ["SESION_APLICAR", "RESULTADO_VER", "CALIFICACION_EJECUTAR"];
