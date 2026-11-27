import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { delay, http } from "msw";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { queryClient } from "../../../api/queryClient";
import { isAccountChangedError } from "../../../store/accountScope";
import { useStaffAuth } from "../../../store/staffAuth";
import { server } from "../../../test/msw/server";
import { useSetUserStatus, useUpdateRolePermissions } from "../mutations";
import { adminKeys } from "../queries";
import { API, clearStaffUser, ok, setStaffUser } from "./testUtils";

describe("mutaciones admin frente a cambio de cuenta", () => {
  afterEach(() => {
    clearStaffUser();
    queryClient.clear();
  });

  it("descarta caché admin al cambiar de cuenta y no publica resultados de la cuenta saliente", async () => {
    let requestSent = false;
    server.use(
      http.patch(`${API}/users/22222222-2222-2222-2222-222222222222/status`, async () => {
        requestSent = true;
        await delay(120);
        return ok({
          id: "22222222-2222-2222-2222-222222222222",
          username: "aplicador1",
          email: "aplicador1@uam.edu.ni",
          fullName: "Ana García",
          status: "INACTIVO",
        });
      }),
    );

    setStaffUser({
      id: "11111111-1111-1111-1111-111111111111",
      username: "adminA",
      permissions: ["USUARIO_MODIFICAR"],
      token: "token-a",
    });

    // Datos previos en caché de la cuenta A y datos runtime (participante) que deben sobrevivir
    queryClient.setQueryData(adminKeys.permissionMatrix(), { permissionColumns: [], users: [] });
    queryClient.setQueryData(["runtime", "evaluation", 1], { attemptId: 1 });

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useSetUserStatus(), { wrapper });

    act(() => {
      result.current.mutate({ userId: "22222222-2222-2222-2222-222222222222", status: "INACTIVO" });
    });

    await waitFor(() => expect(requestSent).toBe(true));

    // Cambia a cuenta B mientras la petición está en vuelo
    act(() => {
      useStaffAuth.getState().setSession({
        token: "token-b",
        expiresAt: null,
        user: {
          id: "99999999-9999-9999-9999-999999999999",
          username: "adminB",
          roles: ["ADMIN"],
          permissions: ["USUARIO_MODIFICAR"],
        },
      });
    });

    // La caché admin se limpió al cambiar de cuenta, mientras runtime permanece
    expect(queryClient.getQueryData(adminKeys.permissionMatrix())).toBeUndefined();
    expect(queryClient.getQueryData(["runtime", "evaluation", 1])).toEqual({ attemptId: 1 });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // La respuesta tardía de cuenta A no vuelve a poblar caché para cuenta B
    expect(queryClient.getQueryData(adminKeys.permissionMatrix())).toBeUndefined();
  });

  it("useUpdateRolePermissions invalida caché si la cuenta es la misma y aborta si cambió antes de enviar", async () => {
    server.use(http.put(`${API}/roles/2/permissions`, () => ok(null)));

    setStaffUser({
      id: "11111111-1111-1111-1111-111111111111",
      username: "adminA",
      permissions: ["ROL_MODIFICAR"],
      token: "token-a",
    });

    queryClient.setQueryData(adminKeys.rolePermissions(2), [{ id: 10, code: "USUARIO_LEER", description: null }]);

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useUpdateRolePermissions(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ roleId: 2, permissionIds: [10, 11] });
    });
    expect(queryClient.getQueryState(adminKeys.rolePermissions(2))?.isInvalidated).toBe(true);

    // Si onMutate captura cuenta A y antes de mutationFn cambia a cuenta B -> ACCOUNT_CHANGED
    const err = await act(async () => {
      try {
        const promise = result.current.mutateAsync({ roleId: 2, permissionIds: [10] });
        useStaffAuth.getState().setSession({ token: "token-b", expiresAt: null });
        await promise;
        return null;
      } catch (error) {
        return error;
      }
    });
    if (err !== null) {
      expect(isAccountChangedError(err)).toBe(true);
    }
  });
});
