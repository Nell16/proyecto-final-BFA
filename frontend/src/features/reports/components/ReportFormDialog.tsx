import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Loader2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import {
  AggregateReportFormSchema,
  IndividualReportFormSchema,
  type AggregateReportFormValues,
  type IndividualReportFormValues,
} from "../../../api/schemas/reports";
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
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "../../../app/components/ui/form";
import { Input } from "../../../app/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../app/components/ui/select";
import { Textarea } from "../../../app/components/ui/textarea";
import { captureAccountScope } from "../../../store/accountScope";
import { SESION_LEER } from "../../../store/permissions";
import { useStaffAuth } from "../../../store/staffAuth";
import { errorMessage, isForbidden } from "../../catalogs/error-message";
import { sessionListQuery } from "../../sessions/queries";
import { useCreateAggregateReport, useCreateIndividualReport } from "../mutations";

export type ReportMode = "individual" | "aggregate";

interface ReportFormDialogProps {
  open: boolean;
  mode: ReportMode;
  onOpenChange: (open: boolean) => void;
}

const FORMAT_OPTIONS = ["PDF", "XLSX", "CSV"] as const;

export function ReportFormDialog({ open, mode, onOpenChange }: ReportFormDialogProps) {
  const [submitting, setSubmitting] = useState(false);

  return (
    <Dialog open={open} onOpenChange={(next) => (submitting ? undefined : onOpenChange(next))}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {mode === "individual" ? "Generar reporte individual" : "Generar reporte agregado"}
          </DialogTitle>
          <DialogDescription>
            {mode === "individual"
              ? "Registra un reporte por intento o resultado evaluado. Campos con * son obligatorios."
              : "Registra un reporte estadístico agregado para una sesión de evaluación."}
          </DialogDescription>
        </DialogHeader>

        {open &&
          (mode === "individual" ? (
            <IndividualReportForm
              onSubmittingChange={setSubmitting}
              onClose={() => onOpenChange(false)}
            />
          ) : (
            <AggregateReportForm
              onSubmittingChange={setSubmitting}
              onClose={() => onOpenChange(false)}
            />
          ))}
      </DialogContent>
    </Dialog>
  );
}

interface InnerFormProps {
  onSubmittingChange: (submitting: boolean) => void;
  onClose: () => void;
}

