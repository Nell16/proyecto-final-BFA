import { useId, useMemo, useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  FilePlus2,
  Layers,
  Lock,
  SlidersHorizontal,
} from "lucide-react";

import { createSubtest, createTest, createVersion } from "../../../api/endpoints/instruments";
import type { TestInstrument, TestVersion } from "../../../api/schemas/instruments";
import { Alert, AlertDescription } from "../../../app/components/ui/alert";
import { Button } from "../../../app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../app/components/ui/dialog";
import { Input } from "../../../app/components/ui/input";
import { Label } from "../../../app/components/ui/label";
import { Switch } from "../../../app/components/ui/switch";
import { Textarea } from "../../../app/components/ui/textarea";
import { cn } from "../../../app/components/ui/utils";
import { captureAccountScope } from "../../../store/accountScope";
import { wizardKeys } from "../../sessions/wizard/wizard-queries";
import { useInstrumentPermissions } from "../permissions";
import { instrumentKeys, useScoringStrategies } from "../queries";

type WizardStep = 1 | 2 | 3;

const STEPS: readonly { id: WizardStep; title: string; subtitle: string; icon: typeof FilePlus2 }[] = [
  { id: 1, title: "Cabecera del test", subtitle: "Código y nombre", icon: FilePlus2 },
  { id: 2, title: "Primera versión", subtitle: "Parámetros base", icon: SlidersHorizontal },
  { id: 3, title: "Primer subtest", subtitle: "Inicio rápido", icon: Layers },
];

export interface NewTestWizardDialogProps {
  existingTests?: readonly TestInstrument[];
  onClose: () => void;
}

