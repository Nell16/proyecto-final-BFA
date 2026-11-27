import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  CloudUpload,
  Database,
  Download,
  Loader2,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import type { Backup } from "../../../api/schemas/backups";
import { Alert, AlertDescription, AlertTitle } from "../../../app/components/ui/alert";
import { Badge } from "../../../app/components/ui/badge";
import { Button } from "../../../app/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../app/components/ui/card";
import { useConfirm } from "../../../app/components/ui/confirm-dialog";
import { DataTable, type DataTableColumn } from "../../../app/components/ui/data-table";
import { EmptyState } from "../../../app/components/ui/empty-state";
import { PageHeader } from "../../../app/components/ui/page-header";
import { captureAccountScope } from "../../../store/accountScope";
import { PERMISSIONS } from "../../../store/permissions";
import { useStaffAuth } from "../../../store/staffAuth";
import { errorMessage, isForbidden } from "../../catalogs/error-message";
import { formatDateTime } from "../../sessions/detail/format";
import { useCreateBackup, useDownloadBackup, useRequestRestore } from "../mutations";
import { backupListQuery } from "../queries";

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function BackupsPage() {
  const confirm = useConfirm();
  const canExport = useStaffAuth((s) => s.hasPermission(PERMISSIONS.REPORTE_EXPORTAR));
  const listQuery = useQuery({ ...backupListQuery(), enabled: canExport });
  const createBackup = useCreateBackup();
  const downloadBackup = useDownloadBackup();
  const requestRestore = useRequestRestore();

  const [downloadingFile, setDownloadingFile] = useState<string | null>(null);
  const [restoringFile, setRestoringFile] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const backups = listQuery.data ?? [];
  const isBusy = createBackup.isPending || downloadingFile !== null || restoringFile !== null;

  const handleGenerate = async () => {
    const confirmed = await confirm({
      tone: "default",
      title: "¿Generar respaldo manual?",
      description:
        "Se creará un nuevo archivo JSON con el inventario actual en el almacenamiento del servidor y quedará registrado en auditoría.",
      confirmLabel: "Generar respaldo",
    });
    if (!confirmed) return;

    const scope = captureAccountScope();
    setActionError(null);
    try {
      const created = await createBackup.mutateAsync();
      if (!scope.isCurrent()) return;
      toast.success(`Respaldo generado: ${created.fileName}`);
    } catch (error) {
      if (!scope.isCurrent()) return;
      const msg = errorMessage(error, "No se pudo generar el respaldo.");
      setActionError(msg);
      if (!isForbidden(error)) toast.error(msg);
    }
  };

  const handleDownload = async (backup: Backup) => {
    const scope = captureAccountScope();
    setActionError(null);
    setDownloadingFile(backup.fileName);
    try {
      const downloaded = await downloadBackup.mutateAsync(backup.fileName);
      if (!scope.isCurrent()) return;
      toast.success(`Respaldo descargado: ${downloaded.fileName}`);
    } catch (error) {
      if (!scope.isCurrent()) return;
      const msg = errorMessage(error, `No se pudo descargar el respaldo «${backup.fileName}».`);
      setActionError(msg);
      if (!isForbidden(error)) toast.error(msg);
    } finally {
      if (scope.isCurrent()) setDownloadingFile(null);
    }
  };

  const handleRequestRestore = async (backup: Backup) => {
    const confirmed = await confirm({
      tone: "danger",
      title: "¿Solicitar restauración del respaldo?",
      description: `Se registrará una solicitud auditada de restauración del sistema a partir de «${backup.fileName}». Esta operación queda registrada para revisión y ejecución controlada.`,
      confirmLabel: "Solicitar restauración",
    });
    if (!confirmed) return;

    const scope = captureAccountScope();
    setActionError(null);
    setRestoringFile(backup.fileName);
    try {
      const result = await requestRestore.mutateAsync(backup.fileName);
      if (!scope.isCurrent()) return;
      toast.success(`Solicitud de restauración auditada (#${result.auditId}).`);
    } catch (error) {
      if (!scope.isCurrent()) return;
      const msg = errorMessage(error, `No se pudo solicitar la restauración de «${backup.fileName}».`);
      setActionError(msg);
      if (!isForbidden(error)) toast.error(msg);
    } finally {
      if (scope.isCurrent()) setRestoringFile(null);
    }
  };

  const columns: DataTableColumn<Backup>[] = [
    {
      id: "fileName",
      header: "Archivo",
      cell: (row) => <span className="font-mono text-xs font-medium">{row.fileName}</span>,
    },
    {
      id: "status",
      header: "Estado",
      cell: (row) => (
        <Badge
          className={
            row.status === "GENERADO"
              ? "border border-status-success-border bg-status-success-bg text-status-success-fg"
              : "border border-status-neutral-border bg-status-neutral-bg text-status-neutral-fg"
          }
        >
          {row.status === "GENERADO" ? "Generado" : "Desconocido"}
        </Badge>
      ),
    },
    {
      id: "sizeBytes",
      header: "Tamaño",
      className: "tabular-nums",
      cell: (row) => formatBytes(row.sizeBytes),
    },
    {
      id: "generatedAt",
      header: "Generado",
      className: "tabular-nums",
      cell: (row) => formatDateTime(row.generatedAt),
    },
    {
      id: "actions",
      header: <span className="sr-only">Acciones</span>,
      className: "text-right",
      cell: (row) => {
        const isDownloading = downloadingFile === row.fileName;
        const isRestoring = restoringFile === row.fileName;
        return (
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isBusy}
              onClick={() => void handleDownload(row)}
              aria-label={`Descargar respaldo ${row.fileName}`}
            >
              {isDownloading ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Download className="size-4" aria-hidden="true" />
              )}
              <span>{isDownloading ? "Descargando…" : "Descargar"}</span>
            </Button>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={isBusy}
              onClick={() => void handleRequestRestore(row)}
              aria-label={`Solicitar restauración de ${row.fileName}`}
            >
              {isRestoring ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <RotateCcw className="size-4" aria-hidden="true" />
              )}
              <span>{isRestoring ? "Solicitando…" : "Solicitar restauración"}</span>
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-6 max-w-6xl">
      <PageHeader
        title="Respaldos y restauración"
        subtitle="Inventario real generado por el servidor, descarga segura y solicitudes auditadas."
        actions={
          canExport ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={listQuery.isFetching || isBusy}
                onClick={() => void listQuery.refetch()}
              >
                <RefreshCw
                  className={listQuery.isFetching ? "size-4 animate-spin" : "size-4"}
                  aria-hidden="true"
                />
                <span>Actualizar</span>
              </Button>
              <Button type="button" disabled={isBusy} onClick={() => void handleGenerate()}>
                {createBackup.isPending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <CloudUpload className="size-4" aria-hidden="true" />
                )}
                <span>{createBackup.isPending ? "Generando…" : "Generar respaldo"}</span>
              </Button>
            </div>
          ) : undefined
        }
      />

      {!canExport ? (
        <Alert className="border-status-warning-border bg-status-warning-bg text-status-warning-fg">
          <AlertCircle className="size-4" aria-hidden="true" />
          <AlertTitle>Permiso requerido</AlertTitle>
          <AlertDescription className="text-status-warning-fg">
            Se requiere el permiso REPORTE_EXPORTAR para consultar, descargar o solicitar restauración de respaldos.
          </AlertDescription>
        </Alert>
      ) : (
        <>
          {actionError && (
            <Alert
              role="alert"
              className="border-status-danger-border bg-status-danger-bg text-status-danger-fg"
            >
              <AlertCircle className="size-4" aria-hidden="true" />
              <AlertTitle>Error en la operación</AlertTitle>
              <AlertDescription className="text-status-danger-fg">{actionError}</AlertDescription>
            </Alert>
          )}

          <div className="grid gap-4 md:grid-cols-3">
            <Card className="border border-border bg-card shadow-[var(--shadow-xs)]">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                  <Database className="size-4 text-primary" aria-hidden="true" />
                  Respaldos registrados
                </CardTitle>
                <CardDescription className="text-xs">
                  Archivos almacenados en el servidor
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold tabular-nums text-foreground">
                  {listQuery.isSuccess ? backups.length : "—"}
                </p>
              </CardContent>
            </Card>
            <Card className="border border-border bg-card shadow-[var(--shadow-xs)] md:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Restauración auditada</CardTitle>
                <CardDescription className="text-xs">
                  Cada descarga y solicitud de restauración queda registrada en la bitácora de auditoría del backend.
                </CardDescription>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                Si el servidor no responde, no se muestran datos simulados: utilice «Reintentar» cuando el servicio esté disponible.
              </CardContent>
            </Card>
          </div>

          <DataTable
            columns={columns}
            rows={backups}
            getRowId={(row) => row.fileName}
            loading={listQuery.isPending}
            error={
              listQuery.isError
                ? errorMessage(listQuery.error, "No se pudo consultar el inventario de respaldos.")
                : null
            }
            onRetry={() => void listQuery.refetch()}
            emptyState={
              <EmptyState
                icon={<Database className="size-6 text-muted-foreground" aria-hidden="true" />}
                title="Sin respaldos registrados"
                description="Todavía no se ha generado ningún archivo de respaldo en el almacenamiento del servidor."
                action={
                  <Button type="button" disabled={isBusy} onClick={() => void handleGenerate()}>
                    <CloudUpload className="size-4" aria-hidden="true" />
                    Generar primer respaldo
                  </Button>
                }
              />
            }
            toolbar={
              <div className="flex w-full items-center justify-between gap-2">
                <span className="text-sm font-medium text-foreground">Inventario de respaldos</span>
                <span className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
                  {listQuery.isSuccess
                    ? `${backups.length} ${backups.length === 1 ? "archivo" : "archivos"}`
                    : ""}
                </span>
              </div>
            }
          />
        </>
      )}
    </div>
  );
}
