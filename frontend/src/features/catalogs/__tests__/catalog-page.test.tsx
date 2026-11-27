import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { http } from "msw";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import catalogCarreras from "../../../api/schemas/__fixtures__/academic/catalog-carreras.json";
import catalogGrupos from "../../../api/schemas/__fixtures__/academic/catalog-grupos-academicos.json";
import { server } from "../../../test/msw/server";
import {
  API,
  clearStaffUser,
  ok,
  renderWithProviders,
  setStaffPermissions,
} from "../../participants/__tests__/testUtils";
import { CatalogPage } from "../components/catalog-page";
import { CAREER_CATALOG, GROUP_CATALOG } from "../definitions";

describe("CatalogPage", () => {
  beforeEach(() => {
    setStaffPermissions([
      "GRUPO_ACADEMICO_LEER",
      "GRUPO_ACADEMICO_CREAR",
      "GRUPO_ACADEMICO_ELIMINAR",
      "CARRERA_LEER",
      "CARRERA_CREAR",
      "CARRERA_ELIMINAR",
    ]);
    server.use(
      http.get(`${API}/catalogos/grupos-academicos`, () => ok(catalogGrupos)),
      http.get(`${API}/catalogos/carreras`, () => ok(catalogCarreras)),
    );
  });
  afterEach(() => clearStaffUser());

  it("grupos académicos exige carrera: sin ella muestra el error y no llama al backend", async () => {
    const posted: unknown[] = [];
    server.use(
      http.post(`${API}/catalogos/grupos-academicos`, async ({ request }) => {
        posted.push(await request.json());
        return ok(catalogGrupos[0]);
      }),
    );
    await renderWithProviders(<CatalogPage definition={GROUP_CATALOG} />);
    await screen.findByText("PSI-A");

    fireEvent.click(screen.getByRole("button", { name: /nuevo grupo/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/código/i), { target: { value: "NEW-1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar" }));

    expect(await within(dialog).findByText("Seleccione una carrera.")).toBeInTheDocument();
    expect(posted).toHaveLength(0);
  });

  it("inactivar exige confirmación (sin confirm() nativo)", async () => {
    const deleted: string[] = [];
    server.use(
      http.delete(`${API}/catalogos/carreras/:id`, ({ params }) => {
        deleted.push(String(params.id));
        return ok(null);
      }),
    );
    await renderWithProviders(<CatalogPage definition={CAREER_CATALOG} />);
    const first = catalogCarreras[0];
    await screen.findByText(first.codigoCarrera);

    fireEvent.click(screen.getByRole("button", { name: `Inactivar carrera ${first.codigoCarrera}` }));
    const dialog = await screen.findByRole("alertdialog");
    expect(deleted).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: /cancelar/i }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(deleted).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: `Inactivar carrera ${first.codigoCarrera}` }));
    const second = await screen.findByRole("alertdialog");
    fireEvent.click(within(second).getByRole("button", { name: "Inactivar" }));
    await waitFor(() => expect(deleted).toEqual([String(first.id)]));
  });
});
