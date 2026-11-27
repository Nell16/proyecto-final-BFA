import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check, Minus, Plus, Search, Shield, UserCheck, UserMinus, Users } from "lucide-react";
import { toast } from "sonner";
import type { CreateUserFormValues, UserPermissionRow } from "../../../api/schemas/admin";
import { Alert, AlertDescription, AlertTitle } from "../../../app/components/ui/alert";
import { Avatar, AvatarFallback } from "../../../app/components/ui/avatar";
import { Badge } from "../../../app/components/ui/badge";
import { Button } from "../../../app/components/ui/button";
import { Card } from "../../../app/components/ui/card";
import { useConfirm } from "../../../app/components/ui/confirm-dialog";
import { DataTable, type DataTableColumn } from "../../../app/components/ui/data-table";
import { EmptyState } from "../../../app/components/ui/empty-state";
import { Input } from "../../../app/components/ui/input";
import { PageHeader } from "../../../app/components/ui/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../app/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../app/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../app/components/ui/tooltip";
import { captureAccountScope, isAccountChangedError } from "../../../store/accountScope";
import { useStaffAuth } from "../../../store/staffAuth";
import { GeneralStatusBadge } from "../../catalogs/components/general-status-badge";
import { errorMessage, isForbidden } from "../error-message";
import {
  createSecretHandle,
  useAssignUserRole,
  useCreateUser,
  useRemoveUserRole,
  useSetUserStatus,
} from "../mutations";
import { ADMIN_PERMISSIONS } from "../permissions";
import { permissionMatrixQuery, rolesListQuery } from "../queries";
import { UserFormDialog } from "./user-form-dialog";
import { UserRolesDialog } from "./user-roles-dialog";

const ALL = "all";
const PAGE_SIZE = 20;

function initialsFor(fullName: string, username: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
  }
  return (fullName.trim().slice(0, 2) || username.slice(0, 2) || "US").toUpperCase();
}

