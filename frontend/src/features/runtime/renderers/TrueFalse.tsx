import * as React from "react";
import { Check } from "lucide-react";

import type { RuntimeImage, RuntimeOption } from "../../../api/schemas/runtime";
import { cn } from "../../../app/components/ui/utils";
import type { AnswerRendererProps } from "../answer-value";

export interface TrueFalseProps extends AnswerRendererProps<"VERDADERO_FALSO"> {
  /** Habilita atajos globales V/F/1/2 fuera de campos editables cuando el foco no está en el grupo. */
  hotkeysActive?: boolean;
  /** Renderizador opcional de imágenes de cada opción. */
  renderImage?: (image: RuntimeImage) => React.ReactNode;
}


function getImageGridClass(optionCount: number): string {
  if (optionCount <= 2) return "grid grid-cols-1 sm:grid-cols-2 gap-3";
  if (optionCount <= 4) return "grid grid-cols-2 lg:grid-cols-4 gap-3";
  return "grid grid-cols-2 md:grid-cols-3 gap-3";
}

function resolveOptionLabel(option: RuntimeOption): string {
  const trimmedText = option.text?.trim();
  return trimmedText && trimmedText.length > 0 ? option.text! : option.label;
}

function normalizeToken(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toUpperCase();
}

const TRUE_WORDS = ["VERDADERO", "TRUE", "V"];
const FALSE_WORDS = ["FALSO", "FALSE", "F"];

function matchesWords(option: RuntimeOption, words: readonly string[]): boolean {
  return [option.label, option.text].some((raw) => {
    const norm = normalizeToken(raw);
    if (norm.length === 0) return false;
    return words.some((word) => (word.length === 1 ? norm === word : norm === word || norm.startsWith(`${word} `)));
  });
}

/**
 * Índices de las opciones a las que apuntan las teclas V y F. Solo hay atajo de letra si hay exactamente una
 * opción «verdadero» y exactamente una «falso» distintas entre sí; si no, V/F quedan desactivados.
 */
function resolveLetterHotkeys(options: readonly RuntimeOption[]): { v: number; f: number } | null {
  if (options.length !== 2) return null;
  const trueIdx = options.flatMap((o, i) => (matchesWords(o, TRUE_WORDS) ? [i] : []));
  const falseIdx = options.flatMap((o, i) => (matchesWords(o, FALSE_WORDS) ? [i] : []));
  if (trueIdx.length !== 1 || falseIdx.length !== 1 || trueIdx[0] === falseIdx[0]) return null;
  return { v: trueIdx[0]!, f: falseIdx[0]! };
}

