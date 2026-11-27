import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { http } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { containsText } from "../../../test/collectStrings";
import { server } from "../../../test/msw/server";
import { createSecretHandle, useCreateUser } from "../mutations";
import { API, clearStaffUser, ok, serverError, setStaffUser } from "./testUtils";

const PASSWORD = "Segura2026!";
const USER = { id: "44444444-4444-4444-4444-444444444444", username: "lmendoza", email: "l@uam.edu.ni", fullName: "Laura", status: "ACTIVO" };

function setup() {
  setStaffUser({ permissions: ["USUARIO_CREAR"], token: "token-a" });
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useCreateUser(), { wrapper });
  const draft = () => ({
    username: "lmendoza",
    email: "l@uam.edu.ni",
    fullName: "Laura",
    secret: createSecretHandle(PASSWORD),
  });
  return { queryClient, hook, draft };
}

afterEach(() => clearStaffUser());

describe("useCreateUser — la contraseña no queda en el estado de la mutación (hallazgo MEDIO)", () => {
  it("éxito: ni durante ni después hay contraseña en MutationCache ni en el estado del observador, y se hace reset()", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    let body: Record<string, unknown> | null = null;
    server.use(
      http.post(`${API}/users`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        await gate;
        return ok(USER);
      }),
    );
    const { queryClient, hook, draft } = setup();

    let promise!: Promise<unknown>;
    act(() => {
      promise = hook.result.current.mutateAsync(draft());
    });
    await waitFor(() => expect(hook.result.current.isPending).toBe(true));
    await waitFor(() => expect(body).not.toBeNull());

    // EN VUELO: el backend sí recibe la contraseña, pero el estado de React Query no.
    expect(body).toMatchObject({ password: PASSWORD });
    expect(containsText(hook.result.current, PASSWORD)).toBe(false);
    expect(containsText(queryClient.getMutationCache().getAll(), PASSWORD)).toBe(false);

    await act(async () => {
      release();
      await promise;
    });

    await waitFor(() => expect(hook.result.current.status).toBe("idle")); // reset() del observador
    expect(hook.result.current.variables).toBeUndefined();
    expect(containsText(hook.result.current, PASSWORD)).toBe(false);
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
  });

  it("500: el error no contiene la contraseña; el observador queda en reset y la mutación sale de la caché", async () => {
    server.use(http.post(`${API}/users`, () => serverError("Fallo al crear")));
    const { queryClient, hook, draft } = setup();

    let caught: unknown;
    await act(async () => {
      caught = await hook.result.current.mutateAsync(draft()).catch((error: unknown) => error);
    });

    expect(caught).toBeInstanceOf(Error);
    expect(containsText(caught, PASSWORD)).toBe(false);
    await waitFor(() => expect(hook.result.current.status).toBe("idle"));
    expect(hook.result.current.error).toBeNull();
    expect(containsText(hook.result.current, PASSWORD)).toBe(false);
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
  });

  it("el asa es de un solo uso: una segunda lectura lanza y no devuelve la contraseña", () => {
    const handle = createSecretHandle(PASSWORD);
    expect(handle.take()).toBe(PASSWORD);
    expect(() => handle.take()).toThrow(/ya fue consumido/);
  });
});
