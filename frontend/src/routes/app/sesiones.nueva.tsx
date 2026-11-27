import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { requireRoutePermission } from "../../store/routePermissions";
import { SessionWizardPage, type WizardExitTarget } from "../../features/sessions/wizard/SessionWizardPage";
import { wizardSearchSchema } from "../../features/sessions/wizard/schemas";

export const Route = createFileRoute("/app/sesiones/nueva")({
  beforeLoad: requireRoutePermission("/app/sesiones/nueva"),
  validateSearch: wizardSearchSchema,
  component: SessionWizardRoute,
});

function SessionWizardRoute() {
  const { sessionId } = Route.useSearch();
  const navigate = useNavigate();

  return (
    <SessionWizardPage
      sessionId={sessionId}
      // `replace`: la URL con ?sessionId=N reemplaza a /nueva para que "atrás" no vuelva a un formulario vacío.
      onSessionIdChange={(id) =>
        void navigate({ to: "/app/sesiones/nueva", search: { sessionId: id }, replace: true })
      }
      onExit={(target: WizardExitTarget) =>
        void (target.to === "monitor"
          ? navigate({ to: "/app/sesiones/$id", params: { id: String(target.sessionId) } })
          : navigate({ to: "/app/sesiones" }))
      }
    />
  );
}
