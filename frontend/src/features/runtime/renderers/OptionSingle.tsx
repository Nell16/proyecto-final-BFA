import { Fragment, useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "../../../app/components/ui/utils";
import type { RuntimeImage, RuntimeOption } from "../../../api/schemas/runtime";
import type { AnswerRendererProps } from "../answer-value";

export interface OptionSingleProps extends AnswerRendererProps<"OPCION_UNICA"> {
  /** Habilita atajos de teclado A–Z y 1–9 cuando el foco está fuera del grupo. */
  hotkeysActive?: boolean;
  /** ID del elemento enunciado para enlazar con `aria-labelledby`. */
  "aria-labelledby"?: string;
  /** Renderizador opcional de imágenes de cada opción. */
  renderImage?: (image: RuntimeImage) => ReactNode;
}

interface HotkeyMatch {
  option: RuntimeOption;
  index: number;
}

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function findOptionByHotkey(key: string, options: readonly RuntimeOption[]): HotkeyMatch | null {
  if (/^[a-zA-Z]$/.test(key)) {
    const upper = key.toUpperCase();
    const index = options.findIndex((opt) => opt.label.trim().toUpperCase() === upper);
    return index >= 0 ? { option: options[index], index } : null;
  }

  if (/^[1-9]$/.test(key)) {
    const index = Number(key) - 1;
    if (index >= 0 && index < options.length) {
      return { option: options[index], index };
    }
  }

  return null;
}

function getImageGridClass(optionCount: number): string {
  if (optionCount <= 2) return "grid grid-cols-1 sm:grid-cols-2 gap-3";
  if (optionCount <= 4) return "grid grid-cols-2 lg:grid-cols-4 gap-3";
  return "grid grid-cols-2 md:grid-cols-3 gap-3";
}

function getOptionDisplayText(option: RuntimeOption): string | null {
  const trimmedText = option.text?.trim();
  if (trimmedText) return trimmedText;

  // Fallback textual mientras no exista componente reutilizable de imagen autenticada del runner.
  const altTexts = option.images
    .map((img) => img.altText?.trim())
    .filter((alt): alt is string => Boolean(alt));
  return altTexts.length > 0 ? altTexts.join(" ") : null;
}

/**
 * Renderer de selección única (`OPCION_UNICA`) para el runner de evaluación.
 * Implementa `role="radiogroup"`, navegación ↑/↓ y atajos A–Z / 1–9 sin capturar ←/→.
 */
export function OptionSingle({
  item,
  value,
  onChange,
  disabled = false,
  hotkeysActive = false,
  "aria-labelledby": ariaLabelledBy,
  renderImage,
}: OptionSingleProps) {
  const fallbackLabelId = useId();
  const groupRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const options = item.options;
  const selectedIndex = options.findIndex((opt) => opt.id === value.optionId);
  const activeTabIndex = selectedIndex >= 0 ? selectedIndex : 0;

  const selectOption = (optionId: number) => {
    if (disabled) return;
    if (value.optionId === optionId) return;
    onChange({ kind: "OPCION_UNICA", optionId });
  };

  useEffect(() => {
    if (!hotkeysActive || disabled) return;

    const handleWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      if (isEditableElement(event.target)) return;
      if (event.target instanceof Node && groupRef.current?.contains(event.target)) return;

      const match = findOptionByHotkey(event.key, options);
      if (!match) return;

      event.preventDefault();
      if (value.optionId !== match.option.id) {
        onChange({ kind: "OPCION_UNICA", optionId: match.option.id });
      }
    };

    window.addEventListener("keydown", handleWindowKeyDown);
    return () => window.removeEventListener("keydown", handleWindowKeyDown);
  }, [hotkeysActive, disabled, options, value.optionId, onChange]);

  const handleGroupKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (options.length === 0) return;
      event.preventDefault();

      const focusedIndex = optionRefs.current.findIndex((el) => el === document.activeElement);
      const currentIndex = focusedIndex >= 0 ? focusedIndex : activeTabIndex;
      const delta = event.key === "ArrowDown" ? 1 : -1;
      const nextIndex = (currentIndex + delta + options.length) % options.length;

      optionRefs.current[nextIndex]?.focus();
      selectOption(options[nextIndex].id);
      return;
    }

    const match = findOptionByHotkey(event.key, options);
    if (!match) return;

    event.preventDefault();
    optionRefs.current[match.index]?.focus();
    selectOption(match.option.id);
  };

  const labelledById = ariaLabelledBy || fallbackLabelId;
  const fallbackLabelText = item.prompt?.trim() || "Opciones de respuesta";
  const hasImageOptions = Boolean(renderImage) && options.some((opt) => opt.images.length > 0);

  return (
    <div className="w-full">
      {!ariaLabelledBy && (
        <span id={fallbackLabelId} className="sr-only">
          {fallbackLabelText}
        </span>
      )}

      <div
        ref={groupRef}
        role="radiogroup"
        aria-labelledby={labelledById}
        aria-disabled={disabled ? true : undefined}
        onKeyDown={handleGroupKeyDown}
        className={hasImageOptions ? getImageGridClass(options.length) : "flex flex-col gap-3"}
      >
        {options.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay opciones disponibles para este ítem.</p>
        ) : (
          options.map((option, index) => {
            const isSelected = value.optionId === option.id;
            const displayText = getOptionDisplayText(option);
            const hasOptionImages = Boolean(renderImage) && option.images.length > 0;

            return (
              <button
                key={option.id}
                ref={(el) => {
                  optionRefs.current[index] = el;
                }}
                type="button"
                role="radio"
                aria-checked={isSelected}
                aria-disabled={disabled ? true : undefined}
                disabled={disabled}
                tabIndex={index === activeTabIndex ? 0 : -1}
                onClick={() => selectOption(option.id)}
                onContextMenu={(e) => e.preventDefault()}
                className={cn(
                  "group flex w-full rounded-lg border-2 text-left transition-colors select-none",
                  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring",
                  hasImageOptions
                    ? "min-h-[148px] flex-col justify-between gap-3 p-4"
                    : "min-h-12 items-center gap-3 px-4 py-3",
                  isSelected
                    ? "border-primary bg-accent/60 text-accent-foreground ring-2 ring-primary/20"
                    : "border-border bg-card text-card-foreground",
                  disabled
                    ? "cursor-not-allowed opacity-60"
                    : isSelected
                      ? "cursor-pointer"
                      : "cursor-pointer hover:border-border-strong hover:bg-muted/40",
                )}
              >
                {hasImageOptions ? (
                  <>
                    <span className="flex w-full items-center justify-between gap-2">
                      <span
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
                          "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors",
                          isSelected
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-input bg-input-background",
                        )}
                      >
                        {isSelected && <Check className="h-3.5 w-3.5 stroke-[2.5]" />}
                      </span>
                    </span>

                    {hasOptionImages ? (
                      <>
                        <span className="flex w-full flex-1 items-center justify-center overflow-hidden rounded border border-border/60 bg-white p-2">
                          <span className="flex w-full flex-wrap items-center justify-center gap-2">
                            {option.images.map((image) => (
                              <Fragment key={image.id}>{renderImage!(image)}</Fragment>
                            ))}
                          </span>
                        </span>
                        {option.text?.trim() ? (
                          <span className="w-full text-center text-sm font-medium leading-snug text-foreground">
                            {option.text.trim()}
                          </span>
                        ) : (
                          <span className="sr-only">{displayText ?? `Opción ${option.label}`}</span>
                        )}
                      </>
                    ) : (
                      <span className="flex flex-1 items-center justify-center text-center text-sm font-medium leading-snug text-foreground">
                        {displayText ?? `Opción ${option.label}`}
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    <span
                      className={cn(
                        "flex h-7 min-w-7 shrink-0 items-center justify-center rounded-md px-1.5 font-mono text-xs font-semibold transition-colors",
                        isSelected
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {option.label}
                    </span>

                    <span className="flex-1 text-sm font-medium leading-snug text-foreground">
                      {displayText ?? `Opción ${option.label}`}
                    </span>

                    <span
                      aria-hidden="true"
                      className={cn(
                        "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors",
                        isSelected
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-input bg-input-background",
                      )}
                    >
                      {isSelected && <Check className="h-3.5 w-3.5 stroke-[2.5]" />}
                    </span>
                  </>
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
