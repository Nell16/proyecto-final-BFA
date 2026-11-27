import type { ReactNode } from "react";
import { cn } from "../../../app/components/ui/utils";
import { TONE_SURFACE, type Tone } from "./tones";

/** Badge «soft bordered» con tono semántico, para estados que `StatusBadge` no cubre (calificación, revisión). */
export function ToneBadge({ tone, icon, children, className }: { tone: Tone; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <span
      data-tone={tone}
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium [&>svg]:size-3.5 [&>svg]:shrink-0",
        TONE_SURFACE[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}
