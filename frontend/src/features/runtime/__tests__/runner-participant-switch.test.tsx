/**
 * F-06b · Cruce de participantes en la MISMA pestaña (respuestas tardías).
 *
 * Porta al runner nuevo (RunnerContext + rutas /evaluacion) las garantías que antes solo cubría
 * `participantService.test.ts` ("respuestas tardías del runner (STALE_PARTICIPANT)"):
 *
 *   1. El participante A está en curso y una petición suya sigue en vuelo.
 *   2. En la misma pestaña se canjea el código del participante B por `/evaluacion/$code` (otra asignación y otro
 *      intento) y B queda cargado, con una respuesta pendiente propia en su draft.
 *   3. Se libera la respuesta tardía de A (éxito, 500, 409 de bloqueo o 401).
 *
 * Para cada petición de A se verifica que NADA suyo se escribe en el estado de B (draft, caché `runtime`,
 * `participantAuth`), que A no provoca ninguna navegación y que ningún error de A aparece en la UI de B.
 */
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { http, HttpResponse } from "msw";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter, type AnyRouter } from "@tanstack/react-router";

import { routeTree } from "../../../routeTree.gen";
import { setNavigator } from "../../../api/client";
import { useParticipantAuth } from "../../../store/participantAuth";
import { server } from "../../../test/msw/server";
import { clearPendingAccessError, peekPendingAccessError } from "../accessError";
import { setAnswer, useRuntimeDraft } from "../draft";
import { resetDraftSyncForTests } from "../draft/sync";

const API = "http://localhost:8080";

// ---------------------------------------------------------------------------------------------
// Participantes
// ---------------------------------------------------------------------------------------------

interface Who {
  assignmentId: number;
  attemptId: number;
  token: string;
  code: string;
  name: string;
  subtestId: number;
}

const A: Who = {
  assignmentId: 42,
  attemptId: 101,
  token: "jwt-A",
  code: "42-codigoA",
  name: "Ana Pérez",
  subtestId: 10,
};
const B: Who = {
  assignmentId: 43,
  attemptId: 202,
  token: "jwt-B",
  code: "43-codigoB",
  name: "Beto Gómez",
  subtestId: 30,
};
/** Ítem de B con respuesta pendiente en su draft (el PUT de B queda colgado a propósito). */
const B_ITEM_ID = B.subtestId * 100 + 1;
/** Pantalla en la que B espera mientras llega la respuesta tardía de A. */
const B_PATH = `/evaluacion/subtests/${B.subtestId}/instrucciones`;

// ---------------------------------------------------------------------------------------------
// Fixtures de red
// ---------------------------------------------------------------------------------------------

const ok = (data: unknown, status = 200): Response =>
  HttpResponse.json({ success: true, data, correlationId: "cid" }, { status }) as Response;

const apiErr = (status: number, code: string, message: string): Response =>
  HttpResponse.json(
    { success: false, data: null, error: { code, message }, correlationId: "cid-err" },
    { status },
  ) as Response;

function makeSubtestWire(id: number, order: number, status: string, extra: Record<string, unknown> = {}) {
  return {
    subtestId: id,
    code: `ST-${id}`,
    name: `Subtest ${id}`,
    instructions: `Lea las instrucciones del subtest ${id}.`,
    order,
    timeLimitSeconds: null,
    randomizeItems: false,
    randomizeOptions: false,
    status,
    items: [1, 2].map((n) => ({
      itemId: id * 100 + n,
      code: `IT-${id}-${n}`,
      itemType: "SOLO_TEXTO",
      responseType: "OPCION_UNICA",
      prompt: `Pregunta ${n} del subtest ${id}`,
      instruction: null,
      order: n,
      images: [],
      options: [
        { optionId: id * 1000 + n * 2 - 1, code: "A", text: `Opción A${n}`, order: 1, images: [] },
        { optionId: id * 1000 + n * 2, code: "B", text: `Opción B${n}`, order: 2, images: [] },
      ],
    })),
    ...extra,
  };
}

