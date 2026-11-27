import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import {
  getPermissionMatrix,
  getRolePermissions,
  listAudit,
  listPermissions,
  listRoles,
  listUsers,
  type ListAuditParams,
} from "../../api/endpoints/admin";

export const adminKeys = {
  all: ["admin"] as const,
  users: () => [...adminKeys.all, "users"] as const,
  permissionMatrix: () => [...adminKeys.all, "permission-matrix"] as const,
  roles: () => [...adminKeys.all, "roles"] as const,
  permissions: () => [...adminKeys.all, "permissions"] as const,
  rolePermissions: (roleId: number) => [...adminKeys.all, "role-permissions", roleId] as const,
  audit: (params: { entity?: string; entityId?: string } = {}) => [...adminKeys.all, "audit", params] as const,
};

export const usersListQuery = () =>
  queryOptions({
    queryKey: adminKeys.users(),
    queryFn: listUsers,
  });

export const permissionMatrixQuery = () =>
  queryOptions({
    queryKey: adminKeys.permissionMatrix(),
    queryFn: getPermissionMatrix,
  });

export const rolesListQuery = () =>
  queryOptions({
    queryKey: adminKeys.roles(),
    queryFn: listRoles,
  });

export const permissionsListQuery = () =>
  queryOptions({
    queryKey: adminKeys.permissions(),
    queryFn: listPermissions,
  });

export const rolePermissionsQuery = (roleId: number) =>
  queryOptions({
    queryKey: adminKeys.rolePermissions(roleId),
    queryFn: () => getRolePermissions(roleId),
  });

export function normalizeAuditQueryParams(params: ListAuditParams): { entity?: string; entityId?: string } {
  const entity = params.entity?.trim();
  const entityId = params.entityId?.trim();
  return entity && entityId ? { entity, entityId } : {};
}

export const auditListQuery = (params: ListAuditParams = {}) => {
  const normalized = normalizeAuditQueryParams(params);
  return queryOptions({
    queryKey: adminKeys.audit(normalized),
    queryFn: () => listAudit(normalized),
    placeholderData: keepPreviousData,
  });
};
