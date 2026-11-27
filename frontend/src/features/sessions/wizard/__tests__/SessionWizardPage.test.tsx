import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpResponse, http } from "msw";
import { onlineManager } from "@tanstack/react-query";
import { ApiError } from "../../../../api/errors";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";

import { PERMISSIONS } from "../../../../store/permissions";
import { useStaffAuth } from "../../../../store/staffAuth";
import { server } from "../../../../test/msw/server";
import versionsFixture from "../../../../api/schemas/__fixtures__/instruments/versions.json";
import type { WizardExitTarget } from "../SessionWizardPage";
import { NO_TEST_PERMISSION_MESSAGE } from "../wizard-queries";
import {
  API,
  clearStaffUser,
  failure,
  ok,
  participantId,
  SESSION_WIRE,
  renderWizard,
  setStaffPermissions,
  mockReadHandlers,
} from "./testUtils";

/** Guarda los subtests de una sesión reanudada confirmando el aviso de sobrescritura. */
async function saveResumedSubtests() {
  fireEvent.click(screen.getByRole("button", { name: /guardar y continuar/i }));
  fireEvent.click(await screen.findByRole("button", { name: "Guardar y sobrescribir" }));
}

const fillField = (label: RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

const initialSessionKey = useStaffAuth.getState().sessionId;

describe("SessionWizardPage", () => {
  beforeEach(() => {
    setStaffPermissions([PERMISSIONS.SESION_CREAR, PERMISSIONS.SESION_APLICAR, PERMISSIONS.PARTICIPANTE_LEER]);
  });
  afterEach(() => {
    useStaffAuth.setState({ sessionId: initialSessionKey });
    clearStaffUser();
    vi.restoreAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  describe("paso Datos e instrumento", () => {
    it("rechaza una hora de fin menor o igual a la de inicio y no crea la sesión", async () => {
      mockReadHandlers();
      let posts = 0;
      server.use(
        http.post(`${API}/sesiones`, () => {
          posts += 1;
          return ok({});
        }),
      );
      await renderWizard();

      fillField(/^Nombre/, "Evaluación de prueba");
      fillField(/Hora de inicio/, "10:00");
      fillField(/Hora de fin/, "10:00");
      fireEvent.change(await screen.findByLabelText(/Instrumento \(test\)/), { target: { value: "1" } });
      fireEvent.click(await screen.findByRole("radio", { name: /Versión 1\.1/ }));
      fireEvent.click(screen.getByRole("button", { name: /crear sesión y continuar/i }));

      expect(await screen.findByText("La hora de fin debe ser posterior a la de inicio.")).toBeInTheDocument();
      expect(posts).toBe(0);
    });

    it("solo permite seleccionar versiones PUBLICADO", async () => {
      mockReadHandlers();
      await renderWizard();

      fireEvent.change(await screen.findByLabelText(/Instrumento \(test\)/), { target: { value: "1" } });

      const draftVersion = await screen.findByRole("radio", { name: /Versión 1\.0/ });
      const publishedVersion = screen.getByRole("radio", { name: /Versión 1\.1/ });
      expect(draftVersion).toBeDisabled();
      expect(publishedVersion).toBeEnabled();
      expect(within(draftVersion.closest("label") as HTMLElement).getByText("Borrador")).toBeInTheDocument();
      expect(within(publishedVersion.closest("label") as HTMLElement).getByText("Publicado")).toBeInTheDocument();
    });

    it("muestra un mensaje claro cuando el rol no puede leer tests (403, B12)", async () => {
      mockReadHandlers();
      server.use(http.get(`${API}/tests`, () => failure(403, "Forbidden")));
      await renderWizard();

      expect(await screen.findByText(NO_TEST_PERMISSION_MESSAGE)).toBeInTheDocument();
      expect(NO_TEST_PERMISSION_MESSAGE).toBe(
        "Su rol no tiene permiso para consultar instrumentos. Solicite al administrador el permiso de lectura del catálogo de instrumentos.",
      );
      // El resto del asistente sigue en pie.
      expect(screen.getByRole("navigation", { name: /pasos de creación de sesión/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /crear sesión y continuar/i })).toBeInTheDocument();
    });
  });

  describe("reanudación", () => {
    it("salta al paso Subtests al recargar con ?sessionId y sin asignaciones", async () => {
      mockReadHandlers();
      await renderWizard({ sessionId: 1 });

      expect(await screen.findByText("Subtests de la versión")).toBeInTheDocument();
      expect(await screen.findByText("Memoria Visual")).toBeInTheDocument();
      const current = screen.getByRole("navigation", { name: /pasos de creación/i }).querySelector("[aria-current='step']");
      expect(current).toHaveTextContent("Subtests");
    });

    it("salta al paso Participantes cuando la sesión ya tiene asignaciones", async () => {
      mockReadHandlers({
        assignments: [
          {
            assignmentId: 7,
            participantId: participantId(1),
            participantName: "Ana Prueba",
            status: "GENERADO",
            state: "no-iniciado",
            overallProgress: 0,
          },
        ],
      });
      await renderWizard({ sessionId: 1 });

      expect(await screen.findByLabelText("Buscar participante")).toBeInTheDocument();
      const current = screen.getByRole("navigation", { name: /pasos de creación/i }).querySelector("[aria-current='step']");
      expect(current).toHaveTextContent("Participantes");
      expect(await screen.findByText("Ya asignado a esta sesión")).toBeInTheDocument();
    });

    it("no ofrece editar una sesión que ya no está programada", async () => {
      mockReadHandlers();
      server.use(http.get(`${API}/sesiones/1`, () => ok({ ...(SESSION_ABIERTA as object) })));
      const onExit = vi.fn();
      await renderWizard({ sessionId: 1, onExit });

      expect(await screen.findByText(/ya no se puede configurar desde el asistente/i)).toBeInTheDocument();
      const link = screen.getByRole("link", { name: "Ir al detalle de la sesión" });
      expect(link).toHaveAttribute("href", "/app/sesiones/1");
      // Sin acciones de edición ni cancelación desde el wizard.
      expect(screen.queryByRole("button", { name: "Cancelar" })).not.toBeInTheDocument();
      expect(onExit).not.toHaveBeenCalled();
    });
  });

  describe("asignación de participantes", () => {
    /** Reanuda en Subtests, guarda, y deja el wizard en Participantes con los 3 participantes visibles. */
    async function goToParticipants(onExit?: (target: WizardExitTarget) => void) {
      mockReadHandlers();
      server.use(http.put(`${API}/sesiones/1/subtests`, () => ok([])));
      const rendered = await renderWizard({ sessionId: 1, onExit });
      await screen.findByText("Memoria Visual");
      await saveResumedSubtests();
      await screen.findByLabelText("Buscar participante");
      await screen.findByText("Ana Prueba");
      return rendered;
    }

    const cacheHasToken = (client: { getMutationCache: () => { getAll: () => unknown[] } }) =>
      client.getMutationCache().getAll().some((m) => {
        const text = JSON.stringify(m, (_k, v) => (typeof v === "bigint" ? String(v) : v));
        return text.includes("rawToken") || text.includes("tok-cache-");
      });

    it("al terminar un lote la MutationCache no conserva ningún rawToken", async () => {
      const { queryClient } = await goToParticipants();
      server.use(
        http.post(`${API}/sesiones/1/asignaciones`, async ({ request }) => {
          const body = (await request.json()) as { participantId: string };
          const n = body.participantId.slice(-1);
          if (n === "2") return failure(500, "Fallo del servidor");
          return ok({ assignmentId: 500 + Number(n), rawToken: `tok-cache-${n}`, expiresAt: "2026-11-24T22:00:00" });
        }),
      );
      fireEvent.click(screen.getByRole("button", { name: /seleccionar todos los filtrados \(3\)/i }));
      fireEvent.click(screen.getByRole("button", { name: /asignar 3 seleccionado/i }));
      expect(await screen.findByText("1 asignación(es) fallida(s)")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /continuar a revisión/i }));
      // Los tokens sí llegaron a la hoja…
      expect(await screen.findByText(/501-tok-cache-1/)).toBeInTheDocument();
      // …pero ninguna mutación en caché los conserva.
      expect(cacheHasToken(queryClient)).toBe(false);
    });

    it("con 403 en la consulta de participantes (recarga con datos previos) deshabilita Asignar y Reintentar y no envía POST", async () => {
      let posts = 0;
      const { queryClient } = await goToParticipants();
      server.use(
        http.post(`${API}/sesiones/1/asignaciones`, async ({ request }) => {
          posts += 1;
          const body = (await request.json()) as { participantId: string };
          if (body.participantId === participantId(2)) return failure(500, "Fallo del servidor");
          return ok({ assignmentId: 500 + posts, rawToken: `tok-${posts}`, expiresAt: "2026-11-24T22:00:00" });
        }),
      );
      fireEvent.click(screen.getByLabelText("Seleccionar Beto Prueba"));
      fireEvent.click(screen.getByRole("button", { name: /asignar 1 seleccionado/i }));
      expect(await screen.findByText("1 asignación(es) fallida(s)")).toBeInTheDocument();
      expect(posts).toBe(1);

      // Selecciona a otro y recarga los participantes con 403.
      fireEvent.click(screen.getByLabelText("Seleccionar Ana Prueba"));
      server.use(http.get(`${API}/participantes`, () => failure(403, "Forbidden")));
      await act(async () => {
        await queryClient.invalidateQueries({ queryKey: ["session-wizard", "participants"] });
      });
      expect(await screen.findByText("Sin permiso para ver participantes")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /asignar \d+ seleccionado/i })).toBeDisabled();
      expect(screen.getByRole("button", { name: /reintentar fallidos \(1\)/i })).toBeDisabled();
      expect(posts).toBe(1);
    });

    it("un 403 con «Reintentar fallidos» pausado sin conexión no envía el POST ni borra el fallo pendiente", async () => {
      let posts = 0;
      const { queryClient } = await goToParticipants();
      server.use(
        http.post(`${API}/sesiones/1/asignaciones`, () => {
          posts += 1;
          return failure(500, "Fallo del servidor");
        }),
      );
      fireEvent.click(screen.getByLabelText("Seleccionar Beto Prueba"));
      fireEvent.click(screen.getByRole("button", { name: /asignar 1 seleccionado/i }));
      expect(await screen.findByText("1 asignación(es) fallida(s)")).toBeInTheDocument();
      expect(posts).toBe(1);

      try {
        onlineManager.setOnline(false);
        fireEvent.click(screen.getByRole("button", { name: /reintentar fallidos \(1\)/i }));
        await waitFor(() => expect(queryClient.getMutationCache().getAll().some((m) => m.state.isPaused)).toBe(true));
        // 403 en caché y reconexión en el mismo bloque síncrono: React aún no ejecutó ningún efecto.
        queryClient.getQueryCache().find({ queryKey: ["session-wizard", "participants"] })?.setState({
          status: "error",
          error: new ApiError({ status: 403, code: "FORBIDDEN", message: "Forbidden" }),
        });
      } finally {
        onlineManager.setOnline(true);
      }
      // El lote termina (sin «Asignando…») antes de contar POST.
      await waitFor(() =>
        expect(queryClient.getMutationCache().getAll().some((m) => m.state.isPaused || m.state.status === "pending")).toBe(false),
      );
      await waitFor(() => expect(screen.queryByText(/Asignando/)).not.toBeInTheDocument());
      expect(posts).toBe(1); // el reintento pausado nunca se envió
      // El fallo sigue pendiente (al reconectar la lista vuelve a cargarse y el reintento queda disponible).
      expect(screen.getByText("1 asignación(es) fallida(s)")).toBeInTheDocument();
    });

    it("un 403 a mitad de «Reintentar fallidos» retira el fallo de quien recibió su acceso y conserva el del no enviado", async () => {
      let round = 1;
      let roundTwoPosts = 0;
      let release: () => void = () => undefined;
      const hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      const { queryClient } = await goToParticipants();
      server.use(
        http.post(`${API}/sesiones/1/asignaciones`, async () => {
          if (round === 1) return failure(500, "Fallo del servidor");
          roundTwoPosts += 1;
          await hold;
          return ok({ assignmentId: 900 + roundTwoPosts, rawToken: `tok-r-${roundTwoPosts}`, expiresAt: "2026-11-24T22:00:00" });
        }),
      );
      fireEvent.click(screen.getByLabelText("Seleccionar Ana Prueba"));
      fireEvent.click(screen.getByLabelText("Seleccionar Beto Prueba"));
      fireEvent.click(screen.getByRole("button", { name: /asignar 2 seleccionado/i }));
      expect(await screen.findByText("2 asignación(es) fallida(s)")).toBeInTheDocument();

      round = 2;
      fireEvent.click(screen.getByRole("button", { name: /reintentar fallidos \(2\)/i }));
      await waitFor(() => expect(roundTwoPosts).toBe(1));
      act(() => {
        queryClient.getQueryCache().find({ queryKey: ["session-wizard", "participants"] })?.setState({
          status: "error",
          error: new ApiError({ status: 403, code: "FORBIDDEN", message: "Forbidden" }),
        });
      });
      release();
      expect(await screen.findByText("1 asignación(es) fallida(s)")).toBeInTheDocument();
      await waitFor(() => expect(screen.queryByText(/Asignando/)).not.toBeInTheDocument());
      expect(roundTwoPosts).toBe(1); // el segundo reintento nunca se envió
    });

    it("al reintentar con éxito, el fallo de quien ya figura asignado desde otra pestaña también se retira", async () => {
      let betoAssigned = false;
      let round = 1;
      const attempts: string[] = [];
      const { queryClient } = await goToParticipants();
      server.use(
        http.get(`${API}/sesiones/1/asignaciones`, () =>
          ok(
            betoAssigned
              ? [
                  {
                    assignmentId: 777,
                    attemptId: null,
                    participantId: participantId(2),
                    participantName: "Beto Prueba",
                    participantCode: "PART-002",
                    status: "GENERADO",
                    state: "no-iniciado",
                    currentSubtestId: "—",
                    overallProgress: 0,
                    lastActivity: "Nunca",
                    tokenExpiraEn: "2026-11-24T22:00:00",
                  },
                ]
              : [],
          ),
        ),
        http.post(`${API}/sesiones/1/asignaciones`, async ({ request }) => {
          const body = (await request.json()) as { participantId: string };
          attempts.push(body.participantId);
          if (round === 1) return failure(500, "Fallo del servidor");
          return ok({ assignmentId: 901, rawToken: "tok-reintento", expiresAt: "2026-11-24T22:00:00" });
        }),
      );
      fireEvent.click(screen.getByLabelText("Seleccionar Ana Prueba"));
      fireEvent.click(screen.getByLabelText("Seleccionar Beto Prueba"));
      fireEvent.click(screen.getByRole("button", { name: /asignar 2 seleccionado/i }));
      expect(await screen.findByText("2 asignación(es) fallida(s)")).toBeInTheDocument();

      // Beto queda asignado desde otra pestaña; Ana se reintenta con éxito.
      betoAssigned = true;
      await act(async () => {
        await queryClient.invalidateQueries({ queryKey: ["sessions", "detail", 1, "assignments"] });
      });
      expect(await screen.findByText("Ya asignado a esta sesión")).toBeInTheDocument();
      round = 2;
      fireEvent.click(screen.getByRole("button", { name: /reintentar fallidos/i }));
      await waitFor(() => expect(screen.queryByText(/asignación\(es\) fallida\(s\)/)).not.toBeInTheDocument());
      expect(attempts.slice(2)).toEqual([participantId(1)]); // Beto no se reenvió
      // El paso Revisión no lo presenta como «sin asignar».
      fireEvent.click(screen.getByRole("button", { name: /continuar a revisión/i }));
      expect(await screen.findByRole("region", { name: "Hoja de accesos" })).toBeInTheDocument();
      expect(screen.queryByText(/participante\(s\) sin asignar/)).not.toBeInTheDocument();
    });

    it("si alguien queda asignado durante el lote (recarga entre POST), Revisión no lo muestra «sin asignar»", async () => {
      let betoAssigned = false;
      let round = 1;
      let roundTwoPosts = 0;
      let release: () => void = () => undefined;
      const hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      await goToParticipants();
      server.use(
        http.get(`${API}/sesiones/1/asignaciones`, () =>
          ok(
            betoAssigned
              ? [
                  {
                    assignmentId: 777,
                    attemptId: null,
                    participantId: participantId(2),
                    participantName: "Beto Prueba",
                    participantCode: "PART-002",
                    status: "GENERADO",
                    state: "no-iniciado",
                    currentSubtestId: "—",
                    overallProgress: 0,
                    lastActivity: "Nunca",
                    tokenExpiraEn: "2026-11-24T22:00:00",
                  },
                ]
              : [],
          ),
        ),
        http.post(`${API}/sesiones/1/asignaciones`, async () => {
          if (round === 1) return failure(500, "Fallo del servidor");
          roundTwoPosts += 1;
          if (roundTwoPosts === 1) {
            betoAssigned = true; // otra pestaña asigna a Beto; la recarga tras este POST ya lo trae
            return ok({ assignmentId: 901, rawToken: "tok-ana", expiresAt: "2026-11-24T22:00:00" });
          }
          await hold;
          return failure(409, "El participante ya está asignado");
        }),
      );
      fireEvent.click(screen.getByLabelText("Seleccionar Ana Prueba"));
      fireEvent.click(screen.getByLabelText("Seleccionar Beto Prueba"));
      fireEvent.click(screen.getByRole("button", { name: /asignar 2 seleccionado/i }));
      expect(await screen.findByText("2 asignación(es) fallida(s)")).toBeInTheDocument();

      round = 2;
      fireEvent.click(screen.getByRole("button", { name: /reintentar fallidos \(2\)/i }));
      await waitFor(() => expect(roundTwoPosts).toBe(2));
      // Ana (recién asignada) y Beto (asignado desde otra pestaña) figuran asignados con el 2.º POST en vuelo.
      await waitFor(() => expect(screen.getAllByText("Ya asignado a esta sesión")).toHaveLength(2));
      release();
      await waitFor(() => expect(screen.queryByText(/Asignando/)).not.toBeInTheDocument());
      // Participantes tampoco ofrece reintentar a Beto tras el 409.
      expect(screen.queryByRole("button", { name: /reintentar fallidos/i })).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: /continuar a revisión/i }));
      expect(await screen.findByRole("region", { name: "Hoja de accesos" })).toBeInTheDocument();
      expect(screen.queryByText(/participante\(s\) sin asignar/)).not.toBeInTheDocument();
    });

    it("un participante fallido que luego aparece asignado no se reenvía", async () => {
      const attempts: string[] = [];
      let betoAssigned = false;
      const { queryClient } = await goToParticipants();
      server.use(
        http.get(`${API}/sesiones/1/asignaciones`, () =>
          ok(
            betoAssigned
              ? [
                  {
                    assignmentId: 777,
                    attemptId: null,
                    participantId: participantId(2),
                    participantName: "Beto Prueba",
                    participantCode: "PART-002",
                    status: "GENERADO",
                    state: "no-iniciado",
                    currentSubtestId: "—",
                    overallProgress: 0,
                    lastActivity: "Nunca",
                    tokenExpiraEn: "2026-11-24T22:00:00",
                  },
                ]
              : [],
          ),
        ),
        http.post(`${API}/sesiones/1/asignaciones`, async ({ request }) => {
          const body = (await request.json()) as { participantId: string };
          attempts.push(body.participantId);
          return failure(500, "Fallo del servidor");
        }),
      );
      fireEvent.click(screen.getByLabelText("Seleccionar Beto Prueba"));
      fireEvent.click(screen.getByRole("button", { name: /asignar 1 seleccionado/i }));
      expect(await screen.findByText("1 asignación(es) fallida(s)")).toBeInTheDocument();
      expect(attempts).toEqual([participantId(2)]);

      // Beto aparece asignado en servidor (p. ej. otra pestaña) y se refrescan las asignaciones.
      betoAssigned = true;
      await act(async () => {
        await queryClient.invalidateQueries({ queryKey: ["sessions", "detail", 1, "assignments"] });
      });
      expect(await screen.findByText("Ya asignado a esta sesión")).toBeInTheDocument();
      const retry = screen.queryByRole("button", { name: /reintentar fallidos/i });
      if (retry) fireEvent.click(retry);
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(attempts).toEqual([participantId(2)]);
    });

    it("continúa tras un fallo parcial y reintenta solo los fallidos", async () => {
      const attempts: string[] = [];
      let betoFails = true;
      await goToParticipants();
      server.use(
        http.post(`${API}/sesiones/1/asignaciones`, async ({ request }) => {
          const body = (await request.json()) as { participantId: string };
          attempts.push(body.participantId);
          if (body.participantId === participantId(2) && betoFails) return failure(500, "Fallo del servidor");
          const n = body.participantId.slice(-1);
          return ok({ assignmentId: 500 + Number(n), rawToken: `tok-secret-${n}`, expiresAt: "2026-11-24T22:00:00" });
        }),
      );

      fireEvent.click(screen.getByRole("button", { name: /seleccionar todos los filtrados \(3\)/i }));
      fireEvent.click(screen.getByRole("button", { name: /asignar 3 seleccionado/i }));

      // Los 3 se intentan aunque el segundo falle.
      expect(await screen.findByText("1 asignación(es) fallida(s)")).toBeInTheDocument();
      expect(attempts).toEqual([participantId(1), participantId(2), participantId(3)]);
      expect(screen.getByText(/Beto Prueba/, { selector: "span" })).toBeInTheDocument();

      betoFails = false;
      fireEvent.click(screen.getByRole("button", { name: /reintentar fallidos \(1\)/i }));
      await waitFor(() => expect(screen.queryByText("1 asignación(es) fallida(s)")).not.toBeInTheDocument());
      // Solo se reintentó al fallido.
      expect(attempts).toEqual([participantId(1), participantId(2), participantId(3), participantId(2)]);

      // La hoja de accesos reúne los 3 enlaces.
      fireEvent.click(screen.getByRole("button", { name: /continuar a revisión/i }));
      const sheet = await screen.findByRole("region", { name: "Hoja de accesos" });
      expect(within(sheet).getByText("Estos códigos no se volverán a mostrar")).toBeInTheDocument();
      expect(within(sheet).getByText(`${window.location.origin}/evaluacion/501-tok-secret-1`)).toBeInTheDocument();
      expect(within(sheet).getByText(`${window.location.origin}/evaluacion/502-tok-secret-2`)).toBeInTheDocument();
      expect(within(sheet).getByText(`${window.location.origin}/evaluacion/503-tok-secret-3`)).toBeInTheDocument();
    });

    it("nunca escribe el rawToken en localStorage ni sessionStorage", async () => {
      const setItem = vi.spyOn(Storage.prototype, "setItem");
      await goToParticipants();
      server.use(
        http.post(`${API}/sesiones/1/asignaciones`, () =>
          HttpResponse.json({
            success: true,
            data: { assignmentId: 900, rawToken: "tok-ultra-secreto", expiresAt: "2026-11-24T22:00:00" },
            message: "OK",
            error: null,
          }),
        ),
      );

      fireEvent.click(screen.getByLabelText("Seleccionar Ana Prueba"));
      fireEvent.click(screen.getByRole("button", { name: /asignar 1 seleccionado/i }));
      fireEvent.click(await screen.findByRole("button", { name: /continuar a revisión/i }));
      // El token se muestra en pantalla (memoria del componente)…
      expect(await screen.findByText(/900-tok-ultra-secreto/)).toBeInTheDocument();

      // …pero no existe en ningún storage.
      const dump = (storage: Storage) =>
        Array.from({ length: storage.length }, (_, i) => `${storage.key(i)}=${storage.getItem(storage.key(i) as string)}`).join("\n");
      expect(dump(window.localStorage)).not.toContain("tok-ultra-secreto");
      expect(dump(window.sessionStorage)).not.toContain("tok-ultra-secreto");
      for (const [, value] of setItem.mock.calls) expect(String(value)).not.toContain("tok-ultra-secreto");
    });
  });

  describe("salida del asistente", () => {
    it("pide confirmación al salir con códigos sin copiar ni imprimir", async () => {
      const onExit = vi.fn();
      mockReadHandlers();
      server.use(
        http.put(`${API}/sesiones/1/subtests`, () => ok([])),
        http.post(`${API}/sesiones/1/asignaciones`, () =>
          ok({ assignmentId: 901, rawToken: "tok-a", expiresAt: "2026-11-24T22:00:00" }),
        ),
      );
      await renderWizard({ sessionId: 1, onExit });
      await screen.findByText("Memoria Visual");
      await saveResumedSubtests();
      fireEvent.click(await screen.findByLabelText("Seleccionar Ana Prueba"));
      fireEvent.click(screen.getByRole("button", { name: /asignar 1 seleccionado/i }));
      fireEvent.click(await screen.findByRole("button", { name: /continuar a revisión/i }));
      await screen.findByRole("region", { name: "Hoja de accesos" });

      fireEvent.click(screen.getByRole("button", { name: "Ir al monitor" }));
      expect(await screen.findByText("Salir sin copiar los códigos")).toBeInTheDocument();
      expect(onExit).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "Volver a la hoja" }));
      await waitFor(() => expect(screen.queryByText("Salir sin copiar los códigos")).not.toBeInTheDocument());
      expect(onExit).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "Ir al monitor" }));
      fireEvent.click(await screen.findByRole("button", { name: "Salir de todos modos" }));
      await waitFor(() => expect(onExit).toHaveBeenCalledWith({ to: "monitor", sessionId: 1 }));
    });

    it("con la sesión creada ofrece dejarla programada o cancelarla", async () => {
      const onExit = vi.fn();
      mockReadHandlers();
      let cancelled = false;
      server.use(
        http.post(`${API}/sesiones/1/cancelar`, () => {
          cancelled = true;
          return ok({ ...SESSION_ABIERTA, estado: "CANCELADA" });
        }),
      );
      await renderWizard({ sessionId: 1, onExit });
      await screen.findByText("Memoria Visual");

      fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
      expect(await screen.findByRole("button", { name: "Dejar como programada" })).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Cancelar sesión creada" }));

      // Confirmación de tono danger antes de cancelar en el servidor.
      const confirmButtons = await screen.findAllByRole("button", { name: "Cancelar sesión creada" });
      fireEvent.click(confirmButtons[confirmButtons.length - 1]);
      await waitFor(() => expect(onExit).toHaveBeenCalledWith({ to: "list" }));
      expect(cancelled).toBe(true);
    });
  });

  describe("reanudación y subtests guardados", () => {
    it("avisa que se sobrescribirá la configuración previa y bloquea quitar subtests guardados", async () => {
      mockReadHandlers();
      let body: unknown;
      server.use(
        http.put(`${API}/sesiones/1/subtests`, async ({ request }) => {
          body = await request.json();
          return ok([
            { id: 300, sesionAplicacionId: 1, subtestId: 20, numeroOrden: 1, tiempoLimiteSegundos: 600, permiteAleatorizarItems: true, permiteAleatorizarOpciones: false },
          ]);
        }),
      );
      await renderWizard({ sessionId: 1 });
      await screen.findByText("Memoria Visual");
      expect(screen.getByText("Sesión reanudada")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: /guardar y continuar/i }));
      expect(await screen.findByText("Sobrescribir la configuración de subtests")).toBeInTheDocument();
      expect(body).toBeUndefined();
      fireEvent.click(screen.getByRole("button", { name: "Guardar y sobrescribir" }));
      await waitFor(() => expect(body).toBeDefined());
      await screen.findByLabelText("Buscar participante");

      // Volver a Subtests: el guardado en servidor ya no se puede desmarcar.
      fireEvent.click(screen.getByRole("button", { name: "Atrás" }));
      const checkbox = await screen.findByRole("checkbox", { name: "Incluir Memoria Visual" });
      expect(checkbox).toBeDisabled();
      expect(screen.getByText("Quitar subtests guardados aún no está disponible")).toBeInTheDocument();
    });

    it("deshabilita aleatorizar ítems cuando la versión no lo permite y envía false", async () => {
      mockReadHandlers();
      let body: Array<{ randomizeItems?: boolean }> = [];
      server.use(
        http.get(`${API}/tests/1/versions`, () =>
          ok(versionsFixture.map((v) => (v.id === 10 ? { ...v, permiteAleatorizarItems: false } : v))),
        ),
        http.put(`${API}/sesiones/1/subtests`, async ({ request }) => {
          body = (await request.json()) as typeof body;
          return ok([]);
        }),
      );
      await renderWizard({ sessionId: 1 });
      await screen.findByText("Memoria Visual");
      const checkbox = screen.getByRole("checkbox", { name: "Aleatorizar ítems de Memoria Visual" });
      await waitFor(() => expect(screen.getByText("La versión no permite aleatorizar ítems.")).toBeInTheDocument());
      expect(checkbox).toBeDisabled();
      expect(checkbox).not.toBeChecked();

      await saveResumedSubtests();
      await waitFor(() => expect(body[0]?.randomizeItems).toBe(false));
    });

    it("muestra error con reintento si falla GET de asignaciones (no lo trata como vacío)", async () => {
      mockReadHandlers();
      let fail = true;
      server.use(
        http.get(`${API}/sesiones/1/asignaciones`, () => (fail ? failure(500, "Fallo asignaciones") : ok([]))),
      );
      await renderWizard({ sessionId: 1 });
      expect(await screen.findByText("No se pudieron cargar las asignaciones de la sesión")).toBeInTheDocument();
      expect(screen.queryByText("Subtests de la versión")).not.toBeInTheDocument();
      fail = false;
      fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
      expect(await screen.findByText("Subtests de la versión")).toBeInTheDocument();
    });
  });

  describe("cancelar desde el wizard", () => {
    it("sin SESION_APLICAR no ofrece cancelar la sesión creada", async () => {
      setStaffPermissions([PERMISSIONS.SESION_CREAR]);
      mockReadHandlers();
      await renderWizard({ sessionId: 1 });
      await screen.findByText("Memoria Visual");
      fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
      expect(await screen.findByRole("button", { name: "Dejar como programada" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Cancelar sesión creada" })).not.toBeInTheDocument();
    });
  });

  describe("enlaces emitidos", () => {
    async function issueOneLink(onExit?: (target: WizardExitTarget) => void) {
      mockReadHandlers();
      const bodies: Array<{ participantId: string; ttlHours?: number }> = [];
      server.use(
        http.put(`${API}/sesiones/1/subtests`, () => ok([])),
        http.post(`${API}/sesiones/1/asignaciones`, async ({ request }) => {
          bodies.push((await request.json()) as (typeof bodies)[number]);
          return ok({ assignmentId: 901, rawToken: "tok-a", expiresAt: "2026-11-24T22:00:00" });
        }),
      );
      const rendered = await renderWizard({ sessionId: 1, onExit });
      await screen.findByText("Memoria Visual");
      await saveResumedSubtests();
      fireEvent.click(await screen.findByLabelText("Seleccionar Ana Prueba"));
      fireEvent.click(screen.getByRole("button", { name: /asignar 1 seleccionado/i }));
      fireEvent.click(await screen.findByRole("button", { name: /continuar a revisión/i }));
      await screen.findByRole("region", { name: "Hoja de accesos" });
      return { ...rendered, bodies };
    }

    it("envía ttlHours calculado, muestra vencimiento y QR local", async () => {
      const { bodies } = await issueOneLink();
      expect(bodies[0].ttlHours).toBeGreaterThanOrEqual(8);
      expect(bodies[0].ttlHours).toBeLessThanOrEqual(336);
      const sheet = screen.getByRole("region", { name: "Hoja de accesos" });
      expect(within(sheet).getByText(/^Vence /)).toBeInTheDocument();
      expect(within(sheet).getByRole("img", { name: /QR del enlace de Ana Prueba/i })).toBeInTheDocument();
    });

    it("bloquea la navegación mientras haya enlaces sin exportar y la permite al confirmar", async () => {
      const { router } = await issueOneLink();
      await act(async () => {
        void router.navigate({ to: "/otra-ruta" as never });
      });
      expect(await screen.findByText("Salir sin exportar los enlaces")).toBeInTheDocument();
      expect(router.state.location.pathname).toBe("/");

      fireEvent.click(screen.getByRole("button", { name: "Quedarme aquí" }));
      await waitFor(() => expect(screen.queryByText("Salir sin exportar los enlaces")).not.toBeInTheDocument());
      expect(router.state.location.pathname).toBe("/");

      await act(async () => {
        void router.navigate({ to: "/otra-ruta" as never });
      });
      fireEvent.click(await screen.findByRole("button", { name: "Salir sin exportar" }));
      await waitFor(() => expect(router.state.location.pathname).toBe("/otra-ruta"));
    });

    it("si la sesión pasa a ABIERTA con enlaces sin exportar, la solo lectura conserva la hoja y el diálogo de salida", async () => {
      const { router, queryClient } = await issueOneLink();
      server.use(http.get(`${API}/sesiones/1`, () => ok({ ...SESSION_WIRE, estado: "ABIERTA" })));
      await act(async () => {
        await queryClient.refetchQueries({ queryKey: ["sessions"] });
      });

      expect(await screen.findByText("Esta sesión ya no se puede configurar desde el asistente")).toBeInTheDocument();
      const sheet = await screen.findByRole("region", { name: "Hoja de accesos" });
      expect(within(sheet).getByText("Ana Prueba")).toBeInTheDocument();
      expect(within(sheet).getByRole("button", { name: /copiar todo/i })).toBeInTheDocument();

      await act(async () => {
        void router.navigate({ to: "/otra-ruta" as never });
      });
      expect(await screen.findByText("Salir sin exportar los enlaces")).toBeInTheDocument();
      expect(router.state.location.pathname).toBe("/");
      fireEvent.click(screen.getByRole("button", { name: "Salir sin exportar" }));
      await waitFor(() => expect(router.state.location.pathname).toBe("/otra-ruta"));
    });

    it("no bloquea tras copiar todo (control por asignación)", async () => {
      Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
      const { router } = await issueOneLink();
      fireEvent.click(screen.getByRole("button", { name: /copiar todo/i }));
      await waitFor(() => expect(screen.getByText(/todos los enlaces fueron exportados/i)).toBeInTheDocument());
      await act(async () => {
        void router.navigate({ to: "/otra-ruta" as never });
      });
      await waitFor(() => expect(router.state.location.pathname).toBe("/otra-ruta"));
      expect(screen.queryByText("Salir sin exportar los enlaces")).not.toBeInTheDocument();
    });
  });

  describe("cambio de cuenta durante un lote", () => {
    it("deja de enviar asignaciones y no publica resultados si cambió la cuenta", async () => {
      mockReadHandlers();
      const attempts: string[] = [];
      server.use(
        http.put(`${API}/sesiones/1/subtests`, () => ok([])),
        http.post(`${API}/sesiones/1/asignaciones`, async ({ request }) => {
          const body = (await request.json()) as { participantId: string };
          attempts.push(body.participantId);
          useStaffAuth.setState({ sessionId: "otra-cuenta" });
          return ok({ assignmentId: 700, rawToken: "tok-x", expiresAt: "2026-11-24T22:00:00" });
        }),
      );
      await renderWizard({ sessionId: 1 });
      await screen.findByText("Memoria Visual");
      await saveResumedSubtests();
      await screen.findByText("Ana Prueba");
      fireEvent.click(screen.getByRole("button", { name: /seleccionar todos los filtrados \(3\)/i }));
      fireEvent.click(screen.getByRole("button", { name: /asignar 3 seleccionado/i }));
      await waitFor(() => expect(screen.queryByText(/Asignando/)).not.toBeInTheDocument());
      expect(attempts).toHaveLength(1);
      expect(screen.queryByText(/participante\(s\) asignado\(s\)/)).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /continuar sin asignar/i })).toBeInTheDocument();
    });
  });

  describe("lote de asignación en curso", () => {
    const tokenFor = (n: number) => `tok-lote-${n}`;

    /** Reanuda hasta Participantes y deja el POST nº `holdAt` en vuelo hasta `release()`. */
    async function startHeldBatch(holdAt: number) {
      mockReadHandlers();
      let release: () => void = () => undefined;
      const hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      const attempts: string[] = [];
      server.use(
        http.put(`${API}/sesiones/1/subtests`, () => ok([])),
        http.post(`${API}/sesiones/1/asignaciones`, async ({ request }) => {
          const body = (await request.json()) as { participantId: string };
          attempts.push(body.participantId);
          const n = attempts.length;
          if (n === holdAt) await hold;
          return ok({ assignmentId: 600 + n, rawToken: tokenFor(n), expiresAt: "2026-11-24T22:00:00" });
        }),
      );
      const rendered = await renderWizard({ sessionId: 1 });
      await screen.findByText("Memoria Visual");
      await saveResumedSubtests();
      await screen.findByText("Ana Prueba");
      fireEvent.click(screen.getByRole("button", { name: /seleccionar todos los filtrados \(3\)/i }));
      fireEvent.click(screen.getByRole("button", { name: /asignar 3 seleccionado/i }));
      await waitFor(() => expect(attempts.length).toBeGreaterThanOrEqual(holdAt));
      return { ...rendered, attempts, release };
    }

    it("el bloqueo de salida rige desde que empieza el lote, antes de la primera respuesta", async () => {
      const { router, attempts, release } = await startHeldBatch(1);
      expect(attempts).toHaveLength(1); // el primer POST sigue en vuelo: aún no hay ningún token
      await act(async () => {
        void router.navigate({ to: "/otra-ruta" as never });
      });
      expect(await screen.findByText("Salir sin exportar los enlaces")).toBeInTheDocument();
      expect(router.state.location.pathname).toBe("/");
      fireEvent.click(screen.getByRole("button", { name: "Quedarme aquí" }));
      release();
      await waitFor(() => expect(screen.queryByText(/Asignando/)).not.toBeInTheDocument());
    });

    it("cada token se publica al llegar: sigue bloqueando durante el lote y todos quedan en la hoja", async () => {
      const { router, release } = await startHeldBatch(2);
      await act(async () => {
        void router.navigate({ to: "/otra-ruta" as never });
      });
      expect(await screen.findByText("Salir sin exportar los enlaces")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Quedarme aquí" }));
      await waitFor(() => expect(screen.queryByText("Salir sin exportar los enlaces")).not.toBeInTheDocument());

      release();
      fireEvent.click(await screen.findByRole("button", { name: /continuar a revisión/i }));
      const sheet = await screen.findByRole("region", { name: "Hoja de accesos" });
      for (const n of [1, 2, 3]) {
        expect(within(sheet).getByText(`${window.location.origin}/evaluacion/${600 + n}-${tokenFor(n)}`)).toBeInTheDocument();
      }
    });

    it("si la sesión pasa a ABIERTA con el POST 2 en vuelo, su token llega a la hoja de solo lectura y no se envía un POST 3", async () => {
      const { router, queryClient, attempts, release } = await startHeldBatch(2);
      expect(attempts).toHaveLength(2);
      server.use(http.get(`${API}/sesiones/1`, () => ok({ ...SESSION_WIRE, estado: "ABIERTA" })));
      await act(async () => {
        await queryClient.refetchQueries({ queryKey: ["sessions"] });
      });
      expect(await screen.findByText("Esta sesión ya no se puede configurar desde el asistente")).toBeInTheDocument();

      // Durante la espera el guard de salida sigue activo.
      await act(async () => {
        void router.navigate({ to: "/otra-ruta" as never });
      });
      expect(await screen.findByText("Salir sin exportar los enlaces")).toBeInTheDocument();
      expect(router.state.location.pathname).toBe("/");
      fireEvent.click(screen.getByRole("button", { name: "Quedarme aquí" }));

      release();
      const sheet = await screen.findByRole("region", { name: "Hoja de accesos" });
      await waitFor(() => {
        for (const n of [1, 2]) {
          expect(within(sheet).getByText(`${window.location.origin}/evaluacion/${600 + n}-${tokenFor(n)}`)).toBeInTheDocument();
        }
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(attempts).toHaveLength(2); // el POST 3 nunca se envió
    });

    it("un 403 de participantes recibido durante el lote detiene los POST siguientes y entrega el token en vuelo", async () => {
      const { queryClient, attempts, release } = await startHeldBatch(2);
      expect(attempts).toHaveLength(2);
      server.use(http.get(`${API}/participantes`, () => failure(403, "Forbidden")));
      await act(async () => {
        await queryClient.invalidateQueries({ queryKey: ["session-wizard", "participants"] });
      });
      expect(await screen.findByText("Sin permiso para ver participantes")).toBeInTheDocument();
      release();
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(attempts).toHaveLength(2); // el POST 3 nunca se envió
      fireEvent.click(screen.getByRole("button", { name: /continuar a revisión/i }));
      const sheet = await screen.findByRole("region", { name: "Hoja de accesos" });
      for (const n of [1, 2]) {
        expect(within(sheet).getByText(`${window.location.origin}/evaluacion/${600 + n}-${tokenFor(n)}`)).toBeInTheDocument();
      }
    });

    it("al salir de la ruta durante el lote no se envían más POST", async () => {
      const { attempts, release, unmount } = await startHeldBatch(2);
      expect(attempts).toHaveLength(2);
      unmount();
      release();
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(attempts).toHaveLength(2); // el tercer participante nunca se envió
    });
  });

  describe("cambio de cuenta al crear la sesión", () => {
    it("no escribe caché, no avisa ni avanza si la cuenta cambió durante POST /sesiones", async () => {
      mockReadHandlers();
      const onCreatedNavigations: number[] = [];
      server.use(
        http.post(`${API}/sesiones`, () => {
          useStaffAuth.setState({ sessionId: "otra-cuenta" });
          return ok(SESSION_WIRE);
        }),
        http.get(`${API}/sesiones/1`, () => {
          onCreatedNavigations.push(1);
          return ok(SESSION_WIRE);
        }),
      );
      const { queryClient } = await renderWizard();
      fillField(/^Nombre/, "Evaluación de prueba");
      fillField(/Hora de inicio/, "09:00");
      fillField(/Hora de fin/, "10:00");
      fireEvent.change(await screen.findByLabelText(/Instrumento \(test\)/), { target: { value: "1" } });
      fireEvent.click(await screen.findByRole("radio", { name: /Versión 1\.1/ }));
      fireEvent.click(screen.getByRole("button", { name: /crear sesión y continuar/i }));

      await waitFor(() => expect(useStaffAuth.getState().sessionId).toBe("otra-cuenta"));
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(screen.queryByText("Subtests de la versión")).not.toBeInTheDocument();
      expect(screen.queryByText(/creada como programada/)).not.toBeInTheDocument();
      expect(queryClient.getQueryData(["sessions", "detail", 1])).toBeUndefined();
      expect(onCreatedNavigations).toHaveLength(0);
    });
  });

  describe("paso Participantes sin PARTICIPANTE_LEER", () => {
    it("muestra el aviso, no consulta participantes y conserva «Terminar sin asignar»", async () => {
      setStaffPermissions([PERMISSIONS.SESION_CREAR, PERMISSIONS.SESION_APLICAR]);
      mockReadHandlers({
        assignments: [
          {
            assignmentId: 7,
            participantId: participantId(1),
            participantName: "Ana Prueba",
            status: "GENERADO",
            state: "no-iniciado",
            overallProgress: 0,
          },
        ],
      });
      let participantCalls = 0;
      server.use(
        http.get(`${API}/participantes`, () => {
          participantCalls += 1;
          return ok({ content: [], number: 0, size: 200, numberOfElements: 0, totalElements: 0, totalPages: 1, first: true, last: true });
        }),
      );
      await renderWizard({ sessionId: 1 });

      expect(await screen.findByText(/PARTICIPANTE_LEER/)).toBeInTheDocument();
      expect(screen.queryByLabelText("Buscar participante")).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /terminar sin asignar/i }));
      expect(await screen.findByText("Resumen de la sesión")).toBeInTheDocument();
      expect(participantCalls).toBe(0);
    });
  });

  describe("paso Participantes sin SESION_APLICAR", () => {
    it("avisa y permite terminar sin asignar", async () => {
      setStaffPermissions([PERMISSIONS.SESION_CREAR]);
      mockReadHandlers({
        assignments: [
          {
            assignmentId: 7,
            participantId: participantId(1),
            participantName: "Ana Prueba",
            status: "GENERADO",
            state: "no-iniciado",
            overallProgress: 0,
          },
        ],
      });
      await renderWizard({ sessionId: 1 });

      expect(await screen.findByText("No puede asignar participantes")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /terminar sin asignar/i }));
      expect(await screen.findByText("Resumen de la sesión")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /abrir sesión ahora/i })).not.toBeInTheDocument();
    });
  });
});

const SESSION_ABIERTA = {
  id: 1,
  versionTestId: 10,
  codigoSesion: "SES-2026-01",
  nombreSesion: "Evaluación Ingreso 2026",
  inicioProgramado: "2026-11-24T09:00:00",
  estado: "ABIERTA",
};
