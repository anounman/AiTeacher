export type SelectionSnapshot = {
  sourceMessageId: string;
  selectedText: string;
  textOffset: number;
  rect: { left: number; top: number; width: number; height: number };
};

export type Viewport = { width: number; height: number };

export function placeSelectionAction(
  rect: SelectionSnapshot["rect"],
  viewport: Viewport,
): { left: number; top: number; placement: "above" | "below" } {
  const edge = 8;
  const actionHeight = 32;
  const gap = 6;
  const actionWidth = 56;
  const left = Math.max(edge, Math.min(rect.left, viewport.width - actionWidth - edge));
  const fitsAbove = rect.top >= actionHeight + gap + edge;
  return {
    left,
    top: fitsAbove ? rect.top - actionHeight - gap : rect.top + rect.height + gap,
    placement: fitsAbove ? "above" : "below",
  };
}

export function selectionSnapshot(selection: Selection | null): SelectionSnapshot | null {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const selectedText = selection.toString().trim().slice(0, 4_000);
  if (!selectedText) return null;
  const range = selection.getRangeAt(0);
  const container = range.commonAncestorContainer;
  const element = container.nodeType === Node.ELEMENT_NODE ? container as Element : container.parentElement;
  const answer = element?.closest<HTMLElement>("[data-selectable-answer]");
  if (!answer || element?.closest("[data-selection-excluded]")) return null;
  if (answer.contains(range.startContainer) === false || answer.contains(range.endContainer) === false) return null;
  const rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  const before = range.cloneRange();
  before.selectNodeContents(answer);
  before.setEnd(range.startContainer, range.startOffset);
  return {
    sourceMessageId: answer.dataset.selectableAnswer ?? "",
    selectedText,
    textOffset: before.toString().length,
    rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
  };
}
