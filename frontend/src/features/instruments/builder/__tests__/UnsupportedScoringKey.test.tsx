import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { validateVersionDocument } from "../../document";
import { UNSUPPORTED_SCORING_KEY_MESSAGE } from "../../document/schema";
import { createCleanDocument } from "../../document/__tests__/fixtures";
import { ProblemsPanel } from "../ProblemsPanel";
import { PublishDialog } from "../PublishDialog";

function unsupportedDoc() {
  const doc = createCleanDocument();
  const item = doc.subtests[0]!.items[0]!;
  item.responseType = "NUMERICA";
  item.options = [];
  item.answerKey = {
    id: null,
    draftId: "key-num",
    sourceId: null,
    status: "CREATED",
    ruleId: 80,
    correctOptionDraftId: null,
    correctOptionId: null,
    expectedText: null,
    expectedNumber: 42,
    numericTolerance: null,
    score: 1,
    requiresManualReview: false,
  };
  return doc;
}

describe("clave no calificable por el backend (F3-FIX-9a)", () => {
  it("deshabilita Aprobar en el diálogo y muestra el problema en el panel de problemas", () => {
    const doc = unsupportedDoc();
    const validation = validateVersionDocument(doc);
    const onConfirm = vi.fn();

    render(
      <>
        <ProblemsPanel report={validation} onSelect={vi.fn()} />
        <PublishDialog
          action="approve"
          document={doc}
          validation={validation}
          pending={false}
          onClose={vi.fn()}
          onConfirm={onConfirm}
        />
      </>,
    );

    expect(screen.getByRole("button", { name: "Aprobar" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Aprobar" }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getAllByText(new RegExp(UNSUPPORTED_SCORING_KEY_MESSAGE.slice(0, 40))).length).toBeGreaterThan(0);
    expect(screen.getByText(/Pendiente · Opciones y claves de respuesta válidas/)).toBeInTheDocument();
  });
});
