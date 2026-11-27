import { useId, useMemo, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Layers,
  Lock,
  ShieldAlert,
  Trash2,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "../../../app/components/ui/alert";
import { Button } from "../../../app/components/ui/button";
import { ConfirmDialog } from "../../../app/components/ui/confirm-dialog";
import { EmptyState } from "../../../app/components/ui/empty-state";
import { Input } from "../../../app/components/ui/input";
import { Label } from "../../../app/components/ui/label";
import { Textarea } from "../../../app/components/ui/textarea";
import { cn } from "../../../app/components/ui/utils";
import {
  createDefaultDraftId,
  isActiveDraftNode,
  nodeKeyOf,
  type DocumentAction,
  type DocumentBaremo,
  type DocumentProblem,
  type ValidationReport,
  type VersionDocument,
} from "../document";
import { RangeTable } from "./RangeTable";

export interface BaremoEditorProps {
  document: VersionDocument;
  selectedBaremoDraftId?: string;
  validation: ValidationReport;
  readOnly: boolean;
  canConfigureBaremos: boolean;
  onSelectBaremo: (baremoDraftId?: string) => void;
  onDispatch: (action: DocumentAction) => void;
}

const PERSISTED_BAREMO_LOCK_MESSAGE =
  "Los baremos ya guardados no pueden eliminarse; edita sus valores o crea una nueva versión.";

function getBaremoStatus(
  problems: readonly DocumentProblem[],
): "error" | "warning" | "valid" {
  if (problems.some((problem) => problem.severity === "error")) return "error";
  if (problems.some((problem) => problem.severity === "warning")) return "warning";
  return "valid";
}

function BaremoValidationIcon({
  problems,
}: {
  problems: readonly DocumentProblem[];
}) {
  const status = getBaremoStatus(problems);
  if (status === "error") {
    return (
      <AlertCircle
        className="size-3.5 shrink-0 text-status-danger-fg"
        aria-label="Con errores"
      />
    );
  }
  if (status === "warning") {
    return (
      <AlertTriangle
        className="size-3.5 shrink-0 text-status-warning-fg"
        aria-label="Con advertencias"
      />
    );
  }
  return (
    <CheckCircle2
      className="size-3.5 shrink-0 text-status-success-fg"
      aria-label="Válido"
    />
  );
}

export function BaremoEditor({
  document,
  selectedBaremoDraftId,
  validation,
  readOnly,
  canConfigureBaremos,
  onSelectBaremo,
  onDispatch,
}: BaremoEditorProps) {
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const codeId = useId();
  const nameId = useId();
  const groupId = useId();
  const descId = useId();
  const deleteHintId = useId();

  const editable = !readOnly && canConfigureBaremos;

  const activeBaremos = useMemo(
    () => document.baremos.filter(isActiveDraftNode),
    [document.baremos],
  );

  const dirtySet = useMemo(
    () => new Set(document.dirtyNodeIds),
    [document.dirtyNodeIds],
  );

  const activeBaremo: DocumentBaremo | null = useMemo(
    () =>
      activeBaremos.find((baremo) => baremo.draftId === selectedBaremoDraftId) ??
      activeBaremos[0] ??
      null,
    [activeBaremos, selectedBaremoDraftId],
  );

  const activeBaremoKey = activeBaremo
    ? nodeKeyOf({ kind: "baremos", baremoDraftId: activeBaremo.draftId })
    : null;

  const activeProblems = useMemo(
    () => (activeBaremoKey ? (validation.byNodeKey[activeBaremoKey] ?? []) : []),
    [activeBaremoKey, validation.byNodeKey],
  );

  const activeErrors = useMemo(
    () => activeProblems.filter((problem) => problem.severity === "error"),
    [activeProblems],
  );
  const activeWarnings = useMemo(
    () => activeProblems.filter((problem) => problem.severity === "warning"),
    [activeProblems],
  );

  const codeError = activeErrors.find((problem) => problem.field === "code");
  const nameError = activeErrors.find((problem) => problem.field === "name");

  const handleCreateBaremo = () => {
    if (!editable) return;
    const draftId = createDefaultDraftId("bar");
    onDispatch({ type: "ADD_BAREMO", input: { draftId } });
    onSelectBaremo(draftId);
  };

  const updateBaremo = (
    patch: Extract<DocumentAction, { type: "UPDATE_BAREMO" }>["patch"],
  ) => {
    if (!editable || !activeBaremo) return;
    onDispatch({
      type: "UPDATE_BAREMO",
      baremoDraftId: activeBaremo.draftId,
      patch,
    });
  };

  const canDeleteBaremo = editable && activeBaremo !== null && activeBaremo.id === null;

  return (
    <div className="space-y-4" data-slot="baremo-editor">
      {!canConfigureBaremos ? (
        <Alert className="border-status-info-border bg-status-info-bg text-status-info-fg">
          <ShieldAlert aria-hidden="true" />
          <AlertTitle>Sin permiso para configurar baremos</AlertTitle>
          <AlertDescription className="text-status-info-fg">
            Se requiere el permiso BAREMO_CONFIGURAR para editar o crear baremos. El contenido
            se muestra en modo solo lectura.
          </AlertDescription>
        </Alert>
      ) : readOnly ? (
        <Alert className="border-status-info-border bg-status-info-bg text-status-info-fg">
          <Lock aria-hidden="true" />
          <AlertTitle>Versión bloqueada en solo lectura</AlertTitle>
          <AlertDescription className="text-status-info-fg">
            Solo las versiones en estado Borrador permiten modificar baremos y rangos.
          </AlertDescription>
        </Alert>
      ) : null}

      {activeBaremos.length === 0 || !activeBaremo ? (
        <EmptyState
          icon={<Layers className="size-6 text-muted-foreground" aria-hidden="true" />}
          title="Sin baremos configurados"
          description="Crea un baremo para definir la transformación de puntajes directos en percentiles y categorías clínicas."
          action={
            <Button
              type="button"
              disabled={!editable}
              onClick={handleCreateBaremo}
            >
              Crear primer baremo
            </Button>
          }
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div
              role="tablist"
              aria-label="Baremos de la versión"
              className="flex flex-wrap items-center gap-2"
            >
              {activeBaremos.map((baremo) => {
                const baremoKey = nodeKeyOf({
                  kind: "baremos",
                  baremoDraftId: baremo.draftId,
                });
                const isSelected = baremo.draftId === activeBaremo.draftId;
                const isDirty = dirtySet.has(baremoKey);
                const nodeProblems = validation.byNodeKey[baremoKey] ?? [];
                const label = baremo.name.trim() || baremo.code.trim() || "Baremo sin nombre";

                return (
                  <button
                    key={baremo.draftId}
                    type="button"
                    role="tab"
                    aria-selected={isSelected}
                    onClick={() => onSelectBaremo(baremo.draftId)}
                    className={cn(
                      "inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring",
                      isSelected
                        ? "border-primary bg-accent text-accent-foreground"
                        : "border-border bg-card text-foreground hover:bg-muted/60",
                    )}
                  >
                    {isDirty && (
                      <span
                        className="size-2 shrink-0 rounded-full bg-status-warning-solid"
                        aria-label="Cambios sin guardar"
                        title="Cambios sin guardar"
                      />
                    )}
                    <span className="truncate max-w-44">{label}</span>
                    {baremo.code.trim() !== "" && (
                      <span className="font-mono text-xs text-muted-foreground">
                        {baremo.code}
                      </span>
                    )}
                    <BaremoValidationIcon problems={nodeProblems} />
                  </button>
                );
              })}
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!editable}
              onClick={handleCreateBaremo}
            >
              + Nuevo baremo
            </Button>
          </div>

          {activeProblems.length > 0 && (
            <Alert
              className={
                activeErrors.length > 0
                  ? "border-status-danger-border bg-status-danger-bg text-status-danger-fg"
                  : "border-status-warning-border bg-status-warning-bg text-status-warning-fg"
              }
            >
              {activeErrors.length > 0 ? (
                <AlertCircle aria-hidden="true" />
              ) : (
                <AlertTriangle aria-hidden="true" />
              )}
              <AlertTitle>
                {activeErrors.length > 0
                  ? `Validación del baremo (${activeErrors.length} ${activeErrors.length === 1 ? "error" : "errores"})`
                  : `Advertencias del baremo (${activeWarnings.length})`}
              </AlertTitle>
              <AlertDescription
                className={
                  activeErrors.length > 0
                    ? "text-status-danger-fg"
                    : "text-status-warning-fg"
                }
              >
                <ul className="list-disc pl-4 space-y-1">
                  {activeProblems.map((problem) => (
                    <li key={problem.id}>{problem.message}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          <div className="rounded-lg border border-border bg-card p-4 shadow-[var(--shadow-xs)] space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
              <div>
                <h2 className="text-base font-semibold text-foreground">
                  Configuración del baremo
                </h2>
                <p className="text-xs text-muted-foreground">
                  Define el identificador, grupo normativo y descripción del baremo activo.
                </p>
              </div>

              <div className="flex flex-col items-end gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!canDeleteBaremo}
                  aria-describedby={activeBaremo.id !== null ? deleteHintId : undefined}
                  title={
                    activeBaremo.id !== null
                      ? PERSISTED_BAREMO_LOCK_MESSAGE
                      : !editable
                        ? "Edición bloqueada en modo solo lectura"
                        : "Eliminar baremo local sin guardar"
                  }
                  onClick={() => {
                    if (canDeleteBaremo) {
                      setConfirmDeleteOpen(true);
                    }
                  }}
                  className={cn(
                    canDeleteBaremo &&
                      "border-status-danger-border text-status-danger-fg hover:bg-status-danger-bg",
                  )}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                  <span>Eliminar baremo</span>
                </Button>
                {activeBaremo.id !== null && (
                  <p
                    id={deleteHintId}
                    className="max-w-xs text-right text-xs text-muted-foreground"
                  >
                    {PERSISTED_BAREMO_LOCK_MESSAGE}
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor={codeId} className="text-sm font-medium text-foreground">
                  Código <span className="text-status-danger-fg">*</span>
                </Label>
                <Input
                  id={codeId}
                  value={activeBaremo.code}
                  disabled={!editable}
                  aria-invalid={Boolean(codeError) || undefined}
                  placeholder="Ej. BAR-GENERAL"
                  onChange={(event) => updateBaremo({ code: event.target.value })}
                  className={cn(
                    "font-mono",
                    codeError &&
                      "border-status-danger-solid ring-2 ring-status-danger-bg",
                  )}
                />
                {codeError && (
                  <p className="flex items-center gap-1 text-xs text-status-danger-fg">
                    <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
                    <span>{codeError.message}</span>
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor={nameId} className="text-sm font-medium text-foreground">
                  Nombre <span className="text-status-danger-fg">*</span>
                </Label>
                <Input
                  id={nameId}
                  value={activeBaremo.name}
                  disabled={!editable}
                  aria-invalid={Boolean(nameError) || undefined}
                  placeholder="Ej. Baremo General Adultos"
                  onChange={(event) => updateBaremo({ name: event.target.value })}
                  className={cn(
                    nameError &&
                      "border-status-danger-solid ring-2 ring-status-danger-bg",
                  )}
                />
                {nameError && (
                  <p className="flex items-center gap-1 text-xs text-status-danger-fg">
                    <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
                    <span>{nameError.message}</span>
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor={groupId} className="text-sm font-medium text-foreground">
                  Grupo normativo
                </Label>
                <Input
                  id={groupId}
                  value={activeBaremo.normativeGroup}
                  disabled={!editable}
                  placeholder="Ej. General / Universitarios"
                  onChange={(event) => updateBaremo({ normativeGroup: event.target.value })}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={descId} className="text-sm font-medium text-foreground">
                Descripción
              </Label>
              <Textarea
                id={descId}
                rows={2}
                value={activeBaremo.description}
                disabled={!editable}
                placeholder="Criterios de aplicación, muestra normativa y notas clínicas..."
                onChange={(event) => updateBaremo({ description: event.target.value })}
              />
            </div>
          </div>

          <RangeTable
            baremo={activeBaremo}
            readOnly={readOnly}
            canConfigureBaremos={canConfigureBaremos}
            problems={activeProblems}
            onDispatch={onDispatch}
          />

          <ConfirmDialog
            open={confirmDeleteOpen}
            onOpenChange={setConfirmDeleteOpen}
            tone="danger"
            title="¿Eliminar baremo?"
            description={`Se eliminará el baremo "${activeBaremo.name.trim() || activeBaremo.code.trim() || "sin nombre"}" y sus ${activeBaremo.ranges.filter(isActiveDraftNode).length} rangos locales. Esta acción no se puede deshacer.`}
            confirmLabel="Confirmar eliminación"
            cancelLabel="Cancelar"
            onConfirm={() => {
              const remaining = activeBaremos.filter(
                (baremo) => baremo.draftId !== activeBaremo.draftId,
              );
              onDispatch({
                type: "DELETE_BAREMO",
                baremoDraftId: activeBaremo.draftId,
              });
              onSelectBaremo(remaining[0]?.draftId);
            }}
          />
        </>
      )}
    </div>
  );
}
