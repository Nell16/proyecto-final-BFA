import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";

import { routeTree } from "../../../routeTree.gen";
import { useParticipantAuth } from "../../../store/participantAuth";
import { server } from "../../../test/msw/server";
import { setNavigator } from "../../../api/client";
import { clearPendingAccessError } from "../accessError";
import { useRuntimeDraft } from "../draft";
import { resetDraftSyncForTests } from "../draft/sync";
import { EDIT_LOCK_GRACE_MS } from "../RunnerContext";
import { evaluationGuard } from "../evaluation-guard";

const API = "http://localhost:8080";

function ok<T>(data: T, status = 200) {
  return HttpResponse.json({ success: true, data, correlationId: "test-cid" }, { status });
}

function apiErr(status: number, code: string, message: string) {
  return HttpResponse.json(
    { success: false, data: null, error: { code, message }, correlationId: "test-err" },
    { status },
  );
}

interface SubtestWire {
  subtestId: number;
  code: string;
  name: string;
  instructions: string | null;
  order: number;
  timeLimitSeconds: number | null;
  randomizeItems: boolean;
  randomizeOptions: boolean;
  status: string;
  startedAt?: string | null;
  remainingSeconds?: number | null;
  paused?: boolean;
  serverNow?: string | null;
  items: Array<{
    itemId: number;
    code: string;
    itemType: string;
    responseType: string;
    prompt: string;
    instruction: string | null;
    order: number;
    images: Array<{ imageId: number; url: string; altText?: string; order: number }>;
    options: Array<{
      optionId: number;
      code: string;
      text: string;
      order: number;
      images: Array<{ imageId: number; url: string; altText?: string; order: number }>;
    }>;
    savedAnswer?: {
      selectedOptionIds: number[];
      textAnswer?: string | null;
      numericAnswer?: number | null;
      timeUsedSeconds?: number | null;
    } | null;
  }>;
}

function makeSubtestWire(
  id: number,
  order: number,
  status = "NO_INICIADO",
  extra: Partial<SubtestWire> = {},
): SubtestWire {
  return {
    subtestId: id,
    code: `ST-${id}`,
    name: `Subtest ${id}`,
    instructions: `Lea las instrucciones del subtest ${id}.`,
    order,
    timeLimitSeconds: 600,
    randomizeItems: false,
    randomizeOptions: false,
    status,
    items: [
      {
        itemId: id * 100 + 1,
        code: `IT-${id}-1`,
        itemType: "SOLO_TEXTO",
        responseType: "OPCION_UNICA",
        prompt: `Pregunta 1 del subtest ${id}`,
        instruction: null,
        order: 1,
        images: [],
        options: [
          { optionId: id * 1000 + 1, code: "A", text: "Opción A1", order: 1, images: [] },
          { optionId: id * 1000 + 2, code: "B", text: "Opción B1", order: 2, images: [] },
        ],
      },
      {
        itemId: id * 100 + 2,
        code: `IT-${id}-2`,
        itemType: "SOLO_TEXTO",
        responseType: "OPCION_UNICA",
        prompt: `Pregunta 2 del subtest ${id}`,
        instruction: null,
        order: 2,
        images: [],
        options: [
          { optionId: id * 1000 + 3, code: "A", text: "Opción A2", order: 1, images: [] },
          { optionId: id * 1000 + 4, code: "B", text: "Opción B2", order: 2, images: [] },
        ],
      },
    ],
    ...extra,
  };
}

function makeEvaluationWire(overrides: Record<string, unknown> = {}) {
  return {
    id: 101,
    assignmentId: 42,
    sessionId: 7,
    participantDisplayName: "Ana Pérez",
    sessionName: "Sesión Cohorte 2026",
    sessionStatus: "ABIERTA",
    pausedAt: null,
    attemptStatus: "EN_PROGRESO",
    subtests: [makeSubtestWire(10, 1, "EN_PROGRESO"), makeSubtestWire(20, 2, "NO_INICIADO")],
    ...overrides,
  };
}

/** Instante en el que los tests con reloj falso fijan `Date.now()`. */
const FAKE_T0 = Date.parse("2026-11-25T12:00:00.000Z");

/**
 * Timing de /yo «realista» (F2-FIX-3): al vencer el plazo local el runner CONSULTA al servidor antes de cerrar, así que
 * el mock debe comportarse como el backend: los segundos restantes bajan con el reloj desde `FAKE_T0`.
 */
function liveTiming(remainingAtStart: number, extraSeconds = 0) {
  return {
    remainingSeconds: Math.max(0, Math.ceil(remainingAtStart + extraSeconds - (Date.now() - FAKE_T0) / 1000)),
    serverNow: new Date(Date.now()).toISOString(),
  };
}

async function renderRunnerAt(initialPath: string, queryClient?: QueryClient) {
  const qc =
    queryClient ??
    new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
      },
    });
  const history = createMemoryHistory({ initialEntries: [initialPath] });
  const router = createRouter({
    routeTree,
    history,
    context: { queryClient: qc },
  });
  setNavigator(
    (options) => router.navigate(options as Parameters<typeof router.navigate>[0]),
    () => router.state.location.href,
  );
  await router.load();
  const utils = render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...utils, router, history, queryClient: qc };
}

