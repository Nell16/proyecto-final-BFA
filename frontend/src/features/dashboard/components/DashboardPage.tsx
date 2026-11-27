import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Activity,
  AlertCircle,
  BookOpen,
  Calendar,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Database,
  FileBarChart,
  Layers,
  LayoutDashboard,
  ListChecks,
  RefreshCw,
  Settings2,
  ShieldCheck,
  UserCog,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "../../../app/components/ui/alert";
import { Button } from "../../../app/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../app/components/ui/card";
import { EmptyState } from "../../../app/components/ui/empty-state";
import { Input } from "../../../app/components/ui/input";
import { Label } from "../../../app/components/ui/label";
import { PageHeader } from "../../../app/components/ui/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../app/components/ui/select";
import { Skeleton } from "../../../app/components/ui/skeleton";
import { PERMISSIONS, SESION_LEER } from "../../../store/permissions";
import { ROUTE_PERMISSIONS, type GuardedAppRoute } from "../../../store/routePermissions";
import { useStaffAuth } from "../../../store/staffAuth";
import { errorMessage } from "../../catalogs/error-message";
import { sessionListQuery } from "../../sessions/queries";
import { dashboardOverviewQuery } from "../queries";

interface QuickAccessCard {
  to: GuardedAppRoute;
  title: string;
  description: string;
  group: string;
  icon: LucideIcon;
  permissions: readonly string[];
}

const QUICK_ACCESS_CARDS: readonly QuickAccessCard[] = [
  {
    to: "/app/sesiones",
    title: "Monitor de sesiones",
    description: "Programación, apertura y seguimiento en tiempo real.",
    group: "Aplicación",
    icon: Activity,
    permissions: ROUTE_PERMISSIONS["/app/sesiones"],
  },
  {
    to: "/app/participantes",
    title: "Participantes",
    description: "Registro y gestión de evaluados.",
    group: "Aplicación",
    icon: Users,
    permissions: ROUTE_PERMISSIONS["/app/participantes"],
  },
  {
    to: "/app/instrumentos",
    title: "Configuración de pruebas",
    description: "Tests, versiones, ítems, claves y baremos.",
    group: "Instrumentos",
    icon: Settings2,
    permissions: ROUTE_PERMISSIONS["/app/instrumentos"],
  },
  {
    to: "/app/calificaciones",
    title: "Calificar intentos",
    description: "Ejecución de calificación y revisión manual.",
    group: "Resultados",
    icon: ClipboardCheck,
    permissions: ROUTE_PERMISSIONS["/app/calificaciones"],
  },
  {
    to: "/app/resultados",
    title: "Resultados individuales",
    description: "Consulta detallada de resultados por participante.",
    group: "Resultados",
    icon: FileBarChart,
    permissions: ROUTE_PERMISSIONS["/app/resultados"],
  },
  {
    to: "/app/dashboard-resultados",
    title: "Resultados agregados",
    description: "Estadísticas y promedios por dimensión.",
    group: "Resultados",
    icon: LayoutDashboard,
    permissions: ROUTE_PERMISSIONS["/app/dashboard-resultados"],
  },
  {
    to: "/app/reportes",
    title: "Centro de reportes",
    description: "Historial y registro de reportes individuales y agregados.",
    group: "Resultados",
    icon: FileBarChart,
    permissions: ROUTE_PERMISSIONS["/app/reportes"],
  },
  {
    to: "/app/auditoria",
    title: "Auditoría",
    description: "Bitácora de eventos y operaciones sensibles.",
    group: "Administración",
    icon: ShieldCheck,
    permissions: ROUTE_PERMISSIONS["/app/auditoria"],
  },
  {
    to: "/app/usuarios",
    title: "Usuarios",
    description: "Cuentas de staff, estados y roles asignados.",
    group: "Administración",
    icon: UserCog,
    permissions: ROUTE_PERMISSIONS["/app/usuarios"],
  },
  {
    to: "/app/roles",
    title: "Roles y permisos",
    description: "Matriz de privilegios por rol.",
    group: "Administración",
    icon: ListChecks,
    permissions: ROUTE_PERMISSIONS["/app/roles"],
  },
  {
    to: "/app/respaldos",
    title: "Respaldos",
    description: "Generación, descarga y solicitudes de restauración.",
    group: "Administración",
    icon: Database,
    permissions: ROUTE_PERMISSIONS["/app/respaldos"],
  },
  {
    to: "/app/carreras",
    title: "Carreras",
    description: "Catálogo académico de carreras.",
    group: "Catálogos",
    icon: BookOpen,
    permissions: ROUTE_PERMISSIONS["/app/carreras"],
  },
  {
    to: "/app/grupos",
    title: "Grupos académicos",
    description: "Catálogo de grupos por carrera.",
    group: "Catálogos",
    icon: Layers,
    permissions: ROUTE_PERMISSIONS["/app/grupos"],
  },
  {
    to: "/app/cohortes",
    title: "Cohortes",
    description: "Catálogo de cohortes por período.",
    group: "Catálogos",
    icon: Calendar,
    permissions: ROUTE_PERMISSIONS["/app/cohortes"],
  },
];

