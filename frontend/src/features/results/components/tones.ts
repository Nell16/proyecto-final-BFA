export type Tone = "success" | "warning" | "danger" | "info" | "neutral";

/** Clases de superficie por tono semántico (tokens `--status-*` de ui-style-spec; sin colores crudos). */
export const TONE_SURFACE: Record<Tone, string> = {
  success: "border-success-border bg-success-muted text-success-foreground",
  warning: "border-warning-border bg-warning-muted text-warning-foreground",
  danger: "border-danger-border bg-danger-muted text-danger-foreground",
  info: "border-info-border bg-info-muted text-info-foreground",
  neutral: "border-neutral-border bg-neutral-muted text-neutral-foreground",
};
