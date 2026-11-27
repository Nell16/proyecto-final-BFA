import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import { validateAccess } from "../../api/endpoints/runtime";
import { ApiError } from "../../api/errors";
import { RUNTIME_QUERY_KEY_PREFIX } from "../../api/queryClient";
import { Brand } from "../../app/components/brand";
import { Card, CardContent } from "../../app/components/ui/card";
import { setPendingAccessError } from "../../features/runtime/accessError";
import { isStaleParticipantError } from "../../features/runtime/draft";
import { useParticipantAuth } from "../../store/participantAuth";

export const Route = createFileRoute("/evaluacion/$code")({
  component: EvaluacionCodeExchangeRoute,
});

function mapCodeExchangeError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "INVALID_ACCESS_CODE":
        return "El enlace de acceso no tiene un formato válido.";
      case "TOKEN_EXPIRADO":
        return "Este enlace o código de acceso ha expirado.";
      case "SESION_FINALIZADA":
        return "La sesión de evaluación ya fue cerrada.";
      case "SESION_NO_ABIERTA":
        return "La sesión de evaluación aún no está abierta.";
      case "SESION_PAUSADA":
        return "La sesión de evaluación está pausada temporalmente.";
      case "ASIGNACION_NO_OPERABLE":
        return "Esta asignación no se encuentra disponible.";
      default:
        if (err.status === 401 || err.status === 403) {
          return "El acceso fue revocado o no es válido.";
        }
        return err.message;
    }
  }
  return "No se pudo validar el enlace de acceso. Verifique su conexión e intente nuevamente.";
}

function EvaluacionCodeExchangeRoute() {
  const { code } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  useEffect(() => {
    let cancelled = false;

    const exchange = async () => {
      try {
        const access = await validateAccess(code);
        if (cancelled) return;

        queryClient.removeQueries({ queryKey: [RUNTIME_QUERY_KEY_PREFIX] });
        useParticipantAuth.getState().setSession({
          token: access.accessToken,
          assignmentId: access.assignmentId,
        });
        void navigate({ to: "/evaluacion/sesion", replace: true });
      } catch (err) {
        if (cancelled || isStaleParticipantError(err)) return;
        setPendingAccessError(mapCodeExchangeError(err));
        void navigate({ to: "/evaluacion/acceso", search: {}, replace: true });
      }
    };

    void exchange();

    return () => {
      cancelled = true;
    };
  }, [code, navigate, queryClient]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 md:p-6">
      <Card className="w-full max-w-md rounded-lg border border-border bg-card shadow-[var(--shadow-xs)]">
        <CardContent className="p-6 sm:p-8 text-center space-y-5" role="status" aria-live="polite">
          <div className="flex justify-center">
            <Brand />
          </div>
          <Loader2 className="size-9 text-primary mx-auto animate-spin" aria-hidden="true" />
          <div className="space-y-1.5">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">
              Validando acceso a la evaluación...
            </h1>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Verificando su autorización y el estado de la sesión.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
