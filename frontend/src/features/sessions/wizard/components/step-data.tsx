import { useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import type { Session } from "../../../../api/schemas/sessions";
import { Button } from "../../../../app/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../../app/components/ui/card";
import { Input } from "../../../../app/components/ui/input";
import { Skeleton } from "../../../../app/components/ui/skeleton";
import { StatusBadge } from "../../../../app/components/ui/status-badge";
import { Textarea } from "../../../../app/components/ui/textarea";
import { captureAccountScope, isAccountChangedError } from "../../../../store/accountScope";
import { useCreateSession } from "../../mutations";
import { sessionKeys } from "../../queries";
import { formatDateTime } from "../format";
import {
  generateSessionCode,
  randomCodeSuffix,
  sessionDataSchema,
  todayIsoDate,
  toCreateSessionRequest,
  type SessionDataValues,
} from "../schemas";
import type { InstrumentInfo } from "../types";
import {
  NO_TEST_PERMISSION_MESSAGE,
  errorMessage,
  isForbidden,
  wizardTestsQuery,
  wizardVersionsQuery,
} from "../wizard-queries";
import { Field, InlineAlert, NativeSelect } from "./form-bits";

export type SessionDraft = Partial<SessionDataValues>;

interface StepDataProps {
  /** Si la sesión ya existe (PROGRAMADA en el servidor) el paso es de solo lectura. */
  session: Session | null;
  instrument: InstrumentInfo | null;
  draft: SessionDraft | null;
  onDraftChange: (values: SessionDraft) => void;
  onCreated: (session: Session, instrument: InstrumentInfo) => void;
  onContinue: () => void;
}

export function StepData(props: StepDataProps) {
  if (props.session) {
    return <StepDataReadOnly session={props.session} instrument={props.instrument} onContinue={props.onContinue} />;
  }
  return <StepDataForm {...props} />;
}

function StepDataReadOnly({
  session,
  instrument,
  onContinue,
}: {
  session: Session;
  instrument: InstrumentInfo | null;
  onContinue: () => void;
}) {
  const rows: Array<[string, React.ReactNode]> = [
    ["Nombre", session.name],
    ["Código", <span className="font-mono">{session.code}</span>],
    ["Inicio programado", formatDateTime(session.scheduledStart)],
    ["Fin programado", formatDateTime(session.scheduledEnd)],
    ["Ubicación", session.location ?? "—"],
    ["Descripción", session.description ?? "—"],
    [
      "Instrumento",
      instrument ? `${instrument.testName} · versión ${instrument.versionNumber}` : `Versión #${session.versionTestId}`,
    ],
  ];
  return (
    <div className="space-y-4">
      <InlineAlert tone="info" title="La sesión ya fue creada">
        Quedó guardada como programada. Sus datos e instrumento no se pueden modificar desde este asistente.
      </InlineAlert>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Datos de la sesión</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            {rows.map(([label, value]) => (
              <div key={label} className="space-y-0.5">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="text-foreground">{value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
      <div className="flex justify-end">
        <Button type="button" onClick={onContinue}>
          Continuar
        </Button>
      </div>
    </div>
  );
}

function StepDataForm({ draft, onDraftChange, onCreated }: StepDataProps) {
  const qc = useQueryClient();
  const createSession = useCreateSession();
  const [suffix, setSuffix] = useState(randomCodeSuffix);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [codeEdited, setCodeEdited] = useState(draft?.code !== undefined);

  const form = useForm<SessionDataValues>({
    resolver: zodResolver(sessionDataSchema),
    mode: "onTouched",
    defaultValues: {
      name: "",
      date: todayIsoDate(),
      startTime: "",
      endTime: "",
      location: "",
      description: "",
      testId: "",
      versionId: "",
      ...draft,
      code: draft?.code ?? generateSessionCode(draft?.date ?? todayIsoDate(), suffix),
    },
  });
  const { register, handleSubmit, setValue, getValues, setError, control, formState } = form;
  const { errors } = formState;

  const testId = useWatch({ control, name: "testId" });
  const versionId = useWatch({ control, name: "versionId" });

  // El borrador vive en el wizard para no perder lo escrito al ir y volver entre pasos.
  const watchedValues = useWatch({ control });
  useEffect(() => {
    onDraftChange(watchedValues as SessionDraft);
  }, [watchedValues, onDraftChange]);

  const testsQuery = useQuery(wizardTestsQuery());
  const numericTestId = testId ? Number(testId) : null;
  const versionsQuery = useQuery({
    ...wizardVersionsQuery(numericTestId ?? 0),
    enabled: numericTestId !== null,
  });
  const versions = versionsQuery.data ?? [];
  const publishedCount = versions.filter((v) => v.status === "PUBLICADO").length;

  const testField = register("testId", { onChange: () => setValue("versionId", "") });
  const codeField = register("code", {
    onChange: () => {
      setCodeEdited(true);
    },
  });
  const dateField = register("date", {
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
      if (!codeEdited) {
        setValue("code", generateSessionCode(event.target.value, suffix), { shouldValidate: true });
      }
    },
  });

  const regenerateCode = () => {
    const next = randomCodeSuffix();
    setSuffix(next);
    setCodeEdited(false);
    setValue("code", generateSessionCode(getValues("date"), next), { shouldValidate: true, shouldDirty: true });
  };

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(null);
    const version = versions.find((v) => String(v.id) === values.versionId);
    if (!version || version.status !== "PUBLICADO") {
      setError("versionId", { message: "Seleccione una versión publicada." });
      return;
    }
    const test = testsQuery.data?.find((t) => String(t.id) === values.testId);
    const scope = captureAccountScope();
    try {
      const created = await createSession.mutateAsync(toCreateSessionRequest(values));
      // Cambió la cuenta de staff durante la creación: no se escribe caché, ni se avisa ni se navega.
      if (!scope.isCurrent()) return;
      qc.setQueryData(sessionKeys.detail(created.id), created);
      qc.setQueryData(sessionKeys.assignments(created.id), []);
      toast.success(`Sesión ${created.code} creada como programada.`);
      onCreated(created, {
        testId: Number(values.testId),
        testName: test?.name ?? `Test #${values.testId}`,
        versionId: version.id,
        versionNumber: version.number,
        versionStatus: version.status,
        allowRandomizeItems: version.randomizeItems,
      });
    } catch (error) {
      if (isAccountChangedError(error) || !scope.isCurrent()) return;
      const message = errorMessage(error, "No se pudo crear la sesión.");
      setSubmitError(message);
      toast.error(message);
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6" aria-label="Datos de la sesión">
      {submitError && (
        <InlineAlert tone="danger" title="No se pudo crear la sesión">
          {submitError}
        </InlineAlert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Datos de la sesión</CardTitle>
          <CardDescription>Al continuar, la sesión se guarda como programada y podrá reanudarla si recarga la página.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field id="session-name" label="Nombre" required error={errors.name?.message} className="sm:col-span-2">
            <Input
              id="session-name"
              autoComplete="off"
              aria-invalid={!!errors.name}
              aria-describedby={errors.name ? "session-name-error" : undefined}
              {...register("name")}
            />
          </Field>

          <Field
            id="session-code"
            label="Código"
            required
            error={errors.code?.message}
            help="Se genera automáticamente; puede editarlo."
          >
            <div className="flex gap-2">
              <Input
                id="session-code"
                autoComplete="off"
                className="font-mono"
                aria-invalid={!!errors.code}
                aria-describedby={errors.code ? "session-code-error" : "session-code-help"}
                {...codeField}
              />
              <Button type="button" variant="outline" size="icon" onClick={regenerateCode} aria-label="Generar código nuevo">
                <RefreshCw aria-hidden="true" className="size-4" />
              </Button>
            </div>
          </Field>

          <Field id="session-date" label="Fecha" required error={errors.date?.message}>
            <Input
              id="session-date"
              type="date"
              aria-invalid={!!errors.date}
              aria-describedby={errors.date ? "session-date-error" : undefined}
              {...dateField}
            />
          </Field>

          <Field id="session-start" label="Hora de inicio" required error={errors.startTime?.message}>
            <Input
              id="session-start"
              type="time"
              aria-invalid={!!errors.startTime}
              aria-describedby={errors.startTime ? "session-start-error" : undefined}
              {...register("startTime", { deps: ["endTime"] })}
            />
          </Field>

          <Field id="session-end" label="Hora de fin" required error={errors.endTime?.message}>
            <Input
              id="session-end"
              type="time"
              aria-invalid={!!errors.endTime}
              aria-describedby={errors.endTime ? "session-end-error" : undefined}
              {...register("endTime")}
            />
          </Field>

          <Field id="session-location" label="Ubicación" error={errors.location?.message} className="sm:col-span-2">
            <Input id="session-location" autoComplete="off" {...register("location")} />
          </Field>

          <Field id="session-description" label="Descripción" error={errors.description?.message} className="sm:col-span-2">
            <Textarea id="session-description" rows={3} {...register("description")} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Instrumento</CardTitle>
          <CardDescription>
            Solo se pueden aplicar versiones publicadas. La versión no podrá cambiarse una vez creada la sesión.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {testsQuery.isPending ? (
            <Skeleton className="h-9 w-full" />
          ) : testsQuery.isError ? (
            isForbidden(testsQuery.error) ? (
              <InlineAlert tone="danger" title="Sin permiso para ver instrumentos">
                {NO_TEST_PERMISSION_MESSAGE}
              </InlineAlert>
            ) : (
              <InlineAlert
                tone="danger"
                title="No se pudieron cargar los instrumentos"
                action={
                  <Button type="button" variant="outline" size="sm" onClick={() => void testsQuery.refetch()}>
                    Reintentar
                  </Button>
                }
              >
                {errorMessage(testsQuery.error, "Ocurrió un error al consultar los instrumentos.")}
              </InlineAlert>
            )
          ) : (
            <>
              <Field id="session-test" label="Instrumento (test)" required error={errors.testId?.message}>
                <NativeSelect
                  id="session-test"
                  aria-invalid={!!errors.testId}
                  aria-describedby={errors.testId ? "session-test-error" : undefined}
                  {...testField}
                >
                  <option value="">Seleccione un instrumento…</option>
                  {testsQuery.data.map((test) => (
                    <option key={test.id} value={String(test.id)}>
                      {test.name} ({test.code})
                    </option>
                  ))}
                </NativeSelect>
              </Field>

              {numericTestId !== null && (
                <fieldset className="space-y-2" aria-describedby={errors.versionId ? "session-version-error" : undefined}>
                  <legend className="text-sm font-medium">
                    Versión <span aria-hidden="true" className="text-danger-foreground">*</span>
                  </legend>
                  {versionsQuery.isPending ? (
                    <Skeleton className="h-16 w-full" />
                  ) : versionsQuery.isError ? (
                    isForbidden(versionsQuery.error) ? (
                      <InlineAlert tone="danger">{NO_TEST_PERMISSION_MESSAGE}</InlineAlert>
                    ) : (
                      <InlineAlert
                        tone="danger"
                        title="No se pudieron cargar las versiones"
                        action={
                          <Button type="button" variant="outline" size="sm" onClick={() => void versionsQuery.refetch()}>
                            Reintentar
                          </Button>
                        }
                      >
                        {errorMessage(versionsQuery.error, "Ocurrió un error al consultar las versiones.")}
                      </InlineAlert>
                    )
                  ) : versions.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Este instrumento todavía no tiene versiones.</p>
                  ) : (
                    <>
                      <ul className="grid gap-2 sm:grid-cols-2">
                        {versions.map((version) => {
                          const published = version.status === "PUBLICADO";
                          const inputId = `session-version-${version.id}`;
                          return (
                            <li key={version.id}>
                              <label
                                htmlFor={inputId}
                                className={
                                  "flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm " +
                                  (published
                                    ? "cursor-pointer border-border bg-card hover:bg-muted/40 has-[:checked]:border-primary has-[:checked]:bg-accent"
                                    : "cursor-not-allowed border-border bg-muted/40 text-muted-foreground")
                                }
                              >
                                <input
                                  id={inputId}
                                  type="radio"
                                  value={String(version.id)}
                                  disabled={!published}
                                  checked={versionId === String(version.id)}
                                  className="size-4 accent-primary"
                                  {...register("versionId")}
                                />
                                <span className="flex-1 font-medium">Versión {version.number}</span>
                                <StatusBadge domain="version" status={version.status} />
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                      {publishedCount === 0 && (
                        <InlineAlert tone="warning">
                          Este instrumento no tiene versiones publicadas. Publique una versión para poder aplicarla.
                        </InlineAlert>
                      )}
                    </>
                  )}
                  {errors.versionId?.message && (
                    <p id="session-version-error" className="text-xs text-danger-foreground">
                      {errors.versionId.message}
                    </p>
                  )}
                </fieldset>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" disabled={createSession.isPending}>
          {createSession.isPending ? "Creando sesión…" : "Crear sesión y continuar"}
        </Button>
      </div>
    </form>
  );
}
