import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "../../../app/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "../../../app/components/ui/form";
import { Input } from "../../../app/components/ui/input";

export const SessionIdFormSchema = z.object({
  sessionId: z
    .string()
    .trim()
    .regex(/^[1-9]\d*$/, "Ingresa el número de la sesión (entero positivo)."),
});

type SessionIdFormValues = z.input<typeof SessionIdFormSchema>;

/**
 * Alternativa para roles sin lectura de sesiones (Consultor): no pueden listar sesiones con la API actual,
 * pero sí consultar los agregados de una sesión conocida (RESULTADO_AGREGADO_VER).
 */
export function SessionIdForm({ onSubmit, initial }: { onSubmit: (sessionId: number) => void; initial?: number }) {
  const form = useForm<SessionIdFormValues>({
    resolver: zodResolver(SessionIdFormSchema),
    defaultValues: { sessionId: initial === undefined ? "" : String(initial) },
  });
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((values) => onSubmit(Number(values.sessionId)))} className="flex flex-wrap items-start gap-2" noValidate>
        <FormField
          control={form.control}
          name="sessionId"
          render={({ field }) => (
            <FormItem className="w-56">
              <FormLabel>Número de sesión</FormLabel>
              <FormControl>
                <Input {...field} inputMode="numeric" autoComplete="off" placeholder="Ej. 12" className="tabular-nums" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" variant="outline" className="mt-[1.375rem]">
          Consultar
        </Button>
      </form>
    </Form>
  );
}
