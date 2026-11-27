import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { toast } from "sonner";

import { server } from "../../../../test/msw/server";
import { useStaffAuth } from "../../../../store/staffAuth";
import { AddParticipantsDialog } from "../AddParticipantsDialog";
import { ApiError } from "../../../../api/errors";
import { wizardParticipantsQuery } from "../../wizard/wizard-queries";

const API = "http://localhost:8080";
const id = (n: number) => `a1b2c3d4-e5f6-4789-abcd-${String(n).padStart(12, "0")}`;
const participant = (n: number) => ({
  id: id(n),
  codigoParticipante: `P-${String(n).padStart(3, "0")}`,
  nombres: `Persona${String(n).padStart(2, "0")}`,
  apellidos: "Prueba",
  estado: "ACTIVO",
});
const WIRE = Array.from({ length: 20 }, (_, i) => participant(i + 1));

const page = (content: unknown[]) =>
  HttpResponse.json({
    success: true,
    data: { content, number: 0, size: 200, numberOfElements: content.length, totalElements: content.length, totalPages: 1, first: true, last: true },
    message: "OK",
    error: null,
  });

function renderDialog(
  props: {
    assigned?: string[];
    canRead?: boolean;
    onAssigned?: (e: unknown[]) => void;
    onBatchStart?: () => void;
    onEntryGranted?: (e: unknown) => void;
    onBatchEnd?: () => void;
  } = {},
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (assigned: string[]) => (
    <QueryClientProvider client={client}>
      <AddParticipantsDialog
        sessionId={1}
        open
        onOpenChange={() => undefined}
        session={{ scheduledStart: "2026-11-24T09:00:00", scheduledEnd: "2026-11-24T12:00:00" }}
        assignedParticipantIds={new Set(assigned)}
        canReadParticipants={props.canRead ?? true}
        onAssigned={props.onAssigned ?? (() => undefined)}
        onBatchStart={props.onBatchStart}
        onEntryGranted={props.onEntryGranted as never}
        onBatchEnd={props.onBatchEnd}
      />
    </QueryClientProvider>
  );
  const result = render(tree(props.assigned ?? []));
  return { ...result, client, setAssigned: (ids: string[]) => result.rerender(tree(ids)) };
}

const initialSessionKey = useStaffAuth.getState().sessionId;

