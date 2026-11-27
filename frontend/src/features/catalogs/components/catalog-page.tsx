import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { CatalogType } from "../../../api/schemas/academic";
import { Button } from "../../../app/components/ui/button";
import { useConfirm } from "../../../app/components/ui/confirm-dialog";
import { DataTable, type DataTableColumn } from "../../../app/components/ui/data-table";
import { EmptyState } from "../../../app/components/ui/empty-state";
import { Input } from "../../../app/components/ui/input";
import { PageHeader } from "../../../app/components/ui/page-header";
import { useStaffAuth } from "../../../store/staffAuth";
import type { CatalogDefinition, CatalogFormValues } from "../definitions";
import { errorMessage, isForbidden } from "../error-message";
import { useCreateCatalogItem, useDeleteCatalogItem } from "../mutations";
import { CATALOG_PERMISSIONS } from "../permissions";
import { catalogListQuery, type CatalogItemByType } from "../queries";
import { useCatalog } from "../use-catalog";
import { CatalogFormDialog } from "./catalog-form-dialog";
import { GeneralStatusBadge } from "./general-status-badge";

/** Pantalla genérica de catálogo: lista, alta (RHF + zod) e inactivación con confirmación. */
export function CatalogPage<T extends CatalogType>({ definition }: { definition: CatalogDefinition<T> }) {
  const { type } = definition;
  const confirm = useConfirm();
  const canCreate = useStaffAuth((s) => s.hasPermission(CATALOG_PERMISSIONS[type].create));
  const canDelete = useStaffAuth((s) => s.hasPermission(CATALOG_PERMISSIONS[type].delete));

  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);

  const listQuery = useQuery(catalogListQuery(type));
  const careers = useCatalog("carreras", { enabled: definition.needsCareers === true });
  const createItem = useCreateCatalogItem(type);
  const deleteItem = useDeleteCatalogItem(type);

  const careersById = useMemo(() => new Map(careers.items.map((career) => [career.id, career])), [careers.items]);

  const rows = useMemo<readonly CatalogItemByType[T][]>(() => {
    const items = listQuery.data ?? [];
    const term = search.trim().toLowerCase();
    if (!term) return items;
    return items.filter((item) => `${item.code} ${item.name}`.toLowerCase().includes(term));
  }, [listQuery.data, search]);

  const handleDelete = async (item: CatalogItemByType[T]) => {
    const confirmed = await confirm({
      tone: "danger",
      title: `¿Inactivar ${definition.singular}?`,
      description: `«${item.name}» (${item.code}) dejará de aparecer en el catálogo y no podrá asignarse a nuevos registros.`,
      confirmLabel: "Inactivar",
    });
    if (!confirmed) return;
    try {
      await deleteItem.mutateAsync(item.id);
      toast.success(`Se inactivó ${definition.singular} «${item.name}».`);
    } catch (error) {
      if (!isForbidden(error)) toast.error(errorMessage(error, `No se pudo inactivar ${definition.singular}.`));
    }
  };

  const handleCreate = async (values: CatalogFormValues) => {
    try {
      await createItem.mutateAsync(values);
      toast.success(`Se registró ${definition.singular} correctamente.`);
    } catch (error) {
      if (!isForbidden(error)) toast.error(errorMessage(error, `No se pudo registrar ${definition.singular}.`));
      throw error;
    }
  };

  const columns: DataTableColumn<CatalogItemByType[T]>[] = [
    { id: "code", header: "Código", cell: (row) => <span className="font-medium">{row.code}</span> },
    { id: "name", header: "Nombre", cell: (row) => row.name },
    ...definition.columns({ careersById, careersUnavailable: careers.unavailableReason !== null }),
    { id: "status", header: "Estado", cell: (row) => <GeneralStatusBadge status={row.status} /> },
  ];
  if (canDelete) {
    columns.push({
      id: "actions",
      header: <span className="sr-only">Acciones</span>,
      className: "w-12 text-right",
      cell: (row) =>
        row.status === "INACTIVO" ? null : (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Inactivar ${definition.singular} ${row.code}`}
            onClick={() => void handleDelete(row)}
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </Button>
        ),
    });
  }

  const Icon = definition.icon;

  return (
    <div className="space-y-6">
      <PageHeader
        title={definition.title}
        subtitle={definition.description}
        actions={
          canCreate ? (
            <Button type="button" onClick={() => setDialogOpen(true)}>
              <Plus className="size-4" aria-hidden="true" />
              {definition.newLabel}
            </Button>
          ) : undefined
        }
      />

      <DataTable
        columns={columns}
        rows={[...rows]}
        getRowId={(row) => String(row.id)}
        loading={listQuery.isPending}
        error={listQuery.isError ? errorMessage(listQuery.error, `No se pudo cargar ${definition.title.toLowerCase()}.`) : null}
        onRetry={() => void listQuery.refetch()}
        emptyState={
          <EmptyState
            icon={<Icon className="size-6 text-muted-foreground" aria-hidden="true" />}
            title={search.trim() ? "Sin resultados para la búsqueda" : "Sin registros aún"}
            description={
              search.trim()
                ? "Pruebe con otro código o nombre."
                : `Todavía no hay ${definition.title.toLowerCase()} activos en el catálogo.`
            }
            action={
              search.trim() ? (
                <Button type="button" variant="outline" size="sm" onClick={() => setSearch("")}>
                  Limpiar búsqueda
                </Button>
              ) : canCreate ? (
                <Button type="button" size="sm" onClick={() => setDialogOpen(true)}>
                  {definition.newLabel}
                </Button>
              ) : undefined
            }
          />
        }
        toolbar={
          <>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                type="search"
                aria-label={`Buscar ${definition.title.toLowerCase()}`}
                placeholder="Buscar por código o nombre…"
                className="w-64 pl-8"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <p className="text-xs text-muted-foreground tabular-nums">
              {rows.length} {rows.length === 1 ? "registro" : "registros"}
            </p>
          </>
        }
      />

      {(canCreate || dialogOpen) && (
        <CatalogFormDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          definition={definition}
          careers={definition.needsCareers ? careers : undefined}
          onSubmit={handleCreate}
        />
      )}
    </div>
  );
}
