import { Loader2 } from "lucide-react";

interface LoadingStateProps {
  message?: string;
  fullscreen?: boolean;
}

export function LoadingState({
  message = "Cargando...",
  fullscreen = false,
}: LoadingStateProps) {
  const content = (
    <div
      data-slot="loading-state"
      role="status"
      aria-live="polite"
      className="flex flex-col items-center justify-center gap-3 p-8 text-center"
    >
      <Loader2
        aria-hidden="true"
        className="size-8 animate-spin text-primary"
      />
      <p className="text-sm font-medium text-muted-foreground">{message}</p>
    </div>
  );

  if (fullscreen) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/85 backdrop-blur-sm">
        {content}
      </div>
    );
  }

  return content;
}