export function DashboardPage() {
  const user = useStaffAuth((s) => s.user);
  const hasAnyPermission = useStaffAuth((s) => s.hasAnyPermission);

  const canReadOverview = hasAnyPermission([
    PERMISSIONS.RESULTADO_AGREGADO_VER,
    PERMISSIONS.RESULTADO_VER,
  ]);
  const canReadSessions = hasAnyPermission(SESION_LEER);

  const sessionsQuery = useQuery({
    ...sessionListQuery(),
    enabled: canReadOverview && canReadSessions,
  });

  const [manualSessionId, setManualSessionId] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);

  const sessions = useMemo(() => {
    const list = [...(sessionsQuery.data ?? [])];
    return list.sort((a, b) => b.scheduledStart.localeCompare(a.scheduledStart));
  }, [sessionsQuery.data]);

  const effectiveSessionId = useMemo(() => {
    if (!canReadOverview) return 0;
    if (!canReadSessions) {
      const parsed = Number(manualSessionId.trim());
      return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
    }
    if (selectedSessionId !== null && sessions.some((s) => s.id === selectedSessionId)) {
      return selectedSessionId;
    }
    const live = sessions.find((s) => s.status === "ABIERTA") ?? sessions[0];
    return live?.id ?? 0;
  }, [canReadOverview, canReadSessions, manualSessionId, selectedSessionId, sessions]);

  const overviewQuery = useQuery(
    dashboardOverviewQuery(effectiveSessionId, canReadOverview && effectiveSessionId > 0),
  );

  const visibleCards = useMemo(
    () => QUICK_ACCESS_CARDS.filter((card) => hasAnyPermission(card.permissions)),
    [hasAnyPermission],
  );

  const overview = overviewQuery.data;
  const isOverviewEmpty =
    overview !== undefined &&
    overview.assignedCount === 0 &&
    overview.startedCount === 0 &&
    overview.completedCount === 0 &&
    overview.scoredCount === 0;

  return (
    <div className="space-y-6 max-w-6xl">
      <PageHeader
        title={`Bienvenido${user?.username ? `, ${user.username}` : ""}`}
        subtitle="Resumen operativo y accesos habilitados para tu rol."
      />

      {canReadOverview && (
        <section aria-labelledby="dashboard-overview-heading" className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 id="dashboard-overview-heading" className="text-base font-semibold text-foreground">
                Resumen de evaluación
              </h2>
              <p className="text-xs text-muted-foreground">
                Métricas en vivo consultadas desde /dashboard/overview.
              </p>
            </div>

            {canReadSessions ? (
              <div className="flex items-center gap-2">
                <Label htmlFor="dashboard-session-select" className="text-xs text-muted-foreground">
                  Sesión
                </Label>
                <Select
                  value={effectiveSessionId > 0 ? String(effectiveSessionId) : ""}
                  onValueChange={(value) => setSelectedSessionId(Number(value))}
                  disabled={sessionsQuery.isPending || sessions.length === 0}
                >
                  <SelectTrigger id="dashboard-session-select" className="w-64">
                    <SelectValue placeholder="Seleccione una sesión" />
                  </SelectTrigger>
                  <SelectContent>
                    {sessions.map((session) => (
                      <SelectItem key={session.id} value={String(session.id)}>
                        {session.code} · {session.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Label htmlFor="dashboard-session-input" className="text-xs text-muted-foreground">
                  ID de sesión
                </Label>
                <Input
                  id="dashboard-session-input"
                  type="number"
                  min={1}
                  value={manualSessionId}
                  onChange={(event) => setManualSessionId(event.target.value)}
                  placeholder="Ej. 10"
                  className="w-36"
                />
              </div>
            )}
          </div>

          {canReadSessions && sessionsQuery.isPending && (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4" aria-label="Cargando sesiones">
              {Array.from({ length: 4 }, (_, index) => (
                <Card key={index} className="border border-border bg-card shadow-[var(--shadow-xs)]">
                  <CardContent className="space-y-3 p-5">
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="h-8 w-16" />
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {canReadSessions && sessionsQuery.isError && (
            <Alert
              role="alert"
              className="border-status-danger-border bg-status-danger-bg text-status-danger-fg"
            >
              <AlertCircle className="size-4" aria-hidden="true" />
              <AlertTitle>No se pudieron cargar las sesiones</AlertTitle>
              <AlertDescription className="flex flex-col gap-3 text-status-danger-fg sm:flex-row sm:items-center sm:justify-between">
                <span>{errorMessage(sessionsQuery.error, "Error al consultar las sesiones.")}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void sessionsQuery.refetch()}
                >
                  <RefreshCw className="size-4" aria-hidden="true" />
                  Reintentar
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {canReadSessions && sessionsQuery.isSuccess && sessions.length === 0 && (
            <EmptyState
              icon={<Activity className="size-6 text-muted-foreground" aria-hidden="true" />}
              title="Sin sesiones para resumir"
              description="Cuando existan sesiones registradas, podrás consultar aquí sus métricas de avance."
            />
          )}

          {!canReadSessions && effectiveSessionId === 0 && (
            <EmptyState
              icon={<LayoutDashboard className="size-6 text-muted-foreground" aria-hidden="true" />}
              title="Indique una sesión para consultar"
              description="Tu rol no tiene listado de sesiones habilitado; ingresa el ID de sesión para consultar /dashboard/overview."
            />
          )}

          {effectiveSessionId > 0 && overviewQuery.isPending && (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4" aria-label="Cargando resumen">
              {Array.from({ length: 4 }, (_, index) => (
                <Card key={index} className="border border-border bg-card shadow-[var(--shadow-xs)]">
                  <CardContent className="space-y-3 p-5">
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="h-8 w-16" />
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {effectiveSessionId > 0 && overviewQuery.isError && (
            <Alert
              role="alert"
              className="border-status-danger-border bg-status-danger-bg text-status-danger-fg"
            >
              <AlertCircle className="size-4" aria-hidden="true" />
              <AlertTitle>No se pudo cargar el resumen de la sesión #{effectiveSessionId}</AlertTitle>
              <AlertDescription className="flex flex-col gap-3 text-status-danger-fg sm:flex-row sm:items-center sm:justify-between">
                <span>
                  {errorMessage(overviewQuery.error, "Error al consultar /dashboard/overview.")}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void overviewQuery.refetch()}
                >
                  <RefreshCw className="size-4" aria-hidden="true" />
                  Reintentar
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {effectiveSessionId > 0 && overviewQuery.isSuccess && overview && (
            isOverviewEmpty ? (
              <EmptyState
                icon={<Users className="size-6 text-muted-foreground" aria-hidden="true" />}
                title={`Sesión #${overview.sessionId} sin actividad`}
                description="Esta sesión aún no registra participantes asignados ni intentos iniciados."
              />
            ) : (
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <Card className="border border-border bg-card shadow-[var(--shadow-xs)]">
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
                      <span>Participantes asignados</span>
                      <Users className="size-4 text-primary" aria-hidden="true" />
                    </div>
                    <p className="mt-2 text-2xl font-semibold tabular-nums text-foreground">
                      {overview.assignedCount}
                    </p>
                  </CardContent>
                </Card>

                <Card className="border border-border bg-card shadow-[var(--shadow-xs)]">
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
                      <span>Intentos iniciados</span>
                      <Activity className="size-4 text-status-info-fg" aria-hidden="true" />
                    </div>
                    <p className="mt-2 text-2xl font-semibold tabular-nums text-foreground">
                      {overview.startedCount}
                    </p>
                  </CardContent>
                </Card>

                <Card className="border border-border bg-card shadow-[var(--shadow-xs)]">
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
                      <span>Intentos completados</span>
                      <CheckCircle2 className="size-4 text-status-success-fg" aria-hidden="true" />
                    </div>
                    <p className="mt-2 text-2xl font-semibold tabular-nums text-foreground">
                      {overview.completedCount}
                    </p>
                  </CardContent>
                </Card>

                <Card className="border border-border bg-card shadow-[var(--shadow-xs)]">
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
                      <span>Resultados calificados</span>
                      <ListChecks className="size-4 text-status-warning-fg" aria-hidden="true" />
                    </div>
                    <p className="mt-2 text-2xl font-semibold tabular-nums text-foreground">
                      {overview.scoredCount}
                    </p>
                  </CardContent>
                </Card>
              </div>
            )
          )}
        </section>
      )}

      <section aria-labelledby="dashboard-modules-heading" className="space-y-4">
        <div>
          <h2 id="dashboard-modules-heading" className="text-base font-semibold text-foreground">
            Módulos disponibles
          </h2>
          <p className="text-xs text-muted-foreground">
            Accesos directos filtrados según los permisos de tu cuenta.
          </p>
        </div>

        {visibleCards.length === 0 ? (
          <EmptyState
            icon={<ShieldCheck className="size-6 text-muted-foreground" aria-hidden="true" />}
            title="Sin módulos habilitados"
            description="Tu cuenta autenticada no tiene permisos de navegación asignados en este momento."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visibleCards.map((card) => {
              const Icon = card.icon;
              return (
                <Card
                  key={card.to}
                  className="border border-border bg-card shadow-[var(--shadow-xs)] transition-colors hover:border-border-strong"
                >
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-muted-foreground">{card.group}</span>
                      <Icon className="size-4 text-primary" aria-hidden="true" />
                    </div>
                    <CardTitle className="text-sm font-semibold text-foreground">{card.title}</CardTitle>
                    <CardDescription className="text-xs">{card.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="pt-1">
                    <Button asChild variant="outline" size="sm" className="w-full justify-between">
                      <Link to={card.to}>
                        <span>Abrir módulo</span>
                        <ChevronRight className="size-4" aria-hidden="true" />
                      </Link>
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
