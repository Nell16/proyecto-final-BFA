import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import {
  documentReducer,
  validateVersionDocument,
  type DocumentAction,
  type DocumentBaremo,
  type VersionDocument,
} from "../../document";
import { BaremoEditor } from "../BaremoEditor";

function createTestDocument(baremos: DocumentBaremo[] = []): VersionDocument {
  return {
    version: {
      versionId: 10,
      testId: 1,
      testCode: "BFA-2026",
      testName: "Batería Factorial",
      number: "1.0",
      status: "BORRADOR",
      strategyId: 1,
      instructions: "Lea atentamente las instrucciones.",
      timeLimitSeconds: 1800,
      randomizeSubtests: false,
      randomizeItems: false,
      metaDirty: false,
    },
    subtests: [
      {
        id: 20,
        draftId: "sub-20",
        sourceId: null,
        status: "EXISTING",
        code: "SUB-1",
        name: "Razonamiento",
        description: "",
        instructions: "Responda cada ítem.",
        order: 1,
        timeLimitSeconds: 600,
        randomizeItems: false,
        randomizeOptions: false,
        required: true,
        strategyId: 1,
        defaultRuleId: 1,
        items: [
          {
            id: 30,
            draftId: "item-30",
            sourceId: null,
            status: "EXISTING",
            code: "IT-01",
            itemType: "SOLO_TEXTO",
            responseType: "OPCION_UNICA",
            prompt: "Pregunta 1",
            instruction: "",
            order: 1,
            baseScore: 1,
            timeLimitSeconds: null,
            required: true,
            confidential: false,
            images: [],
            options: [
              {
                id: 40,
                draftId: "opt-40",
                sourceId: null,
                status: "EXISTING",
                code: "A",
                text: "Opción A",
                order: 1,
                ordinalValue: 1,
                images: [],
              },
              {
                id: 41,
                draftId: "opt-41",
                sourceId: null,
                status: "EXISTING",
                code: "B",
                text: "Opción B",
                order: 2,
                ordinalValue: 2,
                images: [],
              },
            ],
            answerKey: {
              id: 50,
              draftId: "key-50",
              sourceId: null,
              status: "EXISTING",
              ruleId: 1,
              correctOptionDraftId: "opt-40",
              correctOptionId: 40,
              expectedText: null,
              expectedNumber: null,
              numericTolerance: null,
              score: 1,
              requiresManualReview: false,
            },
          },
        ],
      },
    ],
    baremos,
    dirtyNodeIds: [],
    loadedAt: "2026-11-25T18:00:00.000Z",
  };
}

function makeLocalBaremo(overrides?: Partial<DocumentBaremo>): DocumentBaremo {
  return {
    id: null,
    draftId: "bar-local-1",
    status: "CREATED",
    dimensionId: null,
    code: "BAR-1",
    name: "Baremo General",
    description: "Norma inicial",
    normativeGroup: "General",
    ranges: [],
    ...overrides,
  };
}

function makePersistedBaremo(overrides?: Partial<DocumentBaremo>): DocumentBaremo {
  return {
    id: 501,
    draftId: "bar-persisted-1",
    status: "EXISTING",
    dimensionId: null,
    code: "BAR-PERS",
    name: "Baremo Guardado",
    description: "Publicado previamente en borrador",
    normativeGroup: "Universitarios",
    ranges: [
      {
        id: 901,
        draftId: "rng-persisted-1",
        status: "EXISTING",
        minScore: 0,
        maxScore: 10,
        percentile: 50,
        category: "Promedio",
        interpretation: "Desempeño esperado",
        recommendation: "Sin observaciones",
        order: 1,
      },
    ],
    ...overrides,
  };
}

interface HarnessProps {
  initialDoc: VersionDocument;
  initialSelectedId?: string;
  readOnly?: boolean;
  canConfigureBaremos?: boolean;
  onActionSpy?: (action: DocumentAction) => void;
}

function BaremoEditorHarness({
  initialDoc,
  initialSelectedId,
  readOnly = false,
  canConfigureBaremos = true,
  onActionSpy,
}: HarnessProps) {
  const [doc, setDoc] = useState<VersionDocument>(initialDoc);
  const [selectedId, setSelectedId] = useState<string | undefined>(initialSelectedId);

  const validation = validateVersionDocument(doc);

  const handleDispatch = (action: DocumentAction) => {
    onActionSpy?.(action);
    setDoc((prev) => documentReducer(prev, action));
  };

  return (
    <BaremoEditor
      document={doc}
      selectedBaremoDraftId={selectedId}
      validation={validation}
      readOnly={readOnly}
      canConfigureBaremos={canConfigureBaremos}
      onSelectBaremo={setSelectedId}
      onDispatch={handleDispatch}
    />
  );
}

