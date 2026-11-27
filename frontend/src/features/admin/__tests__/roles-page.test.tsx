import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { http } from "msw";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { server } from "../../../test/msw/server";
import { ADMIN_PERMISSIONS } from "../permissions";
import { RolesPage } from "../components/roles-page";
import {
  API,
  clearStaffUser,
  ok,
  renderWithProviders,
  serverError,
  setStaffUser,
} from "./testUtils";

const ROLES_FIXTURE = [
  { id: 1, nombre: "ADMIN", descripcion: "Administrador" },
  { id: 2, nombre: "PSICOLOGO", descripcion: "Evaluador clínico" },
];

const PERMISSIONS_FIXTURE = [
  { id: 10, codigo: "USUARIO_LEER", descripcion: "Permite listar usuarios" },
  { id: 11, codigo: "USUARIO_CREAR", descripcion: "Permite crear usuarios" },
  { id: 12, codigo: "SESION_CREAR", descripcion: "Permite crear sesiones" },
];

describe("RolesPage", () => {
  beforeEach(() => {
    setStaffUser({
      permissions: [ADMIN_PERMISSIONS.ROLE_READ, ADMIN_PERMISSIONS.ROLE_UPDATE],
    });
    server.use(
      http.get(`${API}/roles`, () => ok(ROLES_FIXTURE)),
      http.get(`${API}/permissions`, () => ok(PERMISSIONS_FIXTURE)),
      http.get(`${API}/roles/1/permissions`, () => ok(PERMISSIONS_FIXTURE)),
      http.get(`${API}/roles/2/permissions`, () => ok([PERMISSIONS_FIXTURE[2]])),
    );
  });

  afterEach(() => {
    clearStaffUser();
  });

  it("muestra la matriz en modo solo lectura si no tiene ROL_MODIFICAR", async () => {
    setStaffUser({ permissions: [ADMIN_PERMISSIONS.ROLE_READ] });
    await renderWithProviders(<RolesPage />, { initialPath: "/app/roles" });

    expect(await screen.findByText("Modo solo lectura")).toBeInTheDocument();
    const checkbox = await screen.findByRole("checkbox", { name: "USUARIO_LEER para PSICOLOGO" });
    expect(checkbox).toBeDisabled();
    expect(screen.queryByRole("button", { name: /guardar cambios/i })).not.toBeInTheDocument();
  });

  it("edita la matriz con indicador de cambios sin guardar y guardado explícito vía PUT", async () => {
    const putCalls: Array<{ roleId: number; permissionIds: number[] }> = [];
    let role2Perms = [PERMISSIONS_FIXTURE[2]];

    server.use(
      http.get(`${API}/roles/2/permissions`, () => ok(role2Perms)),
      http.put(`${API}/roles/:id/permissions`, async ({ params, request }) => {
        const body = (await request.json()) as { permissionIds: number[] };
        putCalls.push({ roleId: Number(params.id), permissionIds: body.permissionIds });
        if (Number(params.id) === 2) {
          role2Perms = PERMISSIONS_FIXTURE.filter((p) => body.permissionIds.includes(p.id));
        }
        return ok(null);
      }),
    );

    await renderWithProviders(<RolesPage />, { initialPath: "/app/roles" });

    const targetCheckbox = await screen.findByRole("checkbox", { name: "USUARIO_LEER para PSICOLOGO" });
    expect(targetCheckbox).not.toBeChecked();
    expect(screen.queryByTestId("unsaved-changes-badge")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /guardar cambios/i })).toBeDisabled();

    // Toggling no guarda automáticamente, pero muestra indicador de cambios sin guardar
    fireEvent.click(targetCheckbox);
    expect(targetCheckbox).toBeChecked();
    expect(putCalls).toHaveLength(0);
    expect(screen.getByTestId("unsaved-changes-badge")).toHaveTextContent(/cambios sin guardar \(1 rol\)/i);
    expect(screen.getByRole("button", { name: /guardar cambios/i })).toBeEnabled();

    // Guardar explícito
    fireEvent.click(screen.getByRole("button", { name: /guardar cambios/i }));
    await waitFor(() => expect(putCalls).toHaveLength(1));
    expect(putCalls[0]?.roleId).toBe(2);
    expect(putCalls[0]?.permissionIds.sort((a, b) => a - b)).toEqual([10, 12]);

    await waitFor(() => expect(screen.queryByTestId("unsaved-changes-badge")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /guardar cambios/i })).toBeDisabled();
  });

  it("pide confirmación al salir si hay cambios sin guardar y permite quedarse o salir", async () => {
    const { router } = await renderWithProviders(<RolesPage />, {
      initialPath: "/app/roles",
      extraRoutes: [{ path: "/app/usuarios", render: () => <div>Pantalla Usuarios</div> }],
    });

    const targetCheckbox = await screen.findByRole("checkbox", { name: "USUARIO_CREAR para PSICOLOGO" });
    fireEvent.click(targetCheckbox);
    expect(screen.getByTestId("unsaved-changes-badge")).toBeInTheDocument();

    // Intentar navegar fuera de la ruta
    void router.navigate({ to: "/app/usuarios" });

    const confirmDialog = await screen.findByRole("alertdialog");
    expect(within(confirmDialog).getByText("¿Salir sin guardar los cambios?")).toBeInTheDocument();

    // Seguir editando mantiene en /app/roles
    fireEvent.click(within(confirmDialog).getByRole("button", { name: "Seguir editando" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(screen.queryByText("Pantalla Usuarios")).not.toBeInTheDocument();
    expect(targetCheckbox).toBeChecked();

    // Salir sin guardar procede a /app/usuarios
    void router.navigate({ to: "/app/usuarios" });
    const secondDialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(secondDialog).getByRole("button", { name: "Salir sin guardar" }));
    expect(await screen.findByText("Pantalla Usuarios")).toBeInTheDocument();
  });

  it("muestra estados de error con reintento y estado vacío", async () => {
    server.use(http.get(`${API}/roles`, () => serverError("Error cargando roles"), { once: true }));

    await renderWithProviders(<RolesPage />, { initialPath: "/app/roles" });
    expect(await screen.findByText(/Error cargando roles/i)).toBeInTheDocument();

    server.use(http.get(`${API}/roles`, () => ok([])));
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Matriz sin datos")).toBeInTheDocument();
  });
});