describe("Runner del participante (R-04)", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    vi.stubGlobal("alert", vi.fn(() => {
      throw new Error("window.alert está prohibido");
    }));
    vi.stubGlobal("confirm", vi.fn(() => {
      throw new Error("window.confirm está prohibido");
    }));
    sessionStorage.clear();
    clearPendingAccessError();
    useParticipantAuth.getState().clear();
    resetDraftSyncForTests();
    useRuntimeDraft.getState().clearDraft();
  });

  afterEach(() => {
    setNavigator(null);
    vi.useRealTimers();
    vi.unstubAllGlobals();
    clearPendingAccessError();
    resetDraftSyncForTests();
    useRuntimeDraft.getState().clearDraft();
    useParticipantAuth.getState().clear();
    sessionStorage.clear();
  });

  it("entrada por /evaluacion/$code canjea el token con replace sin dejarlo en el historial ni en el DOM", async () => {
    let seenValidate: unknown;
    server.use(
      http.post(`${API}/acceso-participante/validar`, async ({ request }) => {
        seenValidate = await request.json();
        return ok({
          assignmentId: 42,
          participantId: "550e8400-e29b-41d4-a716-446655440000",
          accessToken: "jwt-secret-token",
          tokenType: "Bearer",
        });
      }),
      http.get(`${API}/evaluacion-participante/yo`, () =>
        ok(makeEvaluationWire({ id: null, attemptStatus: "NO_INICIADO", subtests: [makeSubtestWire(10, 1)] })),
      ),
    );

    const { router, history, container } = await renderRunnerAt("/evaluacion/42-mi-token-secreto");

    expect(await screen.findByText("Bienvenido/a a la evaluación UAM SIAT")).toBeInTheDocument();
    expect(seenValidate).toEqual({ assignmentId: 42, token: "mi-token-secreto" });
    expect(router.state.location.pathname).toBe("/evaluacion/sesion");
    expect(history.location.pathname).toBe("/evaluacion/sesion");
    // El token fue reemplazado en el historial (no queda atrás) y jamás aparece en el DOM
    expect(history.length).toBe(1);
    expect(container.textContent).not.toContain("mi-token-secreto");
    expect(container.textContent).not.toContain("jwt-secret-token");
    expect(useParticipantAuth.getState()).toMatchObject({
      token: "jwt-secret-token",
      assignmentId: 42,
    });
  });

  it("acceso manual por /evaluacion/acceso guarda auth, limpia caché previa y navega sin token en URL", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(["runtime", "evaluation", 99], makeEvaluationWire({ assignmentId: 99 }));

    server.use(
      http.post(`${API}/acceso-participante/validar`, () =>
        ok({
          assignmentId: 42,
          participantId: "uuid-42",
          accessToken: "jwt-42",
          tokenType: "Bearer",
        }),
      ),
      http.get(`${API}/evaluacion-participante/yo`, () =>
        ok(makeEvaluationWire({ id: null, attemptStatus: "NO_INICIADO", subtests: [makeSubtestWire(10, 1)] })),
      ),
    );

    const { router } = await renderRunnerAt("/evaluacion/acceso", qc);

    const input = await screen.findByLabelText("Código de acceso");
    fireEvent.change(input, { target: { value: "42-clave-manual" } });
    fireEvent.click(screen.getByRole("button", { name: /continuar/i }));

    expect(await screen.findByText("Bienvenido/a a la evaluación UAM SIAT")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/evaluacion/sesion");
    expect(qc.getQueryData(["runtime", "evaluation", 99])).toBeUndefined();
  });

  it("guards de orden: bloquea sin sesión, subtest futuro, COMPLETADO, ANULADO, NO_INICIADO y hace clampOrdinal", async () => {
    // 1. Sin sesión -> redirige a /evaluacion/acceso
    const unauth = await renderRunnerAt("/evaluacion/sesion");
    await waitFor(() => expect(unauth.router.state.location.pathname).toBe("/evaluacion/acceso"));
    unauth.unmount();

    // Con sesión activa: subtest 10 COMPLETADO, 20 ANULADO, 30 EN_PROGRESO (2 ítems), 40 NO_INICIADO (futuro)
    useParticipantAuth.getState().setSession({ token: "jwt-42", assignmentId: 42 });
    server.use(
      http.get(`${API}/evaluacion-participante/yo`, () =>
        ok(
          makeEvaluationWire({
            subtests: [
              makeSubtestWire(10, 1, "COMPLETADO"),
              makeSubtestWire(20, 2, "ANULADO"),
              makeSubtestWire(30, 3, "EN_PROGRESO", {
                startedAt: new Date(Date.now() - 10_000).toISOString(),
                remainingSeconds: 590,
                serverNow: new Date().toISOString(),
              }),
              makeSubtestWire(40, 4, "NO_INICIADO"),
            ],
          }),
        ),
      ),
    );

    // 2. Subtest COMPLETADO -> redirige a /evaluacion/sesion
    const completed = await renderRunnerAt("/evaluacion/subtests/10/instrucciones");
    await waitFor(() => expect(completed.router.state.location.pathname).toBe("/evaluacion/sesion"));
    completed.unmount();

    // 3. Subtest ANULADO -> redirige a /evaluacion/sesion y la lista lo muestra no abrible
    const annulled = await renderRunnerAt("/evaluacion/subtests/20/instrucciones");
    await waitFor(() => expect(annulled.router.state.location.pathname).toBe("/evaluacion/sesion"));
    const annulledCard = (await screen.findByText("Subtest 20")).closest("[data-subtest-id]");
    expect(annulledCard).not.toBeNull();
    expect(within(annulledCard as HTMLElement).getByRole("button", { name: "Anulado" })).toBeDisabled();
    annulled.unmount();

    // 4. Subtest futuro (40) mientras 30 sigue EN_PROGRESO -> redirige a /evaluacion/sesion
    const future = await renderRunnerAt("/evaluacion/subtests/40/instrucciones");
    await waitFor(() => expect(future.router.state.location.pathname).toBe("/evaluacion/sesion"));
    future.unmount();

    // 5. Subtest NO_INICIADO directo a /items/1 -> redirige a instrucciones
    server.use(
      http.get(`${API}/evaluacion-participante/yo`, () =>
        ok(
          makeEvaluationWire({
            subtests: [makeSubtestWire(30, 1, "NO_INICIADO")],
          }),
        ),
      ),
    );
    const notStartedItem = await renderRunnerAt("/evaluacion/subtests/30/items/1");
    await waitFor(() =>
      expect(notStartedItem.router.state.location.pathname).toBe(
        "/evaluacion/subtests/30/instrucciones",
      ),
    );
    notStartedItem.unmount();

    // 6. Ordinal fuera de rango (99) -> clampOrdinal(99, 2) = 2
    server.use(
      http.get(`${API}/evaluacion-participante/yo`, () =>
        ok(
          makeEvaluationWire({
            subtests: [
              makeSubtestWire(30, 1, "EN_PROGRESO", {
                startedAt: new Date(Date.now() - 5_000).toISOString(),
                remainingSeconds: 595,
                serverNow: new Date().toISOString(),
              }),
            ],
          }),
        ),
      ),
    );
    const outOfRange = await renderRunnerAt("/evaluacion/subtests/30/items/99");
    await waitFor(() =>
      expect(outOfRange.router.state.location.pathname).toBe("/evaluacion/subtests/30/items/2"),
    );
    expect(await screen.findByText("Pregunta 2 del subtest 30")).toBeInTheDocument();
  });

  it("recarga a mitad de un subtest EN_PROGRESO conserva el deadline del servidor sin re-llamar startSubtest", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const T0 = Date.parse("2026-11-25T12:00:00.000Z");
    vi.setSystemTime(T0);

    useParticipantAuth.getState().setSession({ token: "jwt-42", assignmentId: 42 });
    let startSubtestCalls = 0;

    server.use(
      http.get(`${API}/evaluacion-participante/yo`, () =>
        ok(
          makeEvaluationWire({
            subtests: [
              makeSubtestWire(10, 1, "EN_PROGRESO", {
                timeLimitSeconds: 600,
                startedAt: "2026-11-25T11:55:00.000Z",
                remainingSeconds: 300,
                paused: false,
                serverNow: "2026-11-25T12:00:00.000Z",
                items: [],
              }),
            ],
          }),
        ),
      ),
      http.get(`${API}/intentos/101/subtests/10/items`, () =>
        ok(makeSubtestWire(10, 1, "EN_PROGRESO")),
      ),
      http.post(`${API}/intentos/101/subtests/10/iniciar`, () => {
        startSubtestCalls += 1;
        return ok({ id: 1, estado: "EN_PROGRESO" });
      }),
    );

    await renderRunnerAt("/evaluacion/subtests/10/items/2");

    expect(await screen.findByText("Pregunta 2 del subtest 10")).toBeInTheDocument();
    expect(startSubtestCalls).toBe(0);
    const timer = screen.getByRole("timer");
    expect(timer).toHaveTextContent("05:00");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(screen.getByRole("timer")).toHaveTextContent("04:55");
  });

  it("deadline vencido ejecuta flushBeforeFinish y finishSubtest aunque falle el flush, sin atascar", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const T0 = Date.parse("2026-11-25T12:00:00.000Z");
    vi.setSystemTime(T0);

    useParticipantAuth.getState().setSession({ token: "jwt-42", assignmentId: 42 });
    let bulkCalls = 0;
    let finishBody: unknown = null;
    let finished = false;

    server.use(
      http.get(`${API}/evaluacion-participante/yo`, () =>
        ok(
          makeEvaluationWire({
            subtests: [
              makeSubtestWire(10, 1, finished ? "COMPLETADO" : "EN_PROGRESO", {
                timeLimitSeconds: 10,
                startedAt: "2026-11-25T11:59:52.000Z",
                ...liveTiming(2),
                paused: false,
              }),
              makeSubtestWire(20, 2, "NO_INICIADO"),
            ],
          }),
        ),
      ),
      http.put(`${API}/intentos/101/items/1001/respuesta`, () =>
        apiErr(500, "SERVER_ERROR", "Fallo temporal"),
      ),
      http.post(`${API}/intentos/101/respuestas/bulk-sync`, () => {
        bulkCalls += 1;
        return apiErr(503, "UNAVAILABLE", "Sin conexión al flush");
      }),
      http.post(`${API}/intentos/101/subtests/10/finalizar`, async ({ request }) => {
        finishBody = await request.json();
        finished = true;
        return ok({
          id: 305,
          intentoId: 101,
          subtestId: 10,
          estado: "COMPLETADO",
          tiempoUsadoSegundos: 10,
        });
      }),
    );

    const { router } = await renderRunnerAt("/evaluacion/subtests/10/items/1");
    expect(await screen.findByText("Pregunta 1 del subtest 10")).toBeInTheDocument();

    // Selecciona una opción que falla al guardar -> queda en cola pendiente
    fireEvent.click(screen.getByRole("radio", { name: /Opción A1/i }));

    // Avanza 3 segundos para vencer el deadline de 2s
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });

    await waitFor(() => expect(router.state.location.pathname).toBe("/evaluacion/sesion"));
    expect(bulkCalls).toBeGreaterThanOrEqual(1);
    expect(finishBody).toEqual({ timeSeconds: 10 });
    expect(await screen.findByText("Subtests de la Evaluación")).toBeInTheDocument();
  });

  it("PAUSADA congela el cronómetro y ABIERTA reanuda automáticamente llamando resumeSync", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const T0 = Date.parse("2026-11-25T12:00:00.000Z");
    vi.setSystemTime(T0);

    useParticipantAuth.getState().setSession({ token: "jwt-42", assignmentId: 42 });
    let phase: "open1" | "paused" | "open2" = "open1";
    let syncedAfterResume = false;

    server.use(
      http.get(`${API}/evaluacion-participante/yo`, () => {
        if (phase === "open1") {
          return ok(
            makeEvaluationWire({
              sessionStatus: "ABIERTA",
              subtests: [
                makeSubtestWire(10, 1, "EN_PROGRESO", {
                  timeLimitSeconds: 600,
                  startedAt: "2026-11-25T11:55:00.000Z",
                  remainingSeconds: 300,
                  paused: false,
                  serverNow: new Date(Date.now()).toISOString(),
                }),
              ],
            }),
          );
        }
        if (phase === "paused") {
          return ok(
            makeEvaluationWire({
              sessionStatus: "PAUSADA",
              pausedAt: new Date(Date.now()).toISOString(),
              subtests: [
                makeSubtestWire(10, 1, "EN_PROGRESO", {
                  timeLimitSeconds: 600,
                  startedAt: "2026-11-25T11:55:00.000Z",
                  remainingSeconds: 290,
                  paused: true,
                  serverNow: new Date(Date.now()).toISOString(),
                }),
              ],
            }),
          );
        }
        return ok(
          makeEvaluationWire({
            sessionStatus: "ABIERTA",
            subtests: [
              makeSubtestWire(10, 1, "EN_PROGRESO", {
                timeLimitSeconds: 600,
                startedAt: "2026-11-25T11:55:00.000Z",
                remainingSeconds: 290,
                paused: false,
                serverNow: new Date(Date.now()).toISOString(),
              }),
            ],
          }),
        );
      }),
      http.put(`${API}/intentos/101/items/1001/respuesta`, () =>
        apiErr(409, "SESION_PAUSADA", "Sesión pausada"),
      ),
      http.post(`${API}/intentos/101/respuestas/bulk-sync`, () => {
        syncedAfterResume = true;
        return ok([{ itemId: 1001, status: "GUARDADA", code: null, answerId: 55 }]);
      }),
    );

    await renderRunnerAt("/evaluacion/subtests/10/items/1");
    expect(await screen.findByText("Pregunta 1 del subtest 10")).toBeInTheDocument();

    // Pasa a pausada vía polling (10s)
    phase = "paused";
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(await screen.findByText("Evaluación pausada")).toBeInTheDocument();
    expect(screen.getByText(/Tiempo restante congelado: 04:50/)).toBeInTheDocument();

    // Durante la pausa el tiempo NO avanza aunque pasen 20s
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9_000);
    });
    expect(screen.getByText(/Tiempo restante congelado: 04:50/)).toBeInTheDocument();

    // Simulamos respuesta en cola retenida durante la pausa y luego reanudación
    useRuntimeDraft.getState().setAnswerLocal(1001, { kind: "OPCION_UNICA", optionId: 10001 }, 4, 10);
    phase = "open2";

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });

    expect(await screen.findByText("Pregunta 1 del subtest 10")).toBeInTheDocument();
    expect(screen.getByRole("timer")).toHaveTextContent("04:50");
    await waitFor(() => expect(syncedAfterResume).toBe(true));
  });

  it.each([
    ["TOKEN_EXPIRADO", /expirado/i],
    ["SESION_FINALIZADA", /finalizada/i],
    ["ASIGNACION_NO_OPERABLE", /no operable/i],
  ])("bloqueo 409 %s muestra pantalla bloqueada clara", async (code, expectedRegex) => {
    useParticipantAuth.getState().setSession({ token: "jwt-42", assignmentId: 42 });
    server.use(
      http.get(`${API}/evaluacion-participante/yo`, () => apiErr(409, code, "Bloqueado")),
    );

    await renderRunnerAt("/evaluacion/sesion");
    expect(await screen.findByRole("heading", { name: expectedRegex })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Volver al inicio" })).toBeInTheDocument();
  });

  it("403 en /yo transiciona a ACCESS_REVOKED", async () => {
    useParticipantAuth.getState().setSession({ token: "jwt-42", assignmentId: 42 });
    server.use(
      http.get(`${API}/evaluacion-participante/yo`, () =>
        apiErr(403, "FORBIDDEN", "Acceso revocado"),
      ),
    );

    await renderRunnerAt("/evaluacion/sesion");
    expect(await screen.findByRole("heading", { name: "Acceso revocado" })).toBeInTheDocument();
  });

  it("navegación por teclado ←/→ entre ítems sin interferir con campos editables ni modales", async () => {
    useParticipantAuth.getState().setSession({ token: "jwt-42", assignmentId: 42 });
    const subtestWithOpenText = makeSubtestWire(10, 1, "EN_PROGRESO", {
      items: [
        {
          itemId: 1001,
          code: "IT-1",
          itemType: "SOLO_TEXTO",
          responseType: "OPCION_UNICA",
          prompt: "Ítem uno",
          instruction: null,
          order: 1,
          images: [],
          options: [
            { optionId: 1, code: "A", text: "Uno", order: 1, images: [] },
            { optionId: 2, code: "B", text: "Dos", order: 2, images: [] },
          ],
        },
        {
          itemId: 1002,
          code: "IT-2",
          itemType: "SOLO_TEXTO",
          responseType: "TEXTO_ABIERTO",
          prompt: "Ítem dos abierto",
          instruction: null,
          order: 2,
          images: [],
          options: [],
        },
      ],
    });

    server.use(
      http.get(`${API}/evaluacion-participante/yo`, () =>
        ok(makeEvaluationWire({ subtests: [subtestWithOpenText] })),
      ),
    );

    const { router } = await renderRunnerAt("/evaluacion/subtests/10/items/1");
    expect(await screen.findByRole("heading", { name: "Ítem uno" })).toBeInTheDocument();

    // → navega al ítem 2
    fireEvent.keyDown(window, { key: "ArrowRight" });
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/evaluacion/subtests/10/items/2"),
    );
    expect(await screen.findByRole("heading", { name: "Ítem dos abierto" })).toBeInTheDocument();

    // En el textarea editable, ← NO debe navegar atrás
    const textarea = screen.getByRole("textbox");
    textarea.focus();
    fireEvent.keyDown(textarea, { key: "ArrowLeft" });
    expect(router.state.location.pathname).toBe("/evaluacion/subtests/10/items/2");

    // Fuera del textarea, ← navega de regreso al ítem 1
    (document.activeElement as HTMLElement | null)?.blur?.();
    fireEvent.keyDown(document.body, { key: "ArrowLeft" });
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/evaluacion/subtests/10/items/1"),
    );
  });

  it("mide timeUsedSeconds y timeSeconds reales, muestra resumen con pendientes/rechazadas en ConfirmDialog y completa el intento", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const T0 = Date.parse("2026-11-25T12:00:00.000Z");
    vi.setSystemTime(T0);

    useParticipantAuth.getState().setSession({ token: "jwt-42", assignmentId: 42 });

    const putBodies: Array<{ itemId: number; timeUsedSeconds?: number }> = [];
    let finishSubtestPayload: unknown = null;
    let finishAttemptPayload: unknown = null;
    let attemptStarted = false;
    let subtestFinished = false;

    server.use(
      http.get(`${API}/evaluacion-participante/yo`, () =>
        ok(
          makeEvaluationWire({
            id: attemptStarted ? 101 : null,
            attemptStatus: attemptStarted ? "EN_PROGRESO" : "NO_INICIADO",
            subtests: [
              makeSubtestWire(10, 1, subtestFinished ? "COMPLETADO" : attemptStarted ? "EN_PROGRESO" : "NO_INICIADO", {
                timeLimitSeconds: null,
              }),
            ],
          }),
        ),
      ),
      http.post(`${API}/evaluacion-participante/iniciar`, () => {
        attemptStarted = true;
        return ok({
          id: 101,
          asignacionId: 42,
          iniciadoEn: new Date(Date.now()).toISOString(),
          estado: "EN_PROGRESO",
        });
      }),
      http.post(`${API}/intentos/101/subtests/10/iniciar`, () =>
        ok({
          id: 305,
          intentoId: 101,
          subtestId: 10,
          estado: "EN_PROGRESO",
          startedAt: new Date(Date.now()).toISOString(),
          timeLimitSeconds: null,
          serverNow: new Date(Date.now()).toISOString(),
        }),
      ),
      http.put(`${API}/intentos/101/items/1001/respuesta`, async ({ request }) => {
        const body = (await request.json()) as { itemId: number; timeUsedSeconds?: number };
        putBodies.push(body);
        return ok({
          id: 901,
          intentoId: 101,
          itemId: 1001,
          respondidoEn: new Date(Date.now()).toISOString(),
          tiempoUsadoSegundos: body.timeUsedSeconds ?? 0,
        });
      }),
      http.put(`${API}/intentos/101/items/1002/respuesta`, async ({ request }) => {
        const body = (await request.json()) as { itemId: number; timeUsedSeconds?: number };
        putBodies.push(body);
        return apiErr(400, "BAD_REQUEST", "Respuesta inválida en ítem 2");
      }),
      http.post(`${API}/intentos/101/subtests/10/finalizar`, async ({ request }) => {
        finishSubtestPayload = await request.json();
        subtestFinished = true;
        return ok({
          id: 305,
          intentoId: 101,
          subtestId: 10,
          estado: "COMPLETADO",
        });
      }),
      http.post(`${API}/intentos/101/finalizar`, async ({ request }) => {
        finishAttemptPayload = await request.json();
        return ok({
          id: 101,
          asignacionId: 42,
          estado: "COMPLETADO",
        });
      }),
    );

    const { router } = await renderRunnerAt("/evaluacion/sesion");

    // Bienvenida -> Iniciar evaluación
    fireEvent.click(await screen.findByRole("button", { name: /comenzar evaluación/i }));
    expect(await screen.findByText("Subtests de la Evaluación")).toBeInTheDocument();

    // Lista -> Abrir instrucciones -> Iniciar subtest
    fireEvent.click(screen.getByRole("button", { name: /iniciar/i }));
    expect(await screen.findByText("Instrucciones del subtest")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /iniciar subtest/i }));

    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/evaluacion/subtests/10/items/1"),
    );
    expect(await screen.findByText("Pregunta 1 del subtest 10")).toBeInTheDocument();

    // Espera 7 segundos en el ítem 1 antes de responder
    await act(async () => {
      await vi.advanceTimersByTimeAsync(7_000);
    });
    fireEvent.click(screen.getByRole("radio", { name: /Opción A1/i }));
    await waitFor(() => expect(putBodies).toHaveLength(1));
    expect(putBodies[0]).toMatchObject({ itemId: 1001, selectedOptionIds: [10001], timeUsedSeconds: 7 });

    // Navega al ítem 2 (no lo responde, pero probamos el resumen previo con pendientes y rechazadas)
    fireEvent.click(screen.getByRole("button", { name: /siguiente/i }));
    expect(await screen.findByText("Pregunta 2 del subtest 10")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    // Abre ConfirmDialog antes de responder ítem 2 para verificar listado de pendientes
    fireEvent.click(screen.getByRole("button", { name: "Finalizar subtest" }));
    const preDialog = await screen.findByRole("alertdialog");
    expect(preDialog).toHaveTextContent(/Ítems sin responder:\s*2/i);
    fireEvent.click(within(preDialog).getByRole("button", { name: "Seguir respondiendo" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());

    // Dispara rechazo definitivo en ítem 1002
    fireEvent.click(screen.getByRole("radio", { name: /Opción B2/i }));
    await waitFor(() => expect(putBodies).toHaveLength(2));
    expect(putBodies[1]).toMatchObject({ itemId: 1002, selectedOptionIds: [10004], timeUsedSeconds: 5 });

    // Abre ConfirmDialog de resumen previo a finalizar subtest
    fireEvent.click(screen.getByRole("button", { name: "Finalizar subtest" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(/Respuestas rechazadas \(1\)/i);

    fireEvent.click(within(dialog).getByRole("button", { name: "Finalizar subtest" }));

    // Pasa a resumen de la evaluación porque era el único subtest
    expect(await screen.findByText("Resumen de su Evaluación")).toBeInTheDocument();
    expect(finishSubtestPayload).toEqual({ timeSeconds: 12 });

    // Confirmar entrega final del intento
    fireEvent.click(screen.getByRole("button", { name: "Finalizar evaluación" }));
    const finishDialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(finishDialog).getByRole("button", { name: "Confirmar entrega final" }));

    expect(await screen.findByText("Evaluación Finalizada")).toBeInTheDocument();
    expect(finishAttemptPayload).toEqual({ timeSeconds: 12 });
  });

  it("muestra aviso descartable useDiscardNotice cuando se descartó cola de otra asignación e ignora STALE_PARTICIPANT", async () => {
    // Cola previa de asignación #11 en sessionStorage
    sessionStorage.setItem(
      "bfa-runtime-draft:11",
      JSON.stringify({
        v: 1,
        owner: { assignmentId: 11, attemptId: 500 },
        answers: {
          900: { value: { kind: "OPCION_UNICA", optionId: 1 }, version: 1, updatedAt: Date.now() },
        },
        queue: [{ itemId: 900, version: 1, notStartedAttempts: 0 }],
        rejectedAnswers: {},
        lastSyncAt: null,
      }),
    );

    useParticipantAuth.getState().setSession({ token: "jwt-42", assignmentId: 42 });
    server.use(
      http.get(`${API}/evaluacion-participante/yo`, () => ok(makeEvaluationWire())),
    );

    await renderRunnerAt("/evaluacion/sesion");

    expect(
      await screen.findByText(/Se descartaron 1 respuesta pendiente de una sesión anterior \(asignación #11\)/i),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Entendido" }));
    expect(
      screen.queryByText(/Se descartaron 1 respuesta pendiente/i),
    ).not.toBeInTheDocument();
  });

  it("409 TIEMPO_AGOTADO al finalizar subtest cierra el subtest sin atascar al participante", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const T0 = Date.parse("2026-11-25T12:00:00.000Z");
    vi.setSystemTime(T0);

    useParticipantAuth.getState().setSession({ token: "jwt-42", assignmentId: 42 });
    let closedByTimeout = false;

    server.use(
      http.get(`${API}/evaluacion-participante/yo`, () =>
        ok(
          makeEvaluationWire({
            subtests: [
              makeSubtestWire(10, 1, closedByTimeout ? "COMPLETADO" : "EN_PROGRESO", {
                timeLimitSeconds: 5,
                startedAt: "2026-11-25T11:59:56.000Z",
                ...liveTiming(1),
                paused: false,
              }),
              makeSubtestWire(20, 2, "NO_INICIADO"),
            ],
          }),
        ),
      ),
      http.post(`${API}/intentos/101/subtests/10/finalizar`, () => {
        closedByTimeout = true;
        return apiErr(409, "TIEMPO_AGOTADO", "El tiempo del subtest ya expiró");
      }),
    );

    const { router } = await renderRunnerAt("/evaluacion/subtests/10/items/1");
    expect(await screen.findByText("Pregunta 1 del subtest 10")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    await waitFor(() => expect(router.state.location.pathname).toBe("/evaluacion/sesion"));
    expect(await screen.findByText("Subtests de la Evaluación")).toBeInTheDocument();
  });

  it("ignora STALE_PARTICIPANT silenciosamente si cambia el participante durante una petición en vuelo", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let resolveValidate: ((res: Response) => void) | null = null;
    server.use(
      http.post(`${API}/acceso-participante/validar`, () =>
        new Promise<Response>((resolve) => {
          resolveValidate = resolve;
        }),
      ),
    );

    const { unmount } = await renderRunnerAt("/evaluacion/42-token-lento");
    expect(screen.getByText("Validando acceso a la evaluación...")).toBeInTheDocument();

    // Desmonta (navega fuera) antes de que resuelva la validación tardía
    unmount();
    await act(async () => {
      resolveValidate?.(
        apiErr(0, "STALE_PARTICIPANT", "Descartado") as unknown as Response,
      );
      await Promise.resolve();
    });

    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("fallo 500 en finishSubtest (usuario) y finishAttempt recupera estado y permite reintentar", async () => {
    useParticipantAuth.getState().setSession({ token: "jwt-42", assignmentId: 42 });
    let failFinishSubtest = true;
    let failFinishAttempt = true;
    let subtestCompleted = false;

    server.use(
      http.get(`${API}/evaluacion-participante/yo`, () =>
        ok(
          makeEvaluationWire({
            subtests: [
              makeSubtestWire(10, 1, subtestCompleted ? "COMPLETADO" : "EN_PROGRESO", {
                timeLimitSeconds: null,
              }),
            ],
          }),
        ),
      ),
      http.post(`${API}/intentos/101/subtests/10/finalizar`, () => {
        if (failFinishSubtest) {
          return apiErr(500, "INTERNAL_ERROR", "Fallo temporal al cerrar subtest");
        }
        subtestCompleted = true;
        return ok({ id: 305, intentoId: 101, subtestId: 10, estado: "COMPLETADO" });
      }),
      http.post(`${API}/intentos/101/finalizar`, () => {
        if (failFinishAttempt) {
          return apiErr(500, "INTERNAL_ERROR", "Fallo temporal al cerrar intento");
        }
        return ok({ id: 101, asignacionId: 42, estado: "COMPLETADO" });
      }),
    );

    await renderRunnerAt("/evaluacion/subtests/10/items/2");
    expect(await screen.findByText("Pregunta 2 del subtest 10")).toBeInTheDocument();

    // Intento 1 de finalizar subtest -> 500 -> recupera respondiendo y permite seguir o reintentar
    fireEvent.click(screen.getByRole("button", { name: "Finalizar subtest" }));
    const subDialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(subDialog).getByRole("button", { name: "Finalizar subtest" }));
    expect(await screen.findByText("Fallo temporal al cerrar subtest")).toBeInTheDocument();

    // Se puede cancelar para comprobar que los controles de respuesta volvieron a estar habilitados
    fireEvent.click(within(subDialog).getByRole("button", { name: "Seguir respondiendo" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(screen.getByRole("radio", { name: /Opción A2/i })).toBeEnabled();

    // Reintento 2 -> OK
    failFinishSubtest = false;
    fireEvent.click(screen.getByRole("button", { name: "Finalizar subtest" }));
    const subDialog2 = await screen.findByRole("alertdialog");
    fireEvent.click(within(subDialog2).getByRole("button", { name: "Finalizar subtest" }));
    expect(await screen.findByText("Resumen de su Evaluación")).toBeInTheDocument();

    // Intento 1 de finalizar evaluación -> 500 -> recupera resumen y permite reintentar
    fireEvent.click(screen.getByRole("button", { name: "Finalizar evaluación" }));
    const attDialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(attDialog).getByRole("button", { name: "Confirmar entrega final" }));
    expect(await screen.findByText("Fallo temporal al cerrar intento")).toBeInTheDocument();

    failFinishAttempt = false;
    fireEvent.click(within(attDialog).getByRole("button", { name: "Confirmar entrega final" }));
    expect(await screen.findByText("Evaluación Finalizada")).toBeInTheDocument();
    // El finalizar confirmado por el servidor deja el marcador de entrega de la asignación.
    expect(sessionStorage.getItem("bfa-runtime-delivered:42")).toBe("1");
  });

  it("recarga tras entregar: 409 ASIGNACION_NO_OPERABLE con marcador muestra «Evaluación entregada» sin acciones de escritura", async () => {
    useParticipantAuth.getState().setSession({ token: "jwt-42", assignmentId: 42 });
    sessionStorage.setItem("bfa-runtime-delivered:42", "1");
    server.use(
      http.get(`${API}/evaluacion-participante/yo`, () => apiErr(409, "ASIGNACION_NO_OPERABLE", "No operable")),
    );

    await renderRunnerAt("/evaluacion/sesion");
    expect(await screen.findByRole("heading", { name: "Evaluación entregada" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /no operable/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /finalizar|enviar|responder/i })).not.toBeInTheDocument();
  });

  it("recarga tras entregar y cierre de sesión: 409 SESION_FINALIZADA con marcador muestra «Evaluación entregada»", async () => {
    useParticipantAuth.getState().setSession({ token: "jwt-42", assignmentId: 42 });
    sessionStorage.setItem("bfa-runtime-delivered:42", "1");
    server.use(
      http.get(`${API}/evaluacion-participante/yo`, () => apiErr(409, "SESION_FINALIZADA", "Sesión finalizada")),
    );

    await renderRunnerAt("/evaluacion/sesion");
    expect(await screen.findByRole("heading", { name: "Evaluación entregada" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /sesión finalizada/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /finalizar|enviar|responder/i })).not.toBeInTheDocument();
  });

  it("409 SESION_FINALIZADA sin marcador sigue mostrando «Sesión finalizada»", async () => {
    useParticipantAuth.getState().setSession({ token: "jwt-42", assignmentId: 42 });
    server.use(
      http.get(`${API}/evaluacion-participante/yo`, () => apiErr(409, "SESION_FINALIZADA", "Sesión finalizada")),
    );

    await renderRunnerAt("/evaluacion/sesion");
    expect(await screen.findByRole("heading", { name: "Sesión finalizada" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Evaluación entregada" })).not.toBeInTheDocument();
  });

  it("marcador con respuestas sin confirmar muestra advertencia en «Evaluación entregada»", async () => {
    useParticipantAuth.getState().setSession({ token: "jwt-42", assignmentId: 42 });
    sessionStorage.setItem("bfa-runtime-delivered:42", "1:pendientes");
    server.use(
      http.get(`${API}/evaluacion-participante/yo`, () => apiErr(409, "SESION_FINALIZADA", "Sesión finalizada")),
    );

    await renderRunnerAt("/evaluacion/sesion");
    expect(await screen.findByRole("heading", { name: "Evaluación entregada" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/sin confirmar/i);
    expect(screen.queryByText(/quedaron registradas/i)).not.toBeInTheDocument();
  });

  it("409 ASIGNACION_NO_OPERABLE sin marcador (o de otra asignación) muestra el texto honesto de bloqueo", async () => {
    useParticipantAuth.getState().setSession({ token: "jwt-42", assignmentId: 42 });
    sessionStorage.setItem("bfa-runtime-delivered:99", "1");
    server.use(
      http.get(`${API}/evaluacion-participante/yo`, () => apiErr(409, "ASIGNACION_NO_OPERABLE", "No operable")),
    );

    await renderRunnerAt("/evaluacion/sesion");
    expect(await screen.findByRole("heading", { name: /no operable/i })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Esta evaluación ya no admite respuestas. Si ya la entregaste, tus respuestas quedaron registradas. Consulta al aplicador si tienes dudas.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Evaluación entregada" })).not.toBeInTheDocument();
  });

  it("canjear un código de otra asignación limpia el marcador de entrega previo", () => {
    useParticipantAuth.getState().setSession({ token: "jwt-42", assignmentId: 42 });
    sessionStorage.setItem("bfa-runtime-delivered:42", "1");
    useParticipantAuth.getState().setSession({ token: "jwt-42b", assignmentId: 42 });
    expect(sessionStorage.getItem("bfa-runtime-delivered:42")).toBe("1");
    useParticipantAuth.getState().setSession({ token: "jwt-77", assignmentId: 77 });
    expect(sessionStorage.getItem("bfa-runtime-delivered:42")).toBeNull();
  });

  it("polling que marca el subtest activo como ANULADO redirige de /items/$ordinal a /evaluacion/sesion", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    useParticipantAuth.getState().setSession({ token: "jwt-42", assignmentId: 42 });
    let annulled = false;

    server.use(
      http.get(`${API}/evaluacion-participante/yo`, () =>
        ok(
          makeEvaluationWire({
            subtests: [
              makeSubtestWire(10, 1, annulled ? "ANULADO" : "EN_PROGRESO", { timeLimitSeconds: null }),
              makeSubtestWire(20, 2, "NO_INICIADO", { timeLimitSeconds: null }),
            ],
          }),
        ),
      ),
    );

    const { router } = await renderRunnerAt("/evaluacion/subtests/10/items/1");
    expect(await screen.findByText("Pregunta 1 del subtest 10")).toBeInTheDocument();

    annulled = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_500);
    });

    await waitFor(() => expect(router.state.location.pathname).toBe("/evaluacion/sesion"));
    expect(await screen.findByText("Subtests de la Evaluación")).toBeInTheDocument();
  });

  it("/evaluacion/acceso?code=42-invalido limpia ?code= de la URL al fallar mostrando el error", async () => {
    server.use(
      http.post(`${API}/acceso-participante/validar`, () =>
        apiErr(409, "TOKEN_EXPIRADO", "Expirado"),
      ),
    );

    const { router } = await renderRunnerAt("/evaluacion/acceso?code=42-invalido");
    expect(await screen.findByRole("alert")).toHaveTextContent(/expirado/i);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/evaluacion/acceso");
      expect(router.state.location.searchStr).toBe("");
    });
  });

  it("canje fallido en /evaluacion/$code reemplaza la URL a /evaluacion/acceso sin dejar el código y muestra el error", async () => {
    server.use(
      http.post(`${API}/acceso-participante/validar`, () =>
        apiErr(409, "TOKEN_EXPIRADO", "Enlace vencido"),
      ),
    );

    const { router, history, container } = await renderRunnerAt("/evaluacion/42-token-caducado");

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/evaluacion/acceso");
      expect(router.state.location.searchStr).toBe("");
    });
    expect(history.length).toBe(1);
    expect(await screen.findByRole("alert")).toHaveTextContent(/expirado/i);
    expect(container.textContent).not.toContain("token-caducado");
  });

  it("cierre voluntario de subtest e intento no descarta pendientes si falla bulk-sync y permite reintentar sincronización", async () => {
    useParticipantAuth.getState().setSession({ token: "jwt-42", assignmentId: 42 });
    let failSync = true;
    let finishSubtestCalls = 0;
    let finishAttemptCalls = 0;
    let subtestCompleted = false;
    let attemptCompleted = false;

    server.use(
      http.get(`${API}/evaluacion-participante/yo`, () =>
        ok(
          makeEvaluationWire({
            attemptStatus: attemptCompleted ? "COMPLETADO" : "EN_PROGRESO",
            subtests: [
              makeSubtestWire(10, 1, subtestCompleted ? "COMPLETADO" : "EN_PROGRESO", {
                timeLimitSeconds: null,
              }),
            ],
          }),
        ),
      ),
      http.put(`${API}/intentos/101/items/1001/respuesta`, () => {
        if (failSync) return apiErr(503, "UNAVAILABLE", "Sin señal");
        return ok({
          id: 901,
          intentoId: 101,
          itemId: 1001,
          respondidoEn: "2026-11-25T12:00:05.000Z",
          tiempoUsadoSegundos: 1,
        });
      }),
      http.post(`${API}/intentos/101/respuestas/bulk-sync`, () => {
        if (failSync) return apiErr(503, "UNAVAILABLE", "Sin señal en bulk");
        return ok([{ itemId: 1001, status: "GUARDADA", code: null, answerId: 901 }]);
      }),
      http.post(`${API}/intentos/101/subtests/10/finalizar`, () => {
        finishSubtestCalls += 1;
        subtestCompleted = true;
        return ok({ id: 305, intentoId: 101, subtestId: 10, estado: "COMPLETADO" });
      }),
      http.post(`${API}/intentos/101/finalizar`, () => {
        finishAttemptCalls += 1;
        attemptCompleted = true;
        return ok({ id: 101, asignacionId: 42, estado: "COMPLETADO" });
      }),
    );

    await renderRunnerAt("/evaluacion/subtests/10/items/1");
    expect(await screen.findByText("Pregunta 1 del subtest 10")).toBeInTheDocument();

    // Responde mientras falla el guardado -> queda en cola pendiente
    fireEvent.click(screen.getByRole("radio", { name: /Opción A1/i }));
    await waitFor(() => expect(useRuntimeDraft.getState().queue).toHaveLength(1));

    // Intenta cerrar voluntariamente -> falla bulk-sync -> NO llama a /finalizar subtest
    fireEvent.click(screen.getByRole("button", { name: /Siguiente/i }));
    expect(await screen.findByText("Pregunta 2 del subtest 10")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Finalizar subtest" }));
    const subDialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(subDialog).getByRole("button", { name: "Finalizar subtest" }));

    expect(await screen.findByText(/No se pudieron confirmar 1 respuesta pendiente/i)).toBeInTheDocument();
    expect(finishSubtestCalls).toBe(0);

    // Cierra diálogo y usa Reintentar sincronización
    fireEvent.click(within(subDialog).getByRole("button", { name: "Seguir respondiendo" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());

    failSync = false;
    fireEvent.click(screen.getByRole("button", { name: "Reintentar sincronización" }));
    await waitFor(() => expect(useRuntimeDraft.getState().queue).toHaveLength(0));

    // Ahora finaliza subtest -> pasa a resumen
    fireEvent.click(screen.getByRole("button", { name: "Finalizar subtest" }));
    const subDialog2 = await screen.findByRole("alertdialog");
    fireEvent.click(within(subDialog2).getByRole("button", { name: "Finalizar subtest" }));
    expect(await screen.findByText("Resumen de su Evaluación")).toBeInTheDocument();
    expect(finishSubtestCalls).toBe(1);

    // Simula pendiente restante antes de finalizar el intento: tampoco debe descartar ni cerrar
    failSync = true;
    act(() => {
      useRuntimeDraft.getState().setAnswerLocal(1002, { kind: "OPCION_UNICA", optionId: 10004 }, 2, 10);
    });
    fireEvent.click(screen.getByRole("button", { name: "Finalizar evaluación" }));
    const attDialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(attDialog).getByRole("button", { name: "Confirmar entrega final" }));

    expect(await screen.findByText(/No se pudieron confirmar 1 respuesta pendiente antes de finalizar la evaluación/i)).toBeInTheDocument();
    expect(finishAttemptCalls).toBe(0);
    expect(useRuntimeDraft.getState().queue).toHaveLength(1);

    // Recupera red, reintenta sincronización en resumen y entrega finalmente
    fireEvent.click(within(attDialog).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());

    failSync = false;
    server.use(
      http.post(`${API}/intentos/101/respuestas/bulk-sync`, () =>
        ok([{ itemId: 1002, status: "GUARDADA", code: null, answerId: 902 }]),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Reintentar sincronización" }));
    await waitFor(() => expect(useRuntimeDraft.getState().queue).toHaveLength(0));

    fireEvent.click(screen.getByRole("button", { name: "Finalizar evaluación" }));
    const attDialog2 = await screen.findByRole("alertdialog");
    fireEvent.click(within(attDialog2).getByRole("button", { name: "Confirmar entrega final" }));
    expect(await screen.findByText("Evaluación Finalizada")).toBeInTheDocument();
    expect(finishAttemptCalls).toBe(1);
  });

  it("cierre por tiempo con sync fallida conserva y muestra respuestas sin confirmar en sesión y al completar", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const T0 = Date.parse("2026-11-25T12:00:00.000Z");
    vi.setSystemTime(T0);

    useParticipantAuth.getState().setSession({ token: "jwt-42", assignmentId: 42 });
    let sub10Completed = false;
    let sub20Completed = false;

    server.use(
      http.get(`${API}/evaluacion-participante/yo`, () =>
        ok(
          makeEvaluationWire({
            subtests: [
              makeSubtestWire(10, 1, sub10Completed ? "COMPLETADO" : "EN_PROGRESO", {
                timeLimitSeconds: 10,
                startedAt: "2026-11-25T11:59:52.000Z",
                ...liveTiming(2),
                paused: false,
              }),
              makeSubtestWire(20, 2, sub20Completed ? "COMPLETADO" : "NO_INICIADO", {
                timeLimitSeconds: null,
              }),
            ],
          }),
        ),
      ),
      http.put(`${API}/intentos/101/items/1001/respuesta`, () =>
        apiErr(503, "UNAVAILABLE", "Sin conexión"),
      ),
      http.post(`${API}/intentos/101/respuestas/bulk-sync`, () =>
        apiErr(503, "UNAVAILABLE", "Sin conexión"),
      ),
      http.post(`${API}/intentos/101/subtests/10/finalizar`, () => {
        sub10Completed = true;
        return ok({ id: 305, intentoId: 101, subtestId: 10, estado: "COMPLETADO" });
      }),
      http.post(`${API}/intentos/101/subtests/20/iniciar`, () =>
        ok({
          id: 306,
          intentoId: 101,
          subtestId: 20,
          estado: "EN_PROGRESO",
          startedAt: new Date(Date.now()).toISOString(),
          timeLimitSeconds: null,
          serverNow: new Date(Date.now()).toISOString(),
        }),
      ),
      http.post(`${API}/intentos/101/subtests/20/finalizar`, () => {
        sub20Completed = true;
        return ok({ id: 306, intentoId: 101, subtestId: 20, estado: "COMPLETADO" });
      }),
      http.post(`${API}/intentos/101/finalizar`, () =>
        ok({ id: 101, asignacionId: 42, estado: "COMPLETADO" }),
      ),
    );

    const { router } = await renderRunnerAt("/evaluacion/subtests/10/items/1");
    expect(await screen.findByText("Pregunta 1 del subtest 10")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: /Opción A1/i }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });

    await waitFor(() => expect(router.state.location.pathname).toBe("/evaluacion/sesion"));
    expect(await screen.findByText(/1 respuesta quedó sin confirmar al vencer el tiempo/i)).toBeInTheDocument();
    expect(screen.getByText(/Subtest 10 · Ítem 1/i)).toBeInTheDocument();
    expect(useRuntimeDraft.getState().queue).toHaveLength(0);

    // Completa subtest 20 y finaliza intento: el aviso de unconfirmed sigue visible en resumen y completada
    fireEvent.click(screen.getByRole("button", { name: "Iniciar" }));
    expect(await screen.findByText("Instrucciones del subtest")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Iniciar subtest/i }));
    expect(await screen.findByText("Pregunta 1 del subtest 20")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Siguiente/i }));
    expect(await screen.findByText("Pregunta 2 del subtest 20")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Finalizar subtest" }));
    const sub20Dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(sub20Dialog).getByRole("button", { name: "Finalizar subtest" }));

    expect(await screen.findByText("Resumen de su Evaluación")).toBeInTheDocument();
    expect(screen.getByText(/1 respuesta quedó sin confirmar al vencer el tiempo/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Finalizar evaluación" }));
    const attDialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(attDialog).getByRole("button", { name: "Confirmar entrega final" }));
    expect(await screen.findByText("Evaluación Finalizada")).toBeInTheDocument();
    expect(screen.getByText(/1 respuesta quedó sin confirmar al vencer el tiempo/i)).toBeInTheDocument();
  });

  it("carga tardía de ítems NO revierte cierre/pausa detectados por polling", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    useParticipantAuth.getState().setSession({ token: "jwt-42", assignmentId: 42 });
    let closedByServer = false;
    let resolveItemsFetch: ((res: Response) => void) | null = null;

    server.use(
      http.get(`${API}/evaluacion-participante/yo`, () =>
        ok(
          makeEvaluationWire({
            sessionStatus: closedByServer ? "CERRADA" : "ABIERTA",
            subtests: [
              makeSubtestWire(10, 1, "EN_PROGRESO", {
                timeLimitSeconds: null,
                items: [],
              }),
            ],
          }),
        ),
      ),
      http.get(`${API}/intentos/101/subtests/10/items`, () =>
        new Promise<Response>((resolve) => {
          resolveItemsFetch = resolve;
        }),
      ),
    );

    const { router } = await renderRunnerAt("/evaluacion/sesion");
    expect(await screen.findByText("Subtests de la Evaluación")).toBeInTheDocument();

    // Entra a instrucciones y luego navega a /items/1 (sin pasar por beforeLoad bloqueante porque ya tenía sesión)
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(await screen.findByText("Instrucciones del subtest")).toBeInTheDocument();

    await act(async () => {
      void router.navigate({
        to: "/evaluacion/subtests/$subtestId/items/$ordinal",
        params: { subtestId: 10, ordinal: 1 },
      });
    });

    await waitFor(() => expect(resolveItemsFetch).not.toBeNull());

    // Antes de que lleguen los ítems, el polling informa sesión CERRADA
    closedByServer = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_500);
    });
    expect(await screen.findByRole("heading", { name: "Sesión finalizada" })).toBeInTheDocument();

    // Resuelve la carga tardía de ítems -> NO debe revertir el estado cerrado
    await act(async () => {
      resolveItemsFetch?.(ok(makeSubtestWire(10, 1, "EN_PROGRESO")) as unknown as Response);
      await Promise.resolve();
    });

    expect(await screen.findByRole("heading", { name: "Sesión finalizada" })).toBeInTheDocument();
  });

  it("salir de instrucciones mientras startSubtestAction está en vuelo cancela la navegación tardía a items", async () => {
    useParticipantAuth.getState().setSession({ token: "jwt-42", assignmentId: 42 });
    let resolveStart: ((res: Response) => void) | null = null;

    server.use(
      http.get(`${API}/evaluacion-participante/yo`, () =>
        ok(
          makeEvaluationWire({
            subtests: [makeSubtestWire(10, 1, "NO_INICIADO", { timeLimitSeconds: null })],
          }),
        ),
      ),
      http.post(`${API}/intentos/101/subtests/10/iniciar`, () =>
        new Promise<Response>((resolve) => {
          resolveStart = resolve;
        }),
      ),
    );

    const { router } = await renderRunnerAt("/evaluacion/sesion");
    expect(await screen.findByText("Subtests de la Evaluación")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Iniciar" }));
    expect(await screen.findByText("Instrucciones del subtest")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Iniciar subtest/i }));
    await waitFor(() => expect(resolveStart).not.toBeNull());

    // El participante navega fuera de instrucciones mientras startSubtest sigue pendiente
    act(() => {
      void router.navigate({ to: "/evaluacion/sesion" });
    });
    expect(await screen.findByText("Subtests de la Evaluación")).toBeInTheDocument();

    // Llega la respuesta tardía de startSubtest -> NO debe navegar hacia /items/1
    await act(async () => {
      resolveStart?.(
        ok({
          id: 305,
          intentoId: 101,
          subtestId: 10,
          estado: "EN_PROGRESO",
          startedAt: "2026-11-25T12:00:00.000Z",
          timeLimitSeconds: null,
          serverNow: "2026-11-25T12:00:00.000Z",
        }) as unknown as Response,
      );
      await Promise.resolve();
    });

    expect(router.state.location.pathname).toBe("/evaluacion/sesion");
    expect(screen.getByText("Subtests de la Evaluación")).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------------------------
  // F2-FIX-1 · regresiones de la auditoría de la Fase 2
  // ---------------------------------------------------------------------------------------------
  describe("F2-FIX-1", () => {
    const openTextItem = (itemId: number, order: number): SubtestWire["items"][number] => ({
      itemId,
      code: `IT-${itemId}`,
      itemType: "SOLO_TEXTO",
      responseType: "TEXTO_ABIERTO",
      prompt: `Abierto ${order}`,
      instruction: null,
      order,
      images: [],
      options: [],
    });

    const bulkRows = (body: Array<{ itemId: number }>) =>
      body.map((answer) => ({ itemId: answer.itemId, status: "GUARDADA", code: null, answerId: 9000 + answer.itemId }));

    const fakeClock = () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      vi.setSystemTime(Date.parse("2026-11-25T12:00:00.000Z"));
    };

    it("ALTO 2 · escribir en el ítem 1 y cambiar al 2 sin blur deja el texto en el ítem 1 y el 2 no lo recibe", async () => {
      fakeClock();
      useParticipantAuth.getState().setSession({ token: "jwt-42", assignmentId: 42 });
      const writes: Array<{ itemId: number; textAnswer?: string }> = [];
      server.use(
        http.get(`${API}/evaluacion-participante/yo`, () =>
          ok(
            makeEvaluationWire({
              subtests: [
                makeSubtestWire(10, 1, "EN_PROGRESO", {
                  timeLimitSeconds: null,
                  items: [openTextItem(1001, 1), openTextItem(1002, 2)],
                }),
              ],
            }),
          ),
        ),
        http.put(`${API}/intentos/101/items/:itemId/respuesta`, async ({ request, params }) => {
          const body = (await request.json()) as { textAnswer?: string };
          writes.push({ itemId: Number(params.itemId), ...(body.textAnswer !== undefined ? { textAnswer: body.textAnswer } : {}) });
          return ok({ id: 1, intentoId: 101, itemId: Number(params.itemId), esFinal: true, requiereRevisionManual: false });
        }),
        http.post(`${API}/intentos/101/respuestas/bulk-sync`, async ({ request }) => {
          const body = (await request.json()) as Array<{ itemId: number; textAnswer?: string }>;
          for (const answer of body) writes.push({ itemId: answer.itemId, ...(answer.textAnswer !== undefined ? { textAnswer: answer.textAnswer } : {}) });
          return ok(bulkRows(body));
        }),
      );

      const { router } = await renderRunnerAt("/evaluacion/subtests/10/items/1");
      const textarea = await screen.findByRole("textbox");
      fireEvent.change(textarea, { target: { value: "respuesta del ítem uno" } });
      // El texto ya está en el draft local, con su itemId, antes de cualquier debounce de red.
      expect(useRuntimeDraft.getState().answers[1001]?.value).toEqual({ kind: "TEXTO_ABIERTO", text: "respuesta del ítem uno" });

      // Cambia de ítem sin blur ni espera.
      fireEvent.click(screen.getByRole("button", { name: /siguiente/i }));
      await waitFor(() => expect(router.state.location.pathname).toBe("/evaluacion/subtests/10/items/2"));
      expect(await screen.findByRole("heading", { name: "Abierto 2" })).toBeInTheDocument();
      expect(screen.getByRole("textbox")).toHaveValue("");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_500);
      });

      expect(writes).toEqual([{ itemId: 1001, textAnswer: "respuesta del ítem uno" }]);
      expect(useRuntimeDraft.getState().answers[1002]).toBeUndefined();
      expect(useRuntimeDraft.getState().queue).toHaveLength(0);

      // Al volver al ítem 1 el texto sigue ahí.
      fireEvent.click(screen.getByRole("button", { name: /anterior/i }));
      await waitFor(() => expect(router.state.location.pathname).toBe("/evaluacion/subtests/10/items/1"));
      expect(await screen.findByRole("textbox")).toHaveValue("respuesta del ítem uno");
    });

    it("ALTO 2 · el deadline dentro de los 300 ms del último tecleo envía finishSubtest DESPUÉS de encolar el texto", async () => {
      fakeClock();
      useParticipantAuth.getState().setSession({ token: "jwt-42", assignmentId: 42 });
      const order: string[] = [];
      server.use(
        http.get(`${API}/evaluacion-participante/yo`, () =>
          ok(
            makeEvaluationWire({
              subtests: [
                makeSubtestWire(10, 1, "EN_PROGRESO", {
                  timeLimitSeconds: 10,
                  startedAt: "2026-11-25T11:59:57.000Z",
                  ...liveTiming(3),
                  paused: false,
                  items: [openTextItem(1001, 1)],
                }),
                makeSubtestWire(20, 2, "NO_INICIADO"),
              ],
            }),
          ),
        ),
        http.put(`${API}/intentos/101/items/1001/respuesta`, async ({ request }) => {
          const body = (await request.json()) as { textAnswer?: string };
          order.push(`WRITE:${body.textAnswer}`);
          return ok({ id: 1, intentoId: 101, itemId: 1001, esFinal: true, requiereRevisionManual: false });
        }),
        http.post(`${API}/intentos/101/respuestas/bulk-sync`, async ({ request }) => {
          const body = (await request.json()) as Array<{ itemId: number; textAnswer?: string }>;
          for (const answer of body) order.push(`WRITE:${answer.textAnswer}`);
          return ok(bulkRows(body));
        }),
        http.post(`${API}/intentos/101/subtests/10/finalizar`, () => {
          order.push("FINISH");
          return ok({ id: 305, intentoId: 101, subtestId: 10, estado: "COMPLETADO" });
        }),
      );

      const { router } = await renderRunnerAt("/evaluacion/subtests/10/items/1");
      const textarea = await screen.findByRole("textbox");

      // Se alinea con el tick del cronómetro (queda ~1 s): se teclea 800 ms después, así que el deadline llega
      // ~200 ms más tarde, ANTES de que venza el debounce de 300 ms del envío por red.
      for (let step = 0; step < 40 && screen.getByRole("timer").textContent !== "00:01"; step += 1) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(100);
        });
      }
      expect(screen.getByRole("timer")).toHaveTextContent("00:01");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(800);
      });
      fireEvent.change(textarea, { target: { value: "ultimo texto" } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });

      await waitFor(() => expect(router.state.location.pathname).toBe("/evaluacion/sesion"));
      expect(order).toContain("FINISH");
      expect(order.indexOf("WRITE:ultimo texto")).toBeGreaterThanOrEqual(0);
      expect(order.indexOf("WRITE:ultimo texto")).toBeLessThan(order.indexOf("FINISH"));
    });

    it("ALTO 3 · un salto de Date.now() de +1 h con 50 s restantes NO finaliza el subtest", async () => {
      fakeClock();
      useParticipantAuth.getState().setSession({ token: "jwt-42", assignmentId: 42 });
      let finishCalls = 0;
      server.use(
        http.get(`${API}/evaluacion-participante/yo`, () =>
          ok(
            makeEvaluationWire({
              subtests: [
                makeSubtestWire(10, 1, "EN_PROGRESO", {
                  timeLimitSeconds: 600,
                  startedAt: "2026-11-25T11:50:10.000Z",
                  remainingSeconds: 50,
                  paused: false,
                  serverNow: "2026-11-25T12:00:00.000Z",
                }),
              ],
            }),
          ),
        ),
        http.post(`${API}/intentos/101/subtests/10/finalizar`, () => {
          finishCalls += 1;
          return ok({ id: 305, intentoId: 101, subtestId: 10, estado: "COMPLETADO" });
        }),
      );

      const { router } = await renderRunnerAt("/evaluacion/subtests/10/items/1");
      expect(await screen.findByText("Pregunta 1 del subtest 10")).toBeInTheDocument();
      expect(screen.getByRole("timer")).toHaveTextContent("00:50");

      // El usuario (o la sincronización NTP) adelanta la hora del equipo una hora.
      vi.setSystemTime(Date.now() + 3_600_000);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_000);
      });

      expect(finishCalls).toBe(0);
      expect(router.state.location.pathname).toBe("/evaluacion/subtests/10/items/1");
      // El cronómetro avanza por el reloj monotónico: ~3 s consumidos, no 1 h.
      expect(screen.getByRole("timer")).toHaveTextContent(/^00:4[5-7]$/);
    });

    it("ALTO 3 · al volver de visibilitychange se refresca /yo ANTES de actuar sobre el deadline", async () => {
      fakeClock();
      useParticipantAuth.getState().setSession({ token: "jwt-42", assignmentId: 42 });
      let finishCalls = 0;
      let yoCalls = 0;
      let serverRemaining = 5;
      server.use(
        http.get(`${API}/evaluacion-participante/yo`, () => {
          yoCalls += 1;
          return ok(
            makeEvaluationWire({
              subtests: [
                makeSubtestWire(10, 1, "EN_PROGRESO", {
                  timeLimitSeconds: 600,
                  startedAt: "2026-11-25T11:55:00.000Z",
                  remainingSeconds: serverRemaining,
                  paused: false,
                  serverNow: new Date(Date.now()).toISOString(),
                }),
              ],
            }),
          );
        }),
        http.post(`${API}/intentos/101/subtests/10/finalizar`, () => {
          finishCalls += 1;
          return ok({ id: 305, intentoId: 101, subtestId: 10, estado: "COMPLETADO" });
        }),
      );

      const visibility = vi.spyOn(document, "visibilityState", "get");
      const { router } = await renderRunnerAt("/evaluacion/subtests/10/items/1");
      expect(await screen.findByText("Pregunta 1 del subtest 10")).toBeInTheDocument();

      // La pestaña se oculta; en segundo plano el cronómetro local "vence" (5 s), pero el servidor extendió el tiempo.
      visibility.mockReturnValue("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      serverRemaining = 100;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(8_000);
      });
      expect(finishCalls).toBe(0); // oculta: no se cierra con un dato del servidor que puede estar viejo

      const yoBefore = yoCalls;
      visibility.mockReturnValue("visible");
      document.dispatchEvent(new Event("visibilitychange"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_500);
      });

      expect(yoCalls).toBeGreaterThan(yoBefore); // refrescó /yo al volver
      expect(finishCalls).toBe(0);
      expect(router.state.location.pathname).toBe("/evaluacion/subtests/10/items/1");
      expect(screen.getByRole("timer")).toHaveTextContent(/^01:(3\d|40)$/); // re-anclado a lo que dijo el servidor (100 s)
    });

    it("MEDIO 4 · si el servidor ya cerró el subtest mientras se finalizaba, el runner avanza y conserva el aviso de las sin confirmar", async () => {
      fakeClock();
      useParticipantAuth.getState().setSession({ token: "jwt-42", assignmentId: 42 });
      let closedByServer = false;
      server.use(
        http.get(`${API}/evaluacion-participante/yo`, () =>
          ok(
            makeEvaluationWire({
              subtests: [
                makeSubtestWire(10, 1, closedByServer ? "COMPLETADO" : "EN_PROGRESO", {
                  timeLimitSeconds: 10,
                  startedAt: "2026-11-25T11:59:52.000Z",
                  ...liveTiming(2),
                  paused: false,
                }),
                makeSubtestWire(20, 2, "NO_INICIADO"),
              ],
            }),
          ),
        ),
        http.put(`${API}/intentos/101/items/1001/respuesta`, () => apiErr(503, "UNAVAILABLE", "Sin conexión")),
        http.post(`${API}/intentos/101/respuestas/bulk-sync`, () => apiErr(503, "UNAVAILABLE", "Sin conexión")),
        http.post(`${API}/intentos/101/subtests/10/finalizar`, () => apiErr(500, "SERVER_ERROR", "Fallo temporal")),
      );

      const { router } = await renderRunnerAt("/evaluacion/subtests/10/items/1");
      expect(await screen.findByText("Pregunta 1 del subtest 10")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("radio", { name: /Opción A1/i }));

      // Vence el tiempo; el cierre local falla (500) y el runner queda en finalizandoSubtest.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_500);
      });
      expect(await screen.findByRole("button", { name: /reintentar cierre del subtest/i })).toBeInTheDocument();
      expect(router.state.location.pathname).toBe("/evaluacion/subtests/10/items/1");

      // El servidor ya había cerrado el subtest: el siguiente /yo (polling) lo refleja.
      closedByServer = true;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_500);
      });

      await waitFor(() => expect(router.state.location.pathname).toBe("/evaluacion/sesion"));
      expect(await screen.findByText("Subtests de la Evaluación")).toBeInTheDocument();
      expect(screen.getByText(/1 respuesta quedó sin confirmar al vencer el tiempo/i)).toBeInTheDocument();
      expect(useRuntimeDraft.getState().queue).toHaveLength(0);
    });

    it("MEDIO 5 · un 401 de escritura y un nuevo canje válido: sin 'acceso revocado' y la cola del mismo intento se reanuda", async () => {
      useParticipantAuth.getState().setSession({ token: "jwt-1", assignmentId: 42 });
      const authByRequest: string[] = [];
      let secondSession = false;
      server.use(
        http.post(`${API}/acceso-participante/validar`, () =>
          ok({ assignmentId: 42, participantId: "uuid-42", accessToken: "jwt-2", tokenType: "Bearer" }),
        ),
        http.get(`${API}/evaluacion-participante/yo`, ({ request }) => {
          authByRequest.push(`yo:${request.headers.get("authorization")}`);
          return ok(
            makeEvaluationWire({
              subtests: [makeSubtestWire(10, 1, "EN_PROGRESO", { timeLimitSeconds: null })],
            }),
          );
        }),
        http.put(`${API}/intentos/101/items/1001/respuesta`, ({ request }) => {
          authByRequest.push(`put:${request.headers.get("authorization")}`);
          return secondSession
            ? ok({ id: 1, intentoId: 101, itemId: 1001, esFinal: true, requiereRevisionManual: false })
            : apiErr(401, "UNAUTHORIZED", "Sesión vencida");
        }),
        http.post(`${API}/intentos/101/respuestas/bulk-sync`, async ({ request }) => {
          authByRequest.push(`bulk:${request.headers.get("authorization")}`);
          const body = (await request.json()) as Array<{ itemId: number }>;
          return ok(bulkRows(body));
        }),
      );

      const { router } = await renderRunnerAt("/evaluacion/subtests/10/items/1");
      expect(await screen.findByText("Pregunta 1 del subtest 10")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("radio", { name: /Opción A1/i }));

      // El 401 expulsa al participante a /evaluacion/acceso con la respuesta aún en cola.
      await waitFor(() => expect(router.state.location.pathname).toBe("/evaluacion/acceso"));
      expect(useRuntimeDraft.getState().queue.map((e) => e.itemId)).toEqual([1001]);

      // Nuevo canje válido de la misma asignación.
      secondSession = true;
      fireEvent.change(await screen.findByLabelText("Código de acceso"), { target: { value: "42-clave-nueva" } });
      fireEvent.click(screen.getByRole("button", { name: /continuar/i }));

      await waitFor(() => expect(router.state.location.pathname).toBe("/evaluacion/sesion"));
      expect(await screen.findByText("Subtests de la Evaluación")).toBeInTheDocument();
      expect(screen.queryByText("Acceso revocado")).not.toBeInTheDocument();
      expect(useRuntimeDraft.getState().syncBlock).toBeNull();

      // La cola del mismo intento se reanudó con el JWT nuevo.
      await waitFor(() => expect(useRuntimeDraft.getState().queue).toHaveLength(0));
      const afterRelogin = authByRequest.slice(authByRequest.findIndex((entry) => entry === "yo:Bearer jwt-2"));
      expect(afterRelogin).toContain("yo:Bearer jwt-2");
      expect(afterRelogin.some((entry) => /^(put|bulk):Bearer jwt-2$/.test(entry))).toBe(true);
    });

    it("MEDIO 6 · al salir de un ítem respondido se persiste el tiempo de revisión (mismo valor, tiempo total); los sin responder no escriben; la pestaña oculta no suma", async () => {
      fakeClock();
      useParticipantAuth.getState().setSession({ token: "jwt-42", assignmentId: 42 });
      const puts: Array<{ itemId: number; selectedOptionIds: number[]; timeUsedSeconds?: number }> = [];
      server.use(
        http.get(`${API}/evaluacion-participante/yo`, () =>
          ok(
            makeEvaluationWire({
              subtests: [makeSubtestWire(10, 1, "EN_PROGRESO", { timeLimitSeconds: null })],
            }),
          ),
        ),
        http.put(`${API}/intentos/101/items/:itemId/respuesta`, async ({ request, params }) => {
          const body = (await request.json()) as { selectedOptionIds: number[]; timeUsedSeconds?: number };
          puts.push({ itemId: Number(params.itemId), ...body });
          return ok({ id: 1, intentoId: 101, itemId: Number(params.itemId), esFinal: true, requiereRevisionManual: false });
        }),
      );
      const visibility = vi.spyOn(document, "visibilityState", "get");

      const { router } = await renderRunnerAt("/evaluacion/subtests/10/items/1");
      expect(await screen.findByText("Pregunta 1 del subtest 10")).toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000);
      });
      fireEvent.click(screen.getByRole("radio", { name: /Opción A1/i }));
      await waitFor(() => expect(puts).toHaveLength(1));
      expect(puts[0]).toMatchObject({ itemId: 1001, selectedOptionIds: [10001] });
      expect(puts[0]?.timeUsedSeconds).toBeGreaterThanOrEqual(2);
      expect(puts[0]?.timeUsedSeconds).toBeLessThanOrEqual(3);

      // 6 s más revisando el ítem 1 y se sale hacia el 2: se reescribe la MISMA respuesta con el tiempo total.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(6_000);
      });
      fireEvent.click(screen.getByRole("button", { name: /siguiente/i }));
      await waitFor(() => expect(puts).toHaveLength(2));
      expect(puts[1]).toMatchObject({ itemId: 1001, selectedOptionIds: [10001] });
      expect(puts[1]?.timeUsedSeconds).toBeGreaterThanOrEqual(8);
      expect(puts[1]?.timeUsedSeconds).toBeLessThanOrEqual(9);

      // El ítem 2 se visita sin responder: ninguna escritura al salir.
      expect(await screen.findByText("Pregunta 2 del subtest 10")).toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4_000);
      });
      fireEvent.click(screen.getByRole("button", { name: /anterior/i }));
      await waitFor(() => expect(router.state.location.pathname).toBe("/evaluacion/subtests/10/items/1"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      expect(puts.filter((p) => p.itemId === 1002)).toHaveLength(0);

      // Pestaña oculta 20 s en el ítem 1: ese tiempo no se cuenta.
      const secondsBefore = puts[puts.length - 1]?.timeUsedSeconds ?? 0;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });
      visibility.mockReturnValue("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000);
      });
      visibility.mockReturnValue("visible");
      document.dispatchEvent(new Event("visibilitychange"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });
      fireEvent.click(screen.getByRole("button", { name: /siguiente/i }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });

      const last = puts[puts.length - 1];
      expect(last).toMatchObject({ itemId: 1001, selectedOptionIds: [10001] });
      // ~2 s extra de revisión (1 antes de ocultar + 1 al volver); jamás los 20 s con la pestaña oculta.
      expect((last?.timeUsedSeconds ?? 0) - secondsBefore).toBeLessThanOrEqual(3);
      expect((last?.timeUsedSeconds ?? 0) - secondsBefore).toBeGreaterThanOrEqual(1);
    });

    it("BAJO 7 · las flechas ←/→ se bloquean mientras se finaliza el subtest, igual que los botones", async () => {
      fakeClock();
      useParticipantAuth.getState().setSession({ token: "jwt-42", assignmentId: 42 });
      let releaseFinish: (() => void) | null = null;
      server.use(
        http.get(`${API}/evaluacion-participante/yo`, () =>
          ok(
            makeEvaluationWire({
              subtests: [
                makeSubtestWire(10, 1, "EN_PROGRESO", {
                  timeLimitSeconds: 10,
                  startedAt: "2026-11-25T11:59:52.000Z",
                  ...liveTiming(2),
                  paused: false,
                }),
                makeSubtestWire(20, 2, "NO_INICIADO"),
              ],
            }),
          ),
        ),
        http.post(
          `${API}/intentos/101/subtests/10/finalizar`,
          () =>
            new Promise<Response>((resolve) => {
              releaseFinish = () =>
                resolve(ok({ id: 305, intentoId: 101, subtestId: 10, estado: "COMPLETADO" }) as unknown as Response);
            }),
        ),
      );

      const { router } = await renderRunnerAt("/evaluacion/subtests/10/items/2");
      expect(await screen.findByText("Pregunta 2 del subtest 10")).toBeInTheDocument();

      // Vence el tiempo: finalización en curso (la petición queda retenida).
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_500);
      });
      await waitFor(() => expect(releaseFinish).not.toBeNull());
      expect(screen.getByRole("button", { name: /anterior/i })).toBeDisabled();

      fireEvent.keyDown(document.body, { key: "ArrowLeft" });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      expect(router.state.location.pathname).toBe("/evaluacion/subtests/10/items/2");

      await act(async () => {
        (releaseFinish as (() => void) | null)?.();
        await vi.advanceTimersByTimeAsync(200);
      });
    });
  });
  // ---------------------------------------------------------------------------------------------
  // F2-FIX-2 · hallazgos de la re-verificación de la Fase 2
  // ---------------------------------------------------------------------------------------------
  describe("F2-FIX-2", () => {
    const fakeClock = () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      vi.setSystemTime(Date.parse("2026-11-25T12:00:00.000Z"));
    };
    // Avanza el reloj falso en pasos cortos para que las respuestas de red (msw) se procesen entre tick y tick.
    const advanceInSteps = async (totalMs: number, stepMs = 500) => {
      for (let elapsed = 0; elapsed < totalMs; elapsed += stepMs) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(stepMs);
        });
      }
    };

    it("ALTO 1 · un /yo fallido al volver NO levanta la compuerta del deadline: no se cierra con el plazo viejo, muestra «reconectando» y reintenta", async () => {
      fakeClock();
      useParticipantAuth.getState().setSession({ token: "jwt-42", assignmentId: 42 });
      let finishCalls = 0;
      let yoCalls = 0;
      let yoFails = false;
      let serverRemaining = 5;
      server.use(
        http.get(`${API}/evaluacion-participante/yo`, () => {
          yoCalls += 1;
          if (yoFails) return apiErr(500, "SERVER_ERROR", "Fallo temporal");
          return ok(
            makeEvaluationWire({
              subtests: [
                makeSubtestWire(10, 1, "EN_PROGRESO", {
                  timeLimitSeconds: 600,
                  startedAt: "2026-11-25T11:55:00.000Z",
                  remainingSeconds: serverRemaining,
                  paused: false,
                  serverNow: new Date(Date.now()).toISOString(),
                }),
              ],
            }),
          );
        }),
        http.post(`${API}/intentos/101/subtests/10/finalizar`, () => {
          finishCalls += 1;
          return ok({ id: 305, intentoId: 101, subtestId: 10, estado: "COMPLETADO" });
        }),
      );

      const visibility = vi.spyOn(document, "visibilityState", "get");
      const { router } = await renderRunnerAt("/evaluacion/subtests/10/items/1");
      expect(await screen.findByText("Pregunta 1 del subtest 10")).toBeInTheDocument();

      // Quedan 5 s locales al ocultar la pestaña; el servidor amplía el tiempo (pausa) y, al volver, /yo responde 500.
      visibility.mockReturnValue("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(8_000);
      });
      serverRemaining = 100;
      yoFails = true;
      const yoBefore = yoCalls;
      visibility.mockReturnValue("visible");
      document.dispatchEvent(new Event("visibilitychange"));
      await advanceInSteps(12_000);

      expect(finishCalls).toBe(0); // el plazo local viejo ya venció, pero no hay /yo exitoso posterior a la vuelta
      expect(router.state.location.pathname).toBe("/evaluacion/subtests/10/items/1");
      expect(yoCalls - yoBefore).toBeGreaterThanOrEqual(2); // reintenta con backoff
      expect(screen.getAllByText(/reconectando/i).length).toBeGreaterThan(0);

      // Vuelve la red: un /yo exitoso re-ancla el tiempo (100 s) y el estado «reconectando» desaparece.
      yoFails = false;
      await advanceInSteps(10_000);
      expect(finishCalls).toBe(0);
      expect(screen.queryByText(/reconectando/i)).not.toBeInTheDocument();
      expect(screen.getByRole("timer")).toHaveTextContent(/^01:[0-9]{2}$/);
    });

    it("ALTO 1 · tras recuperar /yo, si el servidor confirma que el tiempo se agotó, SÍ se cierra por tiempo (una sola vez)", async () => {
      fakeClock();
      useParticipantAuth.getState().setSession({ token: "jwt-42", assignmentId: 42 });
      let finishCalls = 0;
      let yoFails = false;
      server.use(
        http.get(`${API}/evaluacion-participante/yo`, () => {
          if (yoFails) return apiErr(500, "SERVER_ERROR", "Fallo temporal");
          return ok(
            makeEvaluationWire({
              subtests: [
                makeSubtestWire(10, 1, "EN_PROGRESO", {
                  timeLimitSeconds: 600,
                  startedAt: "2026-11-25T11:55:00.000Z",
                  ...liveTiming(5),
                  paused: false,
                }),
                makeSubtestWire(20, 2, "NO_INICIADO"),
              ],
            }),
          );
        }),
        http.post(`${API}/intentos/101/subtests/10/finalizar`, () => {
          finishCalls += 1;
          return ok({ id: 305, intentoId: 101, subtestId: 10, estado: "COMPLETADO" });
        }),
      );

      const visibility = vi.spyOn(document, "visibilityState", "get");
      const { router } = await renderRunnerAt("/evaluacion/subtests/10/items/1");
      expect(await screen.findByText("Pregunta 1 del subtest 10")).toBeInTheDocument();

      visibility.mockReturnValue("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(8_000);
      });
      yoFails = true;
      visibility.mockReturnValue("visible");
      document.dispatchEvent(new Event("visibilitychange"));
      await advanceInSteps(6_000);
      expect(finishCalls).toBe(0);

      // /yo vuelve a responder y el servidor dice 5 s restantes: el reloj re-anclado vence y entonces sí cierra.
      yoFails = false;
      for (let step = 0; step < 40 && router.state.location.pathname !== "/evaluacion/sesion"; step += 1) {
        await advanceInSteps(500);
      }
      await waitFor(() => expect(router.state.location.pathname).toBe("/evaluacion/sesion"));
      expect(finishCalls).toBe(1);
    });

    it("MEDIO 2 · un sondeo /yo iniciado antes de ocultar la pestaña que responde con ella oculta NO suma el tiempo oculto al ítem", async () => {
      fakeClock();
      useParticipantAuth.getState().setSession({ token: "jwt-42", assignmentId: 42 });
      const puts: Array<{ itemId: number; selectedOptionIds: number[]; timeUsedSeconds?: number }> = [];
      let holdPoll = false;
      let releasePoll: (() => void) | null = null;
      const wire = () =>
        makeEvaluationWire({
          subtests: [
            makeSubtestWire(10, 1, "EN_PROGRESO", {
              timeLimitSeconds: 600,
              startedAt: "2026-11-25T11:55:00.000Z",
              remainingSeconds: 500,
              paused: false,
              serverNow: new Date(Date.now()).toISOString(),
            }),
          ],
        });
      server.use(
        http.get(`${API}/evaluacion-participante/yo`, () => {
          if (!holdPoll) return ok(wire());
          holdPoll = false;
          return new Promise<Response>((resolve) => {
            releasePoll = () => resolve(ok(wire()) as unknown as Response);
          });
        }),
        http.put(`${API}/intentos/101/items/:itemId/respuesta`, async ({ request, params }) => {
          const body = (await request.json()) as { selectedOptionIds: number[]; timeUsedSeconds?: number };
          puts.push({ itemId: Number(params.itemId), ...body });
          return ok({ id: 1, intentoId: 101, itemId: Number(params.itemId), esFinal: true, requiereRevisionManual: false });
        }),
      );
      const visibility = vi.spyOn(document, "visibilityState", "get");

      await renderRunnerAt("/evaluacion/subtests/10/items/1");
      expect(await screen.findByText("Pregunta 1 del subtest 10")).toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000);
      });
      fireEvent.click(screen.getByRole("radio", { name: /Opción A1/i }));
      await waitFor(() => expect(puts).toHaveLength(1));

      // El siguiente sondeo arranca con la pestaña visible y queda retenido; la pestaña se oculta ANTES de que responda.
      holdPoll = true;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_500);
      });
      await waitFor(() => expect(releasePoll).not.toBeNull());
      visibility.mockReturnValue("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      await waitFor(() => expect(puts.length).toBeGreaterThanOrEqual(2)); // al ocultar se persistió el tiempo de revisión
      const secondsWhenHidden = puts[puts.length - 1]?.timeUsedSeconds ?? 0;

      // El sondeo responde con la pestaña OCULTA (la máquina recibe timing nuevo) y pasan 20 s en segundo plano.
      await act(async () => {
        (releasePoll as (() => void) | null)?.();
        await vi.advanceTimersByTimeAsync(300);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000);
      });
      visibility.mockReturnValue("visible");
      document.dispatchEvent(new Event("visibilitychange"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });
      const putsBeforeLeaving = puts.length;
      fireEvent.click(screen.getByRole("button", { name: /siguiente/i }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      await waitFor(() => expect(puts.length).toBeGreaterThan(putsBeforeLeaving)); // al salir del ítem se reescribe el tiempo total

      const last = puts[puts.length - 1];
      expect(last).toMatchObject({ itemId: 1001, selectedOptionIds: [10001] });
      // ~1 s tras volver; jamás los ~20 s con la pestaña oculta.
      expect((last?.timeUsedSeconds ?? 0) - secondsWhenHidden).toBeLessThanOrEqual(3);
      expect((last?.timeUsedSeconds ?? 0) - secondsWhenHidden).toBeGreaterThanOrEqual(1);
    });
  });

  // ---------------------------------------------------------------------------------------------
  // F2-FIX-3 · el vencimiento del plazo local NUNCA cierra: primero se confirma con el servidor
  // ---------------------------------------------------------------------------------------------
  describe("F2-FIX-3", () => {
    const fakeClock = () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      vi.setSystemTime(FAKE_T0);
    };
    const advanceInSteps = async (totalMs: number, stepMs = 500) => {
      for (let elapsed = 0; elapsed < totalMs; elapsed += stepMs) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(stepMs);
        });
      }
    };
    const bulkRows = (body: Array<{ itemId: number }>) =>
      body.map((answer) => ({ itemId: answer.itemId, status: "GUARDADA", code: null, answerId: 9000 + answer.itemId }));
    const evaluationWith = (timing: Record<string, unknown>) =>
      makeEvaluationWire({
        subtests: [
          makeSubtestWire(10, 1, "EN_PROGRESO", { timeLimitSeconds: 600, paused: false, ...timing }),
          makeSubtestWire(20, 2, "NO_INICIADO"),
        ],
      });
    const finishOk = () => ok({ id: 305, intentoId: 101, subtestId: 10, estado: "COMPLETADO" });

    it("escenario de GPT · sondeo visible con 500 y plazo viejo vencido: NO hay POST /finalizar; al recuperar /yo con tiempo extra se re-ancla", async () => {
      fakeClock();
      useParticipantAuth.getState().setSession({ token: "jwt-42", assignmentId: 42 });
      let finishCalls = 0;
      let yoFails = false;
      let recovered = false;
      server.use(
        http.get(`${API}/evaluacion-participante/yo`, () => {
          if (yoFails) return apiErr(500, "SERVER_ERROR", "Fallo del sondeo");
          // Último /yo exitoso: 18 s. Tras la pausa del servidor (12 s) el tiempo restante real es 12 s más.
          return ok(evaluationWith(recovered ? { ...liveTiming(0), remainingSeconds: 12 } : liveTiming(18)));
        }),
        http.post(`${API}/intentos/101/subtests/10/finalizar`, () => {
          finishCalls += 1;
          return finishOk();
        }),
      );

      const { router } = await renderRunnerAt("/evaluacion/subtests/10/items/1");
      expect(await screen.findByText("Pregunta 1 del subtest 10")).toBeInTheDocument();

      // La pestaña SIGUE visible; el servidor pausa 12 s y el sondeo periódico devuelve 500.
      yoFails = true;
      await advanceInSteps(24_000);

      expect(finishCalls).toBe(0); // el plazo viejo (18 s) ya venció, pero el servidor tenía tiempo
      expect(router.state.location.pathname).toBe("/evaluacion/subtests/10/items/1");
      expect(screen.getAllByText(/reconectando/i).length).toBeGreaterThan(0);

      // /yo se recupera con tiempo extra: se re-ancla el deadline y se sigue respondiendo.
      yoFails = false;
      recovered = true;
      await advanceInSteps(10_000);
      expect(finishCalls).toBe(0);
      expect(router.state.location.pathname).toBe("/evaluacion/subtests/10/items/1");
      expect(screen.queryByText(/reconectando/i)).not.toBeInTheDocument();
      expect(screen.getByRole("timer")).toHaveTextContent(/^00:(0\d|1[0-2])$/);
      expect(screen.getByRole("radio", { name: /Opción A1/i })).toBeEnabled();
    });

    it("vencimiento con un /yo que confirma 0 s: flushBeforeFinish y finishSubtest, una sola vez y en ese orden", async () => {
      fakeClock();
      useParticipantAuth.getState().setSession({ token: "jwt-42", assignmentId: 42 });
      const order: string[] = [];
      let finishCalls = 0;
      let yoCallsAfterExpiry = 0;
      server.use(
        http.get(`${API}/evaluacion-participante/yo`, () => {
          const timing = liveTiming(3);
          if (timing.remainingSeconds <= 0) yoCallsAfterExpiry += 1;
          return ok(evaluationWith(timing));
        }),
        http.put(`${API}/intentos/101/items/1001/respuesta`, () => apiErr(503, "UNAVAILABLE", "Sin conexión")),
        http.post(`${API}/intentos/101/respuestas/bulk-sync`, async ({ request }) => {
          const body = (await request.json()) as Array<{ itemId: number }>;
          order.push("FLUSH");
          return ok(bulkRows(body));
        }),
        http.post(`${API}/intentos/101/subtests/10/finalizar`, () => {
          finishCalls += 1;
          order.push("FINISH");
          return finishOk();
        }),
      );

      const { router } = await renderRunnerAt("/evaluacion/subtests/10/items/1");
      expect(await screen.findByText("Pregunta 1 del subtest 10")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("radio", { name: /Opción A1/i }));

      await advanceInSteps(6_000);
      await waitFor(() => expect(router.state.location.pathname).toBe("/evaluacion/sesion"));

      expect(yoCallsAfterExpiry).toBeGreaterThanOrEqual(1); // antes de cerrar consultó al servidor
      expect(finishCalls).toBe(1);
      expect(order).toContain("FLUSH");
      expect(order.indexOf("FLUSH")).toBeLessThan(order.indexOf("FINISH"));
    });

    it("vencimiento con un /yo que trae tiempo extra: NO se cierra y el cronómetro se re-ancla", async () => {
      fakeClock();
      useParticipantAuth.getState().setSession({ token: "jwt-42", assignmentId: 42 });
      let finishCalls = 0;
      let yoCalls = 0;
      server.use(
        http.get(`${API}/evaluacion-participante/yo`, () => {
          yoCalls += 1;
          // El servidor pausó: al consultar tras el vencimiento local aún quedan 60 s.
          return ok(evaluationWith(yoCalls === 1 ? liveTiming(3) : { ...liveTiming(0), remainingSeconds: 60 }));
        }),
        http.post(`${API}/intentos/101/subtests/10/finalizar`, () => {
          finishCalls += 1;
          return finishOk();
        }),
      );

      const { router } = await renderRunnerAt("/evaluacion/subtests/10/items/1");
      expect(await screen.findByText("Pregunta 1 del subtest 10")).toBeInTheDocument();

      await advanceInSteps(6_000);

      expect(yoCalls).toBeGreaterThanOrEqual(2); // verificó con el servidor al vencer el plazo local
      expect(finishCalls).toBe(0);
      expect(router.state.location.pathname).toBe("/evaluacion/subtests/10/items/1");
      expect(screen.getByRole("timer")).toHaveTextContent(/^00:(5\d)$/);
      expect(screen.queryByText(/reconectando/i)).not.toBeInTheDocument();
    });

    it("vencimiento con /yo fallando de forma persistente: no hay POST /finalizar, aparece «Reconectando…» y la edición se bloquea solo pasada la gracia", async () => {
      fakeClock();
      useParticipantAuth.getState().setSession({ token: "jwt-42", assignmentId: 42 });
      let finishCalls = 0;
      let yoCalls = 0;
      let yoFails = false;
      server.use(
        http.get(`${API}/evaluacion-participante/yo`, () => {
          yoCalls += 1;
          if (yoFails) return apiErr(503, "UNAVAILABLE", "Sin servicio");
          return ok(evaluationWith(liveTiming(3)));
        }),
        http.post(`${API}/intentos/101/subtests/10/finalizar`, () => {
          finishCalls += 1;
          return finishOk();
        }),
      );

      const { router } = await renderRunnerAt("/evaluacion/subtests/10/items/1");
      expect(await screen.findByText("Pregunta 1 del subtest 10")).toBeInTheDocument();
      yoFails = true;
      const yoBefore = yoCalls;

      // Poco después del vencimiento (< gracia): «Reconectando…», sin cierre y la edición sigue habilitada.
      await advanceInSteps(8_000);
      expect(finishCalls).toBe(0);
      expect(screen.getAllByText(/reconectando/i).length).toBeGreaterThan(0);
      expect(yoCalls - yoBefore).toBeGreaterThanOrEqual(2); // reintenta con backoff
      expect(screen.getByRole("radio", { name: /Opción A1/i })).toBeEnabled();

      // Pasada la gracia (venció hace > 15 s) sin confirmar: se deshabilita SOLO la edición; tampoco se cierra.
      await advanceInSteps(EDIT_LOCK_GRACE_MS + 2_000);
      expect(finishCalls).toBe(0);
      expect(router.state.location.pathname).toBe("/evaluacion/subtests/10/items/1");
      expect(screen.getAllByText(/reconectando/i).length).toBeGreaterThan(0);
      expect(screen.getByRole("radio", { name: /Opción A1/i })).toBeDisabled();
    });

    it("un 409 TIEMPO_AGOTADO al responder cuenta como confirmación del servidor: flush + finalizar y avanza", async () => {
      fakeClock();
      useParticipantAuth.getState().setSession({ token: "jwt-42", assignmentId: 42 });
      let finishCalls = 0;
      let closed = false;
      server.use(
        http.get(`${API}/evaluacion-participante/yo`, () =>
          // El /yo del sondeo aún no refleja el cierre: el veredicto llega por el 409 de la respuesta.
          ok(
            makeEvaluationWire({
              subtests: [
                makeSubtestWire(10, 1, closed ? "COMPLETADO" : "EN_PROGRESO", {
                  timeLimitSeconds: 600,
                  paused: false,
                  remainingSeconds: 500,
                  serverNow: new Date(Date.now()).toISOString(),
                }),
                makeSubtestWire(20, 2, "NO_INICIADO"),
              ],
            }),
          ),
        ),
        http.put(`${API}/intentos/101/items/1001/respuesta`, () => apiErr(409, "TIEMPO_AGOTADO", "El tiempo del subtest ya expiró")),
        http.post(`${API}/intentos/101/subtests/10/finalizar`, () => {
          finishCalls += 1;
          closed = true;
          return apiErr(409, "TIEMPO_AGOTADO", "El tiempo del subtest ya expiró");
        }),
      );

      const { router } = await renderRunnerAt("/evaluacion/subtests/10/items/1");
      expect(await screen.findByText("Pregunta 1 del subtest 10")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("radio", { name: /Opción A1/i }));
      await advanceInSteps(3_000);

      await waitFor(() => expect(router.state.location.pathname).toBe("/evaluacion/sesion"));
      expect(finishCalls).toBe(1);
      expect(await screen.findByText("Subtests de la Evaluación")).toBeInTheDocument();
    });
  });
  // ---------------------------------------------------------------------------------------------
  // F2-FIX-4 · una respuesta de /yo de una solicitud invalidada nunca se adopta; subtest sin límite
  // ---------------------------------------------------------------------------------------------
  describe("F2-FIX-4", () => {
    const fakeClock = () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      vi.setSystemTime(FAKE_T0);
    };
    const advanceInSteps = async (totalMs: number, stepMs = 500) => {
      for (let elapsed = 0; elapsed < totalMs; elapsed += stepMs) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(stepMs);
        });
      }
    };
    const openWire = (timing: Record<string, unknown> = {}) =>
      makeEvaluationWire({
        subtests: [
          makeSubtestWire(10, 1, "EN_PROGRESO", {
            timeLimitSeconds: 600,
            startedAt: "2026-11-25T11:55:00.000Z",
            paused: false,
            ...liveTiming(500),
            ...timing,
          }),
        ],
      });
    const pausedWire = () =>
      makeEvaluationWire({
        sessionStatus: "PAUSADA",
        pausedAt: new Date(Date.now()).toISOString(),
        subtests: [
          makeSubtestWire(10, 1, "EN_PROGRESO", {
            timeLimitSeconds: 600,
            startedAt: "2026-11-25T11:55:00.000Z",
            remainingSeconds: 490,
            paused: true,
            serverNow: new Date(Date.now()).toISOString(),
          }),
        ],
      });

    it("escenario de GPT · un /yo PAUSADA en vuelo que responde con la pestaña oculta no se adopta: al volver /yo da 500 y NO queda en pausa; al recuperar /yo todo es normal", async () => {
      fakeClock();
      useParticipantAuth.getState().setSession({ token: "jwt-42", assignmentId: 42 });
      let mode: "normal" | "hold" | "fail" = "normal";
      let releasePoll: (() => void) | null = null;
      server.use(
        http.get(`${API}/evaluacion-participante/yo`, () => {
          if (mode === "fail") return apiErr(500, "SERVER_ERROR", "Fallo al volver");
          if (mode === "hold") {
            mode = "normal";
            return new Promise<Response>((resolve) => {
              // La solicitud ya estaba en vuelo cuando el servidor pausó; responde PAUSADA tarde.
              releasePoll = () => resolve(ok(pausedWire()) as unknown as Response);
            });
          }
          return ok(openWire());
        }),
      );
      const visibility = vi.spyOn(document, "visibilityState", "get");

      await renderRunnerAt("/evaluacion/subtests/10/items/1");
      expect(await screen.findByText("Pregunta 1 del subtest 10")).toBeInTheDocument();

      // Un sondeo arranca con la pestaña visible y queda retenido.
      mode = "hold";
      await advanceInSteps(10_500);
      await waitFor(() => expect(releasePoll).not.toBeNull());

      // Se oculta la pestaña; el sondeo responde PAUSADA con la pestaña oculta; la sesión ya se reanudó.
      visibility.mockReturnValue("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      await act(async () => {
        (releasePoll as (() => void) | null)?.();
        await vi.advanceTimersByTimeAsync(300);
      });
      expect(screen.queryByText("Evaluación pausada")).not.toBeInTheDocument();

      // Al volver, /yo falla con 500: se conserva el último estado bueno; el participante sigue respondiendo.
      mode = "fail";
      visibility.mockReturnValue("visible");
      document.dispatchEvent(new Event("visibilitychange"));
      await advanceInSteps(3_000);
      expect(screen.queryByText("Evaluación pausada")).not.toBeInTheDocument();
      expect(screen.getByText("Pregunta 1 del subtest 10")).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: /Opción A1/i })).toBeEnabled();
      fireEvent.click(screen.getByRole("radio", { name: /Opción A1/i }));
      expect(screen.getByRole("radio", { name: /Opción A1/i })).toBeChecked();

      // /yo se recupera: todo normal.
      mode = "normal";
      await advanceInSteps(10_000);
      expect(screen.queryByText("Evaluación pausada")).not.toBeInTheDocument();
      expect(screen.queryByText(/reconectando/i)).not.toBeInTheDocument();
      expect(screen.getByRole("radio", { name: /Opción A1/i })).toBeEnabled();
      expect(screen.getByRole("timer")).toBeInTheDocument();
    });

    it("fuera de orden · un /yo viejo (PAUSADA) que llega después de uno nuevo (ABIERTA) no pisa el estado", async () => {
      fakeClock();
      useParticipantAuth.getState().setSession({ token: "jwt-42", assignmentId: 42 });
      let mode: "normal" | "hold" = "normal";
      let releaseOld: (() => void) | null = null;
      server.use(
        http.get(`${API}/evaluacion-participante/yo`, () => {
          if (mode === "hold") {
            mode = "normal";
            return new Promise<Response>((resolve) => {
              releaseOld = () => resolve(ok(pausedWire()) as unknown as Response);
            });
          }
          return ok(openWire());
        }),
      );
      const visibility = vi.spyOn(document, "visibilityState", "get");

      await renderRunnerAt("/evaluacion/subtests/10/items/1");
      expect(await screen.findByText("Pregunta 1 del subtest 10")).toBeInTheDocument();

      // Solicitud vieja retenida; la pestaña se oculta y vuelve: la verificación nueva responde ABIERTA primero.
      mode = "hold";
      await advanceInSteps(10_500);
      await waitFor(() => expect(releaseOld).not.toBeNull());
      visibility.mockReturnValue("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      visibility.mockReturnValue("visible");
      document.dispatchEvent(new Event("visibilitychange"));
      await advanceInSteps(2_000);
      expect(screen.queryByText("Evaluación pausada")).not.toBeInTheDocument();

      // La respuesta vieja llega después: no pisa.
      await act(async () => {
        (releaseOld as (() => void) | null)?.();
        await vi.advanceTimersByTimeAsync(500);
      });
      await advanceInSteps(1_000);
      expect(screen.queryByText("Evaluación pausada")).not.toBeInTheDocument();
      expect(screen.getByRole("radio", { name: /Opción A1/i })).toBeEnabled();
    });

    it("subtest SIN límite · al volver con /yo 200 no hay «Reconectando…» ni reintentos", async () => {
      fakeClock();
      useParticipantAuth.getState().setSession({ token: "jwt-42", assignmentId: 42 });
      let yoCalls = 0;
      server.use(
        http.get(`${API}/evaluacion-participante/yo`, () => {
          yoCalls += 1;
          // Ilimitado: sin remainingSeconds (null del backend) y con startedAt.
          return ok(
            makeEvaluationWire({
              subtests: [
                makeSubtestWire(10, 1, "EN_PROGRESO", {
                  timeLimitSeconds: null,
                  startedAt: "2026-11-25T11:55:00.000Z",
                  remainingSeconds: null,
                  paused: false,
                  serverNow: new Date(Date.now()).toISOString(),
                }),
              ],
            }),
          );
        }),
      );
      const visibility = vi.spyOn(document, "visibilityState", "get");

      await renderRunnerAt("/evaluacion/subtests/10/items/1");
      expect(await screen.findByText("Pregunta 1 del subtest 10")).toBeInTheDocument();

      visibility.mockReturnValue("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      await advanceInSteps(2_000);
      const yoBefore = yoCalls;
      visibility.mockReturnValue("visible");
      document.dispatchEvent(new Event("visibilitychange"));
      await advanceInSteps(500);
      expect(yoCalls).toBe(yoBefore + 1); // la vuelta consulta /yo una sola vez
      // Sin reintentos: ni «Reconectando…» ni más consultas durante el backoff (menos que el intervalo de sondeo).
      await advanceInSteps(8_000);
      expect(yoCalls).toBe(yoBefore + 1);
      expect(screen.queryByText(/reconectando/i)).not.toBeInTheDocument();
      expect(screen.getByRole("radio", { name: /Opción A1/i })).toBeEnabled();
    });
  });

  // ---------------------------------------------------------------------------------------------
  // F2-FIX-5 · TODO /yo (incluidos los loaders de las rutas) toma ticket de vigencia
  // ---------------------------------------------------------------------------------------------
  describe("F2-FIX-5", () => {
    const fakeClock = () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      vi.setSystemTime(FAKE_T0);
    };
    const advanceInSteps = async (totalMs: number, stepMs = 500) => {
      for (let elapsed = 0; elapsed < totalMs; elapsed += stepMs) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(stepMs);
        });
      }
    };
    const openWire = () =>
      makeEvaluationWire({
        subtests: [
          makeSubtestWire(10, 1, "EN_PROGRESO", {
            timeLimitSeconds: 600,
            startedAt: "2026-11-25T11:55:00.000Z",
            ...liveTiming(500),
            paused: false,
          }),
        ],
      });
    const pausedWire = () =>
      makeEvaluationWire({
        sessionStatus: "PAUSADA",
        pausedAt: new Date(Date.now()).toISOString(),
        subtests: [
          makeSubtestWire(10, 1, "EN_PROGRESO", {
            timeLimitSeconds: 600,
            startedAt: "2026-11-25T11:55:00.000Z",
            remainingSeconds: 490,
            paused: true,
            serverNow: new Date(Date.now()).toISOString(),
          }),
        ],
      });

    it("escenario de GPT · carga directa del ítem con el primer /yo en vuelo: se oculta la pestaña, llega un PAUSADA obsoleto, al volver /yo da 500 → sin «Evaluación pausada» y se puede responder", async () => {
      fakeClock();
      useParticipantAuth.getState().setSession({ token: "jwt-42", assignmentId: 42 });
      let mode: "hold-first" | "fail" | "normal" = "hold-first";
      let releaseFirst: (() => void) | null = null;
      server.use(
        http.get(`${API}/evaluacion-participante/yo`, () => {
          if (mode === "fail") return apiErr(500, "SERVER_ERROR", "Fallo al volver");
          if (mode === "hold-first") {
            mode = "normal";
            return new Promise<Response>((resolve) => {
              releaseFirst = () => resolve(ok(pausedWire()) as unknown as Response);
            });
          }
          return ok(openWire());
        }),
      );
      const visibility = vi.spyOn(document, "visibilityState", "get");

      // Carga directa: el primer /yo (el del loader de la ruta) queda en vuelo; la ruta aún no se monta.
      // `gcTime` real: lo que carga el loader debe seguir en la caché cuando se monta el runner (como en producción).
      const rendering = renderRunnerAt(
        "/evaluacion/subtests/10/items/1",
        new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 5 * 60_000 } } }),
      );
      await waitFor(() => expect(releaseFirst).not.toBeNull());

      // Se oculta la pestaña; el /yo en vuelo responde PAUSADA (obsoleto).
      visibility.mockReturnValue("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      await act(async () => {
        (releaseFirst as (() => void) | null)?.();
        await vi.advanceTimersByTimeAsync(300);
      });
      await rendering;
            expect(screen.queryByText("Evaluación pausada")).not.toBeInTheDocument();

      // Al volver, el nuevo /yo responde 500: nunca «Evaluación pausada».
      mode = "fail";
      visibility.mockReturnValue("visible");
      document.dispatchEvent(new Event("visibilitychange"));
      await advanceInSteps(3_000);
      expect(screen.queryByText("Evaluación pausada")).not.toBeInTheDocument();

      // /yo se recupera: se puede responder.
      mode = "normal";
      await advanceInSteps(15_000);
      expect(screen.queryByText("Evaluación pausada")).not.toBeInTheDocument();
      expect(await screen.findByText("Pregunta 1 del subtest 10")).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: /Opción A1/i })).toBeEnabled();
      fireEvent.click(screen.getByRole("radio", { name: /Opción A1/i }));
      expect(screen.getByRole("radio", { name: /Opción A1/i })).toBeChecked();
    });

    it("dos resultados con el MISMO dataUpdatedAt · el vigente se aplica (pausa) y el de una solicitud invalidada se descarta, según su ticket", async () => {
      fakeClock();
      // Todos los resultados comparten el mismo milisegundo: la deduplicación no puede ser por `dataUpdatedAt`.
      vi.spyOn(Date, "now").mockReturnValue(FAKE_T0);
      useParticipantAuth.getState().setSession({ token: "jwt-42", assignmentId: 42 });
      let mode: "normal" | "paused" | "hold" = "normal";
      let releaseOld: (() => void) | null = null;
      server.use(
        http.get(`${API}/evaluacion-participante/yo`, () => {
          if (mode === "paused") return ok(pausedWire());
          if (mode === "hold") {
            mode = "normal";
            return new Promise<Response>((resolve) => {
              releaseOld = () => resolve(ok(pausedWire()) as unknown as Response);
            });
          }
          return ok(openWire());
        }),
      );
      const visibility = vi.spyOn(document, "visibilityState", "get");

      await renderRunnerAt("/evaluacion/subtests/10/items/1");
      expect(await screen.findByText("Pregunta 1 del subtest 10")).toBeInTheDocument();

      // 1) Solicitud vieja retenida; se oculta y vuelve la pestaña: la nueva responde ABIERTA y se aplica.
      mode = "hold";
      await advanceInSteps(10_500);
      await waitFor(() => expect(releaseOld).not.toBeNull());
      visibility.mockReturnValue("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      visibility.mockReturnValue("visible");
      document.dispatchEvent(new Event("visibilitychange"));
      await advanceInSteps(2_000);
      // La vieja (mismo milisegundo, ticket invalidado) llega tarde: se DESCARTA.
      await act(async () => {
        (releaseOld as (() => void) | null)?.();
        await vi.advanceTimersByTimeAsync(500);
      });
      await advanceInSteps(1_000);
      expect(screen.queryByText("Evaluación pausada")).not.toBeInTheDocument();
      expect(screen.getByRole("radio", { name: /Opción A1/i })).toBeEnabled();

      // 2) Un /yo vigente con PAUSADA y el mismo milisegundo SE APLICA.
      mode = "paused";
      await advanceInSteps(10_500);
      expect(await screen.findByText("Evaluación pausada")).toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------------------------
  // F2-FIX-6 · un loader nunca redirige con un /yo invalidado; las guardas reactivas corrigen con el vigente
  // ---------------------------------------------------------------------------------------------
  describe("F2-FIX-6", () => {
    const fakeClock = () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      vi.setSystemTime(FAKE_T0);
    };
    const advanceInSteps = async (totalMs: number, stepMs = 500) => {
      for (let elapsed = 0; elapsed < totalMs; elapsed += stepMs) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(stepMs);
        });
      }
    };
    const ITEM_PATH = "/evaluacion/subtests/10/items/1";
    const INSTRUCTIONS_PATH = "/evaluacion/subtests/10/instrucciones";
    /** /yo obsoleto: PAUSADA con el subtest SIN iniciar (llega con la pestaña oculta). */
    const stalePausedNotStartedWire = () =>
      makeEvaluationWire({
        sessionStatus: "PAUSADA",
        pausedAt: new Date(Date.now()).toISOString(),
        subtests: [makeSubtestWire(10, 1, "NO_INICIADO")],
      });
    /** /yo vigente: el subtest ya está EN_PROGRESO. */
    const inProgressWire = () =>
      makeEvaluationWire({
        subtests: [
          makeSubtestWire(10, 1, "EN_PROGRESO", {
            timeLimitSeconds: 600,
            startedAt: "2026-11-25T11:55:00.000Z",
            ...liveTiming(500),
            paused: false,
          }),
        ],
      });
    /** /yo vigente: el subtest sigue sin iniciar. */
    const notStartedWire = () =>
      makeEvaluationWire({ subtests: [makeSubtestWire(10, 1, "NO_INICIADO")] });

    type Mode = "hold-first" | "fail" | "in-progress" | "not-started";

    /**
     * Carga directa del ítem con el primer /yo (el del loader) en vuelo; se oculta la pestaña y ese /yo responde el
     * PAUSADA obsoleto con el subtest NO_INICIADO. Devuelve lo necesario para continuar el escenario.
     */
    async function loadDirectWithStalePaused(afterStale: Mode) {
      fakeClock();
      useParticipantAuth.getState().setSession({ token: "jwt-42", assignmentId: 42 });
      let mode: Mode = "hold-first";
      let releaseFirst: (() => void) | null = null;
      let yoCalls = 0;
      server.use(
        http.get(`${API}/evaluacion-participante/yo`, () => {
          yoCalls += 1;
          if (mode === "hold-first") {
            mode = afterStale;
            return new Promise<Response>((resolve) => {
              releaseFirst = () => resolve(ok(stalePausedNotStartedWire()) as unknown as Response);
            });
          }
          if (mode === "fail") return apiErr(500, "SERVER_ERROR", "Fallo al volver");
          if (mode === "not-started") return ok(notStartedWire());
          return ok(inProgressWire());
        }),
      );
      const visibility = vi.spyOn(document, "visibilityState", "get");
      const rendering = renderRunnerAt(
        ITEM_PATH,
        new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 5 * 60_000 } } }),
      );
      await waitFor(() => expect(releaseFirst).not.toBeNull());

      // Se oculta la pestaña y el /yo en vuelo responde el PAUSADA obsoleto.
      visibility.mockReturnValue("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      await act(async () => {
        (releaseFirst as (() => void) | null)?.();
        await vi.advanceTimersByTimeAsync(300);
      });
      const utils = await rendering;
      return {
        ...utils,
        visibility,
        yoCalls: () => yoCalls,
        setMode: (next: Mode) => {
          mode = next;
        },
      };
    }

    it("escenario de GPT · PAUSADA obsoleto con el subtest NO_INICIADO y el loader sin confirmar: no se desvía a instrucciones; al llegar el /yo vigente EN_PROGRESO está en el ítem", async () => {
      const ctx = await loadDirectWithStalePaused("fail");

      // El loader pidió un /yo fresco (falló): no confirma → NO redirige y deja montar la ruta.
      // ≥2 y no ===2: con la query en error, el runner ya montado puede refetchear antes de este punto
      // según la carga del pool. Que el loader pide exactamente UNA vez lo fija el test siguiente.
      expect(ctx.yoCalls()).toBeGreaterThanOrEqual(2);
      await advanceInSteps(1_000);
      expect(ctx.router.state.location.pathname).toBe(ITEM_PATH);
      expect(screen.queryByText("Evaluación pausada")).not.toBeInTheDocument();

      // Vuelve la pestaña y el /yo vigente confirma EN_PROGRESO: sigue en el ítem y se puede responder.
      ctx.setMode("in-progress");
      ctx.visibility.mockReturnValue("visible");
      document.dispatchEvent(new Event("visibilitychange"));
      await advanceInSteps(15_000);
      expect(ctx.router.state.location.pathname).toBe(ITEM_PATH);
      expect(await screen.findByText("Pregunta 1 del subtest 10")).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: /Opción A1/i })).toBeEnabled();
    });

    it("el loader vuelve a pedir un /yo fresco (una vez) cuando el de la caché quedó invalidado y decide con el vigente", async () => {
      const ctx = await loadDirectWithStalePaused("in-progress");
      expect(ctx.yoCalls()).toBe(2);
      ctx.visibility.mockReturnValue("visible");
      await advanceInSteps(1_000);
      expect(ctx.router.state.location.pathname).toBe(ITEM_PATH);
      expect(await screen.findByText("Pregunta 1 del subtest 10")).toBeInTheDocument();
      expect(screen.queryByText("Evaluación pausada")).not.toBeInTheDocument();
    });

    it("sin regresión · un /yo VIGENTE con NO_INICIADO sí redirige a instrucciones (loader)", async () => {
      fakeClock();
      useParticipantAuth.getState().setSession({ token: "jwt-42", assignmentId: 42 });
      server.use(http.get(`${API}/evaluacion-participante/yo`, () => ok(notStartedWire())));
      const { router } = await renderRunnerAt(ITEM_PATH);
      await advanceInSteps(1_000);
      expect(router.state.location.pathname).toBe(INSTRUCTIONS_PATH);
    });

    it("sin regresión · con el loader sin confirmar, un /yo VIGENTE con NO_INICIADO redirige a instrucciones (guarda reactiva del runner)", async () => {
      const ctx = await loadDirectWithStalePaused("fail");
      await advanceInSteps(1_000);
      expect(ctx.router.state.location.pathname).toBe(ITEM_PATH);

      ctx.setMode("not-started");
      ctx.visibility.mockReturnValue("visible");
      document.dispatchEvent(new Event("visibilitychange"));
      await advanceInSteps(15_000);
      expect(ctx.router.state.location.pathname).toBe(INSTRUCTIONS_PATH);
    });

    it("la época de visibilidad se invalida en UN solo listener: ocultar la pestaña con el runner montado invalida una vez", async () => {
      fakeClock();
      useParticipantAuth.getState().setSession({ token: "jwt-42", assignmentId: 42 });
      server.use(http.get(`${API}/evaluacion-participante/yo`, () => ok(inProgressWire())));
      const visibility = vi.spyOn(document, "visibilityState", "get");
      await renderRunnerAt(ITEM_PATH);
      expect(await screen.findByText("Pregunta 1 del subtest 10")).toBeInTheDocument();

      const invalidate = vi.spyOn(evaluationGuard, "invalidateForVisibility");
      visibility.mockReturnValue("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      expect(invalidate).toHaveBeenCalledTimes(1);
    });
  });
  // ---------------------------------------------------------------------------------------------
  // F2-FIX-7 · las guardas reactivas y el loader solo deciden con un /yo vigente
  // ---------------------------------------------------------------------------------------------
  describe("F2-FIX-7", () => {
    const fakeClock = () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      vi.setSystemTime(FAKE_T0);
    };
    const advanceInSteps = async (totalMs: number, stepMs = 500) => {
      for (let elapsed = 0; elapsed < totalMs; elapsed += stepMs) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(stepMs);
        });
      }
    };
    const ITEM_PATH = "/evaluacion/subtests/10/items/1";
    const INSTRUCTIONS_PATH = "/evaluacion/subtests/10/instrucciones";
    const inProgress = (extra: Partial<SubtestWire> = {}) =>
      makeEvaluationWire({
        subtests: [
          makeSubtestWire(10, 1, "EN_PROGRESO", {
            timeLimitSeconds: 600,
            startedAt: "2026-11-25T11:55:00.000Z",
            ...liveTiming(500),
            paused: false,
            ...extra,
          }),
        ],
      });
    const unavailable = () => apiErr(503, "SERVICE_UNAVAILABLE", "Servicio no disponible");
    const newQueryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 5 * 60_000 } } });

    /** Oculta la pestaña (invalida los /yo ya aplicados). */
    const hideTab = (visibility: ReturnType<typeof vi.spyOn>) => {
      visibility.mockReturnValue("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
    };
    const showTab = (visibility: ReturnType<typeof vi.spyOn>) => {
      visibility.mockReturnValue("visible");
      document.dispatchEvent(new Event("visibilitychange"));
    };

    it("MEDIO 2 · ruta de ítems montada con un NO_INICIADO ya aplicado: si se oculta la pestaña y el /yo del loader falla (503), el efecto NO desvía a instrucciones con el /yo obsoleto; el /yo vigente EN_PROGRESO deja al participante en el ítem", async () => {
      fakeClock();
      useParticipantAuth.getState().setSession({ token: "jwt-42", assignmentId: 42 });
      let mode: "not-started" | "fail" | "in-progress" = "not-started";
      server.use(
        http.get(`${API}/evaluacion-participante/yo`, () => {
          if (mode === "fail") return unavailable();
          if (mode === "in-progress") return ok(inProgress());
          return ok(makeEvaluationWire({ subtests: [makeSubtestWire(10, 1, "NO_INICIADO")] }));
        }),
      );
      const visibility = vi.spyOn(document, "visibilityState", "get");
      const { router } = await renderRunnerAt("/evaluacion/sesion", newQueryClient());
      await advanceInSteps(1_000);
      expect(await screen.findByText("Subtest 10")).toBeInTheDocument();

      // NO_INICIADO ya aplicado; se oculta la pestaña y el /yo del loader al navegar al ítem devuelve 503.
      hideTab(visibility);
      mode = "fail";
      void router.navigate({ to: "/evaluacion/subtests/$subtestId/items/$ordinal", params: { subtestId: 10, ordinal: 1 } });
      await advanceInSteps(2_000);
      expect(router.state.location.pathname).toBe(ITEM_PATH);

      // Vuelve la pestaña y el /yo vigente confirma EN_PROGRESO: sigue en el ítem.
      mode = "in-progress";
      showTab(visibility);
      await advanceInSteps(15_000);
      expect(router.state.location.pathname).toBe(ITEM_PATH);
      expect(await screen.findByText("Pregunta 1 del subtest 10")).toBeInTheDocument();
    });

    it("MEDIO 2 · ruta de instrucciones montada con un subtest ya completado (obsoleto): el efecto NO desvía a la lista con el /yo invalidado; el /yo vigente lo deja abrible y sigue en instrucciones", async () => {
      fakeClock();
      useParticipantAuth.getState().setSession({ token: "jwt-42", assignmentId: 42 });
      let mode: "done" | "fail" | "open" = "done";
      server.use(
        http.get(`${API}/evaluacion-participante/yo`, () => {
          if (mode === "fail") return unavailable();
          return ok(
            makeEvaluationWire({
              subtests: [
                makeSubtestWire(10, 1, mode === "open" ? "NO_INICIADO" : "COMPLETADO"),
                makeSubtestWire(20, 2, "NO_INICIADO"),
              ],
            }),
          );
        }),
      );
      const visibility = vi.spyOn(document, "visibilityState", "get");
      const { router } = await renderRunnerAt("/evaluacion/sesion", newQueryClient());
      await advanceInSteps(1_000);
      expect(await screen.findByText("Subtest 20")).toBeInTheDocument();

      hideTab(visibility);
      mode = "fail";
      void router.navigate({ to: "/evaluacion/subtests/$subtestId/instrucciones", params: { subtestId: 10 } });
      await advanceInSteps(2_000);
      expect(router.state.location.pathname).toBe(INSTRUCTIONS_PATH);

      mode = "open";
      showTab(visibility);
      await advanceInSteps(15_000);
      expect(router.state.location.pathname).toBe(INSTRUCTIONS_PATH);
      expect(await screen.findByRole("heading", { name: "Subtest 10" })).toBeInTheDocument();
    });

    it("MEDIO 4 · el loader NO corrige el ordinal si el /yo con el que decide se invalidó mientras esperaba los ítems; el ordinal se corrige después con el /yo vigente", async () => {
      fakeClock();
      useParticipantAuth.getState().setSession({ token: "jwt-42", assignmentId: 42 });
      let itemsRequested = false;
      let releaseItems: () => void = () => undefined;
      const itemsGate = new Promise<void>((resolve) => {
        releaseItems = resolve;
      });
      server.use(
        http.get(`${API}/evaluacion-participante/yo`, () => ok(inProgress({ items: [] }))),
        http.get(`${API}/intentos/101/subtests/10/items`, async () => {
          itemsRequested = true;
          await itemsGate;
          return ok(makeSubtestWire(10, 1, "EN_PROGRESO"));
        }),
      );
      const visibility = vi.spyOn(document, "visibilityState", "get");
      const rendering = renderRunnerAt("/evaluacion/subtests/10/items/100", newQueryClient());
      await waitFor(() => expect(itemsRequested).toBe(true));

      // Se oculta la pestaña mientras se esperan los ítems; llegan 2 ítems y el ordinal 100 queda fuera de rango.
      hideTab(visibility);
      await act(async () => {
        releaseItems();
        await vi.advanceTimersByTimeAsync(300);
      });
      const { router } = await rendering;
      await advanceInSteps(1_000);
      expect(router.state.location.pathname).toBe("/evaluacion/subtests/10/items/100");

      // Vuelve la pestaña: con el /yo vigente se normaliza el ordinal.
      showTab(visibility);
      await advanceInSteps(15_000);
      expect(router.state.location.pathname).toBe("/evaluacion/subtests/10/items/2");
      expect(await screen.findByText("Pregunta 2 del subtest 10")).toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------------------------
  // F2-FIX-8 · una copia derivada de un /yo invalidado no lo rehabilita
  // ---------------------------------------------------------------------------------------------
  describe("F2-FIX-8", () => {
    const fakeClock = () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      vi.setSystemTime(FAKE_T0);
    };
    const advanceInSteps = async (totalMs: number, stepMs = 500) => {
      for (let elapsed = 0; elapsed < totalMs; elapsed += stepMs) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(stepMs);
        });
      }
    };
    const newQueryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 5 * 60_000 } } });
    const inProgressWithoutItems = () =>
      makeEvaluationWire({
        subtests: [
          makeSubtestWire(10, 1, "EN_PROGRESO", {
            timeLimitSeconds: 600,
            startedAt: "2026-11-25T11:55:00.000Z",
            ...liveTiming(500),
            paused: false,
            items: [],
          }),
        ],
      });

    it("MEDIO 2 · ensureItemsRoute con el /yo fuente invalidado mientras esperaba los ítems NO publica la copia ni navega a items/2; con el /yo vigente sí normaliza el ordinal", async () => {
      fakeClock();
      useParticipantAuth.getState().setSession({ token: "jwt-42", assignmentId: 42 });
      let itemsRequested = false;
      let releaseItems: () => void = () => undefined;
      const itemsGate = new Promise<void>((resolve) => {
        releaseItems = resolve;
      });
      server.use(
        http.get(`${API}/evaluacion-participante/yo`, () => ok(inProgressWithoutItems())),
        http.get(`${API}/intentos/101/subtests/10/items`, async () => {
          itemsRequested = true;
          await itemsGate;
          return ok(makeSubtestWire(10, 1, "EN_PROGRESO"));
        }),
      );
      const visibility = vi.spyOn(document, "visibilityState", "get");
      const { router } = await renderRunnerAt("/evaluacion/sesion", newQueryClient());
      await advanceInSteps(1_000);
      expect(await screen.findByText("Subtest 10")).toBeInTheDocument();

      // /yo vigente aplicado (sin ítems). Se navega al ordinal 100: el loader espera los ítems.
      void router.navigate({
        to: "/evaluacion/subtests/$subtestId/items/$ordinal",
        params: { subtestId: 10, ordinal: 100 },
      });
      await waitFor(() => expect(itemsRequested).toBe(true));

      // Se oculta la pestaña mientras se esperan los ítems: el /yo fuente queda invalidado y el loader deja pasar el 100.
      visibility.mockReturnValue("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      await act(async () => {
        releaseItems();
        await vi.advanceTimersByTimeAsync(300);
      });
      await advanceInSteps(2_000);

      // Con la pestaña aún oculta, la ruta montada NO rehabilita el /yo obsoleto ni cambia la URL.
      expect(router.state.location.pathname).toBe("/evaluacion/subtests/10/items/100");

      // Vuelve la pestaña: con el /yo vigente el ordinal se normaliza.
      visibility.mockReturnValue("visible");
      document.dispatchEvent(new Event("visibilitychange"));
      await advanceInSteps(15_000);
      expect(router.state.location.pathname).toBe("/evaluacion/subtests/10/items/2");
      expect(await screen.findByText("Pregunta 2 del subtest 10")).toBeInTheDocument();
    });
  });
});
