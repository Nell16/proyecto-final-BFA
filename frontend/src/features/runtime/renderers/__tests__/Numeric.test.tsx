import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { RuntimeItem } from "@/api/schemas/runtime";
import { NUMERIC_ABS_LIMIT, type AnswerValue } from "../../answer-value";
import { Numeric } from "../Numeric";

const BASE_ITEM: RuntimeItem = {
  id: 101,
  order: 1,
  itemType: "SOLO_TEXTO",
  responseType: "NUMERICA",
  prompt: "¿Cuál es el resultado de la serie?",
  images: [],
  options: [],
};

describe("Numeric renderer", () => {
  it("renderiza input decimal con label accesible y emite un entero válido", () => {
    const onChange = vi.fn();
    render(
      <Numeric
        item={BASE_ITEM}
        value={{ kind: "NUMERICA", value: null }}
        onChange={onChange}
      />,
    );

    const input = screen.getByLabelText("Su respuesta");
    expect(input).toHaveAttribute("type", "text");
    expect(input).toHaveAttribute("inputMode", "decimal");

    fireEvent.change(input, { target: { value: "42" } });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ kind: "NUMERICA", value: 42 });
    expect(input).not.toHaveAttribute("aria-invalid");
  });

  it("acepta decimal con coma preservando el texto local mientras el usuario escribe", () => {
    function ControlledWrapper() {
      const [val, setVal] = useState<Extract<AnswerValue, { kind: "NUMERICA" }>>({
        kind: "NUMERICA",
        value: null,
      });
      return <Numeric item={BASE_ITEM} value={val} onChange={setVal} />;
    }

    render(<ControlledWrapper />);

    const input = screen.getByLabelText("Su respuesta");
    fireEvent.change(input, { target: { value: "12," } });
    expect(input).toHaveValue("12,");
    expect(input).not.toHaveAttribute("aria-invalid");

    fireEvent.change(input, { target: { value: "12,75" } });
    expect(input).toHaveValue("12,75");
  });

  it("emite el valor numérico parseado cuando se ingresa un decimal con coma o un negativo", () => {
    const onChange = vi.fn();
    render(
      <Numeric
        item={BASE_ITEM}
        value={{ kind: "NUMERICA", value: null }}
        onChange={onChange}
      />,
    );

    const input = screen.getByLabelText("Su respuesta");

    fireEvent.change(input, { target: { value: "3,14" } });
    expect(onChange).toHaveBeenLastCalledWith({ kind: "NUMERICA", value: 3.14 });

    fireEvent.change(input, { target: { value: "-18,5" } });
    expect(onChange).toHaveBeenLastCalledWith({ kind: "NUMERICA", value: -18.5 });
  });

  it("emite null cuando el campo queda vacío", () => {
    const onChange = vi.fn();
    render(
      <Numeric
        item={BASE_ITEM}
        value={{ kind: "NUMERICA", value: 25 }}
        onChange={onChange}
      />,
    );

    const input = screen.getByLabelText("Su respuesta");
    expect(input).toHaveValue("25");

    fireEvent.change(input, { target: { value: "" } });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ kind: "NUMERICA", value: null });
    expect(input).not.toHaveAttribute("aria-invalid");
  });

  it("rechaza texto inválido y notación exponencial sin emitir onChange y mostrando error accesible", () => {
    const onChange = vi.fn();
    render(
      <Numeric
        item={BASE_ITEM}
        value={{ kind: "NUMERICA", value: null }}
        onChange={onChange}
      />,
    );

    const input = screen.getByLabelText("Su respuesta");

    fireEvent.change(input, { target: { value: "abc" } });
    expect(onChange).not.toHaveBeenCalled();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Ingrese un número válido.");
    expect(screen.getByRole("alert")).toHaveTextContent("Ingrese un número válido.");

    fireEvent.change(input, { target: { value: "1e5" } });
    expect(onChange).not.toHaveBeenCalled();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Ingrese un número válido.");

    // Signo suelto: no muestra error al escribir, pero sí al perder el foco.
    fireEvent.change(input, { target: { value: "-" } });
    expect(onChange).not.toHaveBeenCalled();
    expect(input).not.toHaveAttribute("aria-invalid");

    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Ingrese un número válido.");
  });

  it("rechaza valores fuera de rango (|valor| >= 1e8) sin emitir onChange", () => {
    const onChange = vi.fn();
    render(
      <Numeric
        item={BASE_ITEM}
        value={{ kind: "NUMERICA", value: null }}
        onChange={onChange}
      />,
    );

    const input = screen.getByLabelText("Su respuesta");

    fireEvent.change(input, { target: { value: String(NUMERIC_ABS_LIMIT) } });
    expect(onChange).not.toHaveBeenCalled();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("El número excede el rango permitido.");

    fireEvent.change(input, { target: { value: String(-NUMERIC_ABS_LIMIT) } });
    expect(onChange).not.toHaveBeenCalled();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "El número excede el rango permitido.",
    );
  });

  it("sincroniza el texto al recibir un value externo nuevo o cambiar de ítem", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <Numeric
        item={BASE_ITEM}
        value={{ kind: "NUMERICA", value: 10 }}
        onChange={onChange}
      />,
    );

    const input = screen.getByLabelText("Su respuesta");
    expect(input).toHaveValue("10");

    // Valor externo actualizado
    rerender(
      <Numeric
        item={BASE_ITEM}
        value={{ kind: "NUMERICA", value: -7.25 }}
        onChange={onChange}
      />,
    );
    expect(input).toHaveValue("-7.25");

    // Texto inválido local limpiado al resetear externamente a null
    fireEvent.change(input, { target: { value: "xyz" } });
    expect(input).toHaveAttribute("aria-invalid", "true");

    rerender(
      <Numeric
        item={BASE_ITEM}
        value={{ kind: "NUMERICA", value: null }}
        onChange={onChange}
      />,
    );
    expect(input).toHaveValue("");
    expect(input).not.toHaveAttribute("aria-invalid");

    // Cambio de ítem con el mismo valor (null) también limpia texto inválido previo
    fireEvent.change(input, { target: { value: "xyz" } });
    rerender(
      <Numeric
        item={{ ...BASE_ITEM, id: 102 }}
        value={{ kind: "NUMERICA", value: null }}
        onChange={onChange}
      />,
    );
    expect(input).toHaveValue("");
    expect(input).not.toHaveAttribute("aria-invalid");
  });

  it("evita la propagación de ArrowLeft y ArrowRight dentro del input y respeta disabled", () => {
    const parentKeyDown = vi.fn();
    const onChange = vi.fn();

    const { rerender } = render(
      <div onKeyDown={parentKeyDown}>
        <Numeric
          item={BASE_ITEM}
          value={{ kind: "NUMERICA", value: 123 }}
          onChange={onChange}
        />
      </div>,
    );

    const input = screen.getByLabelText("Su respuesta");

    fireEvent.keyDown(input, { key: "ArrowLeft" });
    fireEvent.keyDown(input, { key: "ArrowRight" });
    expect(parentKeyDown).not.toHaveBeenCalled();

    // Otras teclas sí pueden propagarse normalmente
    fireEvent.keyDown(input, { key: "Enter" });
    expect(parentKeyDown).toHaveBeenCalledTimes(1);

    rerender(
      <div onKeyDown={parentKeyDown}>
        <Numeric
          item={BASE_ITEM}
          value={{ kind: "NUMERICA", value: 123 }}
          onChange={onChange}
          disabled
        />
      </div>,
    );
    expect(input).toBeDisabled();
  });
});
