import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../../../app/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../../app/components/ui/card";
import { Checkbox } from "../../../../app/components/ui/checkbox";
import { useConfirm } from "../../../../app/components/ui/confirm-dialog";
import { EmptyState } from "../../../../app/components/ui/empty-state";
import { Input } from "../../../../app/components/ui/input";
import { Skeleton } from "../../../../app/components/ui/skeleton";
import { StatusBadge } from "../../../../app/components/ui/status-badge";
import { captureAccountScope, isAccountChangedError } from "../../../../store/accountScope";
import { useReplaceSessionSubtests } from "../../mutations";
import {
  buildRows,
  moveRow,
  rowsFromServer,
  savedSubtestIds,
  subtestsSignature,
  toSubtestRequests,
  validateRows,
  type SubtestRow,
} from "../subtest-rows";
import type { InstrumentInfo } from "../types";
import {
  NO_TEST_PERMISSION_MESSAGE,
  errorMessage,
  isForbidden,
  wizardSubtestsQuery,
  wizardVersionLookupQuery,
} from "../wizard-queries";
import { InlineAlert } from "./form-bits";

interface StepSubtestsProps {
  sessionId: number;
  versionId: number;
  instrument: InstrumentInfo | null;
  /** Filas editadas (null = aún no se tocó nada: se usan los valores por defecto de la versión). */
  rows: SubtestRow[] | null;
  onRowsChange: (rows: SubtestRow[]) => void;
  /** Firma del último PUT exitoso; evita repetirlo si nada cambió. */
  savedSignature: string | null;
  /** Subtests que el servidor confirmó en un PUT de esta visita: no se pueden quitar todavía. */
  lockedIds: ReadonlySet<number>;
  /** La sesión se reanudó: el backend no devuelve la configuración previa de subtests (B4). */
  resumed: boolean;
  /** Estado tras el PUT = respuesta del servidor (filas efectivas). */
  onSaved: (result: { signature: string; rows: SubtestRow[]; lockedIds: Set<number> }) => void;
  onBack: () => void;
  onContinue: () => void;
}

