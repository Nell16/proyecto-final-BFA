import { afterEach, describe, expect, it } from "vitest";
import { delay, http } from "msw";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";

import pendingFixture from "../../../api/schemas/__fixtures__/results/pending-reviews.json";
import { useStaffAuth } from "../../../store/staffAuth";
import { server } from "../../../test/msw/server";
import { ReviewTrayPage } from "../review/ReviewTrayPage";
import { EMPTY_REVIEW_FORM, ResolveReviewFormSchema, toSubmitReviewInput } from "../review/schemas";
import { API, clearStaff, fail, ok, renderWithProviders, setPermissions } from "./testSupport";

afterEach(() => clearStaff());

const resolved = { ...pendingFixture[0], status: "REVISADO", score: 2 };

function pendingHandler(state: { items: unknown[] }) {
  return http.get(`${API}/manual-review/pending`, () => ok(state.items));
}

describe("ReviewTrayPage — permisos", () => {
  it("con CALIFICACION_EJECUTAR ofrece Revisar; sin él (solo RESULTADO_VER) es de solo lectura", async () => {
    server.use(pendingHandler({ items: pendingFixture }));
    setPermissions(["CALIFICACION_EJECUTAR"]);
    const first = await renderWithProviders(<ReviewTrayPage />);
    expect(await screen.findByRole("button", { name: /revisar respuesta de maría lópez en it-02/i })).toBeInTheDocument();
    expect(screen.queryByText("Solo lectura")).not.toBeInTheDocument();
    first.unmount();

    setPermissions(["RESULTADO_VER"]);
    await renderWithProviders(<ReviewTrayPage />);
    await screen.findByText("María López");
    expect(screen.queryByRole("button", { name: /revisar respuesta/i })).not.toBeInTheDocument();
    expect(screen.getByText("Solo lectura")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /ver intento de maría lópez/i })).toBeInTheDocument();
  });
});

describe("ReviewTrayPage — estados", () => {
  it("muestra la bandeja con el contexto de la respuesta", async () => {
    server.use(pendingHandler({ items: pendingFixture }));
    setPermissions(["CALIFICACION_EJECUTAR"]);
    await renderWithProviders(<ReviewTrayPage />);
    expect(await screen.findByText("María López")).toBeInTheDocument();
    expect(screen.getByText("Me siento tranquilo en general.")).toBeInTheDocument();
    expect(screen.getByText("IT-02")).toBeInTheDocument();
    expect(screen.getByText("1 revisión en la bandeja")).toBeInTheDocument();
  });

  it("bandeja vacía y error con Reintentar", async () => {
    setPermissions(["CALIFICACION_EJECUTAR"]);
    let broken = true;
    server.use(http.get(`${API}/manual-review/pending`, () => (broken ? fail(500, "Fallo de la bandeja") : ok([]))));
    await renderWithProviders(<ReviewTrayPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/fallo de la bandeja/i);
    broken = false;
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("No hay revisiones disponibles en la bandeja")).toBeInTheDocument();
    expect(screen.getByText(/servidor todavía no genera las revisiones al calificar/i)).toBeInTheDocument();
  });

  it("con revisiones en la lista no muestra el aviso de soporte pendiente", async () => {
    setPermissions(["CALIFICACION_EJECUTAR"]);
    server.use(pendingHandler({ items: pendingFixture }));
    await renderWithProviders(<ReviewTrayPage />);
    await screen.findByText("María López");
    expect(screen.queryByText("Soporte pendiente en el servidor")).not.toBeInTheDocument();
  });
});

