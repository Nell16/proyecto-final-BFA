import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { delay, http } from "msw";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { server } from "../../../test/msw/server";
import { ADMIN_PERMISSIONS } from "../permissions";
import { AuditPage } from "../components/audit-page";
import {
  API,
  clearStaffUser,
  ok,
  renderWithProviders,
  serverError,
  setStaffUser,
} from "./testUtils";

const AUDIT_FIXTURE = [
  {
    id: 1001,
    usuario: {
      id: "11111111-1111-1111-1111-111111111111",
      nombreUsuario: "admin",
      nombreCompleto: "Administrador Principal",
    },
    accion: "USUARIO_CREADO",
    entidad: "usuario",
    entidadId: "42",
    valorAnterior: null,
    valorNuevo: "{\"username\":\"mlopez\"}",
    direccionIp: "127.0.0.1",
    agenteUsuario: "Mozilla/5.0",
    creadoEn: "2026-10-01T10:00:00",
  },
  {
    id: 1002,
    usuario: null,
    accion: "RESPALDO_GENERADO",
    entidad: "respaldo_exportacion",
    entidadId: "7",
    valorAnterior: null,
    valorNuevo: "{\"sizeBytes\":2048}",
    direccionIp: null,
    agenteUsuario: null,
    creadoEn: "2026-10-02T15:30:00",
  },
];

describe("AuditPage", () => {
  beforeEach(() => {
    setStaffUser({ permissions: [ADMIN_PERMISSIONS.AUDIT_READ] });
  });

  afterEach(() => {
    clearStaffUser();
  });

  it("muestra skeleton de carga, error con reintento y estado vacío", async () => {
    server.use(
      http.get(`${API}/auditoria`, async () => {
        await delay(80);
        return ok(AUDIT_FIXTURE);
      }),
    );

    const { container } = await renderWithProviders(<AuditPage />);
    expect(container.querySelectorAll("[data-slot='skeleton']").length).toBeGreaterThan(0);

    expect(await screen.findByText("USUARIO_CREADO")).toBeInTheDocument();

    // Error y reintento hacia estado vacío
    server.use(http.get(`${API}/auditoria`, () => serverError("Bitácora no disponible"), { once: true }));
    fireEvent.change(screen.getByLabelText("Entidad"), { target: { value: "usuario" } });
    fireEvent.change(screen.getByLabelText("ID de entidad"), { target: { value: "42" } });

    expect(await screen.findByText(/Bitácora no disponible/i)).toBeInTheDocument();

    server.use(http.get(`${API}/auditoria`, () => ok([])));
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Sin eventos para los filtros aplicados")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Limpiar filtros" })[0]!);
    expect(await screen.findByText("Sin registros de auditoría")).toBeInTheDocument();
  });

  it("envía filtros soportados al backend y filtra el resto en cliente", async () => {
    const requests: Array<{ entity: string | null; entityId: string | null }> = [];
    server.use(
      http.get(`${API}/auditoria`, ({ request }) => {
        const url = new URL(request.url);
        requests.push({
          entity: url.searchParams.get("entity"),
          entityId: url.searchParams.get("entityId"),
        });
        return ok(AUDIT_FIXTURE);
      }),
    );

    await renderWithProviders(<AuditPage />);
    expect(await screen.findByText("USUARIO_CREADO")).toBeInTheDocument();
    expect(screen.getByText("RESPALDO_GENERADO")).toBeInTheDocument();

    // Filtro local por búsqueda
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar en auditoría" }), {
      target: { value: "127.0.0.1" },
    });
    expect(screen.getByText("USUARIO_CREADO")).toBeInTheDocument();
    expect(screen.queryByText("RESPALDO_GENERADO")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Limpiar filtros" }));
    expect(screen.getByText("RESPALDO_GENERADO")).toBeInTheDocument();

    // Al llenar Entidad e ID de entidad se envían ambos al backend
    fireEvent.change(screen.getByLabelText("Entidad"), { target: { value: "usuario" } });
    fireEvent.change(screen.getByLabelText("ID de entidad"), { target: { value: "42" } });

    await waitFor(() =>
      expect(requests).toContainEqual({ entity: "usuario", entityId: "42" }),
    );
    expect(screen.getByText("USUARIO_CREADO")).toBeInTheDocument();
    expect(screen.queryByText("RESPALDO_GENERADO")).not.toBeInTheDocument();

    // Ver detalle del evento
    fireEvent.click(screen.getByRole("button", { name: "Ver detalle del evento 1001" }));
    const detailDialog = await screen.findByRole("dialog");
    expect(within(detailDialog).getByText("Detalle de evento #1001")).toBeInTheDocument();
    expect(within(detailDialog).getByText(/"username": "mlopez"/)).toBeInTheDocument();
  });
});