function makeEvaluationWire(who: Who, overrides: Record<string, unknown> = {}) {
  return {
    id: who.attemptId,
    assignmentId: who.assignmentId,
    sessionId: 7,
    participantDisplayName: who.name,
    sessionName: "Sesión Cohorte 2026",
    sessionStatus: "ABIERTA",
    pausedAt: null,
    attemptStatus: "EN_PROGRESO",
    subtests: [makeSubtestWire(who.subtestId, 1, "NO_INICIADO")],
    ...overrides,
  };
}

/** Evaluación de B: lista de subtests con un subtest sin iniciar (estado estable `listaSubtests`). */
const evaluationWireB = () => makeEvaluationWire(B);

type Outcome = "éxito" | "500" | "409 SESION_FINALIZADA" | "401";

const OUTCOMES: readonly Outcome[] = ["éxito", "500", "409 SESION_FINALIZADA", "401"];

const LATE_A_TEXT = "tardío de A";

function lateResponse(outcome: Outcome, okBody: unknown): Response {
  switch (outcome) {
    case "éxito":
      return ok(okBody);
    case "500":
      return apiErr(500, "INTERNAL_ERROR", `Fallo ${LATE_A_TEXT}`);
    case "409 SESION_FINALIZADA":
      return apiErr(409, "SESION_FINALIZADA", `Sesión finalizada ${LATE_A_TEXT}`);
    case "401":
      return apiErr(401, "UNAUTHORIZED", `No autorizado ${LATE_A_TEXT}`);
  }
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Una petición de A retenida en el servidor hasta que el test la libera con el desenlace elegido. */
function createHold(okBody: unknown) {
  const gate = deferred<(outcome: Outcome) => Response>();
  const reached = deferred();
  const chosen = deferred<Outcome>();
  let served = false;
  return {
    reached: reached.promise,
    get served() {
      return served;
    },
    async serve(): Promise<Response> {
      reached.resolve();
      const outcome = await chosen.promise;
      const response = (await gate.promise)(outcome);
      served = true;
      return response;
    },
    release(outcome: Outcome) {
      gate.resolve((o) => lateResponse(o, okBody));
      chosen.resolve(outcome);
    },
  };
}

type Hold = ReturnType<typeof createHold>;

// ---------------------------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------------------------

async function renderRunnerAt(initialPath: string, options: { strict?: boolean } = {}) {
  // gcTime por defecto (5 min): a diferencia de otros tests, la caché de A NO se purga sola al desmontar, de modo
  // que solo el cambio de participante puede removerla (igual que en producción).
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const history = createMemoryHistory({ initialEntries: [initialPath] });
  const router = createRouter({ routeTree, history, context: { queryClient } });
  setNavigator(
    (options) => router.navigate(options as Parameters<typeof router.navigate>[0]),
    () => router.state.location.href,
  );
  await router.load();
  const tree = (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
  render(options.strict ? <StrictMode>{tree}</StrictMode> : tree);
  return { router, history, queryClient };
}

/**
 * Navega sin esperar dentro de `act`: el router aguarda un render que `act` retiene hasta que su callback termina
 * (esperar aquí se cuelga). Las aserciones esperan después a la UI resultante.
 */
const goToCode = async (router: AnyRouter, code: string) => {
  act(() => {
    void router.navigate({ to: "/evaluacion/$code", params: { code } });
  });
  await waitFor(() => expect(router.state.location.pathname).toBe(`/evaluacion/${code}`));
};

// ---------------------------------------------------------------------------------------------
// Instantáneas del estado de B
// ---------------------------------------------------------------------------------------------

const dataOf = (state: object) =>
  Object.fromEntries(Object.entries(state).filter(([, value]) => typeof value !== "function"));

function runtimeCache(queryClient: QueryClient) {
  return queryClient
    .getQueryCache()
    .findAll({ queryKey: ["runtime"] })
    .map((query) => ({ key: query.queryKey, data: query.state.data }))
    .sort((a, b) => JSON.stringify(a.key).localeCompare(JSON.stringify(b.key)));
}

function snapshotState(queryClient: QueryClient) {
  const auth = useParticipantAuth.getState();
  return {
    auth: { token: auth.token, assignmentId: auth.assignmentId },
    draft: dataOf(useRuntimeDraft.getState()),
    cache: runtimeCache(queryClient),
    persistedAuth: sessionStorage.getItem("bfa-participant-auth"),
  };
}

/** Espera a que la respuesta tardía de A ya haya salido del servidor y a que se drenen sus microtareas/timers. */
async function settleAfterRelease(hold: Hold) {
  await waitFor(() => expect(hold.served).toBe(true));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 150));
  });
}

