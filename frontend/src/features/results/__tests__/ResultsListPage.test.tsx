import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { http } from "msw";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";

import { server } from "../../../test/msw/server";
import { ResultsListPage } from "../list/ResultsListPage";
import type { SessionSearch } from "../gradingSearch";
import {
  ALL_RESULT_PERMISSIONS,
  API,
  assignmentWire,
  clearStaff,
  fail,
  ok,
  renderWithProviders,
  setPermissions,
  useBaseHandlers,
} from "./testSupport";

function Harness({ initial = {} }: { initial?: SessionSearch }) {
  const [search, setSearch] = useState(initial);
  return <ResultsListPage search={search} onSessionChange={(sessionId) => setSearch(sessionId === undefined ? {} : { sessionId })} />;
}

afterEach(() => clearStaff());

const rowOf = (name: string) => screen.getByText(name).closest("tr") as HTMLElement;

describe("ResultsListPage", () => {
  it("lista los intentos de todas las sesiones con su sesión y acciones según permisos", async () => {
    setPermissions(ALL_RESULT_PERMISSIONS);
    useBaseHandlers();
    await renderWithProviders(<Harness />);

    await screen.findByText("Elena Soto");
    expect(screen.getByText("Ana López")).toBeInTheDocument();
    expect(within(rowOf("Elena Soto")).getByText("Cohorte B")).toBeInTheDocument();
    await waitFor(() => expect(within(rowOf("Ana López")).getByRole("link", { name: /ver baremo de ana/i })).toBeInTheDocument());
    // Sin resultado: «Calificar» enlaza a la pantalla de calificación con sesión e intento.
    const grade = within(rowOf("Bruno Díaz")).getByRole("link", { name: /calificar a bruno/i });
    expect(grade.getAttribute("href")).toContain("sessionId=1");
    expect(grade.getAttribute("href")).toContain("attemptId=9002");
  });

  it("un consultor con solo RESULTADO_VER y SESION_APLICAR no ve Calificar; sin RESULTADO_VER no ve enlaces a resultados", async () => {
    setPermissions(["SESION_APLICAR", "RESULTADO_VER"]);
    useBaseHandlers();
    const first = await renderWithProviders(<Harness initial={{ sessionId: 1 }} />);
    await screen.findByText("Bruno Díaz");
    expect(screen.queryByRole("link", { name: /calificar a/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /ver respuestas de/i }).length).toBeGreaterThan(0);
    first.unmount();

    setPermissions(["SESION_APLICAR"]);
    await renderWithProviders(<Harness initial={{ sessionId: 1 }} />);
    await screen.findByText("Bruno Díaz");
    expect(screen.queryByRole("link", { name: /respuestas|baremo|calificar/i })).not.toBeInTheDocument();
  });

  it("sin SESION_LEER explica que el listado no está disponible (B14) y no consulta sesiones", async () => {
    setPermissions(["RESULTADO_VER"]);
    await renderWithProviders(<Harness />);
    expect(await screen.findByText(/listado de intentos no disponible para tu rol/i)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("filtro sin coincidencias muestra «Sin resultados para este filtro» y Limpiar filtros lo revierte", async () => {
    setPermissions(ALL_RESULT_PERMISSIONS);
    useBaseHandlers();
    await renderWithProviders(<Harness />);
    await screen.findByText("Elena Soto");

    fireEvent.change(screen.getByLabelText("Buscar participante"), { target: { value: "zzzz" } });
    expect(await screen.findByText("Sin resultados para este filtro")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Limpiar filtros" })[0]);
    expect(await screen.findByText("Elena Soto")).toBeInTheDocument();
  });

  it("filtra por estado y por calificación sobre la fuente", async () => {
    setPermissions(ALL_RESULT_PERMISSIONS);
    useBaseHandlers();
    await renderWithProviders(<Harness />);
    await screen.findByText("Elena Soto");

    fireEvent.change(screen.getByLabelText("Filtrar por estado"), { target: { value: "EN_PROGRESO" } });
    await screen.findByText("Carla Ruiz");
    expect(screen.queryByText("Ana López")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Filtrar por estado"), { target: { value: "ALL" } });
    fireEvent.change(screen.getByLabelText("Filtrar por calificación"), { target: { value: "SCORED" } });
    await screen.findByText("Ana López");
    await waitFor(() => expect(screen.queryByText("Bruno Díaz")).not.toBeInTheDocument());
  });

  it("sin intentos en absoluto: estado vacío; con error: Reintentar", async () => {
    setPermissions(ALL_RESULT_PERMISSIONS);
    let broken = true;
    server.use(
      http.get(`${API}/sesiones`, () => (broken ? fail(500, "No hay conexión con el servidor") : ok([]))),
    );
    await renderWithProviders(<Harness />);
    expect(await screen.findByText("No se pudo cargar la lista de sesiones")).toBeInTheDocument();
    broken = false;
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Sin intentos aún")).toBeInTheDocument();
  });

  it("error al cargar los intentos de una sesión: alerta con Reintentar", async () => {
    setPermissions(ALL_RESULT_PERMISSIONS);
    useBaseHandlers();
    let broken = true;
    server.use(
      http.get(`${API}/sesiones/1/asignaciones`, () => (broken ? fail(500, "Error al listar asignaciones") : ok([assignmentWire(1, 9001, "Ana López")]))),
    );
    await renderWithProviders(<Harness initial={{ sessionId: 1 }} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/error al listar asignaciones/i);
    broken = false;
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Ana López")).toBeInTheDocument();
  });
});
