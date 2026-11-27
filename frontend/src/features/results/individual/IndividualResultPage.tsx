import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ClipboardCheck, ShieldCheck } from "lucide-react";

import type { AttemptResult, DetailedAttemptResult } from "../../../api/schemas/results";
import { Badge } from "../../../app/components/ui/badge";
import { Button } from "../../../app/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../../app/components/ui/card";
import { EmptyState } from "../../../app/components/ui/empty-state";
import { PageHeader } from "../../../app/components/ui/page-header";
import { Skeleton } from "../../../app/components/ui/skeleton";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "../../../app/components/ui/table";
import { ErrorPanel } from "../components/ErrorPanel";
import { InlineNotice } from "../components/InlineNotice";
import { ToneBadge } from "../components/ToneBadge";
import { formatDateTime, formatScore, isMissingError, parseAttemptId } from "../format";
import { useCanGradeAttempts } from "../permissions";
import { attemptResultQuery, detailedResultQuery } from "../queries";

const resultStatusMeta = (status: string): { label: string; tone: "success" | "warning" } =>
  status === "CALCULADO" ? { label: "Calculado", tone: "success" } : { label: status.replaceAll("_", " ").toLowerCase(), tone: "warning" };

function BackLink() {
  return (
    <Button asChild variant="outline" size="sm">
      <Link to="/app/resultados">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Volver a resultados
      </Link>
    </Button>
  );
}

