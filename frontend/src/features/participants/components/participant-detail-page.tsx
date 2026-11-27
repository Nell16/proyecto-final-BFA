import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertCircle } from "lucide-react";
import { ApiError } from "../../../api/errors";
import { Button } from "../../../app/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../../app/components/ui/card";
import { EmptyState } from "../../../app/components/ui/empty-state";
import { PageHeader } from "../../../app/components/ui/page-header";
import { Skeleton } from "../../../app/components/ui/skeleton";
import { GeneralStatusBadge } from "../../catalogs/components/general-status-badge";
import { errorMessage } from "../../catalogs/error-message";
import { participantDetailQuery } from "../queries";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `YYYY-MM-DD` → `DD/MM/YYYY` sin pasar por `Date` (evita desfases de zona horaria). */
function formatBirthDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = ISO_DATE.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

function formatDateTime(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("es");
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{children ?? "—"}</dd>
    </div>
  );
}

const breadcrumbLink = ({ label }: { label: string; to: string }) => <Link to="/app/participantes">{label}</Link>;

export function ParticipantDetailPage({ id }: { id: string }) {
  const query = useQuery(participantDetailQuery(id));

  if (query.isPending) {
    return (
      <div className="space-y-6" aria-busy="true" aria-label="Cargando participante">
        <Skeleton className="h-16 w-full max-w-md" />
        <Skeleton className="h-64 w-full max-w-3xl" />
      </div>
    );
  }

  if (query.isError) {
    const notFound = query.error instanceof ApiError && query.error.status === 404;
    return (
      <div className="space-y-6">
        <PageHeader
          title="Participante"
          breadcrumbs={[{ label: "Participantes", to: "/app/participantes" }, { label: "Detalle" }]}
          renderBreadcrumbLink={breadcrumbLink}
        />
        {notFound ? (
          <EmptyState
            title="Participante no encontrado"
            description="El participante no existe o fue eliminado."
            action={
              <Button asChild variant="outline" size="sm">
                <Link to="/app/participantes">Volver a participantes</Link>
              </Button>
            }
          />
        ) : (
          <div
            role="alert"
            className="flex flex-col items-center rounded-lg border border-danger-border bg-danger-muted/60 p-6 text-center"
          >
            <AlertCircle aria-hidden="true" className="mb-2 size-6 text-danger-foreground" />
            <p className="text-sm font-medium text-danger-foreground">
              {errorMessage(query.error, "No se pudo cargar el participante.")}
            </p>
            <Button type="button" variant="outline" size="sm" className="mt-4" onClick={() => void query.refetch()}>
              Reintentar
            </Button>
          </div>
        )}
      </div>
    );
  }

  const participant = query.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title={participant.fullName}
        subtitle={`Código ${participant.code}`}
        breadcrumbs={[{ label: "Participantes", to: "/app/participantes" }, { label: participant.fullName }]}
        renderBreadcrumbLink={breadcrumbLink}
        actions={<GeneralStatusBadge status={participant.status} />}
      />

      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle className="text-base">Datos del participante</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            <Field label="Código">{participant.code}</Field>
            <Field label="Estado">
              <GeneralStatusBadge status={participant.status} />
            </Field>
            <Field label="Nombres">{participant.firstNames}</Field>
            <Field label="Apellidos">{participant.lastNames}</Field>
            <Field label="Fecha de nacimiento">{formatBirthDate(participant.birthDate)}</Field>
            <Field label="Edad">
              {participant.age === undefined ? undefined : <span className="tabular-nums">{participant.age} años</span>}
            </Field>
            <Field label="Sexo">{participant.sex?.name}</Field>
            <Field label="Carrera">{participant.career?.name}</Field>
            <Field label="Cohorte">{participant.cohort?.name}</Field>
            <Field label="Grupo académico">{participant.group?.name}</Field>
            <Field label="Registrado">{formatDateTime(participant.createdAt)}</Field>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
