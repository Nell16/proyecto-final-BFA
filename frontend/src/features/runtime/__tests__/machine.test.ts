import { describe, expect, it, vi } from "vitest";
import {
  RUNTIME_ERROR_CODES,
  type AttemptStatus,
  type Evaluation,
  type RuntimeErrorCode,
  type RuntimeItem,
  type RuntimeSubtest,
  type SessionStatus,
  type SubtestAttempt,
} from "../../../api/schemas/runtime";
import {
  INITIAL_STATE,
  allSubtestsCompleted,
  buildTiming,
  canOpenSubtest,
  clampOrdinal,
  currentOrdinal,
  currentSubtestId,
  deadline,
  devWarnInvalidEvent,
  evaluationOf,
  isResumable,
  isSubtestOpenable,
  isTimingReferenceValid,
  isTerminal,
  isValidOrdinal,
  nextPendingSubtest,
  reduce,
  remainingMs,
  runnerReducer,
  startSubtestOkEvent,
  timingDeadline,
  timingRemainingMs,
  totalItemsOf,
  type BlockReason,
  type BloqueadoState,
  type PausadaState,
  type RespondiendoState,
  type ResumableState,
  type RunnerEvent,
  type RunnerState,
  type RunnerStateKind,
  type SubtestTiming,
} from "../machine";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const T0 = Date.parse("2026-11-25T10:00:00.000Z");
const iso = (ms: number): string => new Date(ms).toISOString();

function makeItem(id: number, order: number): RuntimeItem {
  return { id, order, itemType: "SOLO_TEXTO", responseType: "OPCION_UNICA", images: [], options: [] };
}

function makeSubtest(
  id: number,
  order: number,
  status: AttemptStatus = "NO_INICIADO",
  extra: Partial<RuntimeSubtest> & { itemCount?: number } = {},
): RuntimeSubtest {
  const { itemCount = 3, ...rest } = extra;
  return {
    id,
    code: `ST${id}`,
    name: `Subtest ${id}`,
    order,
    timeLimitSeconds: 600,
    randomizeItems: false,
    randomizeOptions: false,
    status,
    items: Array.from({ length: itemCount }, (_, i) => makeItem(id * 100 + i + 1, i + 1)),
    ...rest,
  };
}

function makeEvaluation(overrides: Partial<Evaluation> = {}): Evaluation {
  return {
    attemptId: 100,
    assignmentId: 7,
    sessionId: 3,
    participantName: "Ana Pérez",
    sessionName: "Sesión A",
    sessionStatus: "ABIERTA",
    attemptStatus: "EN_PROGRESO",
    subtests: [makeSubtest(1, 1), makeSubtest(2, 2), makeSubtest(3, 3)],
    ...overrides,
  };
}

function allCompletedEvaluation(): Evaluation {
  return makeEvaluation({
    subtests: [makeSubtest(1, 1, "COMPLETADO"), makeSubtest(2, 2, "COMPLETADO"), makeSubtest(3, 3, "COMPLETADO")],
  });
}

function notStartedEvaluation(): Evaluation {
  return makeEvaluation({ attemptId: null, attemptStatus: "NO_INICIADO" });
}

/** Timing "limpio": reloj de cliente y servidor sincronizados, 600 s restantes en T0. */
function cleanTiming(overrides: Partial<SubtestTiming> = {}): SubtestTiming {
  return {
    timeLimitSeconds: 600,
    startedAt: iso(T0),
    remainingSeconds: 600,
    serverNow: iso(T0),
    paused: false,
    receivedAt: T0,
    ...overrides,
  };
}

function respondiendo(ordinal = 2, timing: SubtestTiming = cleanTiming()): RespondiendoState {
  return {
    kind: "respondiendo",
    evaluation: makeEvaluation({ subtests: [makeSubtest(1, 1, "EN_PROGRESO"), makeSubtest(2, 2), makeSubtest(3, 3)] }),
    subtestId: 1,
    ordinal,
    totalItems: 3,
    timing,
  };
}

function pausada(resumeTo: ResumableState = respondiendo(), frozenRemainingMs: number | null = 300_000): PausadaState {
  return { kind: "pausada", resumeTo, frozenRemainingMs, pausedAt: null };
}

function bloqueado(reason: BlockReason = "expirado"): BloqueadoState {
  return { kind: "bloqueado", reason, evaluation: makeEvaluation() };
}

const STATES: Record<RunnerStateKind, RunnerState> = {
  validando: INITIAL_STATE,
  bienvenida: { kind: "bienvenida", evaluation: notStartedEvaluation() },
  listaSubtests: { kind: "listaSubtests", evaluation: makeEvaluation() },
  instrucciones: { kind: "instrucciones", evaluation: makeEvaluation(), subtestId: 1 },
  respondiendo: respondiendo(2),
  finalizandoSubtest: {
    kind: "finalizandoSubtest",
    evaluation: makeEvaluation({ subtests: [makeSubtest(1, 1, "EN_PROGRESO"), makeSubtest(2, 2), makeSubtest(3, 3)] }),
    subtestId: 1,
    totalItems: 3,
    timing: cleanTiming(),
    reason: "usuario",
  },
  resumen: { kind: "resumen", evaluation: allCompletedEvaluation() },
  finalizando: { kind: "finalizando", evaluation: allCompletedEvaluation() },
  completada: { kind: "completada", evaluation: allCompletedEvaluation() },
  bloqueado: bloqueado(),
  pausada: pausada(),
};

const ALL_KINDS = Object.keys(STATES) as RunnerStateKind[];
const WORK_KINDS: RunnerStateKind[] = [
  "bienvenida",
  "listaSubtests",
  "instrucciones",
  "respondiendo",
  "finalizandoSubtest",
  "resumen",
  "finalizando",
];
const NON_TERMINAL: RunnerStateKind[] = ["validando", ...WORK_KINDS, "pausada"];

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function loaded(evaluation: Evaluation, clientNow = T0): RunnerEvent {
  return { type: "EVALUATION_LOADED", evaluation, clientNow };
}

function ev<T extends RunnerEvent["type"]>(event: Extract<RunnerEvent, { type: T }>): RunnerEvent {
  return event;
}

function expectKind<K extends RunnerStateKind>(state: RunnerState, kind: K): Extract<RunnerState, { kind: K }> {
  expect(state.kind).toBe(kind);
  return state as Extract<RunnerState, { kind: K }>;
}

function run(state: RunnerState, ...events: RunnerEvent[]): RunnerState {
  return events.reduce<RunnerState>((s, e) => reduce(s, e), state);
}

// ---------------------------------------------------------------------------
// Tabla estado × evento
// ---------------------------------------------------------------------------

type MatrixRow = readonly [label: string, event: RunnerEvent, validIn: readonly RunnerStateKind[]];

const MATRIX: readonly MatrixRow[] = [
  ["EVALUATION_LOADED", loaded(makeEvaluation()), NON_TERMINAL],
  ["START_ATTEMPT_OK", ev({ type: "START_ATTEMPT_OK", attemptId: 100 }), ["bienvenida"]],
  ["OPEN_SUBTEST(1)", ev({ type: "OPEN_SUBTEST", subtestId: 1 }), ["listaSubtests"]],
  ["BACK_TO_LIST", ev({ type: "BACK_TO_LIST" }), ["instrucciones"]],
  [
    "START_SUBTEST_OK(1)",
    ev({
      type: "START_SUBTEST_OK",
      subtestId: 1,
      timing: { remainingSeconds: 600, serverNow: iso(T0) },
      clientNow: T0,
    }),
    ["instrucciones"],
  ],
  ["GO_TO_ITEM(3)", ev({ type: "GO_TO_ITEM", ordinal: 3 }), ["respondiendo"]],
  ["NEXT", ev({ type: "NEXT" }), ["respondiendo"]],
  ["PREV", ev({ type: "PREV" }), ["respondiendo"]],
  ["REQUEST_FINISH_SUBTEST", ev({ type: "REQUEST_FINISH_SUBTEST" }), ["respondiendo"]],
  ["FINISH_SUBTEST_OK(1)", ev({ type: "FINISH_SUBTEST_OK", subtestId: 1 }), ["finalizandoSubtest"]],
  ["FINISH_SUBTEST_FAILED(1)", ev({ type: "FINISH_SUBTEST_FAILED", subtestId: 1 }), ["finalizandoSubtest"]],
  ["DEADLINE_REACHED", ev({ type: "DEADLINE_REACHED", clientNow: T0 + 600_000 }), ["respondiendo"]],
  ["REQUEST_FINISH_ATTEMPT", ev({ type: "REQUEST_FINISH_ATTEMPT" }), ["resumen"]],
  ["FINISH_ATTEMPT_OK", ev({ type: "FINISH_ATTEMPT_OK" }), ["finalizando"]],
  ["FINISH_ATTEMPT_FAILED", ev({ type: "FINISH_ATTEMPT_FAILED" }), ["finalizando"]],
  ["SESSION_STATUS_CHANGED(PAUSADA)", ev({ type: "SESSION_STATUS_CHANGED", status: "PAUSADA", clientNow: T0 }), WORK_KINDS],
  ["SESSION_STATUS_CHANGED(ABIERTA)", ev({ type: "SESSION_STATUS_CHANGED", status: "ABIERTA", clientNow: T0 }), ["pausada"]],
  ["SESSION_STATUS_CHANGED(CERRADA)", ev({ type: "SESSION_STATUS_CHANGED", status: "CERRADA", clientNow: T0 }), NON_TERMINAL],
  ["SESSION_STATUS_CHANGED(CANCELADA)", ev({ type: "SESSION_STATUS_CHANGED", status: "CANCELADA", clientNow: T0 }), NON_TERMINAL],
  ["SESSION_STATUS_CHANGED(PROGRAMADA)", ev({ type: "SESSION_STATUS_CHANGED", status: "PROGRAMADA", clientNow: T0 }), NON_TERMINAL],
  ["SESSION_STATUS_CHANGED(DESCONOCIDO)", ev({ type: "SESSION_STATUS_CHANGED", status: "DESCONOCIDO", clientNow: T0 }), []],
  ["SERVER_ERROR(SESION_PAUSADA)", ev({ type: "SERVER_ERROR", code: "SESION_PAUSADA", clientNow: T0 }), WORK_KINDS],
  ["SERVER_ERROR(SESION_NO_ABIERTA)", ev({ type: "SERVER_ERROR", code: "SESION_NO_ABIERTA", clientNow: T0 }), NON_TERMINAL],
  ["SERVER_ERROR(SESION_FINALIZADA)", ev({ type: "SERVER_ERROR", code: "SESION_FINALIZADA", clientNow: T0 }), NON_TERMINAL],
  ["SERVER_ERROR(TIEMPO_AGOTADO)", ev({ type: "SERVER_ERROR", code: "TIEMPO_AGOTADO", clientNow: T0 }), ["respondiendo"]],
  ["SERVER_ERROR(TOKEN_EXPIRADO)", ev({ type: "SERVER_ERROR", code: "TOKEN_EXPIRADO", clientNow: T0 }), NON_TERMINAL],
  ["SERVER_ERROR(ASIGNACION_NO_OPERABLE)", ev({ type: "SERVER_ERROR", code: "ASIGNACION_NO_OPERABLE", clientNow: T0 }), NON_TERMINAL],
  ["ACCESS_REVOKED", ev({ type: "ACCESS_REVOKED" }), NON_TERMINAL],
];

