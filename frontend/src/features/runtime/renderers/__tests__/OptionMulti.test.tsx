import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import type { RuntimeItem } from "../../../../api/schemas/runtime";
import type { AnswerValue } from "../../answer-value";
import { OptionMulti } from "../OptionMulti";

function makeItem(overrides?: Partial<RuntimeItem>): RuntimeItem {
  return {
    id: 101,
    order: 1,
    itemType: "SOLO_TEXTO",
    responseType: "OPCION_MULTIPLE",
    prompt: "Seleccione los síntomas observados durante la sesión.",
    images: [],
    options: [
      { id: 10, label: "A", text: "Fatiga visual", order: 1, images: [] },
      { id: 20, label: "B", text: "Dificultad de concentración", order: 2, images: [] },
      { id: 30, label: "C", text: "Respuesta impulsiva", order: 3, images: [] },
    ],
    ...overrides,
  };
}

function ControlledOptionMulti({
  item = makeItem(),
  initialIds = [],
  disabled = false,
  hotkeysActive = false,
  labelledBy,
  onChangeSpy,
}: {
  item?: RuntimeItem;
  initialIds?: number[];
  disabled?: boolean;
  hotkeysActive?: boolean;
  labelledBy?: string;
  onChangeSpy?: (val: Extract<AnswerValue, { kind: "OPCION_MULTIPLE" }>) => void;
}) {
  const [value, setValue] = useState<Extract<AnswerValue, { kind: "OPCION_MULTIPLE" }>>({
    kind: "OPCION_MULTIPLE",
    optionIds: initialIds,
  });

  return (
    <div>
      {labelledBy && <h2 id={labelledBy}>{item.prompt}</h2>}
      <OptionMulti
        item={item}
        value={value}
        disabled={disabled}
        hotkeysActive={hotkeysActive}
        aria-labelledby={labelledBy}
        onChange={(next) => {
          setValue(next);
          onChangeSpy?.(next);
        }}
      />
    </div>
  );
}

