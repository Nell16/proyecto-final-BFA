import { beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../test/msw/server";
import { containsText } from "../test/collectStrings";
import { useStaffAuth } from "../store/staffAuth";
import { staffClient } from "./client";
import { ApiError, safeErrorLog, toApiError } from "./errors";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), warning: vi.fn(), dismiss: vi.fn() }) }));

const API = "http://localhost:8080";
const JWT = "eyJhbGciOiJIUzI1NiJ9.SECRET-PAYLOAD.SECRET-SIGNATURE";
const BODY_SECRET = "Clave-Inicial-9!";

beforeEach(() => {
  useStaffAuth.getState().clear();
  useStaffAuth.getState().setSession({
    token: JWT,
    expiresAt: null,
    user: { id: "u1", username: "ana", roles: [], permissions: [] },
  });
});

const failWith = async (status: number): Promise<unknown> => {
  server.use(
    http.post(`${API}/secreto`, () =>
      HttpResponse.json(
        { success: false, message: "Falló", error: { code: "BOOM", message: "Falló", details: ["d1"] }, correlationId: "c-1" },
        { status },
      ),
    ),
  );
  return staffClient.post("/secreto", { password: BODY_SECRET }).catch((e: unknown) => e);
};

describe("ApiError no retiene credenciales (hallazgo ALTO)", () => {
  it("un 500 no deja JWT, Authorization ni el body enviado en ninguna propiedad propia o anidada", async () => {
    const error = await failWith(500);

    expect(error).toBeInstanceOf(ApiError);
    for (const secret of [JWT, "SECRET-PAYLOAD", "Authorization", "Bearer", BODY_SECRET, "sentToken"]) {
      expect(containsText(error, secret), `fuga de «${secret}»`).toBe(false);
    }
    expect(JSON.stringify(error)).not.toContain(JWT);
  });

  it("sin respuesta (red) o timeout tampoco conserva el config de axios", async () => {
    server.use(http.post(`${API}/secreto`, () => HttpResponse.error()));
    const error = await staffClient.post("/secreto", { password: BODY_SECRET }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("NETWORK");
    for (const secret of [JWT, "Authorization", BODY_SECRET, "sentToken"]) {
      expect(containsText(error, secret), `fuga de «${secret}»`).toBe(false);
    }
  });

  it("conserva status, code, message, details y correlationId, y ya no expone `response`", async () => {
    const error = (await failWith(500)) as ApiError;

    expect(error.status).toBe(500);
    expect(error.code).toBe("BOOM");
    expect(error.message).toBe("Falló");
    expect(error.details).toEqual(["d1"]);
    expect(error.correlationId).toBe("c-1");
    expect("response" in error).toBe(false);
  });

  it("toApiError sobre un AxiosError crudo con config sensible descarta config/request/headers", () => {
    const raw = Object.assign(new Error("Request failed with status code 500"), {
      isAxiosError: true,
      code: "ERR_BAD_RESPONSE",
      config: { headers: { Authorization: `Bearer ${JWT}` }, data: JSON.stringify({ password: BODY_SECRET }) },
      request: { headers: { Authorization: `Bearer ${JWT}` } },
      response: { status: 500, data: { error: { code: "X" } }, config: { headers: { Authorization: `Bearer ${JWT}` } } },
    });

    const apiError = toApiError(raw);

    expect(apiError.status).toBe(500);
    expect(containsText(apiError, JWT)).toBe(false);
    expect(containsText(apiError, BODY_SECRET)).toBe(false);
    expect(containsText(apiError, "Authorization")).toBe(false);
  });
});

describe("safeErrorLog", () => {
  it("de un ApiError solo expone campos seguros", async () => {
    const error = await failWith(500);

    const logged = safeErrorLog(error);

    expect(logged).toMatchObject({ name: "ApiError", status: 500, code: "BOOM", correlationId: "c-1" });
    expect(containsText(logged, JWT)).toBe(false);
    expect(containsText(logged, BODY_SECRET)).toBe(false);
  });

  it("de un AxiosError crudo no copia config ni request", () => {
    const raw = Object.assign(new Error("Network Error"), {
      isAxiosError: true,
      code: "ERR_NETWORK",
      config: { headers: { Authorization: `Bearer ${JWT}` } },
    });

    expect(containsText(safeErrorLog(raw), JWT)).toBe(false);
  });

  it("de un valor que no es Error devuelve solo su tipo", () => {
    expect(safeErrorLog({ token: JWT })).toEqual({ type: "object" });
    expect(safeErrorLog("texto")).toEqual({ type: "string" });
  });
});
