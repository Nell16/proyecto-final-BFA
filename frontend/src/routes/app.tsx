import { useEffect, useRef } from "react";
import { createFileRoute, Outlet, Link, redirect, useNavigate, useLocation, useRouter } from "@tanstack/react-router";
import { useStaffAuth } from "../store/staffAuth";
import { ensureStaffUser } from "../store/ensureStaffUser";
import { Brand, APP_NAME } from "../app/components/brand";
import {
  LogOut, Bell, Search,
} from "lucide-react";
import { NAV_GROUPS, visibleNavItems } from "../app/navigation";
import { Input } from "../app/components/ui/input";
import { Avatar, AvatarFallback } from "../app/components/ui/avatar";
import { Badge } from "../app/components/ui/badge";
import { Button } from "../app/components/ui/button";

export const Route = createFileRoute("/app")({
  beforeLoad: async ({ context, location }) => {
    const toLogin = () => redirect({ to: "/login", search: { redirect: location.href } });

    if (!useStaffAuth.getState().token) {
      throw toLogin();
    }

    // No se confía solo en el storage: /auth/me manda (permisos y roles vigentes).
    if ((await ensureStaffUser(context.queryClient)) === "login") {
      throw toLogin();
    }
  },
  component: AppLayout,
});

/** Nombre de rol legible para el pie del menú lateral (ROLE_ADMINISTRADOR → admin). */
const normalizeRole = (role: string): string => {
  const clean = role.toUpperCase().replace(/^ROLE_/, "");
  if (clean.includes("ADMINISTRADOR") || clean === "ADMIN") return "admin";
  if (clean.includes("APLICADOR")) return "aplicador";
  if (clean.includes("PSICOLOGO") || clean.includes("COORDINADOR")) return "psicologo";
  if (clean.includes("CONSULTOR") || clean.includes("REPORTE")) return "consultor";
  return clean.toLowerCase();
};