export function NewTestWizardDialog({ existingTests = [], onClose }: NewTestWizardDialogProps) {
  const formId = useId();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const permissions = useInstrumentPermissions();
  const strategies = useScoringStrategies();

  const [step, setStep] = useState<WizardStep>(1);

  // Paso 1: Cabecera del test
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  // Paso 2: Primera versión
  const [versionNumber, setVersionNumber] = useState("v1.0");
  const [timeLimitSeconds, setTimeLimitSeconds] = useState("");
  const [strategyId, setStrategyId] = useState<number | null>(null);
  const [strategyTouched, setStrategyTouched] = useState(false);
  const [randomizeSubtests, setRandomizeSubtests] = useState(false);
  const [randomizeItems, setRandomizeItems] = useState(false);
  const [instructions, setInstructions] = useState("");

  // Paso 3: Primer subtest opcional
  const [createInitialSubtest, setCreateInitialSubtest] = useState(true);
  const [subtestCode, setSubtestCode] = useState("SUB-1");
  const [subtestName, setSubtestName] = useState("");
  const [subtestTimeLimit, setSubtestTimeLimit] = useState("");
  const [subtestRequired, setSubtestRequired] = useState(true);
  const [subtestRandomizeOptions, setSubtestRandomizeOptions] = useState(false);

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [createdTest, setCreatedTest] = useState<TestInstrument | null>(null);
  const [createdVersion, setCreatedVersion] = useState<TestVersion | null>(null);

  // Refs para evitar duplicados si el usuario reintenta tras un fallo en paso 2 o 3
  const createdTestRef = useRef<TestInstrument | null>(null);
  const createdVersionRef = useRef<TestVersion | null>(null);
  const submittingRef = useRef(false);

  const defaultStrategy = useMemo(
    () =>
      strategies.data?.find((entry) => entry.active && entry.strategyType === "CLAVE_SIMPLE") ??
      strategies.data?.find((entry) => entry.active) ??
      null,
    [strategies.data],
  );

  const effectiveStrategyId = strategyTouched
    ? strategyId
    : (strategyId ?? defaultStrategy?.id ?? null);

  const normalizedCode = code.trim().toUpperCase();
  const duplicateTestCode =
    normalizedCode.length > 0 &&
    existingTests.some((entry) => entry.code.trim().toUpperCase() === normalizedCode);

  const parsedVersionTime =
    timeLimitSeconds.trim() === "" ? null : Number.parseInt(timeLimitSeconds.trim(), 10);
  const versionTimeInvalid =
    timeLimitSeconds.trim() !== "" &&
    (!Number.isFinite(parsedVersionTime) || (parsedVersionTime ?? 0) <= 0);

  const parsedSubtestTime =
    subtestTimeLimit.trim() === "" ? null : Number.parseInt(subtestTimeLimit.trim(), 10);
  const subtestTimeInvalid =
    createInitialSubtest &&
    subtestTimeLimit.trim() !== "" &&
    (!Number.isFinite(parsedSubtestTime) || (parsedSubtestTime ?? 0) <= 0);

  const step1Valid = code.trim().length > 0 && name.trim().length > 0 && !duplicateTestCode;
  const step2Valid = versionNumber.trim().length > 0 && !versionTimeInvalid;
  const step3Valid =
    !createInitialSubtest ||
    (subtestCode.trim().length > 0 && subtestName.trim().length > 0 && !subtestTimeInvalid);

  const canGoNext = step === 1 ? step1Valid : step === 2 ? step2Valid : step3Valid;

  const selectedStrategy =
    strategies.data?.find((entry) => entry.id === effectiveStrategyId) ?? null;

  async function handleFinish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step < 3) {
      if (canGoNext) {
        setError(undefined);
        setStep((prev) => (prev === 1 ? 2 : 3));
      }
      return;
    }

    if (submittingRef.current || !step1Valid || !step2Valid || !step3Valid) return;
    submittingRef.current = true;
    setPending(true);
    setError(undefined);
    const scope = captureAccountScope();

    try {
      let test = createdTestRef.current;
      if (!test) {
        test = await createTest({
          code: code.trim(),
          name: name.trim(),
          description: description.trim() || null,
        });
        createdTestRef.current = test;
        if (scope.isCurrent()) {
          setCreatedTest(test);
          queryClient.setQueryData<TestInstrument[]>(instrumentKeys.tests(), (previous) => [
            ...(previous ?? []).filter((entry) => entry.id !== test!.id),
            test!,
          ]);
          void queryClient.invalidateQueries({ queryKey: wizardKeys.tests() });
          void queryClient.invalidateQueries({ queryKey: instrumentKeys.tests() });
        }
      }

      let version = createdVersionRef.current;
      if (!version) {
        version = await createVersion(test.id, {
          number: versionNumber.trim(),
          strategyId: permissions.canConfigureScoring
            ? effectiveStrategyId
            : (defaultStrategy?.id ?? null),
          instructions: instructions.trim() || null,
          timeLimitSeconds: parsedVersionTime,
          randomizeSubtests,
          randomizeItems,
        });
        createdVersionRef.current = version;
        if (scope.isCurrent()) {
          setCreatedVersion(version);
          queryClient.setQueryData<TestVersion[]>(instrumentKeys.versions(test.id), (previous) => [
            ...(previous ?? []).filter((entry) => entry.id !== version!.id),
            version!,
          ]);
          void queryClient.invalidateQueries({ queryKey: instrumentKeys.versions(test.id) });
        }
      }

      if (createInitialSubtest) {
        await createSubtest(version.id, {
          code: subtestCode.trim(),
          name: subtestName.trim(),
          description: null,
          instructions: null,
          order: 1,
          timeLimitSeconds: parsedSubtestTime,
          randomizeItems: false,
          randomizeOptions: subtestRandomizeOptions,
          required: subtestRequired,
          strategyId: null,
        });
      }

      if (scope.isCurrent()) {
        onClose();
        void navigate({
          to: "/app/instrumentos/$versionId",
          params: { versionId: String(test.id) },
          search: {
            revision: version.id,
            ...(createInitialSubtest ? { focus: "subtest" as const } : {}),
          },
        });
      }
    } catch (cause) {
      if (scope.isCurrent()) {
        const baseMessage =
          cause instanceof Error ? cause.message : "No se pudo completar la creación del test.";
        const partialHint = createdVersionRef.current
          ? " El test y la versión ya fueron creados; puedes reintentar el subtest inicial o continuar sin él."
          : createdTestRef.current
            ? " El test ya fue creado; puedes reintentar la creación de la versión."
            : "";
        setError(`${baseMessage}${partialHint}`);
      }
    } finally {
      submittingRef.current = false;
      if (scope.isCurrent()) {
        setPending(false);
      }
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Crear nuevo test</DialogTitle>
          <DialogDescription>
            Inicializa la cabecera, su primera versión y opcionalmente el primer subtest antes de
            entrar al editor.
          </DialogDescription>
        </DialogHeader>

        {/* Stepper horizontal compacto */}
        <nav aria-label="Pasos de creación" className="grid grid-cols-3 gap-2">
          {STEPS.map((entry) => {
            const Icon = entry.icon;
            const isCurrent = step === entry.id;
            const isCompleted = step > entry.id;
            const clickable = !pending && (isCompleted || (entry.id === 2 && step1Valid) || (entry.id === 3 && step1Valid && step2Valid));

            return (
              <button
                key={entry.id}
                type="button"
                disabled={!clickable}
                onClick={() => {
                  if (clickable) {
                    setError(undefined);
                    setStep(entry.id);
                  }
                }}
                aria-current={isCurrent ? "step" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors",
                  isCurrent
                    ? "border-primary bg-accent text-accent-foreground"
                    : isCompleted
                      ? "border-status-success-border bg-status-success-bg/50 text-foreground hover:bg-status-success-bg"
                      : "border-border bg-muted/30 text-muted-foreground",
                  !clickable && !isCurrent && "cursor-default opacity-70",
                )}
              >
                <span
                  className={cn(
                    "inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
                    isCurrent
                      ? "bg-primary text-primary-foreground"
                      : isCompleted
                        ? "bg-status-success-solid text-white"
                        : "bg-muted text-muted-foreground",
                  )}
                >
                  {isCompleted ? <Check className="size-3.5" aria-hidden="true" /> : entry.id}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1 truncate text-xs font-semibold">
                    <Icon className="size-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">{entry.title}</span>
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {entry.subtitle}
                  </span>
                </span>
              </button>
            );
          })}
        </nav>

        <form onSubmit={(event) => void handleFinish(event)} className="space-y-4">
          {step === 1 && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
                <div className="space-y-1.5 sm:col-span-4">
                  <Label htmlFor={`${formId}-code`}>
                    Código <span className="text-status-danger-fg">*</span>
                  </Label>
                  <Input
                    id={`${formId}-code`}
                    value={code}
                    disabled={pending || createdTest !== null}
                    placeholder="Ej. WEILL"
                    aria-invalid={duplicateTestCode || undefined}
                    className="font-mono"
                    onChange={(event) => setCode(event.target.value)}
                    required
                  />
                  {duplicateTestCode && (
                    <p role="alert" className="text-xs text-status-danger-fg">
                      Ya existe un test con este código.
                    </p>
                  )}
                </div>

                <div className="space-y-1.5 sm:col-span-8">
                  <Label htmlFor={`${formId}-name`}>
                    Nombre del test <span className="text-status-danger-fg">*</span>
                  </Label>
                  <Input
                    id={`${formId}-name`}
                    value={name}
                    disabled={pending || createdTest !== null}
                    placeholder="Ej. Test de inteligencia de Weill"
                    onChange={(event) => setName(event.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor={`${formId}-description`}>Descripción</Label>
                <Textarea
                  id={`${formId}-description`}
                  rows={2}
                  value={description}
                  disabled={pending || createdTest !== null}
                  placeholder="Objetivo clínico, población objetivo o notas de referencia (opcional)..."
                  onChange={(event) => setDescription(event.target.value)}
                />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
                <div className="space-y-1.5 sm:col-span-3">
                  <Label htmlFor={`${formId}-version-number`}>
                    Versión <span className="text-status-danger-fg">*</span>
                  </Label>
                  <Input
                    id={`${formId}-version-number`}
                    value={versionNumber}
                    disabled={pending || createdVersion !== null}
                    placeholder="v1.0"
                    className="font-mono"
                    onChange={(event) => setVersionNumber(event.target.value)}
                    required
                  />
                </div>

                <div className="space-y-1.5 sm:col-span-4">
                  <Label htmlFor={`${formId}-version-time`}>Tiempo límite global (s)</Label>
                  <Input
                    id={`${formId}-version-time`}
                    type="number"
                    min={1}
                    step={1}
                    value={timeLimitSeconds}
                    disabled={pending || createdVersion !== null}
                    placeholder="Sin límite"
                    aria-invalid={versionTimeInvalid || undefined}
                    className="tabular-nums"
                    onChange={(event) => setTimeLimitSeconds(event.target.value)}
                  />
                  {versionTimeInvalid && (
                    <p role="alert" className="text-xs text-status-danger-fg">
                      Debe ser mayor que 0.
                    </p>
                  )}
                </div>

                <div className="space-y-1.5 sm:col-span-5">
                  <Label htmlFor={`${formId}-strategy`}>Estrategia de calificación</Label>
                  {!permissions.canConfigureScoring ? (
                    <div className="flex h-9 items-center justify-between rounded-md border border-border bg-muted px-3 text-xs text-muted-foreground">
                      <span className="truncate">Predeterminada</span>
                      <Lock className="size-3.5 shrink-0" aria-hidden="true" />
                    </div>
                  ) : (
                    <select
                      id={`${formId}-strategy`}
                      value={effectiveStrategyId === null ? "" : String(effectiveStrategyId)}
                      disabled={pending || strategies.isLoading || createdVersion !== null}
                      onChange={(event) => {
                        setStrategyTouched(true);
                        const raw = event.target.value;
                        setStrategyId(raw === "" ? null : Number(raw));
                      }}
                      className="border-input bg-input-background text-foreground focus-visible:border-ring focus-visible:ring-ring/50 flex h-9 w-full rounded-md border px-3 py-1 text-sm outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <option value="">
                        {strategies.isLoading ? "Cargando..." : "Seleccionar más tarde"}
                      </option>
                      {(strategies.data ?? []).map((entry) => (
                        <option key={entry.id} value={String(entry.id)}>
                          {entry.name} ({entry.code})
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2">
                  <div className="space-y-0.5">
                    <Label htmlFor={`${formId}-rand-subtests`} className="text-xs font-medium">
                      Aleatorizar subtests
                    </Label>
                    <p className="text-xs text-muted-foreground">Orden distinto por participante.</p>
                  </div>
                  <Switch
                    id={`${formId}-rand-subtests`}
                    checked={randomizeSubtests}
                    disabled={pending || createdVersion !== null}
                    onCheckedChange={setRandomizeSubtests}
                  />
                </div>

                <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2">
                  <div className="space-y-0.5">
                    <Label htmlFor={`${formId}-rand-items`} className="text-xs font-medium">
                      Aleatorizar ítems
                    </Label>
                    <p className="text-xs text-muted-foreground">Habilita barajar ítems por subtest.</p>
                  </div>
                  <Switch
                    id={`${formId}-rand-items`}
                    checked={randomizeItems}
                    disabled={pending || createdVersion !== null}
                    onCheckedChange={setRandomizeItems}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor={`${formId}-instructions`}>Instrucciones generales</Label>
                <Textarea
                  id={`${formId}-instructions`}
                  rows={2}
                  value={instructions}
                  disabled={pending || createdVersion !== null}
                  placeholder="Indicaciones iniciales que verá el participante (opcional)..."
                  onChange={(event) => setInstructions(event.target.value)}
                />
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-3.5 py-2.5">
                <div className="space-y-0.5">
                  <Label htmlFor={`${formId}-init-subtest`} className="text-sm font-medium">
                    Crear primer subtest al inicializar
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Te lleva directo al editor del subtest para empezar a añadir ítems y respuestas.
                  </p>
                </div>
                <Switch
                  id={`${formId}-init-subtest`}
                  checked={createInitialSubtest}
                  disabled={pending}
                  onCheckedChange={setCreateInitialSubtest}
                />
              </div>

              {createInitialSubtest && (
                <div className="space-y-3 rounded-lg border border-border bg-card p-3.5">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
                    <div className="space-y-1.5 sm:col-span-3">
                      <Label htmlFor={`${formId}-sub-code`}>
                        Código <span className="text-status-danger-fg">*</span>
                      </Label>
                      <Input
                        id={`${formId}-sub-code`}
                        value={subtestCode}
                        disabled={pending}
                        placeholder="SUB-1"
                        className="font-mono"
                        onChange={(event) => setSubtestCode(event.target.value)}
                        required
                      />
                    </div>

                    <div className="space-y-1.5 sm:col-span-6">
                      <Label htmlFor={`${formId}-sub-name`}>
                        Nombre del subtest <span className="text-status-danger-fg">*</span>
                      </Label>
                      <Input
                        id={`${formId}-sub-name`}
                        value={subtestName}
                        disabled={pending}
                        placeholder="Ej. Razonamiento verbal"
                        onChange={(event) => setSubtestName(event.target.value)}
                        required
                      />
                    </div>

                    <div className="space-y-1.5 sm:col-span-3">
                      <Label htmlFor={`${formId}-sub-time`}>Tiempo (s)</Label>
                      <Input
                        id={`${formId}-sub-time`}
                        type="number"
                        min={1}
                        step={1}
                        value={subtestTimeLimit}
                        disabled={pending}
                        placeholder="Sin límite"
                        aria-invalid={subtestTimeInvalid || undefined}
                        className="tabular-nums"
                        onChange={(event) => setSubtestTimeLimit(event.target.value)}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2">
                      <Label htmlFor={`${formId}-sub-req`} className="text-xs font-medium">
                        Subtest obligatorio
                      </Label>
                      <Switch
                        id={`${formId}-sub-req`}
                        checked={subtestRequired}
                        disabled={pending}
                        onCheckedChange={setSubtestRequired}
                      />
                    </div>

                    <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2">
                      <Label htmlFor={`${formId}-sub-rand-opt`} className="text-xs font-medium">
                        Aleatorizar opciones
                      </Label>
                      <Switch
                        id={`${formId}-sub-rand-opt`}
                        checked={subtestRandomizeOptions}
                        disabled={pending}
                        onCheckedChange={setSubtestRandomizeOptions}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Resumen compacto */}
              <div className="rounded-lg border border-border bg-muted/30 px-3.5 py-2.5 text-xs">
                <p className="mb-1.5 flex items-center gap-1.5 font-semibold text-foreground">
                  <CheckCircle2 className="size-3.5 text-status-success-fg" aria-hidden="true" />
                  Resumen de inicialización
                </p>
                <div className="grid grid-cols-1 gap-1.5 text-muted-foreground sm:grid-cols-3">
                  <div className="truncate">
                    <span className="font-medium text-foreground">Test:</span>{" "}
                    <span className="font-mono">{code.trim()}</span> · {name.trim()}
                  </div>
                  <div className="truncate">
                    <span className="font-medium text-foreground">Versión:</span>{" "}
                    <span className="font-mono">{versionNumber.trim()}</span>
                    {selectedStrategy ? ` · ${selectedStrategy.name}` : ""}
                  </div>
                  <div className="truncate">
                    <span className="font-medium text-foreground">Subtest:</span>{" "}
                    {createInitialSubtest
                      ? `${subtestCode.trim()} · ${subtestName.trim() || "Pendiente"}`
                      : "Se añadirá en el editor"}
                  </div>
                </div>
              </div>
            </div>
          )}

          {error && (
            <Alert
              role="alert"
              className="border-status-danger-border bg-status-danger-bg text-status-danger-fg"
            >
              <AlertCircle className="size-4" aria-hidden="true" />
              <AlertDescription className="text-xs text-status-danger-fg">{error}</AlertDescription>
            </Alert>
          )}

          <DialogFooter className="flex-row items-center justify-between gap-2 sm:justify-between">
            <div>
              {step > 1 ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending}
                  onClick={() => {
                    setError(undefined);
                    setStep((prev) => (prev === 3 ? 2 : 1));
                  }}
                >
                  <ArrowLeft className="size-4" aria-hidden="true" />
                  <span>Atrás</span>
                </Button>
              ) : (
                <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
                  Cancelar
                </Button>
              )}
            </div>

            <div className="flex items-center gap-2">
              {step > 1 && (
                <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
                  Cancelar
                </Button>
              )}
              {step < 3 ? (
                <Button type="submit" disabled={pending || !canGoNext}>
                  <span>Continuar</span>
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Button>
              ) : (
                <Button type="submit" disabled={pending || !step1Valid || !step2Valid || !step3Valid}>
                  {pending ? "Inicializando…" : "Crear e ir al editor"}
                </Button>
              )}
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
