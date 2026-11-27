import type { ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";

import { useStaffAuth } from "../../../../store/staffAuth";
import { server } from "../../../../test/msw/server";
import { NewTestWizardDialog } from "../NewTestWizardDialog";

const API = "http://localhost:8080";

const ok = <T,>(data: T) => ({
  success: true,
  data,
  message: "OK",
  error: null,
  correlationId: "cid-wizard-test",
});

function renderWizard(props: {
  existingTests?: Parameters<typeof NewTestWizardDialog>[0]["existingTests"];
  onClose?: () => void;
} = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = props.onClose ?? vi.fn();
  const rootRoute = createRootRoute();
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => (
      <NewTestWizardDialog existingTests={props.existingTests} onClose={onClose} />
    ),
  });
  const editorRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/app/instrumentos/$versionId",
    component: () => <div data-testid="editor-destination">Editor listo</div>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, editorRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  const rendered = render(
    <Wrapper>
      <RouterProvider router={router} />
    </Wrapper>,
  );

  return { ...rendered, router, queryClient, onClose };
}

describe("NewTestWizardDialog", () => {
  beforeAll(() => {
    if (typeof globalThis.ResizeObserver === "undefined") {
      globalThis.ResizeObserver = class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
    }
  });

  beforeEach(() => {
    useStaffAuth.getState().setSession({
      token: "staff-jwt",
      expiresAt: null,
      user: {
        id: "u1",
        username: "ana",
        roles: ["PSICOLOGO_COORDINADOR"],
        permissions: ["TEST_CREAR", "CALIFICACION_CONFIGURAR", "BAREMO_CONFIGURAR"],
      },
    });

    server.use(
      http.get(`${API}/scoring/strategies`, () =>
        HttpResponse.json(
          ok([
            {
              id: 1,
              codigo: "CLAVE_SIMPLE",
              nombre: "Clave Simple",
              descripcion: "Directa",
              tipoEstrategia: "CLAVE_SIMPLE",
              activa: true,
              requiereRevisionManual: false,
              permiteBaremo: true,
              fechaCreacion: "2026-01-01T00:00:00.000Z",
            },
          ]),
        ),
      ),
    );
  });

  afterEach(() => {
    useStaffAuth.getState().clear();
    vi.restoreAllMocks();
  });

  it("guía paso a paso para crear test, versión y subtest inicial, y redirige con focus=subtest", async () => {
    let createdTestPayload: Record<string, unknown> | null = null;
    let createdVersionPayload: Record<string, unknown> | null = null;
    let createdSubtestPayload: Record<string, unknown> | null = null;

    server.use(
      http.post(`${API}/tests`, async ({ request }) => {
        createdTestPayload = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          ok({
            id: 42,
            codigoTest: "WEILL",
            nombreTest: "Test de inteligencia de Weill",
            descripcion: "Evaluación cognitiva",
            creadoPorId: "u1",
            estado: "ACTIVO",
            creadoEn: "2026-06-26T10:00:00.000Z",
          }),
        );
      }),
      http.post(`${API}/tests/42/versions`, async ({ request }) => {
        createdVersionPayload = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          ok({
            id: 105,
            testId: 42,
            estrategiaCalificacionId: 1,
            numeroVersion: "v1.0",
            estado: "BORRADOR",
            instruccionesGenerales: "Lea bien",
            tiempoLimiteSegundos: 1800,
            permiteAleatorizarSubtests: false,
            permiteAleatorizarItems: false,
            aprobadoPorId: null,
            aprobadoEn: null,
            publicadoEn: null,
            creadoPorId: "u1",
            creadoEn: "2026-06-26T10:05:00.000Z",
          }),
        );
      }),
      http.post(`${API}/test-versions/105/subtests`, async ({ request }) => {
        createdSubtestPayload = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          ok({
            id: 300,
            versionTestId: 105,
            estrategiaCalificacionId: null,
            codigoSubtest: "SUB-1",
            nombreSubtest: "Razonamiento verbal",
            descripcion: null,
            instrucciones: null,
            numeroOrden: 1,
            tiempoLimiteSegundos: 600,
            permiteAleatorizarItems: false,
            permiteAleatorizarOpciones: false,
            esObligatorio: true,
            estado: "ACTIVO",
          }),
        );
      }),
    );

    const { router, onClose, queryClient, unmount } = renderWizard();

    // Paso 1: Cabecera del test
    expect(await screen.findByText("Crear nuevo test")).toBeVisible();
    const nextBtn = screen.getByRole("button", { name: /Continuar/i });
    expect(nextBtn).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Código/i), { target: { value: "WEILL" } });
    fireEvent.change(screen.getByLabelText(/Nombre del test/i), {
      target: { value: "Test de inteligencia de Weill" },
    });
    fireEvent.change(screen.getByLabelText(/Descripción/i), {
      target: { value: "Evaluación cognitiva" },
    });
    expect(nextBtn).toBeEnabled();
    fireEvent.click(nextBtn);

    // Paso 2: Primera versión
    expect(screen.getByLabelText(/Versión/i)).toHaveValue("v1.0");
    fireEvent.change(screen.getByLabelText(/Tiempo límite global/i), {
      target: { value: "1800" },
    });
    fireEvent.change(screen.getByLabelText(/Instrucciones generales/i), {
      target: { value: "Lea bien" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Continuar/i }));

    // Paso 3: Primer subtest
    fireEvent.change(screen.getByLabelText(/Nombre del subtest/i), {
      target: { value: "Razonamiento verbal" },
    });
    fireEvent.change(screen.getByLabelText(/Tiempo \(s\)/i), {
      target: { value: "600" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Crear e ir al editor/i }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(createdTestPayload).toEqual({
      code: "WEILL",
      name: "Test de inteligencia de Weill",
      description: "Evaluación cognitiva",
    });
    expect(createdVersionPayload).toMatchObject({
      number: "v1.0",
      strategyId: 1,
      timeLimitSeconds: 1800,
      instructions: "Lea bien",
    });
    expect(createdSubtestPayload).toMatchObject({
      code: "SUB-1",
      name: "Razonamiento verbal",
      order: 1,
      timeLimitSeconds: 600,
      required: true,
    });

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/app/instrumentos/42");
      expect(router.state.location.search).toEqual({ revision: 105, focus: "subtest" });
    });

    unmount();
    queryClient.clear();
  });

  it("permite crear test sin subtest inicial y detecta código duplicado en paso 1", async () => {
    let subtestCalls = 0;

    server.use(
      http.post(`${API}/tests`, () =>
        HttpResponse.json(
          ok({
            id: 50,
            codigoTest: "NEW-1",
            nombreTest: "Nuevo",
            descripcion: null,
            creadoPorId: "u1",
            estado: "ACTIVO",
            creadoEn: "2026-06-26T10:00:00.000Z",
          }),
        ),
      ),
      http.post(`${API}/tests/50/versions`, () =>
        HttpResponse.json(
          ok({
            id: 110,
            testId: 50,
            estrategiaCalificacionId: 1,
            numeroVersion: "v1.0",
            estado: "BORRADOR",
            instruccionesGenerales: null,
            tiempoLimiteSegundos: null,
            permiteAleatorizarSubtests: false,
            permiteAleatorizarItems: false,
            aprobadoPorId: null,
            aprobadoEn: null,
            publicadoEn: null,
            creadoPorId: "u1",
            creadoEn: "2026-06-26T10:05:00.000Z",
          }),
        ),
      ),
      http.post(`${API}/test-versions/110/subtests`, () => {
        subtestCalls += 1;
        return HttpResponse.json(ok({}));
      }),
    );

    const { router, onClose, queryClient, unmount } = renderWizard({
      existingTests: [
        {
          id: 1,
          code: "EXIST",
          name: "Existente",
          description: null,
          createdById: "u1",
          status: "ACTIVO",
          createdAt: "2026-06-26T10:00:00.000Z",
        },
      ],
    });

    expect(await screen.findByText("Crear nuevo test")).toBeVisible();
    fireEvent.change(screen.getByLabelText(/Código/i), { target: { value: "exist" } });
    fireEvent.change(screen.getByLabelText(/Nombre del test/i), { target: { value: "Nuevo" } });
    expect(screen.getByText(/Ya existe un test con este código/i)).toBeVisible();
    expect(screen.getByRole("button", { name: /Continuar/i })).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Código/i), { target: { value: "NEW-1" } });
    fireEvent.click(screen.getByRole("button", { name: /Continuar/i }));
    fireEvent.click(screen.getByRole("button", { name: /Continuar/i }));

    // Desactivar subtest inicial
    fireEvent.click(screen.getByLabelText(/Crear primer subtest al inicializar/i));
    fireEvent.click(screen.getByRole("button", { name: /Crear e ir al editor/i }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(subtestCalls).toBe(0);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/app/instrumentos/50");
      expect(router.state.location.search).toEqual({ revision: 110 });
    });

    unmount();
    queryClient.clear();
  });
});
