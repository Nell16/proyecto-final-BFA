import { useId, useRef, useState } from "react";
import { AlertTriangle, ImagePlus, Trash2 } from "lucide-react";

import { Alert, AlertDescription } from "../../../app/components/ui/alert";
import { Button } from "../../../app/components/ui/button";
import { Input } from "../../../app/components/ui/input";
import { Label } from "../../../app/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../app/components/ui/select";
import { cn } from "../../../app/components/ui/utils";
import { StaffImage } from "../StaffImage";
import { isActiveDraftNode, type DocumentImage } from "../document";

export const MAX_IMAGE_FILE_SIZE_BYTES = 5 * 1024 * 1024;

const ACCEPTED_IMAGE_MIME_TYPES = "image/png,image/jpeg,image/webp,image/gif";

const ITEM_IMAGE_ROLES = [
  { value: "ENUNCIADO", label: "Enunciado" },
  { value: "ESTIMULO", label: "Estímulo" },
  { value: "REFERENCIA", label: "Referencia" },
  { value: "APOYO", label: "Apoyo" },
] as const;

export interface ImageFieldProps {
  kind: "item" | "option";
  images: readonly DocumentImage[];
  readOnly: boolean;
  canEdit: boolean;
  maxImages?: number;
  compact?: boolean;
  onAttachFile: (file: File) => void;
  onUpdateImage: (
    imageDraftId: string,
    patch: Partial<Pick<DocumentImage, "altText" | "role" | "order">>,
  ) => void;
  onDeleteImage: (imageDraftId: string) => void;
}

/**
 * Campo reutilizable para adjuntar, previsualizar y editar metadatos de imágenes
 * en ítems de estímulo y opciones de respuesta.
 */
