import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { http } from "msw";
import { fireEvent, screen, within } from "@testing-library/react";

import { PERMISSIONS } from "../../../../store/permissions";
import { server } from "../../../../test/msw/server";
import assignmentsFixture from "../../../../api/schemas/__fixtures__/sessions/assignments.json";
import sessionsFixture from "../../../../api/schemas/__fixtures__/sessions/sessions.json";
import { SessionMonitorTab } from "../SessionMonitorTab";
import { API, clearStaffUser, ok, renderWithProviders, setStaffPermissions } from "./testUtils";

const kpi = (key: string) => document.querySelector(`[data-kpi="${key}"]`) as HTMLElement;

describe("SessionMonitorTab", () => {
  beforeEach(() => {
    setStaffPermissions([
      PERMISSIONS.SESION_APLICAR,
      PERMISSIONS.RESULTADO_VER,
      PERMISSIONS.CALIFICACION_EJECUTAR,
    ]);
    server.use(
      http.get(`${API}/sesiones/1`, () => ok(sessionsFixture[0])),
      http.get(`${API}/sesiones/1/asignaciones`, () => ok(assignmentsFixture)),
    );
  });
  afterEach(() => clearStaffUser());

  it("deriva los KPIs de las asignaciones del fixture", async () => {
    await renderWithProviders(<SessionMonitorTab sessionId={1} />);

    // Espera a que carguen las filas (3 asignaciones del fixture).
    expect(await screen.findByText("Ana López")).toBeInTheDocument();

    expect(within(kpi("assigned")).getByText("3")).toBeInTheDocument();
    expect(within(kpi("inProgress")).getByText("1")).toBeInTheDocument();
    expect(within(kpi("completed")).getByText("1")).toBeInTheDocument();
    expect(within(kpi("interrupted")).getByText("0")).toBeInTheDocument();
    expect(within(kpi("notStarted")).getByText("1")).toBeInTheDocument();
  });

  it("muestra el estado del intento mapeado al enum y las acciones por fila", async () => {
    await renderWithProviders(<SessionMonitorTab sessionId={1} />);
    await screen.findByText("Carlos Ruiz");

    const carlosRow = screen.getByText("Carlos Ruiz").closest("tr") as HTMLElement;
    expect(within(carlosRow).getByText("En progreso", { selector: "span" })).toBeInTheDocument();
    expect(within(carlosRow).getByRole("link", { name: /ver respuestas de carlos ruiz/i })).toHaveAttribute(
      "href",
      "/app/resultados/intento/9002".replace("9002", "9001"),
    );
    // Sin completar: no hay "Calificar"
    expect(within(carlosRow).queryByRole("link", { name: /calificar/i })).not.toBeInTheDocument();

    const mariaRow = screen.getByText("María Pérez").closest("tr") as HTMLElement;
    expect(within(mariaRow).getByRole("link", { name: /calificar a maría pérez/i })).toHaveAttribute(
      "href",
      "/app/calificaciones?sessionId=1&attemptId=9002", // el monitor conoce la sesión y la envía junto al intento
    );

    // Sin intento: no hay "Ver respuestas"
    const anaRow = screen.getByText("Ana López").closest("tr") as HTMLElement;
    expect(within(anaRow).queryByRole("link", { name: /ver respuestas/i })).not.toBeInTheDocument();
  });

  it("oculta 'Nota' sin SESION_APLICAR", async () => {
    setStaffPermissions([PERMISSIONS.SESION_CREAR]);
    await renderWithProviders(<SessionMonitorTab sessionId={1} />);
    await screen.findByText("Ana López");
    expect(screen.queryByRole("button", { name: /agregar nota/i })).not.toBeInTheDocument();
  });

  it("muestra resumen e indicador por intento cuando hay respuestas rechazadas (B17) y abre el detalle", async () => {
    server.use(
      http.get(`${API}/sesiones/1/asignaciones`, () =>
        ok([
          assignmentsFixture[0],
          {
            ...assignmentsFixture[1],
            rejectedAnswersCount: 2,
            rejectedAnswers: [
              { itemId: 1002, code: "TIEMPO_AGOTADO", rejectedAt: "2026-11-24T14:21:00" },
              { itemId: 1004, code: "SUBTEST_FINALIZADO", rejectedAt: "2026-11-24T14:22:00" },
            ],
          },
          {
            ...assignmentsFixture[2],
            rejectedAnswersCount: 1,
          },
        ]),
      ),
    );

    await renderWithProviders(<SessionMonitorTab sessionId={1} />);
    await screen.findByText("Carlos Ruiz");

    expect(screen.getByText(/3 respuestas rechazadas/i)).toBeInTheDocument();

    const carlosRow = screen.getByText("Carlos Ruiz").closest("tr") as HTMLElement;
    const rejectBtn = within(carlosRow).getByRole("button", {
      name: /Ver 2 respuestas rechazadas de Carlos Ruiz/i,
    });
    fireEvent.click(rejectBtn);

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Respuestas rechazadas de Carlos Ruiz");
    expect(dialog).toHaveTextContent("Ítem #1002");
    expect(dialog).toHaveTextContent("TIEMPO_AGOTADO");
    expect(dialog).toHaveTextContent("Ítem #1004");
    expect(dialog).toHaveTextContent("SUBTEST_FINALIZADO");
  });
});