describe("ReviewTrayPage — resolver", () => {
  it("aprobar con puntaje: PUT /manual-review/{id} con { approved, score, comment } y refresco de la bandeja", async () => {
    const state = { items: [...pendingFixture] as unknown[] };
    let body: unknown;
    server.use(
      pendingHandler(state),
      http.put(`${API}/manual-review/7`, async ({ request }) => {
        body = await request.json();
        state.items = [];
        return ok(resolved);
      }),
    );
    setPermissions(["CALIFICACION_EJECUTAR"]);
    await renderWithProviders(<ReviewTrayPage />);
    fireEvent.click(await screen.findByRole("button", { name: /revisar respuesta de maría/i }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Me siento tranquilo en general.")).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/^puntaje/i), { target: { value: "1,5" } });
    fireEvent.change(within(dialog).getByLabelText(/^comentario/i), { target: { value: "  Respuesta adecuada  " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar revisión" }));

    expect(await screen.findByText("Revisión aprobada.")).toBeInTheDocument();
    expect(body).toEqual({ approved: true, score: 1.5, comment: "Respuesta adecuada" });
    expect(await screen.findByText("No hay revisiones disponibles en la bandeja")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("validación inline: aprobar exige puntaje válido y observar exige comentario; no se envía nada", async () => {
    let puts = 0;
    server.use(
      pendingHandler({ items: pendingFixture }),
      http.put(`${API}/manual-review/7`, () => {
        puts += 1;
        return ok(resolved);
      }),
    );
    setPermissions(["CALIFICACION_EJECUTAR"]);
    await renderWithProviders(<ReviewTrayPage />);
    fireEvent.click(await screen.findByRole("button", { name: /revisar respuesta de maría/i }));
    const dialog = await screen.findByRole("dialog");

    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar revisión" }));
    expect(await within(dialog).findByText("Indica el puntaje asignado.")).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/^puntaje/i)).toHaveAttribute("aria-invalid", "true");

    fireEvent.change(within(dialog).getByLabelText(/^puntaje/i), { target: { value: "-3" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar revisión" }));
    expect(await within(dialog).findByText(/mayor o igual a 0/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("radio", { name: /observar/i }));
    fireEvent.change(within(dialog).getByLabelText(/^puntaje/i), { target: { value: "" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar revisión" }));
    expect(await within(dialog).findByText("Explica por qué se observa la respuesta.")).toBeInTheDocument();
    expect(puts).toBe(0);
  });

  it("observar con comentario envía approved=false y score=null", async () => {
    let body: unknown;
    server.use(
      pendingHandler({ items: pendingFixture }),
      http.put(`${API}/manual-review/7`, async ({ request }) => {
        body = await request.json();
        return ok({ ...pendingFixture[0], status: "OBSERVADO" });
      }),
    );
    setPermissions(["CALIFICACION_EJECUTAR"]);
    await renderWithProviders(<ReviewTrayPage />);
    fireEvent.click(await screen.findByRole("button", { name: /revisar respuesta de maría/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("radio", { name: /observar/i }));
    fireEvent.change(within(dialog).getByLabelText(/^comentario/i), { target: { value: "No responde a la consigna" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar revisión" }));
    expect(await screen.findByText("Respuesta observada.")).toBeInTheDocument();
    expect(body).toEqual({ approved: false, score: null, comment: "No responde a la consigna" });
  });

  it("error del backend: toast con el mensaje y el diálogo sigue abierto", async () => {
    server.use(
      pendingHandler({ items: pendingFixture }),
      http.put(`${API}/manual-review/7`, () => fail(404, "Revision no encontrada: 7")),
    );
    setPermissions(["CALIFICACION_EJECUTAR"]);
    await renderWithProviders(<ReviewTrayPage />);
    fireEvent.click(await screen.findByRole("button", { name: /revisar respuesta de maría/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^puntaje/i), { target: { value: "1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar revisión" }));
    expect(await screen.findByText("Revision no encontrada: 7")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("cambio de cuenta durante el PUT: no se publica feedback ni se cierra/refresca con datos ajenos", async () => {
    let listRequests = 0;
    let started = false;
    server.use(
      http.get(`${API}/manual-review/pending`, () => {
        listRequests += 1;
        return ok(pendingFixture);
      }),
      http.put(`${API}/manual-review/7`, async () => {
        started = true;
        await delay(120);
        return ok(resolved);
      }),
    );
    setPermissions(["CALIFICACION_EJECUTAR"]);
    await renderWithProviders(<ReviewTrayPage />);
    fireEvent.click(await screen.findByRole("button", { name: /revisar respuesta de maría/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^puntaje/i), { target: { value: "1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar revisión" }));
    await waitFor(() => expect(started).toBe(true));
    const before = listRequests;

    act(() => useStaffAuth.getState().setSession({ token: "otra-cuenta", expiresAt: null }));
    await delay(250);

    expect(screen.queryByText("Revisión aprobada.")).not.toBeInTheDocument();
    expect(listRequests).toBe(before);
  });
});

describe("esquema del formulario de revisión", () => {
  it("el valor por defecto es aprobar sin puntaje (inválido hasta indicarlo)", () => {
    expect(ResolveReviewFormSchema.safeParse(EMPTY_REVIEW_FORM).success).toBe(false);
    expect(ResolveReviewFormSchema.safeParse({ decision: "approve", score: "0", comment: "" }).success).toBe(true);
  });

  it("toSubmitReviewInput normaliza puntaje (coma decimal) y comentario vacío", () => {
    expect(toSubmitReviewInput({ decision: "approve", score: " 2,5 ", comment: "  " })).toEqual({ approved: true, score: 2.5, comment: null });
    expect(toSubmitReviewInput({ decision: "observe", score: "", comment: " x " })).toEqual({ approved: false, score: null, comment: "x" });
  });
});
