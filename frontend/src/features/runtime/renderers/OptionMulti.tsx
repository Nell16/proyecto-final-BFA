import { Fragment, useCallback, useEffect, useId, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import type { RuntimeImage, RuntimeOption } from "../../../api/schemas/runtime";
import { Checkbox } from "../../../app/components/ui/checkbox";
import { cn } from "../../../app/components/ui/utils";
import type { AnswerRendererProps } from "../answer-value";

export interface OptionMultiProps extends AnswerRendererProps<"OPCION_MULTIPLE"> {
  /** Activa atajos A–Z y 1–9 cuando el foco está fuera del grupo. */
  hotkeysActive?: boolean;
  /** ID del elemento enunciado que etiqueta al grupo (`aria-labelledby`). */
  "aria-labelledby"?: string;
  /** Renderizador opcional de imágenes de cada opción. */
  renderImage?: (image: RuntimeImage) => ReactNode;
}

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable;
}

function getImageGridClass(optionCount: number): string {
  if (optionCount <= 2) return "grid grid-cols-1 sm:grid-cols-2 gap-3";
  if (optionCount <= 4) return "grid grid-cols-2 lg:grid-cols-4 gap-3";
  return "grid grid-cols-2 md:grid-cols-3 gap-3";
}

function findOptionForKey(options: readonly RuntimeOption[], key: string): RuntimeOption | undefined {
  if (key.length !== 1) return undefined;

  if (/^[a-zA-Z]$/.test(key)) {
    const upperKey = key.toUpperCase();
    return options.find((opt) => opt.label.trim().toUpperCase() === upperKey);
  }

  if (/^[1-9]$/.test(key)) {
    const position = Number(key) - 1;
    return options[position];
  }

  return undefined;
}

export function OptionMulti({
  item,
  value,
  onChange,
  disabled = false,
  hotkeysActive = false,
  "aria-labelledby": externalLabelledBy,
  renderImage,
}: OptionMultiProps) {
  const baseId = useId();
  const groupRef = useRef<HTMLDivElement>(null);

  const fallbackPromptId = `${baseId}-prompt`;
  const hintId = `${baseId}-hint`;
  const groupLabelledBy = externalLabelledBy ?? fallbackPromptId;

  const selectedSet = new Set(value.optionIds);

  const toggleOption = useCallback(
    (optionId: number) => {
      if (disabled) return;
      const nextSet = new Set(value.optionIds);
      if (nextSet.has(optionId)) {
        nextSet.delete(optionId);
      } else {
        nextSet.add(optionId);
      }
      // Preservar siempre el orden canónico de `item.options`, no el orden de los clics.
      const orderedOptionIds = item.options
        .filter((opt) => nextSet.has(opt.id))
        .map((opt) => opt.id);

      onChange({ kind: "OPCION_MULTIPLE", optionIds: orderedOptionIds });
    },
    [disabled, item.options, onChange, value.optionIds],
  );

  const handleShortcutKey = useCallback(
    (event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "repeat" | "preventDefault">) => {
      if (disabled) return;
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") return;

      const matched = findOptionForKey(item.options, event.key);
      if (!matched) return;

      event.preventDefault();
      toggleOption(matched.id);
    },
    [disabled, item.options, toggleOption],
  );

  const handleGroupKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    handleShortcutKey(event);
  };

  useEffect(() => {
    if (!hotkeysActive || disabled) return;

    const onWindowKeyDown = (event: KeyboardEvent) => {
      // Si el foco ya está dentro del grupo, `handleGroupKeyDown` lo procesará al burbujear.
      if (event.target instanceof Node && groupRef.current?.contains(event.target)) {
        return;
      }
      if (isEditableElement(event.target)) return;
      handleShortcutKey(event);
    };

    window.addEventListener("keydown", onWindowKeyDown);
    return () => window.removeEventListener("keydown", onWindowKeyDown);
  }, [disabled, handleShortcutKey, hotkeysActive]);

  const hasImageOptions = Boolean(renderImage) && item.options.some((opt) => opt.images.length > 0);

  return (
    <div className="space-y-3 select-none" onContextMenu={(event) => event.preventDefault()}>
      {!externalLabelledBy && (
        <span id={fallbackPromptId} className="sr-only">
          {item.prompt?.trim() || "Opciones de respuesta múltiple"}
        </span>
      )}

      <p id={hintId} className="text-xs font-medium text-muted-foreground">
        Puede elegir varias opciones
      </p>

      <div
        ref={groupRef}
        role="group"
        aria-labelledby={groupLabelledBy}
        aria-describedby={hintId}
        onKeyDown={handleGroupKeyDown}
        className={hasImageOptions ? getImageGridClass(item.options.length) : "grid grid-cols-1 gap-3"}
      >
        {item.options.map((option) => {
          const isSelected = selectedSet.has(option.id);
          const checkboxId = `${baseId}-opt-${option.id}`;
          const displayText =
            option.text?.trim() ||
            option.images[0]?.altText?.trim() ||
            `Opción ${option.label}`;
          const hasOptionImages = Boolean(renderImage) && option.images.length > 0;

          if (hasImageOptions) {
            return (
              <div
                key={option.id}
                data-selected={isSelected ? "true" : "false"}
                className={cn(
                  "relative flex min-h-[148px] flex-col justify-between gap-3 rounded-lg border-2 p-4 transition-colors",
                  "has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring",
                  isSelected
                    ? "border-primary bg-accent/60 ring-2 ring-primary/20"
                    : "border-border bg-card",
                  !disabled && !isSelected && "hover:border-border-strong hover:bg-muted/40",
                  disabled && "cursor-not-allowed opacity-60",
                )}
              >
                <div className="flex w-full items-center justify-between gap-2">
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

                  <Checkbox
                    id={checkboxId}
                    checked={isSelected}
                    disabled={disabled}
                    onCheckedChange={() => toggleOption(option.id)}
                    className="relative z-10 size-5"
                  />
                </div>

                <label
                  htmlFor={checkboxId}
                  className={cn(
                    "flex flex-1 flex-col items-center justify-center gap-2 text-sm font-medium text-foreground after:absolute after:inset-0",
                    disabled ? "cursor-not-allowed" : "cursor-pointer",
                  )}
                >
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
                        <span className="sr-only">{displayText}</span>
                      )}
                    </>
                  ) : (
                    <span className="w-full text-center text-sm font-medium leading-snug text-foreground">
                      {displayText}
                    </span>
                  )}
                </label>
              </div>
            );
          }

          return (
            <div
              key={option.id}
              data-selected={isSelected ? "true" : "false"}
              className={cn(
                "relative flex min-h-12 items-center gap-3 rounded-lg border-2 px-4 py-3 transition-colors",
                "has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring",
                isSelected
                  ? "border-primary bg-accent/60 ring-2 ring-primary/20"
                  : "border-border bg-card",
                !disabled && !isSelected && "hover:border-border-strong hover:bg-muted/40",
                disabled && "cursor-not-allowed opacity-60",
              )}
            >
              <Checkbox
                id={checkboxId}
                checked={isSelected}
                disabled={disabled}
                onCheckedChange={() => toggleOption(option.id)}
                className="relative z-10 size-5"
              />

              <label
                htmlFor={checkboxId}
                className={cn(
                  "flex flex-1 items-center gap-3 text-sm font-medium text-foreground after:absolute after:inset-0",
                  disabled ? "cursor-not-allowed" : "cursor-pointer",
                )}
              >
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
                <span className="leading-snug">{displayText}</span>
              </label>
            </div>
          );
        })}
      </div>
    </div>
  );
}
