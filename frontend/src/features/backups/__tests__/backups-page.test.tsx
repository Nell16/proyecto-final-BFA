import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { delay, http, HttpResponse } from "msw";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import backupsFixture from "../../../api/schemas/__fixtures__/backups/backups.json";
import { useStaffAuth } from "../../../store/staffAuth";
import { server } from "../../../test/msw/server";
import { API, clearStaffUser, ok, renderWithProviders } from "../../participants/__tests__/testUtils";
import { BackupsPage } from "../components/BackupsPage";

function setUser(permissions: string[], token = "token-a") {
  useStaffAuth.getState().setSession({
    token,
    expiresAt: null,
    user: { id: "u-1", username: "admin", roles: ["ADMINISTRADOR"], permissions },
  });
}

describe("BackupsPage", () => {
  beforeEach(() => {
    setUser(["REPORTE_EXPORTAR"]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearStaffUser();
    useStaffAuth.getState().clear();
  });

  it("muestra error con reintento si el backend falla (sin datos simulados) y recupera al reintentar", async () => {
    let calls = 0;
    server.use(
      http.get(`${API}/backups`, () => {
        calls += 1;
        if (calls === 1) {
          return HttpResponse.json(
            { success: false, data: null, error: { code: "BACKEND_DOWN", message: "Servicio no disponible" } },
            { status: 503 },
          );
        }
        return ok(backupsFixture);
      }),
    );

    await renderWithProviders(<BackupsPage />);

    expect(await screen.findByText(/servicio no disponible/i)).toBeInTheDocument();
    expect(screen.queryByText(/bfa-backup-/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /reintentar/i }));
    expect(await screen.findByText("bfa-backup-20261001100500.json")).toBeInTheDocument();
  });

  it("descarga respaldo como blob usando Content-Disposition, revoca la URL y muestra error si falla", async () => {
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:http://localhost/backup-1");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    let failDownload = false;
    server.use(
      http.get(`${API}/backups`, () => ok(backupsFixture)),
      http.get(`${API}/backups/bfa-backup-20261001100500.json`, () => {
        if (failDownload) {
          return HttpResponse.json(
            { success: false, data: null, error: { code: "NOT_FOUND", message: "Archivo faltante" } },
            { status: 404 },
          );
        }
        return new HttpResponse('{"ok":true}', {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Content-Disposition": 'attachment; filename="desde-header.json"',
          },
        });
      }),
    );

    await renderWithProviders(<BackupsPage />);
    await screen.findByText("bfa-backup-20261001100500.json");

    fireEvent.click(screen.getByRole("button", { name: /descargar respaldo bfa-backup-20261001100500\.json/i }));

    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:http://localhost/backup-1");
    expect(await screen.findByText(/respaldo descargado: desde-header\.json/i)).toBeInTheDocument();

    failDownload = true;
    fireEvent.click(screen.getByRole("button", { name: /descargar respaldo bfa-backup-20261001100500\.json/i }));
    expect(await screen.findByText(/error en la operación/i)).toBeInTheDocument();
  });

  it("exige confirmación al generar respaldo y ConfirmDialog danger con descripción al solicitar restauración", async () => {
    let generatedCount = 0;
    const restoredFiles: string[] = [];
    server.use(
      http.get(`${API}/backups`, () => ok(backupsFixture)),
      http.post(`${API}/backups`, () => {
        generatedCount += 1;
        return ok(backupsFixture[0]);
      }),
      http.post(`${API}/backups/:fileName/restore-requests`, ({ params }) => {
        restoredFiles.push(String(params.fileName));
        return ok({
          fileName: String(params.fileName),
          auditId: 501,
          requestedAt: "2026-10-01T10:15:00",
        });
      }),
    );

    await renderWithProviders(<BackupsPage />);
    await screen.findByText("bfa-backup-20261001100500.json");

    // Generar: cancelar no dispara POST; confirmar sí
    fireEvent.click(screen.getByRole("button", { name: /generar respaldo/i }));
    const genDialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(genDialog).getByRole("button", { name: /cancelar/i }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(generatedCount).toBe(0);

    fireEvent.click(screen.getByRole("button", { name: /generar respaldo/i }));
    const genDialog2 = await screen.findByRole("alertdialog");
    fireEvent.click(within(genDialog2).getByRole("button", { name: "Generar respaldo" }));
    await waitFor(() => expect(generatedCount).toBe(1));

    // Restaurar: danger dialog con descripción obligatoria
    fireEvent.click(screen.getByRole("button", { name: /solicitar restauración de bfa-backup-20261001100500\.json/i }));
    const restoreDialog = await screen.findByRole("alertdialog");
    expect(restoreDialog).toHaveAttribute("data-tone", "danger");
    expect(within(restoreDialog).getByText(/solicitud auditada de restauración/i)).toBeInTheDocument();
    fireEvent.click(within(restoreDialog).getByRole("button", { name: /solicitar restauración/i }));
    await waitFor(() => expect(restoredFiles).toEqual(["bfa-backup-20261001100500.json"]));
    expect(await screen.findByText(/solicitud de restauración auditada \(#501\)/i)).toBeInTheDocument();
  });

  it("ignora la descarga si la cuenta de staff cambia mientras la petición está en vuelo", async () => {
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:http://localhost/stale");
    let started = false;
    server.use(
      http.get(`${API}/backups`, () => ok(backupsFixture)),
      http.get(`${API}/backups/bfa-backup-20261001100500.json`, async () => {
        started = true;
        await delay(120);
        return new HttpResponse('{"ok":true}', { status: 200 });
      }),
    );

    await renderWithProviders(<BackupsPage />);
    await screen.findByText("bfa-backup-20261001100500.json");

    fireEvent.click(screen.getByRole("button", { name: /descargar respaldo bfa-backup-20261001100500\.json/i }));
    await waitFor(() => expect(started).toBe(true));

    act(() => {
      setUser(["REPORTE_EXPORTAR"], "token-b");
    });

    await new Promise((resolve) => setTimeout(resolve, 160));
    expect(createObjectURL).not.toHaveBeenCalled();
  });
});
