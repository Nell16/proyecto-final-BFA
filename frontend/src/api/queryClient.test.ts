import { describe, expect, it } from "vitest";
import { ApiError } from "./errors";
import { DEFAULT_STALE_TIME_MS, isRuntimeKey, queryClient, shouldRetryQuery } from "./queryClient";
import { resetAccountScopedState } from "../store/accountReset";

const apiError = (status: number, code = `HTTP_${status}`) => new ApiError({ status, code, message: "x" });

describe("QueryClient: defaults", () => {
  it("staleTime 30 s y sin refetch al enfocar la ventana", () => {
    const defaults = queryClient.getDefaultOptions().queries;
    expect(defaults?.staleTime).toBe(DEFAULT_STALE_TIME_MS);
    expect(DEFAULT_STALE_TIME_MS).toBe(30_000);
    expect(defaults?.refetchOnWindowFocus).toBe(false);
  });

  it("no reintenta 4xx", () => {
    for (const status of [400, 401, 403, 404, 409, 422, 499]) {
      expect(shouldRetryQuery(0, apiError(status)), String(status)).toBe(false);
    }
  });

  it("reintenta hasta 2 veces en red/timeout y 5xx", () => {
    for (const error of [apiError(0, "NETWORK"), apiError(0, "TIMEOUT"), apiError(500), apiError(503)]) {
      expect(shouldRetryQuery(0, error)).toBe(true);
      expect(shouldRetryQuery(1, error)).toBe(true);
      expect(shouldRetryQuery(2, error)).toBe(false);
    }
  });

  it("no reintenta contrato inválido, cancelaciones ni errores desconocidos", () => {
    expect(shouldRetryQuery(0, apiError(0, "CONTRACT_MISMATCH"))).toBe(false);
    expect(shouldRetryQuery(0, apiError(0, "CANCELED"))).toBe(false);
    expect(shouldRetryQuery(0, new Error("bug"))).toBe(false);
  });

  it("el retry por defecto del cliente es esa política", () => {
    expect(queryClient.getDefaultOptions().queries?.retry).toBe(shouldRetryQuery);
  });
});

describe("resetAccountScopedState y el prefijo `runtime`", () => {
  it("isRuntimeKey solo mira el primer segmento", () => {
    expect(isRuntimeKey(["runtime", "x"])).toBe(true);
    expect(isRuntimeKey(["runtime"])).toBe(true);
    expect(isRuntimeKey(["auth", "runtime"])).toBe(false);
    expect(isRuntimeKey(["runtimeX"])).toBe(false);
    expect(isRuntimeKey(undefined)).toBe(false);
  });

  it("elimina queries y mutations de staff y conserva las `runtime`", async () => {
    queryClient.setQueryData(["auth", "me", 1], { id: "alice" });
    queryClient.setQueryData(["sessions", "list"], [1]);
    queryClient.setQueryData(["runtime", "evaluation", 7], { attempt: 1 });
    await queryClient.getMutationCache().build(queryClient, { mutationKey: ["sessions", "create"], mutationFn: async () => 1 }).execute(undefined);
    await queryClient.getMutationCache().build(queryClient, { mutationKey: ["runtime", "answer"], mutationFn: async () => 1 }).execute(undefined);
    await queryClient.getMutationCache().build(queryClient, { mutationFn: async () => 1 }).execute(undefined); // sin key => de staff

    resetAccountScopedState();

    expect(queryClient.getQueryData(["auth", "me", 1])).toBeUndefined();
    expect(queryClient.getQueryData(["sessions", "list"])).toBeUndefined();
    expect(queryClient.getQueryData(["runtime", "evaluation", 7])).toEqual({ attempt: 1 });
    const remaining = queryClient.getMutationCache().getAll().map((m) => m.options.mutationKey);
    expect(remaining).toEqual([["runtime", "answer"]]);

    queryClient.clear(); // no contaminar otros tests del archivo
  });
});
