import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useForm } from "react-hook-form";
import type { Career } from "../../../api/schemas/academic";
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
import { SearchableCombobox } from "../../../app/components/ui/searchable-combobox";
import type { CatalogDefinition, CatalogFormValues } from "../definitions";

export type CatalogFormDefinition = Pick<
  CatalogDefinition<never>,
  "schema" | "fields" | "defaultValues" | "newLabel" | "singular"
>;

export interface CatalogCareerSource {
  items: readonly Career[];
  isLoading: boolean;
  unavailableReason: string | null;
}

interface CatalogFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  definition: CatalogFormDefinition;
  careers?: CatalogCareerSource;
  /** Debe rechazar si falla: el diálogo queda abierto para corregir y reintentar. */
  onSubmit: (values: CatalogFormValues) => Promise<void>;
}

export function CatalogFormDialog({ open, onOpenChange, definition, careers, onSubmit }: CatalogFormDialogProps) {
  const [submitting, setSubmitting] = useState(false);

  return (
    <Dialog open={open} onOpenChange={(next) => (submitting ? undefined : onOpenChange(next))}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{definition.newLabel}</DialogTitle>
          <DialogDescription>Complete los datos. Los campos con * son obligatorios.</DialogDescription>
        </DialogHeader>
        {/* El formulario vive dentro del contenido: se desmonta al cerrar y reabre limpio. */}
        <CatalogForm
          definition={definition}
          careers={careers}
          submitting={submitting}
          onCancel={() => onOpenChange(false)}
          onSubmit={async (values) => {
            setSubmitting(true);
            try {
              await onSubmit(values);
              onOpenChange(false);
            } catch {
              // El llamador ya mostró el error (toast); el diálogo queda abierto.
            } finally {
              setSubmitting(false);
            }
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

interface CatalogFormProps {
  definition: CatalogFormDefinition;
  careers?: CatalogCareerSource;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (values: CatalogFormValues) => Promise<void>;
}

function CatalogForm({ definition, careers, submitting, onCancel, onSubmit }: CatalogFormProps) {
  const form = useForm<CatalogFormValues>({
    resolver: zodResolver(definition.schema),
    defaultValues: definition.defaultValues,
  });

  return (
    <Form {...form}>
      <form
        noValidate
        onSubmit={(event) => {
          void form.handleSubmit(onSubmit)(event);
        }}
        className="space-y-4"
      >
        {definition.fields.map((fieldDef) => (
          <FormField
            key={fieldDef.name}
            control={form.control}
            name={fieldDef.name}
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {fieldDef.label}
                  {fieldDef.required && (
                    <span aria-hidden="true" className="text-danger-foreground">
                      {" "}
                      *
                    </span>
                  )}
                </FormLabel>
                {fieldDef.kind === "career" ? (
                  <>
                    <SearchableCombobox
                      value={typeof field.value === "number" ? String(field.value) : ""}
                      onValueChange={(value) => field.onChange(value === "" ? undefined : Number(value))}
                      options={(careers?.items ?? [])
                        .filter((career) => career.status === "ACTIVO")
                        .map((career) => ({ value: String(career.id), label: career.name, description: career.code }))}
                      placeholder={careers?.isLoading ? "Cargando carreras…" : "Seleccione una carrera"}
                      searchPlaceholder="Buscar carrera…"
                      emptyMessage="No hay carreras disponibles."
                      disabled={!careers || careers.isLoading || careers.unavailableReason !== null}
                    />
                    {careers?.unavailableReason && (
                      <p className="text-xs text-muted-foreground">{careers.unavailableReason}</p>
                    )}
                  </>
                ) : (
                  <FormControl>
                    <Input
                      type={fieldDef.kind === "number" ? "number" : "text"}
                      placeholder={fieldDef.placeholder}
                      autoComplete="off"
                      value={typeof field.value === "string" || typeof field.value === "number" ? field.value : ""}
                      onChange={(event) =>
                        field.onChange(
                          fieldDef.kind === "number"
                            ? event.target.value === ""
                              ? undefined
                              : Number(event.target.value)
                            : event.target.value,
                        )
                      }
                      onBlur={field.onBlur}
                      name={field.name}
                      ref={field.ref}
                    />
                  </FormControl>
                )}
                <FormMessage />
              </FormItem>
            )}
          />
        ))}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
            Cancelar
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            Guardar
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}
