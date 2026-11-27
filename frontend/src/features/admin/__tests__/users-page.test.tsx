import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { http } from "msw";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useStaffAuth } from "../../../store/staffAuth";
import { containsText } from "../../../test/collectStrings";
import { server } from "../../../test/msw/server";
import { ADMIN_PERMISSIONS } from "../permissions";
import { UsersPage } from "../components/users-page";
import {
  API,
  clearStaffUser,
  ok,
  renderWithProviders,
  serverError,
  setStaffUser,
} from "./testUtils";

const ADMIN_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_ID = "22222222-2222-2222-2222-222222222222";
const THIRD_ID = "33333333-3333-3333-3333-333333333333";

const ROLES_FIXTURE = [
  { id: 1, nombre: "ADMIN", descripcion: "Administrador del sistema" },
  { id: 2, nombre: "PSICOLOGO", descripcion: "Evaluador clínico" },
  { id: 3, nombre: "APLICADOR", descripcion: "Aplicador de laboratorio" },
];

const MATRIX_FIXTURE = {
  permissionColumns: ["USUARIO_LEER", "USUARIO_CREAR", "USUARIO_MODIFICAR"],
  users: [
    {
      userId: ADMIN_ID,
      username: "admin",
      email: "admin@uam.edu.ni",
      fullName: "Administrador Principal",
      status: "ACTIVO",
      roles: ["ADMIN", "PSICOLOGO"],
      permissions: ["USUARIO_LEER", "USUARIO_CREAR", "USUARIO_MODIFICAR"],
      matrix: { USUARIO_LEER: true, USUARIO_CREAR: true, USUARIO_MODIFICAR: true },
    },
    {
      userId: OTHER_ID,
      username: "aplicador1",
      email: "aplicador1@uam.edu.ni",
      fullName: "Ana García",
      status: "ACTIVO",
      roles: ["APLICADOR"],
      permissions: [],
      matrix: { USUARIO_LEER: false, USUARIO_CREAR: false, USUARIO_MODIFICAR: false },
    },
    {
      userId: THIRD_ID,
      username: "inactivo1",
      email: "inactivo1@uam.edu.ni",
      fullName: "Carlos Ruiz",
      status: "INACTIVO",
      roles: [],
      permissions: [],
      matrix: { USUARIO_LEER: false, USUARIO_CREAR: false, USUARIO_MODIFICAR: false },
    },
  ],
};

const ALL_PERMS = [
  ADMIN_PERMISSIONS.USER_READ,
  ADMIN_PERMISSIONS.USER_CREATE,
  ADMIN_PERMISSIONS.USER_UPDATE,
  ADMIN_PERMISSIONS.ROLE_READ,
];

