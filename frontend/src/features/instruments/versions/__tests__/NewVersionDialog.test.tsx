import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { TestVersion } from "../../../../api/schemas/instruments";
import { useStaffAuth } from "../../../../store/staffAuth";
import { server } from "../../../../test/msw/server";
import { NewVersionDialog } from "../NewVersionDialog";

const API = "http://localhost:8080";

const ok = <T,>(data: T) => ({
  success: true,
  data,
  message: "OK",
  error: null,
  correlationId: "cid-test",
});

const SOURCE_VERSION: TestVersion = {
  id: 10,
  testId: 1,
  strategyId: 1,
  number: "1.0",
  status: "PUBLICADO",
  instructions: "Inst",
  timeLimitSeconds: 900,
  randomizeSubtests: false,
  randomizeItems: true,
  approvedById: null,
  approvedAt: null,
  publishedAt: null,
  createdById: null,
  createdAt: "2026-06-26T10:00:00.000Z",
};

describe("NewVersionDialog — preflight ALTO 2 y MEDIO 4", () => {
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
  });

  afterEach(() => {
    useStaffAuth.getState().clear();
    vi.restoreAllMocks();
  });

  it("detecta reglas no copiables y baremos por dimensión ANTES de crear el borrador y pide confirmación", async () => {
    let createVersionCalls = 0;

    server.use(
      http.get(`${API}/scoring/strategies`, () => HttpResponse.json(ok([]))),
      http.get(`${API}/tests`, () =>
        HttpResponse.json(
          ok([
            {
              id: 1,
              codigoTest: "BFA",
              nombreTest: "BFA",
              descripcion: "Desc",
              creadoPorId: "u1",
              estado: "ACTIVO",
              creadoEn: "2026-06-26T10:00:00.000Z",
            },
          ]),
        ),
      ),
      http.get(`${API}/tests/1/versions`, () =>
        HttpResponse.json(
          ok([
            {
              id: 10,
              testId: 1,
              estrategiaCalificacionId: 1,
              numeroVersion: "1.0",
              estado: "PUBLICADO",
              instruccionesGenerales: "Inst",
              tiempoLimiteSegundos: 900,
              permiteAleatorizarSubtests: false,
              permiteAleatorizarItems: true,
              aprobadoPorId: null,
              aprobadoEn: null,
              publicadoEn: null,
              creadoPorId: "u1",
              creadoEn: "2026-06-26T10:00:00.000Z",
            },
          ]),
        ),
      ),
      http.get(`${API}/test-versions/10/subtests`, () =>
        HttpResponse.json(
          ok([
            {
              id: 20,
              versionTestId: 10,
              estrategiaCalificacionId: 1,
              codigoSubtest: "FI",
              nombreSubtest: "Figuras idénticas",
              descripcion: "Desc",
              instrucciones: "Inst",
              numeroOrden: 1,
              tiempoLimiteSegundos: 180,
              permiteAleatorizarItems: true,
              permiteAleatorizarOpciones: false,
              esObligatorio: true,
              estado: "ACTIVO",
            },
          ]),
        ),
      ),
      http.get(`${API}/subtests/20/clone-template`, () =>
        HttpResponse.json(
          ok({
            sourceSubtestId: 20,
            code: "FI",
            name: "Figuras idénticas",
            description: "Desc",
            instructions: "Inst",
            order: 1,
            timeLimitSeconds: 180,
            randomizeItems: true,
            randomizeOptions: false,
            required: true,
            strategyId: 1,
            estado: "ACTIVO",
            items: [],
          }),
        ),
      ),
      http.get(`${API}/subtests/20/scoring-rules`, () =>
        HttpResponse.json(
          ok([
            {
              id: 88,
              versionTestId: 10,
              subtestId: 20,
              itemId: null,
              estrategiaCalificacionId: 2,
              tipoRegla: "OPCION_DIMENSION",
              prioridad: 2,
              activa: true,
              estado: "PUBLICADO",
              parametros: "{}",
              observacion: null,
              creadoPorId: "u1",
              creadoEn: "2026-06-26T10:00:00.000Z",
              aprobadoPorId: null,
              aprobadoEn: null,
            },
          ]),
        ),
      ),
      http.get(`${API}/test-versions/10/baremos`, () =>
        HttpResponse.json(
          ok([
            {
              id: 1,
              versionTestId: 10,
              dimensionResultadoId: 1,
              codigoBaremo: "BAR-FI",
              nombre: "Baremo Figuras",
              descripcion: "Desc",
              grupoNormativo: "General",
              criterioEdadMinima: null,
              criterioEdadMaxima: null,
              criterioSexoId: null,
              criterioCarreraId: null,
              vigenteDesde: null,
              vigenteHasta: null,
              estado: "PUBLICADO",
              creadoPorId: "u1",
              creadoEn: "2026-06-26T10:00:00.000Z",
              aprobadoPorId: null,
              aprobadoEn: null,
            },
          ]),
        ),
      ),
      http.get(`${API}/baremos/1/ranges`, () => HttpResponse.json(ok([]))),
      http.post(`${API}/tests/1/versions`, () => {
        createVersionCalls += 1;
        return HttpResponse.json(
          ok({
            id: 200,
            testId: 1,
            estrategiaCalificacionId: 1,
            numeroVersion: "1.1",
            estado: "BORRADOR",
            instruccionesGenerales: "Inst",
            tiempoLimiteSegundos: 900,
            permiteAleatorizarSubtests: false,
            permiteAleatorizarItems: true,
            aprobadoPorId: null,
            aprobadoEn: null,
            publicadoEn: null,
            creadoPorId: "u1",
            creadoEn: "2026-06-26T10:00:00.000Z",
          }),
        );
      }),
      http.post(`${API}/test-versions/200/configuration`, () =>
        HttpResponse.json(
          ok([
            {
              id: 300,
              versionTestId: 200,
              estrategiaCalificacionId: 1,
              codigoSubtest: "FI",
              nombreSubtest: "Figuras idénticas",
              descripcion: "Desc",
              instrucciones: "Inst",
              numeroOrden: 1,
              tiempoLimiteSegundos: 180,
              permiteAleatorizarItems: true,
              permiteAleatorizarOpciones: false,
              esObligatorio: true,
              estado: "ACTIVO",
            },
          ]),
        ),
      ),
    );

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onCreated = vi.fn();

    render(
      <QueryClientProvider client={queryClient}>
        <NewVersionDialog
          testId={1}
          source={SOURCE_VERSION}
          versions={[SOURCE_VERSION]}
          onClose={vi.fn()}
          onCreated={onCreated}
        />
      </QueryClientProvider>,
    );

    // Esperar a que termine el preflight ANTES de crear borrador
    expect(await screen.findByText(/Elementos que se omitirán al clonar/i)).toBeVisible();
    expect(screen.getAllByText(/OPCION_DIMENSION/)[0]).toBeVisible();
    expect(screen.getByText(/BAR-FI/)).toBeVisible();
    expect(createVersionCalls).toBe(0);

    fireEvent.change(screen.getByLabelText("Número de versión"), { target: { value: "1.1" } });

    const submitBtn = screen.getByRole("button", { name: /Confirmar y crear borrador/i });
    expect(submitBtn).toBeDisabled();

    // Confirmar explícitamente las omisiones
    fireEvent.click(
      screen.getByLabelText(/Confirmo crear el borrador omitiendo los elementos indicados/i),
    );
    expect(submitBtn).toBeEnabled();

    fireEvent.click(submitBtn);
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(createVersionCalls).toBe(1);
    expect(onCreated.mock.calls[0]?.[1]?.length).toBeGreaterThanOrEqual(2);

    queryClient.clear();
  });

  it("F3-FIX-2 (Hallazgo 2): si un baremo del origen cambia entre el aviso y el envío, NO llama createVersion y muestra el plan nuevo para reconfirmar", async () => {
    let createVersionCalls = 0;
    let baremoInspectionPhase = 0;

    server.use(
      http.get(`${API}/scoring/strategies`, () => HttpResponse.json(ok([]))),
      http.get(`${API}/tests`, () =>
        HttpResponse.json(
          ok([
            {
              id: 1,
              codigoTest: "BFA",
              nombreTest: "BFA",
              descripcion: "Desc",
              creadoPorId: "u1",
              estado: "ACTIVO",
              creadoEn: "2026-06-26T10:00:00.000Z",
            },
          ]),
        ),
      ),
      http.get(`${API}/tests/1/versions`, () =>
        HttpResponse.json(
          ok([
            {
              id: 10,
              testId: 1,
              estrategiaCalificacionId: 1,
              numeroVersion: "1.0",
              estado: "PUBLICADO",
              instruccionesGenerales: "Inst",
              tiempoLimiteSegundos: 900,
              permiteAleatorizarSubtests: false,
              permiteAleatorizarItems: true,
              aprobadoPorId: null,
              aprobadoEn: null,
              publicadoEn: null,
              creadoPorId: "u1",
              creadoEn: "2026-06-26T10:00:00.000Z",
            },
          ]),
        ),
      ),
      http.get(`${API}/test-versions/10/subtests`, () =>
        HttpResponse.json(
          ok([
            {
              id: 20,
              versionTestId: 10,
              estrategiaCalificacionId: 1,
              codigoSubtest: "FI",
              nombreSubtest: "Figuras idénticas",
              descripcion: "Desc",
              instrucciones: "Inst",
              numeroOrden: 1,
              tiempoLimiteSegundos: 180,
              permiteAleatorizarItems: true,
              permiteAleatorizarOpciones: false,
              esObligatorio: true,
              estado: "ACTIVO",
            },
          ]),
        ),
      ),
      http.get(`${API}/subtests/20/clone-template`, () =>
        HttpResponse.json(
          ok({
            sourceSubtestId: 20,
            code: "FI",
            name: "Figuras idénticas",
            description: "Desc",
            instructions: "Inst",
            order: 1,
            timeLimitSeconds: 180,
            randomizeItems: true,
            randomizeOptions: false,
            required: true,
            strategyId: 1,
            estado: "ACTIVO",
            items: [],
          }),
        ),
      ),
      http.get(`${API}/subtests/20/scoring-rules`, () => HttpResponse.json(ok([]))),
      http.get(`${API}/test-versions/10/baremos`, () => {
        baremoInspectionPhase += 1;
        if (baremoInspectionPhase === 1) {
          return HttpResponse.json(
            ok([
              {
                id: 1,
                versionTestId: 10,
                dimensionResultadoId: 1,
                codigoBaremo: "BAR-FI",
                nombre: "Baremo Figuras",
                descripcion: "Desc",
                grupoNormativo: "General",
                criterioEdadMinima: null,
                criterioEdadMaxima: null,
                criterioSexoId: null,
                criterioCarreraId: null,
                vigenteDesde: null,
                vigenteHasta: null,
                estado: "PUBLICADO",
                creadoPorId: "u1",
                creadoEn: "2026-06-26T10:00:00.000Z",
                aprobadoPorId: null,
                aprobadoEn: null,
              },
            ]),
          );
        }
        return HttpResponse.json(
          ok([
            {
              id: 1,
              versionTestId: 10,
              dimensionResultadoId: 1,
              codigoBaremo: "BAR-FI",
              nombre: "Baremo Figuras",
              descripcion: "Desc",
              grupoNormativo: "General",
              criterioEdadMinima: null,
              criterioEdadMaxima: null,
              criterioSexoId: null,
              criterioCarreraId: null,
              vigenteDesde: null,
              vigenteHasta: null,
              estado: "PUBLICADO",
              creadoPorId: "u1",
              creadoEn: "2026-06-26T10:00:00.000Z",
              aprobadoPorId: null,
              aprobadoEn: null,
            },
            {
              id: 2,
              versionTestId: 10,
              dimensionResultadoId: 2,
              codigoBaremo: "BAR-DES",
              nombre: "Baremo Desplazamiento",
              descripcion: "Desc",
              grupoNormativo: "General",
              criterioEdadMinima: null,
              criterioEdadMaxima: null,
              criterioSexoId: null,
              criterioCarreraId: null,
              vigenteDesde: null,
              vigenteHasta: null,
              estado: "PUBLICADO",
              creadoPorId: "u1",
              creadoEn: "2026-06-26T10:00:00.000Z",
              aprobadoPorId: null,
              aprobadoEn: null,
            },
          ]),
        );
      }),
      http.get(`${API}/baremos/1/ranges`, () => HttpResponse.json(ok([]))),
      http.get(`${API}/baremos/2/ranges`, () => HttpResponse.json(ok([]))),
      http.post(`${API}/tests/1/versions`, () => {
        createVersionCalls += 1;
        return HttpResponse.json(
          ok({
            id: 200,
            testId: 1,
            estrategiaCalificacionId: 1,
            numeroVersion: "1.1",
            estado: "BORRADOR",
            instruccionesGenerales: "Inst",
            tiempoLimiteSegundos: 900,
            permiteAleatorizarSubtests: false,
            permiteAleatorizarItems: true,
            aprobadoPorId: null,
            aprobadoEn: null,
            publicadoEn: null,
            creadoPorId: "u1",
            creadoEn: "2026-06-26T10:00:00.000Z",
          }),
        );
      }),
      http.post(`${API}/test-versions/200/configuration`, () =>
        HttpResponse.json(
          ok([
            {
              id: 300,
              versionTestId: 200,
              estrategiaCalificacionId: 1,
              codigoSubtest: "FI",
              nombreSubtest: "Figuras idénticas",
              descripcion: "Desc",
              instrucciones: "Inst",
              numeroOrden: 1,
              tiempoLimiteSegundos: 180,
              permiteAleatorizarItems: true,
              permiteAleatorizarOpciones: false,
              esObligatorio: true,
              estado: "ACTIVO",
            },
          ]),
        ),
      ),
    );

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onCreated = vi.fn();

    render(
      <QueryClientProvider client={queryClient}>
        <NewVersionDialog
          testId={1}
          source={SOURCE_VERSION}
          versions={[SOURCE_VERSION]}
          onClose={vi.fn()}
          onCreated={onCreated}
        />
      </QueryClientProvider>,
    );

    // 1. Primer plan: solo BAR-FI
    expect(await screen.findByText(/BAR-FI/)).toBeVisible();
    expect(screen.queryByText(/BAR-DES/)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Número de versión"), { target: { value: "1.1" } });
    fireEvent.click(
      screen.getByLabelText(/Confirmo crear el borrador omitiendo los elementos indicados/i),
    );

    // 2. Enviar mientras en el origen apareció BAR-DES -> no crea versión y muestra plan nuevo
    fireEvent.click(screen.getByRole("button", { name: /Confirmar y crear borrador/i }));

    expect((await screen.findAllByText(/BAR-DES/)).length).toBeGreaterThanOrEqual(1);
    expect(createVersionCalls).toBe(0);
    expect(onCreated).not.toHaveBeenCalled();

    const confirmCheckbox = screen.getByLabelText(
      /Confirmo crear el borrador omitiendo los elementos indicados/i,
    ) as HTMLInputElement;
    expect(confirmCheckbox.checked).toBe(false);
    expect(screen.getByRole("button", { name: /Confirmar y crear borrador/i })).toBeDisabled();

    // 3. Confirmar el nuevo plan y reenviar -> ahora sí crea la versión
    fireEvent.click(confirmCheckbox);
    fireEvent.click(screen.getByRole("button", { name: /Confirmar y crear borrador/i }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(createVersionCalls).toBe(1);

    queryClient.clear();
  });

  it("F3-FIX-3 (MEDIO): confirmar BAR-FI -> refetch que añade BAR-DES desmarca la casilla, muestra la diferencia e impide enviar hasta reconfirmar", async () => {
    let createVersionCalls = 0;
    let baremoInspectionPhase = 0;
    const cloneSpy = vi.spyOn(
      await import("../../document/adapters"),
      "cloneVersionFromSource",
    );

    server.use(
      http.get(`${API}/scoring/strategies`, () => HttpResponse.json(ok([]))),
      http.get(`${API}/tests`, () =>
        HttpResponse.json(
          ok([
            {
              id: 1,
              codigoTest: "BFA",
              nombreTest: "BFA",
              descripcion: "Desc",
              creadoPorId: "u1",
              estado: "ACTIVO",
              creadoEn: "2026-06-26T10:00:00.000Z",
            },
          ]),
        ),
      ),
      http.get(`${API}/tests/1/versions`, () =>
        HttpResponse.json(
          ok([
            {
              id: 10,
              testId: 1,
              estrategiaCalificacionId: 1,
              numeroVersion: "1.0",
              estado: "PUBLICADO",
              instruccionesGenerales: "Inst",
              tiempoLimiteSegundos: 900,
              permiteAleatorizarSubtests: false,
              permiteAleatorizarItems: true,
              aprobadoPorId: null,
              aprobadoEn: null,
              publicadoEn: null,
              creadoPorId: "u1",
              creadoEn: "2026-06-26T10:00:00.000Z",
            },
          ]),
        ),
      ),
      http.get(`${API}/test-versions/10/subtests`, () =>
        HttpResponse.json(
          ok([
            {
              id: 20,
              versionTestId: 10,
              estrategiaCalificacionId: 1,
              codigoSubtest: "FI",
              nombreSubtest: "Figuras idénticas",
              descripcion: "Desc",
              instrucciones: "Inst",
              numeroOrden: 1,
              tiempoLimiteSegundos: 180,
              permiteAleatorizarItems: true,
              permiteAleatorizarOpciones: false,
              esObligatorio: true,
              estado: "ACTIVO",
            },
          ]),
        ),
      ),
      http.get(`${API}/subtests/20/clone-template`, () =>
        HttpResponse.json(
          ok({
            sourceSubtestId: 20,
            code: "FI",
            name: "Figuras idénticas",
            description: "Desc",
            instructions: "Inst",
            order: 1,
            timeLimitSeconds: 180,
            randomizeItems: true,
            randomizeOptions: false,
            required: true,
            strategyId: 1,
            estado: "ACTIVO",
            items: [],
          }),
        ),
      ),
      http.get(`${API}/subtests/20/scoring-rules`, () => HttpResponse.json(ok([]))),
      http.get(`${API}/test-versions/10/baremos`, () => {
        baremoInspectionPhase += 1;
        const barFi = {
          id: 1,
          versionTestId: 10,
          dimensionResultadoId: 1,
          codigoBaremo: "BAR-FI",
          nombre: "Baremo Figuras",
          descripcion: "Desc",
          grupoNormativo: "General",
          criterioEdadMinima: null,
          criterioEdadMaxima: null,
          criterioSexoId: null,
          criterioCarreraId: null,
          vigenteDesde: null,
          vigenteHasta: null,
          estado: "PUBLICADO",
          creadoPorId: "u1",
          creadoEn: "2026-06-26T10:00:00.000Z",
          aprobadoPorId: null,
          aprobadoEn: null,
        };
        if (baremoInspectionPhase === 1) {
          return HttpResponse.json(ok([barFi]));
        }
        return HttpResponse.json(
          ok([
            barFi,
            {
              ...barFi,
              id: 2,
              dimensionResultadoId: 2,
              codigoBaremo: "BAR-DES",
              nombre: "Baremo Desplazamiento",
            },
          ]),
        );
      }),
      http.get(`${API}/baremos/1/ranges`, () => HttpResponse.json(ok([]))),
      http.get(`${API}/baremos/2/ranges`, () => HttpResponse.json(ok([]))),
      http.post(`${API}/tests/1/versions`, () => {
        createVersionCalls += 1;
        return HttpResponse.json(
          ok({
            id: 200,
            testId: 1,
            estrategiaCalificacionId: 1,
            numeroVersion: "1.1",
            estado: "BORRADOR",
            instruccionesGenerales: "Inst",
            tiempoLimiteSegundos: 900,
            permiteAleatorizarSubtests: false,
            permiteAleatorizarItems: true,
            aprobadoPorId: null,
            aprobadoEn: null,
            publicadoEn: null,
            creadoPorId: "u1",
            creadoEn: "2026-06-26T10:00:00.000Z",
          }),
        );
      }),
      http.post(`${API}/test-versions/200/configuration`, () =>
        HttpResponse.json(
          ok([
            {
              id: 300,
              versionTestId: 200,
              estrategiaCalificacionId: 1,
              codigoSubtest: "FI",
              nombreSubtest: "Figuras idénticas",
              descripcion: "Desc",
              instrucciones: "Inst",
              numeroOrden: 1,
              tiempoLimiteSegundos: 180,
              permiteAleatorizarItems: true,
              permiteAleatorizarOpciones: false,
              esObligatorio: true,
              estado: "ACTIVO",
            },
          ]),
        ),
      ),
    );

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onCreated = vi.fn();

    render(
      <QueryClientProvider client={queryClient}>
        <NewVersionDialog
          testId={1}
          source={SOURCE_VERSION}
          versions={[SOURCE_VERSION]}
          onClose={vi.fn()}
          onCreated={onCreated}
        />
      </QueryClientProvider>,
    );

    // 1. Confirmar BAR-FI
    expect(await screen.findByText(/BAR-FI/)).toBeVisible();
    expect(screen.queryByText(/BAR-DES/)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Número de versión"), { target: { value: "1.1" } });
    const confirmCheckbox = screen.getByLabelText(
      /Confirmo crear el borrador omitiendo los elementos indicados/i,
    ) as HTMLInputElement;
    fireEvent.click(confirmCheckbox);
    expect(confirmCheckbox.checked).toBe(true);
    expect(screen.getByRole("button", { name: /Confirmar y crear borrador/i })).toBeEnabled();

    // 2. Refetch en segundo plano añade BAR-DES
    await queryClient.refetchQueries();

    expect(await screen.findByText(/Nuevo elemento omitido:.*BAR-DES/i)).toBeVisible();
    expect(confirmCheckbox.checked).toBe(false);
    const submitBtn = screen.getByRole("button", { name: /Confirmar y crear borrador/i });
    expect(submitBtn).toBeDisabled();

    // 3. Intentar enviar con la confirmación vieja es imposible (incluso enviando el form directo)
    const form = submitBtn.closest("form")!;
    fireEvent.submit(form);
    expect(cloneSpy).not.toHaveBeenCalled();
    expect(createVersionCalls).toBe(0);

    // 4. Reconfirmar con BAR-FI + BAR-DES y ahora sí envía con la firma confirmada nueva
    fireEvent.click(confirmCheckbox);
    expect(confirmCheckbox.checked).toBe(true);
    expect(submitBtn).toBeEnabled();
    fireEvent.click(submitBtn);

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(createVersionCalls).toBe(1);
    expect(cloneSpy).toHaveBeenCalledTimes(1);
    const sentSignature = cloneSpy.mock.calls[0]?.[0].expectedPlanSignature;
    const { getVersionClonePlanSignature, inspectVersionClonePlan } = await import(
      "../../document/adapters"
    );
    baremoInspectionPhase = 0;
    const oldPlan = await inspectVersionClonePlan(1, 10, { targetStrategyId: 1 });
    const newPlan = await inspectVersionClonePlan(1, 10, { targetStrategyId: 1 });
    const oldSignature = getVersionClonePlanSignature(oldPlan);
    const newSignature = getVersionClonePlanSignature(newPlan);
    expect(sentSignature).toBe(newSignature);
    expect(sentSignature).not.toBe(oldSignature);

    queryClient.clear();
  });
});
