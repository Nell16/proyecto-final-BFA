import { staffClient } from "../client";
import { unwrap, type ApiEnvelope } from "../errors";
import { parseOrThrow } from "../schemas/parse";
import {
  AdminUserListSchema,
  AdminUserSchema,
  AuditLogListSchema,
  NotificationListSchema,
  PermissionListSchema,
  PermissionMatrixSchema,
  RoleListSchema,
  SearchResultListSchema,
  type AdminUser,
  type AuditLog,
  type Notification,
  type Permission,
  type PermissionMatrix,
  type Role,
  type SearchResult,
} from "../schemas/admin";

export interface CreateUserInput {
  username: string;
  email: string;
  fullName: string;
  password: string;
}

export type UserStatusInput = "ACTIVO" | "INACTIVO";

export interface ListAuditParams {
  entity?: string;
  entityId?: string;
}

export async function listUsers(): Promise<AdminUser[]> {
  const res = await staffClient.get<ApiEnvelope<unknown>>("/users");
  return parseOrThrow(AdminUserListSchema, unwrap(res), "GET /users");
}

export async function getPermissionMatrix(): Promise<PermissionMatrix> {
  const res = await staffClient.get<ApiEnvelope<unknown>>("/users/permission-matrix");
  return parseOrThrow(PermissionMatrixSchema, unwrap(res), "GET /users/permission-matrix");
}

export async function createUser(input: CreateUserInput): Promise<AdminUser> {
  const res = await staffClient.post<ApiEnvelope<unknown>>("/users", input);
  return parseOrThrow(AdminUserSchema, unwrap(res), "POST /users");
}

export async function setUserStatus(id: string, status: UserStatusInput): Promise<AdminUser> {
  const res = await staffClient.patch<ApiEnvelope<unknown>>(`/users/${id}/status`, { status });
  return parseOrThrow(AdminUserSchema, unwrap(res), `PATCH /users/${id}/status`);
}

export async function assignRole(userId: string, roleId: number): Promise<void> {
  const res = await staffClient.post<ApiEnvelope<unknown>>(`/users/${userId}/roles`, { roleId });
  unwrap(res);
}

export async function removeRole(userId: string, roleId: number): Promise<void> {
  const res = await staffClient.delete<ApiEnvelope<unknown>>(`/users/${userId}/roles/${roleId}`);
  unwrap(res);
}

export async function listRoles(): Promise<Role[]> {
  const res = await staffClient.get<ApiEnvelope<unknown>>("/roles");
  return parseOrThrow(RoleListSchema, unwrap(res), "GET /roles");
}

export async function listPermissions(): Promise<Permission[]> {
  const res = await staffClient.get<ApiEnvelope<unknown>>("/permissions");
  return parseOrThrow(PermissionListSchema, unwrap(res), "GET /permissions");
}

export async function getRolePermissions(roleId: number): Promise<Permission[]> {
  const res = await staffClient.get<ApiEnvelope<unknown>>(`/roles/${roleId}/permissions`);
  return parseOrThrow(PermissionListSchema, unwrap(res), `GET /roles/${roleId}/permissions`);
}

export async function setRolePermissions(roleId: number, permissionIds: number[]): Promise<void> {
  const res = await staffClient.put<ApiEnvelope<unknown>>(`/roles/${roleId}/permissions`, { permissionIds });
  unwrap(res);
}

export async function listAudit(params: ListAuditParams = {}): Promise<AuditLog[]> {
  const query: Record<string, string> = {};
  const entity = params.entity?.trim();
  const entityId = params.entityId?.trim();
  if (entity && entityId) {
    query.entity = entity;
    query.entityId = entityId;
  }
  const res = await staffClient.get<ApiEnvelope<unknown>>("/auditoria", { params: query });
  return parseOrThrow(AuditLogListSchema, unwrap(res), "GET /auditoria");
}

export async function search(q: string): Promise<SearchResult[]> {
  const res = await staffClient.get<ApiEnvelope<unknown>>("/search", { params: { q } });
  return parseOrThrow(SearchResultListSchema, unwrap(res), "GET /search");
}

export async function listNotifications(): Promise<Notification[]> {
  const res = await staffClient.get<ApiEnvelope<unknown>>("/notifications");
  return parseOrThrow(NotificationListSchema, unwrap(res), "GET /notifications");
}
