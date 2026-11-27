import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider, createRootRoute, createRoute } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { useStaffAuth } from "../../../../store/staffAuth";
import { server } from "../../../../test/msw/server";
import { useBuilderStore } from "../../builderStore";
import * as adapters from "../../document/adapters";
import { createCleanDocument } from "../../document/__tests__/fixtures";
import { BuilderLayout } from "../BuilderLayout";

const API = "http://localhost:8080";

const ok = <T,>(data: T) => ({
  success: true,
  data,
  message: "OK",
  error: null,
  correlationId: "cid-test",
});

function renderBuilder(testId = 1, versionId = 10) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute();
  const builderRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <BuilderLayout testId={testId} versionId={versionId} />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([builderRoute]),
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

  return { ...rendered, queryClient };
}

function makeTestWire(id = 1) {
  return {
    id,
    codigoTest: "BFA-2026",
    nombreTest: "Batería Factorial",
    descripcion: "Desc",
    creadoPorId: "u1",
    estado: "ACTIVO",
    creadoEn: "2026-06-26T10:15:30.000Z",
  };
}

function makeVersionWire(id = 10, instructions = "Lea con atención") {
  return {
    id,
    testId: 1,
    estrategiaCalificacionId: 1,
    numeroVersion: "1.0",
    estado: "BORRADOR",
    instruccionesGenerales: instructions,
    tiempoLimiteSegundos: 3600,
    permiteAleatorizarSubtests: false,
    permiteAleatorizarItems: true,
    aprobadoPorId: null,
    aprobadoEn: null,
    publicadoEn: null,
    creadoPorId: "u1",
    creadoEn: "2026-06-26T10:20:00.000Z",
  };
}

function makeSubtestWire(id: number, code: string, name: string, order: number) {
  return {
    id,
    versionTestId: 10,
    estrategiaCalificacionId: 1,
    codigoSubtest: code,
    nombreSubtest: name,
    descripcion: "Desc",
    instrucciones: "Inst",
    numeroOrden: order,
    tiempoLimiteSegundos: 600,
    permiteAleatorizarItems: true,
    permiteAleatorizarOpciones: false,
    esObligatorio: true,
    estado: "ACTIVO",
  };
}

function makeTemplateWire(subtestId: number, code: string, prompt = "¿Cuál figura continúa la serie?") {
  return {
    sourceSubtestId: subtestId,
    code,
    name: `Subtest ${code}`,
    description: "Desc",
    instructions: "Inst",
    order: 1,
    timeLimitSeconds: 600,
    randomizeItems: true,
    randomizeOptions: false,
    required: true,
    strategyId: 1,
    estado: "ACTIVO",
    items: [
      {
        sourceItemId: subtestId * 10 + 1,
        code: "IT-1",
        itemType: "SOLO_TEXTO",
        responseType: "OPCION_UNICA",
        prompt,
        instruction: "Elija",
        order: 1,
        baseScore: 1,
        timeLimitSeconds: null,
        required: true,
        confidential: true,
        estado: "ACTIVO",
        images: [],
        options: [
          {
            sourceOptionId: subtestId * 100 + 1,
            code: "A",
            text: "Opción A",
            order: 1,
            ordinalValue: 1,
            estado: "ACTIVO",
            images: [],
          },
          {
            sourceOptionId: subtestId * 100 + 2,
            code: "B",
            text: "Opción B",
            order: 2,
            ordinalValue: 2,
            estado: "ACTIVO",
            images: [],
          },
        ],
        answerKey: {
          sourceAnswerKeyId: subtestId * 100 + 50,
          sourceRuleId: 80,
          correctOptionSourceId: subtestId * 100 + 1,
          expectedText: null,
          expectedNumber: null,
          numericTolerance: null,
          score: 1,
          requiresManualReview: false,
        },
      },
    ],
  };
}

function makeRuleWire(id: number, subtestId: number) {
  return {
    id,
    versionTestId: 10,
    subtestId,
    itemId: null,
    estrategiaCalificacionId: 1,
    tipoRegla: "CLAVE_ITEM",
    prioridad: 1,
    activa: true,
    estado: "BORRADOR",
    parametros: "{}",
    observacion: null,
    creadoPorId: "u1",
    creadoEn: "2026-06-26T10:30:00.000Z",
    aprobadoPorId: null,
    aprobadoEn: null,
  };
}

