import { useRef, useState } from "react";
import { createFileRoute, redirect, useNavigate, useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Brand, APP_NAME } from "../app/components/brand";
import { Button } from "../app/components/ui/button";
import { Input } from "../app/components/ui/input";
import { Label } from "../app/components/ui/label";
import { Card, CardContent } from "../app/components/ui/card";
import { Alert, AlertDescription } from "../app/components/ui/alert";
import { AlertCircle, Lock, ShieldCheck, Loader2 } from "lucide-react";
import { authKeys, authService, LOGIN_SUPERSEDED } from "../api/authService";
import { toApiError } from "../api/errors";
import { useStaffAuth } from "../store/staffAuth";
import { resolveSafeRedirect } from "../store/safeRedirect";

export const Route = createFileRoute("/login")({
  component: LoginRoute,
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  beforeLoad: () => {
    if (useStaffAuth.getState().token) {
      throw redirect({ to: "/app/dashboard" });
    }
  }
});

const DEMO_ROLES = [
  { v: "aplicador", l: "Aplicador (Clave: 1234)" },
  { v: "psicologo", l: "Psicólogo (Clave: 1234)" },
  { v: "consultor", l: "Consultor (Clave: 1234)" },
  { v: "admin", l: "Administrador (Clave: 1234)" },
];

function LoginRoute() {
  const navigate = useNavigate();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { redirect: redirectTo } = Route.useSearch();

  const [user, setUserInput] = useState("");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  // Identifica el último envío del formulario: un envío anterior que termina tarde no debe
  // pintar errores, apagar el loading del nuevo ni navegar.
  const submitCounter = useRef(0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !pass) {
      setErr("Usuario y contraseña son requeridos.");
      return;
    }

    const submitId = (submitCounter.current += 1);
    const isLatestSubmit = (): boolean => submitCounter.current === submitId;
    setLoading(true);
    setErr("");

    try {
      // authService.login deja token, expiresAt y usuario en staffAuth (si sigue vigente).
      const result = await authService.login(user, pass);
      // Solo si ESTE login sigue siendo la sesión activa: si no, no se siembra ni se navega.
      const current = useStaffAuth.getState();
      if (!isLatestSubmit() || current.token !== result.token) return;
      // Sustituye cualquier /auth/me en caché de otro usuario.
      queryClient.setQueryData(authKeys.me(current.sessionId), result.user);
      router.history.replace(resolveSafeRedirect(redirectTo));
    } catch (error: unknown) {
      const apiError = toApiError(error);
      // Un login reemplazado por otro más reciente se descarta en silencio.
      if (apiError.code === LOGIN_SUPERSEDED || !isLatestSubmit()) return;
      setErr(apiError.message || "Error al iniciar sesión.");
    } finally {
      if (isLatestSubmit()) setLoading(false);
    }
  };

  const handleDemoFill = (role: string) => {
    setUserInput(role);
    setPass("1234");
    setErr("");
  };

  return (
    <div className="min-h-screen w-full grid lg:grid-cols-2 bg-background">
      <div className="hidden lg:flex flex-col justify-between bg-sidebar text-sidebar-foreground p-10 relative overflow-hidden">
        <div className="relative z-10">
          <Brand light />
        </div>
        <div className="relative z-10 max-w-md">
          <h2 className="text-3xl font-semibold leading-tight">
            Sistema Integrado de Aplicación de Tests
          </h2>
          <div className="mt-4 h-1 w-24 rounded-full bg-white/70" aria-hidden="true" />
          <p className="mt-4 text-white">
            Diseño de instrumentos, aplicación supervisada de pruebas psicométricas, calificación y reportes en un solo lugar. Resguardo de claves, ítems e imágenes bajo estándares de confidencialidad académica.
          </p>
          <div className="mt-8 flex items-center gap-2 text-sm text-white">
            <ShieldCheck className="h-4 w-4" /> Acceso restringido a personal autorizado UAM.
          </div>
        </div>
        <div className="relative z-10 text-xs text-white">© Universidad Americana · {APP_NAME}</div>
        {/* Formas decorativas en el teal de la marca */}
        <div className="absolute -right-32 -bottom-32 h-96 w-96 rounded-full bg-brand/60" aria-hidden="true" />
        <div className="absolute -right-10 top-20 h-40 w-40 rounded-full border-[14px] border-white/10" aria-hidden="true" />
        <div className="absolute -left-24 -top-24 h-64 w-64 rounded-full bg-brand-deep/40" aria-hidden="true" />
      </div>

      <div className="flex items-center justify-center p-6">
        <Card className="w-full max-w-md border-0 border-t-4 border-t-brand shadow-lg bg-card">
          <CardContent className="p-8">
            <div className="lg:hidden mb-6">
              <Brand />
            </div>
            <h1 className="text-2xl font-semibold text-brand-deep dark:text-primary">Iniciar sesión</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Ingrese sus credenciales institucionales.
            </p>

            {err && (
              <Alert variant="destructive" className="mt-4">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{err}</AlertDescription>
              </Alert>
            )}

            <form onSubmit={submit} className="mt-6 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="u">Correo o usuario</Label>
                <Input
                  id="u"
                  placeholder="usuario@uam.edu.ni"
                  value={user}
                  onChange={(e) => setUserInput(e.target.value)}
                  disabled={loading}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="p">Contraseña</Label>
                <Input
                  id="p"
                  type="password"
                  placeholder="••••••••"
                  value={pass}
                  onChange={(e) => setPass(e.target.value)}
                  disabled={loading}
                />
              </div>
              
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Accesos Rápidos (DEMO)</Label>
                <div className="grid grid-cols-2 gap-1.5">
                  {DEMO_ROLES.map((r) => (
                    <button
                      key={r.v}
                      type="button"
                      onClick={() => handleDemoFill(r.v)}
                      disabled={loading}
                      className="text-xs rounded border border-border bg-muted/40 hover:bg-muted py-1.5 px-2 text-left transition text-foreground truncate"
                    >
                      {r.l}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  disabled={loading}
                  className="text-xs text-primary hover:underline"
                >
                  Olvidé mi contraseña
                </button>
              </div>

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" /> Incursionando...
                  </>
                ) : (
                  <>
                    <Lock className="h-4 w-4 mr-1" /> Iniciar sesión
                  </>
                )}
              </Button>
            </form>

            <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
              <div className="h-px flex-1 bg-border" /> O ACCESO <div className="h-px flex-1 bg-border" />
            </div>
            <Button
              variant="outline"
              className="w-full"
              disabled={loading}
              onClick={() => navigate({ to: "/evaluacion/acceso" })}
            >
              Soy participante (acceder con enlace/código)
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
