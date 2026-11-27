import * as React from "react";
import { AlertCircle, AlertTriangle, Info } from "lucide-react";
import { Label } from "../../../../app/components/ui/label";
import { cn } from "../../../../app/components/ui/utils";

export const NativeSelect = React.forwardRef<HTMLSelectElement, React.ComponentProps<"select">>(
  ({ className, ...props }, ref) => (
    <select
      ref={ref}
      data-slot="native-select"
      className={cn(
        "h-9 w-full rounded-md border border-input bg-input-background px-3 text-sm text-foreground outline-none",
        "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
        "disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger",
        className,
      )}
      {...props}
    />
  ),
);
NativeSelect.displayName = "NativeSelect";

interface FieldProps {
  id: string;
  label: string;
  required?: boolean;
  error?: string;
  help?: string;
  className?: string;
  children: React.ReactNode;
}

/** Label + control + ayuda/error inline (docs/refactor/ui-style-spec.md §3.3). */
export function Field({ id, label, required, error, help, className, children }: FieldProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={id} className="text-sm font-medium">
        {label}
        {required && (
          <span aria-hidden="true" className="text-danger-foreground">
            {" "}
            *
          </span>
        )}
      </Label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="flex items-center gap-1 text-xs text-danger-foreground">
          <AlertCircle aria-hidden="true" className="size-3.5 shrink-0" />
          {error}
        </p>
      ) : help ? (
        <p id={`${id}-help`} className="text-xs text-muted-foreground">
          {help}
        </p>
      ) : null}
    </div>
  );
}

type Tone = "info" | "warning" | "danger";

const TONE_CLASSES: Record<Tone, string> = {
  info: "border-info-border bg-info-muted text-info-foreground",
  warning: "border-warning-border bg-warning-muted text-warning-foreground",
  danger: "border-danger-border bg-danger-muted text-danger-foreground",
};

const TONE_ICON: Record<Tone, React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = {
  info: Info,
  warning: AlertTriangle,
  danger: AlertCircle,
};

interface InlineAlertProps {
  tone: Tone;
  title?: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

/** Aviso persistente inline con tokens de estado (spec §3.5). */
export function InlineAlert({ tone, title, children, action, className }: InlineAlertProps) {
  const Icon = TONE_ICON[tone];
  return (
    <div
      role={tone === "info" ? "status" : "alert"}
      className={cn("flex items-start gap-3 rounded-lg border px-4 py-3 text-sm", TONE_CLASSES[tone], className)}
    >
      <Icon aria-hidden={true} className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1 space-y-1">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className="text-sm">{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
