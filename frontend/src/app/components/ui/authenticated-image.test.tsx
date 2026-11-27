import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { render, screen } from "@testing-library/react";
import { server } from "../../../test/msw/server";
import { containsText } from "../../../test/collectStrings";
import { useStaffAuth } from "../../../store/staffAuth";
import { ApiErrorBoundary, ApiErrorPanel } from "./api-error-boundary";
import { AuthenticatedImage } from "./authenticated-image";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), warning: vi.fn(), dismiss: vi.fn() }) }));

const API = "http://localhost:8080";
const JWT = "eyJhbGciOiJIUzI1NiJ9.SECRET-PAYLOAD.SECRET-SIGNATURE";

beforeEach(() => {
  useStaffAuth.getState().clear();
  useStaffAuth.getState().setSession({
    token: JWT,
    expiresAt: null,
    user: { id: "u1", username: "ana", roles: [], permissions: [] },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  useStaffAuth.getState().clear();
});

describe("AuthenticatedImage — logs sin credenciales (hallazgo ALTO)", () => {
  it("al fallar la descarga, console.error no recibe el JWT, Authorization ni el config de axios", async () => {
    server.use(http.get(`${API}/media/foto.png`, () => HttpResponse.json({ success: false }, { status: 500 })));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    render(<AuthenticatedImage src="/media/foto.png" alt="foto" />);
    expect(await screen.findByText("Error al cargar imagen")).toBeInTheDocument();

    expect(consoleError).toHaveBeenCalled();
    const args = consoleError.mock.calls.flat();
    for (const secret of [JWT, "SECRET-PAYLOAD", "Authorization", "Bearer", "sentToken"]) {
      expect(containsText(args, secret), `fuga de «${secret}» en console.error`).toBe(false);
    }
    expect(JSON.stringify(args)).not.toContain(JWT);
    // Sí se registran los campos seguros.
    expect(JSON.stringify(args)).toContain("500");
  });
});

describe("ApiErrorBoundary / ApiErrorPanel", () => {
  function Boom(): never {
    throw Object.assign(new Error("Network Error"), {
      isAxiosError: true,
      config: { headers: { Authorization: `Bearer ${JWT}` } },
    });
  }

  it("el boundary registra solo campos seguros de un error con config sensible", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ApiErrorBoundary>
        <Boom />
      </ApiErrorBoundary>,
    );

    const logged = consoleError.mock.calls.filter((call) => String(call[0]).includes("ApiErrorBoundary"));
    expect(logged.length).toBeGreaterThan(0);
    expect(containsText(logged, JWT)).toBe(false);
    expect(containsText(logged, "Authorization")).toBe(false);
  });

  it("el panel lee status y message del ApiError (sin `response` legacy)", () => {
    render(<ApiErrorPanel error={{ status: 403, message: "Sin permiso" }} />);
    expect(screen.getByText("Acceso Denegado")).toBeInTheDocument();
    expect(screen.getByText(/Sin permiso \(HTTP 403\)/)).toBeInTheDocument();
  });
});