export function UsersPage() {
  const confirm = useConfirm();
  const currentUser = useStaffAuth((s) => s.user);
  const canCreate = useStaffAuth((s) => s.hasPermission(ADMIN_PERMISSIONS.USER_CREATE));
  const canUpdate = useStaffAuth((s) => s.hasPermission(ADMIN_PERMISSIONS.USER_UPDATE));
  const canReadRoles = useStaffAuth((s) => s.hasPermission(ADMIN_PERMISSIONS.ROLE_READ));

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>(ALL);
  const [roleFilter, setRoleFilter] = useState<string>(ALL);
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [rolesDialogUserId, setRolesDialogUserId] = useState<string | null>(null);
  const [selfDeactivateWarning, setSelfDeactivateWarning] = useState<string | null>(null);

  const matrixQuery = useQuery(permissionMatrixQuery());
  const rolesQuery = useQuery({
    ...rolesListQuery(),
    enabled: canReadRoles,
  });

  const createUserMutation = useCreateUser();
  const setUserStatusMutation = useSetUserStatus();
  const assignRoleMutation = useAssignUserRole();
  const removeRoleMutation = useRemoveUserRole();

  const users = useMemo(() => matrixQuery.data?.users ?? [], [matrixQuery.data]);
  const permissionColumns = useMemo(() => matrixQuery.data?.permissionColumns ?? [], [matrixQuery.data]);
  const roles = useMemo(() => rolesQuery.data ?? [], [rolesQuery.data]);

  const roleOptions = useMemo(() => {
    const names = new Set<string>();
    for (const r of roles) names.add(r.name);
    for (const u of users) {
      for (const r of u.roles) names.add(r);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b, "es"));
  }, [roles, users]);

  const filteredUsers = useMemo(() => {
    const term = search.trim().toLowerCase();
    return users.filter((u) => {
      if (term) {
        const haystack = `${u.fullName} ${u.username} ${u.email}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      if (statusFilter !== ALL && u.status !== statusFilter) return false;
      if (roleFilter !== ALL && !u.roles.includes(roleFilter)) return false;
      return true;
    });
  }, [users, search, statusFilter, roleFilter]);

  const hasActiveFilters = search.trim() !== "" || statusFilter !== ALL || roleFilter !== ALL;

  const totalFiltered = filteredUsers.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedUsers = useMemo(
    () => filteredUsers.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filteredUsers, safePage],
  );

  const selectedRolesUser = useMemo(
    () => (rolesDialogUserId ? users.find((u) => u.userId === rolesDialogUserId) ?? null : null),
    [users, rolesDialogUserId],
  );

  const isSelfUser = (user: UserPermissionRow): boolean =>
    currentUser !== null && currentUser.id === user.userId;

  const clearFilters = () => {
    setSearch("");
    setStatusFilter(ALL);
    setRoleFilter(ALL);
    setPage(1);
  };

  /**
   * Alta en dos pasos (crear + rol inicial) bajo UN solo `AccountScope`, capturado al iniciar. Si la cuenta
   * de staff cambia en mitad del flujo, el segundo paso NO se envía (saldría con el JWT de la cuenta nueva) y
   * no se publica ningún resultado (toast ni caché) de la cuenta saliente; el flujo termina en silencio.
   */
  const handleCreateUser = async (values: CreateUserFormValues) => {
    const scope = captureAccountScope();
    let created;
    try {
      created = await createUserMutation.mutateAsync({
        username: values.username.trim(),
        email: values.email.trim(),
        fullName: values.fullName.trim(),
        secret: createSecretHandle(values.password),
      });
    } catch (error) {
      if (isAccountChangedError(error) || !scope.isCurrent()) return;
      if (!isForbidden(error)) {
        toast.error(errorMessage(error, "No se pudo registrar el usuario."));
      }
      throw error;
    }

    if (!scope.isCurrent()) return;

    if (values.roleId !== undefined) {
      try {
        scope.assertCurrent();
        await assignRoleMutation.mutateAsync({ userId: created.id, roleId: values.roleId });
      } catch (error) {
        if (isAccountChangedError(error) || !scope.isCurrent()) return;
        if (!isForbidden(error)) {
          toast.warning(
            `Usuario ${created.username} creado, pero no se pudo asignar el rol inicial: ${errorMessage(error, "error inesperado")}`,
          );
        }
        return;
      }
    }

    if (!scope.isCurrent()) return;
    toast.success(`Usuario ${created.fullName} (@${created.username}) registrado.`);
  };

  const handleToggleStatus = async (user: UserPermissionRow) => {
    if (user.status === "ACTIVO" && isSelfUser(user)) {
      const message = "No puedes desactivar tu propia cuenta mientras tengas sesión iniciada.";
      setSelfDeactivateWarning(message);
      toast.warning(message);
      return;
    }

    setSelfDeactivateWarning(null);
    const nextStatus = user.status === "ACTIVO" ? "INACTIVO" : "ACTIVO";
    const isDeactivating = nextStatus === "INACTIVO";

    const confirmed = await confirm(
      isDeactivating
        ? {
            tone: "danger",
            title: "¿Desactivar usuario?",
            description: `${user.fullName} (@${user.username}) perderá el acceso al sistema hasta que sea reactivado.`,
            confirmLabel: "Desactivar",
          }
        : {
            tone: "default",
            title: "¿Activar usuario?",
            description: `${user.fullName} (@${user.username}) recuperará el acceso al sistema con sus roles actuales.`,
            confirmLabel: "Activar",
          },
    );

    if (!confirmed) return;

    try {
      await setUserStatusMutation.mutateAsync({ userId: user.userId, status: nextStatus });
      toast.success(
        isDeactivating
          ? `Usuario ${user.fullName} desactivado.`
          : `Usuario ${user.fullName} activado.`,
      );
    } catch (error) {
      if (!isForbidden(error)) {
        toast.error(errorMessage(error, "No se pudo actualizar el estado del usuario."));
      }
    }
  };

  const handleAssignRole = async (userId: string, roleId: number) => {
    try {
      await assignRoleMutation.mutateAsync({ userId, roleId });
      toast.success("Rol asignado correctamente.");
    } catch (error) {
      if (!isForbidden(error)) {
        toast.error(errorMessage(error, "No se pudo asignar el rol."));
      }
    }
  };

  const handleRemoveRole = async (userId: string, roleId: number) => {
    try {
      await removeRoleMutation.mutateAsync({ userId, roleId });
      toast.success("Rol retirado correctamente.");
    } catch (error) {
      if (!isForbidden(error)) {
        toast.error(errorMessage(error, "No se pudo retirar el rol."));
      }
    }
  };

  const columns: DataTableColumn<UserPermissionRow>[] = [
    {
      id: "user",
      header: "Usuario",
      cell: (row) => (
        <div className="flex items-center gap-2.5">
          <Avatar className="size-8">
            <AvatarFallback className="bg-accent text-xs font-semibold text-accent-foreground">
              {initialsFor(row.fullName, row.username)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-medium text-foreground">{row.fullName}</span>
              {isSelfUser(row) && (
                <Badge
                  variant="outline"
                  className="border-status-info-border bg-status-info-bg text-status-info-fg text-xs"
                >
                  Tú
                </Badge>
              )}
            </div>
            <div className="font-mono text-xs text-muted-foreground">@{row.username}</div>
          </div>
        </div>
      ),
    },
    {
      id: "email",
      header: "Correo",
      cell: (row) => <span className="text-sm text-muted-foreground">{row.email}</span>,
    },
    {
      id: "roles",
      header: "Roles",
      cell: (row) =>
        row.roles.length === 0 ? (
          <span className="text-xs text-muted-foreground">Sin roles</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {row.roles.map((role) => (
              <Badge key={role} variant="secondary" className="text-xs">
                {role}
              </Badge>
            ))}
          </div>
        ),
    },
    {
      id: "status",
      header: "Estado",
      cell: (row) => <GeneralStatusBadge status={row.status} />,
    },
  ];

  if (canUpdate) {
    columns.push({
      id: "actions",
      header: <span className="sr-only">Acciones</span>,
      className: "text-right whitespace-nowrap",
      headerClassName: "text-right",
      cell: (row) => {
        const isActive = row.status === "ACTIVO";
        const manageRolesButton = (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!canReadRoles || rolesQuery.isError}
            aria-label={`Gestionar roles de ${row.username}`}
            onClick={() => {
              setSelfDeactivateWarning(null);
              setRolesDialogUserId(row.userId);
            }}
          >
            <Shield className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">Roles</span>
          </Button>
        );

        return (
          <div className="inline-flex items-center justify-end gap-1">
            {!canReadRoles ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0} className="inline-flex">
                    {manageRolesButton}
                  </span>
                </TooltipTrigger>
                <TooltipContent>Requiere el permiso ROL_LEER para listar los roles disponibles.</TooltipContent>
              </Tooltip>
            ) : (
              manageRolesButton
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`${isActive ? "Desactivar" : "Activar"} usuario ${row.username}`}
              onClick={() => void handleToggleStatus(row)}
            >
              {isActive ? (
                <>
                  <UserMinus className="size-4" aria-hidden="true" />
                  <span className="hidden sm:inline">Desactivar</span>
                </>
              ) : (
                <>
                  <UserCheck className="size-4" aria-hidden="true" />
                  <span className="hidden sm:inline">Activar</span>
                </>
              )}
            </Button>
          </div>
        );
      },
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Usuarios"
        subtitle="Administración de cuentas del personal, estados de acceso y asignación de roles."
        actions={
          canCreate ? (
            <Button type="button" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" aria-hidden="true" />
              Nuevo usuario
            </Button>
          ) : undefined
        }
      />

      {selfDeactivateWarning && (
        <Alert
          role="alert"
          className="border-status-warning-border bg-status-warning-bg text-status-warning-fg"
        >
          <AlertTriangle className="size-4" aria-hidden="true" />
          <AlertTitle>Acción protegida</AlertTitle>
          <AlertDescription className="text-status-warning-fg">{selfDeactivateWarning}</AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="users" className="space-y-4">
        <TabsList>
          <TabsTrigger value="users">Usuarios</TabsTrigger>
          <TabsTrigger value="matrix">Matriz efectiva por usuario</TabsTrigger>
        </TabsList>

        <TabsContent value="users">
          <DataTable
            columns={columns}
            rows={pagedUsers}
            getRowId={(row) => row.userId}
            loading={matrixQuery.isPending}
            error={
              matrixQuery.isError
                ? errorMessage(matrixQuery.error, "No se pudo cargar la lista de usuarios.")
                : null
            }
            onRetry={() => void matrixQuery.refetch()}
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
                  title="Sin resultados para este filtro"
                  description="Ningún usuario coincide con los criterios de búsqueda o filtro."
                  action={
                    <Button type="button" variant="outline" size="sm" onClick={clearFilters}>
                      Limpiar filtros
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  icon={<Users className="size-6 text-muted-foreground" aria-hidden="true" />}
                  title="Sin usuarios registrados"
                  description="Todavía no hay cuentas de personal registradas en el sistema."
                  action={
                    canCreate ? (
                      <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
                        Nuevo usuario
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
                      aria-label="Buscar usuarios"
                      placeholder="Buscar por nombre, usuario o correo…"
                      className="w-64 pl-8"
                      value={search}
                      onChange={(event) => {
                        setSearch(event.target.value);
                        setPage(1);
                      }}
                    />
                  </div>

                  <Select
                    value={statusFilter}
                    onValueChange={(value) => {
                      setStatusFilter(value);
                      setPage(1);
                    }}
                  >
                    <SelectTrigger aria-label="Filtrar por estado" className="w-40">
                      <SelectValue placeholder="Todos los estados" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>Todos los estados</SelectItem>
                      <SelectItem value="ACTIVO">Activos</SelectItem>
                      <SelectItem value="INACTIVO">Inactivos</SelectItem>
                    </SelectContent>
                  </Select>

                  <Select
                    value={roleFilter}
                    onValueChange={(value) => {
                      setRoleFilter(value);
                      setPage(1);
                    }}
                  >
                    <SelectTrigger aria-label="Filtrar por rol" className="w-44">
                      <SelectValue placeholder="Todos los roles" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>Todos los roles</SelectItem>
                      {roleOptions.map((role) => (
                        <SelectItem key={role} value={role}>
                          {role}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {hasActiveFilters && (
                    <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
                      Limpiar filtros
                    </Button>
                  )}
                </div>

                <p className="text-xs text-muted-foreground tabular-nums">
                  {hasActiveFilters
                    ? `${totalFiltered} de ${users.length} ${users.length === 1 ? "usuario" : "usuarios"}`
                    : `${users.length} ${users.length === 1 ? "registro" : "registros"}`}
                </p>
              </>
            }
          />
        </TabsContent>

        <TabsContent value="matrix">
          <Card className="overflow-hidden border border-border bg-card shadow-[var(--shadow-xs)]">
            {matrixQuery.isPending ? (
              <div className="p-6 text-sm text-muted-foreground">Cargando matriz de permisos…</div>
            ) : matrixQuery.isError ? (
              <div className="p-6 text-sm text-status-danger-fg">
                {errorMessage(matrixQuery.error, "No se pudo cargar la matriz de permisos.")}
              </div>
            ) : permissionColumns.length === 0 || filteredUsers.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  title="Sin datos en la matriz"
                  description="No hay permisos o usuarios que coincidan con el filtro actual."
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead className="border-b border-border bg-muted/70 text-xs font-semibold text-muted-foreground">
                    <tr>
                      <th className="sticky left-0 z-10 bg-muted/95 px-4 py-2.5 text-left">Usuario</th>
                      {permissionColumns.map((perm) => (
                        <th key={perm} className="px-3 py-2.5 text-center font-mono text-xs whitespace-nowrap">
                          {perm}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredUsers.map((user) => (
                      <tr key={user.userId} className="hover:bg-muted/40">
                        <td className="sticky left-0 z-10 bg-card px-4 py-2.5 font-medium whitespace-nowrap">
                          <div>{user.fullName}</div>
                          <div className="font-mono text-xs text-muted-foreground">@{user.username}</div>
                        </td>
                        {permissionColumns.map((perm) => {
                          const granted = user.matrix[perm] === true;
                          return (
                            <td key={perm} className="px-3 py-2.5 text-center">
                              {granted ? (
                                <span
                                  className="inline-flex size-6 items-center justify-center rounded-full bg-status-success-bg text-status-success-fg"
                                  aria-label={`${perm}: concedido`}
                                >
                                  <Check className="size-3.5" aria-hidden="true" />
                                </span>
                              ) : (
                                <span
                                  className="inline-flex size-6 items-center justify-center text-muted-foreground"
                                  aria-label={`${perm}: no concedido`}
                                >
                                  <Minus className="size-3.5" aria-hidden="true" />
                                </span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </TabsContent>
      </Tabs>

      {(canCreate || createOpen) && (
        <UserFormDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          roles={roles}
          canAssignRole={canUpdate && canReadRoles}
          rolesUnavailable={rolesQuery.isError}
          onSubmit={handleCreateUser}
        />
      )}

      <UserRolesDialog
        open={selectedRolesUser !== null}
        onOpenChange={(open) => {
          if (!open) setRolesDialogUserId(null);
        }}
        user={selectedRolesUser}
        roles={roles}
        isSelf={selectedRolesUser !== null && isSelfUser(selectedRolesUser)}
        onAssignRole={handleAssignRole}
        onRemoveRole={handleRemoveRole}
      />
    </div>
  );
}
