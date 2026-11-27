import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Plus, Search, UserMinus, Users } from "lucide-react";
import { toast } from "sonner";
import type { Participant, ParticipantInput } from "../../../api/schemas/academic";
import { Button } from "../../../app/components/ui/button";
import { useConfirm } from "../../../app/components/ui/confirm-dialog";
import { DataTable, type DataTableColumn } from "../../../app/components/ui/data-table";
import { EmptyState } from "../../../app/components/ui/empty-state";
import { Input } from "../../../app/components/ui/input";
import { PageHeader } from "../../../app/components/ui/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../app/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../app/components/ui/tooltip";
import { useStaffAuth } from "../../../store/staffAuth";
import { GeneralStatusBadge } from "../../catalogs/components/general-status-badge";
import { errorMessage, isForbidden } from "../../catalogs/error-message";
import { useCatalog, type UseCatalogResult } from "../../catalogs/use-catalog";
import type { CatalogType } from "../../../api/schemas/academic";
import { useCreateParticipant, useDeactivateParticipant } from "../mutations";
import { PARTICIPANT_PERMISSIONS } from "../permissions";
import { PARTICIPANT_PAGE_SIZE, participantListQuery } from "../queries";
import { participantCatalogIds } from "../refs";
import { ParticipantFormDialog } from "./participant-form-dialog";

const ALL = "all";

interface Filters {
  sex: string;
  career: string;
  cohort: string;
  group: string;
}

const NO_FILTERS: Filters = { sex: ALL, career: ALL, cohort: ALL, group: ALL };

interface CatalogFilterProps<T extends CatalogType> {
  label: string;
  allLabel: string;
  value: string;
  onChange: (value: string) => void;
  source: UseCatalogResult<T>;
}

/** Filtro por catálogo. Si el catálogo no está disponible se deshabilita con un tooltip. */
function CatalogFilter<T extends CatalogType>({ label, allLabel, value, onChange, source }: CatalogFilterProps<T>) {
  const disabled = source.isLoading || source.unavailableReason !== null;
  const select = (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger aria-label={label} className="w-44">
        <SelectValue placeholder={allLabel} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {source.items
          .filter((item) => item.status === "ACTIVO")
          .map((item) => (
            <SelectItem key={item.id} value={String(item.id)}>
              {item.name}
            </SelectItem>
          ))}
      </SelectContent>
    </Select>
  );

  if (!source.unavailableReason) return select;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* Un botón deshabilitado no recibe foco ni hover: el tooltip va sobre el contenedor. */}
        <span tabIndex={0} className="inline-flex rounded-md focus-visible:ring-[3px] focus-visible:ring-ring/50">
          {select}
        </span>
      </TooltipTrigger>
      <TooltipContent>{source.unavailableReason}</TooltipContent>
    </Tooltip>
  );
}

const dash = <span className="text-muted-foreground">—</span>;

/** Nombre de un ítem de catálogo por id (la lista de participantes trae solo ids planos). */
function catalogName(items: readonly { id?: number; name: string }[], id: number | undefined): string | undefined {
  if (id === undefined) return undefined;
  return items.find((item) => item.id === id)?.name;
}

