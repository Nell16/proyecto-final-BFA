import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { LIVE_POLL_MS, PAUSED_POLL_MS, pollIntervalFor, sessionAssignmentsQuery, sessionDetailQuery } from "./queries";
import type { Session } from "../../api/schemas/sessions";

const STATUSES: Session["status"][] = ["PROGRAMADA", "ABIERTA", "PAUSADA", "CERRADA", "CANCELADA", "DESCONOCIDO"];

/** Evalúa el `refetchInterval` de una query con datos en la caché con el estado dado. */
function intervalOf(status: Session["status"], opts: { poll?: boolean } | undefined = { poll: true }): unknown {
  const qc = new QueryClient();
  const options = sessionDetailQuery(1, opts);
  qc.setQueryData(options.queryKey, { id: 1, status } as Session);
  const query = qc.getQueryCache().find({ queryKey: options.queryKey })!;
  const fn = options.refetchInterval as unknown as (q: typeof query) => unknown;
  return fn(query);
}

describe("polling de sesiones", () => {
  it("ABIERTA 5 s, PAUSADA 15 s, el resto sin polling", () => {
    expect(pollIntervalFor("ABIERTA")).toBe(5_000);
    expect(pollIntervalFor("PAUSADA")).toBe(15_000);
    expect(LIVE_POLL_MS).toBe(5_000);
    expect(PAUSED_POLL_MS).toBe(15_000);
    for (const status of STATUSES.filter((s) => s !== "ABIERTA" && s !== "PAUSADA")) {
      expect(pollIntervalFor(status)).toBe(false);
    }
    expect(pollIntervalFor(undefined)).toBe(false);
  });

  it("sessionDetailQuery con poll usa el intervalo por estado sin depender de document.visibilityState", () => {
    const hidden = Object.getOwnPropertyDescriptor(Document.prototype, "visibilityState");
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    try {
      expect(intervalOf("ABIERTA")).toBe(5_000);
      expect(intervalOf("PAUSADA")).toBe(15_000);
      expect(intervalOf("CERRADA")).toBe(false);
    } finally {
      delete (document as unknown as Record<string, unknown>).visibilityState;
      if (hidden) Object.defineProperty(Document.prototype, "visibilityState", hidden);
    }
  });

  it("sessionDetailQuery no sondea si no se pide poll (pestañas distintas de Monitor)", () => {
    for (const status of STATUSES) {
      expect(intervalOf(status, { poll: false })).toBe(false);
      expect(intervalOf(status, {})).toBe(false);
    }
  });

  it("sessionAssignmentsQuery: polling opt-in con pollWhile", () => {
    const interval = (opts?: { pollWhile?: Session["status"] }) =>
      (sessionAssignmentsQuery(1, opts).refetchInterval as () => unknown)();
    expect(interval()).toBe(false);
    expect(interval({})).toBe(false);
    expect(interval({ pollWhile: "ABIERTA" })).toBe(5_000);
    expect(interval({ pollWhile: "PAUSADA" })).toBe(15_000);
    expect(interval({ pollWhile: "CERRADA" })).toBe(false);
  });
});
