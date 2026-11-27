import { QRCodeSVG } from "qrcode.react";
import { cn } from "../../../app/components/ui/utils";

/** CSS que mantiene el QR legible (negro sobre blanco del sistema) al imprimir, incluso con tema oscuro. */
export const ACCESS_QR_PRINT_CSS = `
@media print {
  .access-qr { background: Canvas !important; color: CanvasText !important; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
}
`;

interface AccessQrProps {
  /** Enlace /evaluacion/... ya construido. El QR se genera localmente (sin servicios externos). */
  value: string;
  label: string;
  size?: number;
  className?: string;
}

export function AccessQr({ value, label, size = 88, className }: AccessQrProps) {
  return (
    <div className={cn("access-qr inline-flex shrink-0 rounded-md border border-border bg-background p-1 text-foreground", className)}>
      <QRCodeSVG
        value={value}
        size={size}
        level="M"
        marginSize={1}
        fgColor="currentColor"
        bgColor="transparent"
        title={label}
        role="img"
        aria-label={label}
      />
    </div>
  );
}