describe("UsersPage", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    setStaffUser({ id: ADMIN_ID, username: "admin", roles: ["ADMIN"], permissions: ALL_PERMS });
    server.use(
      http.get(`${API}/users/permission-matrix`, () => ok(MATRIX_FIXTURE)),
      http.get(`${API}/roles`, () => ok(ROLES_FIXTURE)),
    );
  });

  afterEach(() => {
    clearStaffUser();
  });

  it("oculta creación y acciones de modificación si solo tiene USUARIO_LEER", async () => {
    let rolesCalled = false;
    server.use(
      http.get(`${API}/roles`, () => {
        rolesCalled = true;
        return ok(ROLES_FIXTURE);
      }),
    );
    setStaffUser({ id: ADMIN_ID, username: "viewer", permissions: [ADMIN_PERMISSIONS.USER_READ] });

    await renderWithProviders(<UsersPage />);

    expect(await screen.findByText("Administrador Principal")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /nuevo usuario/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /gestionar roles/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /desactivar usuario/i })).not.toBeInTheDocument();
    expect(rolesCalled).toBe(false);
  });

  it("deshabilita gestión de roles cuando tiene USUARIO_MODIFICAR pero no ROL_LEER", async () => {
    setStaffUser({
      id: ADMIN_ID,
      username: "admin",
      permissions: [ADMIN_PERMISSIONS.USER_READ, ADMIN_PERMISSIONS.USER_UPDATE],
    });
    await renderWithProviders(<UsersPage />);

    expect(await screen.findByText("Ana García")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Gestionar roles de aplicador1" })).toBeDisabled();
  });

  it("filtra localmente por búsqueda, estado y rol", async () => {
    await renderWithProviders(<UsersPage />);
    expect(await screen.findByText("Ana García")).toBeInTheDocument();
    expect(screen.getByText("Carlos Ruiz")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar usuarios" }), {
      target: { value: "Ana" },
    });
    expect(screen.getByText("Ana García")).toBeInTheDocument();
    expect(screen.queryByText("Carlos Ruiz")).not.toBeInTheDocument();
    expect(screen.queryByText("Administrador Principal")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Limpiar filtros" }));
    expect(screen.getByText("Carlos Ruiz")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("combobox", { name: "Filtrar por estado" }));
    fireEvent.click(await screen.findByRole("option", { name: "Inactivos" }));
    expect(screen.getByText("Carlos Ruiz")).toBeInTheDocument();
    expect(screen.queryByText("Ana García")).not.toBeInTheDocument();
  });

  it("valida campos, fortaleza de contraseña y confirmación al crear usuario sin guardar la clave", async () => {
    let postBody: Record<string, unknown> | null = null;
    let roleAssigned: { userId: string; roleId: number } | null = null;

    server.use(
      http.post(`${API}/users`, async ({ request }) => {
        postBody = (await request.json()) as Record<string, unknown>;
        return ok({
          id: "44444444-4444-4444-4444-444444444444",
          username: postBody.username,
          email: postBody.email,
          fullName: postBody.fullName,
          status: "ACTIVO",
        });
      }),
      http.post(`${API}/users/:id/roles`, async ({ params, request }) => {
        const body = (await request.json()) as { roleId: number };
        roleAssigned = { userId: String(params.id), roleId: body.roleId };
        return ok(null);
      }),
    );

    const { queryClient } = await renderWithProviders(<UsersPage />);
    await screen.findByText("Ana García");

    fireEvent.click(screen.getByRole("button", { name: /nuevo usuario/i }));
    const dialog = await screen.findByRole("dialog");

    // Envío vacío -> errores inline
    fireEvent.click(within(dialog).getByRole("button", { name: /registrar usuario/i }));
    expect(await within(dialog).findByText("El nombre completo es requerido.")).toBeInTheDocument();
    expect(within(dialog).getByText("El nombre de usuario es requerido.")).toBeInTheDocument();
    expect(within(dialog).getByText("El correo electrónico es requerido.")).toBeInTheDocument();
    expect(within(dialog).getByText("La contraseña debe tener al menos 8 caracteres.")).toBeInTheDocument();
    expect(postBody).toBeNull();

    // Contraseña débil + confirmación distinta
    fireEvent.change(within(dialog).getByLabelText(/nombre completo/i), { target: { value: "Laura Mendoza" } });
    fireEvent.change(within(dialog).getByLabelText(/nombre de usuario/i), { target: { value: "lmendoza" } });
    fireEvent.change(within(dialog).getByLabelText(/correo electrónico/i), {
      target: { value: "lmendoza@uam.edu.ni" },
    });
    fireEvent.change(within(dialog).getByLabelText(/^contraseña inicial/i), { target: { value: "weak" } });
    fireEvent.change(within(dialog).getByLabelText(/confirmar contraseña/i), { target: { value: "other" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /registrar usuario/i }));

    expect(await within(dialog).findByText("La contraseña debe tener al menos 8 caracteres.")).toBeInTheDocument();
    expect(within(dialog).getByText("Las contraseñas no coinciden.")).toBeInTheDocument();
    expect(postBody).toBeNull();

    // Contraseña fuerte sin símbolo -> falla regla especial
    fireEvent.change(within(dialog).getByLabelText(/^contraseña inicial/i), { target: { value: "Clave1234" } });
    fireEvent.change(within(dialog).getByLabelText(/confirmar contraseña/i), { target: { value: "Clave1234" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /registrar usuario/i }));
    expect(await within(dialog).findByText("Incluye al menos un carácter especial.")).toBeInTheDocument();
    expect(postBody).toBeNull();

    // Contraseña fuerte + confirmación válida + rol inicial
    fireEvent.click(within(dialog).getByRole("combobox", { name: /rol inicial/i }));
    fireEvent.click(await screen.findByRole("option", { name: "PSICOLOGO" }));
    fireEvent.change(within(dialog).getByLabelText(/^contraseña inicial/i), { target: { value: "Segura2026!" } });
    fireEvent.change(within(dialog).getByLabelText(/confirmar contraseña/i), { target: { value: "Segura2026!" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /registrar usuario/i }));

    await waitFor(() => expect(postBody).not.toBeNull());
    expect(postBody).toEqual({
      username: "lmendoza",
      email: "lmendoza@uam.edu.ni",
      fullName: "Laura Mendoza",
      password: "Segura2026!",
    });
    await waitFor(() => expect(roleAssigned).toEqual({ userId: "44444444-4444-4444-4444-444444444444", roleId: 2 }));

    // La contraseña nunca se guarda en storage ni permanece en MutationCache
    expect(JSON.stringify(localStorage)).not.toContain("Segura2026!");
    expect(JSON.stringify(sessionStorage)).not.toContain("Segura2026!");
    expect(JSON.stringify(queryClient.getMutationCache().getAll())).not.toContain("Segura2026!");
  });

  it("impide que el usuario actual se desactive o se quite su propio rol de administrador", async () => {
    let statusPatchCalls = 0;
    let roleDeleteCalls = 0;
    const assignedRoleCalls: number[] = [];
    const removedRoleCalls: number[] = [];

    server.use(
      http.patch(`${API}/users/${ADMIN_ID}/status`, () => {
        statusPatchCalls += 1;
        return ok({ ...MATRIX_FIXTURE.users[0], id: ADMIN_ID, status: "INACTIVO" });
      }),
      http.delete(`${API}/users/${ADMIN_ID}/roles/:roleId`, ({ params }) => {
        roleDeleteCalls += 1;
        removedRoleCalls.push(Number(params.roleId));
        return ok(null);
      }),
      http.post(`${API}/users/${ADMIN_ID}/roles`, async ({ request }) => {
        const body = (await request.json()) as { roleId: number };
        assignedRoleCalls.push(body.roleId);
        return ok(null);
      }),
    );

    await renderWithProviders(<UsersPage />);
    await screen.findByText("Administrador Principal");

    // Intentar desactivarse a sí mismo -> muestra aviso, no abre confirm ni llama backend
    fireEvent.click(screen.getByRole("button", { name: "Desactivar usuario admin" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/no puedes desactivar tu propia cuenta/i);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(statusPatchCalls).toBe(0);

    // Intentar quitarse su propio rol ADMIN -> muestra aviso, no llama backend
    fireEvent.click(screen.getByRole("button", { name: "Gestionar roles de admin" }));
    const rolesDialog = await screen.findByRole("dialog");
    const adminCheckbox = within(rolesDialog).getByRole("checkbox", { name: "Rol ADMIN para admin" });
    expect(adminCheckbox).toBeChecked();

    fireEvent.click(adminCheckbox);
    expect(await within(rolesDialog).findByRole("alert")).toHaveTextContent(
      /no puedes quitarte tu propio rol de administrador/i,
    );
    expect(adminCheckbox).toBeChecked();
    expect(roleDeleteCalls).toBe(0);

    // Sí puede quitarse un rol no-admin (PSICOLOGO) o asignarse otro (APLICADOR)
    const psicologoCheckbox = within(rolesDialog).getByRole("checkbox", { name: "Rol PSICOLOGO para admin" });
    fireEvent.click(psicologoCheckbox);
    await waitFor(() => expect(removedRoleCalls).toEqual([2]));

    const aplicadorCheckbox = within(rolesDialog).getByRole("checkbox", { name: "Rol APLICADOR para admin" });
    fireEvent.click(aplicadorCheckbox);
    await waitFor(() => expect(assignedRoleCalls).toEqual([3]));
  });

  it("desactivar otro usuario exige ConfirmDialog y no usa alert/confirm nativos", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const confirmSpy = vi.spyOn(window, "confirm").mockImplementation(() => true);
    let patchedStatus: string | null = null;

    server.use(
      http.patch(`${API}/users/${OTHER_ID}/status`, async ({ request }) => {
        const body = (await request.json()) as { status: string };
        patchedStatus = body.status;
        return ok({
          id: OTHER_ID,
          username: "aplicador1",
          email: "aplicador1@uam.edu.ni",
          fullName: "Ana García",
          status: body.status,
        });
      }),
    );

    await renderWithProviders(<UsersPage />);
    await screen.findByText("Ana García");

    fireEvent.click(screen.getByRole("button", { name: "Desactivar usuario aplicador1" }));
    const confirmDialog = await screen.findByRole("alertdialog");
    expect(within(confirmDialog).getByText(/¿Desactivar usuario\?/)).toBeInTheDocument();

    fireEvent.click(within(confirmDialog).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(patchedStatus).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Desactivar usuario aplicador1" }));
    const confirmSecond = await screen.findByRole("alertdialog");
    fireEvent.click(within(confirmSecond).getByRole("button", { name: "Desactivar" }));
    await waitFor(() => expect(patchedStatus).toBe("INACTIVO"));

    expect(alertSpy).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
    confirmSpy.mockRestore();
  });

  it("muestra estado de error con Reintentar y estado vacío cuando no hay usuarios", async () => {
    server.use(http.get(`${API}/users/permission-matrix`, () => serverError("Fallo temporal"), { once: true }));

    await renderWithProviders(<UsersPage />);
    expect(await screen.findByText(/Fallo temporal/i)).toBeInTheDocument();

    server.use(
      http.get(`${API}/users/permission-matrix`, () =>
        ok({ permissionColumns: [], users: [] }),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Sin usuarios registrados")).toBeInTheDocument();
  });

  describe("alta de usuario con varios pasos", () => {
    const NEW_USER = {
      id: "44444444-4444-4444-4444-444444444444",
      username: "lmendoza",
      email: "lmendoza@uam.edu.ni",
      fullName: "Laura Mendoza",
      status: "ACTIVO",
    };
    const PASSWORD = "Segura2026!";

    async function openAndFillForm(withRole: boolean) {
      fireEvent.click(screen.getByRole("button", { name: /nuevo usuario/i }));
      const dialog = await screen.findByRole("dialog");
      fireEvent.change(within(dialog).getByLabelText(/nombre completo/i), { target: { value: "Laura Mendoza" } });
      fireEvent.change(within(dialog).getByLabelText(/nombre de usuario/i), { target: { value: "lmendoza" } });
      fireEvent.change(within(dialog).getByLabelText(/correo electrónico/i), {
        target: { value: "lmendoza@uam.edu.ni" },
      });
      if (withRole) {
        fireEvent.click(within(dialog).getByRole("combobox", { name: /rol inicial/i }));
        fireEvent.click(await screen.findByRole("option", { name: "PSICOLOGO" }));
      }
      fireEvent.change(within(dialog).getByLabelText(/^contraseña inicial/i), { target: { value: PASSWORD } });
      fireEvent.change(within(dialog).getByLabelText(/confirmar contraseña/i), { target: { value: PASSWORD } });
      return dialog;
    }

    it("HALLAZGO ALTO: si la cuenta cambia con POST /users pendiente, el rol NO se asigna con el JWT de la cuenta nueva", async () => {
      setStaffUser({ id: ADMIN_ID, username: "admin", roles: ["ADMIN"], permissions: ALL_PERMS, token: "token-a" });
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let createStarted = false;
      const roleRequests: { auth: string | null; userId: string }[] = [];
      server.use(
        http.post(`${API}/users`, async () => {
          createStarted = true;
          await gate;
          return ok(NEW_USER);
        }),
        http.post(`${API}/users/:id/roles`, ({ params, request }) => {
          roleRequests.push({ auth: request.headers.get("authorization"), userId: String(params.id) });
          return ok(null);
        }),
      );

      await renderWithProviders(<UsersPage />);
      await screen.findByText("Ana García");
      const dialog = await openAndFillForm(true);
      fireEvent.click(within(dialog).getByRole("button", { name: /registrar usuario/i }));
      await waitFor(() => expect(createStarted).toBe(true));

      // La cuenta B inicia sesión mientras el alta de A sigue en vuelo.
      act(() => {
        useStaffAuth.getState().setSession({
          token: "token-b",
          expiresAt: null,
          user: { id: OTHER_ID, username: "adminB", roles: ["ADMIN"], permissions: ALL_PERMS },
        });
      });
      await act(async () => {
        release();
        await new Promise((resolve) => setTimeout(resolve, 80));
      });

      expect(roleRequests).toEqual([]); // ni con el JWT de B ni con ningún otro
      expect(screen.queryByText(/registrado\./i)).not.toBeInTheDocument();
      expect(screen.queryByText(/no se pudo asignar el rol inicial/i)).not.toBeInTheDocument();
    });

    it("con la cuenta estable, el rol inicial se asigna con el mismo JWT del alta y se informa el resultado", async () => {
      setStaffUser({ id: ADMIN_ID, username: "admin", roles: ["ADMIN"], permissions: ALL_PERMS, token: "token-a" });
      const auths: Record<string, string | null> = {};
      server.use(
        http.post(`${API}/users`, ({ request }) => {
          auths.create = request.headers.get("authorization");
          return ok(NEW_USER);
        }),
        http.post(`${API}/users/:id/roles`, ({ request }) => {
          auths.role = request.headers.get("authorization");
          return ok(null);
        }),
      );

      await renderWithProviders(<UsersPage />);
      await screen.findByText("Ana García");
      const dialog = await openAndFillForm(true);
      fireEvent.click(within(dialog).getByRole("button", { name: /registrar usuario/i }));

      expect(await screen.findByText(/Laura Mendoza \(@lmendoza\) registrado\./)).toBeInTheDocument();
      expect(auths).toEqual({ create: "Bearer token-a", role: "Bearer token-a" });
    });

    it("HALLAZGO MEDIO: la contraseña no está en MutationCache mientras el alta está en vuelo ni al terminar (éxito)", async () => {
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let createStarted = false;
      server.use(
        http.post(`${API}/users`, async () => {
          createStarted = true;
          await gate;
          return ok(NEW_USER);
        }),
      );

      const { queryClient } = await renderWithProviders(<UsersPage />);
      await screen.findByText("Ana García");
      const dialog = await openAndFillForm(false);
      fireEvent.click(within(dialog).getByRole("button", { name: /registrar usuario/i }));
      await waitFor(() => expect(createStarted).toBe(true));

      expect(queryClient.getMutationCache().getAll().length).toBeGreaterThan(0);
      expect(containsText(queryClient.getMutationCache().getAll(), PASSWORD)).toBe(false); // EN VUELO

      await act(async () => {
        release();
      });
      expect(await screen.findByText(/registrado\./)).toBeInTheDocument();
      await waitFor(() => expect(queryClient.getMutationCache().getAll()).toHaveLength(0));
      expect(containsText(queryClient.getMutationCache().getAll(), PASSWORD)).toBe(false);
    });

    it("HALLAZGO MEDIO: tras un 500 la contraseña tampoco queda en MutationCache y el diálogo permite reintentar", async () => {
      server.use(http.post(`${API}/users`, () => serverError("Fallo al crear")));

      const { queryClient } = await renderWithProviders(<UsersPage />);
      await screen.findByText("Ana García");
      const dialog = await openAndFillForm(false);
      fireEvent.click(within(dialog).getByRole("button", { name: /registrar usuario/i }));

      expect(await screen.findByText(/Fallo al crear/)).toBeInTheDocument();
      await waitFor(() => expect(queryClient.getMutationCache().getAll()).toHaveLength(0));
      expect(containsText(queryClient.getMutationCache().getAll(), PASSWORD)).toBe(false);
      expect(screen.getByRole("dialog")).toBeInTheDocument(); // sigue abierto para corregir
    });
  });
});
