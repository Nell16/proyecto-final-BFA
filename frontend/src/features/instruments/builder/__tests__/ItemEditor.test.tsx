import { useState, type ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { useStaffAuth } from "../../../../store/staffAuth";
import { server } from "../../../../test/msw/server";
import {
  createDocumentReducer,
  validateVersionDocument,
  type DocumentAction,
  type DocumentItem,
  type DocumentSubtest,
  type VersionDocument,
} from "../../document";
import { createCleanDocument, makeDeterministicDraftIdFactory } from "../../document/__tests__/fixtures";
import { MAX_IMAGE_FILE_SIZE_BYTES } from "../ImageField";
import { ItemEditor, type ItemEditorProps } from "../ItemEditor";

const API = "http://localhost:8080";

interface HarnessOptions {
  doc?: VersionDocument;
  readOnly?: boolean;
  canEdit?: boolean;
  canConfigureScoring?: boolean;
  onDispatchSpy?: (action: DocumentAction) => void;
  onRegisterPendingFile?: ItemEditorProps["onRegisterPendingFile"];
  onRemovePendingFile?: ItemEditorProps["onRemovePendingFile"];
  onDuplicated?: () => void;
  onDeleted?: () => void;
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 5 * 60_000,
      },
    },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, Wrapper };
}

function renderStatefulItemEditor(options: HarnessOptions = {}) {
  const initialDoc = options.doc ?? createCleanDocument();
  const reducer = createDocumentReducer(makeDeterministicDraftIdFactory(100));
  const dispatched: DocumentAction[] = [];

  let nextPendingSeq = 1;
  const registerPendingFile =
    options.onRegisterPendingFile ??
    vi.fn((file: File) => {
      const id = `pending-${nextPendingSeq++}`;
      return {
        pendingFileId: id,
        previewUrl: `blob:local-${id}`,
        fileName: file.name,
      };
    });
  const removePendingFile = options.onRemovePendingFile ?? vi.fn();

  function Harness() {
    const [doc, setDoc] = useState<VersionDocument>(initialDoc);
    const subtest: DocumentSubtest = doc.subtests[0]!;
    const item: DocumentItem = subtest.items[0]!;
    const validation = validateVersionDocument(doc);

    const handleDispatch = (action: DocumentAction) => {
      dispatched.push(action);
      options.onDispatchSpy?.(action);
      setDoc((prev) => reducer(prev, action));
    };

    return (
      <ItemEditor
        subtest={subtest}
        item={item}
        validation={validation}
        readOnly={options.readOnly ?? false}
        canEdit={options.canEdit ?? true}
        canConfigureScoring={options.canConfigureScoring ?? true}
        onDispatch={handleDispatch}
        onRegisterPendingFile={registerPendingFile}
        onRemovePendingFile={removePendingFile}
        onDuplicated={options.onDuplicated}
        onDeleted={options.onDeleted}
      />
    );
  }

  const { Wrapper } = createWrapper();
  const rendered = render(<Harness />, { wrapper: Wrapper });

  return {
    ...rendered,
    dispatched,
    registerPendingFile,
    removePendingFile,
  };
}

function createDataTransferMock() {
  const store = new Map<string, string>();
  return {
    effectAllowed: "move",
    dropEffect: "move",
    setData: (format: string, value: string) => {
      store.set(format, value);
    },
    getData: (format: string) => store.get(format) ?? "",
  };
}

