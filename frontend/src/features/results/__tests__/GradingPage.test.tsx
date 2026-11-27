import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { delay, http } from "msw";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";

import { server } from "../../../test/msw/server";
import { useStaffAuth } from "../../../store/staffAuth";
import { resultKeys } from "../queries";
import type { AttemptsPage } from "../attempts-source";
import { GradingPage } from "../grading/GradingPage";
import type { GradingSearch } from "../gradingSearch";
import {
  ALL_RESULT_PERMISSIONS,
  API,
  assignmentWire,
  clearStaff,
  fail,
  ok,
  renderWithProviders,
  scoreWire,
  sessionWire,
  setPermissions,
  useBaseHandlers,
} from "./testSupport";
import { GRADING_PAGE_SIZE } from "../grading/GradingPage";

function Harness({ initial }: { initial: GradingSearch }) {
  const [search, setSearch] = useState(initial);
  return <GradingPage search={search} onSessionChange={(sessionId) => setSearch({ sessionId })} />;
}

afterEach(() => clearStaff());

const rowOf = (name: string) => screen.getByText(name).closest("tr") as HTMLElement;

describe("GradingPage — permisos y fuente", () => {
  it("con todos los permisos ofrece Respuestas, Baremo (si está calificado) y Calificar (si falta)", async () => {
    setPermissions(ALL_RESULT_PERMISSIONS);
    useBaseHandlers();
    await renderWithProviders(<Harness initial={{ sessionId: 1 }} />);

    await screen.findByText("Ana López");
    await waitFor(() => expect(within(rowOf("Ana López")).getByText("Calificado")).toBeInTheDocument());
    expect(within(rowOf("Ana López")).getByRole("link", { name: /ver baremo de ana/i })).toBeInTheDocument();
    expect(within(rowOf("Ana López")).queryByRole("button", { name: /calificar/i })).not.toBeInTheDocument();
    expect(within(rowOf("Bruno Díaz")).getByRole("button", { name: /calificar a bruno/i })).toBeInTheDocument();
    expect(within(rowOf("Bruno Díaz")).getByRole("link", { name: /ver respuestas de bruno/i })).toBeInTheDocument();
    // En progreso: ni calificar ni baremo.
    expect(within(rowOf("Carla Ruiz")).queryByRole("button", { name: /calificar/i })).not.toBeInTheDocument();
    // Sin intento (asignación sin attemptId): no aparece.
    expect(screen.queryByText("Diego Paz")).not.toBeInTheDocument();
  });

  it("sin RESULTADO_VER oculta Respuestas y Baremo; sin CALIFICACION_EJECUTAR oculta Calificar", async () => {
    setPermissions(["SESION_APLICAR", "CALIFICACION_EJECUTAR"]);
    useBaseHandlers();
    await renderWithProviders(<Harness initial={{ sessionId: 1 }} />);
    await screen.findByText("Bruno Díaz");
    expect(screen.queryByRole("link", { name: /respuestas|baremo/i })).not.toBeInTheDocument();
    // Sin RESULTADO_VER no se puede saber si está calificado: «Sin dato» y se ofrece Calificar (idempotente).
    expect(within(rowOf("Bruno Díaz")).getByText("Sin dato")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /calificar a/i })).toHaveLength(2);
  });

  it("sin permiso de calificar no hay botón Calificar", async () => {
    setPermissions(["SESION_APLICAR", "RESULTADO_VER"]);
    useBaseHandlers();
    await renderWithProviders(<Harness initial={{ sessionId: 1 }} />);
    await screen.findByText("Bruno Díaz");
    expect(screen.queryByRole("button", { name: /calificar a/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /ver respuestas de/i }).length).toBeGreaterThan(0);
  });

  it("sin SESION_LEER (fuente puente no disponible) explica la limitación y no pide nada a /sesiones", async () => {
    setPermissions(["RESULTADO_VER", "CALIFICACION_EJECUTAR"]);
    // Sin handlers: cualquier request haría fallar el test (onUnhandledFrame: "error").
    await renderWithProviders(<Harness initial={{ sessionId: 1 }} />);
    expect(await screen.findByText(/listado de intentos no disponible para tu rol/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /actualizar/i })).toBeDisabled();
  });
});