describe("BaremoEditor & RangeTable", () => {
  it('muestra estado vacío y permite crear el primer baremo con "Crear primer baremo"', () => {
    const dispatched: DocumentAction[] = [];
    render(
      <BaremoEditorHarness
        initialDoc={createTestDocument([])}
        onActionSpy={(action) => dispatched.push(action)}
      />,
    );

    expect(screen.getByText("Sin baremos configurados")).toBeInTheDocument();
    const createBtn = screen.getByRole("button", { name: "Crear primer baremo" });
    fireEvent.click(createBtn);

    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]?.type).toBe("ADD_BAREMO");

    expect(screen.getByLabelText(/Código/i)).toHaveValue("BAR-1");
    expect(screen.getByLabelText(/Nombre/i)).toHaveValue("Baremo 1");
    expect(screen.getByRole("button", { name: "+ Añadir rango" })).toBeEnabled();
  });

  it("permite editar metadatos del baremo (UPDATE_BAREMO), muestra indicador dirty y hace fallback al primer baremo activo", () => {
    const dispatched: DocumentAction[] = [];
    const baremo = makeLocalBaremo({
      id: 700,
      status: "EXISTING",
      draftId: "bar-700",
    });

    render(
      <BaremoEditorHarness
        initialDoc={createTestDocument([baremo])}
        initialSelectedId="inexistente"
        onActionSpy={(action) => dispatched.push(action)}
      />,
    );

    // Fallback al primer baremo activo
    expect(screen.getByLabelText(/Código/i)).toHaveValue("BAR-1");

    fireEvent.change(screen.getByLabelText(/Código/i), {
      target: { value: "BAR-UAM" },
    });
    fireEvent.change(screen.getByLabelText(/Nombre/i), {
      target: { value: "Baremo UAM 2026" },
    });
    fireEvent.change(screen.getByLabelText(/Grupo normativo/i), {
      target: { value: "Psicología" },
    });
    fireEvent.change(screen.getByLabelText(/Descripción/i), {
      target: { value: "Muestra clínica de ingreso" },
    });

    expect(dispatched.map((a) => a.type)).toEqual([
      "UPDATE_BAREMO",
      "UPDATE_BAREMO",
      "UPDATE_BAREMO",
      "UPDATE_BAREMO",
    ]);
    expect(screen.getByLabelText(/Código/i)).toHaveValue("BAR-UAM");
    expect(screen.getByLabelText(/Nombre/i)).toHaveValue("Baremo UAM 2026");
    expect(screen.getByLabelText(/Grupo normativo/i)).toHaveValue("Psicología");
    expect(screen.getByLabelText(/Descripción/i)).toHaveValue("Muestra clínica de ingreso");

    // Punto ámbar dirty visible en la pestaña del baremo
    const activeTab = screen.getByRole("tab", { selected: true });
    expect(within(activeTab).getByLabelText("Cambios sin guardar")).toHaveClass(
      "bg-status-warning-solid",
    );
  });

  it("añade rangos sugiriendo 0..10 primero y max+1..min+10 después, y permite editar sus columnas (incluido percentil vacío -> null)", () => {
    const dispatched: DocumentAction[] = [];
    render(
      <BaremoEditorHarness
        initialDoc={createTestDocument([makeLocalBaremo()])}
        initialSelectedId="bar-local-1"
        onActionSpy={(action) => dispatched.push(action)}
      />,
    );

    const addRangeBtn = screen.getByRole("button", { name: "+ Añadir rango" });
    fireEvent.click(addRangeBtn);

    expect(dispatched[0]).toMatchObject({
      type: "ADD_BAREMO_RANGE",
      baremoDraftId: "bar-local-1",
      input: { minScore: 0, maxScore: 10 },
    });

    // Segundo rango debe sugerir 11..21
    fireEvent.click(addRangeBtn);
    expect(dispatched[1]).toMatchObject({
      type: "ADD_BAREMO_RANGE",
      baremoDraftId: "bar-local-1",
      input: { minScore: 11, maxScore: 21 },
    });

    // Editar campos de la primera fila
    fireEvent.change(screen.getByLabelText("Percentil rango 1"), {
      target: { value: "25" },
    });
    fireEvent.change(screen.getByLabelText("Categoría rango 1"), {
      target: { value: "Bajo" },
    });
    fireEvent.change(screen.getByLabelText("Interpretación rango 1"), {
      target: { value: "Por debajo de la media" },
    });
    fireEvent.change(screen.getByLabelText("Recomendación rango 1"), {
      target: { value: "Refuerzo" },
    });

    expect(dispatched).toContainEqual(
      expect.objectContaining({
        type: "UPDATE_BAREMO_RANGE",
        patch: { percentile: 25 },
      }),
    );

    // Vaciar percentil => null
    fireEvent.change(screen.getByLabelText("Percentil rango 1"), {
      target: { value: "" },
    });
    expect(dispatched).toContainEqual(
      expect.objectContaining({
        type: "UPDATE_BAREMO_RANGE",
        patch: { percentile: null },
      }),
    );
    expect(screen.getByLabelText("Percentil rango 1")).toHaveValue(null);
  });

  it("detecta visualmente y alerta sobre solapamiento, rango invertido y percentil fuera de [0, 100]", () => {
    const baremoWithTwoRanges = makeLocalBaremo({
      ranges: [
        {
          id: null,
          draftId: "rng-1",
          status: "CREATED",
          minScore: 0,
          maxScore: 10,
          percentile: 40,
          category: "Bajo",
          interpretation: "",
          recommendation: "",
          order: 1,
        },
        {
          id: null,
          draftId: "rng-2",
          status: "CREATED",
          minScore: 11,
          maxScore: 20,
          percentile: 75,
          category: "Alto",
          interpretation: "",
          recommendation: "",
          order: 2,
        },
      ],
    });

    render(
      <BaremoEditorHarness
        initialDoc={createTestDocument([baremoWithTwoRanges])}
        initialSelectedId="bar-local-1"
      />,
    );

    // 1) Solapamiento: cambiar minScore de fila 2 a 8 (solapa con 0..10)
    fireEvent.change(screen.getByLabelText("Puntaje mínimo rango 2"), {
      target: { value: "8" },
    });

    const rowsAfterOverlap = screen.getAllByRole("row").slice(1);
    expect(rowsAfterOverlap[0]).toHaveAttribute("data-invalid", "true");
    expect(rowsAfterOverlap[0]).toHaveClass("bg-status-danger-bg/40");
    expect(rowsAfterOverlap[1]).toHaveAttribute("data-invalid", "true");
    expect(rowsAfterOverlap[1]).toHaveClass("bg-status-danger-bg/40");
    expect(screen.getByRole("alert")).toHaveTextContent(/se solapan/i);

    // Corregir solapamiento y probar rango invertido + percentil fuera de [0, 100]
    fireEvent.change(screen.getByLabelText("Puntaje mínimo rango 2"), {
      target: { value: "25" },
    });
    fireEvent.change(screen.getByLabelText("Percentil rango 1"), {
      target: { value: "120" },
    });

    const rowsAfterInvertAndPercentile = screen.getAllByRole("row").slice(1);
    expect(rowsAfterInvertAndPercentile[0]).toHaveAttribute("data-invalid", "true");
    expect(rowsAfterInvertAndPercentile[1]).toHaveAttribute("data-invalid", "true");
    expect(screen.getByLabelText("Percentil rango 1")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(screen.getByLabelText("Puntaje mínimo rango 2")).toHaveAttribute(
      "aria-invalid",
      "true",
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/Rango invertido/i);
    expect(alert).toHaveTextContent(/Percentil fuera de \[0, 100\]/i);
  });

  it("permite eliminar baremo/rango local (con ConfirmDialog para baremo) y bloquea eliminación en baremo/rango persistido", async () => {
    const dispatched: DocumentAction[] = [];
    const localBaremo = makeLocalBaremo({
      draftId: "bar-local",
      code: "BAR-LOC",
      name: "Baremo Local",
      ranges: [
        {
          id: null,
          draftId: "rng-local",
          status: "CREATED",
          minScore: 0,
          maxScore: 10,
          percentile: 50,
          category: "Medio",
          interpretation: "",
          recommendation: "",
          order: 1,
        },
        {
          id: 902,
          draftId: "rng-persisted",
          status: "EXISTING",
          minScore: 11,
          maxScore: 20,
          percentile: 90,
          category: "Superior",
          interpretation: "",
          recommendation: "",
          order: 2,
        },
      ],
    });
    const persistedBaremo = makePersistedBaremo();

    render(
      <BaremoEditorHarness
        initialDoc={createTestDocument([localBaremo, persistedBaremo])}
        initialSelectedId="bar-local"
        onActionSpy={(action) => dispatched.push(action)}
      />,
    );

    // Rango persistido bloqueado; rango local habilitado
    expect(screen.getByRole("button", { name: "Eliminar rango Superior" })).toBeDisabled();
    expect(
      screen.getByText(/Los rangos ya guardados no pueden eliminarse/i),
    ).toBeInTheDocument();

    const deleteLocalRangeBtn = screen.getByRole("button", {
      name: "Eliminar rango Medio",
    });
    expect(deleteLocalRangeBtn).toBeEnabled();
    fireEvent.click(deleteLocalRangeBtn);

    expect(dispatched).toContainEqual({
      type: "DELETE_BAREMO_RANGE",
      baremoDraftId: "bar-local",
      rangeDraftId: "rng-local",
    });
    expect(
      screen.queryByRole("button", { name: "Eliminar rango Medio" }),
    ).not.toBeInTheDocument();

    // Cancelar ConfirmDialog mantiene el baremo local
    const deleteBaremoBtn = screen.getByRole("button", { name: "Eliminar baremo" });
    expect(deleteBaremoBtn).toBeEnabled();
    fireEvent.click(deleteBaremoBtn);

    const cancelDialog = screen.getByRole("alertdialog");
    expect(cancelDialog).toHaveTextContent("¿Eliminar baremo?");
    fireEvent.click(within(cancelDialog).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
    expect(screen.getByLabelText(/Código/i)).toHaveValue("BAR-LOC");

    // Confirmar eliminación en ConfirmDialog
    fireEvent.click(screen.getByRole("button", { name: "Eliminar baremo" }));
    const confirmDialog = screen.getByRole("alertdialog");
    fireEvent.click(
      within(confirmDialog).getByRole("button", { name: "Confirmar eliminación" }),
    );

    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });

    expect(dispatched).toContainEqual({
      type: "DELETE_BAREMO",
      baremoDraftId: "bar-local",
    });

    // Ahora queda seleccionado el baremo persistido cuyo botón eliminar está deshabilitado con explicación
    expect(screen.getByLabelText(/Código/i)).toHaveValue("BAR-PERS");
    const persistedDeleteBtn = screen.getByRole("button", { name: "Eliminar baremo" });
    expect(persistedDeleteBtn).toBeDisabled();
    expect(persistedDeleteBtn).toHaveAccessibleDescription(
      /Los baremos ya guardados no pueden eliminarse/i,
    );
  });

  it("bloquea toda edición y muestra Alert informativo cuando !canConfigureBaremos o readOnly", () => {
    const spy = vi.fn();
    const { rerender } = render(
      <BaremoEditor
        document={createTestDocument([makeLocalBaremo()])}
        selectedBaremoDraftId="bar-local-1"
        validation={validateVersionDocument(createTestDocument([makeLocalBaremo()]))}
        readOnly={false}
        canConfigureBaremos={false}
        onSelectBaremo={vi.fn()}
        onDispatch={spy}
      />,
    );

    const permissionAlert = screen.getByRole("alert");
    expect(permissionAlert).toHaveTextContent(/BAREMO_CONFIGURAR/i);

    expect(screen.getByRole("button", { name: "+ Nuevo baremo" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Eliminar baremo" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "+ Añadir rango" })).toBeDisabled();
    expect(screen.getByLabelText(/Código/i)).toBeDisabled();
    expect(screen.getByLabelText(/Nombre/i)).toBeDisabled();
    expect(screen.getByLabelText(/Grupo normativo/i)).toBeDisabled();
    expect(screen.getByLabelText(/Descripción/i)).toBeDisabled();

    // También bloqueado cuando readOnly = true aunque tenga permiso
    const docWithRange = createTestDocument([
      makeLocalBaremo({
        ranges: [
          {
            id: null,
            draftId: "rng-1",
            status: "CREATED",
            minScore: 0,
            maxScore: 10,
            percentile: 50,
            category: "Medio",
            interpretation: "",
            recommendation: "",
            order: 1,
          },
        ],
      }),
    ]);

    rerender(
      <BaremoEditor
        document={docWithRange}
        selectedBaremoDraftId="bar-local-1"
        validation={validateVersionDocument(docWithRange)}
        readOnly={true}
        canConfigureBaremos={true}
        onSelectBaremo={vi.fn()}
        onDispatch={spy}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(/solo lectura/i);
    expect(screen.getByRole("button", { name: "+ Nuevo baremo" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "+ Añadir rango" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Eliminar rango Medio" })).toBeDisabled();
    expect(screen.getByLabelText("Categoría rango 1")).toBeDisabled();
    expect(spy).not.toHaveBeenCalled();
  });
});
