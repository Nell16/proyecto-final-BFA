import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { delay, http, HttpResponse } from "msw";
import { queryClient } from "../../../api/queryClient";
import { useParticipantAuth } from "../../../store/participantAuth";
import { server } from "../../../test/msw/server";
import { evaluationGuard } from "../evaluation-guard";
import { ensureCurrentEvaluation, evaluationQueryOptions, runtimeKeys } from "../queries";

const API = "http://localhost:8080";

const evaluationWire = {
  id: null,
  assignmentId: 42,
  sessionId: 7,
  participantDisplayName: "Ana Pérez",
  sessionName: "Sesión",
  sessionStatus: "ABIERTA",
  pausedAt: null,
  attemptStatus: "NO_INICIADO",
  subtests: [],
};

describe("ensureCurrentEvaluation (F2-FIX-7/8)", () => {
  beforeEach(() => {
    queryClient.clear();
    useParticipantAuth.getState().setSession({ token: "jwt-42", assignmentId: 42 });
  });
  afterEach(() => {
    queryClient.clear();
    useParticipantAuth.getState().clear();
  });

  const unavailable = () =>
    HttpResponse.json(
      { success: false, data: null, error: { code: "SERVICE_UNAVAILABLE", message: "x" }, correlationId: "c" },
      { status: 503 },
    );

  /**
   * Qué cuenta: las solicitudes HTTP a /yo que hace el LOADER (`ensureCurrentEvaluation`), no los reintentos de TanStack
   * Query. Con la caché invalidada y un 503 el loader hace UNA solicitud propia: en total 2 (la que sembró la caché + la
   * propia), sin reintentos.
   */
  it("con la caché invalidada y un 503, el loader hace UNA solicitud propia sin reintentos: exactamente 2 solicitudes en total con el QueryClient de producción", async () => {
    let calls = 0;
    let failing = false;
    server.use(
      http.get(`${API}/evaluacion-participante/yo`, () => {
        calls += 1;
        if (failing) {
          return HttpResponse.json(
            { success: false, data: null, error: { code: "SERVICE_UNAVAILABLE", message: "x" }, correlationId: "c" },
            { status: 503 },
          );
        }
        return HttpResponse.json({ success: true, data: evaluationWire, correlationId: "c" });
      }),
    );

    // 1.ª solicitud: siembra la caché con un ticket vigente.
    const first = await ensureCurrentEvaluation(queryClient, 42);
    expect(first).not.toBeNull();
    expect(calls).toBe(1);

    // Se oculta la pestaña: el dato en caché queda invalidado y el servidor responde 503.
    evaluationGuard.invalidateForVisibility();
    failing = true;
    const second = await ensureCurrentEvaluation(queryClient, 42);

    expect(second).toBeNull();
    expect(calls).toBe(2);
    // Margen para que, sin el fix, falle por el conteo (los reintentos tardan ~3 s) y no por el timeout del test.
  }, 15_000);

  /**
   * F2-FIX-8 · MEDIO 3. El sondeo del runner (`fetchQuery` con los reintentos globales de producción) está en vuelo y
   * reintenta un 503. Qué cuenta: `callsWhenLoaderResolved` = solicitudes HTTP vistas por el servidor cuando el loader
   * resolvió. Sin el fix el loader reutiliza la promesa del sondeo y espera sus reintentos (~3 s): resuelve con 4
   * solicitudes (1 de siembra + 3 del sondeo). Con el fix hace una solicitud propia: resuelve con 3 (siembra + la del
   * sondeo ya en vuelo + la propia), mucho antes del primer reintento del sondeo (1 s).
   */
  it("MEDIO 3 · con un sondeo en vuelo que reintenta 503, el loader espera UNA sola solicitud propia (null si falla) y no los reintentos del sondeo", async () => {
    let calls = 0;
    let failing = false;
    server.use(
      http.get(`${API}/evaluacion-participante/yo`, () => {
        calls += 1;
        return failing ? unavailable() : HttpResponse.json({ success: true, data: evaluationWire, correlationId: "c" });
      }),
    );
    expect(await ensureCurrentEvaluation(queryClient, 42)).not.toBeNull();
    expect(calls).toBe(1);

    // Pestaña oculta: la caché queda invalidada. El servidor falla y arranca el sondeo del runner (misma clave).
    evaluationGuard.invalidateForVisibility();
    failing = true;
    const poll = queryClient
      .fetchQuery({ ...evaluationQueryOptions(42), staleTime: 0 })
      .catch(() => undefined);
    await vi.waitFor(() => expect(calls).toBe(2));

    const startedAt = Date.now();
    const result = await ensureCurrentEvaluation(queryClient, 42);
    const callsWhenLoaderResolved = calls;

    expect(result).toBeNull();
    expect(callsWhenLoaderResolved).toBe(3);
    expect(Date.now() - startedAt).toBeLessThan(900);

    await queryClient.cancelQueries();
    await poll;
  }, 15_000);

  it("MEDIO 3 · con un sondeo en vuelo, una solicitud propia exitosa se publica en la caché conservando su identidad y su ticket", async () => {
    let calls = 0;
    let mode: "ok" | "fail" = "ok";
    server.use(
      http.get(`${API}/evaluacion-participante/yo`, async () => {
        calls += 1;
        if (mode === "fail") {
          await delay(300);
          return unavailable();
        }
        return HttpResponse.json({ success: true, data: evaluationWire, correlationId: "c" });
      }),
    );
    const seeded = await ensureCurrentEvaluation(queryClient, 42);
    evaluationGuard.invalidateForVisibility();
    mode = "fail";
    const poll = queryClient.fetchQuery({ ...evaluationQueryOptions(42), staleTime: 0 }).catch(() => undefined);
    await vi.waitFor(() => expect(calls).toBe(2));

    mode = "ok";
    const fresh = await ensureCurrentEvaluation(queryClient, 42);
    expect(fresh).not.toBeNull();
    expect(fresh).not.toBe(seeded);
    // Misma identidad que el objeto devuelto (si no, el ticket asociado por WeakMap se perdería).
    expect(queryClient.getQueryData(runtimeKeys.evaluation(42))).toBe(fresh);
    expect(evaluationGuard.isCurrent(evaluationGuard.ticketOf(fresh))).toBe(true);

    await queryClient.cancelQueries();
    await poll;
  }, 15_000);

  it("la publicación del loader NO pisa un /yo más nuevo ya presente en la caché (orden de INICIO del ticket)", async () => {
    let calls = 0;
    server.use(
      http.get(`${API}/evaluacion-participante/yo`, async () => {
        calls += 1;
        if (calls === 2) await delay(200); // la solicitud propia del loader es lenta
        return HttpResponse.json({ success: true, data: evaluationWire, correlationId: "c" });
      }),
    );
    await ensureCurrentEvaluation(queryClient, 42);
    evaluationGuard.invalidateForVisibility();

    const pending = ensureCurrentEvaluation(queryClient, 42);
    await vi.waitFor(() => expect(calls).toBe(2));
    // Mientras tanto llega y se publica un /yo de una solicitud iniciada DESPUÉS (ticket más reciente).
    const newer = { ...evaluationWire, id: 999 } as unknown as object;
    evaluationGuard.register(newer, evaluationGuard.startRequest());
    queryClient.setQueryData(runtimeKeys.evaluation(42), newer);

    const result = await pending;
    expect(result).toBe(newer);
    expect(queryClient.getQueryData(runtimeKeys.evaluation(42))).toBe(newer);
  }, 15_000);
});
