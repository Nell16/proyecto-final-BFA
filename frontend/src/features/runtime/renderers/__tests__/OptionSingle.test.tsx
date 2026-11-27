import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { RuntimeItem } from "../../../../api/schemas/runtime";
import type { AnswerValue } from "../../answer-value";
import { OptionSingle } from "../OptionSingle";

type SingleValue = Extract<AnswerValue, { kind: "OPCION_UNICA" }>;

function makeItem(overrides: Partial<RuntimeItem> = {}): RuntimeItem {
  return {
    id: 101,
    order: 1,
    itemType: "SOLO_TEXTO",
    responseType: "OPCION_UNICA",
    prompt: "¿Cuál es la capital de Nicaragua?",
    images: [],
    options: [
      { id: 10, label: "A", text: "León", order: 1, images: [] },
      { id: 20, label: "B", text: "Managua", order: 2, images: [] },
      { id: 30, label: "C", text: "Granada", order: 3, images: [] },
      { id: 40, label: "D", text: "Masaya", order: 4, images: [] },
    ],
    ...overrides,
  };
}

describe("OptionSingle", () => {
  it("expone role='radiogroup' con aria-labelledby al enunciado y radios con nombres accesibles", () => {
    const item = makeItem();
    render(
      <>
        <h2 id="enunciado-101">{item.prompt}</h2>
        <OptionSingle
          item={item}
          value={{ kind: "OPCION_UNICA", optionId: 20 }}
          onChange={vi.fn()}
          aria-labelledby="enunciado-101"
        />
      </>,
    );

    const group = screen.getByRole("radiogroup", { name: "¿Cuál es la capital de Nicaragua?" });
    expect(group).toHaveAttribute("aria-labelledby", "enunciado-101");

    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(4);
    expect(screen.getByRole("radio", { name: /A.*León/i })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("radio", { name: /B.*Managua/i })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: /C.*Granada/i })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("radio", { name: /D.*Masaya/i })).toHaveAttribute("aria-checked", "false");
  });

  it("usa el prompt del ítem como aria-labelledby de respaldo cuando no se pasa aria-labelledby externo", () => {
    const item = makeItem({ prompt: "Elija la figura correcta" });
    render(
      <OptionSingle
        item={item}
        value={{ kind: "OPCION_UNICA", optionId: null }}
        onChange={vi.fn()}
      />,
    );

    const group = screen.getByRole("radiogroup", { name: "Elija la figura correcta" });
    expect(group).toHaveAttribute("aria-labelledby");
  });

  it("selecciona una opción al hacer clic", () => {
    const onChange = vi.fn();
    render(
      <OptionSingle
        item={makeItem()}
        value={{ kind: "OPCION_UNICA", optionId: null }}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("radio", { name: /Managua/i }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ kind: "OPCION_UNICA", optionId: 20 });
  });

  it("volver a pulsar la opción seleccionada NO la deselecciona", () => {
    const onChange = vi.fn();

    function ControlledHarness() {
      const [val, setVal] = useState<SingleValue>({ kind: "OPCION_UNICA", optionId: 20 });
      return (
        <OptionSingle
          item={makeItem()}
          value={val}
          onChange={(next) => {
            onChange(next);
            setVal(next);
          }}
        />
      );
    }

    render(<ControlledHarness />);
    const selectedRadio = screen.getByRole("radio", { name: /Managua/i });
    expect(selectedRadio).toHaveAttribute("aria-checked", "true");

    fireEvent.click(selectedRadio);
    expect(selectedRadio).toHaveAttribute("aria-checked", "true");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("selecciona por letra (A-Z) y por número (1-9) cuando el foco está dentro del renderer", () => {
    const onChange = vi.fn();
    render(
      <OptionSingle
        item={makeItem()}
        value={{ kind: "OPCION_UNICA", optionId: null }}
        onChange={onChange}
      />,
    );

    const firstRadio = screen.getByRole("radio", { name: /León/i });
    firstRadio.focus();

    fireEvent.keyDown(firstRadio, { key: "c" });
    expect(onChange).toHaveBeenLastCalledWith({ kind: "OPCION_UNICA", optionId: 30 });

    fireEvent.keyDown(firstRadio, { key: "2" });
    expect(onChange).toHaveBeenLastCalledWith({ kind: "OPCION_UNICA", optionId: 20 });

    fireEvent.keyDown(firstRadio, { key: "D" });
    expect(onChange).toHaveBeenLastCalledWith({ kind: "OPCION_UNICA", optionId: 40 });
  });

  it("ignora atajos fuera del renderer salvo cuando hotkeysActive es true", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <OptionSingle
        item={makeItem()}
        value={{ kind: "OPCION_UNICA", optionId: null }}
        onChange={onChange}
      />,
    );

    fireEvent.keyDown(document.body, { key: "a" });
    fireEvent.keyDown(document.body, { key: "2" });
    expect(onChange).not.toHaveBeenCalled();

    rerender(
      <OptionSingle
        item={makeItem()}
        value={{ kind: "OPCION_UNICA", optionId: null }}
        onChange={onChange}
        hotkeysActive
      />,
    );

    fireEvent.keyDown(document.body, { key: "3" });
    expect(onChange).toHaveBeenNthCalledWith(1, { kind: "OPCION_UNICA", optionId: 30 });

    fireEvent.keyDown(document.body, { key: "a" });
    expect(onChange).toHaveBeenNthCalledWith(2, { kind: "OPCION_UNICA", optionId: 10 });
  });

  it("navega con ↑/↓ dentro del grupo y NO captura ←/→", () => {
    const onChange = vi.fn();
    const parentKeyDown = vi.fn();

    render(
      <div onKeyDown={parentKeyDown}>
        <OptionSingle
          item={makeItem()}
          value={{ kind: "OPCION_UNICA", optionId: 10 }}
          onChange={onChange}
        />
      </div>,
    );

    const radioA = screen.getByRole("radio", { name: /León/i });
    const radioB = screen.getByRole("radio", { name: /Managua/i });
    const radioD = screen.getByRole("radio", { name: /Masaya/i });

    radioA.focus();
    fireEvent.keyDown(radioA, { key: "ArrowDown" });
    expect(document.activeElement).toBe(radioB);
    expect(onChange).toHaveBeenLastCalledWith({ kind: "OPCION_UNICA", optionId: 20 });

    fireEvent.keyDown(radioB, { key: "ArrowUp" });
    expect(document.activeElement).toBe(radioA);

    fireEvent.keyDown(radioA, { key: "ArrowUp" });
    expect(document.activeElement).toBe(radioD);
    expect(onChange).toHaveBeenLastCalledWith({ kind: "OPCION_UNICA", optionId: 40 });

    onChange.mockClear();
    parentKeyDown.mockClear();
    fireEvent.keyDown(radioD, { key: "ArrowRight" });
    fireEvent.keyDown(radioD, { key: "ArrowLeft" });
    expect(onChange).not.toHaveBeenCalled();
    expect(parentKeyDown).toHaveBeenCalledTimes(2);
    expect(parentKeyDown.mock.calls[0][0].defaultPrevented).toBe(false);
    expect(parentKeyDown.mock.calls[1][0].defaultPrevented).toBe(false);
  });

  it("bloquea cambios por clic y teclado cuando disabled es true y expone aria-disabled", () => {
    const onChange = vi.fn();
    render(
      <OptionSingle
        item={makeItem()}
        value={{ kind: "OPCION_UNICA", optionId: 10 }}
        onChange={onChange}
        disabled
        hotkeysActive
      />,
    );

    const group = screen.getByRole("radiogroup");
    expect(group).toHaveAttribute("aria-disabled", "true");

    const radioB = screen.getByRole("radio", { name: /Managua/i });
    expect(radioB).toHaveAttribute("aria-disabled", "true");
    expect(radioB).toBeDisabled();

    fireEvent.click(radioB);
    fireEvent.keyDown(document.body, { key: "b" });
    fireEvent.keyDown(document.body, { key: "2" });
    fireEvent.keyDown(group, { key: "ArrowDown" });

    expect(onChange).not.toHaveBeenCalled();
  });
});
