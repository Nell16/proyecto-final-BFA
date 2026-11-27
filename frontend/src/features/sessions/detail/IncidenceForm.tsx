import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "../../../app/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "../../../app/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../app/components/ui/select";
import { Textarea } from "../../../app/components/ui/textarea";
import { captureAccountScope, isAccountChangedError } from "../../../store/accountScope";
import { useRecordIncidence } from "../mutations";
import { useIncidenceLog } from "./incidenceLog";
import { errorMessage } from "./model";

export interface IncidenceParticipantOption {
  id: string;
  name: string;
  code?: string;
}

const IncidenceFormSchema = z.object({
  participantId: z.string().min(1, "Selecciona un participante."),
  text: z.string().trim().min(1, "Escribe la nota de la incidencia."),
});

type IncidenceFormValues = z.input<typeof IncidenceFormSchema>;

interface IncidenceFormProps {
  sessionId: number;
  participants: readonly IncidenceParticipantOption[];
  /** Si se indica, el participante queda fijo (nota desde una fila del monitor). */
  lockedParticipantId?: string;
  submitLabel?: string;
  onRecorded?: () => void;
}

export function IncidenceForm({
  sessionId,
  participants,
  lockedParticipantId,
  submitLabel = "Registrar incidencia",
  onRecorded,
}: IncidenceFormProps) {
  const record = useRecordIncidence(sessionId);
  const log = useIncidenceLog();
  const form = useForm<IncidenceFormValues>({
    resolver: zodResolver(IncidenceFormSchema),
    defaultValues: { participantId: lockedParticipantId ?? "", text: "" },
  });

  const locked = lockedParticipantId
    ? participants.find((p) => p.id === lockedParticipantId)
    : undefined;

  const onSubmit = form.handleSubmit(async (values) => {
    const text = values.text.trim();
    const scope = captureAccountScope();
    try {
      await record.mutateAsync({ participantId: values.participantId, text });
    } catch (error) {
      if (isAccountChangedError(error) || !scope.isCurrent()) return;
      toast.error(errorMessage(error, "No se pudo registrar la incidencia."));
      return;
    }
    if (!scope.isCurrent()) return; // cambió la cuenta: no se publica en la bitácora ni se cierra el formulario
    const participant = participants.find((p) => p.id === values.participantId);
    log.add({
      participantId: values.participantId,
      participantName: participant?.name ?? "Participante",
      text,
      // Instante local en ISO con zona (`Z`): inequívoco para `parseServerDateTime` (regla 10).
      recordedAt: new Date().toISOString(),
    });
    toast.success("Incidencia registrada.");
    form.reset({ participantId: lockedParticipantId ?? "", text: "" });
    onRecorded?.();
  });

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {locked ? (
          <p className="text-sm">
            <span className="text-muted-foreground">Participante: </span>
            <span className="font-medium">{locked.name}</span>
            {locked.code && <span className="ml-1 font-mono text-xs text-muted-foreground">({locked.code})</span>}
          </p>
        ) : (
          <FormField
            control={form.control}
            name="participantId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Participante <span className="text-danger-foreground">*</span>
                </FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Selecciona un participante" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {participants.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                        {p.code ? ` (${p.code})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        <FormField
          control={form.control}
          name="text"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                Nota <span className="text-danger-foreground">*</span>
              </FormLabel>
              <FormControl>
                <Textarea
                  {...field}
                  rows={4}
                  placeholder="Describe lo ocurrido (p. ej. falla de equipo, interrupción, observación del aplicador)"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex justify-end">
          <Button type="submit" disabled={record.isPending}>
            {record.isPending ? "Registrando…" : submitLabel}
          </Button>
        </div>
      </form>
    </Form>
  );
}
