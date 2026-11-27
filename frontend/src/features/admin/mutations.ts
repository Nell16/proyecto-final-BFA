import { useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  assignRole,
  createUser,
  removeRole,
  setRolePermissions,
  setUserStatus,
  type CreateUserInput,
  type UserStatusInput,
} from "../../api/endpoints/admin";
import { createAccountScopedMutation, isScopeCurrent } from "../accountScopedMutation";
import { adminKeys } from "./queries";

const scoped = createAccountScopedMutation();

/**
 * Asa de un secreto de un solo uso. La contraseña vive en un closure que `take()` vacía al leerla, así que
 * NUNCA forma parte de las `variables` que TanStack Query guarda en `MutationCache` y en el observador
 * (un objeto con funciones no la expone ni al serializar ni al recorrer sus propiedades).
 */
export interface SecretHandle {
  /** Devuelve el secreto y lo descarta: una segunda lectura lanza. */
  take(): string;
}

export function createSecretHandle(secret: string): SecretHandle {
  let value: string | null = secret;
  return {
    take() {
      if (value === null) throw new Error("El secreto ya fue consumido.");
      const taken = value;
      value = null;
      return taken;
    },
  };
}

/** Variables de `useCreateUser`: igual que `CreateUserInput` pero con la contraseña como asa de un solo uso. */
export type CreateUserDraft = Omit<CreateUserInput, "password"> & { secret: SecretHandle };

/**
 * Crea un usuario con contraseña inicial escrita por el administrador.
 *
 * La contraseña no viaja en las `variables` (ver `SecretHandle`). Al terminar, con éxito o error, se llama a
 * `reset()` del observador y se retira la mutación de `MutationCache` para no retener nada en memoria.
 * Sin reintentos: el secreto es de un solo uso.
 */
export function useCreateUser() {
  const qc = useQueryClient();
  const mutation = useMutation({
    gcTime: 0,
    retry: false,
    mutationKey: [...adminKeys.all, "users", "create"],
    onMutate: scoped.onMutate,
    mutationFn: ({ secret, ...rest }: CreateUserDraft, ctx) => {
      scoped.guard(ctx);
      return createUser({ ...rest, password: secret.take() });
    },
    onSuccess: (_data, _vars, context) => {
      if (!isScopeCurrent(context)) return;
      void qc.invalidateQueries({ queryKey: adminKeys.users() });
      void qc.invalidateQueries({ queryKey: adminKeys.permissionMatrix() });
    },
  });

  const { mutateAsync: rawMutateAsync, reset } = mutation;
  const mutateAsync = useCallback(
    async (draft: CreateUserDraft) => {
      try {
        return await rawMutateAsync(draft);
      } finally {
        reset();
        const cache = qc.getMutationCache();
        for (const entry of cache.getAll()) {
          if (entry.state.variables === draft) cache.remove(entry);
        }
      }
    },
    [rawMutateAsync, reset, qc],
  );
  const mutate = useCallback(
    (draft: CreateUserDraft) => {
      mutateAsync(draft).catch(() => {});
    },
    [mutateAsync],
  );

  return { ...mutation, mutate, mutateAsync };
}

export function useSetUserStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: [...adminKeys.all, "users", "status"],
    onMutate: scoped.onMutate,
    mutationFn: ({ userId, status }: { userId: string; status: UserStatusInput }, ctx) => {
      scoped.guard(ctx);
      return setUserStatus(userId, status);
    },
    onSuccess: (_data, _vars, context) => {
      if (!isScopeCurrent(context)) return;
      void qc.invalidateQueries({ queryKey: adminKeys.users() });
      void qc.invalidateQueries({ queryKey: adminKeys.permissionMatrix() });
    },
  });
}

export function useAssignUserRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: [...adminKeys.all, "users", "assign-role"],
    onMutate: scoped.onMutate,
    mutationFn: ({ userId, roleId }: { userId: string; roleId: number }, ctx) => {
      scoped.guard(ctx);
      return assignRole(userId, roleId);
    },
    onSuccess: (_data, _vars, context) => {
      if (!isScopeCurrent(context)) return;
      void qc.invalidateQueries({ queryKey: adminKeys.permissionMatrix() });
    },
  });
}

export function useRemoveUserRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: [...adminKeys.all, "users", "remove-role"],
    onMutate: scoped.onMutate,
    mutationFn: ({ userId, roleId }: { userId: string; roleId: number }, ctx) => {
      scoped.guard(ctx);
      return removeRole(userId, roleId);
    },
    onSuccess: (_data, _vars, context) => {
      if (!isScopeCurrent(context)) return;
      void qc.invalidateQueries({ queryKey: adminKeys.permissionMatrix() });
    },
  });
}

export function useUpdateRolePermissions() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: [...adminKeys.all, "roles", "update-permissions"],
    onMutate: scoped.onMutate,
    mutationFn: ({ roleId, permissionIds }: { roleId: number; permissionIds: number[] }, ctx) => {
      scoped.guard(ctx);
      return setRolePermissions(roleId, permissionIds);
    },
    onSuccess: (_data, vars, context) => {
      if (!isScopeCurrent(context)) return;
      void qc.invalidateQueries({ queryKey: adminKeys.rolePermissions(vars.roleId) });
      void qc.invalidateQueries({ queryKey: adminKeys.permissionMatrix() });
    },
  });
}
