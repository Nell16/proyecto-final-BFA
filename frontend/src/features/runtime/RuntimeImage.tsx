import { useEffect, useState } from "react";
import { queryOptions, useQuery, type QueryClient } from "@tanstack/react-query";
import { AlertTriangle, RefreshCw } from "lucide-react";

import { participantClient } from "../../api/client";
import type { RuntimeItem } from "../../api/schemas/runtime";
import { Button } from "../../app/components/ui/button";
import { Skeleton } from "../../app/components/ui/skeleton";
import { cn } from "../../app/components/ui/utils";
import { useParticipantAuth } from "../../store/participantAuth";
import { RUNTIME_IMAGE_STALE_TIME_MS, runtimeKeys } from "./queries";

const getApiBase = (): string =>
  (import.meta.env.VITE_API_URL || "http://localhost:8080").replace(/\/+$/, "");

export function isBackendRuntimeImageUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return true;
  const apiBase = getApiBase();
  return trimmed === apiBase || trimmed.startsWith(`${apiBase}/`);
}

export function normalizeRuntimeImageUrl(url: string): string {
  const trimmed = url.trim();
  const apiBase = getApiBase();
  if (trimmed === apiBase) return "/";
  if (trimmed.startsWith(`${apiBase}/`)) {
    return trimmed.slice(apiBase.length);
  }
  return trimmed;
}

export function runtimeImageQueryOptions(assignmentId: number, url: string) {
  const normalizedUrl = normalizeRuntimeImageUrl(url);
  return queryOptions({
    queryKey: runtimeKeys.image(assignmentId, normalizedUrl),
    queryFn: async ({ signal }): Promise<Blob> => {
      const res = await participantClient.get<Blob>(normalizedUrl, {
        responseType: "blob",
        signal,
      });
      return res.data;
    },
    staleTime: RUNTIME_IMAGE_STALE_TIME_MS,
  });
}

export function prefetchRuntimeImage(
  queryClient: QueryClient,
  assignmentId: number,
  url: string,
): Promise<void> {
  if (!url || !isBackendRuntimeImageUrl(url)) {
    return Promise.resolve();
  }
  return queryClient.prefetchQuery(runtimeImageQueryOptions(assignmentId, url));
}

export function prefetchItemImages(
  queryClient: QueryClient,
  assignmentId: number,
  item: RuntimeItem | undefined,
): Promise<void[]> {
  if (!item) return Promise.resolve([]);
  const urls = [
    ...item.images.map((img) => img.url),
    ...item.options.flatMap((opt) => opt.images.map((img) => img.url)),
  ];
  const uniqueUrls = Array.from(new Set(urls.filter(Boolean)));
  return Promise.all(uniqueUrls.map((url) => prefetchRuntimeImage(queryClient, assignmentId, url)));
}

export interface RuntimeImageProps {
  src: string;
  alt?: string;
  assignmentId?: number | null;
  className?: string;
  compact?: boolean;
  allowRetry?: boolean;
}

/**
 * Imagen autenticada del runner (R-04).
 * Guarda en TanStack Query el `Blob` (nunca `blob:`) y revoca cada URL creada en el cleanup.
 */
export function RuntimeImage({
  src,
  alt = "",
  assignmentId: explicitAssignmentId,
  className,
  compact = false,
  allowRetry = true,
}: RuntimeImageProps) {
  const authAssignmentId = useParticipantAuth((s) => s.assignmentId);
  const assignmentId = explicitAssignmentId !== undefined ? explicitAssignmentId : authAssignmentId;
  const isBackend = isBackendRuntimeImageUrl(src);

  const query = useQuery({
    ...runtimeImageQueryOptions(assignmentId ?? 0, src),
    enabled: isBackend && assignmentId !== null,
  });

  const [objectUrlEntry, setObjectUrlEntry] = useState<{ blob: Blob; url: string } | null>(null);
  const blob = query.data;
  const objectUrl = blob && objectUrlEntry?.blob === blob ? objectUrlEntry.url : null;

  useEffect(() => {
    if (!isBackend || !blob) {
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
  }, [isBackend, blob]);

  if (isBackend) {
    if (assignmentId === null || query.isError) {
      return (
        <div
          role="group"
          aria-label="Error al cargar imagen"
          onContextMenu={(e) => e.preventDefault()}
          className={cn(
            "flex w-full flex-col items-center justify-center gap-2 rounded-lg border border-danger-border bg-danger-muted text-center text-danger-foreground select-none",
            compact ? "min-h-28 p-3" : "min-h-48 max-w-md p-5",
            className,
          )}
        >
          <AlertTriangle className="size-5 shrink-0" aria-hidden="true" />
          <span className="text-xs font-medium leading-snug">No se pudo cargar la imagen</span>
          {allowRetry && assignmentId !== null && (
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
          data-slot="runtime-image-skeleton"
          aria-label="Cargando imagen"
          className={cn(
            "rounded-md bg-muted",
            compact ? "h-28 w-full" : "h-52 w-full max-w-lg",
          )}
        />
      );
    }

    if (compact) {
      return (
        <img
          src={objectUrl}
          alt={alt}
          draggable={false}
          onContextMenu={(e) => e.preventDefault()}
          className={cn("block select-none rounded bg-white p-2 object-contain", className)}
        />
      );
    }

    return (
      <span
        onContextMenu={(e) => e.preventDefault()}
        className="inline-flex max-w-full items-center justify-center rounded-md border border-border/70 bg-white p-2 shadow-[var(--shadow-xs)] select-none"
      >
        <img
          src={objectUrl}
          alt={alt}
          draggable={false}
          onContextMenu={(e) => e.preventDefault()}
          className={cn("block select-none rounded-xs bg-white object-contain", className)}
        />
      </span>
    );
  }

  if (compact) {
    return (
      <img
        src={src}
        alt={alt}
        draggable={false}
        onContextMenu={(e) => e.preventDefault()}
        className={cn("block select-none rounded bg-white p-2 object-contain", className)}
      />
    );
  }

  return (
    <span
      onContextMenu={(e) => e.preventDefault()}
      className="inline-flex max-w-full items-center justify-center rounded-md border border-border/70 bg-white p-2 shadow-[var(--shadow-xs)] select-none"
    >
      <img
        src={src}
        alt={alt}
        draggable={false}
        onContextMenu={(e) => e.preventDefault()}
        className={cn("block select-none rounded-xs bg-white object-contain", className)}
      />
    </span>
  );
}
