import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import type { RuntimeItem } from "../../../../api/schemas/runtime";
import { OPEN_TEXT_MAX_LENGTH, OpenText } from "../OpenText";

function makeItem(overrides: Partial<RuntimeItem> = {}): RuntimeItem {
  return {
    id: 101,
    order: 1,
    itemType: "RAZONAMIENTO_VERBAL",
    responseType: "TEXTO_ABIERTO",
    prompt: "Describe el patrón observado en la secuencia.",
    images: [],
    options: [],
    ...overrides,
  };
}

describe("OpenText", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("asocia el label al enunciado, muestra instrucción y contador inicial", () => {
    render(
      <OpenText
        item={makeItem({ instruction: "Sé claro y conciso." })}
        value={{ kind: "TEXTO_ABIERTO", text: "Hola" }}
        onChange={vi.fn()}
      />,
    );

    const textarea = screen.getByLabelText("Describe el patrón observado en la secuencia.");
    expect(textarea).toHaveValue("Hola");
    expect(textarea).toHaveAttribute("maxlength", String(OPEN_TEXT_MAX_LENGTH));
    expect(screen.getByText("Sé claro y conciso.")).toBeInTheDocument();
    expect(screen.getByText(`4 / ${OPEN_TEXT_MAX_LENGTH}`)).toBeInTheDocument();
  });

  it("emite onChange AL INSTANTE en cada cambio (sin debounce ni texto pendiente en el renderer)", () => {
    const onChange = vi.fn();

    render(
      <OpenText
        item={makeItem()}
        value={{ kind: "TEXTO_ABIERTO", text: "" }}
        onChange={onChange}
      />,
    );

    const textarea = screen.getByLabelText("Describe el patrón observado en la secuencia.");

    fireEvent.change(textarea, { target: { value: "Prim" } });
    expect(textarea).toHaveValue("Prim");
    expect(screen.getByText(`4 / ${OPEN_TEXT_MAX_LENGTH}`)).toBeInTheDocument();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith({ kind: "TEXTO_ABIERTO", text: "Prim" });

    fireEvent.change(textarea, { target: { value: "Primera respuesta" } });
    expect(textarea).toHaveValue("Primera respuesta");
    expect(screen.getByText(`17 / ${OPEN_TEXT_MAX_LENGTH}`)).toBeInTheDocument();
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith({ kind: "TEXTO_ABIERTO", text: "Primera respuesta" });

    // No hay timers ni emisiones diferidas.
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("blur y desmontar no emiten nada extra: no queda texto pendiente que pueda irse a otro ítem", () => {
    const onChange = vi.fn();

    const { unmount } = render(
      <OpenText
        item={makeItem()}
        value={{ kind: "TEXTO_ABIERTO", text: "" }}
        onChange={onChange}
      />,
    );

    const textarea = screen.getByLabelText("Describe el patrón observado en la secuencia.");
    fireEvent.change(textarea, { target: { value: "Valor" } });
    expect(onChange).toHaveBeenCalledTimes(1);

    fireEvent.blur(textarea);
    unmount();
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("F2-FIX-1 ALTO 2 · cambiar de ítem sin blur no reasigna el texto escrito al ítem nuevo", () => {
    const onChangeItem1 = vi.fn();
    const onChangeItem2 = vi.fn();
    const item1 = makeItem({ id: 101 });
    const item2 = makeItem({ id: 102, prompt: "Segundo ítem abierto" });

    const { rerender } = render(
      <OpenText item={item1} value={{ kind: "TEXTO_ABIERTO", text: "" }} onChange={onChangeItem1} />,
    );
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "texto del ítem 1" } });
    expect(onChangeItem1).toHaveBeenCalledWith({ kind: "TEXTO_ABIERTO", text: "texto del ítem 1" });

    // Se cambia de ítem (mismo renderer, otro `item`) sin blur ni espera.
    rerender(<OpenText item={item2} value={{ kind: "TEXTO_ABIERTO", text: "" }} onChange={onChangeItem2} />);
    expect(screen.getByRole("textbox")).toHaveValue("");

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(onChangeItem2).not.toHaveBeenCalled(); // el texto del ítem 1 no llega al 2
    expect(onChangeItem1).toHaveBeenCalledTimes(1);
  });

  it("adopta un cambio externo del valor (restauración) cuando el padre lo actualiza", () => {
    const { rerender } = render(
      <OpenText item={makeItem()} value={{ kind: "TEXTO_ABIERTO", text: "uno" }} onChange={vi.fn()} />,
    );
    rerender(<OpenText item={makeItem()} value={{ kind: "TEXTO_ABIERTO", text: "restaurado" }} onChange={vi.fn()} />);
    expect(screen.getByRole("textbox")).toHaveValue("restaurado");
  });

  it("respeta el límite OPEN_TEXT_MAX_LENGTH (4000), actualiza el contador y conserva espacios", () => {
    expect(OPEN_TEXT_MAX_LENGTH).toBe(4000);
    const onChange = vi.fn();

    render(
      <OpenText
        item={makeItem()}
        value={{ kind: "TEXTO_ABIERTO", text: "" }}
        onChange={onChange}
      />,
    );

    const textarea = screen.getByLabelText("Describe el patrón observado en la secuencia.");
    const oversized = `${"a".repeat(3998)}  extra`;

    fireEvent.change(textarea, { target: { value: oversized } });

    const expected = `${"a".repeat(3998)}  `;
    expect(textarea).toHaveValue(expected);
    expect(screen.getByText(`${OPEN_TEXT_MAX_LENGTH} / ${OPEN_TEXT_MAX_LENGTH}`)).toBeInTheDocument();

    expect(onChange).toHaveBeenCalledWith({
      kind: "TEXTO_ABIERTO",
      text: expected,
    });
  });

  it("elimina '\\u0000' del texto antes de actualizar y emitir", () => {
    const onChange = vi.fn();

    render(
      <OpenText
        item={makeItem()}
        value={{ kind: "TEXTO_ABIERTO", text: "" }}
        onChange={onChange}
      />,
    );

    const textarea = screen.getByLabelText("Describe el patrón observado en la secuencia.");
    fireEvent.change(textarea, { target: { value: "Texto\u0000 limpio\u0000!" } });

    expect(textarea).toHaveValue("Texto limpio!");
    expect(screen.getByText(`13 / ${OPEN_TEXT_MAX_LENGTH}`)).toBeInTheDocument();

    expect(onChange).toHaveBeenCalledWith({
      kind: "TEXTO_ABIERTO",
      text: "Texto limpio!",
    });
  });

  it("detiene la propagación de teclas (flechas, letras, números) fuera del textarea", () => {
    const parentKeyDown = vi.fn();
    const parentKeyUp = vi.fn();

    render(
      <div onKeyDown={parentKeyDown} onKeyUp={parentKeyUp}>
        <OpenText
          item={makeItem()}
          value={{ kind: "TEXTO_ABIERTO", text: "" }}
          onChange={vi.fn()}
        />
      </div>,
    );

    const textarea = screen.getByLabelText("Describe el patrón observado en la secuencia.");

    for (const key of ["ArrowLeft", "ArrowRight", "a", "A", "1"]) {
      fireEvent.keyDown(textarea, { key });
      fireEvent.keyUp(textarea, { key });
    }

    expect(parentKeyDown).not.toHaveBeenCalled();
    expect(parentKeyUp).not.toHaveBeenCalled();
  });

  it("deshabilita el textarea y no emite cambios cuando disabled es true", () => {
    const onChange = vi.fn();

    render(
      <OpenText
        item={makeItem()}
        value={{ kind: "TEXTO_ABIERTO", text: "Bloqueado" }}
        onChange={onChange}
        disabled
      />,
    );

    const textarea = screen.getByLabelText("Describe el patrón observado en la secuencia.");
    expect(textarea).toBeDisabled();

    fireEvent.change(textarea, { target: { value: "Intento" } });
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(textarea).toHaveValue("Bloqueado");
    expect(onChange).not.toHaveBeenCalled();
  });
});
