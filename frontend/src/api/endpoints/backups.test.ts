import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { useStaffAuth } from "../../store/staffAuth";
import { ApiError } from "../errors";
import { createBackup, downloadBackup, listBackups, requestRestore } from "./backups";
import backupsFixture from "../schemas/__fixtures__/backups/backups.json";

const API = "http://localhost:8080";

beforeEach(() => {
  useStaffAuth.getState().setSession({
    token: "staff-jwt",
    expiresAt: null,
    user: { id: "u1", username: "admin", roles: ["ADMIN"], permissions: ["REPORTE_EXPORTAR"] },
  });
});

afterEach(() => useStaffAuth.getState().clear());

describe("backups endpoints", () => {
  it("listBackups and createBackup parse fixture, normalize UTC dates, and tolerate unknown fields", async () => {
    server.use(
      http.get(`${API}/backups`, () =>
        HttpResponse.json({
          success: true,
          data: [
            { ...backupsFixture[0], extraField: "ignored" },
            { ...backupsFixture[0], fileName: "other.json", status: "FUTURE_STATUS" },
          ],
        }),
      ),
      http.post(`${API}/backups`, () =>
        HttpResponse.json({ success: true, data: backupsFixture[0] }),
      ),
    );

    const list = await listBackups();
    expect(list).toHaveLength(2);
    expect(list[0]?.generatedAt).toBe("2026-10-01T10:05:00.000Z");
    expect(list[1]?.status).toBe("DESCONOCIDO");

    const created = await createBackup();
    expect(created.fileName).toBe("bfa-backup-20261001100500.json");
    expect(created.generatedAt).toBe("2026-10-01T10:05:00.000Z");
  });

  it("downloadBackup extracts filename from Content-Disposition and returns blob", async () => {
    server.use(
      http.get(`${API}/backups/bfa-backup-20261001100500.json`, () =>
        new HttpResponse('{"participants":5}', {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Content-Disposition": 'attachment; filename="server-name.json"',
          },
        }),
      ),
    );

    const result = await downloadBackup("bfa-backup-20261001100500.json");
    expect(result.fileName).toBe("server-name.json");
    expect(result.blob).toBeInstanceOf(Blob);
  });

  it("requestRestore parses restore request and surfaces envelope errors", async () => {
    server.use(
      http.post(`${API}/backups/bfa-backup-20261001100500.json/restore-requests`, () =>
        HttpResponse.json({
          success: true,
          data: {
            fileName: "bfa-backup-20261001100500.json",
            auditId: 1003,
            requestedAt: "2026-10-01T10:10:00",
          },
        }),
      ),
      http.get(`${API}/backups`, () =>
        HttpResponse.json({
          success: false,
          data: null,
          error: { code: "FORBIDDEN", message: "Sin permiso" },
        }),
      ),
    );

    const restore = await requestRestore("bfa-backup-20261001100500.json");
    expect(restore.auditId).toBe(1003);
    expect(restore.requestedAt).toBe("2026-10-01T10:10:00.000Z");

    const err = await listBackups().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("FORBIDDEN");
  });
});
