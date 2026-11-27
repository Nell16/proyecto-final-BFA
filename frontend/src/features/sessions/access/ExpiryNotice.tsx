import { TriangleAlert } from "lucide-react";
import { expiresBeforeStart } from "./ttl";

interface ExpiryNoticeProps {
  entries: readonly { expiresAt: string }[];
  scheduledStart: string | null | undefined;
}

/** Advertencia cuando algún enlace vence antes del inicio programado de la sesión. */
export function ExpiryNotice({ entries, scheduledStart }: ExpiryNoticeProps) {
  const early = entries.filter((e) => expiresBeforeStart(e.expiresAt, scheduledStart)).length;
  if (early === 0) return null;
  return (
    <div
      role="alert"
      className="no-print flex items-start gap-2 rounded-lg border border-warning-border bg-warning-muted p-3 text-sm text-warning-foreground print:hidden"
    >
      <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <p>
        <strong>{early === 1 ? "Un enlace vence" : `${early} enlaces vencen`} antes del inicio programado.</strong>{" "}
        Esos participantes no podrán ingresar a tiempo; revise la programación de la sesión.
      </p>
    </div>
  );
}
