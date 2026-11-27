import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";

import type { DimensionAggregate, SessionResultSummary } from "../../../api/schemas/results";
import { Button } from "../../../app/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../../app/components/ui/card";
import { EmptyState } from "../../../app/components/ui/empty-state";
import { PageHeader } from "../../../app/components/ui/page-header";
import { Progress } from "../../../app/components/ui/progress";
import { Skeleton } from "../../../app/components/ui/skeleton";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "../../../app/components/ui/table";
import { ErrorPanel } from "../components/ErrorPanel";
import { InlineNotice } from "../components/InlineNotice";
import { NativeSelect } from "../components/NativeSelect";
import { formatScore } from "../format";
import { resolveGradingSelection, type SessionSearch } from "../gradingSearch";
import { useAttemptsSourceAvailable } from "../permissions";
import { analyticsQuery, dashboardOverviewQuery, sessionOptionsQuery } from "../queries";
import { SessionIdForm } from "./SessionIdForm";

export interface ResultsDashboardPageProps {
  search: SessionSearch;
  onSessionChange: (sessionId: number) => void;
}

const percent = (part: number, whole: number): number => (whole <= 0 ? 0 : Math.round((part / whole) * 100));

function Kpis({ summary }: { summary: SessionResultSummary }) {
  const items: Array<[string, number, string]> = [
    ["Asignados", summary.assignedCount, "Participantes asignados a la sesión"],
    ["Iniciados", summary.startedCount, `${percent(summary.startedCount, summary.assignedCount)}% de los asignados`],
    ["Completados", summary.completedCount, `${percent(summary.completedCount, summary.assignedCount)}% de los asignados`],
    ["Calificados", summary.scoredCount, `${percent(summary.scoredCount, summary.completedCount)}% de los completados`],
  ];
  return (
    <section aria-label="Resumen de la sesión" className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {items.map(([label, value, hint]) => (
          <div key={label} className="rounded-lg border border-border bg-card p-4 shadow-[var(--shadow-xs)]">
            <p className="text-xs font-medium text-muted-foreground">{label}</p>
            <p className="text-2xl font-semibold tabular-nums text-foreground">{value}</p>
            <p className="text-xs text-muted-foreground">{hint}</p>
          </div>
        ))}
      </div>
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Avance de la sesión (completados / asignados)</span>
          <span className="tabular-nums">{percent(summary.completedCount, summary.assignedCount)}%</span>
        </div>
        <Progress
          value={percent(summary.completedCount, summary.assignedCount)}
          className="h-1.5"
          aria-label="Avance de la sesión"
        />
      </div>
    </section>
  );
}

