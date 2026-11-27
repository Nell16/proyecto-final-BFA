import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { ConfirmDialog } from "./confirm-dialog";

describe("ConfirmDialog", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('en tone="danger" expone la descripción como descripción accesible del alertdialog', () => {
    const description =
      "Esta acción cancelará la sesión de forma irreversible y revocará todos los accesos.";

    render(
      <ConfirmDialog
        open
        onOpenChange={vi.fn()}
        tone="danger"
        title="¿Cancelar sesión?"
        description={description}
        confirmLabel="Confirmar"
        onConfirm={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveAccessibleDescription(description);
    expect(within(dialog).getByRole("button", { name: "Confirmar" })).toBeEnabled();
  });

  it('en tone="danger" con descripción vacía o solo espacios oculta el botón Confirmar y registra console.error en DEV', () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { rerender } = render(
      <ConfirmDialog
        open
        onOpenChange={vi.fn()}
        tone="danger"
        title="¿Eliminar registro?"
        description=""
        confirmLabel="Confirmar"
        onConfirm={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).queryByRole("button", { name: "Confirmar" })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Cancelar" })).toBeInTheDocument();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("[ConfirmDialog]"));

    rerender(
      <ConfirmDialog
        open
        onOpenChange={vi.fn()}
        tone="danger"
        title="¿Eliminar registro?"
        description="   "
        confirmLabel="Confirmar"
        onConfirm={vi.fn()}
      />,
    );

    expect(within(dialog).queryByRole("button", { name: "Confirmar" })).not.toBeInTheDocument();
  });

  it('en tone="danger" bloquea el botón Confirmar si en runtime llega un nodo no-string (p. ej. null o aria-hidden)', () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ConfirmDialog
        open
        onOpenChange={vi.fn()}
        tone="danger"
        title="¿Eliminar registro?"
        description={(<span aria-hidden="true">Oculto</span>) as unknown as string}
        confirmLabel="Confirmar"
        onConfirm={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).queryByRole("button", { name: "Confirmar" })).not.toBeInTheDocument();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("[ConfirmDialog]"));
  });

  it('durante pending anuncia "Procesando…" en role="status" fuera del contenedor con aria-busy', async () => {
    let resolveConfirm!: () => void;
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveConfirm = resolve;
        }),
    );
    const onOpenChange = vi.fn();

    render(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        tone="danger"
        title="¿Revocar acceso?"
        description="El enlace dejará de funcionar inmediatamente."
        confirmLabel="Confirmar"
        onConfirm={onConfirm}
      />,
    );

    const dialog = screen.getByRole("alertdialog");
    const confirmButton = within(dialog).getByRole("button", { name: "Confirmar" });

    fireEvent.click(confirmButton);

    const status = await within(dialog).findByRole("status");
    await waitFor(() => {
      expect(status).toHaveTextContent("Procesando…");
    });

    const busyNode = dialog.querySelector('[aria-busy="true"]');
    expect(busyNode).not.toBeNull();
    expect(busyNode).not.toContainElement(status);
    expect(status.closest('[aria-busy="true"]')).toBeNull();
    expect(confirmButton).toBeDisabled();

    resolveConfirm();
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });
});
