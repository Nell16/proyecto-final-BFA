import { InlineNotice } from "./InlineNotice";

/**
 * Aviso honesto: el servidor aún no crea revisiones manuales al calificar ni aplica el puntaje
 * resuelto al resultado oficial (dependencia backend B23).
 */
export function PendingServerSupportNotice({ className }: { className?: string }) {
  return (
    <InlineNotice tone="info" title="Soporte pendiente en el servidor" className={className}>
      El servidor todavía no genera las revisiones al calificar ni incorpora el puntaje manual al resultado oficial, así
      que los ítems marcados «Requiere revisión» no aparecen en la bandeja de revisión manual por ahora.
    </InlineNotice>
  );
}
