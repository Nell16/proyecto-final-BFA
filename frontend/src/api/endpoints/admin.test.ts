import { beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { useStaffAuth } from "../../store/staffAuth";
import { ApiError } from "../errors";
import {
  assignRole,
  createUser,
  getPermissionMatrix,
  getRolePermissions,
  listAudit,
  listNotifications,
  listPermissions,
  listRoles,
  listUsers,
  removeRole,
  search,
  setRolePermissions,
  setUserStatus,
} from "./admin";
import usersFixture from "../schemas/__fixtures__/admin/users.json";
import permissionMatrixFixture from "../schemas/__fixtures__/admin/permission-matrix.json";
import auditFixture from "../schemas/__fixtures__/admin/audit.json";
import rolesFixture from "../schemas/__fixtures__/admin/roles.json";
import permissionsFixture from "../schemas/__fixtures__/admin/permissions.json";

const API = "http://localhost:8080";

beforeEach(() => {
  useStaffAuth.getState().setSession({
    token: "staff-jwt",
    expiresAt: null,
    user: { id: "u1", username: "admin", roles: ["ADMIN"], permissions: ["USUARIO_LEER"] },
  });
});

describe("admin endpoints", () => {
  it("listUsers parses fixture and tolerates unknown fields", async () => {
    server.use(
      http.get(`${API}/users`, () =>
        HttpResponse.json({
          success: true,
          data: [
            { ...usersFixture[0], extraField: "ok" },
            { ...usersFixture[1], status: "OTRO_ESTADO" },
          ],
        }),
      ),
    );

    const users = await listUsers();

    expect(users).toHaveLength(2);
    expect(users[0]?.username).toBe("admin");
    expect(users[1]?.status).toBe("DESCONOCIDO");
  });

  it("getPermissionMatrix parses fixture and tolerates unknown fields", async () => {
    server.use(
      http.get(`${API}/users/permission-matrix`, () =>
        HttpResponse.json({
          success: true,
          data: { ...permissionMatrixFixture, extra: true },
        }),
      ),
    );

    const matrix = await getPermissionMatrix();

    expect(matrix.permissionColumns).toContain("USUARIO_LEER");
    expect(matrix.users[0]?.matrix["USUARIO_CREAR"]).toBe(true);
  });

  it("listAudit parses fixture with optional params and nullable usuario", async () => {
    let seenEntity: string | null = null;
    server.use(
      http.get(`${API}/auditoria`, ({ request }) => {
        seenEntity = new URL(request.url).searchParams.get("entity");
        return HttpResponse.json({
          success: true,
          data: auditFixture.map((item) => ({ ...item, extraAudit: 1 })),
        });
      }),
    );

    const logs = await listAudit({ entity: "revision_manual_respuesta", entityId: "7" });

    expect(seenEntity).toBe("revision_manual_respuesta");
    expect(logs).toHaveLength(2);
    expect(logs[0]?.username).toBe("admin");
    expect(logs[0]?.createdAt).toBe("2026-10-01T10:00:00.000Z");
    expect(logs[1]?.username).toBeNull();
  });

  it("throws ApiError on envelope error and CONTRACT_MISMATCH on invalid data", async () => {
    server.use(
      http.get(`${API}/users`, () =>
        HttpResponse.json({
          success: false,
          data: null,
          error: { code: "FORBIDDEN", message: "Sin acceso" },
        }),
      ),
      http.get(`${API}/roles`, () =>
        HttpResponse.json({ success: true, data: [{ broken: true }] }),
      ),
    );

    const envErr = await listUsers().catch((e: unknown) => e);
    expect(envErr).toBeInstanceOf(ApiError);
    expect((envErr as ApiError).code).toBe("FORBIDDEN");

    const contractErr = await listRoles().catch((e: unknown) => e);
    expect(contractErr).toBeInstanceOf(ApiError);
    expect((contractErr as ApiError).code).toBe("CONTRACT_MISMATCH");
  });

  it("user mutations, roles, permissions, search and notifications work", async () => {
    let createPayload: unknown = null;
    server.use(
      http.post(`${API}/users`, async ({ request }) => {
        createPayload = await request.json();
        return HttpResponse.json({ success: true, data: usersFixture[0] });
      }),
      http.patch(`${API}/users/11111111-1111-1111-1111-111111111111/status`, () =>
        HttpResponse.json({ success: true, data: { ...usersFixture[0], status: "INACTIVO" } }),
      ),
      http.post(`${API}/users/11111111-1111-1111-1111-111111111111/roles`, () =>
        HttpResponse.json({ success: true, data: null }),
      ),
      http.delete(`${API}/users/11111111-1111-1111-1111-111111111111/roles/2`, () =>
        HttpResponse.json({ success: true, data: null }),
      ),
      http.get(`${API}/roles`, () => HttpResponse.json({ success: true, data: rolesFixture })),
      http.get(`${API}/permissions`, () => HttpResponse.json({ success: true, data: permissionsFixture })),
      http.get(`${API}/roles/1/permissions`, () =>
        HttpResponse.json({ success: true, data: permissionsFixture }),
      ),
      http.put(`${API}/roles/1/permissions`, () =>
        HttpResponse.json({ success: true, data: null }),
      ),
      http.get(`${API}/search`, () =>
        HttpResponse.json({
          success: true,
          data: [{ type: "sesion", id: "10", label: "SES-10 - Prueba", path: "/app/sesiones/10" }],
        }),
      ),
      http.get(`${API}/notifications`, () =>
        HttpResponse.json({
          success: true,
          data: [
            {
              id: 1,
              action: "LOGIN",
              entity: "usuario",
              entityId: null,
              createdAt: "2026-10-01T10:00:00",
            },
          ],
        }),
      ),
    );

    const created = await createUser({
      username: "nuevo",
      email: "nuevo@uam.edu.ni",
      fullName: "Nuevo Usuario",
      password: "SecretPassword123!",
    });
    expect(created.id).toBe("11111111-1111-1111-1111-111111111111");
    expect(createPayload).toEqual({
      username: "nuevo",
      email: "nuevo@uam.edu.ni",
      fullName: "Nuevo Usuario",
      password: "SecretPassword123!",
    });

    const updated = await setUserStatus("11111111-1111-1111-1111-111111111111", "INACTIVO");
    expect(updated.status).toBe("INACTIVO");

    await assignRole("11111111-1111-1111-1111-111111111111", 2);
    await removeRole("11111111-1111-1111-1111-111111111111", 2);

    const roles = await listRoles();
    expect(roles[0]?.name).toBe("ADMIN");

    const perms = await listPermissions();
    expect(perms[0]?.code).toBe("USUARIO_LEER");

    const rolePerms = await getRolePermissions(1);
    expect(rolePerms).toHaveLength(2);

    await setRolePermissions(1, [10, 11]);

    const searchRes = await search("SES");
    expect(searchRes[0]?.type).toBe("sesion");

    const notifications = await listNotifications();
    expect(notifications[0]?.entityId).toBeNull();
  });
});

describe("admin endpoints — sin funciones de respaldo duplicadas (sugerencia 6b)", () => {
  it("los respaldos viven solo en endpoints/backups.ts", async () => {
    const admin = (await import("./admin")) as Record<string, unknown>;
    for (const name of ["listBackups", "createBackup", "downloadBackup", "requestRestore"]) {
      expect(admin[name], name).toBeUndefined();
    }
    const backups = (await import("./backups")) as Record<string, unknown>;
    for (const name of ["listBackups", "createBackup", "downloadBackup", "requestRestore"]) {
      expect(typeof backups[name], name).toBe("function");
    }
  });
});
