import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";

import { useStaffAuth } from "../../../store/staffAuth";
import { server } from "../../../test/msw/server";
import { StaffImage } from "../StaffImage";
import { useInstrumentPermissions } from "../permissions";
import { instrumentKeys, useScoringStrategies } from "../queries";

const API = "http://localhost:8080";

const ok = <T,>(data: T) => ({
  success: true,
  data,
  message: "OK",
  error: null,
  correlationId: "cid-test",
});

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 5 * 60_000,
      },
    },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe("useInstrumentPermissions & useScoringStrategies (§7b F3)", () => {
  beforeEach(() => {
    useStaffAuth.getState().clear();
  });

  afterEach(() => {
    useStaffAuth.getState().clear();
  });

  it("NO consulta GET /scoring/strategies sin CALIFICACION_CONFIGURAR y SÍ la ejecuta cuando se concede el permiso", async () => {
    let strategyCalls = 0;
    server.use(
      http.get(`${API}/scoring/strategies`, () => {
        strategyCalls += 1;
        return HttpResponse.json(
          ok([
            {
              id: 1,
              codigo: "CLAVE_SIMPLE",
              nombre: "Clave Simple",
              descripcion: "Exacta",
              tipoEstrategia: "CLAVE_SIMPLE",
              activa: true,
              requiereRevisionManual: false,
              permiteBaremo: true,
              fechaCreacion: "2026-06-01T08:00:00.000Z",
            },
          ]),
        );
      }),
    );

    useStaffAuth.getState().setSession({
      token: "staff-jwt",
      expiresAt: null,
      user: {
        id: "u1",
        username: "editor",
        roles: ["PSICOLOGO"],
        permissions: ["TEST_CREAR"],
      },
    });

    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => ({
        perms: useInstrumentPermissions(),
        strategies: useScoringStrategies(),
      }),
      { wrapper },
    );

    expect(result.current.perms).toEqual({
      canRead: true,
      canEdit: true,
      canPublish: false,
      canConfigureScoring: false,
      canConfigureBaremos: false,
    });
    expect(result.current.strategies.fetchStatus).toBe("idle");
    expect(strategyCalls).toBe(0);

    // Al actualizar permisos en la misma sesión, el hook re-renderiza y habilita la query
    act(() => {
      useStaffAuth.getState().setUser(
        {
          id: "u1",
          username: "editor",
          roles: ["PSICOLOGO"],
          permissions: ["TEST_CREAR", "CALIFICACION_CONFIGURAR"],
        },
        "staff-jwt",
      );
    });

    await waitFor(() => expect(result.current.strategies.isSuccess).toBe(true));
    expect(strategyCalls).toBe(1);
    expect(result.current.strategies.data?.[0]?.code).toBe("CLAVE_SIMPLE");
  });
});

describe("StaffImage", () => {
  let nextBlobId = 1;
  let createdUrls: string[] = [];
  let revokedUrls: string[] = [];

  beforeEach(() => {
    nextBlobId = 1;
    createdUrls = [];
    revokedUrls = [];

    useStaffAuth.getState().setSession({
      token: "staff-jwt",
      expiresAt: null,
      user: { id: "u1", username: "ana", roles: ["PSICOLOGO"], permissions: ["TEST_CREAR"] },
    });

    vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
      const url = `blob:http://localhost:8080/staff-mock-${nextBlobId++}`;
      createdUrls.push(url);
      return url;
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation((url: string) => {
      revokedUrls.push(url);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useStaffAuth.getState().clear();
  });

  it("descarga Blob con staffClient, guarda Blob en caché y revoca URL 1-a-1 al desmontar", async () => {
    server.use(
      http.get(`${API}/items/images/resources/77`, () =>
        HttpResponse.arrayBuffer(new Uint8Array([1, 2, 3, 4]).buffer, {
          headers: { "Content-Type": "image/png" },
        }),
      ),
    );

    const { queryClient, wrapper } = createWrapper();
    const { unmount } = render(
      <StaffImage resourceId={77} alt="Estímulo 77" />,
      { wrapper },
    );

    expect(screen.getByLabelText("Cargando imagen")).toBeInTheDocument();

    const img = await screen.findByRole("img", { name: "Estímulo 77" });
    expect(img).toHaveAttribute("src", "blob:http://localhost:8080/staff-mock-1");

    const cached = queryClient.getQueryData(instrumentKeys.staffImage(77));
    expect(cached).toBeInstanceOf(Blob);

    unmount();
    expect(createdUrls).toEqual(["blob:http://localhost:8080/staff-mock-1"]);
    expect(revokedUrls).toEqual(["blob:http://localhost:8080/staff-mock-1"]);
  });

  it("renderiza previewUrl local sin realizar petición de red cuando resourceId es null", () => {
    let networkCalls = 0;
    server.use(
      http.get(`${API}/items/images/resources/*`, () => {
        networkCalls += 1;
        return HttpResponse.json(ok(null), { status: 500 });
      }),
    );

    const { wrapper } = createWrapper();
    render(
      <StaffImage resourceId={null} previewUrl="blob:local-preview-1" alt="Local" />,
      { wrapper },
    );

    const img = screen.getByRole("img", { name: "Local" });
    expect(img).toHaveAttribute("src", "blob:local-preview-1");
    expect(networkCalls).toBe(0);
    expect(createdUrls).toHaveLength(0);
  });

  it("muestra placeholder amigable cuando faltan resourceId y previewUrl", () => {
    const { wrapper } = createWrapper();
    render(<StaffImage resourceId={null} previewUrl={null} alt="Faltante" />, { wrapper });

    expect(screen.getByRole("group", { name: "Imagen no disponible" })).toBeInTheDocument();
  });

  it("muestra error con botón Reintentar funcional cuando falla la descarga autenticada", async () => {
    let shouldFail = true;
    server.use(
      http.get(`${API}/items/images/resources/88`, () => {
        if (shouldFail) {
          return HttpResponse.json({ success: false, message: "Error" }, { status: 500 });
        }
        return HttpResponse.arrayBuffer(new Uint8Array([9, 8]).buffer, {
          headers: { "Content-Type": "image/png" },
        });
      }),
    );

    const { wrapper } = createWrapper();
    const { unmount } = render(<StaffImage resourceId={88} alt="Recuperable" />, { wrapper });

    await screen.findByRole("group", { name: "Error al cargar imagen" });

    shouldFail = false;
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    const img = await screen.findByRole("img", { name: "Recuperable" });
    expect(img).toHaveAttribute("src", "blob:http://localhost:8080/staff-mock-1");

    unmount();
    expect(revokedUrls).toEqual(["blob:http://localhost:8080/staff-mock-1"]);
  });
});