export function ImageField({
  kind,
  images,
  readOnly,
  canEdit,
  maxImages,
  compact = false,
  onAttachFile,
  onUpdateImage,
  onDeleteImage,
}: ImageFieldProps) {
  const fieldId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const isLocked = readOnly || !canEdit;
  const activeImages = [...images.filter(isActiveDraftNode)].sort((a, b) => a.order - b.order);
  const reachedMax = maxImages !== undefined && activeImages.length >= maxImages;
  const attachDisabled = isLocked || reachedMax;

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setFileError("El archivo seleccionado debe ser una imagen válida (PNG, JPG, WebP o GIF).");
      return;
    }

    if (file.size > MAX_IMAGE_FILE_SIZE_BYTES) {
      setFileError("La imagen supera el tamaño máximo permitido de 5 MB.");
      return;
    }

    setFileError(null);
    onAttachFile(file);
  };

  const fileInput = (
    <input
      ref={fileInputRef}
      id={`${fieldId}-file-input`}
      type="file"
      accept={ACCEPTED_IMAGE_MIME_TYPES}
      aria-label="Seleccionar archivo de imagen"
      className="sr-only"
      disabled={attachDisabled}
      onChange={handleFileChange}
    />
  );

  const attachButton = (
    <Button
      type="button"
      variant={compact ? "ghost" : "outline"}
      size="icon"
      aria-label="Adjuntar imagen"
      title="Adjuntar imagen"
      disabled={attachDisabled}
      onClick={() => fileInputRef.current?.click()}
      className={cn(
        compact
          ? "size-7 text-muted-foreground hover:text-foreground"
          : "size-8 text-muted-foreground hover:text-foreground",
      )}
    >
      <ImagePlus className="size-4" aria-hidden="true" />
    </Button>
  );

  if (compact && activeImages.length === 0 && !fileError) {
    return (
      <div className="inline-flex items-center" data-slot="image-field" data-kind={kind}>
        {fileInput}
        {attachButton}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "space-y-2.5",
        compact && "order-last mt-1 w-full basis-full border-t border-border pt-2",
      )}
      data-slot="image-field"
      data-kind={kind}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {activeImages.length === 0
            ? "Sin imágenes adjuntas"
            : `${activeImages.length} ${activeImages.length === 1 ? "imagen adjunta" : "imágenes adjuntas"}`}
        </span>

        <div>
          {fileInput}
          {attachButton}
        </div>
      </div>

      {fileError && (
        <Alert
          role="alert"
          className="border-status-danger-border bg-status-danger-bg text-status-danger-fg"
        >
          <AlertTriangle className="size-4" aria-hidden="true" />
          <AlertDescription className="text-xs text-status-danger-fg">{fileError}</AlertDescription>
        </Alert>
      )}

      {activeImages.length > 0 && (
        <div className={cn("grid gap-2.5", compact ? "grid-cols-1" : "grid-cols-1 md:grid-cols-2")}>
          {activeImages.map((img, index) => {
            const altInputId = `${fieldId}-alt-${img.draftId}`;
            const roleSelectId = `${fieldId}-role-${img.draftId}`;
            const isMissingLocalFile =
              img.pendingFileId !== null && img.resourceId === null && img.previewUrl === null;
            const currentRole = img.role ?? "ENUNCIADO";
            const hasKnownRole = ITEM_IMAGE_ROLES.some((r) => r.value === currentRole);

            return (
              <div
                key={img.draftId}
                data-slot="image-field-item"
                className={cn(
                  "flex flex-col gap-2.5 rounded-md border border-border bg-muted/20",
                  compact ? "p-2.5" : "p-3",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-medium text-muted-foreground">
                    Imagen {index + 1}
                    {img.fileName ? ` · ${img.fileName}` : ""}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Eliminar imagen"
                    title="Eliminar imagen"
                    disabled={isLocked}
                    onClick={() => onDeleteImage(img.draftId)}
                    className="size-7 shrink-0 text-muted-foreground hover:bg-status-danger-bg hover:text-status-danger-fg"
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  </Button>
                </div>

                {isMissingLocalFile && (
                  <Alert
                    role="status"
                    className="border-status-warning-border bg-status-warning-bg text-status-warning-fg"
                  >
                    <AlertTriangle className="size-4" aria-hidden="true" />
                    <AlertDescription className="text-xs text-status-warning-fg">
                      Esta imagen pendiente no conserva su archivo local tras recargar el borrador.
                      Vuelve a seleccionar la imagen o elimínala antes de guardar.
                    </AlertDescription>
                  </Alert>
                )}

                <div className="flex justify-center">
                  <StaffImage
                    resourceId={img.resourceId}
                    previewUrl={img.previewUrl}
                    alt={img.altText || img.fileName || "Imagen"}
                    compact={compact}
                    className={compact ? "max-h-24" : "max-h-48"}
                  />
                </div>

                <div
                  className={cn(
                    "grid gap-2",
                    kind === "item" ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1",
                  )}
                >
                  <div className="space-y-1">
                    <Label htmlFor={altInputId} className="text-xs font-medium text-muted-foreground">
                      Texto alternativo (alt)
                    </Label>
                    <Input
                      id={altInputId}
                      value={img.altText}
                      disabled={isLocked}
                      placeholder="Describe brevemente la imagen..."
                      className="h-8 text-xs"
                      onChange={(event) =>
                        onUpdateImage(img.draftId, { altText: event.target.value })
                      }
                    />
                    {img.altText.trim() === "" && (
                      <p className="text-xs text-status-warning-fg">
                        Sin texto alternativo: recomendado para accesibilidad.
                      </p>
                    )}
                  </div>

                  {kind === "item" && (
                    <div className="space-y-1">
                      <Label
                        htmlFor={roleSelectId}
                        className="text-xs font-medium text-muted-foreground"
                      >
                        Rol de la imagen
                      </Label>
                      <Select
                        value={currentRole}
                        disabled={isLocked}
                        onValueChange={(value) => onUpdateImage(img.draftId, { role: value })}
                      >
                        <SelectTrigger id={roleSelectId} size="sm" className="text-xs">
                          <SelectValue placeholder="Selecciona un rol" />
                        </SelectTrigger>
                        <SelectContent>
                          {ITEM_IMAGE_ROLES.map((roleOption) => (
                            <SelectItem key={roleOption.value} value={roleOption.value}>
                              {roleOption.label}
                            </SelectItem>
                          ))}
                          {!hasKnownRole && (
                            <SelectItem value={currentRole}>{currentRole}</SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
