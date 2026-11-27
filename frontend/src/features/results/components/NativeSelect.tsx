import type { ComponentProps } from "react";
import { cn } from "../../../app/components/ui/utils";

/**
 * `<select>` nativo con el aspecto de los inputs del sistema. Nativo a propósito: teclado y lectores de
 * pantalla funcionan sin configuración y el valor mostrado siempre es el controlado por el padre.
 */
export function NativeSelect({ className, ...props }: ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "h-9 rounded-md border border-input bg-input-background px-3 text-sm text-foreground shadow-xs outline-none",
        "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
