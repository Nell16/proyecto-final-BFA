import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import type { RuntimeItem } from "../../../../api/schemas/runtime";
import { TrueFalse } from "../TrueFalse";

function makeTrueFalseItem(
  options: RuntimeItem["options"] = [
    { id: 101, label: "A", text: "Verdadero", order: 1, images: [] },
    { id: 102, label: "B", text: "Falso", order: 2, images: [] },
  ],
): RuntimeItem {
  return {
    id: 50,
    order: 1,
    itemType: "SOLO_TEXTO",
    responseType: "VERDADERO_FALSO",
    prompt: "El agua hierve a 100 °C al nivel del mar.",
    images: [],
    options,
  };
}

describe("TrueFalse", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renderiza un radiogroup con dos botones grandes y muestra text o label como respaldo", () => {
    const item = makeTrueFalseItem([
      { id: 1, label: "Verdadero", order: 1, images: [] },
      { id: 2, label: "F", text: "   ", order: 2, images: [] },
    ]);

    render(
      <TrueFalse
        item={item}
        value={{ kind: "VERDADERO_FALSO", optionId: 1 }}
        onChange={vi.fn()}
      />,
    );

    const group = screen.getByRole("radiogroup", {
      name: "El agua hierve a 100 °C al nivel del mar.",
    });
    expect(group).toHaveAttribute("data-layout", "segmented");

    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(2);

    const first = screen.getByRole("radio", { name: "Verdadero" });
    const second = screen.getByRole("radio", { name: "F" });

    expect(first).toHaveAttribute("aria-checked", "true");
    expect(second).toHaveAttribute("aria-checked", "false");
    expect(first.className).toContain("min-h-14");
    expect(second.className).toContain("min-h-14");
  });

  it("permite seleccionar opciones con clic y evita disparar onChange si ya está seleccionada", () => {
    const onChange = vi.fn();
    const item = makeTrueFalseItem();

    const { rerender } = render(
      <TrueFalse
        item={item}
        value={{ kind: "VERDADERO_FALSO", optionId: null }}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("radio", { name: "Verdadero" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith({ kind: "VERDADERO_FALSO", optionId: 101 });

    rerender(
      <TrueFalse
        item={item}
        value={{ kind: "VERDADERO_FALSO", optionId: 101 }}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("radio", { name: "Verdadero" }));
    expect(onChange).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("radio", { name: "Falso" }));
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith({ kind: "VERDADERO_FALSO", optionId: 102 });
  });

  it("responde a V/1 y F/2 cuando el foco está dentro del radiogroup y no captura ←/→", () => {
    const onChange = vi.fn();
    const item = makeTrueFalseItem();

    render(
      <TrueFalse
        item={item}
        value={{ kind: "VERDADERO_FALSO", optionId: null }}
        onChange={onChange}
      />,
    );

    const first = screen.getByRole("radio", { name: "Verdadero" });
    first.focus();
    expect(first).toHaveFocus();

    fireEvent.keyDown(first, { key: "v" });
    expect(onChange).toHaveBeenLastCalledWith({ kind: "VERDADERO_FALSO", optionId: 101 });

    fireEvent.keyDown(first, { key: "F" });
    expect(onChange).toHaveBeenLastCalledWith({ kind: "VERDADERO_FALSO", optionId: 102 });

    fireEvent.keyDown(first, { key: "1" });
    expect(onChange).toHaveBeenLastCalledWith({ kind: "VERDADERO_FALSO", optionId: 101 });

    fireEvent.keyDown(first, { key: "2" });
    expect(onChange).toHaveBeenLastCalledWith({ kind: "VERDADERO_FALSO", optionId: 102 });

    const countBeforeArrows = onChange.mock.calls.length;
    const arrowLeftNotPrevented = fireEvent.keyDown(first, { key: "ArrowLeft" });
    const arrowRightNotPrevented = fireEvent.keyDown(first, { key: "ArrowRight" });

    expect(arrowLeftNotPrevented).toBe(true);
    expect(arrowRightNotPrevented).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(countBeforeArrows);
    expect(first).toHaveFocus();
  });

  it("soporta atajos globales V/F/1/2 solo cuando hotkeysActive=true y fuera de inputs", () => {
    const onChange = vi.fn();
    const item = makeTrueFalseItem();

    const { rerender } = render(
      <div>
        <input aria-label="Nota auxiliar" />
        <TrueFalse
          item={item}
          value={{ kind: "VERDADERO_FALSO", optionId: null }}
          onChange={onChange}
        />
      </div>,
    );

    fireEvent.keyDown(window, { key: "v" });
    expect(onChange).not.toHaveBeenCalled();

    rerender(
      <div>
        <input aria-label="Nota auxiliar" />
        <TrueFalse
          item={item}
          value={{ kind: "VERDADERO_FALSO", optionId: null }}
          onChange={onChange}
          hotkeysActive
        />
      </div>,
    );

    // Ignora pulsaciones dentro de un input editable
    const input = screen.getByLabelText("Nota auxiliar");
    input.focus();
    fireEvent.keyDown(input, { key: "v" });
    expect(onChange).not.toHaveBeenCalled();

    // Ignora atajos con modificadores
    fireEvent.keyDown(window, { key: "v", ctrlKey: true });
    fireEvent.keyDown(window, { key: "2", metaKey: true });
    expect(onChange).not.toHaveBeenCalled();

    // Funciona fuera de campos editables
    fireEvent.keyDown(window, { key: "V" });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith({ kind: "VERDADERO_FALSO", optionId: 101 });

    fireEvent.keyDown(window, { key: "f" });
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith({ kind: "VERDADERO_FALSO", optionId: 102 });

    fireEvent.keyDown(window, { key: "1" });
    expect(onChange).toHaveBeenCalledTimes(3);
    expect(onChange).toHaveBeenLastCalledWith({ kind: "VERDADERO_FALSO", optionId: 101 });

    fireEvent.keyDown(window, { key: "2" });
    expect(onChange).toHaveBeenCalledTimes(4);
    expect(onChange).toHaveBeenLastCalledWith({ kind: "VERDADERO_FALSO", optionId: 102 });

    // Si el foco está dentro del grupo con hotkeysActive=true, no debe duplicar la llamada
    const second = screen.getByRole("radio", { name: "Falso" });
    second.focus();
    fireEvent.keyDown(second, { key: "v" });
    expect(onChange).toHaveBeenCalledTimes(5);
  });

  it("bloquea clics y atajos de teclado cuando disabled=true", () => {
    const onChange = vi.fn();
    const item = makeTrueFalseItem();

    render(
      <TrueFalse
        item={item}
        value={{ kind: "VERDADERO_FALSO", optionId: 101 }}
        onChange={onChange}
        disabled
        hotkeysActive
      />,
    );

    const group = screen.getByRole("radiogroup");
    expect(group).toHaveAttribute("aria-disabled", "true");

    const first = screen.getByRole("radio", { name: "Verdadero" });
    const second = screen.getByRole("radio", { name: "Falso" });

    expect(first).toBeDisabled();
    expect(second).toBeDisabled();

    fireEvent.click(second);
    fireEvent.keyDown(group, { key: "f" });
    fireEvent.keyDown(window, { key: "2" });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("renderiza como lista y emite console.error en DEV cuando item.options no tiene exactamente 2 opciones", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const onChange = vi.fn();

    const item3 = makeTrueFalseItem([
      { id: 1, label: "A", text: "Verdadero", order: 1, images: [] },
      { id: 2, label: "B", text: "Falso", order: 2, images: [] },
      { id: 3, label: "C", text: "No aplica", order: 3, images: [] },
    ]);

    const { rerender } = render(
      <TrueFalse
        item={item3}
        value={{ kind: "VERDADERO_FALSO", optionId: null }}
        onChange={onChange}
      />,
    );

    const group = screen.getByRole("radiogroup");
    expect(group).toHaveAttribute("data-layout", "fallback-list");
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("[TrueFalse]"));

    fireEvent.click(screen.getByRole("radio", { name: "No aplica" }));
    expect(onChange).toHaveBeenLastCalledWith({ kind: "VERDADERO_FALSO", optionId: 3 });

    // Caso extremo con 0 opciones: no falla al pulsar atajos ni al renderizar
    errorSpy.mockClear();
    rerender(
      <TrueFalse
        item={makeTrueFalseItem([])}
        value={{ kind: "VERDADERO_FALSO", optionId: null }}
        onChange={onChange}
        hotkeysActive
      />,
    );

    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("[TrueFalse]"));
    fireEvent.keyDown(window, { key: "v" });
    fireEvent.keyDown(window, { key: "f" });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  describe("atajos V/F según el contenido de las opciones", () => {
    const renderWith = (options: RuntimeItem["options"]) => {
      const onChange = vi.fn();
      render(
        <TrueFalse
          item={makeTrueFalseItem(options)}
          value={{ kind: "VERDADERO_FALSO", optionId: null }}
          onChange={onChange}
          hotkeysActive
        />,
      );
      return onChange;
    };
    const badges = () => screen.getAllByRole("radio").map((r) => r.querySelector("[aria-hidden='true']")?.textContent);

    it("orden Verdadero/Falso: V y F seleccionan según su texto y las insignias coinciden", () => {
      const onChange = renderWith([
        { id: 1, label: "A", text: "Verdadero", order: 1, images: [] },
        { id: 2, label: "B", text: "Falso", order: 2, images: [] },
      ]);
      expect(badges()).toEqual(["V", "F"]);
      fireEvent.keyDown(window, { key: "v" });
      expect(onChange).toHaveBeenLastCalledWith({ kind: "VERDADERO_FALSO", optionId: 1 });
      fireEvent.keyDown(window, { key: "F" });
      expect(onChange).toHaveBeenLastCalledWith({ kind: "VERDADERO_FALSO", optionId: 2 });
    });

    it("orden Falso/Verdadero: V selecciona Verdadero (segunda opción) y la insignia V está en ese botón", () => {
      const onChange = renderWith([
        { id: 1, label: "A", text: "Falso", order: 1, images: [] },
        { id: 2, label: "B", text: "Verdadero", order: 2, images: [] },
      ]);
      expect(badges()).toEqual(["F", "V"]);
      fireEvent.keyDown(window, { key: "v" });
      expect(onChange).toHaveBeenLastCalledWith({ kind: "VERDADERO_FALSO", optionId: 2 });
      fireEvent.keyDown(window, { key: "f" });
      expect(onChange).toHaveBeenLastCalledWith({ kind: "VERDADERO_FALSO", optionId: 1 });
      // 1/2 siguen siendo posicionales
      fireEvent.keyDown(window, { key: "1" });
      expect(onChange).toHaveBeenLastCalledWith({ kind: "VERDADERO_FALSO", optionId: 1 });
    });

    it("detecta por acentos/mayúsculas y por el código cuando no hay texto", () => {
      const onChange = renderWith([
        { id: 1, label: "F", order: 1, images: [] },
        { id: 2, label: "V", order: 2, images: [] },
      ]);
      fireEvent.keyDown(window, { key: "v" });
      expect(onChange).toHaveBeenLastCalledWith({ kind: "VERDADERO_FALSO", optionId: 2 });
    });

    it("caso ambiguo: V/F desactivados, solo 1/2 posicionales y la insignia muestra 1/2", () => {
      const onChange = renderWith([
        { id: 1, label: "A", text: "Sí", order: 1, images: [] },
        { id: 2, label: "B", text: "No", order: 2, images: [] },
      ]);
      expect(badges()).toEqual(["1", "2"]);
      fireEvent.keyDown(window, { key: "v" });
      fireEvent.keyDown(window, { key: "f" });
      expect(onChange).not.toHaveBeenCalled();
      fireEvent.keyDown(window, { key: "2" });
      expect(onChange).toHaveBeenLastCalledWith({ kind: "VERDADERO_FALSO", optionId: 2 });
    });
  });
});