describe("AddParticipantsDialog", () => {
  afterEach(() => {
    useStaffAuth.setState({ sessionId: initialSessionKey });
    onlineManager.setOnline(true);
  });

  it("excluye a quienes ya tienen cualquier asignación (incluida revocada)", async () => {
    server.use(http.get(`${API}/participantes`, () => page(WIRE)));
    renderDialog({ assigned: [id(1), id(2)] });
    const list = await screen.findByRole("list", { name: "Participantes disponibles" });
    await within(list).findByText("Persona03 Prueba");
    expect(within(list).queryByText("Persona01 Prueba")).not.toBeInTheDocument();
    expect(within(list).queryByText("Persona02 Prueba")).not.toBeInTheDocument();
  });

  it("conserva la selección al paginar y buscar", async () => {
    server.use(http.get(`${API}/participantes`, () => page(WIRE)));
    renderDialog();
    const list = await screen.findByRole("list", { name: "Participantes disponibles" });
    await within(list).findByText("Persona01 Prueba");
    fireEvent.click(within(list).getAllByRole("checkbox")[0]);
    expect(screen.getByText("1 seleccionado(s)")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
    expect(await screen.findByText(/página 2 de 3/)).toBeInTheDocument();
    expect(screen.getByText("1 seleccionado(s)")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Buscar participantes"), { target: { value: "Persona20" } });
    await screen.findByText("Persona20 Prueba");
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    expect(screen.getByText("2 seleccionado(s)")).toBeInTheDocument();
  });

  it("sin PARTICIPANTE_LEER explica por qué no hay selector y no consulta participantes", async () => {
    const handler = vi.fn(() => page(WIRE));
    server.use(http.get(`${API}/participantes`, handler));
    renderDialog({ canRead: false });
    expect(await screen.findByText(/PARTICIPANTE_LEER/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Buscar participantes")).not.toBeInTheDocument();
    expect(handler).not.toHaveBeenCalled();
  });

  it("envía ttlHours y no publica resultados si cambia la cuenta durante el lote", async () => {
    const bodies: Array<{ participantId: string; ttlHours?: number }> = [];
    const onAssigned = vi.fn();
    server.use(
      http.get(`${API}/participantes`, () => page(WIRE)),
      http.post(`${API}/sesiones/1/asignaciones`, async ({ request }) => {
        bodies.push((await request.json()) as (typeof bodies)[number]);
        useStaffAuth.setState({ sessionId: "otra-cuenta" });
        return HttpResponse.json({
          success: true,
          data: { assignmentId: 800, rawToken: "tok-z", expiresAt: "2026-11-24T22:00:00" },
          message: "OK",
          error: null,
        });
      }),
    );
    renderDialog({ onAssigned });
    const list = await screen.findByRole("list", { name: "Participantes disponibles" });
    await within(list).findByText("Persona01 Prueba");
    fireEvent.click(within(list).getAllByRole("checkbox")[0]);
    fireEvent.click(within(list).getAllByRole("checkbox")[1]);
    fireEvent.click(screen.getByRole("button", { name: /asignar y generar accesos/i }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    await waitFor(() => expect(screen.getByRole("button", { name: /asignar y generar accesos/i })).toBeEnabled());
    expect(bodies[0].ttlHours).toBeGreaterThanOrEqual(8);
    expect(bodies).toHaveLength(1);
    expect(onAssigned).not.toHaveBeenCalled();
  });

  it("publica cada token apenas llega (no al final del lote) y avisa el inicio del lote antes del primer POST", async () => {
    const order: string[] = [];
    let release: () => void = () => undefined;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const onBatchEnd = vi.fn(() => order.push("end"));
    server.use(
      http.get(`${API}/participantes`, () => page(WIRE)),
      http.post(`${API}/sesiones/1/asignaciones`, async () => {
        calls += 1;
        order.push(`post-${calls}`);
        if (calls === 2) await hold; // el segundo POST queda en vuelo
        return HttpResponse.json({
          success: true,
          data: { assignmentId: 800 + calls, rawToken: `tok-${calls}`, expiresAt: "2026-11-24T22:00:00" },
          message: "OK",
          error: null,
        });
      }),
    );
    renderDialog({
      onBatchStart: () => order.push("start"),
      onEntryGranted: (entry) => order.push(`entry-${(entry as { rawToken: string }).rawToken}`),
      onBatchEnd,
    });
    const list = await screen.findByRole("list", { name: "Participantes disponibles" });
    await within(list).findByText("Persona01 Prueba");
    for (const box of within(list).getAllByRole("checkbox").slice(0, 3)) fireEvent.click(box);
    fireEvent.click(screen.getByRole("button", { name: /asignar y generar accesos/i }));

    // Con el segundo POST aún en vuelo, el primer token ya fue publicado y el lote ya había empezado.
    await waitFor(() => expect(order).toEqual(["start", "post-1", "entry-tok-1", "post-2"]));
    expect(onBatchEnd).not.toHaveBeenCalled();

    release();
    await waitFor(() => expect(onBatchEnd).toHaveBeenCalledTimes(1));
    expect(order).toEqual(["start", "post-1", "entry-tok-1", "post-2", "entry-tok-2", "post-3", "entry-tok-3", "end"]);
  });

  it("al desmontar (salir de la ruta) durante el lote no se envían más POST y los tokens recibidos ya se publicaron", async () => {
    let release: () => void = () => undefined;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const granted: string[] = [];
    server.use(
      http.get(`${API}/participantes`, () => page(WIRE)),
      http.post(`${API}/sesiones/1/asignaciones`, async () => {
        calls += 1;
        if (calls === 2) await hold;
        return HttpResponse.json({
          success: true,
          data: { assignmentId: 800 + calls, rawToken: `tok-${calls}`, expiresAt: "2026-11-24T22:00:00" },
          message: "OK",
          error: null,
        });
      }),
    );
    const onBatchEnd = vi.fn();
    const { unmount } = renderDialog({
      onEntryGranted: (entry) => granted.push((entry as { rawToken: string }).rawToken),
      onBatchEnd,
    });
    const list = await screen.findByRole("list", { name: "Participantes disponibles" });
    await within(list).findByText("Persona01 Prueba");
    for (const box of within(list).getAllByRole("checkbox").slice(0, 3)) fireEvent.click(box);
    fireEvent.click(screen.getByRole("button", { name: /asignar y generar accesos/i }));
    await waitFor(() => expect(calls).toBe(2));
    expect(granted).toEqual(["tok-1"]);

    unmount();
    release();
    // El POST 2 ya había salido: su token se entrega al padre aunque el diálogo esté desmontado.
    await waitFor(() => expect(granted).toEqual(["tok-1", "tok-2"]));
    await waitFor(() => expect(onBatchEnd).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(calls).toBe(2); // el tercer participante nunca se envió
  });

  it("al terminar el lote la MutationCache no conserva ningún rawToken", async () => {
    let calls = 0;
    server.use(
      http.get(`${API}/participantes`, () => page(WIRE)),
      http.post(`${API}/sesiones/1/asignaciones`, () => {
        calls += 1;
        return HttpResponse.json({
          success: true,
          data: { assignmentId: 800 + calls, rawToken: `tok-cache-${calls}`, expiresAt: "2026-11-24T22:00:00" },
          message: "OK",
          error: null,
        });
      }),
    );
    const onAssigned = vi.fn();
    const { client } = renderDialog({ onAssigned });
    const list = await screen.findByRole("list", { name: "Participantes disponibles" });
    await within(list).findByText("Persona01 Prueba");
    for (const box of within(list).getAllByRole("checkbox").slice(0, 2)) fireEvent.click(box);
    fireEvent.click(screen.getByRole("button", { name: /asignar y generar accesos/i }));
    await waitFor(() => expect(onAssigned).toHaveBeenCalledTimes(1));
    expect((onAssigned.mock.calls[0][0] as unknown[]).length).toBe(2);
    const dump = JSON.stringify(client.getMutationCache().getAll());
    expect(dump).not.toContain("rawToken");
    expect(dump).not.toContain("tok-cache-");
  });

  it("con 403 en la consulta de participantes no permite asignar ni envía POST", async () => {
    const posts = vi.fn();
    server.use(
      http.get(`${API}/participantes`, () =>
        HttpResponse.json({ success: false, data: null, message: "Forbidden", error: { code: "ERROR", message: "Forbidden" } }, { status: 403 }),
      ),
      http.post(`${API}/sesiones/1/asignaciones`, () => {
        posts();
        return HttpResponse.json({ success: false }, { status: 500 });
      }),
    );
    renderDialog();
    expect(await screen.findByText(/PARTICIPANTE_LEER/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /asignar y generar accesos/i })).toBeDisabled();
    expect(posts).not.toHaveBeenCalled();
  });

  it("un participante seleccionado que pasa a figurar asignado no se reenvía", async () => {
    const attempts: string[] = [];
    server.use(
      http.get(`${API}/participantes`, () => page(WIRE)),
      http.post(`${API}/sesiones/1/asignaciones`, async ({ request }) => {
        attempts.push(((await request.json()) as { participantId: string }).participantId);
        return HttpResponse.json({
          success: true,
          data: { assignmentId: 900, rawToken: "tok-1", expiresAt: "2026-11-24T22:00:00" },
          message: "OK",
          error: null,
        });
      }),
    );
    const { setAssigned } = renderDialog();
    const list = await screen.findByRole("list", { name: "Participantes disponibles" });
    await within(list).findByText("Persona01 Prueba");
    for (const box of within(list).getAllByRole("checkbox").slice(0, 2)) fireEvent.click(box);
    // El participante 1 pasa a figurar asignado antes de enviar.
    setAssigned([id(1)]);
    fireEvent.click(screen.getByRole("button", { name: /asignar y generar accesos/i }));
    await waitFor(() => expect(attempts).toHaveLength(1));
    expect(attempts).toEqual([id(2)]);
  });
  it("un 403 recibido durante el lote detiene los POST siguientes y entrega el token ya en vuelo", async () => {
    let release: () => void = () => undefined;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const onEntryGranted = vi.fn();
    const onBatchEnd = vi.fn();
    server.use(
      http.get(`${API}/participantes`, () => page(WIRE)),
      http.post(`${API}/sesiones/1/asignaciones`, async () => {
        calls += 1;
        if (calls === 1) await hold;
        return HttpResponse.json({
          success: true,
          data: { assignmentId: 700 + calls, rawToken: `tok-${calls}`, expiresAt: "2026-11-24T22:00:00" },
          message: "OK",
          error: null,
        });
      }),
    );
    const { client } = renderDialog({ onEntryGranted, onBatchEnd });
    const list = await screen.findByRole("list", { name: "Participantes disponibles" });
    await within(list).findByText("Persona01 Prueba");
    for (const box of within(list).getAllByRole("checkbox").slice(0, 2)) fireEvent.click(box);
    fireEvent.click(screen.getByRole("button", { name: /asignar y generar accesos/i }));
    await waitFor(() => expect(calls).toBe(1));

    // Una recarga de participantes responde 403 mientras el primer POST sigue en vuelo.
    client.getQueryCache().find({ queryKey: wizardParticipantsQuery().queryKey })?.setState({
      status: "error",
      error: new ApiError({ status: 403, code: "FORBIDDEN", message: "Forbidden" }),
    });
    release();

    await waitFor(() => expect(onBatchEnd).toHaveBeenCalledTimes(1));
    expect(onEntryGranted).toHaveBeenCalledTimes(1);
    expect((onEntryGranted.mock.calls[0]?.[0] as { rawToken: string }).rawToken).toBe("tok-1");
    expect(calls).toBe(1);
  });

  it("el contador y el botón usan solo la selección elegible", async () => {
    server.use(http.get(`${API}/participantes`, () => page(WIRE)));
    const { setAssigned } = renderDialog();
    const list = await screen.findByRole("list", { name: "Participantes disponibles" });
    await within(list).findByText("Persona01 Prueba");
    fireEvent.click(within(list).getAllByRole("checkbox")[0]!);
    expect(screen.getByText("1 seleccionado(s)")).toBeInTheDocument();
    setAssigned([id(1)]);
    expect(await screen.findByText("0 seleccionado(s)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /asignar y generar accesos/i })).toBeDisabled();
  });
  it("una mutación pausada sin conexión no envía el POST si llega un 403 antes de reconectar", async () => {
    let posts = 0;
    const onBatchEnd = vi.fn();
    server.use(
      http.get(`${API}/participantes`, () => page(WIRE)),
      http.post(`${API}/sesiones/1/asignaciones`, () => {
        posts += 1;
        return HttpResponse.json({
          success: true,
          data: { assignmentId: 1, rawToken: "tok-x", expiresAt: "2026-11-24T22:00:00" },
          message: "OK",
          error: null,
        });
      }),
    );
    const { client } = renderDialog({ onBatchEnd });
    const list = await screen.findByRole("list", { name: "Participantes disponibles" });
    await within(list).findByText("Persona01 Prueba");
    fireEvent.click(within(list).getAllByRole("checkbox")[0]!);
    onlineManager.setOnline(false);
    fireEvent.click(screen.getByRole("button", { name: /asignar y generar accesos/i }));
    await waitFor(() => expect(client.getMutationCache().getAll().some((m) => m.state.isPaused)).toBe(true));

    // 403 en caché y reconexión en el mismo bloque síncrono: React aún no ejecutó ningún efecto.
    client.getQueryCache().find({ queryKey: wizardParticipantsQuery().queryKey })?.setState({
      status: "error",
      error: new ApiError({ status: 403, code: "FORBIDDEN", message: "Forbidden" }),
    });
    onlineManager.setOnline(true);
    await waitFor(() => expect(onBatchEnd).toHaveBeenCalledTimes(1));
    expect(posts).toBe(0);
  });
  it("tras un 403 de lectura, la respuesta 500 de un POST ya enviado se informa como fallo", async () => {
    const errorSpy = vi.spyOn(toast, "error");
    let release: () => void = () => undefined;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const onEntryGranted = vi.fn();
    const onBatchEnd = vi.fn();
    server.use(
      http.get(`${API}/participantes`, () => page(WIRE)),
      http.post(`${API}/sesiones/1/asignaciones`, async () => {
        calls += 1;
        if (calls === 1) {
          return HttpResponse.json({
            success: true,
            data: { assignmentId: 1, rawToken: "tok-ok", expiresAt: "2026-11-24T22:00:00" },
            message: "OK",
            error: null,
          });
        }
        await hold;
        return HttpResponse.json({ success: false, data: null, message: "Error", error: { code: "ERROR", message: "Error" } }, { status: 500 });
      }),
    );
    const { client } = renderDialog({ onEntryGranted, onBatchEnd });
    const list = await screen.findByRole("list", { name: "Participantes disponibles" });
    await within(list).findByText("Persona01 Prueba");
    for (const box of within(list).getAllByRole("checkbox").slice(0, 3)) fireEvent.click(box);
    fireEvent.click(screen.getByRole("button", { name: /asignar y generar accesos/i }));
    await waitFor(() => expect(calls).toBe(2));
    act(() => {
      client.getQueryCache().find({ queryKey: wizardParticipantsQuery().queryKey })?.setState({
        status: "error",
        error: new ApiError({ status: 403, code: "FORBIDDEN", message: "Forbidden" }),
      });
    });
    // El 403 ya se reflejó (y el lote quedó abortado) ANTES de que llegue el 500 del POST en vuelo.
    expect(await screen.findByText(/PARTICIPANTE_LEER/)).toBeInTheDocument();
    release();
    await waitFor(() => expect(onBatchEnd).toHaveBeenCalledTimes(1));
    expect(onEntryGranted).toHaveBeenCalledTimes(1);
    expect(calls).toBe(2); // el tercero nunca se envió
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringMatching(/1 participante/),
      expect.objectContaining({ description: expect.stringContaining("Persona02 Prueba") }),
    );
    errorSpy.mockRestore();
  });
});