function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const clearSession = useStaffAuth((s) => s.clear);
  const hasAnyPermission = useStaffAuth((s) => s.hasAnyPermission);
  const user = useStaffAuth((s) => s.user);
  const sessionId = useStaffAuth((s) => s.sessionId);
  const router = useRouter();

  // Cambió la cuenta (login/logout/expiración/otra pestaña): se re-evalúan beforeLoad y permisos.
  const lastSessionId = useRef(sessionId);
  useEffect(() => {
    if (lastSessionId.current === sessionId) return;
    lastSessionId.current = sessionId;
    void router.invalidate();
  }, [sessionId, router]);

  const displayName = user?.username ?? "";
  const roles = Array.from(new Set((user?.roles ?? []).map(normalizeRole)));
  const initials = displayName
    ? displayName.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()
    : "US";

  const handleLogout = () => {
    // clear() descarta caché de React Query y stores legacy de esta cuenta.
    clearSession();
    navigate({ to: "/login" });
  };

  // Título e información dinámica para la cabecera del módulo actual
  const getHeaderInfo = (path: string) => {
    if (path.includes("/app/carreras")) return { t: "Catálogo de Carreras", s: "Gestión de carreras académicas disponibles" };
    if (path.includes("/app/grupos")) return { t: "Catálogo de Grupos Académicos", s: "Gestión de grupos y asignaciones" };
    if (path.includes("/app/cohortes")) return { t: "Catálogo de Cohortes", s: "Gestión de cohortes por año y período" };
    if (path.includes("/app/sexos")) return { t: "Catálogo de Sexos", s: "Gestión de opciones biológicas y de género" };
    if (path.includes("/app/dashboard")) return { t: "Inicio", s: "Resumen general de su actividad" };
    if (path.includes("/app/sesiones/nueva")) return { t: "Nueva sesión", s: "Creación y configuración de sesión de pruebas" };
    if (path.includes("/app/sesiones")) return { t: "Monitor de sesiones", s: "Estado en tiempo real de los participantes" };
    if (path.includes("/app/participantes")) return { t: "Participantes", s: "Registro y consulta de evaluados" };
    if (path.includes("/app/instrumentos")) return { t: "Configuración de pruebas", s: "Tests, versiones, subtests, ítems y claves" };
    if (path.includes("/app/revision-manual")) return { t: "Bandeja de revisión manual", s: "Respuestas abiertas pendientes de calificar" };
    if (path.includes("/app/calificaciones")) return { t: "Calificación de intentos", s: "Ejecución manual de scoring para intentos completados" };
    if (path.includes("/app/resultados")) return { t: "Resultados individuales", s: "Reporte psicométrico por participante" };
    if (path.includes("/app/dashboard-resultados")) return { t: "Resultados agregados", s: "Análisis estadístico y demográfico" };
    if (path.includes("/app/reportes")) return { t: "Centro de reportes", s: "Exportación de datos en PDF, Excel y CSV" };
    if (path.includes("/app/auditoria")) return { t: "Auditoría de sistema", s: "Registro completo de acciones sensibles" };
    if (path.includes("/app/usuarios")) return { t: "Usuarios", s: "Gestión de cuentas y accesos" };
    if (path.includes("/app/roles")) return { t: "Roles y Permisos", s: "Matriz de privilegios del sistema" };
    if (path.includes("/app/respaldos")) return { t: "Respaldos y restauración", s: "Base de datos e integridad del sistema" };
    return { t: APP_NAME, s: "Sistema Integrado de Aplicación de Tests" };
  };

  const headerInfo = getHeaderInfo(location.pathname);

  return (
    <div className="flex h-screen w-screen bg-muted/40 overflow-hidden">
      {/* Sidebar - Desktop */}
      <aside className="hidden md:flex w-68 shrink-0 flex-col gap-4 bg-sidebar text-sidebar-foreground p-4">
        <div className="px-1 pt-1 pb-2">
          <Brand light />
        </div>
        {/* Navegación en tarjeta blanca, como el menú de UAM Virtual */}
        <nav
          aria-label="Navegación principal"
          className="flex-1 overflow-y-auto rounded-lg bg-sidebar-panel text-sidebar-panel-foreground shadow-md p-2 space-y-4"
        >
          {NAV_GROUPS.map((g) => {
            const items = visibleNavItems(g.items, hasAnyPermission);
            if (!items.length) return null;
            return (
              <div key={g.group}>
                <div className="px-3 pt-1 text-[10px] uppercase font-bold tracking-wider text-text-tertiary mb-1">{g.group}</div>
                <div className="space-y-0.5">
                  {items.map((i) => {
                    const Icon = i.icon;
                    return (
                      <Link
                        key={i.to}
                        to={i.to}
                        activeProps={{ className: "bg-sidebar-accent text-sidebar-accent-foreground font-semibold" }}
                        inactiveProps={{ className: "hover:bg-muted hover:text-foreground" }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition font-medium focus-visible:outline-2 focus-visible:outline-sidebar-ring"
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        {i.label}
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        {/* Perfil del Usuario en Sidebar */}
        <div className="rounded-lg bg-sidebar-panel text-sidebar-panel-foreground shadow-md p-2.5 flex items-center gap-2.5">
          <Avatar className="h-8 w-8 border border-border">
            <AvatarFallback className="bg-brand-soft text-brand-deep text-xs font-semibold">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 leading-tight min-w-0">
            <div className="text-sm font-semibold truncate text-foreground">{displayName || "Usuario"}</div>
            <div className="text-[11px] text-muted-foreground capitalize font-medium">{roles.join(", ")}</div>
          </div>
          <Button
            size="icon"
            variant="ghost"
            className="text-muted-foreground hover:bg-muted hover:text-foreground shrink-0"
            onClick={handleLogout}
            title="Cerrar sesión"
            aria-label="Cerrar sesión"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {/* Top Header */}
        <header className="h-16 border-b border-t-4 border-t-brand bg-card flex items-center px-4 md:px-6 gap-3 shrink-0">
          <div className="md:hidden"><Brand compact /></div>
          
          <div className="hidden md:flex items-center gap-2 flex-1 max-w-md">
            <div className="relative w-full">
              <Search className="h-4 w-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Buscar participantes, sesiones, ítems…" className="pl-8 bg-muted/60 border-0 focus-visible:ring-primary/40 focus-visible:bg-card transition" />
            </div>
          </div>
          
          <div className="flex-1 md:hidden" />
          
          <Badge variant="secondary" className="hidden sm:inline-flex bg-destructive/10 text-destructive border-none font-semibold text-[11px] tracking-wide uppercase px-2 py-0.5">
            Confidencial UAM
          </Badge>
          
          <Button variant="ghost" size="icon"><Bell className="h-4 w-4" /></Button>
        </header>

        {/* Dynamic Section Header */}
        <div className="px-4 md:px-6 py-4 border-b bg-card flex flex-wrap items-center gap-3 shrink-0">
          <div className="flex-1 min-w-0">
            <h1 className="text-xl text-brand-deep dark:text-primary font-bold tracking-tight">{headerInfo.t}</h1>
            <p className="text-xs text-muted-foreground mt-0.5">{headerInfo.s}</p>
          </div>
        </div>

        {/* Route Outlet */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6 bg-background">
          {/* `key`: al cambiar de cuenta de staff se remonta el área y se descarta el estado local (borradores, enlaces). */}
          <Outlet key={sessionId} />
        </main>
      </div>
    </div>
  );
}
