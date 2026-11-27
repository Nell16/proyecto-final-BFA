import {
  type DocumentBaremoRange,
  type DocumentImage,
  type DocumentNodeRef,
  type DocumentProblem,
  type DraftStatus,
  IMAGE_ITEM_TYPES,
  isActiveDraftNode,
  nodeKeyOf,
  OPTION_RESPONSE_TYPES,
  SINGLE_KEY_OPTION_RESPONSE_TYPES,
  type VersionDocument,
} from "./types";

export const UNSUPPORTED_SCORING_KEY_CODE = "UNSUPPORTED_SCORING_KEY";
export const UNSUPPORTED_SCORING_KEY_MESSAGE =
  "La calificación automática todavía no admite este tipo de clave: ignora los códigos o valores esperados, así que el ítem se calificaría mal (con cero o con puntaje completo por una selección parcial). Usa una sola opción correcta o márcalo para revisión manual.";

export interface ValidateDocumentOptions {
  hasUnsavedChanges?: boolean;
  hasActiveScoringRules?: boolean;
}

export interface PublicationChecklistItem {
  id: string;
  label: string;
  passed: boolean;
  severity: "error" | "warning";
  detail?: string;
  node: DocumentNodeRef;
}

export interface ValidationReport {
  valid: boolean;
  canSave: boolean;
  canApprove: boolean;
  canPublish: boolean;
  errors: DocumentProblem[];
  saveErrors: DocumentProblem[];
  warnings: DocumentProblem[];
  byNodeKey: Record<string, DocumentProblem[]>;
  checklist: PublicationChecklistItem[];
}

interface IndexedCodeOrderNode<T> {
  item: T;
  code: string;
  order: number;
  node: DocumentNodeRef;
}

const normalizeCode = (value: string): string => value.trim().toUpperCase();

function pushProblem(
  problems: DocumentProblem[],
  problem: Omit<DocumentProblem, "id" | "nodeKey">,
): void {
  const nodeKey = nodeKeyOf(problem.node);
  problems.push({
    ...problem,
    nodeKey,
    id: `${problem.code}:${nodeKey}:${problem.field ?? ""}:${problems.length}`,
  });
}

function validateUniqueCodesAndOrders<T>(
  nodes: readonly IndexedCodeOrderNode<T>[],
  entityLabel: string,
  fieldScope: { codeField: string; orderField: string },
  problems: DocumentProblem[],
  blocksSave = true,
): void {
  const byCode = new Map<string, IndexedCodeOrderNode<T>[]>();
  const byOrder = new Map<number, IndexedCodeOrderNode<T>[]>();

  for (const entry of nodes) {
    const normalized = normalizeCode(entry.code);
    if (normalized === "") {
      pushProblem(problems, {
        severity: "error",
        code: "EMPTY_CODE",
        message: `El código de ${entityLabel} es obligatorio.`,
        node: entry.node,
        field: fieldScope.codeField,
        blocksSave,
      });
    } else {
      const group = byCode.get(normalized) ?? [];
      group.push(entry);
      byCode.set(normalized, group);
    }

    const orderGroup = byOrder.get(entry.order) ?? [];
    orderGroup.push(entry);
    byOrder.set(entry.order, orderGroup);
  }

  for (const [, group] of byCode) {
    if (group.length < 2) continue;
    for (const entry of group) {
      pushProblem(problems, {
        severity: "error",
        code: "DUPLICATE_CODE",
        message: `Código de ${entityLabel} duplicado: "${entry.code.trim()}".`,
        node: entry.node,
        field: fieldScope.codeField,
        blocksSave,
      });
    }
  }

  for (const [order, group] of byOrder) {
    if (group.length < 2) continue;
    for (const entry of group) {
      pushProblem(problems, {
        severity: "error",
        code: "DUPLICATE_ORDER",
        message: `Orden de ${entityLabel} duplicado: ${order}.`,
        node: entry.node,
        field: fieldScope.orderField,
        blocksSave,
      });
    }
  }
}