// ---------------------------------------------------------------------------------------------
// Casos: cada uno deja a A "en curso" con UNA petición en vuelo
// ---------------------------------------------------------------------------------------------

interface LateCase {
  name: string;
  /** Respuesta (cuerpo de éxito) con que A terminaría. */
  okBody: unknown;
  /** Evaluación de A (`/yo`). */
  evaluationA: () => Record<string, unknown>;
  /** Registra el handler retenido de la petición de A. */
  mount: (hold: Hold) => void;
  /** Deja a A en curso y dispara su petición hasta que llegue al servidor. */
  drive: (ctx: { router: AnyRouter; hold: Hold }) => Promise<void>;
  initialPath: string;
}

const nowIso = () => new Date().toISOString();

const subtestAttemptWire = (estado: string) => ({
  id: 305,
  intentoId: A.attemptId,
  subtestId: A.subtestId,
  estado,
  startedAt: nowIso(),
  timeLimitSeconds: null,
  serverNow: nowIso(),
});

const goToFirstSubtestInstructions = async () => {
  expect(await screen.findByText("Subtests de la Evaluación")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /^(Iniciar|Continuar)$/ }));
  expect(await screen.findByText("Instrucciones del subtest")).toBeInTheDocument();
};

const CASES: LateCase[] = [
  {
    name: "validateAccess (/evaluacion/$code)",
    initialPath: "/evaluacion/sesion",
    okBody: {
      assignmentId: A.assignmentId,
      participantId: "uuid-A",
      accessToken: "jwt-A-tardío",
      tokenType: "Bearer",
    },
    evaluationA: () => makeEvaluationWire(A),
    mount: (hold) =>
      server.use(
        http.post(`${API}/acceso-participante/validar`, async ({ request }) => {
          const { assignmentId } = (await request.clone().json()) as { assignmentId: number };
          // Solo la validación de A se retiene; la de B cae al handler común.
          if (assignmentId === A.assignmentId) return hold.serve();
          return undefined;
        }),
      ),
    drive: async ({ router }) => {
      expect(await screen.findByText("Subtests de la Evaluación")).toBeInTheDocument();
      
      // A vuelve a canjear su enlace y esa validación queda en vuelo.
      await goToCode(router, "42-recanje");
      
    },
  },
  {
    name: "validateAccess (acceso manual)",
    initialPath: "/evaluacion/sesion",
    okBody: {
      assignmentId: A.assignmentId,
      participantId: "uuid-A",
      accessToken: "jwt-A-tardío",
      tokenType: "Bearer",
    },
    evaluationA: () => makeEvaluationWire(A),
    mount: (hold) =>
      server.use(
        http.post(`${API}/acceso-participante/validar`, async ({ request }) => {
          const { assignmentId } = (await request.clone().json()) as { assignmentId: number };
          // Solo la validación de A se retiene; la de B cae al handler común.
          if (assignmentId === A.assignmentId) return hold.serve();
          return undefined;
        }),
      ),
    drive: async ({ router }) => {
      expect(await screen.findByText("Subtests de la Evaluación")).toBeInTheDocument();
      act(() => {
        void router.navigate({ to: "/evaluacion/acceso", search: {} });
      });
      fireEvent.change(await screen.findByLabelText("Código de acceso"), { target: { value: "42-manual" } });
      fireEvent.click(screen.getByRole("button", { name: /continuar/i }));
    },
  },
  {
    name: "validateAccess (acceso ?code=)",
    initialPath: "/evaluacion/sesion",
    okBody: {
      assignmentId: A.assignmentId,
      participantId: "uuid-A",
      accessToken: "jwt-A-tardío",
      tokenType: "Bearer",
    },
    evaluationA: () => makeEvaluationWire(A),
    mount: (hold) =>
      server.use(
        http.post(`${API}/acceso-participante/validar`, async ({ request }) => {
          const { assignmentId } = (await request.clone().json()) as { assignmentId: number };
          if (assignmentId === A.assignmentId) return hold.serve();
          return undefined;
        }),
      ),
    drive: async ({ router }) => {
      expect(await screen.findByText("Subtests de la Evaluación")).toBeInTheDocument();
      act(() => {
        void router.navigate({ to: "/evaluacion/acceso", search: { code: "42-enlace" } });
      });
    },
  },
  {
    name: "startAttempt",
    initialPath: "/evaluacion/sesion",
    okBody: { id: A.attemptId, asignacionId: A.assignmentId, iniciadoEn: nowIso(), estado: "EN_PROGRESO" },
    evaluationA: () => makeEvaluationWire(A, { id: null, attemptStatus: "NO_INICIADO" }),
    mount: (hold) => server.use(http.post(`${API}/evaluacion-participante/iniciar`, () => hold.serve())),
    drive: async () => {
      fireEvent.click(await screen.findByRole("button", { name: /comenzar evaluación/i }));
    },
  },
  {
    name: "startSubtest",
    initialPath: "/evaluacion/sesion",
    okBody: subtestAttemptWire("EN_PROGRESO"),
    evaluationA: () => makeEvaluationWire(A),
    mount: (hold) =>
      server.use(http.post(`${API}/intentos/${A.attemptId}/subtests/${A.subtestId}/iniciar`, () => hold.serve())),
    drive: async () => {
      await goToFirstSubtestInstructions();
      fireEvent.click(screen.getByRole("button", { name: /iniciar subtest/i }));
    },
  },
  {
    name: "getSubtestItems",
    initialPath: "/evaluacion/sesion",
    okBody: makeSubtestWire(A.subtestId, 1, "EN_PROGRESO"),
    // Subtest ya en curso pero sin ítems: el runner los pide aparte (useQuery + ensureQueryData).
    evaluationA: () =>
      makeEvaluationWire(A, { subtests: [makeSubtestWire(A.subtestId, 1, "EN_PROGRESO", { items: [] })] }),
    mount: (hold) =>
      server.use(http.get(`${API}/intentos/${A.attemptId}/subtests/${A.subtestId}/items`, () => hold.serve())),
    drive: async ({ router }) => {
      await goToFirstSubtestInstructions();
      act(() => {
        void router.navigate({
          to: "/evaluacion/subtests/$subtestId/items/$ordinal",
          params: { subtestId: A.subtestId, ordinal: 1 },
        });
      });
    },
  },
  {
    name: "finishSubtest",
    // «Finalizar subtest» solo se ofrece en el último ítem.
    initialPath: `/evaluacion/subtests/${A.subtestId}/items/2`,
    okBody: subtestAttemptWire("COMPLETADO"),
    evaluationA: () => makeEvaluationWire(A, { subtests: [makeSubtestWire(A.subtestId, 1, "EN_PROGRESO")] }),
    mount: (hold) =>
      server.use(http.post(`${API}/intentos/${A.attemptId}/subtests/${A.subtestId}/finalizar`, () => hold.serve())),
    drive: async () => {
      expect(await screen.findByText(`Pregunta 2 del subtest ${A.subtestId}`)).toBeInTheDocument();
      fireEvent.click(await screen.findByRole("button", { name: "Finalizar subtest" }));
      const dialog = await screen.findByRole("alertdialog");
      fireEvent.click(within(dialog).getByRole("button", { name: "Finalizar subtest" }));
    },
  },
  {
    name: "finishAttempt",
    initialPath: "/evaluacion/sesion",
    okBody: { id: A.attemptId, asignacionId: A.assignmentId, estado: "COMPLETADO" },
    evaluationA: () => makeEvaluationWire(A, { subtests: [makeSubtestWire(A.subtestId, 1, "COMPLETADO")] }),
    mount: (hold) => server.use(http.post(`${API}/intentos/${A.attemptId}/finalizar`, () => hold.serve())),
    drive: async () => {
      expect(await screen.findByText("Resumen de su Evaluación")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Finalizar evaluación" }));
      const dialog = await screen.findByRole("alertdialog");
      fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar entrega final" }));
    },
  },
];

// ---------------------------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------------------------

describe("Runner: respuestas tardías de A tras canjear a B en la misma pestaña (F-06b)", () => {
  let errorSpy: MockInstance<typeof console.error>;

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
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    sessionStorage.clear();
    clearPendingAccessError();
    useParticipantAuth.getState().clear();
    resetDraftSyncForTests();
    useRuntimeDraft.getState().clearDraft();
  });

  afterEach(() => {
    setNavigator(null);
    vi.unstubAllGlobals();
    errorSpy.mockRestore();
    clearPendingAccessError();
    resetDraftSyncForTests();
    useRuntimeDraft.getState().clearDraft();
    useParticipantAuth.getState().clear();
    sessionStorage.clear();
  });

  describe.each(CASES)("$name tardío de A", (lateCase) => {
    it.each(OUTCOMES)("desenlace «%s»: no escribe en B, no navega y no muestra errores de A", async (outcome) => {
      useParticipantAuth.getState().setSession({ token: A.token, assignmentId: A.assignmentId });
      const hold = createHold(lateCase.okBody);
      server.use(
        http.post(`${API}/acceso-participante/validar`, async ({ request }) => {
          const { assignmentId } = (await request.clone().json()) as { assignmentId: number };
          const who = assignmentId === B.assignmentId ? B : A;
          return ok({ assignmentId, participantId: `uuid-${who.token}`, accessToken: who.token, tokenType: "Bearer" });
        }),
        http.get(`${API}/evaluacion-participante/yo`, ({ request }) => {
          const bearer = request.headers.get("authorization");
          return bearer === `Bearer ${B.token}` ? ok(evaluationWireB()) : ok(lateCase.evaluationA());
        }),
        // El PUT de B queda colgado: su respuesta sigue "pendiente" durante toda la prueba.
        http.put(`${API}/intentos/${B.attemptId}/items/${B_ITEM_ID}/respuesta`, () => new Promise<Response>(() => {})),
      );
      lateCase.mount(hold);

      const { router, history, queryClient } = await renderRunnerAt(lateCase.initialPath);

      // 1) A en curso con una petición en vuelo.
      await lateCase.drive({ router, hold });
      await hold.reached;
      if (lateCase.evaluationA().id !== null) {
        expect(useRuntimeDraft.getState().owner?.assignmentId).toBe(A.assignmentId);
      }
      expect(
        runtimeCache(queryClient).some((entry) => entry.key.includes(A.assignmentId)),
        "precondición: la caché de A existe antes del cruce",
      ).toBe(true);

      // 2) Se canjea el código de B en la misma pestaña y B queda cargado.
      await goToCode(router, B.code);
      expect(await screen.findByText("Subtests de la Evaluación")).toBeInTheDocument();
      expect(screen.getByText(`Subtest ${B.subtestId}`)).toBeInTheDocument();
      await waitFor(() =>
        expect(useRuntimeDraft.getState().owner).toEqual({ assignmentId: B.assignmentId, attemptId: B.attemptId }),
      );
      expect(router.state.location.pathname).toBe("/evaluacion/sesion");
      // B abre las instrucciones de su subtest: su ruta difiere de a donde A navegaría (`/evaluacion/sesion`),
      // así cualquier navegación tardía de A queda a la vista.
      fireEvent.click(screen.getByRole("button", { name: "Iniciar" }));
      expect(await screen.findByText("Instrucciones del subtest")).toBeInTheDocument();
      await waitFor(() => expect(router.state.location.pathname).toBe(B_PATH));
      // B responde un ítem cuyo envío sigue pendiente (el PUT no vuelve): hay draft y cola de B que proteger.
      act(() => {
        void setAnswer(B_ITEM_ID, { kind: "OPCION_UNICA", optionId: 30001 }, 3, B.subtestId, {
          attemptId: B.attemptId,
        });
      });
      expect(useRuntimeDraft.getState().answers[B_ITEM_ID]).toBeDefined();

      // La caché `runtime` de A ya se removió al cambiar de participante.
      const cacheBefore = runtimeCache(queryClient);
      expect(cacheBefore.length).toBeGreaterThan(0);
      for (const entry of cacheBefore) expect(entry.key[2]).toBe(B.assignmentId);

      const before = snapshotState(queryClient);
      const alertsBefore = screen.queryAllByRole("alert").map((node) => node.textContent);
      const navigations: string[] = [];
      const unsubscribe = history.subscribe(({ location, action }) => {
        navigations.push(`${action.type} ${location.pathname}`);
      });

      // 3) Llega la respuesta tardía de A.
      hold.release(outcome);
      await settleAfterRelease(hold);
      unsubscribe();

      // Nada de A en el estado de B.
      expect(snapshotState(queryClient)).toEqual(before);
      expect(useParticipantAuth.getState()).toMatchObject({ token: B.token, assignmentId: B.assignmentId });
      expect(useRuntimeDraft.getState().owner).toEqual({ assignmentId: B.assignmentId, attemptId: B.attemptId });
      expect(useRuntimeDraft.getState().answers[B_ITEM_ID]).toBeDefined();
      for (const entry of runtimeCache(queryClient)) expect(entry.key[2]).toBe(B.assignmentId);
      expect(JSON.stringify(runtimeCache(queryClient))).not.toContain(A.name);

      // Sin navegación provocada por A: B sigue exactamente donde estaba.
      expect(navigations).toEqual([]);
      expect(router.state.location.pathname).toBe(B_PATH);
      expect(peekPendingAccessError()).toBeNull();

      // Sin errores de A en la UI de B (ni bloqueos, ni alertas nuevas, ni nombres ajenos).
      expect(screen.getByText("Instrucciones del subtest")).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: `Subtest ${B.subtestId}` })).toBeInTheDocument();
      expect(screen.queryAllByRole("alert").map((node) => node.textContent)).toEqual(alertsBefore);
      expect(screen.queryByText(new RegExp(LATE_A_TEXT))).not.toBeInTheDocument();
      expect(screen.queryByText(/Ana Pérez/)).not.toBeInTheDocument();
      expect(screen.queryByText(`Subtest ${A.subtestId}`)).not.toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: /Sesión finalizada|Acceso revocado/ })).not.toBeInTheDocument();
      // Ningún error propio de la app (los `Warning:` de React/Radix de los diálogos son ruido ajeno a esta prueba).
      const appErrors = errorSpy.mock.calls.filter(([first]: unknown[]) => !(typeof first === "string" && first.startsWith("Warning:")));
      expect(appErrors).toEqual([]);
    });
  });
  it("el MISMO participante que canjea con efecto doble (StrictMode) no se descarta: queda su sesión", async () => {
    const validations: number[] = [];
    server.use(
      http.post(`${API}/acceso-participante/validar`, async ({ request }) => {
        const { assignmentId } = (await request.clone().json()) as { assignmentId: number };
        validations.push(assignmentId);
        return ok({ assignmentId, participantId: "uuid-A", accessToken: A.token, tokenType: "Bearer" });
      }),
      http.get(`${API}/evaluacion-participante/yo`, () => ok(makeEvaluationWire(A))),
    );

    const { router } = await renderRunnerAt(`/evaluacion/${A.code}`, { strict: true });

    expect(await screen.findByText("Subtests de la Evaluación")).toBeInTheDocument();
    expect(validations.length).toBeGreaterThanOrEqual(1);
    expect(new Set(validations)).toEqual(new Set([A.assignmentId]));
    expect(useParticipantAuth.getState()).toMatchObject({ token: A.token, assignmentId: A.assignmentId });
    expect(router.state.location.pathname).toBe("/evaluacion/sesion");
    expect(useRuntimeDraft.getState().owner).toEqual({ assignmentId: A.assignmentId, attemptId: A.attemptId });
  });
});