function Dimensions({ rows }: { rows: DimensionAggregate[] }) {
  const max = useMemo(() => Math.max(0, ...rows.map((r) => r.averageDirectScore ?? 0)), [rows]);
  const anySuppressed = rows.some((r) => r.suppressedByPrivacyThreshold);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">Promedio por dimensión</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {anySuppressed && (
          <InlineNotice tone="info" title="Datos reservados por privacidad">
            Las dimensiones con muy pocos casos no muestran su promedio para no identificar a participantes.
          </InlineNotice>
        )}
        {rows.length === 0 ? (
          <EmptyState title="Sin datos agregados" description="Esta sesión todavía no tiene resultados calificados." />
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <Table>
              <TableCaption className="sr-only">Promedio de puntaje directo y cantidad de casos por dimensión</TableCaption>
              <TableHeader className="bg-muted/70">
                <TableRow>
                  <TableHead scope="col">Dimensión</TableHead>
                  <TableHead scope="col" className="text-right">
                    Casos
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    Promedio
                  </TableHead>
                  <TableHead scope="col" className="w-1/3">
                    <span className="sr-only">Proporción respecto del mayor promedio</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const hidden = row.suppressedByPrivacyThreshold || row.averageDirectScore === null;
                  return (
                    <TableRow key={row.dimensionId}>
                      <TableCell className="font-medium">{row.name}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.count}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {hidden ? <span className="text-muted-foreground">Reservado</span> : formatScore(row.averageDirectScore)}
                      </TableCell>
                      <TableCell>
                        {!hidden && max > 0 && (
                          <div aria-hidden="true" className="h-2 w-full rounded-full bg-muted">
                            <div className="h-2 rounded-full bg-primary" style={{ width: `${percent(row.averageDirectScore ?? 0, max)}%` }} />
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Dashboard de resultados agregados: `GET /dashboard/overview` (KPIs) y `GET /analytics/results`
 * (promedios por dimensión), ambos con RESULTADO_AGREGADO_VER o RESULTADO_VER y `sessionId` obligatorio.
 */
export function ResultsDashboardPage({ search, onSessionChange }: ResultsDashboardPageProps) {
  const available = useAttemptsSourceAvailable();
  const sessions = useQuery({ ...sessionOptionsQuery(), enabled: available });
  const validated = sessions.isSuccess;
  const options = useMemo(() => sessions.data ?? [], [sessions.data]);

  // Con lista de sesiones, la selección se valida contra la lista fresca; sin ella (Consultor) rige la URL.
  const selection = available && validated ? resolveGradingSelection(options, search.sessionId) : null;
  const sessionId = available ? selection?.sessionId : search.sessionId;
  const ready = sessionId !== undefined;

  const overview = useQuery({ ...dashboardOverviewQuery(sessionId ?? 0), enabled: ready });
  const analytics = useQuery({ ...analyticsQuery(sessionId ?? 0), enabled: ready });

  const header = (
    <PageHeader
      title="Dashboard de resultados"
      subtitle="Indicadores agregados de una sesión de aplicación."
      actions={
        <Button
          type="button"
          variant="outline"
          disabled={!ready || overview.isFetching || analytics.isFetching}
          onClick={() => {
            void overview.refetch();
            void analytics.refetch();
          }}
        >
          <RefreshCw className="size-4" aria-hidden="true" />
          Actualizar
        </Button>
      }
    />
  );

  if (available && sessions.isError) {
    return (
      <div className="space-y-6">
        {header}
        <ErrorPanel error={sessions.error} title="No se pudo cargar la lista de sesiones" onRetry={() => void sessions.refetch()} />
      </div>
    );
  }

  const picker = available ? (
    <div className="flex items-center gap-2">
      <label htmlFor="dashboard-session" className="text-sm font-medium text-foreground">
        Sesión
      </label>
      <NativeSelect
        id="dashboard-session"
        className="w-80"
        disabled={!validated}
        value={sessionId === undefined ? "" : String(sessionId)}
        onChange={(event) => onSessionChange(Number(event.target.value))}
      >
        {!validated && <option value="">Cargando sesiones…</option>}
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name} ({option.code})
          </option>
        ))}
      </NativeSelect>
    </div>
  ) : (
    <SessionIdForm key={search.sessionId ?? "none"} initial={search.sessionId} onSubmit={onSessionChange} />
  );

  return (
    <div className="space-y-6">
      {header}
      <div className="rounded-lg border border-border bg-card p-4 shadow-[var(--shadow-xs)]">{picker}</div>

      {selection?.requestedMissing && (
        <InlineNotice tone="warning" title="Sesión no encontrada">
          La sesión #{search.sessionId} solicitada no está en la lista de sesiones actual. Se muestra la más reciente.
        </InlineNotice>
      )}

      {!available && !ready && (
        <EmptyState title="Elige una sesión" description="Indica el número de la sesión para ver sus resultados agregados." />
      )}

      {available && validated && options.length === 0 && (
        <EmptyState title="No hay sesiones" description="Todavía no se ha programado ninguna sesión de aplicación." />
      )}

      {ready && (
        <>
          {overview.isPending ? (
            <Skeleton className="h-28 w-full" />
          ) : overview.isError ? (
            <ErrorPanel error={overview.error} title="No se pudo cargar el resumen" onRetry={() => void overview.refetch()} />
          ) : (
            <Kpis summary={overview.data} />
          )}

          {analytics.isPending ? (
            <Skeleton className="h-48 w-full" />
          ) : analytics.isError ? (
            <ErrorPanel error={analytics.error} title="No se pudieron cargar los promedios" onRetry={() => void analytics.refetch()} />
          ) : (
            <Dimensions rows={analytics.data} />
          )}
        </>
      )}
    </div>
  );
}
