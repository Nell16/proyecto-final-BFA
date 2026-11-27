import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Eye, Search, ShieldCheck } from "lucide-react";
import type { AuditLog } from "../../../api/schemas/admin";
import { Badge } from "../../../app/components/ui/badge";
import { Button } from "../../../app/components/ui/button";
import { DataTable, type DataTableColumn } from "../../../app/components/ui/data-table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../app/components/ui/dialog";
import { EmptyState } from "../../../app/components/ui/empty-state";
import { Input } from "../../../app/components/ui/input";
import { Label } from "../../../app/components/ui/label";
import { PageHeader } from "../../../app/components/ui/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../app/components/ui/select";
import { errorMessage } from "../error-message";
import { formatAdminDateTime, localDayOf } from "../format";
import { auditListQuery } from "../queries";

const ALL = "all";
const PAGE_SIZE = 20;

function formatJsonBlock(raw: string | null): string {
  if (!raw) return "—";
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export function AuditPage() {
  const [search, setSearch] = useState("");
  const [entityFilter, setEntityFilter] = useState("");
  const [entityIdFilter, setEntityIdFilter] = useState("");
  const [actionFilter, setActionFilter] = useState<string>(ALL);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);

  // El backend solo filtra cuando se envían ambos parámetros (entity y entityId); el resto se filtra en cliente (B10 pendiente).
  const auditQuery = useQuery(
    auditListQuery({
      entity: entityFilter,
      entityId: entityIdFilter,
    }),
  );

  const logs = useMemo(() => auditQuery.data ?? [], [auditQuery.data]);

  const actionOptions = useMemo(() => {
    const actions = new Set<string>();
    for (const item of logs) {
      if (item.action) actions.add(item.action);
    }
    return Array.from(actions).sort((a, b) => a.localeCompare(b));
  }, [logs]);

  const filteredLogs = useMemo(() => {
    const term = search.trim().toLowerCase();
    const entityTerm = entityFilter.trim().toLowerCase();
    const entityIdTerm = entityIdFilter.trim().toLowerCase();

    return logs.filter((log) => {
      if (entityTerm && !log.entity.toLowerCase().includes(entityTerm)) return false;
      if (entityIdTerm && !(log.entityId?.toLowerCase().includes(entityIdTerm) ?? false)) return false;
      if (actionFilter !== ALL && log.action !== actionFilter) return false;

      if (dateFrom || dateTo) {
        const day = localDayOf(log.createdAt);
        if (!day) return false;
        if (dateFrom && day < dateFrom) return false;
        if (dateTo && day > dateTo) return false;
      }

      if (term) {
        const haystack = [
          log.username ?? "sistema",
          log.userFullName ?? "",
          log.action,
          log.entity,
          log.entityId ?? "",
          log.ipAddress ?? "",
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(term)) return false;
      }

      return true;
    });
  }, [logs, search, entityFilter, entityIdFilter, actionFilter, dateFrom, dateTo]);

  const hasActiveFilters =
    search.trim() !== "" ||
    entityFilter.trim() !== "" ||
    entityIdFilter.trim() !== "" ||
    actionFilter !== ALL ||
    dateFrom !== "" ||
    dateTo !== "";

  const totalFiltered = filteredLogs.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedLogs = useMemo(
    () => filteredLogs.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filteredLogs, safePage],
  );

  const clearFilters = () => {
    setSearch("");
    setEntityFilter("");
    setEntityIdFilter("");
    setActionFilter(ALL);
    setDateFrom("");
    setDateTo("");
    setPage(1);
  };

  const columns: DataTableColumn<AuditLog>[] = [
    {
      id: "createdAt",
      header: "Fecha y hora",
      className: "font-mono text-xs tabular-nums whitespace-nowrap",
      cell: (row) => (
        <time dateTime={row.createdAt} title={row.createdAt}>
          {formatAdminDateTime(row.createdAt)}
        </time>
      ),
    },
    {
      id: "user",
      header: "Usuario",
      cell: (row) =>
        row.username ? (
          <div>
            <div className="text-sm font-medium text-foreground">{row.username}</div>
            {row.userFullName && <div className="text-xs text-muted-foreground">{row.userFullName}</div>}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">Sistema</span>
        ),
    },
    {
      id: "action",
      header: "Acción",
      cell: (row) => (
        <Badge variant="secondary" className="font-mono text-xs">
          {row.action}
        </Badge>
      ),
    },
    {
      id: "entity",
      header: "Entidad",
      cell: (row) => (
        <div className="font-mono text-xs">
          <span className="text-foreground">{row.entity}</span>
          {row.entityId && <span className="text-muted-foreground"> #{row.entityId}</span>}
        </div>
      ),
    },
    {
      id: "ipAddress",
      header: "Dirección IP",
      className: "font-mono text-xs tabular-nums text-muted-foreground whitespace-nowrap",
      cell: (row) => row.ipAddress ?? "—",
    },
    {
      id: "details",
      header: <span className="sr-only">Detalle</span>,
      className: "w-12 text-right",
      cell: (row) => (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Ver detalle del evento ${row.id}`}
          onClick={() => setSelectedLog(row)}
        >
          <Eye className="size-4" aria-hidden="true" />
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Auditoría"
        subtitle="Registro cronológico de eventos y cambios sensibles realizados en el sistema."
      />

      <DataTable
        density="compact"
        columns={columns}
        rows={pagedLogs}
        getRowId={(row) => String(row.id)}
        loading={auditQuery.isPending}
        error={
          auditQuery.isError
            ? errorMessage(auditQuery.error, "No se pudo cargar la bitácora de auditoría.")
            : null
        }
        onRetry={() => void auditQuery.refetch()}
        pagination={{
          page: safePage,
          pageSize: PAGE_SIZE,
          total: totalFiltered,
          onPageChange: setPage,
        }}
        emptyState={
          hasActiveFilters ? (
            <EmptyState
              icon={<Search className="size-6 text-muted-foreground" aria-hidden="true" />}
              title="Sin eventos para los filtros aplicados"
              description="Ajusta la búsqueda, entidad, acción o rango de fechas."
              action={
                <Button type="button" variant="outline" size="sm" onClick={clearFilters}>
                  Limpiar filtros
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={<ShieldCheck className="size-6 text-muted-foreground" aria-hidden="true" />}
              title="Sin registros de auditoría"
              description="Todavía no hay eventos registrados en la bitácora."
            />
          )
        }
        toolbar={
          <div className="flex w-full flex-wrap items-end justify-between gap-3">
            <div className="flex flex-wrap items-end gap-2">
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  type="search"
                  aria-label="Buscar en auditoría"
                  placeholder="Buscar usuario, acción, IP…"
                  className="w-60 pl-8"
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setPage(1);
                  }}
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="audit-entity" className="text-xs text-muted-foreground">
                  Entidad
                </Label>
                <Input
                  id="audit-entity"
                  placeholder="Ej.: usuario"
                  className="w-36"
                  value={entityFilter}
                  onChange={(event) => {
                    setEntityFilter(event.target.value);
                    setPage(1);
                  }}
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="audit-entity-id" className="text-xs text-muted-foreground">
                  ID de entidad
                </Label>
                <Input
                  id="audit-entity-id"
                  placeholder="Ej.: 7"
                  className="w-28"
                  value={entityIdFilter}
                  onChange={(event) => {
                    setEntityIdFilter(event.target.value);
                    setPage(1);
                  }}
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="audit-action-trigger" className="text-xs text-muted-foreground">
                  Acción
                </Label>
                <Select
                  value={actionFilter}
                  onValueChange={(value) => {
                    setActionFilter(value);
                    setPage(1);
                  }}
                >
                  <SelectTrigger id="audit-action-trigger" aria-label="Filtrar por acción" className="w-48">
                    <SelectValue placeholder="Todas las acciones" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>Todas las acciones</SelectItem>
                    {actionOptions.map((action) => (
                      <SelectItem key={action} value={action}>
                        {action}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label htmlFor="audit-date-from" className="text-xs text-muted-foreground">
                  Desde
                </Label>
                <Input
                  id="audit-date-from"
                  type="date"
                  className="w-36"
                  value={dateFrom}
                  onChange={(event) => {
                    setDateFrom(event.target.value);
                    setPage(1);
                  }}
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="audit-date-to" className="text-xs text-muted-foreground">
                  Hasta
                </Label>
                <Input
                  id="audit-date-to"
                  type="date"
                  className="w-36"
                  value={dateTo}
                  onChange={(event) => {
                    setDateTo(event.target.value);
                    setPage(1);
                  }}
                />
              </div>

              {hasActiveFilters && (
                <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
                  Limpiar filtros
                </Button>
              )}
            </div>

            <p className="text-xs text-muted-foreground tabular-nums">
              {hasActiveFilters
                ? `${totalFiltered} de ${logs.length} ${logs.length === 1 ? "evento" : "eventos"}`
                : `${logs.length} ${logs.length === 1 ? "registro" : "registros"}`}
            </p>
          </div>
        }
      />

      <Dialog open={selectedLog !== null} onOpenChange={(open) => !open && setSelectedLog(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Detalle de evento #{selectedLog?.id}</DialogTitle>
            <DialogDescription>
              {selectedLog
                ? `${selectedLog.action} · ${selectedLog.entity}${selectedLog.entityId ? ` #${selectedLog.entityId}` : ""}`
                : ""}
            </DialogDescription>
          </DialogHeader>

          {selectedLog && (
            <div className="space-y-4 text-sm">
              <div className="grid gap-3 rounded-md border border-border bg-muted/30 p-3 sm:grid-cols-2">
                <div>
                  <div className="text-xs text-muted-foreground">Fecha y hora</div>
                  <div className="font-mono text-xs font-medium">{formatAdminDateTime(selectedLog.createdAt)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Usuario</div>
                  <div className="text-xs font-medium">
                    {selectedLog.username ?? "Sistema"}
                    {selectedLog.userFullName ? ` (${selectedLog.userFullName})` : ""}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Dirección IP</div>
                  <div className="font-mono text-xs">{selectedLog.ipAddress ?? "—"}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Agente de usuario</div>
                  <div className="truncate font-mono text-xs" title={selectedLog.userAgent ?? undefined}>
                    {selectedLog.userAgent ?? "—"}
                  </div>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <div className="text-xs font-medium text-muted-foreground">Valor anterior</div>
                  <pre className="max-h-48 overflow-auto rounded-md border border-border bg-muted/40 p-2.5 font-mono text-xs text-foreground">
                    {formatJsonBlock(selectedLog.previousValue)}
                  </pre>
                </div>
                <div className="space-y-1">
                  <div className="text-xs font-medium text-muted-foreground">Valor nuevo</div>
                  <pre className="max-h-48 overflow-auto rounded-md border border-border bg-muted/40 p-2.5 font-mono text-xs text-foreground">
                    {formatJsonBlock(selectedLog.newValue)}
                  </pre>
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSelectedLog(null)}>
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
