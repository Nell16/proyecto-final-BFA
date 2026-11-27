import { useEffect, useId, useRef, useState } from "react";
import { AlertCircle } from "lucide-react";

import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import {
  NUMERIC_ABS_LIMIT,
  validateAnswer,
  type AnswerRendererProps,
} from "../answer-value";

type ParsedNumeric =
  | { status: "empty" }
  | { status: "incomplete" }
  | { status: "valid"; value: number }
  | { status: "invalid"; error: string };

const COMPLETE_NUMERIC_RE = /^-?(?:\d+(?:[.,]\d+)?|[.,]\d+)$/;
const INCOMPLETE_NUMERIC_RE = /^-?(?:\d+[.,]|[.,])?$/;

function getInvalidNumericMessage(candidate: number): string {
  return (
    validateAnswer({ kind: "NUMERICA", value: candidate }) ??
    "Ingrese un número válido."
  );
}

function parseNumericInput(raw: string): ParsedNumeric {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { status: "empty" };
  }

  if (COMPLETE_NUMERIC_RE.test(trimmed)) {
    const normalized = trimmed.replace(",", ".");
    const parsed = Number(normalized);

    if (!Number.isFinite(parsed)) {
      return {
        status: "invalid",
        error: getInvalidNumericMessage(NUMERIC_ABS_LIMIT),
      };
    }

    const cleanValue = Object.is(parsed, -0) ? 0 : parsed;
    const validationError = validateAnswer({
      kind: "NUMERICA",
      value: cleanValue,
    });
    if (validationError !== null) {
      return { status: "invalid", error: validationError };
    }

    return { status: "valid", value: cleanValue };
  }

  if (INCOMPLETE_NUMERIC_RE.test(trimmed)) {
    return { status: "incomplete" };
  }

  return {
    status: "invalid",
    error: getInvalidNumericMessage(Number.NaN),
  };
}

function formatNumericValue(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "";
  }
  return String(value);
}

/**
 * Renderer de respuesta numérica (`NUMERICA`) para el runner del participante.
 * Mantiene texto local para permitir escritura natural (coma o punto decimal y
 * signo negativo) y solo emite valores finitos dentro del rango del servidor.
 */
export function Numeric({
  item,
  value,
  onChange,
  disabled = false,
}: AnswerRendererProps<"NUMERICA">) {
  const inputId = useId();
  const errorId = useId();
  const hintId = useId();

  const [prevItemId, setPrevItemId] = useState(item.id);
  const [prevExternalValue, setPrevExternalValue] = useState<number | null>(
    value.value,
  );
  const [text, setText] = useState<string>(() =>
    formatNumericValue(value.value),
  );
  const [error, setError] = useState<string | null>(() =>
    validateAnswer(value),
  );

  // Último valor emitido o sincronizado externamente, para evitar emisiones duplicadas en blur.
  const lastCommittedValueRef = useRef<number | null>(value.value);

  useEffect(() => {
    lastCommittedValueRef.current = value.value;
  }, [item.id, value.value]);

  if (item.id !== prevItemId || !Object.is(value.value, prevExternalValue)) {
    const itemChanged = item.id !== prevItemId;
    setPrevItemId(item.id);
    setPrevExternalValue(value.value);

    const currentParsed = parseNumericInput(text);
    const matchesCurrentValid =
      !itemChanged &&
      currentParsed.status === "valid" &&
      Object.is(currentParsed.value, value.value);
    const matchesCurrentEmpty =
      !itemChanged &&
      currentParsed.status === "empty" &&
      value.value === null;

    if (!matchesCurrentValid && !matchesCurrentEmpty) {
      setText(formatNumericValue(value.value));
      setError(validateAnswer(value));
    }
  }

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const nextText = event.target.value;
    setText(nextText);

    const parsed = parseNumericInput(nextText);
    if (parsed.status === "empty") {
      setError(null);
      lastCommittedValueRef.current = null;
      onChange({ kind: "NUMERICA", value: null });
      return;
    }

    if (parsed.status === "valid") {
      setError(null);
      lastCommittedValueRef.current = parsed.value;
      onChange({ kind: "NUMERICA", value: parsed.value });
      return;
    }

    if (parsed.status === "incomplete") {
      setError(null);
      return;
    }

    setError(parsed.error);
  }

  function handleBlur() {
    const parsed = parseNumericInput(text);
    if (parsed.status === "empty") {
      setError(null);
      if (lastCommittedValueRef.current !== null) {
        lastCommittedValueRef.current = null;
        onChange({ kind: "NUMERICA", value: null });
      }
      return;
    }

    if (parsed.status === "valid") {
      setError(null);
      if (!Object.is(lastCommittedValueRef.current, parsed.value)) {
        lastCommittedValueRef.current = parsed.value;
        onChange({ kind: "NUMERICA", value: parsed.value });
      }
      return;
    }

    if (parsed.status === "incomplete") {
      setError(getInvalidNumericMessage(Number.NaN));
      return;
    }

    setError(parsed.error);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.stopPropagation();
    }
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={inputId} className="text-sm font-medium text-foreground">
        Su respuesta
      </Label>
      <Input
        id={inputId}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        placeholder="Ingrese un número"
        value={text}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : hintId}
        onChange={handleChange}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        className="h-12 max-w-xs border-input bg-input-background font-mono text-base tabular-nums focus-visible:ring-[3px] focus-visible:ring-ring aria-invalid:border-status-danger-solid aria-invalid:ring-2 aria-invalid:ring-status-danger-bg"
      />
      {error ? (
        <p
          id={errorId}
          role="alert"
          className="flex items-center gap-1.5 text-xs text-status-danger-fg"
        >
          <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : (
        <p id={hintId} className="text-xs text-muted-foreground">
          Puede usar punto o coma decimal y signo negativo.
        </p>
      )}
    </div>
  );
}
