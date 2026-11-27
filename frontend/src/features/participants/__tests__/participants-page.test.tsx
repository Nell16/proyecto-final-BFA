import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { http } from "msw";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import catalogCohortes from "../../../api/schemas/__fixtures__/academic/catalog-cohortes.json";
import catalogGrupos from "../../../api/schemas/__fixtures__/academic/catalog-grupos-academicos.json";
import catalogSexos from "../../../api/schemas/__fixtures__/academic/catalog-sexos.json";
import participantsPage from "../../../api/schemas/__fixtures__/academic/participants-page.json";
import { server } from "../../../test/msw/server";
import { PARTICIPANT_PERMISSIONS } from "../permissions";
import { ParticipantsPage } from "../components/participants-page";
import { API, clearStaffUser, forbidden, ok, renderWithProviders, setStaffPermissions } from "./testUtils";

const ANA = "a1b2c3d4-e5f6-4789-abcd-111111111111";

function mockCatalogs(overrides: Partial<Record<"carreras", ReturnType<typeof forbidden>>> = {}) {
  server.use(
    http.get(`${API}/catalogos/sexos`, () => ok(catalogSexos)),
    http.get(`${API}/catalogos/carreras`, () => overrides.carreras ?? forbidden()),
    http.get(`${API}/catalogos/cohortes`, () => ok(catalogCohortes)),
    http.get(`${API}/catalogos/grupos-academicos`, () => ok(catalogGrupos)),
  );
}

const ALL_PERMISSIONS = [
  "PARTICIPANTE_LEER",
  PARTICIPANT_PERMISSIONS.CREATE,
  PARTICIPANT_PERMISSIONS.DELETE,
  "CATALOGO_SEXO_LEER",
  "CARRERA_LEER",
  "COHORTE_LEER",
  "GRUPO_ACADEMICO_LEER",
];

describe("ParticipantsPage", () => {
  beforeEach(() => {
    setStaffPermissions(ALL_PERMISSIONS);
    server.use(http.get(`${API}/participantes`, () => ok(participantsPage)));
  });
  afterEach(() => clearStaffUser());

  it("renderiza la lista aunque /catalogos/carreras responda 403 y deshabilita solo ese filtro", async () => {
    mockCatalogs();
    await renderWithProviders(<ParticipantsPage />);

    expect(await screen.findByText("PART-2026-001")).toBeInTheDocument();
    expect(screen.getByText("Ana Sofía Martínez López")).toBeInTheDocument();
    expect(screen.getByText("PART-2026-002")).toBeInTheDocument();

    await waitFor(() => expect(screen.getByRole("combobox", { name: "Filtrar por carrera" })).toBeDisabled());
    expect(screen.getByRole("combobox", { name: "Filtrar por sexo" })).toBeEnabled();
    expect(screen.getByRole("combobox", { name: "Filtrar por cohorte" })).toBeEnabled();
    expect(screen.getByRole("button", { name: /registrar participante/i })).toBeInTheDocument();
  });

  it("no ofrece crear ni desactivar sin los permisos de escritura", async () => {
    setStaffPermissions(["PARTICIPANTE_LEER"]);
    await renderWithProviders(<ParticipantsPage />);

    expect(await screen.findByText("PART-2026-001")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /registrar participante/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /desactivar participante/i })).not.toBeInTheDocument();
  });

  it("desactivar exige confirmación: cancelar no llama al backend, confirmar sí", async () => {
    mockCatalogs();
    const deleted: string[] = [];
    server.use(
      http.delete(`${API}/participantes/${ANA}`, () => {
        deleted.push(ANA);
        return ok(null);
      }),
    );
    await renderWithProviders(<ParticipantsPage />);
    await screen.findByText("PART-2026-001");

    // Cancelar.
    fireEvent.click(screen.getByRole("button", { name: "Desactivar participante PART-2026-001" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/¿Desactivar participante\?/)).toBeInTheDocument();
    expect(deleted).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: /cancelar/i }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(deleted).toHaveLength(0);

    // Confirmar.
    fireEvent.click(screen.getByRole("button", { name: "Desactivar participante PART-2026-001" }));
    const second = await screen.findByRole("alertdialog");
    fireEvent.click(within(second).getByRole("button", { name: "Desactivar" }));
    await waitFor(() => expect(deleted).toEqual([ANA]));
    expect(await screen.findByText(/desactivado/i)).toBeInTheDocument();
  });

  it("no usa alert()/confirm() nativos", async () => {
    mockCatalogs();
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const confirmSpy = vi.spyOn(window, "confirm").mockImplementation(() => true);
    await renderWithProviders(<ParticipantsPage />);
    await screen.findByText("PART-2026-001");
    fireEvent.click(screen.getByRole("button", { name: "Desactivar participante PART-2026-001" }));
    await screen.findByRole("alertdialog");
    expect(alertSpy).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
    confirmSpy.mockRestore();
  });
});