describe("BuilderLayout — ALTO 1, MEDIO 3, MEDIO 5", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    useBuilderStore.getState().reset();
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
  });

  afterEach(() => {
    useBuilderStore.getState().reset();
    useStaffAuth.getState().clear();
    vi.restoreAllMocks();
  });

  it("ALTO 1: muestra pasos guardados y pendientes tras fallo 503 y Reintentar envía solo lo pendiente sin 409", async () => {
    let serverInstructions = "Lea con atención";
    let serverPrompt = "¿Cuál figura continúa la serie?";
    let patchCalls = 0;
    let configCalls = 0;

    server.use(
      http.get(`${API}/scoring/strategies`, () => HttpResponse.json(ok([]))),
      http.get(`${API}/tests`, () => HttpResponse.json(ok([makeTestWire(1)]))),
      http.get(`${API}/tests/1/versions`, () =>
        HttpResponse.json(ok([makeVersionWire(10, serverInstructions)])),
      ),
      http.get(`${API}/test-versions/10/subtests`, () =>
        HttpResponse.json(ok([makeSubtestWire(20, "MEM", "Memoria Visual", 1)])),
      ),
      http.get(`${API}/subtests/20/clone-template`, () =>
        HttpResponse.json(ok(makeTemplateWire(20, "MEM", serverPrompt))),
      ),
      http.get(`${API}/subtests/20/scoring-rules`, () =>
        HttpResponse.json(ok([makeRuleWire(80, 20)])),
      ),
      http.get(`${API}/test-versions/10/baremos`, () => HttpResponse.json(ok([]))),
      http.patch(`${API}/test-versions/10`, async ({ request }) => {
        patchCalls += 1;
        const body = (await request.json()) as { instructions?: string | null };
        serverInstructions = body.instructions ?? "";
        return HttpResponse.json(ok(makeVersionWire(10, serverInstructions)));
      }),
      http.post(`${API}/test-versions/10/configuration`, () => {
        configCalls += 1;
        if (configCalls === 1) {
          return HttpResponse.json({ success: false, message: "Backend 503" }, { status: 503 });
        }
        serverPrompt = "Enunciado corregido";
        return HttpResponse.json(ok([makeSubtestWire(20, "MEM", "Memoria Visual", 1)]));
      }),
    );

    const { unmount, queryClient } = renderBuilder();
    await screen.findByRole("region", { name: "Editor de versión" });

    // Editar metadatos + enunciado del ítem
    fireEvent.change(screen.getByLabelText(/Instrucciones generales/i), {
      target: { value: "Instrucción guardada en paso 1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /IT-1/i }));
    fireEvent.change(await screen.findByLabelText("Enunciado"), {
      target: { value: "Enunciado corregido" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));

    expect(
      await screen.findByText(/Guardado parcial: se requiere reintentar lo pendiente/i),
    ).toBeVisible();
    expect(screen.getByText(/Metadatos de versión/i)).toBeVisible();
    expect(screen.getByText(/Subtests, ítems y opciones/i)).toBeVisible();
    expect(patchCalls).toBe(1);
    expect(configCalls).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Versión guardada.")).toBeVisible();
    expect(patchCalls).toBe(1);
    expect(configCalls).toBe(2);

    unmount();
    queryClient.clear();
  });

  it("MEDIO 3: bloquea guardado por colisión de opción o clave vacía (ck_clave_tipo) mostrando el conflicto y enlace al nodo, pero permite guardar borrador incompleto persistible", async () => {
    const baseDoc = createCleanDocument({ baremos: [] });
    let loadCalls = 0;
    const saveSpy = vi.spyOn(adapters, "saveVersionDocument").mockResolvedValue({
      document: baseDoc,
      test: { id: 1, code: "BFA", name: "BFA", description: null, createdById: null, status: "ACTIVO", createdAt: "2026-06-26T10:00:00Z" },
      version: { id: 10, testId: 1, strategyId: 1, number: "1.0", status: "BORRADOR", instructions: null, timeLimitSeconds: 3600, randomizeSubtests: false, randomizeItems: true, approvedById: null, approvedAt: null, publishedAt: null, createdById: null, createdAt: "2026-06-26T10:00:00Z" },
      scoringRulesBySubtestId: {},
      activeScoringRuleCount: 1,
      hasActiveScoringRules: true,
    });
    vi.spyOn(adapters, "loadVersionDocument").mockImplementation(async () => {
      loadCalls += 1;
      return {
        document: baseDoc,
        test: { id: 1, code: "BFA", name: "BFA", description: null, createdById: null, status: "ACTIVO", createdAt: "2026-06-26T10:00:00Z" },
        version: { id: 10, testId: 1, strategyId: 1, number: "1.0", status: "BORRADOR", instructions: null, timeLimitSeconds: 3600, randomizeSubtests: false, randomizeItems: true, approvedById: null, approvedAt: null, publishedAt: null, createdById: null, createdAt: "2026-06-26T10:00:00Z" },
        scoringRulesBySubtestId: {},
        activeScoringRuleCount: 1,
        hasActiveScoringRules: true,
      };
    });

    server.use(http.get(`${API}/scoring/strategies`, () => HttpResponse.json(ok([]))));

    const { unmount, queryClient } = renderBuilder();
    await screen.findByRole("region", { name: "Editor de versión" });
    expect(loadCalls).toBe(1);

    // Navegar al ítem y renombrar opción B -> A
    fireEvent.click(screen.getByRole("button", { name: /IT-1/i }));
    const optionRows = document.querySelectorAll('[data-slot="option-row"]');
    const rowB = optionRows[1] as HTMLElement;
    fireEvent.change(within(rowB).getByLabelText("Código"), { target: { value: "A" } });

    expect(screen.getByRole("button", { name: "Guardar borrador" })).toBeDisabled();
    expect(
      screen.getByText(/No se puede guardar mientras existan conflictos de validación/i),
    ).toBeVisible();

    const problemsPanel = screen.getByRole("region", { name: "Problemas de la versión" });
    const conflictLink = within(problemsPanel).getAllByRole("button", {
      name: /Impide guardar · Código de opción duplicado: "A"/i,
    })[0]!;
    expect(conflictLink).toBeVisible();

    // Corregir código y borrar opción correcta -> viola ck_clave_tipo
    fireEvent.change(within(rowB).getByLabelText("Código"), { target: { value: "B" } });
    const rowA = document.querySelectorAll('[data-slot="option-row"]')[0] as HTMLElement;
    fireEvent.click(within(rowA).getByRole("button", { name: "Eliminar opción" }));
    expect(screen.getByRole("button", { name: "Guardar borrador" })).toBeDisabled();

    // Reasignar revisión manual -> borrador válido para persistir (aunque solo tenga 1 opción)
    fireEvent.click(screen.getByLabelText("Requiere revisión manual"));
    const saveBtn = screen.getByRole("button", { name: "Guardar borrador" });
    expect(saveBtn).toBeEnabled();
    fireEvent.click(saveBtn);

    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));

    unmount();
    queryClient.clear();
  });

  it("MEDIO 5: detecta permutaciones B18 en el editor, bloquea guardado directo y permite revertir solo el reordenamiento", async () => {
    const docWithTwoSubtests = createCleanDocument({ baremos: [] });
    docWithTwoSubtests.subtests.push({
      ...docWithTwoSubtests.subtests[0]!,
      id: 21,
      draftId: "sub-21",
      code: "ESP",
      name: "Espacial",
      order: 2,
      items: [],
    });

    vi.spyOn(adapters, "loadVersionDocument").mockResolvedValue({
      document: docWithTwoSubtests,
      test: { id: 1, code: "BFA", name: "BFA", description: null, createdById: null, status: "ACTIVO", createdAt: "2026-06-26T10:00:00Z" },
      version: { id: 10, testId: 1, strategyId: 1, number: "1.0", status: "BORRADOR", instructions: null, timeLimitSeconds: 3600, randomizeSubtests: false, randomizeItems: true, approvedById: null, approvedAt: null, publishedAt: null, createdById: null, createdAt: "2026-06-26T10:00:00Z" },
      scoringRulesBySubtestId: {},
      activeScoringRuleCount: 1,
      hasActiveScoringRules: true,
    });
    const saveSpy = vi.spyOn(adapters, "saveVersionDocument");
    server.use(http.get(`${API}/scoring/strategies`, () => HttpResponse.json(ok([]))));

    const { unmount, queryClient } = renderBuilder();
    await screen.findByRole("region", { name: "Editor de versión" });

    // Editar metadatos + permutar subtests
    fireEvent.change(screen.getByLabelText(/Instrucciones generales/i), {
      target: { value: "Instrucción que debe conservarse" },
    });
    const moveDownButtons = screen.getAllByRole("button", { name: "Mover subtest abajo" });
    fireEvent.click(moveDownButtons[0]!);

    expect(
      await screen.findByText(/Reordenamiento incompatible con guardado directo \(B18\)/i),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /Guardar en dos pasos seguros/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guardar borrador" })).toBeDisabled();
    expect(saveSpy).not.toHaveBeenCalled();

    // Revertir solo el reordenamiento conserva la edición de instrucciones y habilita guardar
    fireEvent.click(screen.getByRole("button", { name: "Revertir solo el reordenamiento" }));
    expect(
      screen.queryByText(/Reordenamiento incompatible con guardado directo \(B18\)/i),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Instrucciones generales/i)).toHaveValue(
      "Instrucción que debe conservarse",
    );
    expect(screen.getByRole("button", { name: "Guardar borrador" })).toBeEnabled();

    unmount();
    queryClient.clear();
  });

  it("F3-FIX-2 (Hallazgo 1): un intercambio de subtests no emite escrituras, solo ofrece revertir y tras revertir guarda el resto", async () => {
    let patchCalls = 0;
    let configCalls = 0;
    let serverInstructions = "Lea con atención";

    server.use(
      http.get(`${API}/scoring/strategies`, () => HttpResponse.json(ok([]))),
      http.get(`${API}/tests`, () => HttpResponse.json(ok([makeTestWire(1)]))),
      http.get(`${API}/tests/1/versions`, () =>
        HttpResponse.json(ok([makeVersionWire(10, serverInstructions)])),
      ),
      http.get(`${API}/test-versions/10/subtests`, () =>
        HttpResponse.json(
          ok([
            makeSubtestWire(20, "MEM", "Memoria Visual", 1),
            makeSubtestWire(21, "ESP", "Espacial", 2),
          ]),
        ),
      ),
      http.get(`${API}/subtests/20/clone-template`, () =>
        HttpResponse.json(ok(makeTemplateWire(20, "MEM"))),
      ),
      http.get(`${API}/subtests/21/clone-template`, () => {
        const tpl = makeTemplateWire(21, "ESP");
        tpl.items[0]!.answerKey!.sourceRuleId = 81;
        return HttpResponse.json(ok(tpl));
      }),
      http.get(`${API}/subtests/20/scoring-rules`, () =>
        HttpResponse.json(ok([makeRuleWire(80, 20)])),
      ),
      http.get(`${API}/subtests/21/scoring-rules`, () =>
        HttpResponse.json(ok([makeRuleWire(81, 21)])),
      ),
      http.get(`${API}/test-versions/10/baremos`, () => HttpResponse.json(ok([]))),
      http.patch(`${API}/test-versions/10`, async ({ request }) => {
        patchCalls += 1;
        const body = (await request.json()) as { instructions?: string | null };
        serverInstructions = body.instructions ?? "";
        return HttpResponse.json(ok(makeVersionWire(10, serverInstructions)));
      }),
      http.post(`${API}/test-versions/10/configuration`, () => {
        configCalls += 1;
        return HttpResponse.json(
          ok([
            makeSubtestWire(20, "MEM", "Memoria Visual", 1),
            makeSubtestWire(21, "ESP", "Espacial", 2),
          ]),
        );
      }),
    );

    const { unmount, queryClient } = renderBuilder();
    await screen.findByRole("region", { name: "Editor de versión" });

    fireEvent.change(screen.getByLabelText(/Instrucciones generales/i), {
      target: { value: "Instrucción editada sin reordenamiento" },
    });
    const moveDownButtons = screen.getAllByRole("button", { name: "Mover subtest abajo" });
    fireEvent.click(moveDownButtons[0]!);

    expect(
      await screen.findByText(/Reordenamiento incompatible con guardado directo \(B18\)/i),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /Guardar en dos pasos seguros/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guardar borrador" })).toBeDisabled();
    expect(patchCalls).toBe(0);
    expect(configCalls).toBe(0);

    fireEvent.click(screen.getByRole("button", { name: "Revertir solo el reordenamiento" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));

    expect(await screen.findByText("Versión guardada.")).toBeVisible();
    expect(patchCalls).toBe(1);
    expect(configCalls).toBe(0);
    expect(serverInstructions).toBe("Instrucción editada sin reordenamiento");

    unmount();
    queryClient.clear();
  });

  it("F3-FIX-3 (ALTO 1): tras 503 en baremos y 503 en recarga, Reintentar sobrevive a otro 503 de recarga y luego guarda el baremo sin VERSION_DOCUMENT_CHANGED", async () => {
    let serverInstructions = "Lea con atención";
    let serverPrompt = "¿Cuál figura continúa la serie?";
    let patchCalls = 0;
    let configCalls = 0;
    let baremoCalls = 0;
    let baremoCreated = false;
    let failReload = false;

    server.use(
      http.get(`${API}/scoring/strategies`, () => HttpResponse.json(ok([]))),
      http.get(`${API}/tests`, () => HttpResponse.json(ok([makeTestWire(1)]))),
      http.get(`${API}/tests/1/versions`, () =>
        HttpResponse.json(ok([makeVersionWire(10, serverInstructions)])),
      ),
      http.get(`${API}/test-versions/10/subtests`, () => {
        if (failReload) {
          return HttpResponse.json({ success: false, message: "Recarga 503" }, { status: 503 });
        }
        return HttpResponse.json(ok([makeSubtestWire(20, "MEM", "Memoria Visual", 1)]));
      }),
      http.get(`${API}/subtests/20/clone-template`, () =>
        HttpResponse.json(ok(makeTemplateWire(20, "MEM", serverPrompt))),
      ),
      http.get(`${API}/subtests/20/scoring-rules`, () =>
        HttpResponse.json(ok([makeRuleWire(80, 20)])),
      ),
      http.get(`${API}/test-versions/10/baremos`, () =>
        HttpResponse.json(
          ok(
            baremoCreated
              ? [
                  {
                    id: 90,
                    versionTestId: 10,
                    dimensionResultadoId: null,
                    codigoBaremo: "BAR-TOT",
                    nombre: "Baremo total",
                    descripcion: null,
                    grupoNormativo: null,
                    criterioEdadMinima: null,
                    criterioEdadMaxima: null,
                    criterioSexoId: null,
                    criterioCarreraId: null,
                    vigenteDesde: null,
                    vigenteHasta: null,
                    estado: "BORRADOR",
                    creadoPorId: "u1",
                    creadoEn: "2026-06-26T10:40:00.000Z",
                    aprobadoPorId: null,
                    aprobadoEn: null,
                  },
                ]
              : [],
          ),
        ),
      ),
      http.get(`${API}/baremos/90/ranges`, () => HttpResponse.json(ok([]))),
      http.patch(`${API}/test-versions/10`, async ({ request }) => {
        patchCalls += 1;
        const body = (await request.json()) as { instructions?: string | null };
        serverInstructions = body.instructions ?? "";
        return HttpResponse.json(ok(makeVersionWire(10, serverInstructions)));
      }),
      http.post(`${API}/test-versions/10/configuration`, () => {
        configCalls += 1;
        serverPrompt = "Enunciado guardado";
        return HttpResponse.json(ok([makeSubtestWire(20, "MEM", "Memoria Visual", 1)]));
      }),
      http.post(`${API}/baremos`, () => {
        baremoCalls += 1;
        if (baremoCalls === 1) {
          failReload = true;
          return HttpResponse.json({ success: false, message: "Baremo 503" }, { status: 503 });
        }
        baremoCreated = true;
        return HttpResponse.json(
          ok({
            id: 90,
            versionTestId: 10,
            dimensionResultadoId: null,
            codigoBaremo: "BAR-TOT",
            nombre: "Baremo total",
            descripcion: null,
            grupoNormativo: null,
            criterioEdadMinima: null,
            criterioEdadMaxima: null,
            criterioSexoId: null,
            criterioCarreraId: null,
            vigenteDesde: null,
            vigenteHasta: null,
            estado: "BORRADOR",
            creadoPorId: "u1",
            creadoEn: "2026-06-26T10:40:00.000Z",
            aprobadoPorId: null,
            aprobadoEn: null,
          }),
        );
      }),
    );

    const { unmount, queryClient } = renderBuilder();
    await screen.findByRole("region", { name: "Editor de versión" });

    // Editar metadatos, ítem y baremo
    fireEvent.change(screen.getByLabelText(/Instrucciones generales/i), {
      target: { value: "Instrucción guardada" },
    });
    fireEvent.click(screen.getByRole("button", { name: /IT-1/i }));
    fireEvent.change(await screen.findByLabelText("Enunciado"), {
      target: { value: "Enunciado guardado" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Baremos/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Crear primer baremo/i }));
    fireEvent.change(await screen.findByLabelText(/^Código/i), { target: { value: "BAR-TOT" } });
    fireEvent.change(screen.getByLabelText(/^Nombre/i), { target: { value: "Baremo total" } });

    fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));

    expect(
      await screen.findByText(/Guardado parcial: se requiere reintentar lo pendiente/i),
    ).toBeVisible();
    expect(screen.getByText(/Reconciliación pendiente:/i)).toBeVisible();
    expect(patchCalls).toBe(1);
    expect(configCalls).toBe(1);
    expect(baremoCalls).toBe(1);

    // Primer Reintentar sincronización mientras la recarga sigue devolviendo 503
    fireEvent.click(screen.getByRole("button", { name: "Reintentar sincronización" }));
    expect(
      await screen.findByText(/No se pudo recargar el estado del servidor para reconciliar/i),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Reintentar sincronización" })).toBeEnabled();
    expect(baremoCalls).toBe(1);

    // Recuperar conexión y pulsar Reintentar sincronización: completa baremos sin VERSION_DOCUMENT_CHANGED
    failReload = false;
    fireEvent.click(screen.getByRole("button", { name: "Reintentar sincronización" }));

    expect(await screen.findByText("Versión guardada.")).toBeVisible();
    expect(screen.queryByText(/configuración del servidor cambió/i)).not.toBeInTheDocument();
    expect(patchCalls).toBe(1);
    expect(configCalls).toBe(1);
    expect(baremoCalls).toBe(2);

    unmount();
    queryClient.clear();
  });

  it("F3-FIX-4 (UI ALTO baremo): baremo creado en servidor + 503 + recarga 503 → Reintentar sincronización adopta sin 409 ni duplicar POST /baremos", async () => {
    let baremoCalls = 0;
    let persistedBaremo: Record<string, unknown> | null = null;
    let failReload = false;

    server.use(
      http.get(`${API}/scoring/strategies`, () => HttpResponse.json(ok([]))),
      http.get(`${API}/tests`, () => HttpResponse.json(ok([makeTestWire(1)]))),
      http.get(`${API}/tests/1/versions`, () =>
        HttpResponse.json(ok([makeVersionWire(10, "Lea con atención")])),
      ),
      http.get(`${API}/test-versions/10/subtests`, () => {
        if (failReload) {
          return HttpResponse.json({ success: false, message: "Recarga 503" }, { status: 503 });
        }
        return HttpResponse.json(ok([makeSubtestWire(20, "MEM", "Memoria Visual", 1)]));
      }),
      http.get(`${API}/subtests/20/clone-template`, () =>
        HttpResponse.json(ok(makeTemplateWire(20, "MEM"))),
      ),
      http.get(`${API}/subtests/20/scoring-rules`, () =>
        HttpResponse.json(ok([makeRuleWire(80, 20)])),
      ),
      http.get(`${API}/test-versions/10/baremos`, () =>
        HttpResponse.json(ok(persistedBaremo ? [persistedBaremo] : [])),
      ),
      http.get(`${API}/baremos/90/ranges`, () => HttpResponse.json(ok([]))),
      http.post(`${API}/baremos`, async ({ request }) => {
        baremoCalls += 1;
        const body = (await request.json()) as {
          code: string;
          name: string;
          description?: string | null;
          normativeGroup?: string | null;
        };
        persistedBaremo = {
          id: 90,
          versionTestId: 10,
          dimensionResultadoId: null,
          codigoBaremo: body.code,
          nombre: body.name,
          descripcion: body.description ?? null,
          grupoNormativo: body.normativeGroup ?? null,
          criterioEdadMinima: null,
          criterioEdadMaxima: null,
          criterioSexoId: null,
          criterioCarreraId: null,
          vigenteDesde: null,
          vigenteHasta: null,
          estado: "BORRADOR",
          creadoPorId: "u1",
          creadoEn: "2026-06-26T10:40:00.000Z",
          aprobadoPorId: null,
          aprobadoEn: null,
        };
        failReload = true;
        return HttpResponse.json({ success: false, message: "503 tras crear baremo" }, { status: 503 });
      }),
    );

    const { unmount, queryClient } = renderBuilder();
    await screen.findByRole("region", { name: "Editor de versión" });

    fireEvent.click(screen.getByRole("button", { name: /^Baremos/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Crear primer baremo/i }));
    fireEvent.change(await screen.findByLabelText(/^Código/i), { target: { value: "BAR-TOT" } });
    fireEvent.change(screen.getByLabelText(/^Nombre/i), { target: { value: "Baremo total" } });

    fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));

    expect(await screen.findByText(/Reconciliación pendiente:/i)).toBeVisible();
    const retryBtn = screen.getByRole("button", { name: "Reintentar sincronización" });
    expect(retryBtn).toBeEnabled();
    expect(baremoCalls).toBe(1);

    failReload = false;
    fireEvent.click(retryBtn);

    expect(await screen.findByText("Versión guardada.")).toBeVisible();
    expect(screen.queryByText(/configuración del servidor cambió/i)).not.toBeInTheDocument();
    expect(baremoCalls).toBe(1);

    unmount();
    queryClient.clear();
  });

  it("F3-FIX-4 (UI ALTO configuración): configuración aplicada en servidor + 503 + recarga 503 → Reintentar sincronización adopta sin duplicar POST /configuration", async () => {
    let configCalls = 0;
    let serverPrompt = "¿Cuál figura continúa la serie?";
    let failReload = false;

    server.use(
      http.get(`${API}/scoring/strategies`, () => HttpResponse.json(ok([]))),
      http.get(`${API}/tests`, () => HttpResponse.json(ok([makeTestWire(1)]))),
      http.get(`${API}/tests/1/versions`, () =>
        HttpResponse.json(ok([makeVersionWire(10, "Lea con atención")])),
      ),
      http.get(`${API}/test-versions/10/subtests`, () => {
        if (failReload) {
          return HttpResponse.json({ success: false, message: "Recarga 503" }, { status: 503 });
        }
        return HttpResponse.json(ok([makeSubtestWire(20, "MEM", "Memoria Visual", 1)]));
      }),
      http.get(`${API}/subtests/20/clone-template`, () =>
        HttpResponse.json(ok(makeTemplateWire(20, "MEM", serverPrompt))),
      ),
      http.get(`${API}/subtests/20/scoring-rules`, () =>
        HttpResponse.json(ok([makeRuleWire(80, 20)])),
      ),
      http.get(`${API}/test-versions/10/baremos`, () => HttpResponse.json(ok([]))),
      http.post(`${API}/test-versions/10/configuration`, () => {
        configCalls += 1;
        serverPrompt = "Enunciado aplicado antes del 503";
        failReload = true;
        return HttpResponse.json({ success: false, message: "503 tras config" }, { status: 503 });
      }),
    );

    const { unmount, queryClient } = renderBuilder();
    await screen.findByRole("region", { name: "Editor de versión" });

    fireEvent.click(screen.getByRole("button", { name: /IT-1/i }));
    fireEvent.change(await screen.findByLabelText("Enunciado"), {
      target: { value: "Enunciado aplicado antes del 503" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));

    expect(await screen.findByText(/Reconciliación pendiente:/i)).toBeVisible();
    const retryBtn = screen.getByRole("button", { name: "Reintentar sincronización" });
    expect(retryBtn).toBeEnabled();
    expect(configCalls).toBe(1);

    failReload = false;
    fireEvent.click(retryBtn);

    expect(await screen.findByText("Versión guardada.")).toBeVisible();
    expect(screen.queryByText(/configuración del servidor cambió/i)).not.toBeInTheDocument();
    expect(configCalls).toBe(1);

    unmount();
    queryClient.clear();
  });

  it("F3-FIX-4 (UI Conflicto real): muestra nodos en conflicto (409) y preserva los nodos sin conflicto en el borrador", async () => {
    let serverPrompt = "¿Cuál figura continúa la serie?";

    server.use(
      http.get(`${API}/scoring/strategies`, () => HttpResponse.json(ok([]))),
      http.get(`${API}/tests`, () => HttpResponse.json(ok([makeTestWire(1)]))),
      http.get(`${API}/tests/1/versions`, () =>
        HttpResponse.json(ok([makeVersionWire(10, "Lea con atención")])),
      ),
      http.get(`${API}/test-versions/10/subtests`, () =>
        HttpResponse.json(ok([makeSubtestWire(20, "MEM", "Memoria Visual", 1)])),
      ),
      http.get(`${API}/subtests/20/clone-template`, () =>
        HttpResponse.json(ok(makeTemplateWire(20, "MEM", serverPrompt))),
      ),
      http.get(`${API}/subtests/20/scoring-rules`, () =>
        HttpResponse.json(ok([makeRuleWire(80, 20)])),
      ),
      http.get(`${API}/test-versions/10/baremos`, () => HttpResponse.json(ok([]))),
    );

    const { unmount, queryClient } = renderBuilder();
    await screen.findByRole("region", { name: "Editor de versión" });

    fireEvent.change(screen.getByLabelText(/Instrucciones generales/i), {
      target: { value: "Instrucción local preservada" },
    });
    fireEvent.click(screen.getByRole("button", { name: /IT-1/i }));
    fireEvent.change(await screen.findByLabelText("Enunciado"), {
      target: { value: "Enunciado local conflictivo" },
    });

    serverPrompt = "Cambio concurrente en el servidor";
    fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));

    expect(
      await screen.findByText(/Conflicto con cambios externos en el servidor \(409\)/i),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: /Ítem IT-1/i })).toBeVisible();
    // Nodo sin conflicto sigue intacto en el store
    expect(useBuilderStore.getState().document?.version.instructions).toBe(
      "Instrucción local preservada",
    );

    unmount();
    queryClient.clear();
  });

  it("F3-FIX-4 (Test 4 - MEDIO UI): todo guardado y fallan las dos recargas finales → al reabrir, «Reintentar sincronización» está visible y funciona, y «Guardar borrador» no queda bloqueado", async () => {
    let serverInstructions = "Lea con atención";
    let failReloads = false;
    let patchCalls = 0;

    server.use(
      http.get(`${API}/scoring/strategies`, () => HttpResponse.json(ok([]))),
      http.get(`${API}/tests`, () => HttpResponse.json(ok([makeTestWire(1)]))),
      http.get(`${API}/tests/1/versions`, () =>
        HttpResponse.json(ok([makeVersionWire(10, serverInstructions)])),
      ),
      http.get(`${API}/test-versions/10/subtests`, () => {
        if (failReloads) {
          return HttpResponse.json({ success: false, message: "Recarga final 503" }, { status: 503 });
        }
        return HttpResponse.json(ok([makeSubtestWire(20, "MEM", "Memoria Visual", 1)]));
      }),
      http.get(`${API}/subtests/20/clone-template`, () =>
        HttpResponse.json(ok(makeTemplateWire(20, "MEM"))),
      ),
      http.get(`${API}/subtests/20/scoring-rules`, () =>
        HttpResponse.json(ok([makeRuleWire(80, 20)])),
      ),
      http.get(`${API}/test-versions/10/baremos`, () => HttpResponse.json(ok([]))),
      http.patch(`${API}/test-versions/10`, async ({ request }) => {
        patchCalls += 1;
        const body = (await request.json()) as { instructions?: string | null };
        serverInstructions = body.instructions ?? "";
        failReloads = true;
        return HttpResponse.json(ok(makeVersionWire(10, serverInstructions)));
      }),
    );

    const firstMount = renderBuilder();
    await screen.findByRole("region", { name: "Editor de versión" });

    fireEvent.change(screen.getByLabelText(/Instrucciones generales/i), {
      target: { value: "Instrucción guardada antes de perder recargas" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));

    expect(
      await screen.findByRole("button", { name: "Reintentar sincronización" }),
    ).toBeEnabled();
    expect(patchCalls).toBe(1);

    // Cerrar el editor (unmount + reset) y reabrir con red recuperada
    firstMount.unmount();
    firstMount.queryClient.clear();
    useBuilderStore.getState().reset();
    failReloads = false;

    const reopened = renderBuilder();
    await screen.findByRole("region", { name: "Editor de versión" });

    // Aunque no haya cambios locales sucios, Reintentar sincronización está visible y habilitado,
    // y Guardar borrador NO queda bloqueado.
    expect(screen.getByText(/Reconciliación pendiente:/i)).toBeVisible();
    const retryAfterReopen = screen.getByRole("button", { name: "Reintentar sincronización" });
    expect(retryAfterReopen).toBeEnabled();
    expect(screen.getByRole("button", { name: "Guardar borrador" })).toBeEnabled();

    fireEvent.click(retryAfterReopen);

    expect(await screen.findByText("Versión guardada.")).toBeVisible();
    expect(patchCalls).toBe(1);
    expect(useBuilderStore.getState().reconciliationPending).toBe(false);
    expect(screen.queryByRole("button", { name: "Reintentar sincronización" })).not.toBeInTheDocument();

    reopened.unmount();
    reopened.queryClient.clear();
  });

  it("F3-FIX-5 (UI Hallazgo 3): editar baremo tras 503 de creación y recarga 503 reintenta con PATCH sin 409", async () => {
    let baremoPostCalls = 0;
    let baremoPatchCalls = 0;
    let persistedBaremo: Record<string, unknown> | null = null;
    let persistedNombre: string | null = null;
    let failReload = false;

    server.use(
      http.get(`${API}/scoring/strategies`, () => HttpResponse.json(ok([]))),
      http.get(`${API}/tests`, () => HttpResponse.json(ok([makeTestWire(1)]))),
      http.get(`${API}/tests/1/versions`, () =>
        HttpResponse.json(ok([makeVersionWire(10, "Lea con atención")])),
      ),
      http.get(`${API}/test-versions/10/subtests`, () => {
        if (failReload) {
          return HttpResponse.json({ success: false, message: "Recarga 503" }, { status: 503 });
        }
        return HttpResponse.json(ok([makeSubtestWire(20, "MEM", "Memoria Visual", 1)]));
      }),
      http.get(`${API}/subtests/20/clone-template`, () =>
        HttpResponse.json(ok(makeTemplateWire(20, "MEM"))),
      ),
      http.get(`${API}/subtests/20/scoring-rules`, () =>
        HttpResponse.json(ok([makeRuleWire(80, 20)])),
      ),
      http.get(`${API}/test-versions/10/baremos`, () =>
        HttpResponse.json(ok(persistedBaremo ? [persistedBaremo] : [])),
      ),
      http.get(`${API}/baremos/90/ranges`, () => HttpResponse.json(ok([]))),
      http.post(`${API}/baremos`, async ({ request }) => {
        baremoPostCalls += 1;
        const body = (await request.json()) as {
          code: string;
          name: string;
          description?: string | null;
          normativeGroup?: string | null;
        };
        persistedBaremo = {
          id: 90,
          versionTestId: 10,
          dimensionResultadoId: null,
          codigoBaremo: body.code,
          nombre: body.name,
          descripcion: body.description ?? null,
          grupoNormativo: body.normativeGroup ?? null,
          criterioEdadMinima: null,
          criterioEdadMaxima: null,
          criterioSexoId: null,
          criterioCarreraId: null,
          vigenteDesde: null,
          vigenteHasta: null,
          estado: "BORRADOR",
          creadoPorId: "u1",
          creadoEn: "2026-06-26T10:40:00.000Z",
          aprobadoPorId: null,
          aprobadoEn: null,
        };
        persistedNombre = body.name;
        failReload = true;
        return HttpResponse.json({ success: false, message: "503 tras crear baremo" }, { status: 503 });
      }),
      http.patch(`${API}/baremos/90`, async ({ request }) => {
        baremoPatchCalls += 1;
        const body = (await request.json()) as { code: string; name: string };
        persistedBaremo = {
          ...persistedBaremo!,
          codigoBaremo: body.code,
          nombre: body.name,
        };
        persistedNombre = body.name;
        return HttpResponse.json(ok(persistedBaremo));
      }),
    );

    const { unmount, queryClient } = renderBuilder();
    await screen.findByRole("region", { name: "Editor de versión" });

    fireEvent.click(screen.getByRole("button", { name: /^Baremos/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Crear primer baremo/i }));
    fireEvent.change(await screen.findByLabelText(/^Código/i), { target: { value: "BAR-TOT" } });
    fireEvent.change(screen.getByLabelText(/^Nombre/i), { target: { value: "Baremo enviado" } });

    fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));

    expect(await screen.findByText(/Reconciliación pendiente:/i)).toBeVisible();
    expect(baremoPostCalls).toBe(1);

    // Usuario edita el nombre antes de pulsar Reintentar sincronización
    fireEvent.change(screen.getByLabelText(/^Nombre/i), { target: { value: "Baremo editado" } });

    failReload = false;
    fireEvent.click(screen.getByRole("button", { name: "Reintentar sincronización" }));

    expect(await screen.findByText("Versión guardada.")).toBeVisible();
    expect(screen.queryByText(/configuración del servidor cambió/i)).not.toBeInTheDocument();
    expect(baremoPostCalls).toBe(1);
    expect(baremoPatchCalls).toBe(1);
    expect(persistedNombre).toBe("Baremo editado");

    unmount();
    queryClient.clear();
  });

  it("F3-FIX-7b (UI UNCERTAIN_IMAGE_OPERATION): muestra explicación en español y botones «Conservar la imagen del servidor» y «Aplicar mi cambio» con ambas resoluciones funcionales", async () => {
    let failReload = false;
    let deleteCalls = 0;
    let serverImage: {
      sourceImageId: number;
      resourceId: number;
      order: number;
      altText: string;
      storagePath: string;
      role: string;
    } | null = null;

    server.use(
      http.get(`${API}/scoring/strategies`, () => HttpResponse.json(ok([]))),
      http.get(`${API}/tests`, () => HttpResponse.json(ok([makeTestWire(1)]))),
      http.get(`${API}/tests/1/versions`, () =>
        HttpResponse.json(ok([makeVersionWire(10, "Lea con atención")])),
      ),
      http.get(`${API}/test-versions/10/subtests`, () => {
        if (failReload) {
          return HttpResponse.json({ success: false, message: "Recarga 503" }, { status: 503 });
        }
        return HttpResponse.json(ok([makeSubtestWire(20, "MEM", "Memoria Visual", 1)]));
      }),
      http.get(`${API}/subtests/20/clone-template`, () => {
        const tpl = makeTemplateWire(20, "MEM");
        (tpl.items[0] as { images: unknown[] }).images = serverImage ? [serverImage] : [];
        return HttpResponse.json(ok(tpl));
      }),
      http.get(`${API}/subtests/20/scoring-rules`, () =>
        HttpResponse.json(ok([makeRuleWire(80, 20)])),
      ),
      http.get(`${API}/test-versions/10/baremos`, () => HttpResponse.json(ok([]))),
      http.post(`${API}/items/201/images`, () => {
        serverImage = {
          sourceImageId: 88,
          resourceId: 905,
          order: 1,
          altText: "",
          storagePath: "test-config/items/201/550e8400-e29b-41d4-a716-446655440000-estimulo.png",
          role: "ENUNCIADO",
        };
        failReload = true;
        return HttpResponse.json({ success: false, message: "503 tras POST" }, { status: 503 });
      }),
      http.delete(`${API}/items/images/88`, () => {
        deleteCalls += 1;
        serverImage = null;
        return HttpResponse.json(ok(null));
      }),
      http.get(`${API}/items/images/resources/905`, () =>
        new HttpResponse(new Blob(["img"], { type: "image/png" }), {
          status: 200,
          headers: { "Content-Type": "image/png" },
        }),
      ),
    );

    const { unmount, queryClient } = renderBuilder();
    await screen.findByRole("region", { name: "Editor de versión" });

    fireEvent.click(screen.getByRole("button", { name: /IT-1/i }));
    const itemImagesHeading = await screen.findByRole("heading", { name: "Imágenes de estímulo" });
    const itemImagesSection = itemImagesHeading.closest("section")!;
    const fileInput = within(itemImagesSection).getByLabelText("Seleccionar archivo de imagen");
    const file = new File(["bytes"], "estimulo.png", { type: "image/png" });
    fireEvent.change(fileInput, { target: { files: [file] } });

    fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));
    expect(await screen.findByText(/Reconciliación pendiente:/i)).toBeVisible();

    // Quitar la imagen localmente antes de reintentar
    fireEvent.click(within(itemImagesSection).getByRole("button", { name: "Eliminar imagen" }));
    failReload = false;
    fireEvent.click(screen.getByRole("button", { name: "Reintentar sincronización" }));

    expect(
      await screen.findByText(/No se pudo confirmar si la operación anterior sobre esta imagen se aplicó en el servidor/i),
    ).toBeVisible();
    const keepServerBtn = screen.getByRole("button", { name: "Conservar la imagen del servidor" });
    const applyMineBtn = screen.getByRole("button", { name: "Aplicar mi cambio" });
    expect(keepServerBtn).toBeVisible();
    expect(applyMineBtn).toBeVisible();
    expect(deleteCalls).toBe(0);

    // Flujo 1: «Aplicar mi cambio» borra la imagen en el servidor al guardar
    fireEvent.click(applyMineBtn);
    expect(
      screen.queryByRole("button", { name: "Aplicar mi cambio" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));
    expect(await screen.findByText("Versión guardada.")).toBeVisible();
    expect(deleteCalls).toBe(1);

    // Flujo 2: «Conservar la imagen del servidor» descarta la intención sin borrar
    serverImage = null;
    const itemImagesSection2 = (
      await screen.findByRole("heading", { name: "Imágenes de estímulo" })
    ).closest("section")!;
    fireEvent.change(within(itemImagesSection2).getByLabelText("Seleccionar archivo de imagen"), {
      target: { files: [new File(["bytes"], "estimulo.png", { type: "image/png" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));
    expect(await screen.findByText(/Reconciliación pendiente:/i)).toBeVisible();

    fireEvent.click(within(itemImagesSection2).getByRole("button", { name: "Eliminar imagen" }));
    failReload = false;
    fireEvent.click(screen.getByRole("button", { name: "Reintentar sincronización" }));

    const keepBtn2 = await screen.findByRole("button", { name: "Conservar la imagen del servidor" });
    fireEvent.click(keepBtn2);
    expect(
      screen.queryByRole("button", { name: "Conservar la imagen del servidor" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Reintentar sincronización" }));
    expect(await screen.findByText("Versión guardada.")).toBeVisible();
    expect(deleteCalls).toBe(1);
    expect(useBuilderStore.getState().document?.subtests[0]?.items[0]?.images).toHaveLength(1);

    unmount();
    queryClient.clear();
  });

  it("F3-FIX-8 (ALTO 2 UI): adjuntar otra imagen tras conflicto UNCERTAIN_IMAGE_OPERATION y pulsar «Conservar la imagen del servidor» marca obsoleto, pide resincronizar y conserva el File nuevo", async () => {
    let failReload = false;
    let putCalls = 0;
    let uploadedBody = "";
    let serverImage: {
      sourceImageId: number;
      resourceId: number;
      order: number;
      altText: string;
      storagePath: string;
      role: string;
    } | null = null;

    server.use(
      http.get(`${API}/scoring/strategies`, () => HttpResponse.json(ok([]))),
      http.get(`${API}/tests`, () => HttpResponse.json(ok([makeTestWire(1)]))),
      http.get(`${API}/tests/1/versions`, () =>
        HttpResponse.json(ok([makeVersionWire(10, "Lea con atención")])),
      ),
      http.get(`${API}/test-versions/10/subtests`, () => {
        if (failReload) {
          return HttpResponse.json({ success: false, message: "Recarga 503" }, { status: 503 });
        }
        return HttpResponse.json(ok([makeSubtestWire(20, "MEM", "Memoria Visual", 1)]));
      }),
      http.get(`${API}/subtests/20/clone-template`, () => {
        const tpl = makeTemplateWire(20, "MEM");
        (tpl.items[0] as { images: unknown[] }).images = serverImage ? [serverImage] : [];
        return HttpResponse.json(ok(tpl));
      }),
      http.get(`${API}/subtests/20/scoring-rules`, () =>
        HttpResponse.json(ok([makeRuleWire(80, 20)])),
      ),
      http.get(`${API}/test-versions/10/baremos`, () => HttpResponse.json(ok([]))),
      http.post(`${API}/items/201/images`, () => {
        serverImage = {
          sourceImageId: 88,
          resourceId: 905,
          order: 1,
          altText: "",
          storagePath: "test-config/items/201/550e8400-e29b-41d4-a716-446655440000-vieja.png",
          role: "ENUNCIADO",
        };
        failReload = true;
        return HttpResponse.json({ success: false, message: "503 tras POST" }, { status: 503 });
      }),
      http.put(`${API}/items/201/images/by-order/1`, async ({ request }) => {
        putCalls += 1;
        uploadedBody = await request.text();
        serverImage = {
          sourceImageId: 88,
          resourceId: 995,
          order: 1,
          altText: "",
          storagePath: "test-config/items/201/550e8400-e29b-41d4-a716-446655440001-nueva.png",
          role: "ENUNCIADO",
        };
        return HttpResponse.json(
          ok({
            imageLinkId: 88,
            resourceId: 995,
            storagePath: serverImage.storagePath,
            filename: "nueva.png",
            mimeType: "image/png",
            sizeBytes: 9,
            hash: "h-new",
            order: 1,
            altText: "",
            role: "ENUNCIADO",
          }),
        );
      }),
      http.get(`${API}/items/images/resources/905`, () =>
        new HttpResponse(new Blob(["old"], { type: "image/png" }), {
          status: 200,
          headers: { "Content-Type": "image/png" },
        }),
      ),
      http.get(`${API}/items/images/resources/995`, () =>
        new HttpResponse(new Blob(["new"], { type: "image/png" }), {
          status: 200,
          headers: { "Content-Type": "image/png" },
        }),
      ),
    );

    const { unmount, queryClient } = renderBuilder();
    await screen.findByRole("region", { name: "Editor de versión" });

    fireEvent.click(screen.getByRole("button", { name: /IT-1/i }));
    const itemImagesHeading = await screen.findByRole("heading", { name: "Imágenes de estímulo" });
    const itemImagesSection = itemImagesHeading.closest("section")!;
    const fileInput = within(itemImagesSection).getByLabelText("Seleccionar archivo de imagen");

    // 1. Adjuntar vieja.png y guardar -> POST 503 + recarga 503
    fireEvent.change(fileInput, {
      target: { files: [new File(["old-bytes"], "vieja.png", { type: "image/png" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));
    expect(await screen.findByText(/Reconciliación pendiente:/i)).toBeVisible();

    // 2. Eliminar vieja.png localmente y reintentar -> aparece UNCERTAIN_IMAGE_OPERATION
    fireEvent.click(within(itemImagesSection).getByRole("button", { name: "Eliminar imagen" }));
    failReload = false;
    fireEvent.click(screen.getByRole("button", { name: "Reintentar sincronización" }));
    const keepServerBtn = await screen.findByRole("button", {
      name: "Conservar la imagen del servidor",
    });

    // 3. Adjuntar nueva.png en la posición libre antes de resolver el conflicto viejo
    const newFile = new File(["new-bytes"], "nueva.png", { type: "image/png" });
    fireEvent.change(within(itemImagesSection).getByLabelText("Seleccionar archivo de imagen"), {
      target: { files: [newFile] },
    });
    const attachedImgBeforeClick =
      useBuilderStore.getState().document?.subtests[0]?.items[0]?.images[0];
    expect(attachedImgBeforeClick?.fileName).toBe("nueva.png");
    const newPendingFileId = attachedImgBeforeClick!.pendingFileId!;
    expect(useBuilderStore.getState().getPendingFilesMap()[newPendingFileId]).toBe(newFile);

    // 4. Pulsar la resolución antigua «Conservar la imagen del servidor»
    fireEvent.click(keepServerBtn);

    // El conflicto queda marcado como obsoleto, pide resincronización y NO destruye nueva.png ni su File
    expect(await screen.findByText(/Conflicto obsoleto/i)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Conservar la imagen del servidor" }),
    ).not.toBeInTheDocument();
    expect(useBuilderStore.getState().reconciliationPending).toBe(true);
    expect(useBuilderStore.getState().getPendingFilesMap()[newPendingFileId]).toBe(newFile);
    expect(useBuilderStore.getState().document?.subtests[0]?.items[0]?.images[0]).toMatchObject({
      fileName: "nueva.png",
      pendingFileId: newPendingFileId,
      status: "CREATED",
    });

    // 5. Reintentar sincronización reconcilia con nueva.png y permite aplicar PUT con nueva.png
    fireEvent.click(screen.getByRole("button", { name: "Reintentar sincronización" }));
    const applyNewBtn = await screen.findByRole("button", { name: "Aplicar mi cambio" });
    fireEvent.click(applyNewBtn);
    fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));

    expect(await screen.findByText("Versión guardada.")).toBeVisible();
    expect(putCalls).toBe(1);
    expect(uploadedBody).toContain('filename="nueva.png"');
    expect(uploadedBody).toContain("new-bytes");

    unmount();
    queryClient.clear();
  });
});
