import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ImageOff, RefreshCw } from "lucide-react";

import { Button } from "../../app/components/ui/button";
import { Skeleton } from "../../app/components/ui/skeleton";
import { cn } from "../../app/components/ui/utils";
import { staffImageQueryOptions } from "./queries";

export interface StaffImageProps {
  resourceId?: number | null;
  previewUrl?: string | null;
  alt?: string;
  className?: string;
  compact?: boolean;
  allowRetry?: boolean;
}

/**
 * Imagen autenticada del builder de instrumentos.
 * Almacena únicamente el `Blob` en TanStack Query y gestiona el ciclo 1-a-1 de URLs `blob:`.
 */
export function StaffImage({
  resourceId,
  previewUrl,
  alt = "",
  className,
  compact = false,
  allowRetry = true,
}: StaffImageProps) {
  const hasResourceId = resourceId !== null && resourceId !== undefined && resourceId > 0;

  const query = useQuery({
    ...staffImageQueryOptions(hasResourceId ? resourceId : 0),
    enabled: hasResourceId,
  });

  const [objectUrlEntry, setObjectUrlEntry] = useState<{ blob: Blob; url: string } | null>(null);
  const blob = query.data;
  const objectUrl = blob && objectUrlEntry?.blob === blob ? objectUrlEntry.url : null;

  useEffect(() => {
    if (!hasResourceId || !blob) {
      return;
    }
    let active = true;
    const createdUrl = URL.createObjectURL(blob);
    queueMicrotask(() => {
      if (active) {
        setObjectUrlEntry({ blob, url: createdUrl });
      }
    });
    return () => {
      active = false;
      URL.revokeObjectURL(createdUrl);
    };
  }, [hasResourceId, blob]);

  if (hasResourceId) {
    if (query.isError) {
      return (
        <div
          role="group"
          aria-label="Error al cargar imagen"
          className={cn(
            "flex w-full flex-col items-center justify-center gap-2 rounded-lg border border-danger-border bg-danger-muted text-center text-danger-foreground select-none",
            compact ? "min-h-24 p-3" : "min-h-44 max-w-md p-5",
            className,
          )}
        >
          <AlertTriangle className="size-5 shrink-0" aria-hidden="true" />
          <span className="text-xs font-medium leading-snug">No se pudo cargar la imagen</span>
          {allowRetry && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-1 h-8 gap-1.5 border-danger-border bg-card text-foreground hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring"
              onClick={() => void query.refetch()}
            >
              <RefreshCw className="size-3.5" aria-hidden="true" />
              Reintentar
            </Button>
          )}
        </div>
      );
    }

    if (query.isPending || !blob || !objectUrl) {
      return (
        <Skeleton
          data-slot="staff-image-skeleton"
          aria-label="Cargando imagen"
          className={cn(
            "rounded-md bg-muted",
            compact ? "h-24 w-full" : "h-48 w-full max-w-md",
            className,
          )}
        />
      );
    }

    if (compact) {
      return (
        <img
          src={objectUrl}
          alt={alt}
          className={cn("block rounded bg-white p-1.5 object-contain", className)}
        />
      );
    }

    return (
      <span className="inline-flex max-w-full items-center justify-center rounded-md border border-border/70 bg-white p-2 shadow-[var(--shadow-xs)]">
        <img
          src={objectUrl}
          alt={alt}
          className={cn("block rounded-xs bg-white object-contain", className)}
        />
      </span>
    );
  }

  if (previewUrl) {
    if (compact) {
      return (
        <img
          src={previewUrl}
          alt={alt}
          className={cn("block rounded bg-white p-1.5 object-contain", className)}
        />
      );
    }

    return (
      <span className="inline-flex max-w-full items-center justify-center rounded-md border border-border/70 bg-white p-2 shadow-[var(--shadow-xs)]">
        <img
          src={previewUrl}
          alt={alt}
          className={cn("block rounded-xs bg-white object-contain", className)}
        />
      </span>
    );
  }

  return (
    <div
      role="group"
      aria-label="Imagen no disponible"
      className={cn(
        "flex w-full flex-col items-center justify-center gap-1.5 rounded-lg border border-border bg-muted/40 text-center text-muted-foreground select-none",
        compact ? "min-h-24 p-3" : "min-h-36 max-w-md p-4",
        className,
      )}
    >
      <ImageOff className="size-5 shrink-0" aria-hidden="true" />
      <span className="text-xs font-medium leading-snug">
        Imagen no disponible. Selecciona el archivo nuevamente.
      </span>
    </div>
  );
}
