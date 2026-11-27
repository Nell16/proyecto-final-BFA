import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { RuntimeItem } from "../../../api/schemas/runtime";
import { useParticipantAuth } from "../../../store/participantAuth";
import { server } from "../../../test/msw/server";
import { RuntimeImage, prefetchItemImages, prefetchRuntimeImage } from "../RuntimeImage";
import { AnswerRenderer } from "../renderers";

const API = "http://localhost:8080";

function makeTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 5 * 60_000,
      },
    },
  });
}

describe("RuntimeImage & prefetch", () => {
  let nextBlobId = 1;
  let createdUrls: string[] = [];
  let revokedUrls: string[] = [];

  beforeEach(() => {
    nextBlobId = 1;
    createdUrls = [];
    revokedUrls = [];

    useParticipantAuth.getState().clear();
    useParticipantAuth.getState().setSession({ token: "part-jwt", assignmentId: 42 });

    vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
      const url = `blob:http://localhost:8080/mock-${nextBlobId++}`;
      createdUrls.push(url);
      return url;
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation((url: string) => {
      revokedUrls.push(url);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useParticipantAuth.getState().clear();
  });

  it("descarga imagen autenticada del backend, muestra skeleton, crea blob URL y la revoca 1-a-1 al desmontar o cambiar src", async () => {
    server.use(
      http.get(`${API}/items/images/resources/101`, () =>
        HttpResponse.arrayBuffer(new Uint8Array([1, 2, 3, 4]).buffer, {
          headers: { "Content-Type": "image/png" },
        }),
      ),
      http.get(`${API}/items/images/resources/102`, () =>
        HttpResponse.arrayBuffer(new Uint8Array([5, 6, 7, 8]).buffer, {
          headers: { "Content-Type": "image/png" },
        }),
      ),
    );

    const queryClient = makeTestQueryClient();
    const { rerender, unmount } = render(
      <QueryClientProvider client={queryClient}>
        <RuntimeImage src="/items/images/resources/101" alt="Lámina 1" assignmentId={42} />
      </QueryClientProvider>,
    );

    expect(screen.getByLabelText("Cargando imagen")).toBeInTheDocument();

    const img1 = await screen.findByRole("img", { name: "Lámina 1" });
    expect(img1).toHaveAttribute("src", "blob:http://localhost:8080/mock-1");
    expect(img1).toHaveAttribute("draggable", "false");
    expect(img1.className).toContain("select-none");

    const contextEvent = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    img1.dispatchEvent(contextEvent);
    expect(contextEvent.defaultPrevented).toBe(true);

    // Verifica que la caché guarda el Blob y NO una cadena blob:
    const cached = queryClient.getQueryData(["runtime", "image", 42, "/items/images/resources/101"]);
    expect(cached).toBeInstanceOf(Blob);

    // Cambiar src revoca la primera blob URL y crea la segunda
    rerender(
      <QueryClientProvider client={queryClient}>
        <RuntimeImage
          src={`${API}/items/images/resources/102`}
          alt="Lámina 2"
          assignmentId={42}
        />
      </QueryClientProvider>,
    );

    const img2 = await screen.findByRole("img", { name: "Lámina 2" });
    expect(img2).toHaveAttribute("src", "blob:http://localhost:8080/mock-2");
    expect(revokedUrls).toEqual(["blob:http://localhost:8080/mock-1"]);

    // Desmontar revoca la segunda blob URL (1-a-1 sin fugas)
    unmount();
    expect(revokedUrls).toEqual([
      "blob:http://localhost:8080/mock-1",
      "blob:http://localhost:8080/mock-2",
    ]);
    expect(createdUrls).toHaveLength(2);
  });

  it("prefetchItemImages precarga Blobs sin crear ni fugar blob URLs y soporta expulsión de caché", async () => {
    let requests = 0;
    server.use(
      http.get(`${API}/items/images/resources/201`, () => {
        requests += 1;
        return HttpResponse.arrayBuffer(new Uint8Array([9, 9]).buffer, {
          headers: { "Content-Type": "image/png" },
        });
      }),
      http.get(`${API}/items/images/resources/202`, () => {
        requests += 1;
        return HttpResponse.arrayBuffer(new Uint8Array([8, 8]).buffer, {
          headers: { "Content-Type": "image/png" },
        });
      }),
    );

    const queryClient = makeTestQueryClient();
    const nextItem: RuntimeItem = {
      id: 99,
      order: 2,
      itemType: "TEXTO_E_IMAGEN",
      responseType: "OPCION_UNICA",
      prompt: "Siguiente",
      images: [{ id: 1, url: "/items/images/resources/201", order: 1, altText: "Estímulo" }],
      options: [
        {
          id: 11,
          label: "A",
          order: 1,
          images: [{ id: 2, url: "/items/images/resources/202", order: 1, altText: "Opción A" }],
        },
      ],
    };

    await prefetchItemImages(queryClient, 42, nextItem);
    expect(requests).toBe(2);
    // El prefetch NO crea blob URLs; solo guarda Blobs en caché
    expect(createdUrls).toHaveLength(0);
    expect(queryClient.getQueryData(["runtime", "image", 42, "/items/images/resources/201"])).toBeInstanceOf(
      Blob,
    );
    expect(queryClient.getQueryData(["runtime", "image", 42, "/items/images/resources/202"])).toBeInstanceOf(
      Blob,
    );

    // Expulsar caché no deja blob URLs huérfanas
    queryClient.removeQueries({ queryKey: ["runtime", "image"] });
    expect(createdUrls).toHaveLength(0);
    expect(revokedUrls).toHaveLength(0);

    // Re-prefetch tras expulsión y montaje del componente
    await prefetchRuntimeImage(queryClient, 42, "/items/images/resources/201");
    const { unmount } = render(
      <QueryClientProvider client={queryClient}>
        <RuntimeImage src="/items/images/resources/201" alt="Estímulo" assignmentId={42} />
      </QueryClientProvider>,
    );

    const img = await screen.findByRole("img", { name: "Estímulo" });
    expect(img).toHaveAttribute("src", "blob:http://localhost:8080/mock-1");
    unmount();
    expect(revokedUrls).toEqual(["blob:http://localhost:8080/mock-1"]);
  });

  it("muestra estado de error con tokens y permite Reintentar", async () => {
    let shouldFail = true;
    server.use(
      http.get(`${API}/items/images/resources/301`, () => {
        if (shouldFail) {
          return HttpResponse.json({ success: false, message: "Error" }, { status: 500 });
        }
        return HttpResponse.arrayBuffer(new Uint8Array([1, 2]).buffer, {
          headers: { "Content-Type": "image/png" },
        });
      }),
    );

    const queryClient = makeTestQueryClient();
    const { unmount } = render(
      <QueryClientProvider client={queryClient}>
        <RuntimeImage src="/items/images/resources/301" alt="Recuperable" assignmentId={42} />
      </QueryClientProvider>,
    );

    const errorGroup = await screen.findByRole("group", { name: "Error al cargar imagen" });
    expect(errorGroup.className).toContain("border-danger-border");
    expect(errorGroup.className).toContain("bg-danger-muted");
    expect(errorGroup.className).toContain("text-danger-foreground");

    shouldFail = false;
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    await waitFor(() => {
      expect(screen.getByRole("img", { name: "Recuperable" })).toBeInTheDocument();
    });
    unmount();
    expect(revokedUrls).toHaveLength(1);
  });

  it("muestra URLs externas directo sin consultar participantClient e integra renderImage en AnswerRenderer", async () => {
    const item: RuntimeItem = {
      id: 77,
      order: 1,
      itemType: "SOLO_IMAGEN",
      responseType: "OPCION_UNICA",
      prompt: "Elija la figura",
      images: [],
      options: [
        {
          id: 1,
          label: "A",
          order: 1,
          images: [{ id: 10, url: "https://cdn.example.com/fig-a.png", order: 1, altText: "Figura A" }],
        },
        {
          id: 2,
          label: "B",
          order: 2,
          images: [{ id: 11, url: "https://cdn.example.com/fig-b.png", order: 1, altText: "Figura B" }],
        },
      ],
    };

    const queryClient = makeTestQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <AnswerRenderer
          item={item}
          value={{ kind: "OPCION_UNICA", optionId: null }}
          onChange={vi.fn()}
          renderImage={(image) => (
            <RuntimeImage src={image.url} alt={image.altText} assignmentId={42} compact />
          )}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByRole("img", { name: "Figura A" })).toHaveAttribute(
      "src",
      "https://cdn.example.com/fig-a.png",
    );
    expect(screen.getByRole("img", { name: "Figura B" })).toHaveAttribute(
      "src",
      "https://cdn.example.com/fig-b.png",
    );
    expect(createdUrls).toHaveLength(0);
  });

  it("con allowRetry={false} muestra el error sin renderizar ningún <button> anidado", async () => {
    server.use(
      http.get(`${API}/items/images/resources/404`, () =>
        HttpResponse.json({ success: false, message: "Fallo" }, { status: 500 }),
      ),
    );

    const queryClient = makeTestQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <RuntimeImage
          src="/items/images/resources/404"
          alt="Sin retry"
          assignmentId={42}
          allowRetry={false}
        />
      </QueryClientProvider>,
    );

    await screen.findByRole("group", { name: "Error al cargar imagen" });
    expect(screen.queryByRole("button", { name: "Reintentar" })).not.toBeInTheDocument();
  });
});
