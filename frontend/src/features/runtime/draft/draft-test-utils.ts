import { http, HttpResponse, type HttpResponseInit } from "msw";
import { vi } from "vitest";
import type { SaveAnswerRequest } from "../../../api/endpoints/runtime";
import { useParticipantAuth } from "../../../store/participantAuth";
import { server } from "../../../test/msw/server";
import type { AnswerValue } from "../answer-value";
import { bindDraftOwner, clearRuntimeDraft, resetDraftSyncForTests } from "./sync";
import { useRuntimeDraft } from "./store";

/** Utilidades compartidas por los tests del draft (no es un test). */

export const API = "http://localhost:8080";
export const ASSIGNMENT_ID = 42;
export const ATTEMPT_ID = 101;
export const TOKEN = "secret-participant-jwt";

export const single = (optionId: number | null): AnswerValue => ({ kind: "OPCION_UNICA", optionId });

export const ok = (data: unknown): Response => HttpResponse.json({ success: true, data });

export const fail = (status: number, code: string, message = "error"): Response =>
  HttpResponse.json({ success: false, data: null, error: { code, message } }, { status } satisfies HttpResponseInit);

export const receipt = (itemId: number) => ({
  id: 9000 + itemId,
  intentoId: ATTEMPT_ID,
  itemId,
  esFinal: true,
  requiereRevisionManual: false,
});

export const bulkResult = (itemId: number, status: "GUARDADA" | "RECHAZADA", code: string | null = null) => ({
  itemId,
  status,
  code,
  answerId: status === "GUARDADA" ? 9000 + itemId : null,
});

export function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

export interface ApiCalls {
  puts: { itemId: number; body: SaveAnswerRequest }[];
  bulks: SaveAnswerRequest[][];
  /** Orden de llegada: `PUT:<itemId>` y `POST:[<itemIds>]`. */
  order: string[];
}

interface ApiOverrides {
  put?: (itemId: number, body: SaveAnswerRequest) => Response | Promise<Response>;
  bulk?: (body: SaveAnswerRequest[]) => Response | Promise<Response>;
}

/** Instala los handlers del PUT individual y del bulk-sync y registra lo que llega. */
export function mockRuntimeApi(overrides: ApiOverrides = {}): ApiCalls {
  const calls: ApiCalls = { puts: [], bulks: [], order: [] };
  server.use(
    http.put(`${API}/intentos/${ATTEMPT_ID}/items/:itemId/respuesta`, async ({ request, params }) => {
      const itemId = Number(params.itemId);
      const body = (await request.json()) as SaveAnswerRequest;
      calls.puts.push({ itemId, body });
      calls.order.push(`PUT:${itemId}`);
      return overrides.put ? overrides.put(itemId, body) : ok(receipt(itemId));
    }),
    http.post(`${API}/intentos/${ATTEMPT_ID}/respuestas/bulk-sync`, async ({ request }) => {
      const body = (await request.json()) as SaveAnswerRequest[];
      calls.bulks.push(body);
      calls.order.push(`POST:[${body.map((a) => a.itemId).join(",")}]`);
      return overrides.bulk ? overrides.bulk(body) : ok(body.map((a) => bulkResult(a.itemId, "GUARDADA")));
    }),
  );
  return calls;
}

export function setBrowserOnline(online: boolean) {
  return vi.spyOn(navigator, "onLine", "get").mockReturnValue(online);
}

/** Estado limpio + sesión de participante + dueño enlazado. Llamar en `beforeEach`. */
export function setupDraftEnvironment(assignmentId = ASSIGNMENT_ID, attemptId = ATTEMPT_ID): void {
  sessionStorage.clear();
  resetDraftSyncForTests();
  useRuntimeDraft.getState().clearDraft();
  useParticipantAuth.getState().setSession({ token: TOKEN, assignmentId });
  bindDraftOwner({ assignmentId, attemptId });
}

/** Llamar en `afterEach`. */
export function teardownDraftEnvironment(): void {
  clearRuntimeDraft();
  resetDraftSyncForTests();
  useParticipantAuth.getState().clear();
  sessionStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
}

/** Claves de draft guardadas en sessionStorage. */
export function storedDraftKeys(): string[] {
  const keys: string[] = [];
  for (let i = 0; i < sessionStorage.length; i += 1) {
    const key = sessionStorage.key(i);
    if (key?.startsWith("bfa-runtime-draft:")) keys.push(key);
  }
  return keys.sort();
}

/**
 * Espera una condición con tiempo REAL. `vi.waitFor` avanza los fake timers en cada ciclo, lo que descuadra
 * los tests de backoff; esta variante no toca los timers falsos (solo cede el event loop con `setImmediate`).
 */
export async function waitUntil(assertion: () => void, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      assertion();
      return;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }
}
