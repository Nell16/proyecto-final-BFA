import { describe, expect, it } from "vitest";
import { resolveSafeRedirect } from "./safeRedirect";

const ORIGIN = "http://localhost:8080";
const resolve = (value: string | undefined) => resolveSafeRedirect(value, ORIGIN);

describe("resolveSafeRedirect", () => {
  it("acepta rutas internas bajo /app y conserva search y hash", () => {
    expect(resolve("/app")).toBe("/app");
    expect(resolve("/app/sesiones")).toBe("/app/sesiones");
    expect(resolve("/app/sesiones/3?tab=a#x")).toBe("/app/sesiones/3?tab=a#x");
    expect(resolve("http://localhost:8080/app/roles")).toBe("/app/roles");
  });

  it.each([
    undefined,
    "",
    "/",
    "/login",
    "/application",
    "//evil.com/app/x",
    "///evil.com",
    "https://evil.com/app/x",
    "http://localhost:8081/app/x",
    "/\\evil.com",
    "\\\\evil.com",
    "/app\\..\\x",
    "/app/../admin",
    "/app/%2e%2e/admin",
    "/app//x",
    "/\t/evil.com",
    "javascript:alert(1)",
  ])("rechaza %j", (value) => {
    expect(resolve(value as string | undefined)).toBe("/app/dashboard");
  });
});