function resolveHotkeyIndex(key: string, letters: { v: number; f: number } | null): number | null {
  switch (key) {
    case "1":
      return 0;
    case "2":
      return 1;
    case "v":
    case "V":
      return letters ? letters.v : null;
    case "f":
    case "F":
      return letters ? letters.f : null;
    default:
      return null;
  }
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/**
 * Renderer de respuestas `VERDADERO_FALSO` (R-03c).
 * Usa `role="radiogroup"` + `<button role="radio">` nativos en lugar de Radix RadioGroup
 * para no capturar `ArrowLeft`/`ArrowRight`, reservados a la navegación entre ítems del runner.
 */
export function TrueFalse({
  item,
  value,
  onChange,
  disabled = false,
  hotkeysActive = false,
  renderImage,
}: TrueFalseProps) {
  const groupRef = React.useRef<HTMLDivElement>(null);
  const options = item.options;
  const isTwoOptions = options.length === 2;
  const letterHotkeys = React.useMemo(() => resolveLetterHotkeys(options), [options]);
  const hintFor = (index: number): string | null =>
    letterHotkeys ? (index === letterHotkeys.v ? "V" : index === letterHotkeys.f ? "F" : null) : String(index + 1);

  React.useEffect(() => {
    if (import.meta.env.DEV && options.length !== 2) {
      console.error(
        `[TrueFalse] El ítem ${item.id} esperaba exactamente 2 opciones para VERDADERO_FALSO, pero recibió ${options.length}. Se renderizará como lista.`,
      );
    }
  }, [item.id, options.length]);

  const selectOption = React.useCallback(
    (option: RuntimeOption | undefined) => {
      if (disabled || !option) return;
      if (value.optionId === option.id) return;
      onChange({ kind: "VERDADERO_FALSO", optionId: option.id });
    },
    [disabled, onChange, value.optionId],
  );

  React.useEffect(() => {
    if (!hotkeysActive || disabled) return;

    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      if (isEditableTarget(event.target)) return;
      // Si el foco ya está dentro del radiogroup, `onKeyDown` local gestiona el atajo una sola vez.
      if (event.target instanceof Node && groupRef.current?.contains(event.target)) {
        return;
      }

      const targetIndex = resolveHotkeyIndex(event.key, letterHotkeys);
      if (targetIndex === null) return;

      const targetOption = options[targetIndex];
      if (!targetOption) return;

      event.preventDefault();
      selectOption(targetOption);
    };

    window.addEventListener("keydown", handleWindowKeyDown);
    return () => {
      window.removeEventListener("keydown", handleWindowKeyDown);
    };
  }, [disabled, hotkeysActive, letterHotkeys, options, selectOption]);

  const handleGroupKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled || event.ctrlKey || event.metaKey || event.altKey) return;

    const targetIndex = resolveHotkeyIndex(event.key, letterHotkeys);
    if (targetIndex === null) return;

    const targetOption = options[targetIndex];
    if (!targetOption) return;

    event.preventDefault();
    selectOption(targetOption);
  };

  const groupLabel = item.prompt?.trim() || "Opciones de verdadero o falso";
  const hasImageOptions = Boolean(renderImage) && options.some((opt) => opt.images.length > 0);

  if (!isTwoOptions) {
    return (
      <div
        ref={groupRef}
        role="radiogroup"
        aria-label={groupLabel}
        aria-disabled={disabled || undefined}
        data-layout="fallback-list"
        onKeyDown={handleGroupKeyDown}
        className={hasImageOptions ? getImageGridClass(options.length) : "flex flex-col gap-3"}
      >
        {options.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay opciones disponibles para este ítem.</p>
        ) : (
          options.map((option) => {
            const isSelected = value.optionId === option.id;
            const visibleLabel = resolveOptionLabel(option);
            const hasOptionImages = Boolean(renderImage) && option.images.length > 0;

            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={isSelected}
                data-state={isSelected ? "checked" : "unchecked"}
                disabled={disabled}
                onClick={() => selectOption(option)}
                onContextMenu={(e) => e.preventDefault()}
                className={cn(
                  "flex w-full rounded-lg border-2 text-left text-sm font-medium transition-colors select-none",
                  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring",
                  "disabled:cursor-not-allowed disabled:opacity-60",
                  hasImageOptions
                    ? "min-h-[148px] flex-col justify-between gap-3 p-4"
                    : "min-h-12 items-center gap-3 px-4 py-3",
                  isSelected
                    ? "border-primary bg-accent/60 text-accent-foreground ring-2 ring-primary/20"
                    : "border-border bg-card text-foreground hover:border-border-strong hover:bg-muted/40",
                )}
              >
                {hasImageOptions ? (
                  <>
                    <span className="flex w-full items-center justify-between gap-2">
                      <span
                        aria-hidden="true"
                        className={cn(
                          "flex h-7 min-w-7 shrink-0 items-center justify-center rounded-md px-1.5 font-mono text-xs font-semibold transition-colors",
                          isSelected
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        {option.label}
                      </span>
                      <span
                        aria-hidden="true"
                        className={cn(
                          "flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors",
                          isSelected
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-input bg-input-background",
                        )}
                      >
                        {isSelected ? <Check className="size-3.5 stroke-[2.5]" /> : null}
                      </span>
                    </span>
                    {hasOptionImages ? (
                      <span className="flex w-full flex-1 items-center justify-center overflow-hidden rounded border border-border/60 bg-white p-2">
                        <span className="flex w-full flex-wrap items-center justify-center gap-2">
                          {option.images.map((image) => (
                            <React.Fragment key={image.id}>{renderImage!(image)}</React.Fragment>
                          ))}
                        </span>
                      </span>
                    ) : null}
                    <span className="w-full text-center text-sm font-medium leading-snug text-foreground">
                      {visibleLabel}
                    </span>
                  </>
                ) : (
                  <>
                    <span
                      aria-hidden="true"
                      className={cn(
                        "flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                        isSelected
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-input bg-input-background",
                      )}
                    >
                      {isSelected ? <span className="size-2 rounded-full bg-primary-foreground" /> : null}
                    </span>
                    <span className="flex-1 text-base font-medium leading-snug">{visibleLabel}</span>
                  </>
                )}
              </button>
            );
          })
        )}
      </div>
    );
  }

  if (hasImageOptions) {
    return (
      <div
        ref={groupRef}
        role="radiogroup"
        aria-label={groupLabel}
        aria-disabled={disabled || undefined}
        data-layout="segmented"
        onKeyDown={handleGroupKeyDown}
        className="grid grid-cols-1 gap-3 sm:grid-cols-2"
      >
        {options.map((option, index) => {
          const isSelected = value.optionId === option.id;
          const visibleLabel = resolveOptionLabel(option);
          const hotkeyHint = hintFor(index);
          const hasOptionImages = Boolean(renderImage) && option.images.length > 0;

          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              data-state={isSelected ? "checked" : "unchecked"}
              disabled={disabled}
              onClick={() => selectOption(option)}
              onContextMenu={(e) => e.preventDefault()}
              className={cn(
                "group flex min-h-[148px] w-full flex-col justify-between gap-3 rounded-lg border-2 p-4 text-left transition-colors select-none",
                "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring",
                "disabled:cursor-not-allowed disabled:opacity-60",
                isSelected
                  ? "border-primary bg-accent/60 text-accent-foreground ring-2 ring-primary/20"
                  : "border-border bg-card text-foreground hover:border-border-strong hover:bg-muted/40",
              )}
            >
              <span className="flex w-full items-center justify-between gap-2">
                {hotkeyHint ? (
                  <span
                    aria-hidden="true"
                    className={cn(
                      "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md font-mono text-xs font-semibold transition-colors",
                      isSelected
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {hotkeyHint}
                  </span>
                ) : (
                  <span />
                )}

                <span
                  aria-hidden="true"
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors",
                    isSelected
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-input bg-input-background",
                  )}
                >
                  {isSelected ? <Check className="size-3.5 stroke-[2.5]" /> : null}
                </span>
              </span>

              {hasOptionImages ? (
                <span className="flex w-full flex-1 items-center justify-center overflow-hidden rounded border border-border/60 bg-white p-2">
                  <span className="flex w-full flex-wrap items-center justify-center gap-2">
                    {option.images.map((image) => (
                      <React.Fragment key={image.id}>{renderImage!(image)}</React.Fragment>
                    ))}
                  </span>
                </span>
              ) : null}

              <span className="w-full text-center text-base font-semibold leading-snug text-foreground">
                {visibleLabel}
              </span>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label={groupLabel}
      aria-disabled={disabled || undefined}
      data-layout="segmented"
      onKeyDown={handleGroupKeyDown}
      className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-muted p-1.5 sm:grid-cols-2"
    >
      {options.map((option, index) => {
        const isSelected = value.optionId === option.id;
        const visibleLabel = resolveOptionLabel(option);
        const hotkeyHint = hintFor(index);

        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={isSelected}
            data-state={isSelected ? "checked" : "unchecked"}
            disabled={disabled}
            onClick={() => selectOption(option)}
            onContextMenu={(e) => e.preventDefault()}
            className={cn(
              "relative flex min-h-14 w-full items-center justify-center gap-3 rounded-lg border-2 px-5 py-3 text-base font-semibold transition-colors select-none",
              "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring",
              "disabled:cursor-not-allowed",
              isSelected
                ? "border-primary bg-primary text-primary-foreground shadow-[var(--shadow-xs)] disabled:opacity-75"
                : "border-transparent bg-card text-foreground shadow-[var(--shadow-xs)] hover:border-border-strong hover:bg-card disabled:opacity-60",
            )}
          >
            {hotkeyHint ? (
              <span
                aria-hidden="true"
                className={cn(
                  "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border font-mono text-xs font-semibold",
                  isSelected
                    ? "border-primary-foreground/30 bg-primary-foreground/15 text-primary-foreground"
                    : "border-border bg-muted text-muted-foreground",
                )}
              >
                {hotkeyHint}
              </span>
            ) : null}
            <span>{visibleLabel}</span>
            {isSelected ? <Check aria-hidden="true" className="size-4 shrink-0" /> : null}
          </button>
        );
      })}
    </div>
  );
}