export function StepSubtests({
  sessionId,
  versionId,
  instrument,
  rows: rowsOverride,
  onRowsChange,
  savedSignature,
  lockedIds,
  resumed,
  onSaved,
  onBack,
  onContinue,
}: StepSubtestsProps) {
  const confirm = useConfirm();
  const subtestsQuery = useQuery(wizardSubtestsQuery(versionId));
  const replace = useReplaceSessionSubtests(sessionId);

  // ¿La versión permite aleatorizar ítems? Si no, el backend fuerza `randomizeItems=false`.
  const knownAllow = instrument?.allowRandomizeItems;
  const versionLookup = useQuery({ ...wizardVersionLookupQuery(versionId), enabled: knownAllow === undefined });
  const allowRandomizeItems: boolean | null = knownAllow ?? versionLookup.data?.randomizeItems ?? null;
  const randomizeItemsHint =
    allowRandomizeItems === true
      ? null
      : allowRandomizeItems === false
        ? "La versión no permite aleatorizar ítems."
        : versionLookup.isPending
          ? "Comprobando si la versión permite aleatorizar ítems…"
          : "No se pudo comprobar si la versión permite aleatorizar ítems.";

  const rows = rowsOverride ?? (subtestsQuery.data ? buildRows(subtestsQuery.data) : []);
  const validation = validateRows(rows);

  const update = (index: number, patch: Partial<SubtestRow>) =>
    onRowsChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const save = async () => {
    if (!validation.valid) return;
    const scope = captureAccountScope();
    const requests = toSubtestRequests(rows, { allowRandomizeItems });
    const signature = subtestsSignature(requests);
    if (signature !== savedSignature) {
      if (resumed && savedSignature === null) {
        const confirmed = await confirm({
          title: "Sobrescribir la configuración de subtests",
          description:
            "Al reanudar no se puede consultar la configuración de subtests guardada antes. Al guardar se enviará la selección actual y se sobrescribirá la configuración previa de esos subtests. Los subtests ya guardados que no incluya no se quitarán.",
          confirmLabel: "Guardar y sobrescribir",
          cancelLabel: "Revisar",
        });
        if (!confirmed || !scope.isCurrent()) return;
      }
      try {
        const saved = await replace.mutateAsync(requests);
        if (!scope.isCurrent()) return; // cambió la cuenta: no se publica estado ni se avanza
        const effectiveRows = rowsFromServer(saved, subtestsQuery.data ?? [], rows);
        onSaved({
          signature: subtestsSignature(toSubtestRequests(effectiveRows, { allowRandomizeItems })),
          rows: effectiveRows,
          lockedIds: new Set([...lockedIds, ...savedSubtestIds(saved)]),
        });
        toast.success("Subtests de la sesión guardados.");
      } catch (error) {
        if (isAccountChangedError(error) || !scope.isCurrent()) return;
        toast.error(errorMessage(error, "No se pudieron guardar los subtests."));
        return;
      }
    }
    onContinue();
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Subtests de la versión</CardTitle>
          <CardDescription className="flex flex-wrap items-center gap-2">
            {instrument ? (
              <>
                <span>
                  {instrument.testName} · versión {instrument.versionNumber}
                </span>
                <StatusBadge domain="version" status={instrument.versionStatus} />
              </>
            ) : (
              <span>Versión #{versionId}</span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {resumed && savedSignature === null && (
            <InlineAlert tone="warning" title="Sesión reanudada">
              No es posible consultar los subtests guardados antes. Si guarda ahora se sobrescribirá la configuración
              previa de los subtests incluidos y los ya guardados que omita no se quitarán.
            </InlineAlert>
          )}
          {subtestsQuery.isPending ? (
            <div className="space-y-2" aria-busy="true">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : subtestsQuery.isError ? (
            isForbidden(subtestsQuery.error) ? (
              <InlineAlert tone="danger" title="Sin permiso para ver los subtests">
                {NO_TEST_PERMISSION_MESSAGE}
              </InlineAlert>
            ) : (
              <InlineAlert
                tone="danger"
                title="No se pudieron cargar los subtests"
                action={
                  <Button type="button" variant="outline" size="sm" onClick={() => void subtestsQuery.refetch()}>
                    Reintentar
                  </Button>
                }
              >
                {errorMessage(subtestsQuery.error, "Ocurrió un error al consultar los subtests.")}
              </InlineAlert>
            )
          ) : rows.length === 0 ? (
            <EmptyState
              title="La versión no tiene subtests activos"
              description="Agregue subtests a la versión desde Instrumentos para poder aplicarla."
            />
          ) : (
            <>
            {randomizeItemsHint && <p className="text-xs text-muted-foreground">{randomizeItemsHint}</p>}
            <ul className="space-y-3" aria-label="Subtests de la sesión">
              {rows.map((row, index) => {
                const error = row.selected ? validation.errors[row.subtestId] : undefined;
                const prefix = `subtest-${row.subtestId}`;
                const locked = lockedIds.has(row.subtestId);
                return (
                  <li
                    key={row.subtestId}
                    className="rounded-lg border border-border bg-card p-3"
                    data-selected={row.selected}
                  >
                    <div className="flex flex-wrap items-start gap-3">
                      <Checkbox
                        id={`${prefix}-selected`}
                        checked={row.selected}
                        disabled={locked}
                        aria-describedby={locked ? `${prefix}-locked` : undefined}
                        onCheckedChange={(checked) => update(index, { selected: checked === true })}
                        aria-label={`Incluir ${row.name}`}
                        className="mt-1"
                      />
                      <div className="min-w-0 flex-1">
                        <label htmlFor={`${prefix}-selected`} className="cursor-pointer text-sm font-medium">
                          {row.name}
                        </label>
                        <p className="text-xs text-muted-foreground">
                          <span className="font-mono">{row.code}</span>
                          {row.required && " · Obligatorio en la versión"}
                        </p>
                        {locked && (
                          <p id={`${prefix}-locked`} className="text-xs text-muted-foreground">
                            Quitar subtests guardados aún no está disponible
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          disabled={index === 0}
                          onClick={() => onRowsChange(moveRow(rows, index, -1))}
                          aria-label={`Subir ${row.name}`}
                        >
                          <ArrowUp aria-hidden="true" className="size-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          disabled={index === rows.length - 1}
                          onClick={() => onRowsChange(moveRow(rows, index, 1))}
                          aria-label={`Bajar ${row.name}`}
                        >
                          <ArrowDown aria-hidden="true" className="size-4" />
                        </Button>
                      </div>
                    </div>

                    <div className="mt-3 grid gap-3 pl-7 sm:grid-cols-[minmax(0,12rem)_1fr]">
                      <div className="space-y-1.5">
                        <label htmlFor={`${prefix}-time`} className="text-xs font-medium text-muted-foreground">
                          Tiempo límite (min)
                        </label>
                        <Input
                          id={`${prefix}-time`}
                          inputMode="decimal"
                          placeholder="Sin límite"
                          value={row.timeLimitMinutes}
                          disabled={!row.selected}
                          aria-invalid={!!error}
                          aria-describedby={error ? `${prefix}-time-error` : undefined}
                          aria-label={`Tiempo límite de ${row.name} (minutos)`}
                          onChange={(event) => update(index, { timeLimitMinutes: event.target.value })}
                        />
                        {error && (
                          <p id={`${prefix}-time-error`} className="text-xs text-danger-foreground">
                            {error}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
                        <label className="flex items-center gap-2 text-sm">
                          <Checkbox
                            checked={allowRandomizeItems === true && row.randomizeItems}
                            disabled={!row.selected || allowRandomizeItems !== true}
                            onCheckedChange={(checked) => update(index, { randomizeItems: checked === true })}
                            aria-label={`Aleatorizar ítems de ${row.name}`}
                          />
                          Aleatorizar ítems
                        </label>

                        <label className="flex items-center gap-2 text-sm">
                          <Checkbox
                            checked={row.randomizeOptions}
                            disabled={!row.selected}
                            onCheckedChange={(checked) => update(index, { randomizeOptions: checked === true })}
                            aria-label={`Aleatorizar opciones de ${row.name}`}
                          />
                          Aleatorizar opciones
                        </label>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
            </>
          )}
          {rows.length > 0 && validation.noneSelected && (
            <InlineAlert tone="warning">Seleccione al menos un subtest para continuar.</InlineAlert>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-between">
        <Button type="button" variant="outline" onClick={onBack}>
          Atrás
        </Button>
        <Button type="button" onClick={() => void save()} disabled={!validation.valid || replace.isPending}>
          {replace.isPending ? "Guardando…" : "Guardar y continuar"}
        </Button>
      </div>
    </div>
  );
}
