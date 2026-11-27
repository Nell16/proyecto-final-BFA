import { useEffect, useMemo, useRef, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useBlocker } from "@tanstack/react-router";
import { AlertCircle, Info, Loader2, RotateCcw, Save, Search, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "../../../app/components/ui/alert";
import { Badge } from "../../../app/components/ui/badge";
import { Button } from "../../../app/components/ui/button";
import { Card } from "../../../app/components/ui/card";
import { Checkbox } from "../../../app/components/ui/checkbox";
import { ConfirmDialog, useConfirm } from "../../../app/components/ui/confirm-dialog";
import { EmptyState } from "../../../app/components/ui/empty-state";
import { Input } from "../../../app/components/ui/input";
import { PageHeader } from "../../../app/components/ui/page-header";
import { Skeleton } from "../../../app/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../app/components/ui/table";
import { captureAccountScope } from "../../../store/accountScope";
import { useStaffAuth } from "../../../store/staffAuth";
import { errorMessage, isForbidden } from "../error-message";
import { useUpdateRolePermissions } from "../mutations";
import { ADMIN_PERMISSIONS } from "../permissions";
import { permissionsListQuery, rolePermissionsQuery, rolesListQuery } from "../queries";

function sameIdSet(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  if (setA.size !== b.length) return false;
  return b.every((id) => setA.has(id));
}

export function RolesPage() {
  const confirm = useConfirm();
  const canUpdate = useStaffAuth((s) => s.hasPermission(ADMIN_PERMISSIONS.ROLE_UPDATE));

  const [search, setSearch] = useState("");
  const [draftByRole, setDraftByRole] = useState<Record<number, number[]>>({});
  const [saving, setSaving] = useState(false);

  const mountedScope = useRef(captureAccountScope());
  const proceedingRef = useRef(false);

  const rolesQuery = useQuery(rolesListQuery());
  const permissionsQuery = useQuery(permissionsListQuery());
  const roles = useMemo(() => rolesQuery.data ?? [], [rolesQuery.data]);
  const permissions = useMemo(() => permissionsQuery.data ?? [], [permissionsQuery.data]);

  const rolePermQueries = useQueries({
    queries: roles.map((role) => ({
      ...rolePermissionsQuery(role.id),
      enabled: roles.length > 0,
    })),
  });

  const updateRolePermissionsMutation = useUpdateRolePermissions();

  const serverIdsByRole = useMemo(() => {
    const map: Record<number, number[]> = {};
    roles.forEach((role, index) => {
      const perms = rolePermQueries[index]?.data;
      if (perms) {
        map[role.id] = perms.map((p) => p.id);
      }
    });
    return map;
  }, [roles, rolePermQueries]);

  const dirtyRoleIds = useMemo(() => {
    const dirty: number[] = [];
    for (const role of roles) {
      const draft = draftByRole[role.id];
      const server = serverIdsByRole[role.id];
      if (draft !== undefined && server !== undefined && !sameIdSet(draft, server)) {
        dirty.push(role.id);
      }
    }
    return dirty;
  }, [roles, draftByRole, serverIdsByRole]);

  const hasUnsavedChanges = dirtyRoleIds.length > 0;

  const blocker = useBlocker({
    shouldBlockFn: ({ current, next }) =>
      mountedScope.current.isCurrent() && hasUnsavedChanges && current.pathname !== next.pathname,
    enableBeforeUnload: () => mountedScope.current.isCurrent() && hasUnsavedChanges,
    withResolver: true,
  });

  useEffect(() => {
    if (blocker.status === "idle") proceedingRef.current = false;
  }, [blocker.status]);

  const filteredPermissions = useMemo(() => {
    const term = search.trim().toLowerCase();
    const sorted = [...permissions].sort((a, b) => a.code.localeCompare(b.code));
    if (!term) return sorted;
    return sorted.filter(
      (p) =>
        p.code.toLowerCase().includes(term) ||
        (p.description?.toLowerCase().includes(term) ?? false),
    );
  }, [permissions, search]);

  const isLoading =
    rolesQuery.isPending ||
    permissionsQuery.isPending ||
    (roles.length > 0 && rolePermQueries.some((q) => q.isPending));

  const firstError =
    rolesQuery.error ??
    permissionsQuery.error ??
    rolePermQueries.find((q) => q.isError)?.error ??
    null;

  const refetchAll = () => {
    void rolesQuery.refetch();
    void permissionsQuery.refetch();
    for (const q of rolePermQueries) {
      if (q.isError) void q.refetch();
    }
  };

  const isPermissionChecked = (roleId: number, permissionId: number): boolean => {
    const ids = draftByRole[roleId] ?? serverIdsByRole[roleId] ?? [];
    return ids.includes(permissionId);
  };

  const togglePermission = (roleId: number, permissionId: number, checked: boolean) => {
    if (!canUpdate || saving) return;
    const serverIds = serverIdsByRole[roleId];
    if (!serverIds) return;

    setDraftByRole((current) => {
      const base = current[roleId] ?? serverIds;
      const nextIds = checked
        ? base.includes(permissionId)
          ? base
          : [...base, permissionId]
        : base.filter((id) => id !== permissionId);

      if (sameIdSet(nextIds, serverIds)) {
        const rest = { ...current };
        delete rest[roleId];
        return rest;
      }
      return { ...current, [roleId]: nextIds };
    });
  };

  const handleSave = async () => {
    if (!canUpdate || !hasUnsavedChanges || saving) return;
    setSaving(true);
    const savedRoles: number[] = [];
    try {
      for (const roleId of dirtyRoleIds) {
        const permissionIds = draftByRole[roleId] ?? serverIdsByRole[roleId] ?? [];
        await updateRolePermissionsMutation.mutateAsync({ roleId, permissionIds });
        savedRoles.push(roleId);
      }
      setDraftByRole((current) => {
        const next = { ...current };
        for (const id of savedRoles) delete next[id];
        return next;
      });
      toast.success(
        savedRoles.length === 1
          ? "Permisos del rol actualizados correctamente."
          : `Permisos de ${savedRoles.length} roles actualizados correctamente.`,
      );
    } catch (error) {
      if (savedRoles.length > 0) {
        setDraftByRole((current) => {
          const next = { ...current };
          for (const id of savedRoles) delete next[id];
          return next;
        });
      }
      if (!isForbidden(error)) {
        toast.error(errorMessage(error, "No se pudieron guardar los cambios en los roles."));
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = async () => {
    if (!hasUnsavedChanges || saving) return;
    const confirmed = await confirm({
      tone: "danger",
      title: "¿Descartar cambios sin guardar?",
      description: `Se revertirán las modificaciones pendientes en ${dirtyRoleIds.length} ${dirtyRoleIds.length === 1 ? "rol" : "roles"}.`,
      confirmLabel: "Descartar",
      cancelLabel: "Seguir editando",
    });
    if (!confirmed) return;
    setDraftByRole({});
    toast.info("Se descartaron los cambios sin guardar.");
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Roles y permisos"
        subtitle="Matriz de permisos por rol. Marca o desmarca celdas y guarda los cambios de forma explícita."
        actions={
          canUpdate ? (
            <div className="flex flex-wrap items-center gap-2">
              {hasUnsavedChanges && (
                <>
                  <Badge
                    data-testid="unsaved-changes-badge"
                    className="inline-flex items-center gap-1.5 rounded-full border border-status-warning-border bg-status-warning-bg px-2.5 py-1 text-xs font-medium text-status-warning-fg"
                  >
                    <span aria-hidden="true" className="size-1.5 rounded-full bg-status-warning-solid" />
                    <span>
                      Cambios sin guardar ({dirtyRoleIds.length}{" "}
                      {dirtyRoleIds.length === 1 ? "rol" : "roles"})
                    </span>
                  </Badge>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void handleDiscard()}
                    disabled={saving}
                  >
                    <RotateCcw className="size-4" aria-hidden="true" />
                    Descartar
                  </Button>
                </>
              )}
              <Button
                type="button"
                onClick={() => void handleSave()}
                disabled={!hasUnsavedChanges || saving || isLoading}
              >
                {saving ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Save className="size-4" aria-hidden="true" />
                )}
                {saving ? "Guardando…" : "Guardar cambios"}
              </Button>
            </div>
          ) : undefined
        }
      />

      {!canUpdate && (
        <Alert className="border-status-info-border bg-status-info-bg text-status-info-fg">
          <Info className="size-4" aria-hidden="true" />
          <AlertTitle>Modo solo lectura</AlertTitle>
          <AlertDescription className="text-status-info-fg">
            No cuentas con el permiso <code className="font-mono text-xs">ROL_MODIFICAR</code> para editar la matriz de permisos.
          </AlertDescription>
        </Alert>
      )}

      <Card className="overflow-hidden border border-border bg-card shadow-[var(--shadow-xs)]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                type="search"
                aria-label="Buscar permisos"
                placeholder="Buscar permiso por código o descripción…"
                className="w-72 pl-8"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            {search.trim() !== "" && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setSearch("")}>
                Limpiar búsqueda
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground tabular-nums">
            {filteredPermissions.length} {filteredPermissions.length === 1 ? "permiso" : "permisos"} · {roles.length}{" "}
            {roles.length === 1 ? "rol" : "roles"}
          </p>
        </div>

        {isLoading ? (
          <div className="space-y-3 p-4" aria-busy="true" aria-label="Cargando matriz de permisos">
            {Array.from({ length: 6 }, (_, idx) => (
              <div key={idx} className="flex items-center gap-4">
                <Skeleton className="h-5 w-64" />
                <Skeleton className="h-5 w-16" />
                <Skeleton className="h-5 w-16" />
                <Skeleton className="h-5 w-16" />
              </div>
            ))}
          </div>
        ) : firstError ? (
          <div className="p-6">
            <div
              role="alert"
              className="flex flex-col items-center justify-center rounded-lg border border-status-danger-border bg-status-danger-bg/60 p-6 text-center"
            >
              <AlertCircle className="mb-2 size-6 text-status-danger-fg" aria-hidden="true" />
              <p className="text-sm font-medium text-status-danger-fg">
                {errorMessage(firstError, "No se pudo cargar la matriz de roles y permisos.")}
              </p>
              <Button type="button" variant="outline" size="sm" onClick={refetchAll} className="mt-4">
                Reintentar
              </Button>
            </div>
          </div>
        ) : roles.length === 0 || permissions.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={<ShieldCheck className="size-6 text-muted-foreground" aria-hidden="true" />}
              title="Matriz sin datos"
              description="No hay roles o permisos configurados en el sistema."
            />
          </div>
        ) : filteredPermissions.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={<Search className="size-6 text-muted-foreground" aria-hidden="true" />}
              title="Sin permisos que coincidan"
              description="Pruebe con otro código o palabra clave."
              action={
                <Button type="button" variant="outline" size="sm" onClick={() => setSearch("")}>
                  Limpiar búsqueda
                </Button>
              }
            />
          </div>
        ) : (
          <Table>
            <TableHeader className="bg-muted/70 [&_tr]:border-b [&_tr]:border-border">
              <TableRow className="hover:bg-transparent">
                <TableHead className="min-w-[260px] px-4 py-2.5 text-xs font-semibold text-muted-foreground">
                  Permiso
                </TableHead>
                {roles.map((role) => {
                  const isRoleDirty = dirtyRoleIds.includes(role.id);
                  return (
                    <TableHead
                      key={role.id}
                      className="px-4 py-2.5 text-center text-xs font-semibold text-muted-foreground"
                    >
                      <div className="inline-flex items-center justify-center gap-1.5">
                        <span>{role.name}</span>
                        {isRoleDirty && (
                          <span
                            className="size-2 rounded-full bg-status-warning-solid"
                            title="Cambios sin guardar en este rol"
                            aria-label="Cambios sin guardar"
                          />
                        )}
                      </div>
                    </TableHead>
                  );
                })}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredPermissions.map((permission) => (
                <TableRow key={permission.id} className="border-border hover:bg-muted/40">
                  <TableCell className="px-4 py-2.5">
                    <div className="font-mono text-xs font-medium text-foreground">{permission.code}</div>
                    {permission.description && (
                      <div className="mt-0.5 text-xs text-muted-foreground">{permission.description}</div>
                    )}
                  </TableCell>
                  {roles.map((role) => {
                    const checked = isPermissionChecked(role.id, permission.id);
                    return (
                      <TableCell key={role.id} className="px-4 py-2.5 text-center">
                        <div className="inline-flex items-center justify-center">
                          <Checkbox
                            checked={checked}
                            disabled={!canUpdate || saving}
                            aria-label={`${permission.code} para ${role.name}`}
                            onCheckedChange={(value) => togglePermission(role.id, permission.id, value === true)}
                          />
                        </div>
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <ConfirmDialog
        open={blocker.status === "blocked"}
        onOpenChange={(open) => {
          if (!open && blocker.status === "blocked" && !proceedingRef.current) {
            blocker.reset();
          }
        }}
        tone="danger"
        title="¿Salir sin guardar los cambios?"
        description="Hay cambios pendientes en la matriz de permisos que se perderán si sales de esta página."
        confirmLabel="Salir sin guardar"
        cancelLabel="Seguir editando"
        onConfirm={() => {
          if (blocker.status !== "blocked") return;
          proceedingRef.current = true;
          blocker.proceed();
        }}
      />
    </div>
  );
}
