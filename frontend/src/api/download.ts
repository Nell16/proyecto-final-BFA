/** Extrae el nombre de archivo desde `Content-Disposition` (soporta `filename*` y `filename`). */
export function filenameFromDisposition(disposition: unknown, fallback: string): string {
  if (typeof disposition !== "string" || disposition.trim() === "") return fallback;

  const utf8Match = disposition.match(/filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      const decoded = decodeURIComponent(utf8Match[1].trim().replace(/^"|"$/g, ""));
      if (decoded) return decoded;
    } catch {
      // Si el encoding está malformado se intenta con el parámetro filename estándar.
    }
  }

  const quotedMatch = disposition.match(/filename\s*=\s*"([^"]+)"/i);
  if (quotedMatch?.[1]?.trim()) return quotedMatch[1].trim();

  const plainMatch = disposition.match(/filename\s*=\s*([^;\s]+)/i);
  if (plainMatch?.[1]?.trim()) return plainMatch[1].trim();

  return fallback;
}

/** Dispara la descarga de un `Blob` en el navegador y revoca siempre la URL `blob:`. */
export function downloadBlobFile(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}
