import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileBarChart, FilePlus2, FileSpreadsheet, FileText, Info, Search } from "lucide-react";
import type { GeneratedReport, ReportFormat } from "../../../api/schemas/reports";
import { Alert, AlertDescription, AlertTitle } from "../../../app/components/ui/alert";
import { Badge } from "../../../app/components/ui/badge";
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
import { PERMISSIONS } from "../../../store/permissions";
import { useStaffAuth } from "../../../store/staffAuth";
import { errorMessage } from "../../catalogs/error-message";
import { formatDateTime } from "../../sessions/detail/format";
import { reportListQuery } from "../queries";
import { ReportFormDialog, type ReportMode } from "./ReportFormDialog";

type FormatFilter = "ALL" | ReportFormat;

function formatBadgeClass(format: ReportFormat): string {
  switch (format) {
    case "PDF":
      return "border border-status-info-border bg-status-info-bg text-status-info-fg";
    case "XLSX":
      return "border border-status-success-border bg-status-success-bg text-status-success-fg";
    case "CSV":
      return "border border-status-neutral-border bg-status-neutral-bg text-status-neutral-fg";
  }
}

function formatReference(report: GeneratedReport): string {
  const parts: string[] = [];
  if (report.sessionId !== null) parts.push(`Sesión #${report.sessionId}`);
  if (report.attemptId !== null) parts.push(`Intento #${report.attemptId}`);
  if (report.resultId !== null) parts.push(`Resultado #${report.resultId}`);
  return parts.length > 0 ? parts.join(" · ") : "—";
}

