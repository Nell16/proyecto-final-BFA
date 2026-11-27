import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ArrowLeft, ArrowRight, KeyRound, Loader2 } from "lucide-react";

import { parseAccessCode, validateAccess } from "../../api/endpoints/runtime";
import { ApiError } from "../../api/errors";
import { RUNTIME_QUERY_KEY_PREFIX } from "../../api/queryClient";
import { Alert, AlertDescription } from "../../app/components/ui/alert";
import { Brand } from "../../app/components/brand";
import { Button } from "../../app/components/ui/button";
import { Card, CardContent } from "../../app/components/ui/card";
import { Input } from "../../app/components/ui/input";
import { Label } from "../../app/components/ui/label";
import {
  clearPendingAccessError,
  consumePendingAccessError,
  peekPendingAccessError,
} from "../../features/runtime/accessError";
import { isStaleParticipantError } from "../../features/runtime/draft";
import { useParticipantAuth } from "../../store/participantAuth";

export interface AccesoSearch {
  code?: string;
}

export const Route = createFileRoute("/evaluacion/acceso")({
  validateSearch: (search: Record<string, unknown>): AccesoSearch => ({
    code: typeof search.code === "string" && search.code.trim() !== "" ? search.code : undefined,
  }),
  component: EvaluacionAccesoRoute,
});

function formatAccessError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "TOKEN_EXPIRADO":
        return "El código de acceso ha expirado. Solicite un nuevo enlace a su aplicador.";
      case "SESION_FINALIZADA":
        return "La sesión de evaluación ya ha sido cerrada.";
      case "SESION_NO_ABIERTA":
        return "La sesión de evaluación aún no se encuentra abierta.";
      case "SESION_PAUSADA":
        return "La sesión está pausada temporalmente. Intente nuevamente cuando el aplicador la reanude.";
      case "ASIGNACION_NO_OPERABLE":
        return "Su asignación no se encuentra disponible para responder.";
      default:
        return err.message;
    }
  }
  return "No se pudo validar el código de acceso. Verifique su conexión e intente nuevamente.";
}

function EvaluacionAccesoRoute() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { code: searchCode } = Route.useSearch();

  const [codeInput, setCodeInput] = useState(searchCode ?? "");
  const [prevSearchCode, setPrevSearchCode] = useState(searchCode);
  const [error, setError] = useState<string | null>(() => (searchCode ? null : peekPendingAccessError()));
  const [submitting, setSubmitting] = useState(Boolean(searchCode));

  if (searchCode !== prevSearchCode) {
    setPrevSearchCode(searchCode);
    if (searchCode) {
      setCodeInput(searchCode);
      setError(null);
      setSubmitting(true);
    }
  }

  useEffect(() => {
    if (!searchCode) {
      consumePendingAccessError();
    }
  }, [searchCode]);

  const attemptSeqRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const executeValidation = useCallback(
    async (rawCode: string, seq: number, isCancelled?: () => boolean, fromSearch = false) => {
      try {
        const parsed = parseAccessCode(rawCode);
        const access = await validateAccess(parsed);
        if (!mountedRef.current || seq !== attemptSeqRef.current || isCancelled?.()) {
          return;
        }

        queryClient.removeQueries({ queryKey: [RUNTIME_QUERY_KEY_PREFIX] });
        useParticipantAuth.getState().setSession({
          token: access.accessToken,
          assignmentId: access.assignmentId,
        });
        void navigate({ to: "/evaluacion/sesion", replace: true });
      } catch (err) {
        if (isStaleParticipantError(err)) return;
        if (!mountedRef.current || seq !== attemptSeqRef.current || isCancelled?.()) {
          return;
        }
        setError(formatAccessError(err));
        if (fromSearch) {
          void navigate({ to: "/evaluacion/acceso", search: {}, replace: true });
        }
      } finally {
        if (mountedRef.current && seq === attemptSeqRef.current) {
          setSubmitting(false);
        }
      }
    },
    [navigate, queryClient],
  );

  useEffect(() => {
    if (!searchCode) return;
    let cancelled = false;
    const seq = ++attemptSeqRef.current;
    void executeValidation(searchCode, seq, () => cancelled, true);
    return () => {
      cancelled = true;
    };
  }, [searchCode, executeValidation]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    clearPendingAccessError();
    const seq = ++attemptSeqRef.current;
    setError(null);
    setSubmitting(true);
    void executeValidation(codeInput, seq);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 md:p-6">
      <Card className="w-full max-w-md rounded-lg border border-border bg-card shadow-[var(--shadow-xs)]">
        <CardContent className="p-6 sm:p-8">
          <div className="flex justify-center mb-6">
            <Brand />
          </div>

          <h1 className="text-xl font-semibold tracking-tight text-foreground text-center">
            Acceso a Evaluación
          </h1>
          <p className="text-sm text-muted-foreground text-center mt-1.5 leading-relaxed">
            Ingrese el código de acceso personal que le brindó su aplicador para iniciar su sesión de pruebas.
          </p>

          {error && (
            <Alert
              role="alert"
              className="mt-4 border-status-danger-border bg-status-danger-bg text-status-danger-fg"
            >
              <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
              <AlertDescription className="text-status-danger-fg">{error}</AlertDescription>
            </Alert>
          )}

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="access-code" className="text-sm font-medium text-foreground">
                Código de acceso
              </Label>
              <div className="relative">
                <KeyRound
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  id="access-code"
                  name="code"
                  autoComplete="off"
                  placeholder="Ej. 123-ABCD"
                  value={codeInput}
                  disabled={submitting}
                  aria-invalid={error ? true : undefined}
                  onChange={(e) => {
                    clearPendingAccessError();
                    setCodeInput(e.target.value);
                    if (error) setError(null);
                  }}
                  className="h-12 pl-10 border-input bg-input-background font-mono text-base tracking-wider focus-visible:ring-[3px] focus-visible:ring-ring aria-invalid:border-status-danger-solid aria-invalid:ring-2 aria-invalid:ring-status-danger-bg"
                />
              </div>
            </div>

            <Button
              type="submit"
              className="w-full h-12 px-5 gap-2 focus-visible:ring-[3px] focus-visible:ring-ring"
              disabled={submitting}
            >
              {submitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Validando acceso...
                </>
              ) : (
                <>
                  Continuar
                  <ArrowRight className="size-4" aria-hidden="true" />
                </>
              )}
            </Button>
          </form>

          <div className="mt-6 text-center">
            <Button
              type="button"
              variant="link"
              className="text-xs text-muted-foreground hover:text-foreground gap-1 focus-visible:ring-[3px] focus-visible:ring-ring"
              onClick={() => void navigate({ to: "/login" })}
            >
              <ArrowLeft className="size-3.5" aria-hidden="true" />
              Volver al portal interno
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
