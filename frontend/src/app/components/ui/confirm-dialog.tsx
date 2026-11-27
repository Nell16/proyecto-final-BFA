import * as React from "react";
import { AlertTriangle, HelpCircle, Loader2 } from "lucide-react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./alert-dialog";
import { Button } from "./button";
import { Input } from "./input";
import { Label } from "./label";
import { cn } from "./utils";
import { captureAccountScope, type AccountScope } from "../../../store/accountScope";
import { useStaffAuth } from "../../../store/staffAuth";

export type ConfirmTone = "default" | "danger";

interface ConfirmDialogBaseProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  requireText?: string;
  onConfirm: () => Promise<void> | void;
}

export type ConfirmDialogProps =
  | (ConfirmDialogBaseProps & {
      tone?: "default";
      /** Recomendada para describir el impacto de la acción. */
      description?: React.ReactNode;
    })
  | (ConfirmDialogBaseProps & {
      tone: "danger";
      /** Obligatoria en acciones destructivas (texto plano no vacío tras trim). */
      description: string;
    });

function hasMeaningfulDescription(node: React.ReactNode): boolean {
  if (node === null || node === undefined || typeof node === "boolean") {
    return false;
  }
  if (typeof node === "string") {
    return node.trim().length > 0;
  }
  if (typeof node === "number") {
    return true;
  }
  if (Array.isArray(node)) {
    return node.some((child) => hasMeaningfulDescription(child));
  }
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
    if (node.type === React.Fragment || typeof node.type === "string") {
      return hasMeaningfulDescription(node.props.children);
    }
    return true;
  }
  return false;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  tone = "default",
  requireText,
  onConfirm,
}: ConfirmDialogProps) {
  const [pending, setPending] = React.useState(false);
  const [typedText, setTypedText] = React.useState("");
  const [prevOpen, setPrevOpen] = React.useState(open);
  const inputId = React.useId();

  if (open !== prevOpen) {
    setPrevOpen(open);
    if (!open) {
      setTypedText("");
      setPending(false);
    }
  }

  const isDanger = tone === "danger";
  const hasValidDescription = isDanger
    ? typeof description === "string" && description.trim().length > 0
    : hasMeaningfulDescription(description);
  const hasInvalidDangerDescription = isDanger && !hasValidDescription;

  React.useEffect(() => {
    if (import.meta.env.DEV && open && hasInvalidDangerDescription) {
      console.error(
        '[ConfirmDialog] La prop "description" es obligatoria y debe ser un texto plano no vacío cuando tone="danger". El botón de confirmación no se renderizará.',
      );
    }
  }, [open, hasInvalidDangerDescription]);

  const requiresMatch = Boolean(requireText && requireText.length > 0);
  const matchesRequired = !requiresMatch || typedText === requireText;
  const isConfirmDisabled =
    pending || !matchesRequired || hasInvalidDangerDescription;

  const handleOpenChange = (nextOpen: boolean) => {
    if (pending) return;
    if (!nextOpen) {
      setTypedText("");
    }
    onOpenChange(nextOpen);
  };

  const handleConfirm = async () => {
    if (isConfirmDisabled) return;
    setPending(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch {
      // Mantiene el diálogo abierto para permitir reintentar o cancelar;
      // el llamador maneja el feedback de error si corresponde.
    } finally {
      setPending(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent
        data-slot="confirm-dialog"
        data-tone={tone}
        {...(!hasValidDescription ? { "aria-describedby": undefined } : {})}
        onEscapeKeyDown={(event) => {
          if (pending) {
            event.preventDefault();
          }
        }}
        className="border-border bg-popover text-popover-foreground shadow-[var(--shadow-md)]"
      >
        <span role="status" aria-live="polite" className="sr-only">
          {pending ? "Procesando…" : ""}
        </span>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <div
            aria-hidden="true"
            className={cn(
              "mx-auto flex size-10 shrink-0 items-center justify-center rounded-full border sm:mx-0",
              isDanger
                ? "border-danger-border bg-danger-muted text-danger-foreground"
                : "border-info-border bg-info-muted text-info-foreground",
            )}
          >
            {isDanger ? (
              <AlertTriangle className="size-5" />
            ) : (
              <HelpCircle className="size-5" />
            )}
          </div>

          <AlertDialogHeader className="flex-1">
            <AlertDialogTitle className="text-base font-semibold text-foreground">
              {title}
            </AlertDialogTitle>
            {hasValidDescription && (
              <AlertDialogDescription className="text-sm text-muted-foreground">
                {description}
              </AlertDialogDescription>
            )}
          </AlertDialogHeader>
        </div>

        {requiresMatch && requireText && (
          <div className="space-y-2 pt-1">
            <Label htmlFor={inputId} className="text-sm font-medium text-foreground">
              <span>
                Escribe{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs font-semibold text-foreground">
                  {requireText}
                </code>{" "}
                para confirmar
              </span>
            </Label>
            <Input
              id={inputId}
              value={typedText}
              onChange={(event) => setTypedText(event.target.value)}
              placeholder={requireText}
              disabled={pending}
              autoComplete="off"
              autoFocus
            />
          </div>
        )}

        <AlertDialogFooter aria-busy={pending}>
          <AlertDialogCancel
            disabled={pending}
            autoFocus={isDanger && !requiresMatch}
          >
            {cancelLabel}
          </AlertDialogCancel>
          {!hasInvalidDangerDescription && (
            <Button
              type="button"
              variant={isDanger ? "destructive" : "default"}
              disabled={isConfirmDisabled}
              onClick={handleConfirm}
            >
              {pending && (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              )}
              <span>{confirmLabel}</span>
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

interface ConfirmOptionsBase {
  title: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  requireText?: string;
  onConfirm?: () => Promise<void> | void;
}

export type ConfirmOptions =
  | (ConfirmOptionsBase & {
      tone?: "default";
      /** Recomendada para describir el impacto de la acción. */
      description?: React.ReactNode;
    })
  | (ConfirmOptionsBase & {
      tone: "danger";
      /** Obligatoria en acciones destructivas (texto plano no vacío tras trim). */
      description: string;
    });

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

interface PendingConfirmRequest {
  id: number;
  options: ConfirmOptions;
  /** Cuenta de staff vigente cuando se solicitó la confirmación. */
  scope: AccountScope;
  resolve: (confirmed: boolean) => void;
}

const ConfirmContext = React.createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const nextIdRef = React.useRef(1);
  const queueRef = React.useRef<PendingConfirmRequest[]>([]);
  const activeRef = React.useRef<PendingConfirmRequest | null>(null);
  const [current, setCurrent] = React.useState<PendingConfirmRequest | null>(null);
  const [open, setOpen] = React.useState(false);

  const showNext = React.useCallback(() => {
    const next = queueRef.current.shift() ?? null;
    activeRef.current = next;
    setCurrent(next);
    setOpen(Boolean(next));
  }, []);

  const confirm = React.useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      const request: PendingConfirmRequest = {
        id: nextIdRef.current++,
        options,
        scope: captureAccountScope(),
        resolve,
      };
      if (!activeRef.current) {
        activeRef.current = request;
        setCurrent(request);
        setOpen(true);
      } else {
        queueRef.current.push(request);
      }
    });
  }, []);

  const settleRequest = React.useCallback(
    (request: PendingConfirmRequest, confirmed: boolean) => {
      if (activeRef.current !== request) return;
      activeRef.current = null;
      request.resolve(confirmed);
      showNext();
    },
    [showNext],
  );

  // Si cambia la cuenta de staff mientras hay confirmaciones abiertas o en cola, se cancelan todas
  // (resuelven `false`, sin ejecutar `onConfirm`): nadie debe confirmar en nombre de otra cuenta.
  React.useEffect(() => {
    let lastSessionId = useStaffAuth.getState().sessionId;
    return useStaffAuth.subscribe((state) => {
      if (state.sessionId === lastSessionId) return;
      lastSessionId = state.sessionId;
      const active = activeRef.current;
      const queue = queueRef.current;
      const stale = queue.filter((r) => !r.scope.isCurrent());
      for (const r of stale) queue.splice(queue.indexOf(r), 1);
      stale.forEach((r) => r.resolve(false));
      if (active && !active.scope.isCurrent()) settleRequest(active, false);
    });
  }, [settleRequest]);

  React.useEffect(() => {
    const queue = queueRef.current;
    return () => {
      if (activeRef.current) {
        activeRef.current.resolve(false);
        activeRef.current = null;
      }
      while (queue.length > 0) {
        queue.shift()?.resolve(false);
      }
    };
  }, []);

  const currentDialogToneProps = current
    ? current.options.tone === "danger"
      ? {
          tone: "danger" as const,
          description: current.options.description,
        }
      : {
          tone: current.options.tone,
          description: current.options.description,
        }
    : null;

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {current && currentDialogToneProps && (
        <ConfirmDialog
          key={current.id}
          open={open}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) {
              settleRequest(current, false);
            }
          }}
          title={current.options.title}
          {...currentDialogToneProps}
          confirmLabel={current.options.confirmLabel}
          cancelLabel={current.options.cancelLabel}
          requireText={current.options.requireText}
          onConfirm={async () => {
            if (!current.scope.isCurrent()) {
              settleRequest(current, false);
              return;
            }
            if (current.options.onConfirm) {
              await current.options.onConfirm();
            }
            settleRequest(current, true);
          }}
        />
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const confirm = React.useContext(ConfirmContext);
  if (!confirm) {
    throw new Error("useConfirm debe usarse dentro de un <ConfirmProvider>.");
  }
  return confirm;
}