function ParticipantSummary({ detail }: { detail: DetailedAttemptResult }) {
  const rows: Array<[string, string]> = [
    ["Participante", detail.participantName],
    ["Código", detail.participantCode],
    ["Carrera", detail.career ?? "No especificada"],
    ["Grupo y cohorte", [detail.academicGroup, detail.cohort].filter(Boolean).join(" · ") || "No especificado"],
    ["Instrumento", `${detail.testName} (v${detail.testVersion})`],
    ["Calificado el", formatDateTime(detail.scoredAt)],
  ];
  return (
    <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map(([label, value]) => (
        <div key={label} className="space-y-0.5">
          <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
          <dd className="text-sm font-medium text-foreground">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Interpretation({ result }: { result: AttemptResult }) {
  const interpretation = result.totalInterpretation;
  if (!interpretation) return null;
  return (
    <section aria-labelledby="interpretation-title" className="space-y-4 rounded-lg border border-border bg-muted/30 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="interpretation-title" className="flex items-center gap-2 text-base font-semibold text-foreground">
          <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
          Interpretación general
        </h2>
        <Badge variant="outline" className="font-mono text-xs">
          Baremo {interpretation.baremoCode}
        </Badge>
      </div>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-md border border-border bg-card p-3">
          <dt className="text-xs font-medium text-muted-foreground">Puntaje directo</dt>
          <dd className="text-2xl font-semibold tabular-nums text-foreground">{formatScore(result.totalScore)}</dd>
        </div>
        <div className="rounded-md border border-border bg-card p-3">
          <dt className="text-xs font-medium text-muted-foreground">Percentil</dt>
          <dd className="text-2xl font-semibold tabular-nums text-foreground">
            {interpretation.percentile === null ? "—" : formatScore(interpretation.percentile)}
          </dd>
        </div>
        <div className="col-span-2 rounded-md border border-border bg-card p-3">
          <dt className="text-xs font-medium text-muted-foreground">Categoría</dt>
          <dd className="mt-1 text-sm font-semibold text-foreground">{interpretation.category ?? "—"}</dd>
        </div>
      </dl>
      {interpretation.interpretation && (
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-foreground">Interpretación</h3>
          <p className="rounded-md border border-border bg-card p-3 text-sm leading-relaxed">{interpretation.interpretation}</p>
        </div>
      )}
      {interpretation.recommendation && (
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-foreground">Recomendación</h3>
          <p className="rounded-md border border-border bg-card p-3 text-sm leading-relaxed">{interpretation.recommendation}</p>
        </div>
      )}
    </section>
  );
}

/** Resultado individual con baremo (`GET /attempts/{id}/result`, RESULTADO_VER) + datos del participante. */
export function IndividualResultPage({ attemptId: rawId }: { attemptId: string }) {
  const attemptId = parseAttemptId(rawId);
  const canGrade = useCanGradeAttempts();
  const result = useQuery({ ...attemptResultQuery(attemptId ?? 0), enabled: attemptId !== null });
  const detail = useQuery({ ...detailedResultQuery(attemptId ?? 0), enabled: attemptId !== null });

  const header = (
    <PageHeader
      title="Reporte individual confidencial"
      subtitle={attemptId === null ? undefined : `Resultado del intento #${attemptId}`}
      breadcrumbs={[{ label: "Resultados", to: "/app/resultados" }, { label: "Resultado individual" }]}
      renderBreadcrumbLink={({ label }) => <Link to="/app/resultados">{label}</Link>}
      actions={
        attemptId === null || result.isPending ? undefined : (
          <>
            <BackLink />
            {attemptId !== null && (
              <Button asChild variant="outline" size="sm">
                <Link to="/app/resultados/intento/$attemptId" params={{ attemptId: String(attemptId) }}>
                  Ver respuestas
                </Link>
              </Button>
            )}
          </>
        )
      }
    />
  );

  if (attemptId === null) {
    return (
      <div className="space-y-6">
        {header}
        <ErrorPanel error={new Error("El identificador del intento no es válido.")} title="Intento no válido" />
      </div>
    );
  }

  if (result.isPending) {
    return (
      <div className="space-y-6" aria-busy="true">
        {header}
        <p role="status" className="sr-only">
          Cargando resultado…
        </p>
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (result.isError) {
    if (isMissingError(result.error)) {
      return (
        <div className="space-y-6">
          {header}
          <EmptyState
            title="Este intento aún no tiene resultado"
            description="El resultado con baremo se genera al calificar el intento."
            action={
              canGrade ? (
                <Button asChild>
                  <Link to="/app/calificaciones">
                    <ClipboardCheck className="size-4" aria-hidden="true" />
                    Ir a calificaciones
                  </Link>
                </Button>
              ) : undefined
            }
          />
        </div>
      );
    }
    return (
      <div className="space-y-6">
        {header}
        <ErrorPanel error={result.error} title="No se pudo cargar el resultado" onRetry={() => void result.refetch()} />
      </div>
    );
  }

  const data = result.data;
  const status = resultStatusMeta(data.status);

  return (
    <div className="max-w-5xl space-y-6">
      {header}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base font-semibold">Datos del resultado</CardTitle>
          <ToneBadge tone={status.tone}>{status.label}</ToneBadge>
        </CardHeader>
        <CardContent className="space-y-6">
          {detail.isSuccess ? (
            <ParticipantSummary detail={detail.data} />
          ) : detail.isPending ? (
            <Skeleton className="h-16 w-full" />
          ) : (
            <InlineNotice
              tone="warning"
              title="No se pudieron cargar los datos del participante"
              action={
                <Button type="button" variant="outline" size="sm" onClick={() => void detail.refetch()}>
                  Reintentar
                </Button>
              }
            >
              El resultado se muestra sin los datos del participante.
            </InlineNotice>
          )}

          <Interpretation result={data} />
          {!data.totalInterpretation && (
            <p className="text-sm text-muted-foreground">
              Puntaje total: <span className="font-semibold tabular-nums text-foreground">{formatScore(data.totalScore)}</span>. El intento no tiene baremo
              total asociado.
            </p>
          )}

          {data.dimensions.length > 0 && (
            <section aria-labelledby="dimensions-title" className="space-y-2">
              <h2 id="dimensions-title" className="text-base font-semibold text-foreground">
                Desglose por dimensión
              </h2>
              <div className="overflow-hidden rounded-lg border border-border">
                <Table>
                  <TableCaption className="sr-only">Puntaje, percentil y categoría por dimensión</TableCaption>
                  <TableHeader className="bg-muted/70">
                    <TableRow>
                      <TableHead scope="col">Dimensión</TableHead>
                      <TableHead scope="col" className="text-right">
                        Puntaje directo
                      </TableHead>
                      <TableHead scope="col" className="text-right">
                        Percentil
                      </TableHead>
                      <TableHead scope="col">Categoría</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.dimensions.map((dimension) => (
                      <TableRow key={dimension.dimensionId}>
                        <TableCell>
                          <div className="font-medium text-foreground">{dimension.name}</div>
                          <div className="text-xs text-muted-foreground">{dimension.interpretation ?? "Sin interpretación disponible"}</div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatScore(dimension.directScore)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {dimension.percentile === null ? "—" : formatScore(dimension.percentile)}
                        </TableCell>
                        <TableCell>{dimension.category ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </section>
          )}

          <InlineNotice tone="warning" title="Aviso de uso">
            {data.disclaimer || "El sistema no emite diagnósticos psicológicos definitivos."}
          </InlineNotice>
        </CardContent>
      </Card>
    </div>
  );
}
