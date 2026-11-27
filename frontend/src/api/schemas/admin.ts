import { z } from "zod";
import { serverDateTime } from "./datetime";

export const GeneralStatusSchema = z.enum(["ACTIVO", "INACTIVO", "DESCONOCIDO"]).catch("DESCONOCIDO");
export type GeneralStatus = z.output<typeof GeneralStatusSchema>;

// GET /users, POST /users, PATCH /users/{id}/status -> UserDto
export const AdminUserSchema = z
  .object({
    id: z.string(),
    username: z.string(),
    email: z.string(),
    fullName: z.string(),
    status: GeneralStatusSchema,
  })
  .loose();
export type AdminUser = z.output<typeof AdminUserSchema>;
export const AdminUserListSchema = z.array(AdminUserSchema);

// GET /users/permission-matrix -> UserManagementService.PermissionMatrix
const UserPermissionRowSchema = z
  .object({
    userId: z.string(),
    username: z.string(),
    email: z.string(),
    fullName: z.string(),
    status: GeneralStatusSchema,
    roles: z.array(z.string()),
    permissions: z.array(z.string()),
    matrix: z.record(z.string(), z.boolean()),
  })
  .loose();
export type UserPermissionRow = z.output<typeof UserPermissionRowSchema>;

export const PermissionMatrixSchema = z
  .object({
    permissionColumns: z.array(z.string()),
    users: z.array(UserPermissionRowSchema),
  })
  .loose();
export type PermissionMatrix = z.output<typeof PermissionMatrixSchema>;

// GET /roles -> Rol
export const RoleSchema = z
  .object({
    id: z.number(),
    nombre: z.string(),
    descripcion: z.string().nullable().optional(),
  })
  .loose()
  .transform((w) => ({
    id: w.id,
    name: w.nombre,
    description: w.descripcion ?? null,
  }));
export type Role = z.output<typeof RoleSchema>;
export const RoleListSchema = z.array(RoleSchema);

// GET /permissions, GET /roles/{id}/permissions -> Permiso
export const PermissionSchema = z
  .object({
    id: z.number(),
    codigo: z.string(),
    descripcion: z.string().nullable().optional(),
  })
  .loose()
  .transform((w) => ({
    id: w.id,
    code: w.codigo,
    description: w.descripcion ?? null,
  }));
export type Permission = z.output<typeof PermissionSchema>;
export const PermissionListSchema = z.array(PermissionSchema);

// GET /auditoria -> Auditoria
const AuditActorWireSchema = z
  .object({
    id: z.string().optional(),
    nombreUsuario: z.string().optional(),
    nombreCompleto: z.string().optional(),
  })
  .loose();

export const AuditLogSchema = z
  .object({
    id: z.number(),
    usuario: AuditActorWireSchema.nullable().optional(),
    accion: z.string(),
    entidad: z.string(),
    entidadId: z.string().nullable().optional(),
    valorAnterior: z.string().nullable().optional(),
    valorNuevo: z.string().nullable().optional(),
    direccionIp: z.string().nullable().optional(),
    agenteUsuario: z.string().nullable().optional(),
    creadoEn: serverDateTime,
  })
  .loose()
  .transform((w) => ({
    id: w.id,
    userId: w.usuario?.id ?? null,
    username: w.usuario?.nombreUsuario ?? null,
    userFullName: w.usuario?.nombreCompleto ?? null,
    action: w.accion,
    entity: w.entidad,
    entityId: w.entidadId ?? null,
    previousValue: w.valorAnterior ?? null,
    newValue: w.valorNuevo ?? null,
    ipAddress: w.direccionIp ?? null,
    userAgent: w.agenteUsuario ?? null,
    createdAt: w.creadoEn,
  }));
export type AuditLog = z.output<typeof AuditLogSchema>;
export const AuditLogListSchema = z.array(AuditLogSchema);

// GET /search -> SearchResult[]
export const SearchResultSchema = z
  .object({
    type: z.string(),
    id: z.string(),
    label: z.string(),
    path: z.string(),
  })
  .loose();
export type SearchResult = z.output<typeof SearchResultSchema>;
export const SearchResultListSchema = z.array(SearchResultSchema);

// GET /notifications -> NotificationController.NotificationView[]
export const NotificationSchema = z
  .object({
    id: z.number(),
    action: z.string(),
    entity: z.string(),
    entityId: z.string().nullable().optional(),
    createdAt: serverDateTime,
  })
  .loose()
  .transform((w) => ({
    id: w.id,
    action: w.action,
    entity: w.entity,
    entityId: w.entityId ?? null,
    createdAt: w.createdAt,
  }));
export type Notification = z.output<typeof NotificationSchema>;
export const NotificationListSchema = z.array(NotificationSchema);

// ---------------------------------------------------------------------------
// Formularios de administración (RHF + zod)
// ---------------------------------------------------------------------------

export interface PasswordRule {
  id: string;
  label: string;
  test: (value: string) => boolean;
}

export const PASSWORD_RULES: readonly PasswordRule[] = [
  { id: "length", label: "Mínimo 8 caracteres", test: (v) => v.length >= 8 },
  { id: "upper", label: "Al menos una letra mayúscula", test: (v) => /[A-Z]/.test(v) },
  { id: "lower", label: "Al menos una letra minúscula", test: (v) => /[a-z]/.test(v) },
  { id: "digit", label: "Al menos un número", test: (v) => /\d/.test(v) },
  { id: "special", label: "Al menos un carácter especial", test: (v) => /[^A-Za-z0-9]/.test(v) },
];

export const CreateUserFormSchema = z
  .object({
    username: z
      .string()
      .trim()
      .min(1, "El nombre de usuario es requerido.")
      .max(80, "Máximo 80 caracteres.")
      .regex(/^\S+$/, "El nombre de usuario no puede contener espacios."),
    fullName: z.string().trim().min(1, "El nombre completo es requerido.").max(150, "Máximo 150 caracteres."),
    email: z
      .string()
      .trim()
      .min(1, "El correo electrónico es requerido.")
      .email("Ingrese un correo electrónico válido.")
      .max(150, "Máximo 150 caracteres."),
    password: z
      .string()
      .min(8, "La contraseña debe tener al menos 8 caracteres.")
      .refine((v) => /[A-Z]/.test(v), "Incluye al menos una letra mayúscula.")
      .refine((v) => /[a-z]/.test(v), "Incluye al menos una letra minúscula.")
      .refine((v) => /\d/.test(v), "Incluye al menos un número.")
      .refine((v) => /[^A-Za-z0-9]/.test(v), "Incluye al menos un carácter especial."),
    confirmPassword: z.string().min(1, "Confirme la contraseña inicial."),
    roleId: z.number().int().positive().optional(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Las contraseñas no coinciden.",
    path: ["confirmPassword"],
  });

export type CreateUserFormValues = z.output<typeof CreateUserFormSchema>;
