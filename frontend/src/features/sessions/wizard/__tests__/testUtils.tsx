import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from "@tanstack/react-router";
import { render } from "@testing-library/react";
import { HttpResponse, http } from "msw";

import { ConfirmProvider } from "../../../../app/components/ui/confirm-dialog";
import { Toaster } from "../../../../app/components/ui/sonner";
import { useStaffAuth } from "../../../../store/staffAuth";
import carrerasFixture from "../../../../api/schemas/__fixtures__/academic/catalog-carreras.json";
import cohortesFixture from "../../../../api/schemas/__fixtures__/academic/catalog-cohortes.json";
import gruposFixture from "../../../../api/schemas/__fixtures__/academic/catalog-grupos-academicos.json";
import subtestsFixture from "../../../../api/schemas/__fixtures__/instruments/subtests.json";
import testsFixture from "../../../../api/schemas/__fixtures__/instruments/tests.json";
import versionsFixture from "../../../../api/schemas/__fixtures__/instruments/versions.json";
import sessionsFixture from "../../../../api/schemas/__fixtures__/sessions/sessions.json";
import { server } from "../../../../test/msw/server";
import { SessionWizardPage, type WizardExitTarget } from "../SessionWizardPage";

export const API = "http://localhost:8080";

// jsdom no implementa matchMedia (lo usa el Toaster/sonner para detectar el tema).
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

export const ok = <T,>(data: T) => HttpResponse.json({ success: true, data, message: "OK", error: null });

export const failure = (status: number, message: string) =>
  HttpResponse.json({ success: false, data: null, message, error: { code: "ERROR", message } }, { status });

export const SESSION_WIRE = sessionsFixture[0];

/** UUID v4 válido y estable por participante (el schema lo exige). */
export const participantId = (n: number): string => `a1b2c3d4-e5f6-4789-abcd-00000000000${n}`;

const participant = (n: number, name: string, careerId: 1 | 2) => ({
  id: participantId(n),
  codigoParticipante: `PART-00${n}`,
  nombres: name,
  apellidos: "Prueba",
  estado: "ACTIVO",
  carrera: carrerasFixture.find((c) => c.id === careerId),
  cohorte: cohortesFixture[0],
  grupoAcademico: gruposFixture[0],
  creadoEn: "2026-02-10T09:15:00",
});

export const PARTICIPANTS_WIRE = [participant(1, "Ana", 1), participant(2, "Beto", 1), participant(3, "Carla", 2)];

export function setStaffPermissions(permissions: string[]): void {
  useStaffAuth.setState({
    user: { id: "u-1", username: "aplicador", roles: ["APLICADOR"], permissions },
  });
}

export function clearStaffUser(): void {
  useStaffAuth.setState({ user: null });
}

/** Handlers de lectura comunes (instrumentos, catálogos, participantes, sesión 1 programada). */
export function mockReadHandlers(options: { assignments?: unknown[] } = {}): void {
  server.use(
    http.get(`${API}/tests`, () => ok(testsFixture)),
    http.get(`${API}/tests/1/versions`, () => ok(versionsFixture)),
    http.get(`${API}/test-versions/10/subtests`, () => ok(subtestsFixture)),
    http.get(`${API}/catalogos/carreras`, () => ok(carrerasFixture)),
    http.get(`${API}/catalogos/cohortes`, () => ok(cohortesFixture)),
    http.get(`${API}/catalogos/grupos-academicos`, () => ok(gruposFixture)),
    http.get(`${API}/participantes`, () =>
      ok({
        content: PARTICIPANTS_WIRE,
        number: 0,
        size: 200,
        numberOfElements: PARTICIPANTS_WIRE.length,
        totalElements: PARTICIPANTS_WIRE.length,
        totalPages: 1,
        first: true,
        last: true,
      }),
    ),
    http.get(`${API}/sesiones/1`, () => ok(SESSION_WIRE)),
    http.get(`${API}/sesiones/1/asignaciones`, () => ok(options.assignments ?? [])),
  );
}

function Host({ initialSessionId, onExit }: { initialSessionId?: number; onExit: (t: WizardExitTarget) => void }) {
  const [sessionId, setSessionId] = useState<number | undefined>(initialSessionId);
  return <SessionWizardPage sessionId={sessionId} onSessionIdChange={setSessionId} onExit={onExit} />;
}

export async function renderWizard(options: { sessionId?: number; onExit?: (t: WizardExitTarget) => void } = {}) {
  const onExit = options.onExit ?? (() => undefined);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const rootRoute = createRootRoute({
    component: () => (
      <ConfirmProvider>
        <Host initialSessionId={options.sessionId} onExit={onExit} />
        <Toaster />
      </ConfirmProvider>
    ),
  });
  const router = createRouter({ routeTree: rootRoute, history: createMemoryHistory({ initialEntries: ["/"] }) });
  await router.load();
  const result = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...result, queryClient, router };
}
