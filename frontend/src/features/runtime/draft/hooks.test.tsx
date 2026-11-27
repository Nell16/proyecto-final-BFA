import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { HttpResponse } from "msw";
import {
  bulkResult,
  mockRuntimeApi,
  ok,
  setBrowserOnline,
  setupDraftEnvironment,
  single,
  teardownDraftEnvironment,
} from "./draft-test-utils";
import { useDiscardNotice, useDraftAnswer, useRejectedAnswers, useSyncStatus } from "./hooks";
import { useRuntimeDraft } from "./store";
import { bindDraftOwner, flush } from "./sync";
import { useParticipantAuth } from "../../../store/participantAuth";

beforeEach(() => setupDraftEnvironment());
afterEach(() => teardownDraftEnvironment());

describe("useDraftAnswer", () => {
  it("refleja el valor optimista al instante, el estado pendiente y se confirma tras el PUT", async () => {
    const calls = mockRuntimeApi();
    const { result } = renderHook(() => useDraftAnswer(5, { subtestId: 7 }));
    expect(result.current.value).toBeUndefined();
    expect(result.current.isPending).toBe(false);

    let sending!: Promise<void>;
    act(() => {
      sending = result.current.setValue(single(50), 3);
    });
    // Síncrono: valor optimista y pendiente.
    expect(result.current.value).toEqual(single(50));
    expect(result.current.answer?.version).toBe(1);
    expect(result.current.isPending).toBe(true);

    await act(async () => {
      await sending;
    });
    expect(calls.puts[0]?.body).toEqual({ itemId: 5, selectedOptionIds: [50], timeUsedSeconds: 3 });
    expect(result.current.isPending).toBe(false);
    expect(result.current.value).toEqual(single(50));
  });

  it("expone el rechazo definitivo del ítem y lo limpia al responder de nuevo", async () => {
    useRuntimeDraft.getState().setAnswerLocal(5, single(50), undefined, 7);
    mockRuntimeApi({ bulk: () => ok([bulkResult(5, "RECHAZADA", "OPCION_INVALIDA")]) });
    const { result } = renderHook(() => useDraftAnswer(5));

    await act(async () => {
      await flush({ force: true });
    });
    expect(result.current.rejected).toMatchObject({ code: "OPCION_INVALIDA", value: single(50) });
    expect(result.current.isPending).toBe(false);

    mockRuntimeApi();
    await act(async () => {
      await result.current.setValue(single(51));
    });
    expect(result.current.rejected).toBeUndefined();
  });
});

describe("useSyncStatus y useRejectedAnswers", () => {
  it("reporta pending, isOffline, rejectedCount y lastSyncAt", async () => {
    setBrowserOnline(false);
    const { result } = renderHook(() => ({ status: useSyncStatus(), rejected: useRejectedAnswers() }));
    expect(result.current.status).toEqual({
      pending: 0,
      isOffline: false,
      rejectedCount: 0,
      lastSyncAt: null,
      isPaused: false,
      blockedCode: null,
    });

    act(() => {
      useRuntimeDraft.getState().setAnswerLocal(1, single(10), undefined, 7);
      useRuntimeDraft.getState().setAnswerLocal(2, single(20), undefined, 7);
    });
    expect(result.current.status.pending).toBe(2);

    setBrowserOnline(true);
    mockRuntimeApi({
      bulk: () => ok([bulkResult(1, "RECHAZADA", "SUBTEST_FINALIZADO"), bulkResult(2, "GUARDADA")]),
    });
    await act(async () => {
      await flush({ force: true });
    });

    expect(result.current.status.pending).toBe(0);
    expect(result.current.status.rejectedCount).toBe(1);
    expect(result.current.status.lastSyncAt).not.toBeNull();
    expect(result.current.rejected).toEqual([
      expect.objectContaining({ itemId: 1, code: "SUBTEST_FINALIZADO", value: single(10), subtestId: 7 }),
    ]);
  });

  it("marca isOffline en un fallo de red y isPaused/blockedCode con la sesión pausada", async () => {
    const { result } = renderHook(() => useSyncStatus());
    useRuntimeDraft.getState().setAnswerLocal(1, single(10));

    mockRuntimeApi({ bulk: () => HttpResponse.error() });
    await act(async () => {
      await flush({ force: true });
    });
    await waitFor(() => expect(result.current.isOffline).toBe(true));
    expect(result.current.pending).toBe(1);

    mockRuntimeApi({
      bulk: () =>
        HttpResponse.json(
          { success: false, data: null, error: { code: "SESION_PAUSADA", message: "pausada" } },
          { status: 409 },
        ),
    });
    await act(async () => {
      await flush({ force: true });
    });
    expect(result.current).toMatchObject({ isOffline: false, isPaused: true, blockedCode: "SESION_PAUSADA", pending: 1 });
  });
});

describe("useDiscardNotice", () => {
  it("avisa cuando se descarta la cola de otro participante y se puede descartar el aviso", () => {
    useRuntimeDraft.getState().setAnswerLocal(1, single(10));
    const { result } = renderHook(() => useDiscardNotice());
    expect(result.current.notice).toBeNull();

    act(() => {
      useParticipantAuth.getState().setSession({ token: "otro", assignmentId: 43 });
      bindDraftOwner({ assignmentId: 43, attemptId: 202 });
    });
    expect(result.current.notice).toMatchObject({ count: 1, previousAssignmentId: 42 });

    act(() => result.current.dismiss());
    expect(result.current.notice).toBeNull();
  });
});
