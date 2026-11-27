import { useMemo, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { TestVersion } from "../../../api/schemas/instruments";
import { Alert, AlertDescription, AlertTitle } from "../../../app/components/ui/alert";
import { Button } from "../../../app/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "../../../app/components/ui/dialog";
import { Input } from "../../../app/components/ui/input";
import { captureAccountScope } from "../../../store/accountScope";
import {
  getVersionClonePlanSignature,
  IncompleteVersionCloneError,
  inspectVersionClonePlan,
  type VersionClonePlan,
} from "../document/adapters";
import { useCloneVersion, useCreateVersion } from "../mutations";
import { useInstrumentPermissions } from "../permissions";
import { instrumentKeys, useScoringStrategies } from "../queries";

interface ConfirmedClonePlanSnapshot {
  signature: string;
  omittedItems: Map<string, string>;
  omittedAnswerKeyCount: number;
}

function collectOmittedItemsMap(
  plan: VersionClonePlan | undefined,
  options: {
    copyBaremos: boolean;
    canConfigureScoring: boolean;
    canConfigureBaremos: boolean;
  },
): { omittedItems: Map<string, string>; omittedAnswerKeyCount: number } {
  const omittedItems = new Map<string, string>();
  if (!plan) return { omittedItems, omittedAnswerKeyCount: 0 };

  if (options.canConfigureScoring) {
    for (const item of plan.omittedRules) {
      omittedItems.set(
        `rule:${item.rule.id}`,
        `Regla ${item.rule.ruleType} (prioridad ${item.rule.priority}) en ${item.subtestName || item.subtestCode}`,
      );
    }
  }
  if (options.canConfigureBaremos && options.copyBaremos) {
    for (const item of plan.omittedBaremos) {
      omittedItems.set(
        `baremo:${item.baremo.code.trim().toUpperCase()}`,
        `Baremo ${item.baremo.name || item.baremo.code} (${item.baremo.code})`,
      );
    }
  }
  const omittedAnswerKeyCount = options.canConfigureScoring ? plan.omittedAnswerKeyCount : 0;
  return { omittedItems, omittedAnswerKeyCount };
}

function describeClonePlanDifference(
  confirmed: ConfirmedClonePlanSnapshot,
  currentPlan: VersionClonePlan | undefined,
  options: {
    copyBaremos: boolean;
    canConfigureScoring: boolean;
    canConfigureBaremos: boolean;
  },
): string[] {
  const current = collectOmittedItemsMap(currentPlan, options);
  const diffs: string[] = [];

  for (const [key, label] of current.omittedItems.entries()) {
    if (!confirmed.omittedItems.has(key)) {
      diffs.push(`Nuevo elemento omitido: ${label}.`);
    }
  }
  for (const [key, label] of confirmed.omittedItems.entries()) {
    if (!current.omittedItems.has(key)) {
      diffs.push(`Ya no se omite: ${label}.`);
    }
  }
  if (current.omittedAnswerKeyCount !== confirmed.omittedAnswerKeyCount) {
    diffs.push(
      `Claves de respuesta omitidas: ${confirmed.omittedAnswerKeyCount} → ${current.omittedAnswerKeyCount}.`,
    );
  }
  if (diffs.length === 0) {
    diffs.push("Cambió la configuración copiable (reglas o baremos) de la versión origen.");
  }
  return diffs;
}

export function NewVersionDialog({ testId, source, versions, onClose, onCreated }: {
  testId: number;
  source?: TestVersion;
  versions: readonly TestVersion[];
  onClose: () => void;
  onCreated: (version: TestVersion, warnings?: string[]) => void;
}) {
  const [number, setNumber] = useState(versions.length ? "" : "v1.0");
  const [timeLimitSeconds, setTimeLimitSeconds] = useState("");
  const [selectedStrategyId, setSelectedStrategyId] = useState<number | null>(null);
  const [strategyTouched, setStrategyTouched] = useState(false);
  const [copyBaremos, setCopyBaremos] = useState(true);
  const [confirmedSnapshot, setConfirmedSnapshot] = useState<ConfirmedClonePlanSnapshot>();
  const [planChangedNotice, setPlanChangedNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const queryClient = useQueryClient();
  const permissions = useInstrumentPermissions();
  const strategies = useScoringStrategies();
  const create = useCreateVersion(testId);
  const clone = useCloneVersion(testId);
  const submitting = useRef(false);
  const duplicate = versions.some((version) => version.number.trim().toUpperCase() === number.trim().toUpperCase());
  const defaultStrategy = strategies.data?.find((strategy) => strategy.active && strategy.strategyType === "CLAVE_SIMPLE");
  const resolvedBlankStrategyId = strategyTouched ? selectedStrategyId : (selectedStrategyId ?? defaultStrategy?.id ?? null);
  const targetStrategyId = source ? (source.strategyId ?? defaultStrategy?.id ?? null) : resolvedBlankStrategyId;
  const parsedTimeLimit = timeLimitSeconds.trim() === "" ? null : Number.parseInt(timeLimitSeconds.trim(), 10);
  const invalidTimeLimit =
    !source &&
    timeLimitSeconds.trim() !== "" &&
    (!Number.isFinite(parsedTimeLimit) || (parsedTimeLimit ?? 0) <= 0);
  const clonePlanQueryKey = [...instrumentKeys.clonePlan(source?.id ?? 0), targetStrategyId] as const;

  const clonePlan = useQuery({
    queryKey: clonePlanQueryKey,
    queryFn: () =>
      inspectVersionClonePlan(testId, source!.id, {
        targetStrategyId,
        scope: captureAccountScope(),
      }),
    enabled: Boolean(source),
  });

  const omittedRules =
    source && permissions.canConfigureScoring ? (clonePlan.data?.omittedRules ?? []) : [];
  const omittedAnswerKeyCount =
    source && permissions.canConfigureScoring ? (clonePlan.data?.omittedAnswerKeyCount ?? 0) : 0;
  const omittedBaremos =
    source && permissions.canConfigureBaremos && copyBaremos
      ? (clonePlan.data?.omittedBaremos ?? [])
      : [];
  const hasOmissions =
    omittedRules.length > 0 || omittedAnswerKeyCount > 0 || omittedBaremos.length > 0;

  const signatureOptions = useMemo(
    () => ({
      copyBaremos,
      canConfigureScoring: permissions.canConfigureScoring,
      canConfigureBaremos: permissions.canConfigureBaremos,
    }),
    [copyBaremos, permissions.canConfigureScoring, permissions.canConfigureBaremos],
  );

  const displayedPlanSignature = useMemo(
    () =>
      clonePlan.data
        ? getVersionClonePlanSignature(clonePlan.data, signatureOptions)
        : undefined,
    [clonePlan.data, signatureOptions],
  );

  const confirmedSignature = confirmedSnapshot?.signature;
  const confirmOmissions =
    Boolean(displayedPlanSignature) && confirmedSignature === displayedPlanSignature;
  const staleConfirmationDiffs = useMemo(() => {
    if (!confirmedSnapshot || !displayedPlanSignature || confirmedSnapshot.signature === displayedPlanSignature) {
      return [];
    }
    return describeClonePlanDifference(confirmedSnapshot, clonePlan.data, signatureOptions);
  }, [confirmedSnapshot, displayedPlanSignature, clonePlan.data, signatureOptions]);

  const inspectingClone = Boolean(source) && clonePlan.isPending;
  const cloneInspectionFailed = Boolean(source) && clonePlan.isError;
  const pending = create.isPending || clone.isPending;
  const submitDisabled =
    pending ||
    duplicate ||
    invalidTimeLimit ||
    !number.trim() ||
    inspectingClone ||
    cloneInspectionFailed ||
    (hasOmissions && !confirmOmissions);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!permissions.canEdit || submitting.current || submitDisabled) return;
    if (source && hasOmissions && (!confirmedSignature || confirmedSignature !== displayedPlanSignature)) {
      return;
    }
    const scope = captureAccountScope();
    const payload = {
      number: number.trim(),
      strategyId: targetStrategyId,
      instructions: source?.instructions,
      timeLimitSeconds: source ? source.timeLimitSeconds : parsedTimeLimit,
      randomizeItems: source?.randomizeItems ?? false,
      randomizeSubtests: source?.randomizeSubtests ?? false,
    };
    submitting.current = true;
    setError(undefined);
    setPlanChangedNotice(undefined);
    try {
      if (source) {
        const expectedPlanSignature = hasOmissions ? confirmedSignature : displayedPlanSignature;
        const result = await clone.mutateAsync({
          sourceVersionId: source.id,
          versionPayload: payload,
          permissions,
          copyBaremos,
          expectedPlanSignature,
        });
        if (!scope.isCurrent()) return;
        if (result.status === "plan_changed") {
          queryClient.setQueryData(clonePlanQueryKey, result.plan);
          const nextHasOmissions =
            (permissions.canConfigureScoring &&
              (result.plan.omittedRules.length > 0 || result.plan.omittedAnswerKeyCount > 0)) ||
            (permissions.canConfigureBaremos &&
              copyBaremos &&
              result.plan.omittedBaremos.length > 0);
          setPlanChangedNotice(
            nextHasOmissions
              ? "La versión origen cambió antes de crear el borrador. Revisa el plan actualizado y confirma de nuevo las omisiones."
              : "La versión origen cambió antes de crear el borrador. Revisa el plan actualizado y vuelve a enviar para crear el borrador.",
          );
          return;
        }
        onCreated(result.version, result.warnings);
      } else {
        const version = await create.mutateAsync(payload);
        if (scope.isCurrent()) onCreated(version);
      }
    } catch (cause) {
      if (scope.isCurrent()) {
        if (cause instanceof IncompleteVersionCloneError) {
          onCreated(cause.version, [cause.message]);
        } else {
          setError(cause instanceof Error ? cause.message : "No se pudo crear la versión.");
        }
      }
    } finally {
      submitting.current = false;
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !pending) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{source ? "Nueva versión desde " + source.number : "Nueva versión"}</DialogTitle>
          <DialogDescription>
            {source ? "Se copiarán los subtests, los ítems y sus imágenes al nuevo borrador." : "La versión quedará disponible para configurar como borrador."}
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(event) => void submit(event)}>
          <div className={source ? "space-y-2" : "grid grid-cols-1 gap-3 sm:grid-cols-2"}>
            <label className="grid gap-1 text-sm">
              Número de versión
              <Input required autoComplete="off" value={number} disabled={pending} onChange={(event) => setNumber(event.target.value)} />
            </label>
            {!source && (
              <label className="grid gap-1 text-sm">
                Tiempo límite global (s)
                <Input
                  type="number"
                  min={1}
                  step={1}
                  placeholder="Sin límite"
                  value={timeLimitSeconds}
                  disabled={pending}
                  onChange={(event) => setTimeLimitSeconds(event.target.value)}
                />
              </label>
            )}
          </div>
          {!source && permissions.canConfigureScoring && (
            <label className="grid gap-1 text-sm">
              Estrategia de calificación
              <select
                value={resolvedBlankStrategyId === null ? "" : String(resolvedBlankStrategyId)}
                disabled={pending || strategies.isLoading}
                onChange={(event) => {
                  setStrategyTouched(true);
                  const raw = event.target.value;
                  setSelectedStrategyId(raw === "" ? null : Number(raw));
                }}
                className="border-input bg-input-background text-foreground focus-visible:border-ring focus-visible:ring-ring/50 flex h-9 w-full rounded-md border px-3 py-1 text-sm outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">
                  {strategies.isLoading ? "Cargando estrategias..." : "Seleccionar más tarde"}
                </option>
                {(strategies.data ?? []).map((strategy) => (
                  <option key={strategy.id} value={String(strategy.id)}>
                    {strategy.name} ({strategy.code})
                  </option>
                ))}
              </select>
            </label>
          )}
          {duplicate && <p role="alert" className="text-sm text-destructive">Ya existe una versión con ese número.</p>}
          {invalidTimeLimit && <p role="alert" className="text-sm text-destructive">El tiempo límite debe ser mayor que 0 segundos.</p>}
          {source && permissions.canConfigureBaremos && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={copyBaremos}
                disabled={pending}
                onChange={(event) => {
                  setCopyBaremos(event.target.checked);
                  setConfirmedSnapshot(undefined);
                  setPlanChangedNotice(undefined);
                }}
              />
              Copiar baremos y rangos
            </label>
          )}
          {source && !permissions.canConfigureScoring && (
            <p className="text-sm text-muted-foreground">Para copiar claves y reglas necesitas el permiso de configuración de calificación.</p>
          )}
          {inspectingClone && (
            <p role="status" className="text-sm text-muted-foreground">
              Analizando reglas y baremos de la versión origen…
            </p>
          )}
          {cloneInspectionFailed && (
            <Alert className="border-status-danger-border bg-status-danger-bg text-status-danger-fg">
              <AlertTitle>No se pudo analizar la versión origen</AlertTitle>
              <AlertDescription className="space-y-2 text-xs text-status-danger-fg">
                <p>{clonePlan.error instanceof Error ? clonePlan.error.message : "Error de lectura"}</p>
                <Button type="button" variant="outline" size="sm" onClick={() => void clonePlan.refetch()}>
                  Reintentar análisis
                </Button>
              </AlertDescription>
            </Alert>
          )}
          {(planChangedNotice || staleConfirmationDiffs.length > 0) && (
            <Alert role="alert" className="border-status-warning-border bg-status-warning-bg text-status-warning-fg">
              <AlertTitle>El plan de clonación cambió</AlertTitle>
              <AlertDescription className="space-y-1 text-xs text-status-warning-fg">
                <p>
                  {planChangedNotice ??
                    "El plan de clonación cambió desde que lo confirmaste. La casilla de confirmación se desmarcó; revisa la diferencia antes de confirmar de nuevo."}
                </p>
                {staleConfirmationDiffs.length > 0 && (
                  <ul className="list-disc space-y-0.5 pl-4">
                    {staleConfirmationDiffs.map((diff) => (
                      <li key={diff}>{diff}</li>
                    ))}
                  </ul>
                )}
              </AlertDescription>
            </Alert>
          )}
          {hasOmissions && (
            <Alert className="border-status-warning-border bg-status-warning-bg text-status-warning-fg">
              <AlertTitle>Elementos que se omitirán al clonar</AlertTitle>
              <AlertDescription className="space-y-2 text-xs text-status-warning-fg">
                <p>
                  Los siguientes elementos de la versión origen no pueden copiarse por completo con
                  los endpoints disponibles y serán omitidos en el nuevo borrador:
                </p>
                <ul className="list-disc space-y-1 pl-4">
                  {omittedRules.map((item) => (
                    <li key={`rule-${item.rule.id}`}>
                      Regla <strong>{item.rule.ruleType}</strong> (prioridad {item.rule.priority})
                      en {item.subtestName || item.subtestCode}: {item.reason}
                    </li>
                  ))}
                  {omittedAnswerKeyCount > 0 && (
                    <li>
                      {omittedAnswerKeyCount} clave(s) de respuesta ligadas a reglas omitidas.
                    </li>
                  )}
                  {omittedBaremos.map((item) => (
                    <li key={`baremo-${item.baremo.draftId}`}>
                      Baremo <strong>{item.baremo.name || item.baremo.code}</strong> ({item.baremo.code}):{" "}
                      {item.reason}
                    </li>
                  ))}
                </ul>
                <label className="flex items-center gap-2 pt-1 font-medium text-foreground">
                  <input
                    type="checkbox"
                    checked={confirmOmissions}
                    disabled={pending}
                    onChange={(event) => {
                      if (event.target.checked && displayedPlanSignature) {
                        const { omittedItems, omittedAnswerKeyCount: count } =
                          collectOmittedItemsMap(clonePlan.data, signatureOptions);
                        setConfirmedSnapshot({
                          signature: displayedPlanSignature,
                          omittedItems,
                          omittedAnswerKeyCount: count,
                        });
                        setPlanChangedNotice(undefined);
                      } else {
                        setConfirmedSnapshot(undefined);
                      }
                    }}
                  />
                  Confirmo crear el borrador omitiendo los elementos indicados
                </label>
              </AlertDescription>
            </Alert>
          )}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={submitDisabled}>
              {pending ? "Creando…" : hasOmissions ? "Confirmar y crear borrador" : "Crear borrador"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
