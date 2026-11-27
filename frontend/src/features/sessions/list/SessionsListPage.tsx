import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Eye, Plus, Search, Settings2 } from "lucide-react";

import type { Session } from "../../../api/schemas/sessions";
import { Button } from "../../../app/components/ui/button";
import { DataTable, type DataTableColumn } from "../../../app/components/ui/data-table";
import { EmptyState } from "../../../app/components/ui/empty-state";
import { Input } from "../../../app/components/ui/input";
import { PageHeader } from "../../../app/components/ui/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../app/components/ui/select";
import { StatusBadge } from "../../../app/components/ui/status-badge";
import { useCanCreateSessions } from "../detail/model";
import { formatDateTime, localDayOf } from "../detail/format";
import { sessionListQuery } from "../queries";

type StatusFilter = "ALL" | Exclude<Session["status"], "DESCONOCIDO">;

const STATUS_OPTIONS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: "ALL", label: "Todos los estados" },
  { value: "PROGRAMADA", label: "Programada" },
  { value: "ABIERTA", label: "Abierta" },
  { value: "PAUSADA", label: "Pausada" },
  { value: "CERRADA", label: "Cerrada" },
  { value: "CANCELADA", label: "Cancelada" },
];

const normalize = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

export interface SessionExtraFilters {
  /** `YYYY-MM-DD` inclusive, sobre la fecha programada de inicio. */
  from?: string;
  /** `YYYY-MM-DD` inclusive. */
  to?: string;
  /** `versionTestId`; `undefined` = todas. */
  versionId?: number;
}

/** Filtra en cliente por estado, texto (código, nombre o ubicación), rango de fecha programada y versión. */
export function filterSessions(
  sessions: readonly Session[],
  search: string,
  status: StatusFilter,
  extra: SessionExtraFilters = {},
): Session[] {
  const needle = normalize(search.trim());
  return sessions.filter((session) => {
    if (status !== "ALL" && session.status !== status) return false;
    // `scheduledStart` es un instante ISO con zona: el filtro compara contra el día LOCAL del navegador.
    const day = localDayOf(session.scheduledStart);
    if (extra.from && (day === null || day < extra.from)) return false;
    if (extra.to && (day === null || day > extra.to)) return false;
    if (extra.versionId !== undefined && session.versionTestId !== extra.versionId) return false;
    if (needle === "") return true;
    return [session.code, session.name, session.location ?? ""].some((field) =>
      normalize(field).includes(needle),
    );
  });
}

export function SessionsListPage() {
  const canCreate = useCanCreateSessions();
  const query = useQuery(sessionListQuery());
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [version, setVersion] = useState("ALL");

  const sessions = useMemo(
    () =>
      [...(query.data ?? [])].sort((a, b) => b.scheduledStart.localeCompare(a.scheduledStart)),
    [query.data],
  );
  const versionIds = useMemo(
    () => [...new Set(sessions.map((session) => session.versionTestId))].sort((a, b) => a - b),
    [sessions],
  );
  const rows = useMemo(
    () =>
      filterSessions(sessions, search, status, {
        from,
        to,
        versionId: version === "ALL" ? undefined : Number(version),
      }),
    [sessions, search, status, from, to, version],
  );
  const hasFilters = search.trim() !== "" || status !== "ALL" || from !== "" || to !== "" || version !== "ALL";

  const clearFilters = () => {
    setSearch("");
    setStatus("ALL");
    setFrom("");
    setTo("");
    setVersion("ALL");
  };

  const newSessionButton = canCreate ? (
    <Button asChild>
      <Link to="/app/sesiones/nueva">
        <Plus className="size-4" aria-hidden="true" />
        Nueva sesión
      </Link>
    </Button>
  ) : null;

  const columns: DataTableColumn<Session>[] = [
    {
      id: "code",
      header: "Código",
      cell: (session) => <span className="font-mono text-xs">{session.code}</span>,
    },
    {
      id: "name",
      header: "Nombre",
      cell: (session) => session.name,
    },
    {
      id: "status",
      header: "Estado",
      cell: (session) => <StatusBadge domain="session" status={session.status} />,
    },
    {
      id: "scheduledStart",
      header: "Inicio programado",
      className: "tabular-nums",
      cell: (session) => formatDateTime(session.scheduledStart),
    },
    {
      id: "location",
      header: "Ubicación",
      cell: (session) => session.location ?? <span className="text-muted-foreground">—</span>,
    },
    {
      id: "actions",
      header: <span className="sr-only">Acciones</span>,
      className: "text-right",
      cell: (session) => (
        <div className="flex items-center justify-end gap-1">
          <Button asChild variant="ghost" size="sm">
            <Link
              to="/app/sesiones/$id"
              params={{ id: String(session.id) }}
              aria-label={`Ver detalle de ${session.name}`}
            >
              <Eye className="size-4" aria-hidden="true" />
              Ver detalle
            </Link>
          </Button>
          {canCreate && session.status === "PROGRAMADA" && (
            <Button asChild variant="ghost" size="sm">
              <Link
                to="/app/sesiones/nueva"
                search={{ sessionId: session.id }}
                aria-label={`Reanudar configuración de ${session.name}`}
              >
                <Settings2 className="size-4" aria-hidden="true" />
                Reanudar configuración
              </Link>
            </Button>
          )}
        </div>
      ),
    },
  ];

  const emptyState = hasFilters ? (
    <EmptyState
      title="Sin resultados para este filtro"
      description="Ninguna sesión coincide con la búsqueda, el estado, el rango de fechas o la versión seleccionados."
      action={
        <Button type="button" variant="outline" onClick={clearFilters}>
          Limpiar filtros
        </Button>
      }
    />
  ) : (
    <EmptyState
      title="Sin sesiones aún"
      description="Todavía no se ha programado ninguna sesión de aplicación."
      action={newSessionButton ?? undefined}
    />
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sesiones de aplicación"
        subtitle="Programa, abre y monitorea las sesiones de evaluación."
        actions={newSessionButton}
      />

      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(session) => String(session.id)}
        primaryColumnId="name"
        getRowHref={(session) => `/app/sesiones/${session.id}`}
        renderRowLink={({ row, className, children }) => (
          <Link to="/app/sesiones/$id" params={{ id: String(row.id) }} className={className}>
            {children}
          </Link>
        )}
        loading={query.isPending}
        error={query.isError ? query.error : null}
        onRetry={() => void query.refetch()}
        emptyState={emptyState}
        toolbar={
          <>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Buscar por código, nombre o ubicación"
                  aria-label="Buscar sesiones"
                  className="w-72 pl-8"
                />
              </div>
              <Select value={status} onValueChange={(value) => setStatus(value as StatusFilter)}>
                <SelectTrigger aria-label="Filtrar por estado" className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="date"
                value={from}
                max={to || undefined}
                onChange={(event) => setFrom(event.target.value)}
                aria-label="Programada desde"
                className="w-40"
              />
              <Input
                type="date"
                value={to}
                min={from || undefined}
                onChange={(event) => setTo(event.target.value)}
                aria-label="Programada hasta"
                className="w-40"
              />
              <Select value={version} onValueChange={setVersion}>
                <SelectTrigger aria-label="Filtrar por versión" className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Todas las versiones</SelectItem>
                  {versionIds.map((id) => (
                    <SelectItem key={id} value={String(id)}>
                      Versión #{id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {hasFilters && (
                <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
                  Limpiar filtros
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
              {query.isSuccess ? `${rows.length} ${rows.length === 1 ? "sesión" : "sesiones"}` : ""}
            </p>
          </>
        }
      />
    </div>
  );
}
