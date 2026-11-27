import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { ParticipantFormDialog, type ParticipantFormCatalogs } from "../components/participant-form-dialog";
import { clearStaffUser, renderWithProviders } from "./testUtils";

const empty = { items: [], isLoading: false, unavailableReason: null, refetch: () => {} };
const catalogs: ParticipantFormCatalogs = { sexes: empty, careers: empty, cohorts: empty, groups: empty };

async function renderDialog() {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  await renderWithProviders(
    <ParticipantFormDialog open onOpenChange={() => {}} catalogs={catalogs} onSubmit={onSubmit} />,
  );
  return onSubmit;
}

const futureDate = () => {
  const date = new Date();
  date.setFullYear(date.getFullYear() + 1);
  return date.toISOString().slice(0, 10);
};

describe("ParticipantFormDialog", () => {
  afterEach(() => clearStaffUser());

  it("exige código, nombres y apellidos con mensajes inline y no envía", async () => {
    const onSubmit = await renderDialog();
    fireEvent.click(await screen.findByRole("button", { name: "Registrar" }));

    expect(await screen.findByText("El código es requerido.")).toBeInTheDocument();
    expect(screen.getByText("Los nombres son requeridos.")).toBeInTheDocument();
    expect(screen.getByText("Los apellidos son requeridos.")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("rechaza una fecha de nacimiento futura", async () => {
    const onSubmit = await renderDialog();
    fireEvent.change(await screen.findByLabelText(/código de participante/i), { target: { value: "PART-9" } });
    fireEvent.change(screen.getByLabelText(/nombres/i), { target: { value: "Ana" } });
    fireEvent.change(screen.getByLabelText(/apellidos/i), { target: { value: "Pérez" } });
    fireEvent.change(screen.getByLabelText(/fecha de nacimiento/i), { target: { value: futureDate() } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar" }));

    expect(await screen.findByText(/no puede ser futura/i)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("envía el valor normalizado cuando los datos son válidos", async () => {
    const onSubmit = await renderDialog();
    fireEvent.change(await screen.findByLabelText(/código de participante/i), { target: { value: " PART-9 " } });
    fireEvent.change(screen.getByLabelText(/nombres/i), { target: { value: "Ana" } });
    fireEvent.change(screen.getByLabelText(/apellidos/i), { target: { value: "Pérez" } });
    fireEvent.change(screen.getByLabelText(/fecha de nacimiento/i), { target: { value: "2004-05-12" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      code: "PART-9",
      firstNames: "Ana",
      lastNames: "Pérez",
      birthDate: "2004-05-12",
    });
  });
});
