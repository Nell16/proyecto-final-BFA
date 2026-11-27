import { EmptyState } from "../../../app/components/ui/empty-state";

/**
 * La fuente de intentos vigente (puente sobre /sesiones, B14 pendiente) exige SESION_LEER. Un rol que solo
 * tiene permisos de resultados (p. ej. Consultor) no puede listar intentos hasta que exista `GET /attempts`.
 */
export function SourceUnavailable({ context }: { context: string }) {
  return (
    <EmptyState
      title="Listado de intentos no disponible para tu rol"
      description={`${context} Con la API actual el listado depende del permiso de lectura de sesiones; se habilitará cuando el backend exponga la consulta de intentos (B14). Si ya conoces el intento, puedes abrir su resultado desde un enlace directo.`}
    />
  );
}
