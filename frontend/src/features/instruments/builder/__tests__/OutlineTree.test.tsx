import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import {
  documentReducer,
  nodeKeyOf,
  validateVersionDocument,
  type DocumentNodeRef,
  type VersionDocument,
} from "../../document";
import { createCleanDocument } from "../../document/__tests__/fixtures";
import { OutlineTree } from "../OutlineTree";

function createTwoSubtestsTwoItemsDocument(): VersionDocument {
  const base = createCleanDocument();
  const firstSubtest = base.subtests[0]!;
  const firstItem = firstSubtest.items[0]!;

  return {
    ...base,
    subtests: [
      {
        ...firstSubtest,
        items: [
          firstItem,
          {
            ...firstItem,
            id: 31,
            draftId: "item-31",
            code: "IT-2",
            prompt: "Segundo ítem",
            order: 2,
          },
        ],
      },
      {
        ...firstSubtest,
        id: 21,
        draftId: "sub-21",
        code: "ESP",
        name: "Razonamiento Espacial",
        order: 2,
        items: [
          {
            ...firstItem,
            id: 32,
            draftId: "item-32",
            code: "IT-3",
            prompt: "Ítem espacial",
            order: 1,
          },
        ],
      },
    ],
  };
}

describe("OutlineTree", () => {
  it("permite seleccionar nodos de versión, subtest, ítem, baremos y publicación", () => {
    const doc = createTwoSubtestsTwoItemsDocument();
    const validation = validateVersionDocument(doc);
    const onSelectNode = vi.fn();

    render(
      <OutlineTree
        document={doc}
        selectedNode={{ kind: "version" }}
        validation={validation}
        readOnly={false}
        canEdit={true}
        canConfigureBaremos={true}
        onSelectNode={onSelectNode}
        onDispatch={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Datos de versión/i }));
    expect(onSelectNode).toHaveBeenLastCalledWith({ kind: "version" });

    fireEvent.click(screen.getByRole("button", { name: /1\.\s*Memoria Visual/i }));
    expect(onSelectNode).toHaveBeenLastCalledWith({
      kind: "subtest",
      subtestDraftId: "sub-20",
    });

    fireEvent.click(screen.getByRole("button", { name: /IT-2/i }));
    expect(onSelectNode).toHaveBeenLastCalledWith({
      kind: "item",
      subtestDraftId: "sub-20",
      itemDraftId: "item-31",
    });

    fireEvent.click(screen.getByRole("button", { name: /Baremos/i }));
    expect(onSelectNode).toHaveBeenLastCalledWith({ kind: "baremos" });

    fireEvent.click(screen.getByRole("button", { name: /Revisión y publicación/i }));
    expect(onSelectNode).toHaveBeenLastCalledWith({ kind: "publish" });
  });

  it("muestra dirty dots cuando hay cambios pendientes en versión, subtest, ítem o baremos", () => {
    const base = createCleanDocument();
    let doc = documentReducer(base, {
      type: "UPDATE_VERSION_META",
      patch: { instructions: "Instrucción modificada" },
    });
    doc = documentReducer(doc, {
      type: "UPDATE_SUBTEST",
      subtestDraftId: "sub-20",
      patch: { name: "Memoria Visual Editada" },
    });
    doc = documentReducer(doc, {
      type: "UPDATE_ITEM",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      patch: { prompt: "Enunciado editado" },
    });
    doc = documentReducer(doc, {
      type: "UPDATE_BAREMO",
      baremoDraftId: "bar-90",
      patch: { name: "Baremo Editado" },
    });

    const validation = validateVersionDocument(doc);

    render(
      <OutlineTree
        document={doc}
        selectedNode={{ kind: "version" }}
        validation={validation}
        readOnly={false}
        canEdit={true}
        canConfigureBaremos={true}
        onSelectNode={vi.fn()}
        onDispatch={vi.fn()}
      />,
    );

    const dirtyIndicators = screen.getAllByRole("img", { name: "Cambios sin guardar" });
    expect(dirtyIndicators).toHaveLength(4);
  });

  it("muestra iconos ok, warning y error y propaga errores de ítems a subtest colapsado", () => {
    const doc = createTwoSubtestsTwoItemsDocument();
    // Dejar un warning en versión (sin instrucciones) y error en item-30 (sin opción correcta)
    const modified: VersionDocument = {
      ...doc,
      version: {
        ...doc.version,
        instructions: "",
      },
      subtests: doc.subtests.map((sub) =>
        sub.draftId === "sub-20"
          ? {
              ...sub,
              items: sub.items.map((item) =>
                item.draftId === "item-30"
                  ? {
                      ...item,
                      answerKey: null,
                    }
                  : item,
              ),
            }
          : sub,
      ),
    };

    const validation = validateVersionDocument(modified);

    render(
      <OutlineTree
        document={modified}
        selectedNode={{ kind: "version" }}
        validation={validation}
        readOnly={false}
        canEdit={true}
        canConfigureBaremos={true}
        onSelectNode={vi.fn()}
        onDispatch={vi.fn()}
      />,
    );

    // Versión tiene warning
    const versionRow = screen.getByRole("button", { name: /Datos de versión/i }).parentElement!;
    expect(within(versionRow).getByRole("img", { name: "Con advertencias" })).toBeInTheDocument();

    // Subtest sub-21 sin errores propios ni en sus ítems -> ok
    const sub21Container = screen.getByTestId("outline-subtest-sub-21");
    expect(within(sub21Container).getAllByRole("img", { name: "Válido" }).length).toBeGreaterThanOrEqual(1);

    // Colapsar subtest sub-20: los ítems desaparecen pero el subtest mantiene icono de error
    fireEvent.click(screen.getByRole("button", { name: /Colapsar subtest Memoria Visual/i }));
    expect(screen.queryByTestId("outline-item-item-30")).not.toBeInTheDocument();

    const sub20Container = screen.getByTestId("outline-subtest-sub-20");
    expect(within(sub20Container).getByRole("img", { name: "Con errores" })).toBeInTheDocument();
  });

  it("permite agregar subtest y agregar ítem desde plantilla BFA", async () => {
    const doc = createCleanDocument();
    const validation = validateVersionDocument(doc);
    const onDispatch = vi.fn();
    const onSelectNode = vi.fn();

    render(
      <OutlineTree
        document={doc}
        selectedNode={{ kind: "version" }}
        validation={validation}
        readOnly={false}
        canEdit={true}
        canConfigureBaremos={true}
        onSelectNode={onSelectNode}
        onDispatch={onDispatch}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /\+ Nuevo subtest/i }));
    expect(onDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "ADD_SUBTEST",
        input: expect.objectContaining({ draftId: expect.stringMatching(/^sub-/) }),
      }),
    );
    const addSubtestAction = onDispatch.mock.calls[0]![0] as { input: { draftId: string } };
    expect(onSelectNode).toHaveBeenCalledWith({
      kind: "subtest",
      subtestDraftId: addSubtestAction.input.draftId,
    });

    // Abrir DropdownMenu de "+ Nuevo ítem" con pointerDown (Radix trigger)
    const addItemTrigger = screen.getByRole("button", { name: /\+ Nuevo ítem/i });
    fireEvent.pointerDown(addItemTrigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
    fireEvent.click(addItemTrigger);

    const bfaOption = await waitFor(() =>
      screen.getByRole("menuitem", { name: /BFA · Comparación de imágenes/i }),
    );
    fireEvent.click(bfaOption);

    expect(onDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "ADD_ITEM",
        subtestDraftId: "sub-20",
        templateId: "bfa_comparacion_imagenes",
        input: expect.objectContaining({ draftId: expect.stringMatching(/^item-/) }),
      }),
    );

    const addItemCall = onDispatch.mock.calls.find((c) => c[0].type === "ADD_ITEM")![0] as {
      input: { draftId: string };
    };
    expect(onSelectNode).toHaveBeenCalledWith({
      kind: "item",
      subtestDraftId: "sub-20",
      itemDraftId: addItemCall.input.draftId,
    });
  });

  it("reordena subtests e ítems mediante los botones accesibles MOVE_SUBTEST y MOVE_ITEM", () => {
    const doc = createTwoSubtestsTwoItemsDocument();
    const validation = validateVersionDocument(doc);
    const onDispatch = vi.fn();

    render(
      <OutlineTree
        document={doc}
        selectedNode={{ kind: "subtest", subtestDraftId: "sub-20" }}
        validation={validation}
        readOnly={false}
        canEdit={true}
        canConfigureBaremos={true}
        onSelectNode={vi.fn()}
        onDispatch={onDispatch}
      />,
    );

    const moveSubUpButtons = screen.getAllByRole("button", { name: "Mover subtest arriba" });
    const moveSubDownButtons = screen.getAllByRole("button", { name: "Mover subtest abajo" });
    expect(moveSubUpButtons[0]).toBeDisabled();
    expect(moveSubDownButtons[1]).toBeDisabled();

    fireEvent.click(moveSubDownButtons[0]!);
    expect(onDispatch).toHaveBeenCalledWith({
      type: "MOVE_SUBTEST",
      subtestDraftId: "sub-20",
      toIndex: 1,
    });

    fireEvent.click(moveSubUpButtons[1]!);
    expect(onDispatch).toHaveBeenCalledWith({
      type: "MOVE_SUBTEST",
      subtestDraftId: "sub-21",
      toIndex: 0,
    });

    const sub20Container = screen.getByTestId("outline-subtest-sub-20");
    const moveItemUpButtons = within(sub20Container).getAllByRole("button", {
      name: "Mover ítem arriba",
    });
    const moveItemDownButtons = within(sub20Container).getAllByRole("button", {
      name: "Mover ítem abajo",
    });

    expect(moveItemUpButtons[0]).toBeDisabled();
    expect(moveItemDownButtons[1]).toBeDisabled();

    fireEvent.click(moveItemDownButtons[0]!);
    expect(onDispatch).toHaveBeenCalledWith({
      type: "MOVE_ITEM",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      toIndex: 1,
    });

    fireEvent.click(moveItemUpButtons[1]!);
    expect(onDispatch).toHaveBeenCalledWith({
      type: "MOVE_ITEM",
      subtestDraftId: "sub-20",
      itemDraftId: "item-31",
      toIndex: 0,
    });
  });

  it("deshabilita altas, drag-and-drop y reordenamiento en modo readOnly", () => {
    const doc = createTwoSubtestsTwoItemsDocument();
    const validation = validateVersionDocument(doc);
    const onOpenReuseSubtest = vi.fn();

    render(
      <OutlineTree
        document={doc}
        selectedNode={{ kind: "version" }}
        validation={validation}
        readOnly={true}
        canEdit={true}
        canConfigureBaremos={false}
        onSelectNode={vi.fn()}
        onDispatch={vi.fn()}
        onOpenReuseSubtest={onOpenReuseSubtest}
      />,
    );

    expect(screen.getByRole("button", { name: /\+ Nuevo subtest/i })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /\+ Reutilizar/i })).not.toBeInTheDocument();

    for (const btn of screen.getAllByRole("button", { name: /\+ Nuevo ítem/i })) {
      expect(btn).toBeDisabled();
    }
    for (const btn of screen.getAllByRole("button", { name: "Mover subtest arriba" })) {
      expect(btn).toBeDisabled();
    }
    for (const btn of screen.getAllByRole("button", { name: "Mover ítem abajo" })) {
      expect(btn).toBeDisabled();
    }

    const itemRow = screen.getByTestId("outline-item-item-30");
    expect(itemRow).toHaveAttribute("draggable", "false");

    // Baremos sigue visible con indicador de solo lectura cuando !canConfigureBaremos
    expect(screen.getByRole("img", { name: "Solo lectura para baremos" })).toBeInTheDocument();
  });

  it("muestra progreso de checklist en Revisión y publicación y agrega errores baremo:* en Baremos", () => {
    const doc = createCleanDocument();
    const baseValidation = validateVersionDocument(doc);
    const validation = {
      ...baseValidation,
      byNodeKey: {
        ...baseValidation.byNodeKey,
        [nodeKeyOf({ kind: "baremos", baremoDraftId: "bar-90" })]: [
          {
            id: "err-baremo",
            severity: "error" as const,
            code: "BAREMO_RANGES_OVERLAP",
            message: "Rangos solapados",
            node: { kind: "baremos" as const, baremoDraftId: "bar-90" },
            nodeKey: "baremo:bar-90",
          },
        ],
      },
    };

    render(
      <OutlineTree
        document={doc}
        selectedNode={{ kind: "publish" }}
        validation={validation}
        readOnly={false}
        canEdit={true}
        canConfigureBaremos={true}
        onSelectNode={vi.fn()}
        onDispatch={vi.fn()}
      />,
    );

    const baremosRow = screen.getByRole("button", { name: /Baremos/i }).parentElement!;
    expect(within(baremosRow).getByRole("img", { name: "Con errores" })).toBeInTheDocument();

    const passed = validation.checklist.filter((c) => c.passed).length;
    const total = validation.checklist.length;
    expect(
      screen.getByRole("button", { name: new RegExp(`Revisión y publicación.*${passed}/${total}`) }),
    ).toBeInTheDocument();
  });
});

export type { DocumentNodeRef };