describe("OptionMulti", () => {
  it("expone role='group' etiquetado por el enunciado, descripción textual y checkboxes accesibles", () => {
    const item = makeItem();
    render(<ControlledOptionMulti item={item} labelledBy="enunciado-101" />);

    const group = screen.getByRole("group", { name: item.prompt });
    expect(group).toHaveAttribute("aria-labelledby", "enunciado-101");
    expect(group).toHaveAccessibleDescription("Puede elegir varias opciones");
    expect(screen.getByText("Puede elegir varias opciones")).toBeInTheDocument();

    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(3);
    expect(screen.getByRole("checkbox", { name: /Fatiga visual/i })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Dificultad de concentración/i })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Respuesta impulsiva/i })).not.toBeChecked();
  });

  it("usa aria-labelledby de respaldo con item.prompt cuando no se pasa aria-labelledby externo", () => {
    const item = makeItem();
    render(<ControlledOptionMulti item={item} />);

    const group = screen.getByRole("group", { name: item.prompt });
    expect(group).toBeInTheDocument();
  });

  it("conmuta opciones por clic (0..n) y emite optionIds en el orden de las opciones, no de los clics", () => {
    const onChangeSpy = vi.fn();
    render(<ControlledOptionMulti onChangeSpy={onChangeSpy} />);

    const cbA = screen.getByRole("checkbox", { name: /Fatiga visual/i });
    const cbB = screen.getByRole("checkbox", { name: /Dificultad de concentración/i });
    const cbC = screen.getByRole("checkbox", { name: /Respuesta impulsiva/i });

    // Clic primero en C (30), luego en A (10), luego en B (20).
    fireEvent.click(cbC);
    expect(onChangeSpy).toHaveBeenLastCalledWith({ kind: "OPCION_MULTIPLE", optionIds: [30] });

    fireEvent.click(cbA);
    expect(onChangeSpy).toHaveBeenLastCalledWith({ kind: "OPCION_MULTIPLE", optionIds: [10, 30] });

    fireEvent.click(cbB);
    expect(onChangeSpy).toHaveBeenLastCalledWith({ kind: "OPCION_MULTIPLE", optionIds: [10, 20, 30] });

    // Desmarcar por clic en la etiqueta de la opción A y luego las restantes hasta quedar vacío.
    fireEvent.click(screen.getByText("Fatiga visual"));
    expect(onChangeSpy).toHaveBeenLastCalledWith({ kind: "OPCION_MULTIPLE", optionIds: [20, 30] });

    fireEvent.click(cbB);
    fireEvent.click(cbC);
    expect(onChangeSpy).toHaveBeenLastCalledWith({ kind: "OPCION_MULTIPLE", optionIds: [] });
  });

  it("conmuta por tecla numérica (1–9) y letra (A–Z) cuando el foco está dentro del grupo", () => {
    const onChangeSpy = vi.fn();
    render(<ControlledOptionMulti onChangeSpy={onChangeSpy} />);

    const cbA = screen.getByRole("checkbox", { name: /Fatiga visual/i });
    cbA.focus();

    fireEvent.keyDown(cbA, { key: "3" });
    expect(onChangeSpy).toHaveBeenLastCalledWith({ kind: "OPCION_MULTIPLE", optionIds: [30] });

    fireEvent.keyDown(cbA, { key: "a" });
    expect(onChangeSpy).toHaveBeenLastCalledWith({ kind: "OPCION_MULTIPLE", optionIds: [10, 30] });

    fireEvent.keyDown(cbA, { key: "B" });
    expect(onChangeSpy).toHaveBeenLastCalledWith({ kind: "OPCION_MULTIPLE", optionIds: [10, 20, 30] });

    fireEvent.keyDown(cbA, { key: "1" });
    expect(onChangeSpy).toHaveBeenLastCalledWith({ kind: "OPCION_MULTIPLE", optionIds: [20, 30] });
  });

  it("conmuta con hotkeysActive cuando el foco está fuera, y las ignora si hotkeysActive es false o el foco está en un input", () => {
    const onChangeSpy = vi.fn();
    const { rerender } = render(
      <div>
        <input aria-label="Otro campo" />
        <ControlledOptionMulti hotkeysActive={false} onChangeSpy={onChangeSpy} />
      </div>,
    );

    // Con hotkeysActive=false y foco fuera, no debe reaccionar.
    fireEvent.keyDown(document.body, { key: "a" });
    expect(onChangeSpy).not.toHaveBeenCalled();

    rerender(
      <div>
        <input aria-label="Otro campo" />
        <ControlledOptionMulti hotkeysActive onChangeSpy={onChangeSpy} />
      </div>,
    );

    // En un <input> con hotkeysActive=true, no debe interceptar teclas.
    const input = screen.getByLabelText("Otro campo");
    input.focus();
    fireEvent.keyDown(input, { key: "a" });
    expect(onChangeSpy).not.toHaveBeenCalled();

    // Con foco fuera de inputs y hotkeysActive=true, debe conmutar.
    fireEvent.keyDown(document.body, { key: "2" });
    expect(onChangeSpy).toHaveBeenLastCalledWith({ kind: "OPCION_MULTIPLE", optionIds: [20] });

    fireEvent.keyDown(document.body, { key: "a" });
    expect(onChangeSpy).toHaveBeenLastCalledWith({ kind: "OPCION_MULTIPLE", optionIds: [10, 20] });

    // Combinaciones con modificadores no deben conmutar.
    fireEvent.keyDown(document.body, { key: "c", ctrlKey: true });
    expect(onChangeSpy).toHaveBeenCalledTimes(2);
  });

  it("no captura ArrowLeft ni ArrowRight y permite que burbujeen al contenedor padre", () => {
    const parentKeyDown = vi.fn();
    const onChangeSpy = vi.fn();

    render(
      <div onKeyDown={parentKeyDown}>
        <ControlledOptionMulti hotkeysActive onChangeSpy={onChangeSpy} />
      </div>,
    );

    const cbA = screen.getByRole("checkbox", { name: /Fatiga visual/i });
    cbA.focus();

    fireEvent.keyDown(cbA, { key: "ArrowRight" });
    fireEvent.keyDown(cbA, { key: "ArrowLeft" });

    expect(onChangeSpy).not.toHaveBeenCalled();
    expect(parentKeyDown).toHaveBeenCalledTimes(2);
    expect(parentKeyDown.mock.calls[0]?.[0].defaultPrevented).toBe(false);
    expect(parentKeyDown.mock.calls[1]?.[0].defaultPrevented).toBe(false);
  });

  it("bloquea clics y atajos cuando disabled es true", () => {
    const onChangeSpy = vi.fn();
    render(<ControlledOptionMulti initialIds={[10]} disabled hotkeysActive onChangeSpy={onChangeSpy} />);

    const checkboxes = screen.getAllByRole("checkbox");
    for (const cb of checkboxes) {
      expect(cb).toBeDisabled();
    }

    fireEvent.click(checkboxes[1]!);
    fireEvent.click(screen.getByText("Fatiga visual"));
    fireEvent.keyDown(document.body, { key: "b" });
    fireEvent.keyDown(document.body, { key: "3" });

    expect(onChangeSpy).not.toHaveBeenCalled();
    expect(checkboxes[0]).toBeChecked();
  });

  it("cumple objetivo táctil >= 44px (min-h-12) y usa fallback de texto si una opción solo tiene imagen", () => {
    const item = makeItem({
      options: [
        {
          id: 1,
          label: "A",
          order: 1,
          images: [{ id: 90, url: "/api/img/90", altText: "Figura geométrica A", order: 1 }],
        },
      ],
    });

    render(<ControlledOptionMulti item={item} />);

    const cb = screen.getByRole("checkbox", { name: /Figura geométrica A/i });
    expect(cb).toBeInTheDocument();
    const row = cb.closest("[data-selected]");
    expect(row).toHaveClass("min-h-12");
  });
});