function validateActiveImagesAltText(
  images: readonly DocumentImage[],
  node: DocumentNodeRef,
  problems: DocumentProblem[],
): void {
  for (const img of images) {
    if (!isActiveDraftNode(img)) continue;
    if (img.altText.trim() === "") {
      pushProblem(problems, {
        severity: "warning",
        code: "MISSING_IMAGE_ALT_TEXT",
        message: "Una imagen no tiene texto alternativo (altText).",
        node,
        field: "images",
      });
    }
  }
}

function rangesOverlap(a: DocumentBaremoRange, b: DocumentBaremoRange): boolean {
  return a.minScore <= b.maxScore && b.minScore <= a.maxScore;
}

export function validateVersionDocument(
  doc: VersionDocument,
  options?: ValidateDocumentOptions,
): ValidationReport {
  const problems: DocumentProblem[] = [];

  const versionNode: DocumentNodeRef = { kind: "version" };
  if (doc.version.number.trim() === "") {
    pushProblem(problems, {
      severity: "error",
      code: "VERSION_NUMBER_REQUIRED",
      message: "El número de versión es obligatorio.",
      node: versionNode,
      field: "number",
      blocksSave: true,
    });
  }
  if (doc.version.timeLimitSeconds !== null && doc.version.timeLimitSeconds <= 0) {
    pushProblem(problems, {
      severity: "error",
      code: "INVALID_VERSION_TIME_LIMIT",
      message: "El tiempo límite de la versión debe ser mayor que 0 segundos.",
      node: versionNode,
      field: "timeLimitSeconds",
      blocksSave: true,
    });
  }
  if (doc.version.strategyId === null) {
    pushProblem(problems, {
      severity: "error",
      code: "VERSION_STRATEGY_REQUIRED",
      message: "Debe seleccionar una estrategia de calificación para la versión.",
      node: versionNode,
      field: "strategyId",
    });
  }
  if (doc.version.instructions.trim() === "") {
    pushProblem(problems, {
      severity: "warning",
      code: "MISSING_VERSION_INSTRUCTIONS",
      message: "La versión no tiene instrucciones generales configuradas.",
      node: versionNode,
      field: "instructions",
    });
  }

  const activeSubtests = doc.subtests.filter(isActiveDraftNode);
  if (activeSubtests.length === 0) {
    pushProblem(problems, {
      severity: "error",
      code: "NO_ACTIVE_SUBTESTS",
      message: "La versión debe contener al menos un subtest activo.",
      node: versionNode,
      field: "subtests",
    });
  }

  validateUniqueCodesAndOrders(
    activeSubtests.map((subtest) => ({
      item: subtest,
      code: subtest.code,
      order: subtest.order,
      node: { kind: "subtest", subtestDraftId: subtest.draftId },
    })),
    "subtest",
    { codeField: "code", orderField: "order" },
    problems,
  );

  for (const subtest of activeSubtests) {
    const subtestNode: DocumentNodeRef = { kind: "subtest", subtestDraftId: subtest.draftId };

    if (subtest.name.trim() === "") {
      pushProblem(problems, {
        severity: "error",
        code: "SUBTEST_NAME_REQUIRED",
        message: "El nombre del subtest es obligatorio.",
        node: subtestNode,
        field: "name",
        blocksSave: true,
      });
    }
    if (subtest.timeLimitSeconds !== null && subtest.timeLimitSeconds <= 0) {
      pushProblem(problems, {
        severity: "error",
        code: "INVALID_SUBTEST_TIME_LIMIT",
        message: "El tiempo límite del subtest debe ser mayor que 0 segundos.",
        node: subtestNode,
        field: "timeLimitSeconds",
        blocksSave: true,
      });
    } else if (subtest.timeLimitSeconds === null) {
      pushProblem(problems, {
        severity: "warning",
        code: "MISSING_SUBTEST_TIME_LIMIT",
        message: `El subtest "${subtest.name || subtest.code}" no tiene tiempo límite definido.`,
        node: subtestNode,
        field: "timeLimitSeconds",
      });
    }

    if (subtest.instructions.trim() === "") {
      pushProblem(problems, {
        severity: "warning",
        code: "MISSING_SUBTEST_INSTRUCTIONS",
        message: `El subtest "${subtest.name || subtest.code}" no tiene instrucciones.`,
        node: subtestNode,
        field: "instructions",
      });
    }

    const activeItems = subtest.items.filter(isActiveDraftNode);
    if (activeItems.length === 0) {
      pushProblem(problems, {
        severity: "error",
        code: "SUBTEST_WITHOUT_ITEMS",
        message: `El subtest "${subtest.name || subtest.code}" debe tener al menos un ítem activo.`,
        node: subtestNode,
        field: "items",
      });
    }

    validateUniqueCodesAndOrders(
      activeItems.map((item) => ({
        item,
        code: item.code,
        order: item.order,
        node: { kind: "item", subtestDraftId: subtest.draftId, itemDraftId: item.draftId },
      })),
      "ítem",
      { codeField: "code", orderField: "order" },
      problems,
    );

    for (const item of activeItems) {
      const itemNode: DocumentNodeRef = {
        kind: "item",
        subtestDraftId: subtest.draftId,
        itemDraftId: item.draftId,
      };

      if (item.baseScore < 0) {
        pushProblem(problems, {
          severity: "error",
          code: "NEGATIVE_ITEM_BASE_SCORE",
          message: "El puntaje base del ítem no puede ser negativo.",
          node: itemNode,
          field: "baseScore",
          blocksSave: true,
        });
      }
      if (item.timeLimitSeconds !== null && item.timeLimitSeconds <= 0) {
        pushProblem(problems, {
          severity: "error",
          code: "INVALID_ITEM_TIME_LIMIT",
          message: "El tiempo límite del ítem debe ser mayor que 0 segundos.",
          node: itemNode,
          field: "timeLimitSeconds",
          blocksSave: true,
        });
      }

      const activeOptions = item.options.filter(isActiveDraftNode);
      validateUniqueCodesAndOrders(
        activeOptions.map((opt) => ({
          item: opt,
          code: opt.code,
          order: opt.order,
          node: itemNode,
        })),
        "opción",
        { codeField: "options", orderField: "options" },
        problems,
      );

      if (OPTION_RESPONSE_TYPES.has(item.responseType) && activeOptions.length < 2) {
        pushProblem(problems, {
          severity: "error",
          code: "INSUFFICIENT_OPTIONS",
          message: "Los ítems con opciones requieren al menos 2 opciones activas.",
          node: itemNode,
          field: "options",
        });
      }

      if (item.responseType === "VERDADERO_FALSO" && activeOptions.length !== 2) {
        pushProblem(problems, {
          severity: "warning",
          code: "VF_OPTION_COUNT",
          message: "Un ítem Verdadero/Falso debería tener exactamente 2 opciones activas.",
          node: itemNode,
          field: "options",
        });
      }

      const activeKey =
        item.answerKey !== null && isActiveDraftNode(item.answerKey) ? item.answerKey : null;

      if (activeKey !== null && activeKey.score < 0) {
        pushProblem(problems, {
          severity: "error",
          code: "NEGATIVE_KEY_SCORE",
          message: "El puntaje de la clave de respuesta no puede ser negativo.",
          node: itemNode,
          field: "answerKey.score",
          blocksSave: true,
        });
      }

      const hasValidCorrectOption =
        activeKey !== null &&
        (activeKey.correctOptionDraftId !== null
          ? activeOptions.some((opt) => opt.draftId === activeKey.correctOptionDraftId)
          : activeKey.correctOptionId !== null &&
            activeOptions.some((opt) => opt.id === activeKey.correctOptionId));
      const hasExpectedText =
        activeKey !== null &&
        activeKey.expectedText !== null &&
        activeKey.expectedText.trim() !== "";
      const hasExpectedNumber =
        activeKey !== null &&
        activeKey.expectedNumber !== null &&
        Number.isFinite(activeKey.expectedNumber);
      const satisfiesCkClaveTipo =
        activeKey === null ||
        hasValidCorrectOption ||
        hasExpectedText ||
        hasExpectedNumber ||
        activeKey.requiresManualReview === true;

      if (SINGLE_KEY_OPTION_RESPONSE_TYPES.has(item.responseType) && !activeKey?.requiresManualReview) {
        if (!hasValidCorrectOption) {
          pushProblem(problems, {
            severity: "error",
            code: "MISSING_CORRECT_OPTION",
            message:
              activeKey !== null && !satisfiesCkClaveTipo
                ? "La clave de respuesta quedó sin opción correcta activa (viola ck_clave_tipo). Reasigna una opción correcta o activa revisión manual."
                : "Debe seleccionar una opción correcta activa en la clave de respuesta.",
            node: itemNode,
            field: "answerKey",
            blocksSave: activeKey !== null && !satisfiesCkClaveTipo,
          });
        }
      }

      if (item.responseType === "NUMERICA") {
        if (!activeKey?.requiresManualReview && !hasExpectedNumber) {
          pushProblem(problems, {
            severity: "error",
            code: "MISSING_EXPECTED_NUMBER",
            message:
              activeKey !== null && !satisfiesCkClaveTipo
                ? "La clave de respuesta numérica quedó sin valor esperado ni revisión manual (viola ck_clave_tipo)."
                : "Los ítems numéricos requieren un valor numérico esperado.",
            node: itemNode,
            field: "answerKey.expectedNumber",
            blocksSave: activeKey !== null && !satisfiesCkClaveTipo,
          });
        }
        if (
          activeKey !== null &&
          activeKey.numericTolerance !== null &&
          activeKey.numericTolerance < 0
        ) {
          pushProblem(problems, {
            severity: "error",
            code: "NEGATIVE_NUMERIC_TOLERANCE",
            message: "La tolerancia numérica no puede ser negativa.",
            node: itemNode,
            field: "answerKey.numericTolerance",
            blocksSave: true,
          });
        }
      }

      if (
        !SINGLE_KEY_OPTION_RESPONSE_TYPES.has(item.responseType) &&
        item.responseType !== "NUMERICA" &&
        activeKey !== null &&
        !satisfiesCkClaveTipo
      ) {
        pushProblem(problems, {
          severity: "error",
          code: "INVALID_ANSWER_KEY",
          message:
            "La clave de respuesta activa debe definir opciones/texto esperado, valor numérico o revisión manual (ck_clave_tipo).",
          node: itemNode,
          field: "answerKey",
          blocksSave: true,
        });
      }

      // El backend (ClaveSimpleScoringService) solo puntúa si la clave tiene una
      // única opción correcta (opcionCorrecta) que figure entre las seleccionadas.
      // Claves con texto esperado ("A,B") o valor numérico puntúan siempre cero,
      // salvo que el ítem se marque para revisión manual. No bloquea guardar.
      if (
        activeKey !== null &&
        !activeKey.requiresManualReview &&
        !SINGLE_KEY_OPTION_RESPONSE_TYPES.has(item.responseType) &&
        (!hasValidCorrectOption ||
          // Un correctOption heredado no hace calificable la clave: el backend ignora
          // el texto/valor esperado y daría puntaje completo a una respuesta parcial.
          (item.responseType === "OPCION_MULTIPLE" && hasExpectedText) ||
          (item.responseType !== "OPCION_MULTIPLE" && (hasExpectedText || hasExpectedNumber)))
      ) {
        pushProblem(problems, {
          severity: "error",
          code: UNSUPPORTED_SCORING_KEY_CODE,
          message: UNSUPPORTED_SCORING_KEY_MESSAGE,
          node: itemNode,
          field: "answerKey",
        });
      }

      if (
        item.responseType === "TEXTO_ABIERTO" &&
        !activeKey?.requiresManualReview &&
        (!activeKey?.expectedText || activeKey.expectedText.trim() === "")
      ) {
        pushProblem(problems, {
          severity: "warning",
          code: "OPEN_TEXT_WITHOUT_REVIEW_OR_EXPECTED",
          message:
            "Ítem de texto abierto sin revisión manual ni texto esperado de referencia.",
          node: itemNode,
          field: "answerKey",
        });
      }

      const activeItemImages = item.images.filter(isActiveDraftNode);
      const hasAnyOptionImages = activeOptions.some((opt) =>
        opt.images.some(isActiveDraftNode),
      );
      if (
        IMAGE_ITEM_TYPES.has(item.itemType) &&
        activeItemImages.length === 0 &&
        !hasAnyOptionImages
      ) {
        pushProblem(problems, {
          severity: "warning",
          code: "MISSING_ITEM_IMAGES",
          message: "Ítem visual sin imágenes adjuntas en el estímulo ni en las opciones.",
          node: itemNode,
          field: "images",
        });
      }

      validateActiveImagesAltText(item.images, itemNode, problems);
      for (const opt of activeOptions) {
        validateActiveImagesAltText(opt.images, itemNode, problems);
      }
    }
  }

  const activeBaremos = doc.baremos.filter(isActiveDraftNode);
  if (activeBaremos.length === 0) {
    pushProblem(problems, {
      severity: "warning",
      code: "NO_BAREMOS",
      message: "La versión aún no tiene baremos configurados.",
      node: { kind: "baremos" },
    });
  }

  for (const baremo of activeBaremos) {
    const baremoNode: DocumentNodeRef = { kind: "baremos", baremoDraftId: baremo.draftId };
    const baremoDirty =
      baremo.status !== "EXISTING" ||
      baremo.ranges.some((r) => r.status === "CREATED" || r.status === "UPDATED");
    if (baremo.code.trim() === "") {
      pushProblem(problems, {
        severity: "error",
        code: "BAREMO_CODE_REQUIRED",
        message: "El código del baremo es obligatorio.",
        node: baremoNode,
        field: "code",
        blocksSave: baremoDirty,
      });
    }
    if (baremo.name.trim() === "") {
      pushProblem(problems, {
        severity: "error",
        code: "BAREMO_NAME_REQUIRED",
        message: "El nombre del baremo es obligatorio.",
        node: baremoNode,
        field: "name",
        blocksSave: baremoDirty,
      });
    }

    const activeRanges = baremo.ranges.filter(isActiveDraftNode);
    for (const range of activeRanges) {
      if (range.minScore > range.maxScore) {
        pushProblem(problems, {
          severity: "error",
          code: "BAREMO_RANGE_INVERTED",
          message: `Rango invertido en baremo "${baremo.name || baremo.code}": ${range.minScore} > ${range.maxScore}.`,
          node: baremoNode,
          field: "ranges",
          blocksSave: baremoDirty,
        });
      }
      if (range.category.trim() === "") {
        pushProblem(problems, {
          severity: "error",
          code: "BAREMO_RANGE_CATEGORY_REQUIRED",
          message: "Cada rango del baremo debe tener una categoría.",
          node: baremoNode,
          field: "ranges",
          blocksSave: baremoDirty,
        });
      }
      if (range.percentile !== null && (range.percentile < 0 || range.percentile > 100)) {
        pushProblem(problems, {
          severity: "error",
          code: "BAREMO_RANGE_PERCENTILE_OUT_OF_RANGE",
          message: `Percentil fuera de [0, 100] en baremo "${baremo.name || baremo.code}": ${range.percentile}.`,
          node: baremoNode,
          field: "ranges",
          blocksSave: baremoDirty,
        });
      }
    }

    const sortedRanges = [...activeRanges].sort(
      (a, b) => a.minScore - b.minScore || a.maxScore - b.maxScore,
    );
    let overlapDetected = false;
    for (let i = 0; i < sortedRanges.length && !overlapDetected; i += 1) {
      const r1 = sortedRanges[i];
      if (!r1 || r1.minScore > r1.maxScore) continue;
      for (let j = i + 1; j < sortedRanges.length; j += 1) {
        const r2 = sortedRanges[j];
        if (!r2 || r2.minScore > r2.maxScore) continue;
        if (rangesOverlap(r1, r2)) {
          pushProblem(problems, {
            severity: "error",
            code: "BAREMO_RANGES_OVERLAP",
            message: `Los rangos [${r1.minScore}, ${r1.maxScore}] y [${r2.minScore}, ${r2.maxScore}] del baremo "${baremo.name || baremo.code}" se solapan.`,
            node: baremoNode,
            field: "ranges",
            blocksSave: baremoDirty,
          });
          overlapDetected = true;
          break;
        }
      }
    }
  }

  const errors = problems.filter((p) => p.severity === "error");
  const saveErrors = errors.filter((p) => p.blocksSave === true);
  const warnings = problems.filter((p) => p.severity === "warning");

  const byNodeKey: Record<string, DocumentProblem[]> = {};
  for (const problem of problems) {
    const existing = byNodeKey[problem.nodeKey];
    if (existing) {
      existing.push(problem);
    } else {
      byNodeKey[problem.nodeKey] = [problem];
    }
  }

  const hasUnsavedChanges = options?.hasUnsavedChanges ?? false;
  const hasActiveScoringRules = options?.hasActiveScoringRules ?? true;

  const hasErrorIn = (codes: ReadonlySet<string>): boolean =>
    errors.some((e) => codes.has(e.code));

  const checklist: PublicationChecklistItem[] = [
    {
      id: "identity-strategy",
      label: "Identidad de versión y estrategia de calificación",
      passed: !hasErrorIn(
        new Set([
          "VERSION_NUMBER_REQUIRED",
          "INVALID_VERSION_TIME_LIMIT",
          "VERSION_STRATEGY_REQUIRED",
        ]),
      ),
      severity: "error",
      node: versionNode,
    },
    {
      id: "subtests-items",
      label: "Subtests e ítems activos con códigos y órdenes únicos",
      passed: !hasErrorIn(
        new Set([
          "NO_ACTIVE_SUBTESTS",
          "SUBTEST_NAME_REQUIRED",
          "INVALID_SUBTEST_TIME_LIMIT",
          "SUBTEST_WITHOUT_ITEMS",
          "EMPTY_CODE",
          "DUPLICATE_CODE",
          "DUPLICATE_ORDER",
          "NEGATIVE_ITEM_BASE_SCORE",
          "INVALID_ITEM_TIME_LIMIT",
        ]),
      ),
      severity: "error",
      node: versionNode,
    },
    {
      id: "options-keys",
      label: "Opciones y claves de respuesta válidas",
      passed: !hasErrorIn(
        new Set([
          "INSUFFICIENT_OPTIONS",
          "NEGATIVE_KEY_SCORE",
          "MISSING_CORRECT_OPTION",
          "MISSING_EXPECTED_NUMBER",
          "NEGATIVE_NUMERIC_TOLERANCE",
          "INVALID_ANSWER_KEY",
          UNSUPPORTED_SCORING_KEY_CODE,
        ]),
      ),
      severity: "error",
      node: versionNode,
    },
    {
      id: "baremos",
      label: "Baremos válidos y sin rangos solapados",
      passed: !hasErrorIn(
        new Set([
          "BAREMO_CODE_REQUIRED",
          "BAREMO_NAME_REQUIRED",
          "BAREMO_RANGE_INVERTED",
          "BAREMO_RANGE_CATEGORY_REQUIRED",
          "BAREMO_RANGE_PERCENTILE_OUT_OF_RANGE",
          "BAREMO_RANGES_OVERLAP",
        ]),
      ),
      severity: activeBaremos.length === 0 ? "warning" : "error",
      detail: activeBaremos.length === 0 ? "Sin baremos configurados" : undefined,
      node: { kind: "baremos" },
    },
    {
      id: "scoring-rules",
      label: "Reglas de calificación activas",
      passed: hasActiveScoringRules,
      severity: "error",
      node: { kind: "publish" },
    },
    {
      id: "saved-state",
      label: "Sin cambios pendientes por guardar",
      passed: !hasUnsavedChanges,
      severity: "error",
      node: { kind: "publish" },
    },
  ];

  const valid = errors.length === 0;
  const canSave = saveErrors.length === 0;
  const canApprove =
    valid &&
    hasActiveScoringRules &&
    !hasUnsavedChanges &&
    (doc.version.status === "BORRADOR" || doc.version.status === "EN_REVISION");
  const canPublish =
    valid &&
    !hasUnsavedChanges &&
    doc.version.status === "APROBADO" &&
    hasActiveScoringRules;

  return {
    valid,
    canSave,
    canApprove,
    canPublish,
    errors,
    saveErrors,
    warnings,
    byNodeKey,
    checklist,
  };
}

export function isStatusDirty(status: DraftStatus): boolean {
  return status !== "EXISTING";
}
