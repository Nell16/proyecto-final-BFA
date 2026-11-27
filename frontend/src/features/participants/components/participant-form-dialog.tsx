import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useForm, useWatch } from "react-hook-form";
import {
  ParticipantInputSchema,
  type AcademicGroup,
  type Career,
  type Cohort,
  type ParticipantInput,
  type Sex,
} from "../../../api/schemas/academic";
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
import { SearchableCombobox, type SearchableComboboxOption } from "../../../app/components/ui/searchable-combobox";
import type { UseCatalogResult } from "../../catalogs/use-catalog";

export interface ParticipantFormCatalogs {
  sexes: UseCatalogResult<"sexos">;
  careers: UseCatalogResult<"carreras">;
  cohorts: UseCatalogResult<"cohortes">;
  groups: UseCatalogResult<"grupos-academicos">;
}

interface ParticipantFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  catalogs: ParticipantFormCatalogs;
  /** Debe rechazar si falla: el diálogo queda abierto para corregir y reintentar. */
  onSubmit: (input: ParticipantInput) => Promise<void>;
}

const EMPTY_VALUES: ParticipantInput = { code: "", firstNames: "", lastNames: "", birthDate: "" };

const toOptions = (items: readonly (Sex | Career | Cohort | AcademicGroup)[]): SearchableComboboxOption[] =>
  items
    .filter((item) => item.status === "ACTIVO")
    .map((item) => ({ value: String(item.id), label: item.name, description: item.code }));

export function ParticipantFormDialog({ open, onOpenChange, catalogs, onSubmit }: ParticipantFormDialogProps) {
  const [submitting, setSubmitting] = useState(false);

  return (
    <Dialog open={open} onOpenChange={(next) => (submitting ? undefined : onOpenChange(next))}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Registrar participante</DialogTitle>
          <DialogDescription>Complete los datos del participante. Los campos con * son obligatorios.</DialogDescription>
        </DialogHeader>
        <ParticipantForm
          catalogs={catalogs}
          submitting={submitting}
          onCancel={() => onOpenChange(false)}
          onSubmit={async (input) => {
            setSubmitting(true);
            try {
              await onSubmit(input);
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

interface ParticipantFormProps {
  catalogs: ParticipantFormCatalogs;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (input: ParticipantInput) => Promise<void>;
}

function RequiredMark() {
  return (
    <span aria-hidden="true" className="text-danger-foreground">
      {" "}
      *
    </span>
  );
}

function ParticipantForm({ catalogs, submitting, onCancel, onSubmit }: ParticipantFormProps) {
  const form = useForm<ParticipantInput>({
    resolver: zodResolver(ParticipantInputSchema),
    defaultValues: EMPTY_VALUES,
  });
  const selectedCareerId = useWatch({ control: form.control, name: "careerId" });

  // Si hay carrera elegida, solo se ofrecen los grupos de esa carrera (o sin carrera asociada).
  const groupItems = catalogs.groups.items.filter(
    (group) => selectedCareerId === undefined || group.careerId === undefined || group.careerId === selectedCareerId,
  );

  const catalogFields = [
    { name: "sexId", label: "Sexo", placeholder: "Seleccione sexo", source: catalogs.sexes, options: toOptions(catalogs.sexes.items) },
    { name: "careerId", label: "Carrera", placeholder: "Seleccione carrera", source: catalogs.careers, options: toOptions(catalogs.careers.items) },
    { name: "cohortId", label: "Cohorte", placeholder: "Seleccione cohorte", source: catalogs.cohorts, options: toOptions(catalogs.cohorts.items) },
    { name: "groupId", label: "Grupo académico", placeholder: "Seleccione grupo", source: catalogs.groups, options: toOptions(groupItems) },
  ] as const;

  return (
    <Form {...form}>
      <form
        noValidate
        onSubmit={(event) => {
          void form.handleSubmit(onSubmit)(event);
        }}
        className="space-y-4"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="code"
            render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel>
                  Código de participante
                  <RequiredMark />
                </FormLabel>
                <FormControl>
                  <Input placeholder="Ej.: PART-2026-001" autoComplete="off" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="firstNames"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Nombres
                  <RequiredMark />
                </FormLabel>
                <FormControl>
                  <Input autoComplete="off" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="lastNames"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Apellidos
                  <RequiredMark />
                </FormLabel>
                <FormControl>
                  <Input autoComplete="off" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="birthDate"
            render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel>Fecha de nacimiento</FormLabel>
                <FormControl>
                  <Input type="date" {...field} value={field.value ?? ""} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          {catalogFields.map(({ name, label, placeholder, source, options }) => (
            <FormField
              key={name}
              control={form.control}
              name={name}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{label}</FormLabel>
                  <SearchableCombobox
                    value={field.value === undefined ? "" : String(field.value)}
                    onValueChange={(value) => field.onChange(value === "" ? undefined : Number(value))}
                    options={options}
                    placeholder={source.isLoading ? "Cargando…" : placeholder}
                    searchPlaceholder={`Buscar ${label.toLowerCase()}…`}
                    emptyMessage="No hay opciones disponibles."
                    disabled={source.isLoading || source.unavailableReason !== null}
                  />
                  {source.unavailableReason && (
                    <p className="text-xs text-muted-foreground">{source.unavailableReason}</p>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />
          ))}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
            Cancelar
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            Registrar
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}
