import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import type { PendingReview } from "../../../api/schemas/results";
import { Button } from "../../../app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../app/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "../../../app/components/ui/form";
import { Input } from "../../../app/components/ui/input";
import { Textarea } from "../../../app/components/ui/textarea";
import { captureAccountScope, isAccountChangedError } from "../../../store/accountScope";
import { errorMessage } from "../format";
import { useResolveReview } from "../mutations";
import { EMPTY_REVIEW_FORM, ResolveReviewFormSchema, toSubmitReviewInput, type ResolveReviewFormValues } from "./schemas";

function ReviewForm({ review, onClose }: { review: PendingReview; onClose: () => void }) {
  const resolve = useResolveReview();
  const form = useForm<ResolveReviewFormValues>({
    resolver: zodResolver(ResolveReviewFormSchema),
    defaultValues: EMPTY_REVIEW_FORM,
  });
  const approving = useWatch({ control: form.control, name: "decision" }) === "approve";

  const onSubmit = form.handleSubmit(async (values) => {
    const scope = captureAccountScope();
    try {
      await resolve.mutateAsync({ reviewId: review.reviewId, input: toSubmitReviewInput(values) });
    } catch (error) {
      if (isAccountChangedError(error) || !scope.isCurrent()) return;
      toast.error(errorMessage(error, "No se pudo guardar la revisión."));
      return;
    }
    if (!scope.isCurrent()) return; // la cuenta cambió: no se publica nada
    toast.success(values.decision === "approve" ? "Revisión aprobada." : "Respuesta observada.");
    onClose();
  });

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3 text-sm">
          <p className="text-xs font-medium text-muted-foreground">
            {review.participantName} · ítem <span className="font-mono">{review.itemCode}</span> · intento #{review.attemptId}
          </p>
          <p className="whitespace-pre-wrap font-medium text-foreground">{review.prompt}</p>
          <div>
            <p className="text-xs font-medium text-muted-foreground">Respuesta del participante</p>
            <p className="whitespace-pre-wrap text-foreground">
              {review.textAnswer ?? (review.numericAnswer === null ? "Sin respuesta" : String(review.numericAnswer))}
            </p>
          </div>
        </div>

        <FormField
          control={form.control}
          name="decision"
          render={({ field }) => (
            <FormItem>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium text-foreground">Resolución</legend>
                {(
                  [
                    ["approve", "Aprobar y asignar puntaje"],
                    ["observe", "Observar (no se acepta la respuesta)"],
                  ] as const
                ).map(([value, label]) => (
                  <label key={value} className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name={field.name}
                      value={value}
                      checked={field.value === value}
                      onChange={() => field.onChange(value)}
                      onBlur={field.onBlur}
                      className="size-4 accent-primary"
                    />
                    {label}
                  </label>
                ))}
              </fieldset>
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="score"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                Puntaje {approving && <span className="text-danger-foreground">*</span>}
              </FormLabel>
              <FormControl>
                <Input {...field} type="text" inputMode="decimal" autoComplete="off" placeholder="0" className="max-w-40 tabular-nums" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="comment"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                Comentario {!approving && <span className="text-danger-foreground">*</span>}
              </FormLabel>
              <FormControl>
                <Textarea {...field} rows={3} placeholder="Justificación del puntaje o motivo de la observación" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={resolve.isPending}>
            Cancelar
          </Button>
          <Button type="submit" disabled={resolve.isPending}>
            {resolve.isPending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            Guardar revisión
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}

/** Diálogo para resolver una revisión manual. El formulario se monta por revisión (estado limpio al cambiar). */
export function ResolveReviewDialog({ review, onClose }: { review: PendingReview | null; onClose: () => void }) {
  return (
    <Dialog open={review !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Revisar respuesta</DialogTitle>
          <DialogDescription>Asigna un puntaje o marca la respuesta como observada.</DialogDescription>
        </DialogHeader>
        {review && <ReviewForm key={review.reviewId} review={review} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}
