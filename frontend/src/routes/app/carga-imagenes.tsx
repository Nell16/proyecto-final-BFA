import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Ruta retirada: la carga de imágenes de ítems y opciones vive en el builder de instrumentos.
 * Se conserva solo para no romper enlaces/marcadores antiguos. El guard de permiso lo aplica
 * `/app/instrumentos` tras la redirección, por eso no tiene entrada en ROUTE_PERMISSIONS.
 */
export const Route = createFileRoute("/app/carga-imagenes")({
  beforeLoad: () => {
    throw redirect({ to: "/app/instrumentos" });
  },
});
