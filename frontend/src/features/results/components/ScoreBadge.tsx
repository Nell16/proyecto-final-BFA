import { CheckCircle2, CircleDashed, ClipboardList, HelpCircle } from "lucide-react";
import type { AttemptSummary } from "../attempts-source";
import { ToneBadge } from "./ToneBadge";

/** Estado de calificación de un intento (derivado de `AttemptSummary`). */
export function ScoreBadge({ attempt }: { attempt: Pick<AttemptSummary, "status" | "scored" | "pendingManualReviews"> }) {
  if (attempt.scored === true) {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <ToneBadge tone="success" icon={<CheckCircle2 aria-hidden="true" />}>
          Calificado
        </ToneBadge>
        {attempt.pendingManualReviews != null && attempt.pendingManualReviews > 0 && (
          <ToneBadge tone="warning" icon={<ClipboardList aria-hidden="true" />}>
            {attempt.pendingManualReviews} en revisión manual
          </ToneBadge>
        )}
      </div>
    );
  }
  if (attempt.status !== "COMPLETADO") return <span className="text-muted-foreground">—</span>;
  if (attempt.scored === false) {
    return (
      <ToneBadge tone="neutral" icon={<CircleDashed aria-hidden="true" />}>
        Sin calificar
      </ToneBadge>
    );
  }
  return (
    <ToneBadge tone="neutral" icon={<HelpCircle aria-hidden="true" />}>
      Sin dato
    </ToneBadge>
  );
}
