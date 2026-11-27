import type { ReactNode } from "react";
import { AlertCircle, AlertTriangle, Info } from "lucide-react";
import { cn } from "../../../app/components/ui/utils";
import { TONE_SURFACE, type Tone } from "./tones";

const ICONS = { info: Info, warning: AlertTriangle, danger: AlertCircle, neutral: Info, success: Info } as const;

/**
 * Aviso persistente en línea (ui-style-spec §3.5). `danger` usa `role="alert"`; el resto `role="status"`.
 * Los avisos de seguridad o confidencialidad usan tono `info` o `warning`, nunca `danger`.
 */
export function InlineNotice({
  tone = "info",
  title,
  children,
  action,
  className,
}: {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const Icon = ICONS[tone];
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn("flex items-start gap-3 rounded-lg border px-4 py-3 text-sm", TONE_SURFACE[tone], className)}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1 space-y-0.5">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className="leading-relaxed">{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