describe("GradingPage — estados", () => {
  it("lista de sesiones vacía: estado vacío y sin tabla", async () => {
    setPermissions(ALL_RESULT_PERMISSIONS);
    server.use(http.get(`${API}/sesiones`, () => ok([])));
    await renderWithProviders(<Harness initial={{}} />);
    expect(await screen.findByText("No hay sesiones para calificar")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("sesión sin intentos: estado vacío", async () => {
    setPermissions(ALL_RESULT_PERMISSIONS);
    useBaseHandlers();
    server.use(http.get(`${API}/sesiones/1/asignaciones`, () => ok([assignmentWire(4, null, "Diego Paz", "no-iniciado")])));
    await renderWithProviders(<Harness initial={{ sessionId: 1 }} />);
    expect(await screen.findByText("Sin intentos")).toBeInTheDocument();
  });

  it("error al cargar los intentos: muestra el error y Reintentar recupera", async () => {
    setPermissions(ALL_RESULT_PERMISSIONS);
    useBaseHandlers();
    let fails = true;
    server.use(
      http.get(`${API}/sesiones/1/asignaciones`, () =>
        fails ? fail(500, "El servidor no está disponible.") : ok([assignmentWire(1, 9001, "Ana López")]),
      ),
    );
    await renderWithProviders(<Harness initial={{ sessionId: 1 }} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/servidor no está disponible/i);
    fails = false;
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Ana López")).toBeInTheDocument();
  });
});

describe("GradingPage — deep link desde el monitor (§7b)", () => {
  it("?sessionId&attemptId: selecciona la sesión, destaca el intento y avisa si no existe", async () => {
    setPermissions(ALL_RESULT_PERMISSIONS);
    useBaseHandlers();
    await renderWithProviders(<Harness initial={{ sessionId: 2, attemptId: 9101 }} />);
    await screen.findByText("Elena Soto");
    expect(screen.getByLabelText("Sesión")).toHaveValue("2");
    const highlighted = document.querySelector('[data-highlighted="true"]');
    expect(highlighted).toHaveTextContent("Elena Soto");
    expect(highlighted).toHaveAttribute("aria-current", "true");
    expect(screen.getByText("Intento solicitado")).toBeInTheDocument();
    expect(screen.queryByText(/no encontrado/i)).not.toBeInTheDocument();
  });

  it("el intento pedido no pertenece a la sesión: aviso y sin destacado", async () => {
    setPermissions(ALL_RESULT_PERMISSIONS);
    useBaseHandlers();
    await renderWithProviders(<Harness initial={{ sessionId: 1, attemptId: 9101 }} />);
    await screen.findByText("Ana López");
    expect(await screen.findByText("Intento #9101 no encontrado")).toBeInTheDocument();
    expect(document.querySelector('[data-highlighted="true"]')).toBeNull();
  });

  it("caso 1 — falla la lista de sesiones: muestra el error con Reintentar (no queda a medias) y no pide intentos", async () => {
    setPermissions(ALL_RESULT_PERMISSIONS);
    const { calls } = useBaseHandlers();
    let fails = true;
    server.use(http.get(`${API}/sesiones`, () => (fails ? fail(500, "No se pudo listar") : ok([sessionWire(1, "Cohorte A"), sessionWire(2, "Cohorte B")]))));
    await renderWithProviders(<Harness initial={{ sessionId: 2, attemptId: 9101 }} />);

    expect(await screen.findByText("No se pudo cargar la lista de sesiones")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /actualizar/i })).toBeDisabled();
    expect(calls.assignments).toEqual([]);

    fails = false;
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Elena Soto")).toBeInTheDocument();
    expect(calls.assignments).toEqual(["2"]);
    expect(screen.getByText("Intento solicitado")).toBeInTheDocument();
  });

  it("caso 2 — nada se habilita antes de validar la sesión con la lista fresca", async () => {
    setPermissions(ALL_RESULT_PERMISSIONS);
    const { calls } = useBaseHandlers();
    // Sesión pedida (9) que no existe; la lista fresca tarda en llegar.
    server.use(
      http.get(`${API}/sesiones`, async () => {
        await delay(150);
        return ok([sessionWire(1, "Cohorte A")]);
      }),
    );
    await renderWithProviders(<Harness initial={{ sessionId: 9, attemptId: 9001 }} />);

    // Mientras la lista no llega: sin tabla, sin Calificar, «Actualizar» deshabilitado y 0 requests de intentos.
    expect(screen.getByRole("button", { name: /actualizar/i })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /calificar/i })).not.toBeInTheDocument();
    expect(calls.assignments).toEqual([]);

    // Validada la lista: la 9 no existe → aviso, se usa la sesión 1 y jamás se pidieron datos de la 9.
    expect(await screen.findByText("Sesión no encontrada")).toBeInTheDocument();
    await screen.findByText("Ana López");
    expect(calls.assignments).toEqual(["1"]);
    expect(screen.getByLabelText("Sesión")).toHaveValue("1");
  });

  it("caso 3 — una respuesta tardía de otra sesión no desincroniza el selector ni la tabla", async () => {
    setPermissions(ALL_RESULT_PERMISSIONS);
    useBaseHandlers();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get(`${API}/sesiones/1/asignaciones`, async () => {
        await gate; // la sesión 1 responde tarde
        return ok([assignmentWire(1, 9001, "Ana López")]);
      }),
    );
    await renderWithProviders(<Harness initial={{ sessionId: 1 }} />);
    await waitFor(() => expect(screen.getByLabelText("Sesión")).toHaveValue("1"));

    // El usuario cambia a la sesión 2 mientras la 1 sigue pendiente.
    fireEvent.change(screen.getByLabelText("Sesión"), { target: { value: "2" } });
    expect(await screen.findByText("Elena Soto")).toBeInTheDocument();

    // Llega la respuesta tardía de la sesión 1.
    await act(async () => {
      release();
      await delay(50);
    });
    expect(screen.getByLabelText("Sesión")).toHaveValue("2");
    expect(screen.getByText("Elena Soto")).toBeInTheDocument();
    expect(screen.queryByText("Ana López")).not.toBeInTheDocument();
  });
});

