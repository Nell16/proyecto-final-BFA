import type { ReactNode } from "react";
import type { RuntimeImage, RuntimeItem } from "../../../api/schemas/runtime";
import { emptyAnswer, type AnswerValue } from "../answer-value";
import { Numeric } from "./Numeric";
import { OpenText } from "./OpenText";
import { OptionMulti } from "./OptionMulti";
import { OptionSingle } from "./OptionSingle";
import { TrueFalse } from "./TrueFalse";

export { OPEN_TEXT_MAX_LENGTH } from "./OpenText";
export { Numeric, OpenText, OptionMulti, OptionSingle, TrueFalse };

export interface AnswerRendererDispatchProps {
  item: RuntimeItem;
  /** Valor guardado/local; si no coincide con `item.responseType` (o falta) se usa el vacío del tipo. */
  value: AnswerValue | undefined;
  onChange: (value: AnswerValue) => void;
  disabled?: boolean;
  /** Atajos de teclado activos sin foco dentro del renderer (ítem visible en modo examen). */
  hotkeysActive?: boolean;
  /** Id del enunciado del ítem, para `aria-labelledby`. */
  labelledBy?: string;
  /** Renderizador opcional de imágenes de las opciones. */
  renderImage?: (image: RuntimeImage) => ReactNode;
}

/**
 * Registro `TipoRespuesta → renderer` (R-03). Única entrada que usa el runner y la vista previa del builder.
 */
export function AnswerRenderer({
  item,
  value,
  onChange,
  disabled,
  hotkeysActive,
  labelledBy,
  renderImage,
}: AnswerRendererDispatchProps) {
  const current = value && value.kind === item.responseType ? value : emptyAnswer(item.responseType);
  switch (current.kind) {
    case "OPCION_UNICA":
      return (
        <OptionSingle
          item={item}
          value={current}
          onChange={onChange}
          disabled={disabled}
          hotkeysActive={hotkeysActive}
          aria-labelledby={labelledBy}
          renderImage={renderImage}
        />
      );
    case "OPCION_MULTIPLE":
      return (
        <OptionMulti
          item={item}
          value={current}
          onChange={onChange}
          disabled={disabled}
          hotkeysActive={hotkeysActive}
          aria-labelledby={labelledBy}
          renderImage={renderImage}
        />
      );
    case "VERDADERO_FALSO":
      return (
        <TrueFalse
          item={item}
          value={current}
          onChange={onChange}
          disabled={disabled}
          hotkeysActive={hotkeysActive}
          renderImage={renderImage}
        />
      );
    case "NUMERICA":
      return <Numeric item={item} value={current} onChange={onChange} disabled={disabled} />;
    case "TEXTO_ABIERTO":
      return <OpenText item={item} value={current} onChange={onChange} disabled={disabled} />;
    default: {
      const unreachable: never = current;
      return unreachable;
    }
  }
}