describe("tabla estado × evento", () => {
  const cases = ALL_KINDS.flatMap((kind) =>
    MATRIX.map(([label, event, validIn]) => ({
      kind,
      label,
      event,
      valid: validIn.includes(kind),
    })),
  );

  it("cubre todos los tipos de evento y todos los estados", () => {
    expect(new Set(MATRIX.map(([, e]) => e.type))).toEqual(
      new Set<RunnerEvent["type"]>([
        "EVALUATION_LOADED",
        "START_ATTEMPT_OK",
        "OPEN_SUBTEST",
        "BACK_TO_LIST",
        "START_SUBTEST_OK",
        "GO_TO_ITEM",
        "NEXT",
        "PREV",
        "REQUEST_FINISH_SUBTEST",
        "FINISH_SUBTEST_OK",
        "FINISH_SUBTEST_FAILED",
        "DEADLINE_REACHED",
        "REQUEST_FINISH_ATTEMPT",
        "FINISH_ATTEMPT_OK",
        "FINISH_ATTEMPT_FAILED",
        "SESSION_STATUS_CHANGED",
        "SERVER_ERROR",
        "ACCESS_REVOKED",
      ]),
    );
    expect(ALL_KINDS).toHaveLength(11);
  });

  it.each(cases.filter((c) => c.valid))("$kind + $label es válido (cambia de estado)", ({ kind, event }) => {
    const state = STATES[kind];
    const onInvalid = vi.fn();
    const next = reduce(state, event, { onInvalid });
    expect(onInvalid).not.toHaveBeenCalled();
    expect(next).not.toBe(state);
  });

  it.each(cases.filter((c) => !c.valid))("$kind + $label es inválido (mismo estado)", ({ kind, event }) => {
    const state = STATES[kind];
    const onInvalid = vi.fn();
    const next = reduce(state, event, { onInvalid });
    expect(next).toBe(state);
    expect(onInvalid).toHaveBeenCalledExactlyOnceWith(state, event);
  });
});

// ---------------------------------------------------------------------------
// Carga de la evaluación
// ---------------------------------------------------------------------------

describe("EVALUATION_LOADED desde validando", () => {
  const load = (evaluation: Evaluation): RunnerState => reduce(INITIAL_STATE, loaded(evaluation));

  it("intento sin iniciar → bienvenida", () => {
    const evaluation = notStartedEvaluation();
    const state = expectKind(load(evaluation), "bienvenida");
    expect(state.evaluation).toBe(evaluation);
  });

  it("intento NO_INICIADO aunque tenga id → bienvenida", () => {
    expectKind(load(makeEvaluation({ attemptStatus: "NO_INICIADO" })), "bienvenida");
  });

  it("intento en progreso con subtests pendientes → listaSubtests (salta la bienvenida)", () => {
    expectKind(load(makeEvaluation()), "listaSubtests");
  });

  it("intento INTERRUMPIDO se trata como iniciado", () => {
    expectKind(load(makeEvaluation({ attemptStatus: "INTERRUMPIDO" })), "listaSubtests");
  });

  it("con todos los subtests COMPLETADO → resumen", () => {
    expectKind(load(allCompletedEvaluation()), "resumen");
  });

  it("sin subtests nunca se considera 'todos completados'", () => {
    expectKind(load(makeEvaluation({ subtests: [] })), "listaSubtests");
  });

  it("intento COMPLETADO → completada (aunque la sesión esté cerrada)", () => {
    expectKind(load(makeEvaluation({ attemptStatus: "COMPLETADO", sessionStatus: "CERRADA" })), "completada");
  });

  it("intento ANULADO → bloqueado(asignacionNoOperable)", () => {
    expect(expectKind(load(makeEvaluation({ attemptStatus: "ANULADO" })), "bloqueado").reason).toBe(
      "asignacionNoOperable",
    );
  });

  it.each<[SessionStatus, BlockReason]>([
    ["CERRADA", "sesionCerrada"],
    ["CANCELADA", "sesionCancelada"],
    ["PROGRAMADA", "sesionNoAbierta"],
  ])("sesión %s → bloqueado(%s) conservando la evaluación", (sessionStatus, reason) => {
    const evaluation = makeEvaluation({ sessionStatus });
    const state = expectKind(load(evaluation), "bloqueado");
    expect(state.reason).toBe(reason);
    expect(state.evaluation).toBe(evaluation);
  });

  it("sesión DESCONOCIDO no bloquea", () => {
    expectKind(load(makeEvaluation({ sessionStatus: "DESCONOCIDO" })), "listaSubtests");
  });

  it("sesión PAUSADA → pausada que recuerda la fase (bienvenida) y el pausedAt", () => {
    const state = expectKind(
      load(makeEvaluation({ ...notStartedEvaluation(), sessionStatus: "PAUSADA", pausedAt: iso(T0 - 5000) })),
      "pausada",
    );
    expect(state.resumeTo.kind).toBe("bienvenida");
    expect(state.pausedAt).toBe(iso(T0 - 5000));
    expect(state.frozenRemainingMs).toBeNull();
  });

  it("sesión PAUSADA con intento en curso → pausada que recuerda listaSubtests", () => {
    const state = expectKind(load(makeEvaluation({ sessionStatus: "PAUSADA" })), "pausada");
    expect(state.resumeTo.kind).toBe("listaSubtests");
  });
});

describe("EVALUATION_LOADED (re-sincronización)", () => {
  it("conserva la fase y reemplaza la evaluación", () => {
    const state = STATES.instrucciones;
    const evaluation = makeEvaluation({ sessionName: "Otra" });
    const next = expectKind(reduce(state, loaded(evaluation)), "instrucciones");
    expect(next.evaluation).toBe(evaluation);
    expect(next.subtestId).toBe(1);
  });

  it("refresca el tiempo de respondiendo con el timing del servidor", () => {
    const fresh = makeEvaluation({
      subtests: [
        makeSubtest(1, 1, "EN_PROGRESO", {
          timing: { remainingSeconds: 250, serverNow: iso(T0 + 350_000), startedAt: iso(T0) },
        }),
        makeSubtest(2, 2),
        makeSubtest(3, 3),
      ],
    });
    const next = expectKind(reduce(respondiendo(), loaded(fresh, T0 + 350_000)), "respondiendo");
    expect(next.ordinal).toBe(2);
    expect(remainingMs(next, T0 + 350_000)).toBe(250_000);
    expect(deadline(next)).toBe(T0 + 600_000);
  });

  it("si el servidor no trae timing conserva el local", () => {
    const state = respondiendo();
    const next = expectKind(reduce(state, loaded(makeEvaluation())), "respondiendo");
    expect(next.timing).toBe(state.timing);
  });

  it("si el servidor ya cerró el subtest en curso, sale a la lista", () => {
    const fresh = makeEvaluation({
      subtests: [makeSubtest(1, 1, "COMPLETADO"), makeSubtest(2, 2), makeSubtest(3, 3)],
    });
    expectKind(reduce(respondiendo(), loaded(fresh)), "listaSubtests");
    expectKind(reduce(STATES.instrucciones, loaded(fresh)), "listaSubtests");
  });

  it("si el servidor cerró el último subtest, va a resumen", () => {
    expectKind(reduce(respondiendo(), loaded(allCompletedEvaluation())), "resumen");
    expectKind(reduce(STATES.listaSubtests, loaded(allCompletedEvaluation())), "resumen");
  });

  it("sesión CERRADA / CANCELADA / intento ANULADO en un refetch bloquean", () => {
    expect(expectKind(reduce(respondiendo(), loaded(makeEvaluation({ sessionStatus: "CERRADA" }))), "bloqueado").reason).toBe(
      "sesionCerrada",
    );
    expect(expectKind(reduce(respondiendo(), loaded(makeEvaluation({ sessionStatus: "CANCELADA" }))), "bloqueado").reason).toBe(
      "sesionCancelada",
    );
    expect(expectKind(reduce(respondiendo(), loaded(makeEvaluation({ attemptStatus: "ANULADO" }))), "bloqueado").reason).toBe(
      "asignacionNoOperable",
    );
  });

  it("intento COMPLETADO en un refetch → completada", () => {
    expectKind(reduce(STATES.finalizando, loaded(makeEvaluation({ attemptStatus: "COMPLETADO" }))), "completada");
  });
});