describe("GradingPage — calificar", () => {
  it("pide confirmación, califica con POST /attempts/{id}/score y refleja el resultado con feedback", async () => {
    setPermissions(ALL_RESULT_PERMISSIONS);
    const { scored } = useBaseHandlers();
    let posted = 0;
    server.use(
      http.post(`${API}/attempts/9002/score`, () => {
        posted += 1;
        scored.add(9002);
        return ok(scoreWire(9002, 2));
      }),
    );
    await renderWithProviders(<Harness initial={{ sessionId: 1 }} />);
    await screen.findByText("Bruno Díaz");

    fireEvent.click(within(rowOf("Bruno Díaz")).getByRole("button", { name: /calificar a bruno/i }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("¿Calificar el intento #9002?")).toBeInTheDocument();
    expect(posted).toBe(0); // nada se envía sin confirmar

    fireEvent.click(within(dialog).getByRole("button", { name: "Calificar" }));
    expect(await screen.findByText(/Intento #9002 calificado: 18 pts\. 2 respuestas requieren revisión manual\./)).toBeInTheDocument();
    expect(posted).toBe(1);
    await waitFor(() => expect(within(rowOf("Bruno Díaz")).getByText("Calificado")).toBeInTheDocument());
    expect(within(rowOf("Bruno Díaz")).queryByRole("button", { name: /calificar/i })).not.toBeInTheDocument();
  });

  it("cancelar el diálogo no envía nada; un error del backend muestra toast y deja reintentar", async () => {
    setPermissions(ALL_RESULT_PERMISSIONS);
    useBaseHandlers();
    let posted = 0;
    server.use(
      http.post(`${API}/attempts/9002/score`, () => {
        posted += 1;
        return fail(409, "El intento debe estar finalizado para calificar");
      }),
    );
    await renderWithProviders(<Harness initial={{ sessionId: 1 }} />);
    await screen.findByText("Bruno Díaz");

    fireEvent.click(within(rowOf("Bruno Díaz")).getByRole("button", { name: /calificar a bruno/i }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(posted).toBe(0);

    fireEvent.click(within(rowOf("Bruno Díaz")).getByRole("button", { name: /calificar a bruno/i }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Calificar" }));
    expect(await screen.findByText("El intento debe estar finalizado para calificar")).toBeInTheDocument();
    expect(posted).toBe(1);
    expect(screen.getByRole("alertdialog")).toBeInTheDocument(); // sigue abierto para reintentar
  });

  it("cambio de cuenta durante el POST: no se publica feedback ni se refrescan datos ajenos", async () => {
    setPermissions(ALL_RESULT_PERMISSIONS);
    const { calls } = useBaseHandlers();
    let started = false;
    server.use(
      http.post(`${API}/attempts/9002/score`, async () => {
        started = true;
        await delay(120);
        return ok(scoreWire(9002));
      }),
    );
    const { queryClient } = await renderWithProviders(<Harness initial={{ sessionId: 1 }} />);
    await screen.findByText("Bruno Díaz");
    const assignmentRequests = calls.assignments.length;

    fireEvent.click(within(rowOf("Bruno Díaz")).getByRole("button", { name: /calificar a bruno/i }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Calificar" }));
    await waitFor(() => expect(started).toBe(true));

    // Otra cuenta inicia sesión en mitad de la petición.
    act(() => useStaffAuth.getState().setSession({ token: "otra-cuenta", expiresAt: null }));
    await delay(250);

    expect(screen.queryByText(/calificado: 18 pts/i)).not.toBeInTheDocument();
    expect(calls.assignments.length).toBe(assignmentRequests); // sin invalidaciones ni refetch
    expect(queryClient.getQueryData(["results", "attempt", 9002, "result"])).toBeUndefined();
  });

  it("«Actualizar» vuelve a consultar los intentos de la sesión", async () => {
    setPermissions(ALL_RESULT_PERMISSIONS);
    const { calls, scored } = useBaseHandlers();
    await renderWithProviders(<Harness initial={{ sessionId: 1 }} />);
    await screen.findByText("Bruno Díaz");
    expect(calls.assignments).toEqual(["1"]);
    scored.add(9002);
    fireEvent.click(screen.getByRole("button", { name: /actualizar/i }));
    await waitFor(() => expect(calls.assignments).toEqual(["1", "1"]));
    await waitFor(() => expect(within(rowOf("Bruno Díaz")).getByText("Calificado")).toBeInTheDocument());
  });
});

describe("GradingPage — lectura fresca antes de habilitar acciones (hallazgo MEDIO)", () => {
  const cachedPage = (): AttemptsPage => ({
    items: [
      {
        attemptId: 9002,
        status: "COMPLETADO",
        startedAt: null,
        finishedAt: null,
        totalTimeSeconds: null,
        participant: { id: "p-2", code: "P-2", fullName: "Bruno Díaz" },
        session: { id: 1, code: "SES-1", name: "Cohorte A" },
        version: { id: 10, testName: null, number: null },
        scored: false,
        resultId: null,
        pendingManualReviews: null,
      },
    ],
    total: 1,
    page: 1,
    size: GRADING_PAGE_SIZE,
  });

  it("con intentos en caché y la lectura de la sesión pendiente, Actualizar y Calificar están deshabilitados hasta que llega la lectura fresca", async () => {
    setPermissions(ALL_RESULT_PERMISSIONS);
    useBaseHandlers();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get(`${API}/sesiones/1/asignaciones`, async () => {
        await gate;
        return ok([assignmentWire(2, 9002, "Bruno Díaz")]);
      }),
    );
    await renderWithProviders(<Harness initial={{ sessionId: 1 }} />, {
      seed: (qc) => qc.setQueryData(resultKeys.attempts({ sessionId: 1, size: GRADING_PAGE_SIZE, locateAttemptId: undefined }), cachedPage()),
    });

    // La caché ya pinta la fila, pero NO habilita nada mientras la lectura vigente esté pendiente.
    const calificar = await screen.findByRole("button", { name: /calificar a bruno/i });
    expect(calificar).toBeDisabled();
    expect(screen.getByRole("button", { name: /actualizar/i })).toBeDisabled();

    await act(async () => {
      release();
      await delay(50);
    });
    await waitFor(() => expect(screen.getByRole("button", { name: /calificar a bruno/i })).toBeEnabled());
    expect(screen.getByRole("button", { name: /actualizar/i })).toBeEnabled();
  });

  it("si la lectura fresca falla, las filas de caché NO habilitan Calificar", async () => {
    setPermissions(ALL_RESULT_PERMISSIONS);
    useBaseHandlers();
    server.use(http.get(`${API}/sesiones/1/asignaciones`, () => fail(500, "Sin servicio")));
    await renderWithProviders(<Harness initial={{ sessionId: 1 }} />, {
      seed: (qc) => qc.setQueryData(resultKeys.attempts({ sessionId: 1, size: GRADING_PAGE_SIZE, locateAttemptId: undefined }), cachedPage()),
    });
    await screen.findByText(/sin servicio/i);
    expect(screen.queryByRole("button", { name: /calificar a bruno/i })).not.toBeInTheDocument();
  });

  describe("con la caché de producción (staleTime 30 s)", () => {
    const PRODUCTION_STALE_TIME_MS = 30_000;
    const selectSession = (value: string) =>
      fireEvent.change(screen.getByLabelText("Sesión", { selector: "select" }), { target: { value } });

    /** Handlers de intentos que cuentan las peticiones por sesión; a partir de la 3.ª de la sesión 1 esperan `gate`. */
    const gateSession1Rereads = (calls: { assignments: string[] }) => {
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const session1Calls = { count: 0 };
      server.use(
        http.get(`${API}/sesiones/:id/asignaciones`, async ({ params }) => {
          calls.assignments.push(String(params.id));
          if (params.id === "1") {
            session1Calls.count += 1;
            if (session1Calls.count > 1) await gate; // la vuelta a la sesión 1 queda pendiente hasta `release`
            return ok([assignmentWire(2, 9002, "Bruno Díaz")]);
          }
          return ok([assignmentWire(5, 9101, "Elena Soto")]);
        }),
      );
      return { release: () => release() };
    };

    it("volver a una sesión cacheada (1 → 2 → 1) dispara una petición nueva y «Calificar» se habilita al llegar, sin pulsar «Actualizar»", async () => {
      setPermissions(ALL_RESULT_PERMISSIONS);
      const { calls } = useBaseHandlers();
      const { release } = gateSession1Rereads(calls);
      await renderWithProviders(<Harness initial={{ sessionId: 1 }} />, { staleTime: PRODUCTION_STALE_TIME_MS });
      await screen.findByText("Bruno Díaz");
      await waitFor(() => expect(screen.getByRole("button", { name: /calificar a bruno/i })).toBeEnabled());

      selectSession("2");
      await screen.findByText("Elena Soto");
      selectSession("1");

      // Hay caché de la sesión 1 (30 s), pero la selección dispara SIEMPRE una lectura nueva.
      await waitFor(() => expect(calls.assignments).toEqual(["1", "2", "1"]));
      await act(async () => {
        release();
        await delay(50);
      });
      await waitFor(() => expect(screen.getByRole("button", { name: /calificar a bruno/i })).toBeEnabled());
      expect(screen.getByRole("button", { name: /actualizar/i })).toBeEnabled();
      expect(calls.assignments).toEqual(["1", "2", "1"]); // sin pulsar «Actualizar»: ninguna petición extra
    });

    it("mientras la petición de la vuelta a la sesión 1 está pendiente, las filas de caché se ven con «Actualizando…» y «Calificar» sigue deshabilitado", async () => {
      setPermissions(ALL_RESULT_PERMISSIONS);
      const { calls } = useBaseHandlers();
      const { release } = gateSession1Rereads(calls);
      await renderWithProviders(<Harness initial={{ sessionId: 1 }} />, { staleTime: PRODUCTION_STALE_TIME_MS });
      await screen.findByText("Bruno Díaz");
      await waitFor(() => expect(screen.getByRole("button", { name: /calificar a bruno/i })).toBeEnabled());

      selectSession("2");
      await screen.findByText("Elena Soto");
      selectSession("1");
      await waitFor(() => expect(calls.assignments).toEqual(["1", "2", "1"]));

      // Petición pendiente: la caché pinta la fila pero no habilita nada.
      const calificar = await screen.findByRole("button", { name: /calificar a bruno/i });
      expect(calificar).toBeDisabled();
      expect(screen.getByRole("button", { name: /actualizar/i })).toBeDisabled();
      expect(screen.getByText(/actualizando/i)).toBeInTheDocument();

      await act(async () => {
        release();
        await delay(50);
      });
      await waitFor(() => expect(screen.getByRole("button", { name: /calificar a bruno/i })).toBeEnabled());
      expect(screen.queryByText(/actualizando/i)).not.toBeInTheDocument();
    });
  });

  it("al cambiar de sesión con el diálogo de confirmación abierto, el diálogo se cierra y no se envía ninguna calificación", async () => {
    setPermissions(ALL_RESULT_PERMISSIONS);
    useBaseHandlers();
    let posted = 0;
    server.use(
      http.post(`${API}/attempts/9002/score`, () => {
        posted += 1;
        return ok(scoreWire(9002));
      }),
    );
    await renderWithProviders(<Harness initial={{ sessionId: 1 }} />);
    await screen.findByText("Bruno Díaz");
    fireEvent.click(within(rowOf("Bruno Díaz")).getByRole("button", { name: /calificar a bruno/i }));
    await screen.findByRole("alertdialog");

    fireEvent.change(screen.getByLabelText("Sesión", { selector: "select" }), { target: { value: "2" } });

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    await screen.findByText("Elena Soto");
    expect(posted).toBe(0);
  });
});

describe("GradingPage — paginación y deep link más allá del primer corte (hallazgo MEDIO)", () => {
  const MANY = GRADING_PAGE_SIZE * 4 + 1; // varias páginas; el último intento queda en la última

  const manyAssignments = () =>
    Array.from({ length: MANY }, (_, i) => assignmentWire(i + 1, 10_000 + i, `Participante ${String(i + 1).padStart(3, "0")}`));

  it("deep link a un intento fuera de la primera página: abre la página que lo contiene y lo destaca", async () => {
    setPermissions(ALL_RESULT_PERMISSIONS);
    useBaseHandlers();
    server.use(http.get(`${API}/sesiones/1/asignaciones`, () => ok(manyAssignments())));
    server.use(http.get(`${API}/attempts/:id/result`, () => fail(404, "Resultado no encontrado")));
    const lastAttemptId = 10_000 + MANY - 1;

    await renderWithProviders(<Harness initial={{ sessionId: 1, attemptId: lastAttemptId }} />);

    const lastName = `Participante ${String(MANY).padStart(3, "0")}`;
    expect(await screen.findByText(lastName)).toBeInTheDocument();
    expect(document.querySelector('[data-highlighted="true"]')).toHaveTextContent(lastName);
    expect(screen.queryByText(/no encontrado/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Participante 001")).not.toBeInTheDocument(); // no es la página 1
  });

  it("la tabla pagina: navegar a otra página pide esa página y se puede volver", async () => {
    setPermissions(ALL_RESULT_PERMISSIONS);
    useBaseHandlers();
    server.use(http.get(`${API}/sesiones/1/asignaciones`, () => ok(manyAssignments())));
    server.use(http.get(`${API}/attempts/:id/result`, () => fail(404, "Resultado no encontrado")));

    await renderWithProviders(<Harness initial={{ sessionId: 1 }} />);
    expect(await screen.findByText("Participante 001")).toBeInTheDocument();
    expect(screen.queryByText(`Participante ${String(GRADING_PAGE_SIZE + 1).padStart(3, "0")}`)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /siguiente|next|página siguiente/i }));
    expect(await screen.findByText(`Participante ${String(GRADING_PAGE_SIZE + 1).padStart(3, "0")}`)).toBeInTheDocument();
    expect(screen.queryByText("Participante 001")).not.toBeInTheDocument();
  });

  it("un intento que no pertenece a la sesión sigue avisando «no encontrado» aunque haya varias páginas", async () => {
    setPermissions(ALL_RESULT_PERMISSIONS);
    useBaseHandlers();
    server.use(http.get(`${API}/sesiones/1/asignaciones`, () => ok(manyAssignments())));
    server.use(http.get(`${API}/attempts/:id/result`, () => fail(404, "Resultado no encontrado")));

    await renderWithProviders(<Harness initial={{ sessionId: 1, attemptId: 777_777 }} />);
    expect(await screen.findByText("Intento #777777 no encontrado")).toBeInTheDocument();
    expect(screen.getByText(/no pertenece a la sesión seleccionada/i)).toBeInTheDocument();
  });
});
