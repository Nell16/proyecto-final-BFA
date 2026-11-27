import * as React from "react";
import {
  Archive,
  Ban,
  CalendarClock,
  CheckCircle2,
  CircleDashed,
  ClockAlert,
  FileEdit,
  Globe,
  HelpCircle,
  Lock,
  PauseCircle,
  Play,
  Radio,
  ShieldCheck,
  Ticket,
  WifiOff,
  XCircle,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "./badge";
import { cn } from "./utils";

export type StatusDomain = "session" | "assignment" | "attempt" | "version";

export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

export type SessionStatus =
  | "PROGRAMADA"
  | "ABIERTA"
  | "PAUSADA"
  | "CERRADA"
  | "CANCELADA";

export type AssignmentStatus =
  | "ASIGNADO"
  | "EN_PROGRESO"
  | "COMPLETADO"
  | "ANULADO"
  | "EXPIRADO";

export type AttemptStatus =
  | "NO_INICIADO"
  | "EN_PROGRESO"
  | "COMPLETADO"
  | "INTERRUMPIDO"
  | "ANULADO";

export type VersionStatus =
  | "BORRADOR"
  | "EN_REVISION"
  | "APROBADO"
  | "PUBLICADO"
  | "RETIRADO";

export interface StatusMeta {
  label: string;
  tone: StatusTone;
  icon: LucideIcon;
  live?: boolean;
}

const SESSION_STATUS_MAP: Record<SessionStatus, StatusMeta> = {
  PROGRAMADA: {
    label: "Programada",
    tone: "info",
    icon: CalendarClock,
  },
  ABIERTA: {
    label: "Abierta (En vivo)",
    tone: "success",
    icon: Radio,
    live: true,
  },
  PAUSADA: {
    label: "Pausada",
    tone: "warning",
    icon: PauseCircle,
  },
  CERRADA: {
    label: "Cerrada",
    tone: "neutral",
    icon: Lock,
  },
  CANCELADA: {
    label: "Cancelada",
    tone: "danger",
    icon: Ban,
  },
};

const ASSIGNMENT_STATUS_MAP: Record<AssignmentStatus, StatusMeta> = {
  ASIGNADO: {
    label: "Asignado",
    tone: "neutral",
    icon: Ticket,
  },
  EN_PROGRESO: {
    label: "En progreso",
    tone: "info",
    icon: Play,
    live: true,
  },
  COMPLETADO: {
    label: "Completado",
    tone: "success",
    icon: CheckCircle2,
  },
  ANULADO: {
    label: "Anulado",
    tone: "danger",
    icon: XCircle,
  },
  EXPIRADO: {
    label: "Expirado",
    tone: "warning",
    icon: ClockAlert,
  },
};

const ATTEMPT_STATUS_MAP: Record<AttemptStatus, StatusMeta> = {
  NO_INICIADO: {
    label: "No iniciado",
    tone: "neutral",
    icon: CircleDashed,
  },
  EN_PROGRESO: {
    label: "En progreso",
    tone: "info",
    icon: Play,
    live: true,
  },
  COMPLETADO: {
    label: "Completado",
    tone: "success",
    icon: CheckCircle2,
  },
  INTERRUMPIDO: {
    label: "Interrumpido",
    tone: "warning",
    icon: WifiOff,
  },
  ANULADO: {
    label: "Anulado",
    tone: "danger",
    icon: XCircle,
  },
};

const VERSION_STATUS_MAP: Record<VersionStatus, StatusMeta> = {
  BORRADOR: {
    label: "Borrador",
    tone: "warning",
    icon: FileEdit,
  },
  EN_REVISION: {
    label: "En revisión",
    tone: "info",
    icon: FileEdit,
  },
  APROBADO: {
    label: "Aprobado",
    tone: "info",
    icon: ShieldCheck,
  },
  PUBLICADO: {
    label: "Publicado",
    tone: "success",
    icon: Globe,
  },
  RETIRADO: {
    label: "Retirado",
    tone: "neutral",
    icon: Archive,
  },
};

const DOMAIN_MAPS: Record<StatusDomain, Record<string, StatusMeta>> = {
  session: SESSION_STATUS_MAP,
  assignment: ASSIGNMENT_STATUS_MAP,
  attempt: ATTEMPT_STATUS_MAP,
  version: VERSION_STATUS_MAP,
};

const TONE_CLASSES: Record<StatusTone, string> = {
  success: "bg-success-muted text-success-foreground border-success-border",
  warning: "bg-warning-muted text-warning-foreground border-warning-border",
  danger: "bg-danger-muted text-danger-foreground border-danger-border",
  info: "bg-info-muted text-info-foreground border-info-border",
  neutral: "bg-neutral-muted text-neutral-foreground border-neutral-border",
};

const TONE_DOT_CLASSES: Record<StatusTone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
  neutral: "bg-neutral",
};

export function statusMeta(domain: StatusDomain, status: string): StatusMeta {
  const domainMap = DOMAIN_MAPS[domain];
  const matched = domainMap?.[status];
  if (matched) {
    return matched;
  }

  return {
    label: status,
    tone: "neutral",
    icon: HelpCircle,
    live: false,
  };
}

export interface StatusBadgeProps
  extends Omit<React.ComponentProps<typeof Badge>, "variant"> {
  domain: StatusDomain;
  status: string;
  showIcon?: boolean;
  showDot?: boolean;
}

export function StatusBadge({
  domain,
  status,
  showIcon = true,
  showDot = true,
  className,
  ...props
}: StatusBadgeProps) {
  const meta = statusMeta(domain, status);
  const Icon = meta.icon;

  return (
    <Badge
      data-slot="status-badge"
      data-domain={domain}
      data-status={status}
      data-tone={meta.tone}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium [&>svg]:size-3.5",
        TONE_CLASSES[meta.tone],
        className,
      )}
      {...props}
    >
      {showDot && meta.live && (
        <span
          aria-hidden="true"
          className={cn("size-1.5 shrink-0 rounded-full", TONE_DOT_CLASSES[meta.tone])}
        />
      )}
      {showIcon && <Icon aria-hidden="true" className="size-3.5 shrink-0" />}
      <span>{meta.label}</span>
    </Badge>
  );
}