// ---------------------------------------------------------------------------
// Flujo completo
// ---------------------------------------------------------------------------

describe("flujo feliz completo", () => {
  it("validando → … → completada pasando por los 3 subtests en orden", () => {
    const startTiming = { startedAt: iso(T0), remainingSeconds: 600, serverNow: iso(T0) };
    let state: RunnerState = reduce(INITIAL_STATE, loaded(deepFreeze(notStartedEvaluation())));
    expect(state.kind).toBe("bienvenida");

    state = reduce(state, { type: "START_ATTEMPT_OK", attemptId: 100 });
    const lista = expectKind(state, "listaSubtests");
    expect(lista.evaluation.attemptId).toBe(100);
    expect(lista.evaluation.attemptStatus).toBe("EN_PROGRESO");

    for (const subtestId of [1, 2, 3]) {
      state = reduce(state, { type: "OPEN_SUBTEST", subtestId });
      expect(expectKind(state, "instrucciones").subtestId).toBe(subtestId);

      state = reduce(state, {
        type: "START_SUBTEST_OK",
        subtestId,
        timing: startTiming,
        clientNow: T0,
      });
      const r = expectKind(state, "respondiendo");
      expect([r.subtestId, r.ordinal, r.totalItems]).toEqual([subtestId, 1, 3]);
      expect(r.evaluation.subtests.find((s) => s.id === subtestId)?.status).toBe("EN_PROGRESO");

      state = run(state, { type: "NEXT" }, { type: "NEXT" }, { type: "REQUEST_FINISH_SUBTEST" });
      expect(expectKind(state, "finalizandoSubtest").reason).toBe("usuario");

      state = reduce(state, { type: "FINISH_SUBTEST_OK", subtestId });
      expect(state.kind).toBe(subtestId < 3 ? "listaSubtests" : "resumen");
    }

    const resumen = expectKind(state, "resumen");
    expect(allSubtestsCompleted(resumen.evaluation)).toBe(true);

    state = reduce(state, { type: "REQUEST_FINISH_ATTEMPT" });
    expect(state.kind).toBe("finalizando");
    state = reduce(state, { type: "FINISH_ATTEMPT_OK" });
    const done = expectKind(state, "completada");
    expect(done.evaluation.attemptStatus).toBe("COMPLETADO");
  });

  it("no muta los estados ni la evaluación de entrada (congelados)", () => {
    const state = deepFreeze(STATES.listaSubtests);
    expect(() =>
      run(
        state,
        { type: "OPEN_SUBTEST", subtestId: 1 },
        { type: "START_SUBTEST_OK", subtestId: 1, timing: {}, clientNow: T0 },
        { type: "NEXT" },
        { type: "REQUEST_FINISH_SUBTEST" },
        { type: "FINISH_SUBTEST_OK", subtestId: 1 },
      ),
    ).not.toThrow();
  });

  it("BACK_TO_LIST vuelve a la lista desde instrucciones", () => {
    const state = reduce(STATES.instrucciones, { type: "BACK_TO_LIST" });
    expectKind(state, "listaSubtests");
  });

  it("START_ATTEMPT_OK fija el attemptId en la evaluación sin mutar la original", () => {
    const evaluation = notStartedEvaluation();
    const next = expectKind(
      reduce({ kind: "bienvenida", evaluation }, { type: "START_ATTEMPT_OK", attemptId: 55 }),
      "listaSubtests",
    );
    expect(next.evaluation.attemptId).toBe(55);
    expect(evaluation.attemptId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Orden de subtests
// ---------------------------------------------------------------------------

describe("orden de subtests", () => {
  const evaluation = makeEvaluation({
    subtests: [makeSubtest(1, 1, "COMPLETADO"), makeSubtest(2, 2, "EN_PROGRESO"), makeSubtest(3, 3)],
  });
  const lista: RunnerState = { kind: "listaSubtests", evaluation };

  it("isSubtestOpenable: solo el primero no completado", () => {
    expect(isSubtestOpenable(evaluation, 1)).toBe(false); // COMPLETADO
    expect(isSubtestOpenable(evaluation, 2)).toBe(true); // EN_PROGRESO, anteriores completos
    expect(isSubtestOpenable(evaluation, 3)).toBe(false); // se salta el 2
    expect(isSubtestOpenable(evaluation, 999)).toBe(false); // inexistente
  });

  it("canOpenSubtest exige estar en listaSubtests", () => {
    expect(canOpenSubtest(lista, evaluation, 2)).toBe(true);
    expect(canOpenSubtest(lista, evaluation, 3)).toBe(false);
    expect(canOpenSubtest(lista, evaluation, 1)).toBe(false);
    for (const kind of ALL_KINDS.filter((k) => k !== "listaSubtests")) {
      expect(canOpenSubtest(STATES[kind], evaluation, 2)).toBe(false);
    }
  });

  it("OPEN_SUBTEST de un subtest COMPLETADO es inválido", () => {
    const onInvalid = vi.fn();
    expect(reduce(lista, { type: "OPEN_SUBTEST", subtestId: 1 }, { onInvalid })).toBe(lista);
    expect(onInvalid).toHaveBeenCalledTimes(1);
  });

  it("OPEN_SUBTEST que se salta el orden es inválido", () => {
    expect(reduce(lista, { type: "OPEN_SUBTEST", subtestId: 3 })).toBe(lista);
  });

  it("OPEN_SUBTEST de un subtest inexistente es inválido", () => {
    expect(reduce(lista, { type: "OPEN_SUBTEST", subtestId: 42 })).toBe(lista);
  });

  it("OPEN_SUBTEST del subtest en progreso es válido", () => {
    expect(expectKind(reduce(lista, { type: "OPEN_SUBTEST", subtestId: 2 }), "instrucciones").subtestId).toBe(2);
  });

  it("el orden sale del campo `order`, no de la posición en el arreglo", () => {
    const shuffled = makeEvaluation({
      subtests: [makeSubtest(30, 3), makeSubtest(10, 1), makeSubtest(20, 2)],
    });
    expect(isSubtestOpenable(shuffled, 10)).toBe(true);
    expect(isSubtestOpenable(shuffled, 20)).toBe(false);
    expect(isSubtestOpenable(shuffled, 30)).toBe(false);
    expect(nextPendingSubtest(shuffled)?.id).toBe(10);
  });

  it("un subtest ANULADO no se abre pero no bloquea el orden (decisión del orquestador)", () => {
    const annulled = makeEvaluation({
      subtests: [makeSubtest(1, 1, "ANULADO"), makeSubtest(2, 2)],
    });
    expect(isSubtestOpenable(annulled, 1)).toBe(false);
    expect(isSubtestOpenable(annulled, 2)).toBe(true);
    expect(nextPendingSubtest(annulled)?.id).toBe(2);
    expect(allSubtestsCompleted(makeEvaluation({ subtests: [makeSubtest(1, 1, "ANULADO"), makeSubtest(2, 2, "COMPLETADO")] }))).toBe(true);
  });

  it("un subtest DESCONOCIDO no se puede abrir ni se salta", () => {
    expect(isSubtestOpenable(makeEvaluation({ subtests: [makeSubtest(1, 1, "DESCONOCIDO")] }), 1)).toBe(false);
    const unknownFirst = makeEvaluation({ subtests: [makeSubtest(1, 1, "DESCONOCIDO"), makeSubtest(2, 2)] });
    expect(isSubtestOpenable(unknownFirst, 2)).toBe(false);
  });

  it("un subtest INTERRUMPIDO se puede reabrir", () => {
    expect(isSubtestOpenable(makeEvaluation({ subtests: [makeSubtest(1, 1, "INTERRUMPIDO")] }), 1)).toBe(true);
  });

  it("sin intento no se abre nada", () => {
    expect(isSubtestOpenable(notStartedEvaluation(), 1)).toBe(false);
  });

  it("no se puede reabrir un subtest recién completado", () => {
    let state: RunnerState = STATES.finalizandoSubtest;
    state = reduce(state, { type: "FINISH_SUBTEST_OK", subtestId: 1 });
    expectKind(state, "listaSubtests");
    expect(reduce(state, { type: "OPEN_SUBTEST", subtestId: 1 })).toBe(state);
    expect(expectKind(reduce(state, { type: "OPEN_SUBTEST", subtestId: 2 }), "instrucciones").subtestId).toBe(2);
  });

  it("allSubtestsCompleted / nextPendingSubtest", () => {
    expect(allSubtestsCompleted(evaluation)).toBe(false);
    expect(allSubtestsCompleted(allCompletedEvaluation())).toBe(true);
    expect(allSubtestsCompleted(makeEvaluation({ subtests: [] }))).toBe(false);
    expect(nextPendingSubtest(evaluation)?.id).toBe(2);
    expect(nextPendingSubtest(allCompletedEvaluation())).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Ordinal
// ---------------------------------------------------------------------------

describe("ordinal acotado a [1, totalItems]", () => {
  it.each([0, -1, 4, 99, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "GO_TO_ITEM(%s) fuera de rango o no entero es inválido",
    (ordinal) => {
      const state = respondiendo(2);
      const onInvalid = vi.fn();
      expect(reduce(state, { type: "GO_TO_ITEM", ordinal }, { onInvalid })).toBe(state);
      expect(onInvalid).toHaveBeenCalledTimes(1);
    },
  );

  it.each([1, 2, 3])("GO_TO_ITEM(%s) dentro de rango es válido", (ordinal) => {
    const next = expectKind(reduce(respondiendo(2), { type: "GO_TO_ITEM", ordinal }), "respondiendo");
    expect(next.ordinal).toBe(ordinal);
  });

  it("GO_TO_ITEM al ordinal actual devuelve el mismo estado sin avisar", () => {
    const state = respondiendo(2);
    const onInvalid = vi.fn();
    expect(reduce(state, { type: "GO_TO_ITEM", ordinal: 2 }, { onInvalid })).toBe(state);
    expect(onInvalid).not.toHaveBeenCalled();
  });

  it("NEXT / PREV recorren el rango y se detienen en los extremos", () => {
    let state: RunnerState = respondiendo(1);
    expect(reduce(state, { type: "PREV" })).toBe(state);
    state = reduce(state, { type: "NEXT" });
    expect(currentOrdinal(state)).toBe(2);
    state = reduce(state, { type: "NEXT" });
    expect(currentOrdinal(state)).toBe(3);
    expect(reduce(state, { type: "NEXT" })).toBe(state);
    state = reduce(state, { type: "PREV" });
    expect(currentOrdinal(state)).toBe(2);
  });

  it("navegar no toca el timing ni la evaluación", () => {
    const start = respondiendo(1);
    const next = expectKind(reduce(start, { type: "NEXT" }), "respondiendo");
    expect(next.timing).toBe(start.timing);
    expect(next.evaluation).toBe(start.evaluation);
  });

  it("START_SUBTEST_OK con ordinal inicial lo respeta y valida el rango", () => {
    const base = { type: "START_SUBTEST_OK", subtestId: 1, timing: {}, clientNow: T0 } as const;
    expect(expectKind(reduce(STATES.instrucciones, { ...base, ordinal: 3 }), "respondiendo").ordinal).toBe(3);
    expect(reduce(STATES.instrucciones, { ...base, ordinal: 4 })).toBe(STATES.instrucciones);
    expect(reduce(STATES.instrucciones, { ...base, ordinal: 0 })).toBe(STATES.instrucciones);
  });

  it("START_SUBTEST_OK de otro subtest que el de las instrucciones es inválido", () => {
    const event = { type: "START_SUBTEST_OK", subtestId: 2, timing: {}, clientNow: T0 } as const;
    expect(reduce(STATES.instrucciones, event)).toBe(STATES.instrucciones);
  });

  it("un subtest sin ítems no puede iniciarse (el rango [1, 0] está vacío)", () => {
    const empty = makeEvaluation({ subtests: [makeSubtest(1, 1, "NO_INICIADO", { itemCount: 0 })] });
    const state: RunnerState = { kind: "instrucciones", evaluation: empty, subtestId: 1 };
    expect(reduce(state, { type: "START_SUBTEST_OK", subtestId: 1, timing: {}, clientNow: T0 })).toBe(state);
  });

  it("totalItemsOf / isValidOrdinal / clampOrdinal", () => {
    const evaluation = makeEvaluation();
    expect(totalItemsOf(evaluation, 1)).toBe(3);
    expect(totalItemsOf(evaluation, 999)).toBe(0);
    expect(isValidOrdinal(1, 3)).toBe(true);
    expect(isValidOrdinal(3, 3)).toBe(true);
    expect(isValidOrdinal(0, 3)).toBe(false);
    expect(isValidOrdinal(2, 0)).toBe(false);
    expect(clampOrdinal(0, 3)).toBe(1);
    expect(clampOrdinal(9, 3)).toBe(3);
    expect(clampOrdinal(2.9, 3)).toBe(2);
    expect(clampOrdinal(Number.NaN, 3)).toBe(1);
    expect(clampOrdinal(5, 0)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Cierre de subtest por usuario / tiempo
// ---------------------------------------------------------------------------

describe("cierre de subtest", () => {
  it("DEADLINE_REACHED en respondiendo → finalizandoSubtest(tiempo), conservando timing y subtest", () => {
    const state = respondiendo(3);
    const next = expectKind(reduce(state, { type: "DEADLINE_REACHED", clientNow: T0 + 600_000 }), "finalizandoSubtest");
    expect(next.reason).toBe("tiempo");
    expect(next.subtestId).toBe(1);
    expect(next.totalItems).toBe(3);
    expect(next.timing).toBe(state.timing);
    expect(next.evaluation).toBe(state.evaluation);
  });

  it("DEADLINE_REACHED con el tiempo congelado por el servidor es inválido", () => {
    const state = respondiendo(2, cleanTiming({ paused: true }));
    expect(reduce(state, { type: "DEADLINE_REACHED", clientNow: T0 + 600_000 })).toBe(state);
  });

  it("REQUEST_FINISH_SUBTEST → finalizandoSubtest(usuario)", () => {
    expect(expectKind(reduce(respondiendo(), { type: "REQUEST_FINISH_SUBTEST" }), "finalizandoSubtest").reason).toBe(
      "usuario",
    );
  });

  it("DEADLINE_REACHED / REQUEST_FINISH_SUBTEST no se repiten en finalizandoSubtest", () => {
    const state = STATES.finalizandoSubtest;
    expect(reduce(state, { type: "DEADLINE_REACHED", clientNow: T0 + 600_000 })).toBe(state);
    expect(reduce(state, { type: "REQUEST_FINISH_SUBTEST" })).toBe(state);
  });

  it("FINISH_SUBTEST_OK marca el subtest COMPLETADO sin mutar la evaluación anterior", () => {
    const before = STATES.finalizandoSubtest;
    const next = expectKind(reduce(before, { type: "FINISH_SUBTEST_OK", subtestId: 1 }), "listaSubtests");
    expect(next.evaluation.subtests.map((s) => s.status)).toEqual(["COMPLETADO", "NO_INICIADO", "NO_INICIADO"]);
    expect(evaluationOf(before)?.subtests[0]?.status).toBe("EN_PROGRESO");
  });

  it("FINISH_SUBTEST_OK de otro subtest es inválido", () => {
    expect(reduce(STATES.finalizandoSubtest, { type: "FINISH_SUBTEST_OK", subtestId: 2 })).toBe(STATES.finalizandoSubtest);
  });

  it("al completar el último subtest va directo a resumen", () => {
    const state: RunnerState = {
      kind: "finalizandoSubtest",
      evaluation: makeEvaluation({
        subtests: [makeSubtest(1, 1, "COMPLETADO"), makeSubtest(2, 2, "COMPLETADO"), makeSubtest(3, 3, "EN_PROGRESO")],
      }),
      subtestId: 3,
      totalItems: 3,
      timing: cleanTiming(),
      reason: "tiempo",
    };
    expectKind(reduce(state, { type: "FINISH_SUBTEST_OK", subtestId: 3 }), "resumen");
  });

  it("subtest sin límite de tiempo: deadline nulo y remainingMs nulo", () => {
    const state = reduce(STATES.instrucciones, {
      type: "START_SUBTEST_OK",
      subtestId: 1,
      timing: {},
      timeLimitSeconds: null,
      clientNow: T0,
    });
    expect(deadline(state)).toBeNull();
    expect(remainingMs(state, T0 + 1_000_000)).toBeNull();
  });

  it("FINISH_SUBTEST_FAILED con reason usuario vuelve a respondiendo conservando returnOrdinal, timing y evaluation", () => {
    const start = respondiendo(3);
    const finishing = expectKind(reduce(start, { type: "REQUEST_FINISH_SUBTEST" }), "finalizandoSubtest");
    const recovered = expectKind(
      reduce(finishing, { type: "FINISH_SUBTEST_FAILED", subtestId: 1 }),
      "respondiendo",
    );
    expect(recovered.ordinal).toBe(3);
    expect(recovered.timing).toBe(start.timing);
    expect(recovered.evaluation).toBe(start.evaluation);

    // Con reason === "tiempo" o subtestId distinto es inválido (no-op)
    const timed = expectKind(reduce(start, { type: "DEADLINE_REACHED", clientNow: T0 + 600_000 }), "finalizandoSubtest");
    expect(reduce(timed, { type: "FINISH_SUBTEST_FAILED", subtestId: 1 })).toBe(timed);
    expect(reduce(finishing, { type: "FINISH_SUBTEST_FAILED", subtestId: 99 })).toBe(finishing);
  });

  it("FINISH_ATTEMPT_FAILED en finalizando vuelve a resumen conservando evaluation", () => {
    const finalizando = STATES.finalizando;
    const recovered = expectKind(reduce(finalizando, { type: "FINISH_ATTEMPT_FAILED" }), "resumen");
    expect(recovered.evaluation).toBe(evaluationOf(finalizando));
  });
});

// ---------------------------------------------------------------------------
// Deadline y desfase de reloj
// ---------------------------------------------------------------------------

describe("deadline y remainingMs", () => {
  const stateWith = (timing: SubtestTiming): RunnerState => respondiendo(1, timing);

  it("con relojes sincronizados: serverNow + remainingSeconds", () => {
    const state = stateWith(cleanTiming());
    expect(deadline(state)).toBe(T0 + 600_000);
    expect(remainingMs(state, T0)).toBe(600_000);
    expect(remainingMs(state, T0 + 100_000)).toBe(500_000);
  });

  it("cliente 5 min ADELANTADO respecto del servidor: el deadline se corrige a la hora del cliente", () => {
    const skew = 300_000;
    const timing = buildTiming({ remainingSeconds: 600, serverNow: iso(T0) }, 600, T0 + skew);
    const state = stateWith(timing);
    expect(deadline(state)).toBe(T0 + skew + 600_000);
    // Justo al recibir, el restante es el que dijo el servidor, no 600 s − 300 s.
    expect(remainingMs(state, T0 + skew)).toBe(600_000);
    expect(remainingMs(state, T0 + skew + 599_000)).toBe(1_000);
  });

  it("cliente 2 min ATRASADO respecto del servidor", () => {
    const skew = -120_000;
    const timing = buildTiming({ remainingSeconds: 90, serverNow: iso(T0) }, 600, T0 + skew);
    const state = stateWith(timing);
    expect(deadline(state)).toBe(T0 + skew + 90_000);
    expect(remainingMs(state, T0 + skew)).toBe(90_000);
    expect(remainingMs(state, T0 + skew + 90_000)).toBe(0);
  });

  it("el desfase de reloj no cambia el restante observado en el cliente", () => {
    for (const skew of [-3_600_000, -1, 0, 1, 250, 86_400_000]) {
      const timing = buildTiming({ remainingSeconds: 120, serverNow: iso(T0) }, 600, T0 + skew);
      expect(timingRemainingMs(timing, T0 + skew + 30_000)).toBe(90_000);
    }
  });

  it("sin serverNow no hay referencia válida: ni siquiera con remainingSeconds hay deadline (F2-FIX-2)", () => {
    const timing = buildTiming({ remainingSeconds: 60 }, 600, T0 + 7_000);
    expect(timingDeadline(timing)).toBeNull();
  });

  it("sin remainingSeconds usa startedAt + timeLimitSeconds, corregido por el desfase", () => {
    // El servidor ya lleva 100 s de subtest; el cliente va 50 s adelantado.
    const timing = buildTiming({ startedAt: iso(T0 - 100_000), serverNow: iso(T0) }, 600, T0 + 50_000);
    expect(timingDeadline(timing)).toBe(T0 - 100_000 + 600_000 + 50_000);
    expect(timingRemainingMs(timing, T0 + 50_000)).toBe(500_000);
  });

  it("sin remainingSeconds ni serverNow no hay referencia monotónica: no hay deadline (nunca se mezcla con la hora de pared)", () => {
    const timing = buildTiming({ startedAt: iso(T0) }, 600, T0 + 10_000);
    expect(timingDeadline(timing)).toBeNull();
    expect(timingRemainingMs(timing, T0 + 99_999_999)).toBeNull();
  });

  it("remainingSeconds tiene prioridad sobre startedAt + límite", () => {
    const timing = buildTiming({ startedAt: iso(T0 - 500_000), remainingSeconds: 300, serverNow: iso(T0) }, 600, T0);
    expect(timingDeadline(timing)).toBe(T0 + 300_000);
  });

  it("sin límite ni remainingSeconds el deadline es null", () => {
    expect(timingDeadline(buildTiming({ startedAt: iso(T0) }, null, T0))).toBeNull();
    expect(timingDeadline(buildTiming(undefined, 600, T0))).toBeNull();
    expect(timingRemainingMs(buildTiming(undefined, null, T0), T0)).toBeNull();
  });

  it("fechas inválidas se ignoran en lugar de producir NaN", () => {
    const timing = buildTiming({ startedAt: "no-es-fecha", serverNow: "tampoco" }, 600, T0);
    expect(timingDeadline(timing)).toBeNull();
    const withRemaining = buildTiming({ remainingSeconds: 10, serverNow: "tampoco" }, 600, T0);
    expect(timingDeadline(withRemaining)).toBeNull();
  });

  it("remainingMs nunca es negativo", () => {
    const state = stateWith(cleanTiming());
    expect(remainingMs(state, T0 + 10_000_000)).toBe(0);
  });

  it("deadline y remainingMs son null fuera de respondiendo/finalizandoSubtest/pausada", () => {
    for (const kind of ["validando", "bienvenida", "listaSubtests", "instrucciones", "resumen", "finalizando", "completada", "bloqueado"] as const) {
      expect(deadline(STATES[kind])).toBeNull();
      expect(remainingMs(STATES[kind], T0)).toBeNull();
    }
  });

  it("en finalizandoSubtest el tiempo sigue contando", () => {
    const state = STATES.finalizandoSubtest;
    expect(deadline(state)).toBe(T0 + 600_000);
    expect(remainingMs(state, T0 + 1_000)).toBe(599_000);
  });

  it("START_SUBTEST_OK construye el timing con el reloj del cliente y el límite del subtest", () => {
    const next = reduce(STATES.instrucciones, {
      type: "START_SUBTEST_OK",
      subtestId: 1,
      timing: { startedAt: iso(T0 - 30_000), remainingSeconds: 570, serverNow: iso(T0) },
      clientNow: T0 + 200,
    });
    const r = expectKind(next, "respondiendo");
    expect(r.timing.timeLimitSeconds).toBe(600);
    expect(r.timing.receivedAt).toBe(T0 + 200);
    expect(deadline(r)).toBe(T0 + 200 + 570_000);
  });

  it("START_SUBTEST_OK con timeLimitSeconds del endpoint pisa el del subtest", () => {
    const next = reduce(STATES.instrucciones, {
      type: "START_SUBTEST_OK",
      subtestId: 1,
      timing: { startedAt: iso(T0), serverNow: iso(T0) },
      timeLimitSeconds: 120,
      clientNow: T0,
    });
    expect(deadline(next)).toBe(T0 + 120_000);
  });

  it("startSubtestOkEvent traduce la respuesta de startSubtest", () => {
    const attempt: SubtestAttempt = {
      id: 9,
      status: "EN_PROGRESO",
      startedAt: iso(T0),
      timeLimitSeconds: 300,
      timing: { remainingSeconds: 290, serverNow: iso(T0 + 10_000), paused: false },
    };
    const event = startSubtestOkEvent(1, attempt, T0 + 10_000, 2);
    expect(event).toEqual({
      type: "START_SUBTEST_OK",
      subtestId: 1,
      timing: { startedAt: iso(T0), remainingSeconds: 290, serverNow: iso(T0 + 10_000), paused: false },
      timeLimitSeconds: 300,
      ordinal: 2,
      clientNow: T0 + 10_000,
    });
    const r = expectKind(reduce(STATES.instrucciones, event), "respondiendo");
    expect(r.ordinal).toBe(2);
    expect(deadline(r)).toBe(T0 + 10_000 + 290_000);
  });

  it("startSubtestOkEvent sin timing ni límite en la respuesta no inventa campos", () => {
    const event = startSubtestOkEvent(1, { id: 1, status: "EN_PROGRESO" }, T0);
    expect(event).toEqual({ type: "START_SUBTEST_OK", subtestId: 1, timing: {}, clientNow: T0 });
  });
});

// ---------------------------------------------------------------------------
// Pausa y reanudación
// ---------------------------------------------------------------------------

describe("pausa y reanudación (tiempo congelado)", () => {
  const pauseEvent = (clientNow: number): RunnerEvent => ({ type: "SESSION_STATUS_CHANGED", status: "PAUSADA", clientNow });
  const resumeEvent = (clientNow: number): RunnerEvent => ({ type: "SESSION_STATUS_CHANGED", status: "ABIERTA", clientNow });

  it("SESSION_STATUS_CHANGED(PAUSADA) en respondiendo congela el restante y recuerda el estado", () => {
    const state = respondiendo(2);
    const paused = expectKind(reduce(state, pauseEvent(T0 + 100_000)), "pausada");
    expect(paused.resumeTo).toBe(state);
    expect(paused.frozenRemainingMs).toBe(500_000);
    expect(currentSubtestId(paused)).toBe(1);
    expect(currentOrdinal(paused)).toBe(2);
  });

  it("mientras está pausada remainingMs no avanza y deadline es null", () => {
    const paused = reduce(respondiendo(), pauseEvent(T0 + 100_000));
    expect(remainingMs(paused, T0 + 100_000)).toBe(500_000);
    expect(remainingMs(paused, T0 + 5_000_000)).toBe(500_000);
    expect(deadline(paused)).toBeNull();
  });

  it("al reanudar vuelve al mismo estado con el tiempo rebasado (los segundos pausados no cuentan)", () => {
    const paused = reduce(respondiendo(2), pauseEvent(T0 + 100_000));
    const resumeAt = T0 + 1_000_000; // 15 min de pausa
    const resumed = expectKind(reduce(paused, resumeEvent(resumeAt)), "respondiendo");
    expect(resumed.ordinal).toBe(2);
    expect(resumed.subtestId).toBe(1);
    expect(resumed.timing.paused).toBe(false);
    expect(remainingMs(resumed, resumeAt)).toBe(500_000);
    expect(remainingMs(resumed, resumeAt + 100_000)).toBe(400_000);
    expect(deadline(resumed)).toBe(resumeAt + 500_000);
  });

  it("pausas repetidas acumulan solo el tiempo realmente corrido", () => {
    let state: RunnerState = respondiendo(1);
    state = reduce(state, pauseEvent(T0 + 60_000)); // corrieron 60 s
    state = reduce(state, resumeEvent(T0 + 600_000));
    state = reduce(state, pauseEvent(T0 + 600_000 + 40_000)); // 40 s más
    expect(remainingMs(state, T0 + 99_999_999)).toBe(500_000);
    state = reduce(state, resumeEvent(T0 + 9_000_000));
    expect(remainingMs(state, T0 + 9_000_000 + 10_000)).toBe(490_000);
  });

  it("SERVER_ERROR(SESION_PAUSADA) también pausa y congela", () => {
    const paused = expectKind(
      reduce(respondiendo(), { type: "SERVER_ERROR", code: "SESION_PAUSADA", clientNow: T0 + 20_000 }),
      "pausada",
    );
    expect(paused.frozenRemainingMs).toBe(580_000);
  });

  it("pausar durante finalizandoSubtest conserva la razón y al reanudar vuelve a finalizandoSubtest", () => {
    const state: RunnerState = { ...STATES.finalizandoSubtest, reason: "tiempo" } as RunnerState;
    const paused = reduce(state, pauseEvent(T0 + 5_000));
    const resumed = expectKind(reduce(paused, resumeEvent(T0 + 50_000)), "finalizandoSubtest");
    expect(resumed.reason).toBe("tiempo");
    expect(remainingMs(resumed, T0 + 50_000)).toBe(595_000);
  });

  it.each(["bienvenida", "listaSubtests", "instrucciones", "resumen", "finalizando"] as const)(
    "pausa y reanudación desde %s vuelven al mismo estado",
    (kind) => {
      const state = STATES[kind];
      const paused = expectKind(reduce(state, pauseEvent(T0)), "pausada");
      expect(paused.frozenRemainingMs).toBeNull();
      expect(reduce(paused, resumeEvent(T0 + 1_000))).toBe(state);
    },
  );

  it("subtest sin límite: frozenRemainingMs es null y al reanudar sigue sin deadline", () => {
    const state = respondiendo(1, buildTiming({ startedAt: iso(T0) }, null, T0));
    const paused = expectKind(reduce(state, pauseEvent(T0 + 1_000)), "pausada");
    expect(paused.frozenRemainingMs).toBeNull();
    const resumed = reduce(paused, resumeEvent(T0 + 2_000));
    expect(deadline(resumed)).toBeNull();
  });

  it("subtest con límite pero sin remainingSeconds (solo startedAt): congela con startedAt + límite", () => {
    const state = respondiendo(1, buildTiming({ startedAt: iso(T0 - 100_000), serverNow: iso(T0) }, 600, T0));
    const paused = expectKind(reduce(state, pauseEvent(T0 + 50_000)), "pausada");
    expect(paused.frozenRemainingMs).toBe(450_000);
    const resumed = reduce(paused, resumeEvent(T0 + 900_000));
    expect(remainingMs(resumed, T0 + 900_000)).toBe(450_000);
  });

  it("no se puede pausar dos veces ni reanudar sin pausa", () => {
    const paused = reduce(respondiendo(), pauseEvent(T0));
    expect(reduce(paused, pauseEvent(T0 + 1))).toBe(paused);
    expect(reduce(respondiendo(), resumeEvent(T0))).toEqual(respondiendo());
    const state = respondiendo();
    expect(reduce(state, resumeEvent(T0))).toBe(state);
  });

  it("en pausada no se navega, ni se finaliza, ni se dispara el deadline", () => {
    const paused = pausada();
    for (const event of [
      { type: "NEXT" },
      { type: "PREV" },
      { type: "GO_TO_ITEM", ordinal: 1 },
      { type: "REQUEST_FINISH_SUBTEST" },
      { type: "DEADLINE_REACHED", clientNow: T0 + 600_000 },
      { type: "FINISH_SUBTEST_OK", subtestId: 1 },
      { type: "OPEN_SUBTEST", subtestId: 1 },
    ] as const) {
      expect(reduce(paused, event)).toBe(paused);
    }
  });

  it("EVALUATION_LOADED con sesión PAUSADA y timing congelado del servidor fija el restante autoritativo", () => {
    const paused = pausada(respondiendo(), 123_000);
    const fresh = makeEvaluation({
      sessionStatus: "PAUSADA",
      pausedAt: iso(T0 + 100_000),
      subtests: [
        makeSubtest(1, 1, "EN_PROGRESO", {
          timing: { startedAt: iso(T0), remainingSeconds: 450, paused: true, serverNow: iso(T0 + 200_000) },
        }),
        makeSubtest(2, 2),
        makeSubtest(3, 3),
      ],
    });
    const next = expectKind(reduce(paused, loaded(fresh, T0 + 200_000)), "pausada");
    expect(next.frozenRemainingMs).toBe(450_000);
    expect(next.pausedAt).toBe(iso(T0 + 100_000));
    expect(remainingMs(next, T0 + 9_000_000)).toBe(450_000);
    expect(next.resumeTo.kind).toBe("respondiendo");
  });

  it("EVALUATION_LOADED con la sesión aún pausada y sin timing conserva el congelado", () => {
    const paused = pausada(respondiendo(), 123_000);
    const next = expectKind(reduce(paused, loaded(makeEvaluation({ sessionStatus: "PAUSADA" }))), "pausada");
    expect(next.frozenRemainingMs).toBe(123_000);
  });

  it("EVALUATION_LOADED con sesión PAUSADA desde respondiendo pausa con el restante del servidor", () => {
    const fresh = makeEvaluation({
      sessionStatus: "PAUSADA",
      subtests: [
        makeSubtest(1, 1, "EN_PROGRESO", {
          timing: { startedAt: iso(T0), remainingSeconds: 420, paused: true, serverNow: iso(T0 + 180_000) },
        }),
        makeSubtest(2, 2),
        makeSubtest(3, 3),
      ],
    });
    const paused = expectKind(reduce(respondiendo(), loaded(fresh, T0 + 180_000)), "pausada");
    expect(paused.frozenRemainingMs).toBe(420_000);
  });

  it("EVALUATION_LOADED con sesión ABIERTA reanuda rebasando el tiempo congelado si no hay timing nuevo", () => {
    const paused = pausada(respondiendo(), 300_000);
    const resumeAt = T0 + 5_000_000;
    const resumed = expectKind(reduce(paused, loaded(makeEvaluation(), resumeAt)), "respondiendo");
    expect(remainingMs(resumed, resumeAt)).toBe(300_000);
    expect(deadline(resumed)).toBe(resumeAt + 300_000);
    expect(resumed.ordinal).toBe(2);
  });

  it("EVALUATION_LOADED con sesión ABIERTA y timing fresco del servidor usa el del servidor", () => {
    const paused = pausada(respondiendo(), 300_000);
    const resumeAt = T0 + 5_000_000;
    const fresh = makeEvaluation({
      subtests: [
        makeSubtest(1, 1, "EN_PROGRESO", {
          timing: { startedAt: iso(T0), remainingSeconds: 280, paused: false, serverNow: iso(resumeAt) },
        }),
        makeSubtest(2, 2),
        makeSubtest(3, 3),
      ],
    });
    const resumed = expectKind(reduce(paused, loaded(fresh, resumeAt)), "respondiendo");
    expect(remainingMs(resumed, resumeAt)).toBe(280_000);
  });

  it("si el servidor cerró el subtest durante la pausa, al reanudar va a la lista", () => {
    const paused = pausada(respondiendo(), 300_000);
    const fresh = makeEvaluation({ subtests: [makeSubtest(1, 1, "COMPLETADO"), makeSubtest(2, 2), makeSubtest(3, 3)] });
    expectKind(reduce(paused, loaded(fresh)), "listaSubtests");
  });

  it("un bloqueo durante la pausa (token expirado) manda a bloqueado conservando la evaluación", () => {
    const paused = pausada();
    const next = expectKind(
      reduce(paused, { type: "SERVER_ERROR", code: "TOKEN_EXPIRADO", clientNow: T0 }),
      "bloqueado",
    );
    expect(next.reason).toBe("expirado");
    expect(next.evaluation).toBe(evaluationOf(paused));
  });

  it("sesión cerrada durante la pausa → bloqueado(sesionCerrada)", () => {
    expect(
      expectKind(reduce(pausada(), { type: "SESSION_STATUS_CHANGED", status: "CERRADA", clientNow: T0 }), "bloqueado")
        .reason,
    ).toBe("sesionCerrada");
  });

  it("TIEMPO_AGOTADO durante la pausa no se aplica", () => {
    const paused = pausada();
    expect(reduce(paused, { type: "SERVER_ERROR", code: "TIEMPO_AGOTADO", clientNow: T0 })).toBe(paused);
  });
});

// ---------------------------------------------------------------------------
// Códigos de error del runtime
// ---------------------------------------------------------------------------

describe("SERVER_ERROR: todos los códigos", () => {
  const err = (code: RuntimeErrorCode): RunnerEvent => ({ type: "SERVER_ERROR", code, clientNow: T0 });

  it("el test cubre todos los códigos de RUNTIME_ERROR_CODES", () => {
    const covered: RuntimeErrorCode[] = [
      "SESION_PAUSADA",
      "SESION_NO_ABIERTA",
      "SESION_FINALIZADA",
      "TIEMPO_AGOTADO",
      "TOKEN_EXPIRADO",
      "ASIGNACION_NO_OPERABLE",
    ];
    expect([...covered].sort()).toEqual([...RUNTIME_ERROR_CODES].sort());
  });

  it("ASIGNACION_NO_OPERABLE con delivered=true bloquea como evaluacionEntregada", () => {
    const next = expectKind(
      reduce(STATES.listaSubtests, { type: "SERVER_ERROR", code: "ASIGNACION_NO_OPERABLE", clientNow: T0, delivered: true }),
      "bloqueado",
    );
    expect(next.reason).toBe("evaluacionEntregada");
  });

  it("SESION_FINALIZADA con delivered=true bloquea como evaluacionEntregada; sin él, sesionCerrada", () => {
    const next = expectKind(
      reduce(STATES.listaSubtests, { type: "SERVER_ERROR", code: "SESION_FINALIZADA", clientNow: T0, delivered: true }),
      "bloqueado",
    );
    expect(next.reason).toBe("evaluacionEntregada");
    const plain = expectKind(reduce(STATES.listaSubtests, err("SESION_FINALIZADA")), "bloqueado");
    expect(plain.reason).toBe("sesionCerrada");
  });

  it("delivered=true no altera otros códigos de bloqueo", () => {
    const next = expectKind(
      reduce(STATES.listaSubtests, { type: "SERVER_ERROR", code: "TOKEN_EXPIRADO", clientNow: T0, delivered: true }),
      "bloqueado",
    );
    expect(next.reason).toBe("expirado");
  });

  const blockingCodes: ReadonlyArray<[RuntimeErrorCode, BlockReason]> = [
    ["SESION_NO_ABIERTA", "sesionNoAbierta"],
    ["SESION_FINALIZADA", "sesionCerrada"],
    ["TOKEN_EXPIRADO", "expirado"],
    ["ASIGNACION_NO_OPERABLE", "asignacionNoOperable"],
  ];

  describe.each(blockingCodes)("%s → bloqueado(%s)", (code, reason) => {
    it.each(NON_TERMINAL)("desde %s", (kind) => {
      const state = STATES[kind];
      const next = expectKind(reduce(state, err(code)), "bloqueado");
      expect(next.reason).toBe(reason);
      expect(next.evaluation).toBe(evaluationOf(state));
    });

    it.each(["completada", "bloqueado"] as const)("se ignora en el estado terminal %s", (kind) => {
      expect(reduce(STATES[kind], err(code))).toBe(STATES[kind]);
    });
  });

  describe("SESION_PAUSADA → pausada", () => {
    it.each(WORK_KINDS)("desde %s", (kind) => {
      const state = STATES[kind];
      const paused = expectKind(reduce(state, err("SESION_PAUSADA")), "pausada");
      expect(paused.resumeTo).toBe(state);
    });

    it.each(["validando", "pausada", "completada", "bloqueado"] as const)("es inválido desde %s", (kind) => {
      expect(reduce(STATES[kind], err("SESION_PAUSADA"))).toBe(STATES[kind]);
    });
  });

  describe("TIEMPO_AGOTADO → finalizandoSubtest(tiempo)", () => {
    it("desde respondiendo", () => {
      const state = respondiendo(3);
      const next = expectKind(reduce(state, err("TIEMPO_AGOTADO")), "finalizandoSubtest");
      expect(next.reason).toBe("tiempo");
      expect(next.subtestId).toBe(state.subtestId);
      expect(next.timing).toBe(state.timing);
    });

    it.each(ALL_KINDS.filter((k) => k !== "respondiendo"))("es inválido desde %s", (kind) => {
      expect(reduce(STATES[kind], err("TIEMPO_AGOTADO"))).toBe(STATES[kind]);
    });
  });

  it("ACCESS_REVOKED → bloqueado(accesoRevocado) desde cualquier estado no terminal", () => {
    for (const kind of NON_TERMINAL) {
      expect(expectKind(reduce(STATES[kind], { type: "ACCESS_REVOKED" }), "bloqueado").reason).toBe("accesoRevocado");
    }
  });

  it("un bloqueo antes de cargar la evaluación (validando) deja evaluation en null", () => {
    expect(expectKind(reduce(INITIAL_STATE, err("TOKEN_EXPIRADO")), "bloqueado").evaluation).toBeNull();
  });
});

describe("SESSION_STATUS_CHANGED: estados de sesión", () => {
  const change = (status: SessionStatus): RunnerEvent => ({ type: "SESSION_STATUS_CHANGED", status, clientNow: T0 });

  it.each<[SessionStatus, BlockReason]>([
    ["CERRADA", "sesionCerrada"],
    ["CANCELADA", "sesionCancelada"],
    ["PROGRAMADA", "sesionNoAbierta"],
  ])("%s → bloqueado(%s)", (status, reason) => {
    expect(expectKind(reduce(STATES.respondiendo, change(status)), "bloqueado").reason).toBe(reason);
  });

  it("ABIERTA fuera de pausa y DESCONOCIDO son no-ops inválidos", () => {
    expect(reduce(STATES.respondiendo, change("ABIERTA"))).toBe(STATES.respondiendo);
    expect(reduce(STATES.respondiendo, change("DESCONOCIDO"))).toBe(STATES.respondiendo);
  });
});

// ---------------------------------------------------------------------------
// Estados terminales, identidad de referencia y dev warning
// ---------------------------------------------------------------------------

describe("estados terminales", () => {
  it.each(["bloqueado", "completada"] as const)("%s ignora todos los eventos", (kind) => {
    const state = STATES[kind];
    for (const [, event] of MATRIX) {
      expect(reduce(state, event)).toBe(state);
    }
  });

  it("isTerminal / isResumable", () => {
    expect(ALL_KINDS.filter((k) => isTerminal(STATES[k]))).toEqual(["completada", "bloqueado"]);
    expect(ALL_KINDS.filter((k) => isResumable(STATES[k]))).toEqual(WORK_KINDS);
  });
});

describe("evento inválido: referencia idéntica y dev warning", () => {
  it("devuelve exactamente el mismo objeto y notifica a onInvalid", () => {
    const state = STATES.bienvenida;
    const event: RunnerEvent = { type: "NEXT" };
    const onInvalid = vi.fn();
    const next = reduce(state, event, { onInvalid });
    expect(Object.is(next, state)).toBe(true);
    expect(onInvalid).toHaveBeenCalledExactlyOnceWith(state, event);
  });

  it("sin onInvalid no lanza ni avisa", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(() => reduce(STATES.bienvenida, { type: "NEXT" })).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("runnerReducer avisa con console.warn en desarrollo", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const state = STATES.bienvenida;
    expect(runnerReducer(state, { type: "NEXT" })).toBe(state);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("NEXT");
    expect(String(warn.mock.calls[0]?.[0])).toContain("bienvenida");
    warn.mockRestore();
  });

  it("runnerReducer no avisa en eventos válidos", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    runnerReducer(STATES.respondiendo, { type: "NEXT" });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("devWarnInvalidEvent es un InvalidEventHandler utilizable directamente", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    devWarnInvalidEvent(STATES.listaSubtests, { type: "PREV" });
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Selectores
// ---------------------------------------------------------------------------

describe("selectores", () => {
  it("evaluationOf", () => {
    expect(evaluationOf(INITIAL_STATE)).toBeNull();
    expect(evaluationOf(STATES.listaSubtests)).toBe((STATES.listaSubtests as { evaluation: Evaluation }).evaluation);
    expect(evaluationOf(STATES.pausada)).toBe(evaluationOf((STATES.pausada as PausadaState).resumeTo));
    expect(evaluationOf({ kind: "bloqueado", reason: "expirado", evaluation: null })).toBeNull();
  });

  it("currentSubtestId / currentOrdinal", () => {
    expect(currentSubtestId(STATES.instrucciones)).toBe(1);
    expect(currentSubtestId(STATES.respondiendo)).toBe(1);
    expect(currentSubtestId(STATES.finalizandoSubtest)).toBe(1);
    expect(currentSubtestId(STATES.pausada)).toBe(1);
    expect(currentSubtestId(STATES.listaSubtests)).toBeNull();
    expect(currentOrdinal(STATES.respondiendo)).toBe(2);
    expect(currentOrdinal(STATES.pausada)).toBe(2);
    expect(currentOrdinal(STATES.instrucciones)).toBeNull();
  });
});


// ---------------------------------------------------------------------------
// F2-FIX-1 · ALTO 3: reloj monotónico (clientNow = performance.now(), nunca Date.now())
// ---------------------------------------------------------------------------

describe("F2-FIX-1 ALTO 3 · tiempo con reloj monotónico", () => {
  // `clientNow` es una lectura monotónica (p. ej. performance.now()): valores pequeños, sin relación con Date.now().
  const MONO0 = 5_000;

  it("remaining = remainingSeconds*1000 − (monotónico − T0), con cualquier escala del reloj de pared del servidor", () => {
    const timing = buildTiming({ remainingSeconds: 50, serverNow: "2026-11-25T10:00:00.000Z" }, 600, MONO0);
    expect(timingDeadline(timing)).toBe(MONO0 + 50_000);
    expect(timingRemainingMs(timing, MONO0)).toBe(50_000);
    expect(timingRemainingMs(timing, MONO0 + 20_000)).toBe(30_000);
  });

  it("DEADLINE_REACHED con tiempo restante > 0 se ignora (la máquina verifica el instante monotónico)", () => {
    const state = respondiendo(1, buildTiming({ remainingSeconds: 50, serverNow: iso(T0) }, 600, MONO0));
    const onInvalid = vi.fn();
    expect(reduce(state, { type: "DEADLINE_REACHED", clientNow: MONO0 + 10_000 }, { onInvalid })).toBe(state);
    expect(onInvalid).toHaveBeenCalledTimes(1);
  });

  it("DEADLINE_REACHED con el tiempo agotado según el reloj monotónico finaliza por tiempo", () => {
    const state = respondiendo(1, buildTiming({ remainingSeconds: 50, serverNow: iso(T0) }, 600, MONO0));
    const next = expectKind(reduce(state, { type: "DEADLINE_REACHED", clientNow: MONO0 + 50_000 }), "finalizandoSubtest");
    expect(next.reason).toBe("tiempo");
  });

  it("DEADLINE_REACHED sin referencia válida (reloj hacia atrás o sin deadline) se ignora", () => {
    const state = respondiendo(1, buildTiming({ remainingSeconds: 0, serverNow: iso(T0) }, 600, MONO0));
    expect(reduce(state, { type: "DEADLINE_REACHED", clientNow: MONO0 - 1 })).toBe(state);
    const noReference = respondiendo(1, buildTiming({ startedAt: iso(T0) }, 600, MONO0));
    expect(reduce(noReference, { type: "DEADLINE_REACHED", clientNow: MONO0 + 9_999_999 })).toBe(noReference);
  });

  it("isTimingReferenceValid exige T0 finito y un reloj que no retroceda", () => {
    const timing = buildTiming({ remainingSeconds: 10, serverNow: iso(T0) }, 600, MONO0);
    expect(isTimingReferenceValid(timing, MONO0)).toBe(true);
    expect(isTimingReferenceValid(timing, MONO0 + 1)).toBe(true);
    expect(isTimingReferenceValid(timing, MONO0 - 1)).toBe(false);
    expect(isTimingReferenceValid(timing, Number.NaN)).toBe(false);
    expect(isTimingReferenceValid({ ...timing, receivedAt: Number.NaN }, MONO0)).toBe(false);
  });

  it("un /yo posterior re-ancla la referencia: el restante vuelve a ser el que dijo el servidor", () => {
    const state = respondiendo(1, buildTiming({ remainingSeconds: 50, serverNow: iso(T0) }, 600, MONO0));
    const evaluation = makeEvaluation({
      subtests: [
        makeSubtest(1, 1, "EN_PROGRESO", { timing: { remainingSeconds: 200, serverNow: iso(T0 + 60_000), startedAt: iso(T0 - 10_000) } }),
        makeSubtest(2, 2),
        makeSubtest(3, 3),
      ],
    });
    const next = expectKind(reduce(state, loaded(evaluation, MONO0 + 40_000)), "respondiendo");
    expect(remainingMs(next, MONO0 + 40_000)).toBe(200_000);
    expect(remainingMs(next, MONO0 + 60_000)).toBe(180_000);
  });
});

// ---------------------------------------------------------------------------
// F2-FIX-1 · MEDIO 4: el servidor cerró el subtest mientras se finalizaba
// ---------------------------------------------------------------------------

describe("F2-FIX-1 MEDIO 4 · finalizandoSubtest con el subtest ya cerrado por el servidor", () => {
  const withSubtest1 = (status: AttemptStatus, others: AttemptStatus = "NO_INICIADO"): Evaluation =>
    makeEvaluation({
      subtests: [makeSubtest(1, 1, status), makeSubtest(2, 2, others), makeSubtest(3, 3, others)],
    });

  it.each<AttemptStatus>(["COMPLETADO", "ANULADO"])(
    "EVALUATION_LOADED con el subtest %s avanza a listaSubtests en vez de quedarse en finalizandoSubtest",
    (status) => {
      for (const reason of ["usuario", "tiempo"] as const) {
        const state = { ...STATES.finalizandoSubtest, reason } as RunnerState;
        const next = expectKind(reduce(state, loaded(withSubtest1(status))), "listaSubtests");
        expect(next.evaluation.subtests[0]?.status).toBe(status);
      }
    },
  );

  it("si era el último subtest abierto va a resumen", () => {
    const next = reduce(STATES.finalizandoSubtest, loaded(withSubtest1("COMPLETADO", "COMPLETADO")));
    expectKind(next, "resumen");
  });

  it("con el subtest todavía EN_PROGRESO sigue en finalizandoSubtest y refresca la evaluación", () => {
    const next = expectKind(reduce(STATES.finalizandoSubtest, loaded(withSubtest1("EN_PROGRESO"))), "finalizandoSubtest");
    expect(next.reason).toBe("usuario");
  });

  it("también avanza si la sesión está pausada cuando el servidor lo cerró", () => {
    const paused = pausada(STATES.finalizandoSubtest as ResumableState, 100_000);
    const next = reduce(paused, loaded(withSubtest1("COMPLETADO")));
    expect(["listaSubtests", "pausada"]).toContain(next.kind);
    if (next.kind === "pausada") expectKind(next.resumeTo as RunnerState, "listaSubtests");
  });
});

// ---------------------------------------------------------------------------
// F2-FIX-2 · ALTO 1: sin referencia válida del servidor no hay deadline local
// ---------------------------------------------------------------------------

describe("F2-FIX-2 ALTO 1 · deadline local solo con referencia válida", () => {
  const MONO0 = 5_000;

  it("remainingSeconds SIN serverNow no produce deadline local (ni restante)", () => {
    const timing = buildTiming({ remainingSeconds: 5 }, 600, MONO0);
    expect(timingDeadline(timing)).toBeNull();
    expect(timingRemainingMs(timing, MONO0 + 60_000)).toBeNull();
    expect(deadline(respondiendo(1, timing))).toBeNull();
    expect(remainingMs(respondiendo(1, timing), MONO0 + 60_000)).toBeNull();
  });

  it("remainingSeconds con serverNow inválido o vacío tampoco produce deadline", () => {
    expect(timingDeadline(buildTiming({ remainingSeconds: 5, serverNow: "no-es-una-fecha" }, 600, MONO0))).toBeNull();
    expect(timingDeadline(buildTiming({ remainingSeconds: 5, serverNow: "" }, 600, MONO0))).toBeNull();
  });

  it("remainingSeconds con serverNow válido pero sin referencia monotónica (receivedAt no finito) no produce deadline", () => {
    const timing = buildTiming({ remainingSeconds: 5, serverNow: iso(T0) }, 600, Number.NaN);
    expect(timingDeadline(timing)).toBeNull();
  });

  it("con serverNow válido y T0 finito el deadline sigue siendo T0 + remainingSeconds", () => {
    expect(timingDeadline(buildTiming({ remainingSeconds: 5, serverNow: iso(T0) }, 600, MONO0))).toBe(MONO0 + 5_000);
  });

  it("DEADLINE_REACHED con el tiempo 'agotado' pero sin serverNow se ignora (no hay referencia)", () => {
    const state = respondiendo(1, buildTiming({ remainingSeconds: 5 }, 600, MONO0));
    const onInvalid = vi.fn();
    expect(reduce(state, { type: "DEADLINE_REACHED", clientNow: MONO0 + 60_000 }, { onInvalid })).toBe(state);
    expect(onInvalid).toHaveBeenCalledTimes(1);
  });

  it("DEADLINE_REACHED sin clientNow (evento mal formado en tiempo de ejecución) se ignora aunque el restante sea 0", () => {
    const state = respondiendo(1, buildTiming({ remainingSeconds: 0, serverNow: iso(T0) }, 600, MONO0));
    const malformed = { type: "DEADLINE_REACHED" } as unknown as RunnerEvent;
    expect(reduce(state, malformed)).toBe(state);
  });

  it("tras pausa y reanudación con referencia previa válida el deadline sigue existiendo (rebasado al clientNow)", () => {
    const paused = reduce(respondiendo(1, buildTiming({ remainingSeconds: 50, serverNow: iso(T0) }, 600, MONO0)), {
      type: "SESSION_STATUS_CHANGED",
      status: "PAUSADA",
      clientNow: MONO0 + 10_000,
    });
    const resumed = expectKind(
      reduce(paused, { type: "SESSION_STATUS_CHANGED", status: "ABIERTA", clientNow: MONO0 + 100_000 }),
      "respondiendo",
    );
    expect(timingDeadline(resumed.timing)).toBe(MONO0 + 100_000 + 40_000);
  });
});
