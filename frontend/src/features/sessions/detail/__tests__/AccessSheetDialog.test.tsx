import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import assignedFixture from "../../../../api/schemas/__fixtures__/sessions/assigned-participant.json";
import { AccessSheetDialog } from "../AccessSheetDialog";
import type { AccessEntry } from "../accessSheet";

const entries: AccessEntry[] = [
  {
    assignmentId: assignedFixture.assignmentId,
    participantName: "Ana López",
    participantCode: "P-0001",
    rawToken: assignedFixture.rawToken,
    expiresAt: assignedFixture.expiresAt,
  },
];

const noop = () => undefined;
const none: ReadonlySet<number> = new Set();

describe("AccessSheetDialog", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  it("muestra el enlace de acceso, la advertencia y no escribe en localStorage/sessionStorage", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");

    render(<AccessSheetDialog sessionName="Evaluación Ingreso 2026" entries={entries} exportedIds={none} onExported={noop} onClose={noop} />);

    const dialog = screen.getByRole("dialog");
    const expectedLink = `${window.location.origin}/evaluacion/${assignedFixture.assignmentId}-${assignedFixture.rawToken}`;
    expect(within(dialog).getByText(expectedLink)).toBeInTheDocument();
    expect(within(dialog).getByText("Ana López")).toBeInTheDocument();
    expect(within(dialog).getByText("P-0001")).toBeInTheDocument();
    expect(within(dialog).getByText(/estos códigos no se volverán a mostrar/i)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /copiar todo/i })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /imprimir/i })).toBeInTheDocument();

    // El rawToken nunca se persiste.
    expect(setItem).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(JSON.stringify({ ...localStorage })).not.toContain(assignedFixture.rawToken);
  });

  it("muestra QR local, vencimiento y advierte si vence antes del inicio", () => {
    render(
      <AccessSheetDialog
        sessionName="X"
        scheduledStart="2026-11-30T09:00:00"
        entries={entries}
        exportedIds={none}
        onExported={noop}
        onClose={noop}
      />,
    );
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("img", { name: /QR del enlace de Ana López/i })).toBeInTheDocument();
    expect(within(dialog).getByText(/^Vence /)).toBeInTheDocument();
    // expiresAt (2026-11-24) < inicio programado (2026-11-30)
    expect(within(dialog).getByText(/vence antes del inicio programado/i)).toBeInTheDocument();
  });

  it("pide confirmación al cerrar con enlaces sin exportar (botón Cerrar y botón superior)", async () => {
    const onClose = vi.fn();
    render(<AccessSheetDialog sessionName="X" entries={entries} exportedIds={none} onExported={noop} onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: /^Cerrar$/ }));
    expect(await screen.findByText("Cerrar sin exportar los enlaces")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Volver a la hoja" }));
    await waitFor(() => expect(screen.queryByText("Cerrar sin exportar los enlaces")).not.toBeInTheDocument());

    // botón superior de cierre (X del diálogo)
    const top = screen.getAllByRole("button", { name: /close|cerrar/i }).find((b) => b.textContent !== "Cerrar");
    fireEvent.click(top as HTMLElement);
    expect(await screen.findByText("Cerrar sin exportar los enlaces")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cerrar sin exportar" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("cierra sin confirmar cuando todos los enlaces fueron exportados", () => {
    const onClose = vi.fn();
    const exported = new Set(entries.map((e) => e.assignmentId));
    render(<AccessSheetDialog sessionName="X" entries={entries} exportedIds={exported} onExported={noop} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /^Cerrar$/ }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("marca como exportada solo la asignación copiada", async () => {
    const onExported = vi.fn();
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    render(<AccessSheetDialog sessionName="X" entries={entries} exportedIds={none} onExported={onExported} onClose={noop} />);
    fireEvent.click(screen.getByRole("button", { name: /copiar enlace de ana/i }));
    await waitFor(() => expect(onExported).toHaveBeenCalledWith([entries[0].assignmentId]));
  });

  it("imprimir no marca como exportado hasta confirmar «¿Se imprimió o guardó la hoja?» con Sí", async () => {
    const onExported = vi.fn();
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    render(<AccessSheetDialog sessionName="X" entries={entries} exportedIds={none} onExported={onExported} onClose={noop} />);

    fireEvent.click(screen.getByRole("button", { name: /^imprimir$/i }));
    expect(print).toHaveBeenCalledTimes(1);
    // Antes de window.print() terminar (afterprint) no se marca nada ni se pregunta.
    expect(onExported).not.toHaveBeenCalled();
    expect(screen.queryByText("¿Se imprimió o guardó la hoja?")).not.toBeInTheDocument();

    // El usuario cancela el diálogo del navegador → "No": sigue sin exportar.
    fireEvent(window, new Event("afterprint"));
    expect(await screen.findByText("¿Se imprimió o guardó la hoja?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "No" }));
    await waitFor(() => expect(screen.queryByText("¿Se imprimió o guardó la hoja?")).not.toBeInTheDocument());
    expect(onExported).not.toHaveBeenCalled();

    // Segundo intento: "Sí" marca los ids de la hoja.
    fireEvent.click(screen.getByRole("button", { name: /^imprimir$/i }));
    fireEvent(window, new Event("afterprint"));
    fireEvent.click(await screen.findByRole("button", { name: "Sí" }));
    await waitFor(() => expect(onExported).toHaveBeenCalledWith([entries[0].assignmentId]));
    expect(onExported).toHaveBeenCalledTimes(1);
  });

  it("no renderiza nada si no hay entradas (hoja cerrada)", () => {
    render(<AccessSheetDialog sessionName="X" entries={null} exportedIds={none} onExported={noop} onClose={noop} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
