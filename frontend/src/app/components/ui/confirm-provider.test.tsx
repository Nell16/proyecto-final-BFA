import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, fireEvent } from "@testing-library/react";

import { ConfirmProvider, useConfirm } from "./confirm-dialog";
import { useStaffAuth } from "../../../store/staffAuth";

function Trigger({ onConfirm, onResult }: { onConfirm: () => void; onResult: (v: boolean) => void }) {
  const confirm = useConfirm();
  return (
    <button
      type="button"
      onClick={() =>
        void confirm({ title: "¿Seguro?", confirmLabel: "Sí", onConfirm }).then(onResult)
      }
    >
      abrir
    </button>
  );
}

afterEach(() => useStaffAuth.getState().clear());

describe("ConfirmProvider frente a un cambio de cuenta", () => {
  it("si cambia sessionId con el diálogo abierto, se cierra, resuelve false y no ejecuta onConfirm", async () => {
    const onConfirm = vi.fn();
    const onResult = vi.fn();
    render(
      <ConfirmProvider>
        <Trigger onConfirm={onConfirm} onResult={onResult} />
      </ConfirmProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "abrir" }));
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();

    act(() => useStaffAuth.getState().setSession({ token: "otra-cuenta", expiresAt: null }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(onResult).toHaveBeenCalledWith(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("sin cambio de cuenta confirma normalmente", async () => {
    const onConfirm = vi.fn();
    const onResult = vi.fn();
    render(
      <ConfirmProvider>
        <Trigger onConfirm={onConfirm} onResult={onResult} />
      </ConfirmProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "abrir" }));
    fireEvent.click(await screen.findByRole("button", { name: "Sí" }));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(true));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("con una confirmación activa y otra en cola, el cambio de cuenta resuelve ambas como false", async () => {
    const onConfirm = vi.fn();
    const first = vi.fn();
    const second = vi.fn();
    function Two() {
      const confirm = useConfirm();
      return (
        <button
          type="button"
          onClick={() => {
            void confirm({ title: "Primera", confirmLabel: "Sí", onConfirm }).then(first);
            void confirm({ title: "Segunda", confirmLabel: "Sí", onConfirm }).then(second);
          }}
        >
          abrir dos
        </button>
      );
    }
    render(
      <ConfirmProvider>
        <Two />
      </ConfirmProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "abrir dos" }));
    expect(await screen.findByText("Primera")).toBeInTheDocument();
    expect(screen.queryByText("Segunda")).not.toBeInTheDocument();

    act(() => useStaffAuth.getState().setSession({ token: "otra-cuenta", expiresAt: null }));

    await waitFor(() => {
      expect(first).toHaveBeenCalledWith(false);
      expect(second).toHaveBeenCalledWith(false);
    });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