describe("ItemEditor y subcomponentes de edición (B-03b)", () => {
  beforeAll(() => {
    if (!Element.prototype.hasPointerCapture) {
      Element.prototype.hasPointerCapture = () => false;
    }
    if (!Element.prototype.scrollIntoView) {
      Element.prototype.scrollIntoView = () => {};
    }
  });

  beforeEach(() => {
    useStaffAuth.getState().setSession({
      token: "staff-jwt",
      expiresAt: null,
      user: {
        id: "u1",
        username: "psicologo",
        roles: ["PSICOLOGO"],
        permissions: ["TEST_CREAR", "CALIFICACION_CONFIGURAR"],
      },
    });

    server.use(
      http.get(`${API}/items/images/resources/:resourceId`, () =>
        HttpResponse.arrayBuffer(new Uint8Array([1, 2, 3, 4]).buffer, {
          headers: { "Content-Type": "image/png" },
        }),
      ),
    );

    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:mock-staff-image");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useStaffAuth.getState().clear();
  });

  it("edita campos del ítem (UPDATE_ITEM) y permite duplicar (DUPLICATE_ITEM)", () => {
    const onDuplicated = vi.fn();
    const { dispatched } = renderStatefulItemEditor({ onDuplicated });

    expect(screen.getByRole("heading", { name: "Memoria Visual › IT-1" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Código del ítem/i), { target: { value: "IT-101" } });
    fireEvent.change(screen.getByLabelText("Enunciado"), {
      target: { value: "Nuevo enunciado del ítem" },
    });
    fireEvent.change(screen.getByLabelText("Instrucción"), {
      target: { value: "Elija la mejor alternativa" },
    });
    fireEvent.change(screen.getByLabelText("Puntaje base"), { target: { value: "2.5" } });
    fireEvent.change(screen.getByLabelText("Tiempo límite (segundos)"), {
      target: { value: "45" },
    });
    fireEvent.change(screen.getByLabelText("Tiempo límite (segundos)"), {
      target: { value: "" },
    });

    fireEvent.click(screen.getByLabelText("Ítem obligatorio"));
    fireEvent.click(screen.getByLabelText("Confidencial"));
    fireEvent.click(screen.getByRole("button", { name: "Duplicar" }));

    expect(dispatched).toContainEqual({
      type: "UPDATE_ITEM",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      patch: { code: "IT-101" },
    });
    expect(dispatched).toContainEqual({
      type: "UPDATE_ITEM",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      patch: { prompt: "Nuevo enunciado del ítem" },
    });
    expect(dispatched).toContainEqual({
      type: "UPDATE_ITEM",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      patch: { instruction: "Elija la mejor alternativa" },
    });
    expect(dispatched).toContainEqual({
      type: "UPDATE_ITEM",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      patch: { baseScore: 2.5 },
    });
    expect(dispatched).toContainEqual({
      type: "UPDATE_ITEM",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      patch: { timeLimitSeconds: 45 },
    });
    expect(dispatched).toContainEqual({
      type: "UPDATE_ITEM",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      patch: { timeLimitSeconds: null },
    });
    expect(dispatched).toContainEqual({
      type: "UPDATE_ITEM",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      patch: { required: false },
    });
    expect(dispatched).toContainEqual({
      type: "UPDATE_ITEM",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      patch: { confidential: false },
    });
    expect(dispatched).toContainEqual({
      type: "DUPLICATE_ITEM",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
    });
    expect(onDuplicated).toHaveBeenCalledTimes(1);
  });

  it("marca opción correcta (SET_CORRECT_OPTION), añade, reordena y elimina opciones limpiando pendingFileId", () => {
    const { dispatched, removePendingFile } = renderStatefulItemEditor();

    const radioB = screen.getByRole("radio", { name: "Marcar opción B como correcta" });
    expect(radioB).toHaveAttribute("aria-checked", "false");
    fireEvent.click(radioB);

    expect(dispatched).toContainEqual({
      type: "SET_CORRECT_OPTION",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      optionDraftId: "opt-41",
    });
    expect(screen.getByRole("radio", { name: "Marcar opción B como correcta" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByText("Correcta")).toBeInTheDocument();

    // Añadir tercera opción
    fireEvent.click(screen.getByRole("button", { name: "+ Añadir opción" }));
    expect(dispatched).toContainEqual({
      type: "ADD_OPTION",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
    });

    const optionRowsBeforeMove = document.querySelectorAll('[data-slot="option-row"]');
    expect(optionRowsBeforeMove).toHaveLength(3);

    // Subir segunda opción (B) al índice 0 mediante botón accesible
    const secondRow = optionRowsBeforeMove[1] as HTMLElement;
    fireEvent.click(within(secondRow).getByRole("button", { name: "Subir opción" }));
    expect(dispatched).toContainEqual({
      type: "MOVE_OPTION",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      optionDraftId: "opt-41",
      toIndex: 0,
    });

    // Reordenamiento por HTML5 Drag & Drop de fila 0 hacia fila 2
    const optionRowsAfterUp = document.querySelectorAll('[data-slot="option-row"]');
    const dragTransfer = createDataTransferMock();
    fireEvent.dragStart(optionRowsAfterUp[0]!, { dataTransfer: dragTransfer });
    fireEvent.dragOver(optionRowsAfterUp[2]!, { dataTransfer: dragTransfer });
    fireEvent.drop(optionRowsAfterUp[2]!, { dataTransfer: dragTransfer });
    expect(dispatched).toContainEqual({
      type: "MOVE_OPTION",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      optionDraftId: "opt-41",
      toIndex: 2,
    });

    // Adjuntar imagen pendiente a la tercera opción y luego eliminar esa opción
    const rowsBeforeDelete = document.querySelectorAll('[data-slot="option-row"]');
    const targetRow = rowsBeforeDelete[2] as HTMLElement;
    const optionFileInput = within(targetRow).getByLabelText("Seleccionar archivo de imagen");
    const optFile = new File(["opt-img"], "opcion.png", { type: "image/png" });
    fireEvent.change(optionFileInput, { target: { files: [optFile] } });

    expect(dispatched.some((a) => a.type === "ATTACH_OPTION_IMAGE")).toBe(true);

    fireEvent.click(within(targetRow).getByRole("button", { name: "Eliminar opción" }));
    expect(removePendingFile).toHaveBeenCalledWith("pending-1");
    expect(dispatched).toContainEqual({
      type: "DELETE_OPTION",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      optionDraftId: "opt-41",
    });
  });

  it("soporta ítem NUMERICA (expectedNumber + numericTolerance) y oculta OptionList", () => {
    const baseDoc = createCleanDocument();
    const numericItem: DocumentItem = {
      ...baseDoc.subtests[0]!.items[0]!,
      itemType: "SOLO_TEXTO",
      responseType: "NUMERICA",
      images: [],
      options: [],
      answerKey: {
        id: null,
        draftId: "key-num",
        sourceId: null,
        status: "CREATED",
        ruleId: 80,
        correctOptionDraftId: null,
        correctOptionId: null,
        expectedText: null,
        expectedNumber: 10,
        numericTolerance: 0.5,
        score: 2,
        requiresManualReview: false,
      },
    };
    const doc: VersionDocument = {
      ...baseDoc,
      subtests: [{ ...baseDoc.subtests[0]!, items: [numericItem] }],
    };

    const { dispatched } = renderStatefulItemEditor({ doc });

    expect(screen.queryByRole("heading", { name: "Opciones de respuesta" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Valor numérico esperado"), {
      target: { value: "42.5" },
    });
    fireEvent.change(screen.getByLabelText("Tolerancia numérica"), {
      target: { value: "1.25" },
    });

    expect(dispatched).toContainEqual({
      type: "UPDATE_ANSWER_KEY",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      patch: { expectedNumber: 42.5 },
    });
    expect(dispatched).toContainEqual({
      type: "UPDATE_ANSWER_KEY",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      patch: { numericTolerance: 1.25 },
    });
  });

  it("soporta ítem TEXTO_ABIERTO (requiresManualReview + expectedText)", () => {
    const baseDoc = createCleanDocument();
    const openItem: DocumentItem = {
      ...baseDoc.subtests[0]!.items[0]!,
      itemType: "RAZONAMIENTO_VERBAL",
      responseType: "TEXTO_ABIERTO",
      images: [],
      options: [],
      answerKey: null,
    };
    const doc: VersionDocument = {
      ...baseDoc,
      subtests: [{ ...baseDoc.subtests[0]!, items: [openItem] }],
    };

    const { dispatched } = renderStatefulItemEditor({ doc });

    expect(screen.queryByRole("heading", { name: "Opciones de respuesta" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Requiere revisión manual"));
    fireEvent.change(screen.getByLabelText("Rúbrica / texto esperado de referencia"), {
      target: { value: "Debe mencionar causalidad directa." },
    });

    expect(dispatched).toContainEqual({
      type: "UPDATE_ANSWER_KEY",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      patch: { requiresManualReview: true },
    });
    expect(dispatched).toContainEqual({
      type: "UPDATE_ANSWER_KEY",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      patch: { expectedText: "Debe mencionar causalidad directa." },
    });
  });

  it("adjunta y elimina imagen de estímulo, y rechaza inline archivos > 5 MB", () => {
    const baseDoc = createCleanDocument();
    const itemWithoutImages: DocumentItem = {
      ...baseDoc.subtests[0]!.items[0]!,
      images: [],
    };
    const doc: VersionDocument = {
      ...baseDoc,
      subtests: [{ ...baseDoc.subtests[0]!, items: [itemWithoutImages] }],
    };

    const { dispatched, registerPendingFile, removePendingFile } = renderStatefulItemEditor({
      doc,
    });

    const stimulusSection = screen
      .getByRole("heading", { name: "Imágenes de estímulo" })
      .closest("section")!;
    const fileInput = within(stimulusSection).getByLabelText("Seleccionar archivo de imagen");

    // Archivo mayor a 5 MB -> error inline sin adjuntar
    const oversizedFile = new File(["big"], "gigante.png", { type: "image/png" });
    Object.defineProperty(oversizedFile, "size", { value: MAX_IMAGE_FILE_SIZE_BYTES + 1 });
    fireEvent.change(fileInput, { target: { files: [oversizedFile] } });

    expect(
      within(stimulusSection).getByText("La imagen supera el tamaño máximo permitido de 5 MB."),
    ).toBeInTheDocument();
    expect(registerPendingFile).not.toHaveBeenCalled();

    // Archivo válido -> adjunta imagen y limpia error
    const validFile = new File(["ok"], "lamina.png", { type: "image/png" });
    fireEvent.change(fileInput, { target: { files: [validFile] } });

    expect(registerPendingFile).toHaveBeenCalledWith(validFile);
    expect(
      within(stimulusSection).queryByText("La imagen supera el tamaño máximo permitido de 5 MB."),
    ).not.toBeInTheDocument();
    expect(dispatched).toContainEqual({
      type: "ATTACH_ITEM_IMAGE",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      image: {
        pendingFileId: "pending-1",
        previewUrl: "blob:local-pending-1",
        fileName: "lamina.png",
        altText: "",
      },
    });

    // Eliminar imagen adjunta llama a onRemovePendingFile y DELETE_ITEM_IMAGE
    fireEvent.click(within(stimulusSection).getByRole("button", { name: "Eliminar imagen" }));
    expect(removePendingFile).toHaveBeenCalledWith("pending-1");
    expect(dispatched).toContainEqual({
      type: "DELETE_ITEM_IMAGE",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      imageDraftId: "img-100",
    });
  });

  it("muestra aviso warning en imagen restaurada de autosave sin previewUrl", () => {
    const baseDoc = createCleanDocument();
    const restoredItem: DocumentItem = {
      ...baseDoc.subtests[0]!.items[0]!,
      images: [
        {
          id: null,
          draftId: "img-restored-1",
          sourceId: null,
          resourceId: null,
          pendingFileId: "file-lost-1",
          previewUrl: null,
          status: "CREATED",
          order: 1,
          altText: "Lámina pendiente",
          role: "ESTIMULO",
          fileName: "pendiente.png",
        },
      ],
    };
    const doc: VersionDocument = {
      ...baseDoc,
      subtests: [{ ...baseDoc.subtests[0]!, items: [restoredItem] }],
    };

    renderStatefulItemEditor({ doc });

    expect(
      screen.getByText(/Esta imagen pendiente no conserva su archivo local tras recargar el borrador/i),
    ).toBeInTheDocument();
  });

  it("deshabilita edición de clave y muestra aviso cuando !canConfigureScoring y defaultRuleId es null", () => {
    const baseDoc = createCleanDocument();
    const doc: VersionDocument = {
      ...baseDoc,
      subtests: [
        {
          ...baseDoc.subtests[0]!,
          defaultRuleId: null,
        },
      ],
    };

    renderStatefulItemEditor({ doc, canConfigureScoring: false });

    expect(
      screen.getByText(/Marcar la clave en un subtest sin regla previa requiere el permiso/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Este subtest no tiene una regla de calificación asignada/i),
    ).toBeInTheDocument();

    expect(screen.getByRole("radio", { name: "Marcar opción A como correcta" })).toBeDisabled();
    expect(screen.getByLabelText("Puntaje de clave")).toBeDisabled();
    expect(screen.getByLabelText("Requiere revisión manual")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Quitar clave" })).toBeDisabled();
  });

  it("deshabilita Quitar clave para clave persistida (id !== null) y muestra nota explicativa", () => {
    renderStatefulItemEditor();

    expect(screen.getByRole("button", { name: "Quitar clave" })).toBeDisabled();
    expect(
      screen.getByText(/Esta clave ya está guardada en el servidor/i),
    ).toBeInTheDocument();
  });

  it("confirma eliminación del ítem con ConfirmDialog, limpia pendingFiles y llama onDeleted", async () => {
    const baseDoc = createCleanDocument();
    const itemWithPending: DocumentItem = {
      ...baseDoc.subtests[0]!.items[0]!,
      images: [
        {
          id: null,
          draftId: "img-item-pending",
          sourceId: null,
          resourceId: null,
          pendingFileId: "file-item-1",
          previewUrl: "blob:item-1",
          status: "CREATED",
          order: 1,
          altText: "Estímulo",
          role: "ENUNCIADO",
          fileName: "estimulo.png",
        },
      ],
      options: [
        {
          ...baseDoc.subtests[0]!.items[0]!.options[0]!,
          images: [
            {
              id: null,
              draftId: "img-opt-pending",
              sourceId: null,
              resourceId: null,
              pendingFileId: "file-opt-1",
              previewUrl: "blob:opt-1",
              status: "CREATED",
              order: 1,
              altText: "Opción A",
              role: null,
              fileName: "opt-a.png",
            },
          ],
        },
        baseDoc.subtests[0]!.items[0]!.options[1]!,
      ],
    };
    const doc: VersionDocument = {
      ...baseDoc,
      subtests: [{ ...baseDoc.subtests[0]!, items: [itemWithPending] }],
    };

    const onDispatchSpy = vi.fn();
    const onRemovePendingFile = vi.fn();
    const onDeleted = vi.fn();

    renderStatefulItemEditor({
      doc,
      onDispatchSpy,
      onRemovePendingFile,
      onDeleted,
    });

    fireEvent.click(screen.getByRole("button", { name: "Eliminar ítem" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("¿Eliminar ítem?")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Eliminar ítem" }));

    await waitFor(() => {
      expect(onDeleted).toHaveBeenCalledTimes(1);
    });

    expect(onRemovePendingFile).toHaveBeenCalledWith("file-item-1");
    expect(onRemovePendingFile).toHaveBeenCalledWith("file-opt-1");
    expect(onDispatchSpy).toHaveBeenCalledWith({
      type: "DELETE_ITEM",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
    });
  });

  it("bloquea ediciones, imágenes, opciones y acciones en modo readOnly", () => {
    renderStatefulItemEditor({ readOnly: true });

    expect(screen.getByRole("button", { name: "Duplicar" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Eliminar ítem" })).toBeDisabled();
    expect(screen.getByLabelText(/Código del ítem/i)).toBeDisabled();
    expect(screen.getByLabelText("Enunciado")).toBeDisabled();
    expect(screen.getByLabelText("Puntaje base")).toBeDisabled();
    expect(screen.getByLabelText("Ítem obligatorio")).toBeDisabled();
    expect(screen.getByLabelText("Confidencial")).toBeDisabled();
    expect(screen.getByRole("button", { name: "+ Añadir opción" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Marcar opción A como correcta" })).toBeDisabled();
    expect(screen.getByLabelText("Puntaje de clave")).toBeDisabled();

    for (const btn of screen.getAllByRole("button", { name: "Adjuntar imagen" })) {
      expect(btn).toBeDisabled();
    }
    for (const btn of screen.getAllByRole("button", { name: "Eliminar opción" })) {
      expect(btn).toBeDisabled();
    }
    for (const btn of screen.getAllByRole("button", { name: "Subir opción" })) {
      expect(btn).toBeDisabled();
    }
    for (const btn of screen.getAllByRole("button", { name: "Bajar opción" })) {
      expect(btn).toBeDisabled();
    }
  });
});
