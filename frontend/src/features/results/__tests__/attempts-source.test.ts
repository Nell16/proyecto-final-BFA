import { afterEach, describe, expect, it } from "vitest";
import { http } from "msw";

import { server } from "../../../test/msw/server";
import { isAccountChangedError } from "../../../store/accountScope";
import { PERMISSIONS } from "../../../store/permissions";
import { useStaffAuth } from "../../../store/staffAuth";
import { bridgeAttemptsSource } from "../attempts-source";
import { API, assignmentWire, clearStaff, fail, ok, sessionWire, setPermissions, useBaseHandlers } from "./testSupport";

afterEach(() => clearStaff());

describe("bridgeAttemptsSource", () => {
  it("isAvailable exige SESION_APLICAR o SESION_CREAR", () => {
    expect(bridgeAttemptsSource.isAvailable([PERMISSIONS.SESION_APLICAR])).toBe(true);
    expect(bridgeAttemptsSource.isAvailable([PERMISSIONS.SESION_CREAR])).toBe(true);
    expect(bridgeAttemptsSource.isAvailable([PERMISSIONS.RESULTADO_VER, PERMISSIONS.CALIFICACION_EJECUTAR])).toBe(false);
  });

  it("listSessionOptions devuelve las sesiones de la más reciente a la más antigua", async () => {
    useBaseHandlers();
    const options = await bridgeAttemptsSource.listSessionOptions();
    expect(options.map((o) => o.id)).toEqual([2, 1]);
  });

  it("de una sesión: omite asignaciones sin intento, mapea el resumen y sondea solo los COMPLETADO", async () => {
    setPermissions(["SESION_APLICAR", "RESULTADO_VER"]);
    const { calls } = useBaseHandlers();
    const page = await bridgeAttemptsSource.listAttempts({ sessionId: 1 });

    expect(page.total).toBe(3);
    expect(page.items.map((a) => a.attemptId)).toEqual([9001, 9002, 9003]);
    expect(page.items[0]).toMatchObject({
      status: "COMPLETADO",
      participant: { code: "P-1", fullName: "Ana López" },
      session: { id: 1, code: "SES-1", name: "Cohorte A" },
      version: { id: 10, testName: null, number: null },
      scored: true,
      resultId: 10001,
      pendingManualReviews: null,
    });
    expect(page.items[1]).toMatchObject({ scored: false, resultId: null });
    expect(page.items[2]).toMatchObject({ status: "EN_PROGRESO", scored: false });
    expect(calls.result.sort()).toEqual([9001, 9002]); // 9003 no está completado: no se sondea
    expect(calls.assignments).toEqual(["1"]);
  });

  it("sin RESULTADO_VER no sondea: scored queda desconocido (null)", async () => {
    setPermissions(["SESION_APLICAR", "CALIFICACION_EJECUTAR"]);
    const { calls } = useBaseHandlers();
    const page = await bridgeAttemptsSource.listAttempts({ sessionId: 1 });
    expect(page.items[0].scored).toBeNull();
    expect(page.items[1].scored).toBeNull();
    expect(calls.result).toEqual([]);
  });

  it("un fallo distinto de 404/400 al sondear deja scored en null sin romper el listado", async () => {
    setPermissions(["SESION_APLICAR", "RESULTADO_VER"]);
    useBaseHandlers();
    server.use(http.get(`${API}/attempts/9002/result`, () => fail(500, "boom")));
    const page = await bridgeAttemptsSource.listAttempts({ sessionId: 1 });
    expect(page.items.find((a) => a.attemptId === 9002)?.scored).toBeNull();
    expect(page.items.find((a) => a.attemptId === 9001)?.scored).toBe(true);
  });

  it("de todas las sesiones: junta intentos de cada sesión, filtra por estado y por participante", async () => {
    setPermissions(["SESION_APLICAR", "RESULTADO_VER"]);
    useBaseHandlers();
    const all = await bridgeAttemptsSource.listAttempts({});
    expect(all.items.map((a) => a.attemptId)).toEqual([9101, 9001, 9002, 9003]); // sesión 2 (más reciente) primero

    const completed = await bridgeAttemptsSource.listAttempts({ status: "COMPLETADO" });
    expect(completed.items.map((a) => a.attemptId)).toEqual([9101, 9001, 9002]);

    const byName = await bridgeAttemptsSource.listAttempts({ participantCode: "bruno" });
    expect(byName.items.map((a) => a.attemptId)).toEqual([9002]);
    const byCode = await bridgeAttemptsSource.listAttempts({ participantCode: "p-3" });
    expect(byCode.items.map((a) => a.attemptId)).toEqual([9003]);
  });

  it("filtro scored sondea todos y pagina después; sin filtro solo sondea la página pedida", async () => {
    setPermissions(["SESION_APLICAR", "RESULTADO_VER"]);
    const { calls } = useBaseHandlers();
    const pending = await bridgeAttemptsSource.listAttempts({ sessionId: 1, scored: false });
    expect(pending.items.map((a) => a.attemptId)).toEqual([9002, 9003]);
    const scoredOnly = await bridgeAttemptsSource.listAttempts({ sessionId: 1, scored: true });
    expect(scoredOnly.items.map((a) => a.attemptId)).toEqual([9001]);

    calls.result.length = 0;
    const second = await bridgeAttemptsSource.listAttempts({ sessionId: 1, page: 2, size: 2 });
    expect(second).toMatchObject({ total: 3, page: 2, size: 2 });
    expect(second.items.map((a) => a.attemptId)).toEqual([9003]);
    expect(calls.result).toEqual([]); // 9003 no está completado: ningún sondeo
  });

  it("sesión inexistente (404): página vacía en lugar de error", async () => {
    useBaseHandlers();
    const page = await bridgeAttemptsSource.listAttempts({ sessionId: 99 });
    expect(page).toMatchObject({ items: [], total: 0 });
  });

  it("propaga el error cuando falla la lista de sesiones o las asignaciones", async () => {
    server.use(http.get(`${API}/sesiones`, () => fail(500, "boom")));
    await expect(bridgeAttemptsSource.listAttempts({})).rejects.toMatchObject({ status: 500 });
    server.use(
      http.get(`${API}/sesiones`, () => ok([sessionWire(1)])),
      http.get(`${API}/sesiones/1/asignaciones`, () => fail(500, "boom")),
    );
    await expect(bridgeAttemptsSource.listAttempts({})).rejects.toMatchObject({ status: 500 });
  });

  describe("locateAttemptId (deep link más allá del primer corte)", () => {
    const useManyAssignments = (count: number) => {
      useBaseHandlers();
      server.use(
        http.get(`${API}/sesiones/1/asignaciones`, () =>
          ok(Array.from({ length: count }, (_, i) => assignmentWire(i + 1, 5000 + i, `P ${i + 1}`, "en-progreso"))),
        ),
      );
    };

    it("con 101 intentos y size 100, el último (índice 100) está en la página 2", async () => {
      useManyAssignments(101);
      const page = await bridgeAttemptsSource.listAttempts({ sessionId: 1, size: 100, locateAttemptId: 5100 });
      expect(page).toMatchObject({ page: 2, total: 101, located: true });
      expect(page.items.map((a) => a.attemptId)).toEqual([5100]);
    });

    it("un intento de la primera página devuelve la 1; uno inexistente devuelve la 1 con located=false", async () => {
      useManyAssignments(101);
      const first = await bridgeAttemptsSource.listAttempts({ sessionId: 1, size: 100, locateAttemptId: 5000 });
      expect(first).toMatchObject({ page: 1, located: true });
      const missing = await bridgeAttemptsSource.listAttempts({ sessionId: 1, size: 100, locateAttemptId: 99_999 });
      expect(missing).toMatchObject({ page: 1, located: false });
    });

    it("una página pedida explícitamente manda sobre locateAttemptId", async () => {
      useManyAssignments(101);
      const page = await bridgeAttemptsSource.listAttempts({ sessionId: 1, size: 100, page: 1, locateAttemptId: 5100 });
      expect(page.page).toBe(1);
      expect(page.located).toBeUndefined();
    });
  });

  it("flujo de varios pasos: si la cuenta cambia tras leer las asignaciones no se sondea con el JWT de la cuenta nueva", async () => {
    setPermissions(["SESION_APLICAR", "RESULTADO_VER"]);
    const { calls } = useBaseHandlers();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get(`${API}/sesiones/1/asignaciones`, async () => {
        await gate;
        return ok([assignmentWire(1, 9001, "Ana López")]);
      }),
    );

    const pending = bridgeAttemptsSource.listAttempts({ sessionId: 1 }).catch((e: unknown) => e);
    await new Promise((resolve) => setTimeout(resolve, 20));
    useStaffAuth.getState().setSession({
      token: "otra-cuenta",
      expiresAt: null,
      // Con los mismos permisos: sin la guarda, el sondeo SÍ saldría (con el JWT de la cuenta nueva).
      user: { id: "u-2", username: "otra", roles: [], permissions: ["SESION_APLICAR", "RESULTADO_VER"] },
    });
    release();
    const outcome = await pending;

    expect(isAccountChangedError(outcome)).toBe(true);
    expect(calls.result).toEqual([]); // ningún sondeo salió con el JWT de la cuenta nueva
  });
});
