import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { delay, http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider, onlineManager, type MutationFunctionContext } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { server } from "../../test/msw/server";
import sessionsFixture from "../../api/schemas/__fixtures__/sessions/sessions.json";
import { useStaffAuth } from "../../store/staffAuth";
import { isAccountChangedError } from "../../store/accountScope";
import { createAccountScopedMutation } from "../accountScopedMutation";
import { useAssignParticipant, useSessionTransition } from "./mutations";
import { sessionKeys } from "./queries";

const API = "http://localhost:8080";

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

afterEach(() => useStaffAuth.getState().clear());

describe("mutaciones de sesión frente a un cambio de cuenta", () => {
  it("una transición que resuelve después de cambiar sessionId no publica el detalle en caché", async () => {
    let requested = false;
    server.use(
      http.post(`${API}/sesiones/1/activar`, async () => {
        requested = true;
        await delay(250);
        return HttpResponse.json({ success: true, data: { ...sessionsFixture[0], estado: "ABIERTA" } });
      }),
    );
    const { queryClient, wrapper } = setup();
    const { result } = renderHook(() => useSessionTransition(1), { wrapper });

    act(() => result.current.mutate({ action: "open" }));
    await waitFor(() => expect(requested).toBe(true)); // la petición ya está en vuelo
    // Cambia la cuenta en mitad de la petición.
    useStaffAuth.getState().setSession({ token: "otra-cuenta", expiresAt: null });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(queryClient.getQueryData(sessionKeys.detail(1))).toBeUndefined();
  });

  it("sin cambio de cuenta publica el detalle", async () => {
    server.use(
      http.post(`${API}/sesiones/1/activar`, () =>
        HttpResponse.json({ success: true, data: { ...sessionsFixture[0], estado: "ABIERTA" } }),
      ),
    );
    const { queryClient, wrapper } = setup();
    const { result } = renderHook(() => useSessionTransition(1), { wrapper });
    act(() => result.current.mutate({ action: "open" }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.getQueryData(sessionKeys.detail(1))).toMatchObject({ status: "ABIERTA" });
  });

  it("el guard de mutationFn lanza ACCOUNT_CHANGED si la cuenta cambió desde onMutate", () => {
    const scoped = createAccountScopedMutation();
    const ctx = {} as MutationFunctionContext;
    scoped.onMutate(undefined, ctx);
    expect(() => scoped.guard(ctx)).not.toThrow();
    useStaffAuth.getState().setSession({ token: "x", expiresAt: null });
    try {
      scoped.guard(ctx);
      expect.unreachable();
    } catch (error) {
      expect(isAccountChangedError(error)).toBe(true);
    }
  });
});

describe("useAssignParticipant con AbortSignal", () => {
  afterEach(() => onlineManager.setOnline(true));

  it("un POST pausado sin conexión no se envía al reconectar si el lote se abortó", async () => {
    let posts = 0;
    server.use(
      http.post(`${API}/sesiones/1/asignaciones`, () => {
        posts += 1;
        return HttpResponse.json({
          success: true,
          data: { assignmentId: 1, rawToken: "T", expiresAt: "2026-11-24T20:00:00" },
        });
      }),
    );
    const { wrapper } = setup();
    const { result } = renderHook(() => useAssignParticipant(1), { wrapper });
    const controller = new AbortController();

    onlineManager.setOnline(false);
    act(() => result.current.mutate({ participantId: "p1", signal: controller.signal }));
    await waitFor(() => expect(result.current.isPaused).toBe(true));

    controller.abort();
    onlineManager.setOnline(true);
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(posts).toBe(0);
    expect(result.current.error).toMatchObject({ code: "CANCELED" });
  });
});

describe("useAssignParticipant y la MutationCache", () => {
  it("tras entregar el resultado ninguna mutación en caché conserva el rawToken", async () => {
    server.use(
      http.post(`${API}/sesiones/1/asignaciones`, () => HttpResponse.json({ success: false }, { status: 500 }), {
        once: true,
      }),
      http.post(`${API}/sesiones/1/asignaciones`, () =>
        HttpResponse.json({
          success: true,
          data: { assignmentId: 1, rawToken: "tok-secreto-xyz", expiresAt: "2026-11-24T20:00:00" },
        }),
      ),
    );
    const { queryClient, wrapper } = setup();
    const { result } = renderHook(() => useAssignParticipant(1), { wrapper });

    // El primer POST falla (handler once); el segundo y tercero tienen éxito.
    await expect(result.current.mutateAsync({ participantId: "p0" })).rejects.toBeTruthy();
    const delivered: string[] = [];
    for (const id of ["p1", "p2"]) {
      const data = await result.current.mutateAsync({ participantId: id, signal: new AbortController().signal });
      delivered.push(data.rawToken);
      const dump = JSON.stringify(queryClient.getMutationCache().getAll());
      expect(dump).not.toContain("tok-secreto-xyz");
      expect(dump).not.toContain("rawToken");
    }
    expect(delivered).toEqual(["tok-secreto-xyz", "tok-secreto-xyz"]);
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
  });
  it("canSend se evalúa en el punto de envío: una mutación pausada no envía si deja de permitirse antes de reanudar", async () => {
    let posts = 0;
    server.use(
      http.post(`${API}/sesiones/1/asignaciones`, () => {
        posts += 1;
        return HttpResponse.json({
          success: true,
          data: { assignmentId: 1, rawToken: "T", expiresAt: "2026-11-24T20:00:00" },
        });
      }),
    );
    const { wrapper } = setup();
    const { result } = renderHook(() => useAssignParticipant(1), { wrapper });
    let allowed = true;

    onlineManager.setOnline(false);
    act(() => result.current.mutate({ participantId: "p1", canSend: () => allowed }));
    await waitFor(() => expect(result.current.isPaused).toBe(true));

    allowed = false; // p. ej. llegó un 403 de lectura; ninguna señal se abortó
    onlineManager.setOnline(true);
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(posts).toBe(0);
    expect(result.current.error).toMatchObject({ code: "CANCELED" });
  });
});
