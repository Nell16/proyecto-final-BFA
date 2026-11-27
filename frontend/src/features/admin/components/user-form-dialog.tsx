import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, Circle, Eye, EyeOff, Loader2 } from "lucide-react";
import { useForm, useWatch } from "react-hook-form";
import {
  CreateUserFormSchema,
  PASSWORD_RULES,
  type CreateUserFormValues,
  type Role,
} from "../../../api/schemas/admin";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../app/components/ui/select";
import { cn } from "../../../app/components/ui/utils";

const NO_ROLE = "__none__";

const EMPTY_VALUES: CreateUserFormValues = {
  username: "",
  fullName: "",
  email: "",
  password: "",
  confirmPassword: "",
  roleId: undefined,
};

interface UserFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roles: readonly Role[];
  canAssignRole: boolean;
  rolesUnavailable?: boolean;
  /** Debe rechazar si falla la creación para mantener el diálogo abierto. */
  onSubmit: (values: CreateUserFormValues) => Promise<void>;
}

export function UserFormDialog({
  open,
  onOpenChange,
  roles,
  canAssignRole,
  rolesUnavailable = false,
  onSubmit,
}: UserFormDialogProps) {
  const [submitting, setSubmitting] = useState(false);

  return (
    <Dialog open={open} onOpenChange={(next) => (submitting ? undefined : onOpenChange(next))}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nuevo usuario</DialogTitle>
          <DialogDescription>
            Registra una cuenta de personal con contraseña inicial segura. Los campos con * son obligatorios.
          </DialogDescription>
        </DialogHeader>
        {open && (
          <UserForm
            roles={roles}
            canAssignRole={canAssignRole}
            rolesUnavailable={rolesUnavailable}
            submitting={submitting}
            onCancel={() => onOpenChange(false)}
            onSubmit={async (values) => {
              setSubmitting(true);
              try {
                await onSubmit(values);
                onOpenChange(false);
              } catch {
                // El llamador ya mostró el error; el diálogo permanece abierto para corregir.
              } finally {
                setSubmitting(false);
              }
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

interface UserFormProps {
  roles: readonly Role[];
  canAssignRole: boolean;
  rolesUnavailable: boolean;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (values: CreateUserFormValues) => Promise<void>;
}

function RequiredMark() {
  return (
    <span aria-hidden="true" className="text-status-danger-fg">
      {" "}
      *
    </span>
  );
}

function UserForm({ roles, canAssignRole, rolesUnavailable, submitting, onCancel, onSubmit }: UserFormProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const form = useForm<CreateUserFormValues>({
    resolver: zodResolver(CreateUserFormSchema),
    defaultValues: EMPTY_VALUES,
  });

  const passwordValue = useWatch({ control: form.control, name: "password" }) ?? "";

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
            name="fullName"
            render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel>
                  Nombre completo
                  <RequiredMark />
                </FormLabel>
                <FormControl>
                  <Input placeholder="Ej.: Dra. María López" autoComplete="name" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="username"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Nombre de usuario
                  <RequiredMark />
                </FormLabel>
                <FormControl>
                  <Input placeholder="Ej.: mlopez" autoComplete="off" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Correo electrónico
                  <RequiredMark />
                </FormLabel>
                <FormControl>
                  <Input type="email" placeholder="correo@uam.edu.ni" autoComplete="email" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {canAssignRole && (
            <FormField
              control={form.control}
              name="roleId"
              render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>Rol inicial (opcional)</FormLabel>
                  <Select
                    value={field.value === undefined ? NO_ROLE : String(field.value)}
                    onValueChange={(value) => field.onChange(value === NO_ROLE ? undefined : Number(value))}
                    disabled={rolesUnavailable || roles.length === 0 || submitting}
                  >
                    <FormControl>
                      <SelectTrigger aria-label="Rol inicial">
                        <SelectValue placeholder="Sin rol inicial" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={NO_ROLE}>Sin rol inicial</SelectItem>
                      {roles.map((role) => (
                        <SelectItem key={role.id} value={String(role.id)}>
                          {role.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {rolesUnavailable && (
                    <p className="text-xs text-muted-foreground">
                      No se pudo cargar el catálogo de roles. Podrás asignarlo después.
                    </p>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />
          )}

          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel>
                  Contraseña inicial
                  <RequiredMark />
                </FormLabel>
                <div className="relative">
                  <FormControl>
                    <Input
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      className="pr-10"
                      {...field}
                    />
                  </FormControl>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1/2 size-7 -translate-y-1/2"
                    aria-label={showPassword ? "Ocultar contraseña inicial" : "Mostrar contraseña inicial"}
                    aria-pressed={showPassword}
                    onClick={() => setShowPassword((prev) => !prev)}
                  >
                    {showPassword ? (
                      <EyeOff className="size-4" aria-hidden="true" />
                    ) : (
                      <Eye className="size-4" aria-hidden="true" />
                    )}
                  </Button>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="rounded-md border border-border bg-muted/40 p-3 sm:col-span-2">
            <p className="mb-2 text-xs font-medium text-foreground">Requisitos de fortaleza</p>
            <ul className="grid gap-1.5 sm:grid-cols-2" aria-label="Requisitos de contraseña">
              {PASSWORD_RULES.map((rule) => {
                const met = rule.test(passwordValue);
                return (
                  <li
                    key={rule.id}
                    className={cn(
                      "flex items-center gap-1.5 text-xs",
                      met ? "text-status-success-fg" : "text-muted-foreground",
                    )}
                  >
                    {met ? (
                      <CheckCircle2 className="size-3.5 shrink-0" aria-hidden="true" />
                    ) : (
                      <Circle className="size-3.5 shrink-0" aria-hidden="true" />
                    )}
                    <span>{rule.label}</span>
                  </li>
                );
              })}
            </ul>
          </div>

          <FormField
            control={form.control}
            name="confirmPassword"
            render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel>
                  Confirmar contraseña
                  <RequiredMark />
                </FormLabel>
                <div className="relative">
                  <FormControl>
                    <Input
                      type={showConfirm ? "text" : "password"}
                      autoComplete="new-password"
                      className="pr-10"
                      {...field}
                    />
                  </FormControl>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1/2 size-7 -translate-y-1/2"
                    aria-label={showConfirm ? "Ocultar confirmación de contraseña" : "Mostrar confirmación de contraseña"}
                    aria-pressed={showConfirm}
                    onClick={() => setShowConfirm((prev) => !prev)}
                  >
                    {showConfirm ? (
                      <EyeOff className="size-4" aria-hidden="true" />
                    ) : (
                      <Eye className="size-4" aria-hidden="true" />
                    )}
                  </Button>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
            Cancelar
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            Registrar usuario
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}
