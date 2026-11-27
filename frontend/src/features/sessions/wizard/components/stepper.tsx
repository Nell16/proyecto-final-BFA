import { Check } from "lucide-react";
import { cn } from "../../../../app/components/ui/utils";

export interface StepperStep {
  id: string;
  label: string;
}

interface StepperProps {
  steps: readonly StepperStep[];
  /** Índice (0-based) del paso actual. */
  current: number;
  /** Índice máximo al que se puede volver/avanzar con clic. */
  maxReachable: number;
  onSelect: (index: number) => void;
  disabled?: boolean;
}

export function Stepper({ steps, current, maxReachable, onSelect, disabled }: StepperProps) {
  return (
    <nav aria-label="Pasos de creación de sesión">
      <ol className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        {steps.map((step, index) => {
          const isCurrent = index === current;
          const isDone = index < current;
          const canSelect = !disabled && !isCurrent && index <= maxReachable;
          const body = (
            <>
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums",
                  isCurrent && "border-primary bg-primary text-primary-foreground",
                  isDone && "border-success-border bg-success-muted text-success-foreground",
                  !isCurrent && !isDone && "border-border bg-muted text-muted-foreground",
                )}
              >
                {isDone ? <Check className="size-4" /> : index + 1}
              </span>
              <span className={cn("text-sm", isCurrent ? "font-semibold text-foreground" : "text-muted-foreground")}>
                {step.label}
              </span>
            </>
          );
          return (
            <li
              key={step.id}
              aria-current={isCurrent ? "step" : undefined}
              className="flex flex-1 items-center gap-3 sm:last:flex-none"
            >
              {canSelect ? (
                <button
                  type="button"
                  onClick={() => onSelect(index)}
                  className="flex items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {body}
                </button>
              ) : (
                <span className="flex items-center gap-2">{body}</span>
              )}
              {index < steps.length - 1 && (
                <span aria-hidden="true" className="hidden h-px flex-1 bg-border sm:block" />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
