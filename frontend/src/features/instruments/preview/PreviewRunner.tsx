import { useState } from "react";
import { RuntimeItemSchema } from "../../../api/schemas/runtime";
import { Button } from "../../../app/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "../../../app/components/ui/dialog";
import type { AnswerValue } from "../../runtime/answer-value";
import { AnswerRenderer } from "../../runtime/renderers";
import { StaffImage } from "../StaffImage";
import { isActiveDraftNode, type DocumentItem, type VersionDocument } from "../document";

function PreviewItem({ item, value, onChange }: {
  item: DocumentItem;
  value?: AnswerValue;
  onChange: (answer: AnswerValue) => void;
}) {
  const images = new Map<string, Parameters<typeof StaffImage>[0]>();
  const mapImages = (list: DocumentItem["images"]) =>
    list.filter(isActiveDraftNode).map((image, index) => {
      images.set(image.draftId, {
        resourceId: image.resourceId,
        previewUrl: image.previewUrl,
        alt: image.altText,
        compact: true,
      });
      return { imageId: index + 1, url: image.draftId, order: image.order, altText: image.altText, role: image.role };
    });

  const runtimeItem = RuntimeItemSchema.parse({
    itemId: 1,
    order: item.order,
    itemType: item.itemType,
    responseType: item.responseType,
    prompt: item.prompt,
    instruction: item.instruction,
    images: mapImages(item.images),
    options: item.options.filter(isActiveDraftNode).map((option, index) => ({
      optionId: index + 1,
      code: option.code,
      text: option.text,
      order: option.order,
      images: mapImages(option.images),
    })),
  });

  return (
    <div className="space-y-3">
      {item.instruction && <p className="text-sm text-muted-foreground">{item.instruction}</p>}
      <h3 id="preview-prompt" className="font-medium">{item.prompt || item.code}</h3>
      <div className="flex flex-wrap gap-3">
        {runtimeItem.images.map((image) => (
          <div key={image.url} className="max-w-64"><StaffImage {...images.get(image.url)} /></div>
        ))}
      </div>
      <AnswerRenderer
        item={runtimeItem}
        value={value}
        onChange={onChange}
        labelledBy="preview-prompt"
        renderImage={(image) => <StaffImage {...images.get(image.url)} />}
      />
    </div>
  );
}

export function PreviewRunner({ document, onClose }: { document: VersionDocument; onClose: () => void }) {
  const subtests = document.subtests.filter(isActiveDraftNode).sort((a, b) => a.order - b.order);
  const [subtestIndex, setSubtestIndex] = useState(0);
  const [itemIndex, setItemIndex] = useState(-1);
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const subtest = subtests[subtestIndex];
  const items = subtest?.items.filter(isActiveDraftNode).sort((a, b) => a.order - b.order) ?? [];
  const item = items[itemIndex];

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Vista previa como participante</DialogTitle>
          <DialogDescription>Las respuestas de prueba se descartan al cerrar.</DialogDescription>
        </DialogHeader>
        {document.version.instructions && <p className="whitespace-pre-wrap text-sm">{document.version.instructions}</p>}
        {subtest ? (
          <>
            <label className="grid gap-1 text-sm">
              Subtest
              <select
                className="rounded-md border bg-background p-2"
                value={subtestIndex}
                onChange={(event) => { setSubtestIndex(Number(event.target.value)); setItemIndex(-1); }}
              >
                {subtests.map((entry, index) => <option key={entry.draftId} value={index}>{entry.name || entry.code}</option>)}
              </select>
            </label>
            {item ? (
              <PreviewItem
                key={item.draftId}
                item={item}
                value={answers[item.draftId]}
                onChange={(answer) => setAnswers((current) => ({ ...current, [item.draftId]: answer }))}
              />
            ) : (
              <p className="whitespace-pre-wrap text-sm">{subtest.instructions || "Sin instrucciones para este subtest."}</p>
            )}
            {items.length > 0 && (
              <div className="flex items-center justify-between gap-2">
                <Button variant="outline" disabled={itemIndex < 0} onClick={() => setItemIndex(itemIndex - 1)}>Anterior</Button>
                {item && <span className="text-sm">{itemIndex + 1} / {items.length}</span>}
                <Button disabled={itemIndex >= items.length - 1} onClick={() => setItemIndex(itemIndex + 1)}>
                  {itemIndex < 0 ? "Comenzar" : "Siguiente"}
                </Button>
              </div>
            )}
          </>
        ) : <p className="text-sm">Agrega un subtest para ver la evaluación.</p>}
      </DialogContent>
    </Dialog>
  );
}
