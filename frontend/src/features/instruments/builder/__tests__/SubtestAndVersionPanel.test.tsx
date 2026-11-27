import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import type { ScoringRule, ScoringStrategy } from "../../../../api/schemas/instruments";
import { nodeKeyOf, validateVersionDocument, type VersionDocument } from "../../document";
import { createCleanDocument } from "../../document/__tests__/fixtures";
import { SubtestPanel } from "../SubtestPanel";
import { VersionMetaPanel } from "../VersionMetaPanel";

const STRATEGIES: ScoringStrategy[] = [
  {
    id: 1,
    code: "CLAVE_SIMPLE",
    name: "Clave Simple",
    description: "Calificación por clave directa",
    strategyType: "CLAVE_SIMPLE",
    active: true,
    requiresManualReview: false,
    allowsBaremo: true,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: 2,
    code: "MATRIZ_DIM",
    name: "Matriz Dimensional",
    description: "Calificación por dimensiones",
    strategyType: "MATRIZ_DIMENSIONAL",
    active: true,
    requiresManualReview: false,
    allowsBaremo: true,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
];

const SCORING_RULES: ScoringRule[] = [
  {
    id: 80,
    versionId: 10,
    subtestId: 20,
    itemId: null,
    strategyId: 1,
    ruleType: "CLAVE_ITEM",
    priority: 1,
    active: true,
    status: "BORRADOR",
    parametersJson: "{}",
    observation: "Regla estándar por clave",
    createdById: "user-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    approvedById: null,
    approvedAt: null,
  },
];

describe("VersionMetaPanel", () => {
  it("renderiza encabezado, StatusBadge seguro en DESCONOCIDO y despacha UPDATE_VERSION_META", () => {
    const doc: VersionDocument = {
      ...createCleanDocument(),
      version: {
        ...createCleanDocument().version,
        status: "DESCONOCIDO",
      },
    };
    const validation = validateVersionDocument(doc);
    const onDispatch = vi.fn();

    render(
      <VersionMetaPanel
        document={doc}
        validation={validation}
        readOnly={false}
        canEdit={true}
        canConfigureScoring={true}
        strategies={STRATEGIES}
        onDispatch={onDispatch}
      />,
    );

    expect(screen.getByText("BFA-2026")).toBeInTheDocument();
    expect(screen.getByText("Batería Factorial de Aptitudes")).toBeInTheDocument();
    expect(screen.getByText("Borrador")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Número de versión/i), {
      target: { value: "2.0" },
    });
    expect(onDispatch).toHaveBeenCalledWith({
      type: "UPDATE_VERSION_META",
      patch: { number: "2.0" },
    });

    fireEvent.change(screen.getByLabelText(/Tiempo límite global/i), {
      target: { value: "" },
    });
    expect(onDispatch).toHaveBeenCalledWith({
      type: "UPDATE_VERSION_META",
      patch: { timeLimitSeconds: null },
    });

    fireEvent.change(screen.getByLabelText(/Instrucciones generales/i), {
      target: { value: "Nuevas instrucciones" },
    });
    expect(onDispatch).toHaveBeenCalledWith({
      type: "UPDATE_VERSION_META",
      patch: { instructions: "Nuevas instrucciones" },
    });

    fireEvent.change(screen.getByLabelText(/Estrategia de calificación/i), {
      target: { value: "2" },
    });
    expect(onDispatch).toHaveBeenCalledWith({
      type: "UPDATE_VERSION_META",
      patch: { strategyId: 2 },
    });

    fireEvent.click(screen.getByLabelText(/Permitir aleatorización de ítems/i));
    expect(onDispatch).toHaveBeenCalledWith({
      type: "UPDATE_VERSION_META",
      patch: { randomizeItems: false },
    });
  });

  it("bloquea selector de estrategia cuando canConfigureScoring es false sin asumir estrategias cargadas", () => {
    const doc = createCleanDocument();
    const validation = validateVersionDocument(doc);

    render(
      <VersionMetaPanel
        document={doc}
        validation={validation}
        readOnly={false}
        canEdit={true}
        canConfigureScoring={false}
        strategies={[]}
        onDispatch={vi.fn()}
      />,
    );

    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    const readonlyBox = screen.getByTestId("version-strategy-readonly");
    expect(readonlyBox).toHaveTextContent("Estrategia #1");
    expect(screen.getByText(/CALIFICACION_CONFIGURAR/)).toBeInTheDocument();
  });

  it("muestra errores inline, aria-invalid y alerta de error de carga de estrategias", () => {
    const base = createCleanDocument();
    const doc: VersionDocument = {
      ...base,
      version: {
        ...base.version,
        number: "",
        timeLimitSeconds: -5,
        strategyId: null,
        instructions: "",
      },
    };
    const validation = validateVersionDocument(doc);

    render(
      <VersionMetaPanel
        document={doc}
        validation={validation}
        readOnly={false}
        canEdit={true}
        canConfigureScoring={true}
        strategies={STRATEGIES}
        strategiesError="No se pudieron cargar las estrategias"
        onDispatch={vi.fn()}
      />,
    );

    expect(screen.getByLabelText(/Número de versión/i)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText(/Tiempo límite global/i)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText(/Estrategia de calificación/i)).toHaveAttribute(
      "aria-invalid",
      "true",
    );

    expect(screen.getByText("El número de versión es obligatorio.")).toBeInTheDocument();
    expect(
      screen.getByText("El tiempo límite de la versión debe ser mayor que 0 segundos."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Debe seleccionar una estrategia de calificación para la versión."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("La versión no tiene instrucciones generales configuradas."),
    ).toBeInTheDocument();
    expect(screen.getByText("No se pudieron cargar las estrategias")).toBeInTheDocument();
  });
});

describe("SubtestPanel", () => {
  it("edita campos del subtest, bloquea randomizeItems si la versión no lo permite y respeta canConfigureScoring", () => {
    const base = createCleanDocument();
    const doc: VersionDocument = {
      ...base,
      version: {
        ...base.version,
        randomizeItems: false,
      },
    };
    const subtest = doc.subtests[0]!;
    const validation = validateVersionDocument(doc);
    const onDispatch = vi.fn();

    render(
      <SubtestPanel
        document={doc}
        subtest={subtest}
        validation={validation}
        readOnly={false}
        canEdit={true}
        canConfigureScoring={false}
        strategies={[]}
        scoringRules={SCORING_RULES}
        onDispatch={onDispatch}
        onSelectItem={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText(/^Código/i), { target: { value: "MEM-2" } });
    expect(onDispatch).toHaveBeenCalledWith({
      type: "UPDATE_SUBTEST",
      subtestDraftId: "sub-20",
      patch: { code: "MEM-2" },
    });

    fireEvent.change(screen.getByLabelText(/Nombre del subtest/i), {
      target: { value: "Memoria Auditiva" },
    });
    expect(onDispatch).toHaveBeenCalledWith({
      type: "UPDATE_SUBTEST",
      subtestDraftId: "sub-20",
      patch: { name: "Memoria Auditiva" },
    });

    const randomizeItemsSwitch = screen.getByLabelText(/Aleatorizar ítems del subtest/i);
    expect(randomizeItemsSwitch).toBeDisabled();
    expect(randomizeItemsSwitch).toHaveAttribute("aria-checked", "false");
    expect(
      screen.getByText(/Deshabilitado porque la versión no permite aleatorizar ítems/i),
    ).toBeInTheDocument();

    expect(screen.getByTestId("subtest-strategy-readonly")).toHaveTextContent("Estrategia #1");
    expect(screen.getByText(/CALIFICACION_CONFIGURAR/)).toBeInTheDocument();
  });

  it("muestra sección colapsable avanzada cerrada por defecto y abre reglas de calificación", () => {
    const doc = createCleanDocument();
    const subtest = doc.subtests[0]!;
    const validation = validateVersionDocument(doc);

    render(
      <SubtestPanel
        document={doc}
        subtest={subtest}
        validation={validation}
        readOnly={false}
        canEdit={true}
        canConfigureScoring={true}
        strategies={STRATEGIES}
        scoringRules={SCORING_RULES}
        onDispatch={vi.fn()}
        onSelectItem={vi.fn()}
      />,
    );

    expect(screen.queryByText("Regla estándar por clave")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Modo avanzado · Reglas de calificación/i }));

    expect(screen.getByText("Regla estándar por clave")).toBeInTheDocument();
    expect(screen.getAllByText("#80")).toHaveLength(2);
  });

  it("confirma eliminación del subtest mediante ConfirmDialog y llama onDeleted", async () => {
    const doc = createCleanDocument();
    const subtest = doc.subtests[0]!;
    const validation = validateVersionDocument(doc);
    const onDispatch = vi.fn();
    const onDeleted = vi.fn();

    render(
      <SubtestPanel
        document={doc}
        subtest={subtest}
        validation={validation}
        readOnly={false}
        canEdit={true}
        canConfigureScoring={true}
        strategies={STRATEGIES}
        onDispatch={onDispatch}
        onSelectItem={vi.fn()}
        onDeleted={onDeleted}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Eliminar subtest/i }));

    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText(/Memoria Visual/)).toBeInTheDocument();

    // Cancelar no despacha
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    expect(onDispatch).not.toHaveBeenCalled();

    // Reabrir y confirmar
    fireEvent.click(screen.getByRole("button", { name: /Eliminar subtest/i }));
    const reopenedDialog = screen.getByRole("alertdialog");
    fireEvent.click(within(reopenedDialog).getByRole("button", { name: "Eliminar subtest" }));

    await waitFor(() => {
      expect(onDispatch).toHaveBeenCalledWith({
        type: "DELETE_SUBTEST",
        subtestDraftId: "sub-20",
      });
    });
    expect(onDeleted).toHaveBeenCalledTimes(1);
  });

  it("muestra errores inline del subtest y navega al ítem al hacer clic en el resumen", () => {
    const base = createCleanDocument();
    const doc: VersionDocument = {
      ...base,
      subtests: [
        {
          ...base.subtests[0]!,
          code: "",
          name: "",
          timeLimitSeconds: 0,
        },
      ],
    };
    const subtest = doc.subtests[0]!;
    const validation = validateVersionDocument(doc);
    const onSelectItem = vi.fn();

    render(
      <SubtestPanel
        document={doc}
        subtest={subtest}
        validation={validation}
        readOnly={false}
        canEdit={true}
        canConfigureScoring={true}
        strategies={STRATEGIES}
        onDispatch={vi.fn()}
        onSelectItem={onSelectItem}
      />,
    );

    expect(validation.byNodeKey[nodeKeyOf({ kind: "subtest", subtestDraftId: "sub-20" })]?.length).toBeGreaterThan(0);
    expect(screen.getByLabelText(/^Código/i)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText(/Nombre del subtest/i)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText(/Tiempo límite/i)).toHaveAttribute("aria-invalid", "true");

    expect(screen.getByText("El código de subtest es obligatorio.")).toBeInTheDocument();
    expect(screen.getByText("El nombre del subtest es obligatorio.")).toBeInTheDocument();
    expect(
      screen.getByText("El tiempo límite del subtest debe ser mayor que 0 segundos."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /IT-1/i }));
    expect(onSelectItem).toHaveBeenCalledWith("item-30");
  });
});