export function ParticipantsPage() {
  const confirm = useConfirm();
  const canCreate = useStaffAuth((s) => s.hasPermission(PARTICIPANT_PERMISSIONS.CREATE));
  const canDeactivate = useStaffAuth((s) => s.hasPermission(PARTICIPANT_PERMISSIONS.DELETE));

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [dialogOpen, setDialogOpen] = useState(false);

  // La lista NO espera a los catálogos: cada consulta es independiente.
  const listQuery = useQuery(participantListQuery({ page: page - 1, size: PARTICIPANT_PAGE_SIZE }));
  const sexes = useCatalog("sexos");
  const careers = useCatalog("carreras");
  const cohorts = useCatalog("cohortes");
  const groups = useCatalog("grupos-academicos");

  const createParticipant = useCreateParticipant();
  const deactivateParticipant = useDeactivateParticipant();

  const hasActiveFilters = search.trim() !== "" || Object.values(filters).some((value) => value !== ALL);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (listQuery.data?.content ?? []).filter((participant) => {
      if (term && !`${participant.code} ${participant.fullName}`.toLowerCase().includes(term)) return false;
      const ids = participantCatalogIds(participant);
      if (filters.sex !== ALL && String(ids.sex) !== filters.sex) return false;
      if (filters.career !== ALL && String(ids.career) !== filters.career) return false;
      if (filters.cohort !== ALL && String(ids.cohort) !== filters.cohort) return false;
      if (filters.group !== ALL && String(ids.group) !== filters.group) return false;
      return true;
    });
  }, [listQuery.data, search, filters]);

  const clearFilters = () => {
    setSearch("");
    setFilters(NO_FILTERS);
  };

  const handleCreate = async (input: ParticipantInput) => {
    try {
      const created = await createParticipant.mutateAsync(input);
      toast.success(`Participante ${created.fullName} registrado.`);
    } catch (error) {
      if (!isForbidden(error)) toast.error(errorMessage(error, "No se pudo registrar el participante."));
      throw error;
    }
  };

  const handleDeactivate = async (participant: Participant) => {
    const confirmed = await confirm({
      tone: "danger",
      title: "¿Desactivar participante?",
      description: `${participant.fullName} (${participant.code}) pasará a estado Inactivo. Esta acción no se puede deshacer desde esta pantalla.`,
      confirmLabel: "Desactivar",
    });
    if (!confirmed) return;
    try {
      await deactivateParticipant.mutateAsync(participant.id);
      toast.success(`Participante ${participant.fullName} desactivado.`);
    } catch (error) {
      if (!isForbidden(error)) toast.error(errorMessage(error, "No se pudo desactivar al participante."));
    }
  };

  const columns: DataTableColumn<Participant>[] = [
    { id: "code", header: "Código", cell: (row) => row.code },
    { id: "name", header: "Nombre", cell: (row) => row.fullName },
    {
      id: "age",
      header: "Edad",
      className: "text-right tabular-nums",
      headerClassName: "text-right",
      cell: (row) => row.age ?? dash,
    },
    { id: "sex", header: "Sexo", cell: (row) => row.sex?.name ?? catalogName(sexes.items, row.sexId) ?? dash },
    { id: "career", header: "Carrera", cell: (row) => row.career?.name ?? catalogName(careers.items, row.careerId) ?? dash },
    { id: "cohort", header: "Cohorte", cell: (row) => row.cohort?.name ?? catalogName(cohorts.items, row.cohortId) ?? dash },
    { id: "group", header: "Grupo", cell: (row) => row.group?.name ?? catalogName(groups.items, row.groupId) ?? dash },
    { id: "status", header: "Estado", cell: (row) => <GeneralStatusBadge status={row.status} /> },
  ];
  if (canDeactivate) {
    columns.push({
      id: "actions",
      header: <span className="sr-only">Acciones</span>,
      className: "w-12 text-right",
      cell: (row) =>
        row.status === "ACTIVO" ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Desactivar participante ${row.code}`}
            onClick={() => void handleDeactivate(row)}
          >
            <UserMinus className="size-4" aria-hidden="true" />
          </Button>
        ) : null,
    });
  }

  const total = listQuery.data?.totalElements ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Participantes"
        subtitle="Registro de participantes que pueden ser asignados a sesiones de evaluación."
        actions={
          canCreate ? (
            <Button type="button" onClick={() => setDialogOpen(true)}>
              <Plus className="size-4" aria-hidden="true" />
              Registrar participante
            </Button>
          ) : undefined
        }
      />

      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        loading={listQuery.isPending}
        error={listQuery.isError ? errorMessage(listQuery.error, "No se pudo cargar la lista de participantes.") : null}
        onRetry={() => void listQuery.refetch()}
        getRowHref={(row) => `/app/participantes/${row.id}`}
        renderRowLink={({ row, className, children }) => (
          <Link to="/app/participantes/$id" params={{ id: row.id }} className={className}>
            {children}
          </Link>
        )}
        primaryColumnId="code"
        pagination={{ page, pageSize: PARTICIPANT_PAGE_SIZE, total, onPageChange: setPage }}
        emptyState={
          hasActiveFilters ? (
            <EmptyState
              icon={<Search className="size-6 text-muted-foreground" aria-hidden="true" />}
              title="Sin resultados para este filtro"
              description="Ningún participante de esta página coincide con la búsqueda o los filtros."
              action={
                <Button type="button" variant="outline" size="sm" onClick={clearFilters}>
                  Limpiar filtros
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={<Users className="size-6 text-muted-foreground" aria-hidden="true" />}
              title="Sin participantes aún"
              description="Todavía no hay participantes registrados."
              action={
                canCreate ? (
                  <Button type="button" size="sm" onClick={() => setDialogOpen(true)}>
                    Registrar participante
                  </Button>
                ) : undefined
              }
            />
          )
        }
        toolbar={
          <>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  type="search"
                  aria-label="Buscar participantes"
                  placeholder="Buscar en esta página…"
                  className="w-64 pl-8"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
              <CatalogFilter
                label="Filtrar por sexo"
                allLabel="Todos los sexos"
                value={filters.sex}
                onChange={(sex) => setFilters((f) => ({ ...f, sex }))}
                source={sexes}
              />
              <CatalogFilter
                label="Filtrar por carrera"
                allLabel="Todas las carreras"
                value={filters.career}
                onChange={(career) => setFilters((f) => ({ ...f, career }))}
                source={careers}
              />
              <CatalogFilter
                label="Filtrar por cohorte"
                allLabel="Todas las cohortes"
                value={filters.cohort}
                onChange={(cohort) => setFilters((f) => ({ ...f, cohort }))}
                source={cohorts}
              />
              <CatalogFilter
                label="Filtrar por grupo"
                allLabel="Todos los grupos"
                value={filters.group}
                onChange={(group) => setFilters((f) => ({ ...f, group }))}
                source={groups}
              />
              {hasActiveFilters && (
                <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
                  Limpiar filtros
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground tabular-nums">
              {hasActiveFilters
                ? `${rows.length} de ${listQuery.data?.numberOfElements ?? 0} en esta página`
                : `${total} ${total === 1 ? "registro" : "registros"}`}
            </p>
          </>
        }
      />

      {(canCreate || dialogOpen) && (
        <ParticipantFormDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          catalogs={{ sexes, careers, cohorts, groups }}
          onSubmit={handleCreate}
        />
      )}
    </div>
  );
}