function IndividualReportForm({ onSubmittingChange, onClose }: InnerFormProps) {
  const createReport = useCreateIndividualReport();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const form = useForm<IndividualReportFormValues>({
    resolver: zodResolver(IndividualReportFormSchema),
    defaultValues: {
      type: "INDIVIDUAL",
      format: "PDF",
      storagePath: "/reports/individual.pdf",
      attemptId: "",
      resultId: "",
      filtersJson: "",
    },
  });

  const handleSubmit = async (values: IndividualReportFormValues) => {
    const scope = captureAccountScope();
    setSubmitError(null);
    onSubmittingChange(true);
    try {
      const created = await createReport.mutateAsync({
        type: values.type.trim(),
        format: values.format,
        storagePath: values.storagePath.trim(),
        attemptId: values.attemptId.trim() ? Number(values.attemptId.trim()) : undefined,
        resultId: values.resultId.trim() ? Number(values.resultId.trim()) : undefined,
        filtersJson: values.filtersJson.trim() || undefined,
      });
      if (!scope.isCurrent()) return;
      toast.success(`Reporte individual #${created.id} registrado (${created.format}).`);
      onClose();
    } catch (error) {
      if (!scope.isCurrent()) return;
      const msg = errorMessage(error, "No se pudo registrar el reporte individual.");
      setSubmitError(msg);
      if (!isForbidden(error)) toast.error(msg);
    } finally {
      if (scope.isCurrent()) onSubmittingChange(false);
    }
  };

  const pending = createReport.isPending;

  return (
    <Form {...form}>
      <form
        noValidate
        onSubmit={(event) => {
          void form.handleSubmit(handleSubmit)(event);
        }}
        className="space-y-4"
      >
        {submitError && (
          <Alert
            role="alert"
            className="border-status-danger-border bg-status-danger-bg text-status-danger-fg"
          >
            <AlertCircle className="size-4" aria-hidden="true" />
            <AlertDescription className="text-xs text-status-danger-fg">{submitError}</AlertDescription>
          </Alert>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="type"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Tipo de reporte <span className="text-status-danger-fg">*</span>
                </FormLabel>
                <FormControl>
                  <Input {...field} disabled={pending} placeholder="INDIVIDUAL" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="format"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Formato <span className="text-status-danger-fg">*</span>
                </FormLabel>
                <Select value={field.value} onValueChange={field.onChange} disabled={pending}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {FORMAT_OPTIONS.map((fmt) => (
                      <SelectItem key={fmt} value={fmt}>
                        {fmt}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="attemptId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>ID de intento</FormLabel>
                <FormControl>
                  <Input {...field} type="number" min={1} disabled={pending} placeholder="Ej. 42" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="resultId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>ID de resultado</FormLabel>
                <FormControl>
                  <Input {...field} type="number" min={1} disabled={pending} placeholder="Ej. 15" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="storagePath"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                Ruta de almacenamiento <span className="text-status-danger-fg">*</span>
              </FormLabel>
              <FormControl>
                <Input {...field} disabled={pending} placeholder="/reports/individual-42.pdf" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="filtersJson"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Filtros adicionales (JSON opcional)</FormLabel>
              <FormControl>
                <Textarea
                  {...field}
                  rows={2}
                  disabled={pending}
                  placeholder='{"attemptId": 42}'
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button type="submit" disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            <span>{pending ? "Generando reporte…" : "Generar reporte"}</span>
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}

function AggregateReportForm({ onSubmittingChange, onClose }: InnerFormProps) {
  const canReadSessions = useStaffAuth((s) => s.hasAnyPermission(SESION_LEER));
  const sessionsQuery = useQuery({ ...sessionListQuery(), enabled: canReadSessions });
  const createReport = useCreateAggregateReport();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const form = useForm<AggregateReportFormValues>({
    resolver: zodResolver(AggregateReportFormSchema),
    defaultValues: {
      type: "AGREGADO",
      format: "XLSX",
      storagePath: "/reports/aggregate.xlsx",
      sessionId: "",
      filtersJson: "",
    },
  });

  const handleSubmit = async (values: AggregateReportFormValues) => {
    const scope = captureAccountScope();
    setSubmitError(null);
    onSubmittingChange(true);
    try {
      const created = await createReport.mutateAsync({
        type: values.type.trim(),
        format: values.format,
        storagePath: values.storagePath.trim(),
        sessionId: Number(values.sessionId.trim()),
        filtersJson: values.filtersJson.trim() || undefined,
      });
      if (!scope.isCurrent()) return;
      toast.success(`Reporte agregado #${created.id} registrado (${created.format}).`);
      onClose();
    } catch (error) {
      if (!scope.isCurrent()) return;
      const msg = errorMessage(error, "No se pudo registrar el reporte agregado.");
      setSubmitError(msg);
      if (!isForbidden(error)) toast.error(msg);
    } finally {
      if (scope.isCurrent()) onSubmittingChange(false);
    }
  };

  const pending = createReport.isPending;
  const sessions = sessionsQuery.data ?? [];

  return (
    <Form {...form}>
      <form
        noValidate
        onSubmit={(event) => {
          void form.handleSubmit(handleSubmit)(event);
        }}
        className="space-y-4"
      >
        {submitError && (
          <Alert
            role="alert"
            className="border-status-danger-border bg-status-danger-bg text-status-danger-fg"
          >
            <AlertCircle className="size-4" aria-hidden="true" />
            <AlertDescription className="text-xs text-status-danger-fg">{submitError}</AlertDescription>
          </Alert>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="type"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Tipo de reporte <span className="text-status-danger-fg">*</span>
                </FormLabel>
                <FormControl>
                  <Input {...field} disabled={pending} placeholder="AGREGADO" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="format"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Formato <span className="text-status-danger-fg">*</span>
                </FormLabel>
                <Select value={field.value} onValueChange={field.onChange} disabled={pending}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {FORMAT_OPTIONS.map((fmt) => (
                      <SelectItem key={fmt} value={fmt}>
                        {fmt}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="sessionId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                Sesión de evaluación <span className="text-status-danger-fg">*</span>
              </FormLabel>
              {canReadSessions && sessions.length > 0 ? (
                <Select value={field.value} onValueChange={field.onChange} disabled={pending}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccione una sesión" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {sessions.map((session) => (
                      <SelectItem key={session.id} value={String(session.id)}>
                        {session.code} · {session.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <FormControl>
                  <Input
                    {...field}
                    type="number"
                    min={1}
                    disabled={pending}
                    placeholder="ID de sesión (ej. 10)"
                  />
                </FormControl>
              )}
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="storagePath"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                Ruta de almacenamiento <span className="text-status-danger-fg">*</span>
              </FormLabel>
              <FormControl>
                <Input {...field} disabled={pending} placeholder="/reports/session-10.xlsx" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="filtersJson"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Filtros adicionales (JSON opcional)</FormLabel>
              <FormControl>
                <Textarea
                  {...field}
                  rows={2}
                  disabled={pending}
                  placeholder='{"sessionId": 10}'
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button type="submit" disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            <span>{pending ? "Generando reporte…" : "Generar reporte"}</span>
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}