export function ReportsPage() {
  const canExport = useStaffAuth((s) => s.hasPermission(PERMISSIONS.REPORTE_EXPORTAR));
  const reportsQuery = useQuery(reportListQuery());

  const [search, setSearch] = useState("");
  const [formatFilter, setFormatFilter] = useState<FormatFilter>("ALL");
  const [dialogState, setDialogState] = useState<{ open: boolean; mode: ReportMode }>({
    open: false,
    mode: "individual",
  });

  const rows = useMemo(() => {
    const list = [...(reportsQuery.data ?? [])].sort((a, b) =>
      b.generatedAt.localeCompare(a.generatedAt) || b.id - a.id,
    );
    const term = search.trim().toLowerCase();
    return list.filter((item) => {
      if (formatFilter !== "ALL" && item.format !== formatFilter) return false;
      if (!term) return true;
      return [item.reportType, item.storagePath, formatReference(item)]
        .join(" ")
        .toLowerCase()
        .includes(term);
    });
  }, [reportsQuery.data, search, formatFilter]);

  const hasFilters = search.trim() !== "" || formatFilter !== "ALL";

  const columns: DataTableColumn<GeneratedReport>[] = [
    {
      id: "id",
      header: "ID",
      className: "w-20 font-mono text-xs tabular-nums",
      cell: (row) => `#${row.id}`,
    },
    {
      id: "reportType",
      header: "Tipo",
      cell: (row) => <span className="font-medium text-foreground">{row.reportType}</span>,
    },
    {
      id: "format",
      header: "Formato",
      cell: (row) => (
        <Badge className={formatBadgeClass(row.format)}>
          {row.format === "XLSX" ? (
            <FileSpreadsheet className="size-3.5" aria-hidden="true" />
          ) : (
            <FileText className="size-3.5" aria-hidden="true" />
          )}
          <span>{row.format}</span>
        </Badge>
      ),
    },
    {
      id: "reference",
      header: "Referencia",
      className: "tabular-nums text-xs",
      cell: (row) => formatReference(row),
    },
    {
      id: "storagePath",
      header: "Ruta de almacenamiento",
      cell: (row) => <span className="font-mono text-xs text-muted-foreground">{row.storagePath}</span>,
    },
    {
      id: "generatedAt",
      header: "Generado",
      className: "tabular-nums",
      cell: (row) => formatDateTime(row.generatedAt),
    },
  ];

  const emptyState = hasFilters ? (
    <EmptyState
      icon={<FileBarChart className="size-6 text-muted-foreground" aria-hidden="true" />}
      title="Sin resultados para este filtro"
      description="Ningún reporte coincide con la búsqueda o el formato seleccionado."
      action={
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setSearch("");
            setFormatFilter("ALL");
          }}
        >
          Limpiar filtros
        </Button>
      }
    />
  ) : (
    <EmptyState
      icon={<FileBarChart className="size-6 text-muted-foreground" aria-hidden="true" />}
      title="Sin reportes registrados"
      description="Todavía no se han registrado reportes individuales ni agregados."
      action={
        canExport ? (
          <Button
            type="button"
            onClick={() => setDialogState({ open: true, mode: "individual" })}
          >
            <FilePlus2 className="size-4" aria-hidden="true" />
            Generar reporte individual
          </Button>
        ) : undefined
      }
    />
  );

  return (
    <div className="space-y-6 max-w-6xl">
      <PageHeader
        title="Centro de reportes"
        subtitle="Historial y registro de reportes individuales y agregados de evaluación."
        actions={
          canExport ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogState({ open: true, mode: "aggregate" })}
              >
                <FileBarChart className="size-4" aria-hidden="true" />
                Nuevo reporte agregado
              </Button>
              <Button
                type="button"
                onClick={() => setDialogState({ open: true, mode: "individual" })}
              >
                <FilePlus2 className="size-4" aria-hidden="true" />
                Nuevo reporte individual
              </Button>
            </div>
          ) : undefined
        }
      />

      {!canExport && (
        <Alert className="border-status-info-border bg-status-info-bg text-status-info-fg">
          <Info className="size-4" aria-hidden="true" />
          <AlertTitle>Modo de solo consulta</AlertTitle>
          <AlertDescription className="text-status-info-fg">
            Tu rol puede consultar el historial de reportes, pero requiere el permiso REPORTE_EXPORTAR para registrar nuevos reportes.
          </AlertDescription>
        </Alert>
      )}

      <Alert className="border-status-info-border bg-status-info-bg/70 text-status-info-fg">
        <Info className="size-4" aria-hidden="true" />
        <AlertTitle>Registro de reportes en servidor</AlertTitle>
        <AlertDescription className="text-status-info-fg">
          El backend actual registra metadatos y rutas en /reports (GET, POST /individual, POST /aggregate). La descarga directa de archivos binarios aún no está expuesta en ReportController.
        </AlertDescription>
      </Alert>

      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(row) => String(row.id)}
        loading={reportsQuery.isPending}
        error={
          reportsQuery.isError
            ? errorMessage(reportsQuery.error, "No se pudo cargar el listado de reportes.")
            : null
        }
        onRetry={() => void reportsQuery.refetch()}
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
                  placeholder="Buscar por tipo, ruta o referencia…"
                  aria-label="Buscar reportes"
                  className="w-72 pl-8"
                />
              </div>
              <Select
                value={formatFilter}
                onValueChange={(value) => setFormatFilter(value as FormatFilter)}
              >
                <SelectTrigger aria-label="Filtrar por formato" className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Todos los formatos</SelectItem>
                  <SelectItem value="PDF">PDF</SelectItem>
                  <SelectItem value="XLSX">XLSX</SelectItem>
                  <SelectItem value="CSV">CSV</SelectItem>
                </SelectContent>
              </Select>
              {hasFilters && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearch("");
                    setFormatFilter("ALL");
                  }}
                >
                  Limpiar filtros
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
              {reportsQuery.isSuccess
                ? `${rows.length} ${rows.length === 1 ? "reporte" : "reportes"}`
                : ""}
            </p>
          </>
        }
      />

      {canExport && (
        <ReportFormDialog
          open={dialogState.open}
          mode={dialogState.mode}
          onOpenChange={(open) => setDialogState((prev) => ({ ...prev, open }))}
        />
      )}
    </div>
  );
}
