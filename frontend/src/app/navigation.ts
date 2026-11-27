import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard, Users, Activity, FileBarChart,
  Settings2, ShieldCheck, UserCog, Database,
  BookOpen, Layers, Calendar, ClipboardCheck, ClipboardList,
} from "lucide-react";
import { ROUTE_PERMISSIONS } from "../store/routePermissions";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Visible si el usuario tiene AL MENOS UNO. Vacío = cualquier usuario autenticado. */
  permissions: readonly string[];
}

export const NAV_GROUPS: { group: string; items: NavItem[] }[] = [
  {
    group: "General",
    items: [
      { to: "/app/dashboard", label: "Inicio", icon: LayoutDashboard, permissions: ROUTE_PERMISSIONS["/app/dashboard"] },
    ],
  },
  {
    group: "Catálogos",
    items: [
      { to: "/app/carreras", label: "Carreras", icon: BookOpen, permissions: ROUTE_PERMISSIONS["/app/carreras"] },
      { to: "/app/grupos", label: "Grupos Académicos", icon: Layers, permissions: ROUTE_PERMISSIONS["/app/grupos"] },
      { to: "/app/cohortes", label: "Cohortes", icon: Calendar, permissions: ROUTE_PERMISSIONS["/app/cohortes"] },
      { to: "/app/sexos", label: "Sexos", icon: Users, permissions: ROUTE_PERMISSIONS["/app/sexos"] },
    ],
  },
  {
    group: "Aplicación",
    items: [
      { to: "/app/sesiones", label: "Monitor de sesiones", icon: Activity, permissions: ROUTE_PERMISSIONS["/app/sesiones"] },
      { to: "/app/participantes", label: "Participantes", icon: Users, permissions: ROUTE_PERMISSIONS["/app/participantes"] },
    ],
  },
  {
    group: "Instrumentos",
    items: [
      { to: "/app/instrumentos", label: "Configuración de pruebas", icon: Settings2, permissions: ROUTE_PERMISSIONS["/app/instrumentos"] },
    ],
  },
  {
    group: "Resultados",
    items: [
      { to: "/app/calificaciones", label: "Calificar intentos", icon: ClipboardCheck, permissions: ROUTE_PERMISSIONS["/app/calificaciones"] },
      { to: "/app/revision-manual", label: "Revisión manual", icon: ClipboardList, permissions: ROUTE_PERMISSIONS["/app/revision-manual"] },
      { to: "/app/resultados", label: "Resultados individuales", icon: FileBarChart, permissions: ROUTE_PERMISSIONS["/app/resultados"] },
      { to: "/app/dashboard-resultados", label: "Resultados agregados", icon: LayoutDashboard, permissions: ROUTE_PERMISSIONS["/app/dashboard-resultados"] },
      { to: "/app/reportes", label: "Centro de reportes", icon: FileBarChart, permissions: ROUTE_PERMISSIONS["/app/reportes"] },
    ],
  },
  {
    group: "Administración",
    items: [
      { to: "/app/auditoria", label: "Auditoría", icon: ShieldCheck, permissions: ROUTE_PERMISSIONS["/app/auditoria"] },
      { to: "/app/usuarios", label: "Usuarios", icon: UserCog, permissions: ROUTE_PERMISSIONS["/app/usuarios"] },
      { to: "/app/roles", label: "Roles y permisos", icon: UserCog, permissions: ROUTE_PERMISSIONS["/app/roles"] },
      { to: "/app/respaldos", label: "Respaldos", icon: Database, permissions: ROUTE_PERMISSIONS["/app/respaldos"] },
    ],
  },
];

/**
 * Entradas del grupo visibles para el usuario: con permisos vacíos, cualquier autenticado; si no, AL MENOS UNO.
 * Cada entrada usa los permisos de su ruta (`ROUTE_PERMISSIONS`), así menú y guardia nunca divergen.
 */
export const visibleNavItems = (
  items: readonly NavItem[],
  hasAnyPermission: (permissions: readonly string[]) => boolean,
): NavItem[] => items.filter((i) => i.permissions.length === 0 || hasAnyPermission(i.permissions));
