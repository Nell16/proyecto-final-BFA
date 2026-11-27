import { useState } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronDown, ChevronRight } from "lucide-react";

import { Button } from "../../../app/components/ui/button";
import { cn } from "../../../app/components/ui/utils";
import type { DocumentNodeRef, ValidationReport } from "../document";

export function ProblemsPanel({
  report,
  defaultOpen = true,
  onSelect,
}: {
  report: ValidationReport;
  defaultOpen?: boolean;
  onSelect: (node: DocumentNodeRef) => void;
}) {
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null);
  const hasBlockingErrors = report.saveErrors.length > 0;
  const expanded = userExpanded ?? (defaultOpen || hasBlockingErrors);
  const problems = [...report.errors, ...report.warnings];

  return (
    <section
      aria-label="Problemas de la versión"
      className="rounded-lg border border-border bg-card shadow-[var(--shadow-xs)]"
    >
      <button
        type="button"
        onClick={() => setUserExpanded(!expanded)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left transition-colors hover:bg-muted/40"
      >
        <div className="flex items-center gap-2">
          {expanded ? (
            <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden="true" />
          ) : (
            <ChevronRight className="size-3.5 text-muted-foreground" aria-hidden="true" />
          )}
          <h2 className="text-xs font-semibold text-foreground">Validación de la versión</h2>
        </div>
        <p className="text-xs font-medium text-muted-foreground tabular-nums">
          {report.errors.length} errores · {report.warnings.length} advertencias
        </p>
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-border px-4 py-3">
          <ul className="grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
            {report.checklist.map((check) => (
              <li
                key={check.id}
                className="flex items-center justify-between gap-2 rounded-md px-2 py-1 hover:bg-muted/40"
              >
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-auto min-w-0 justify-start gap-1.5 px-0 py-0 text-left text-xs whitespace-normal hover:bg-transparent"
                  onClick={() => onSelect(check.node)}
                >
                  {check.passed ? (
                    <CheckCircle2
                      className="size-3.5 shrink-0 text-status-success-fg"
                      aria-hidden="true"
                    />
                  ) : (
                    <AlertCircle
                      className="size-3.5 shrink-0 text-status-warning-fg"
                      aria-hidden="true"
                    />
                  )}
                  <span>
                    {check.passed ? "✓" : "Pendiente ·"} {check.label}
                  </span>
                </Button>
                {check.detail && (
                  <span className="shrink-0 text-xs text-muted-foreground">{check.detail}</span>
                )}
              </li>
            ))}
          </ul>

          {problems.length > 0 && (
            <ul className="max-h-52 divide-y divide-border overflow-y-auto rounded-md border border-border">
              {problems.map((problem) => {
                const isError = problem.severity === "error";
                return (
                  <li key={problem.id} className="px-2.5 py-1">
                    <Button
                      variant="link"
                      size="sm"
                      className={cn(
                        "h-auto gap-1.5 px-0 py-0.5 text-left text-xs whitespace-normal",
                        isError ? "text-status-danger-fg" : "text-status-warning-fg",
                      )}
                      onClick={() => onSelect(problem.node)}
                    >
                      {isError ? (
                        <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
                      ) : (
                        <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
                      )}
                      <span>
                        {problem.blocksSave
                          ? "Impide guardar"
                          : isError
                            ? "Error"
                            : "Advertencia"}{" "}
                        · {problem.message}
                      </span>
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
