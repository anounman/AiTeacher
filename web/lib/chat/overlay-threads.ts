export type OverlayAnchor = {
  id: string;
  sourceMessageId: string;
  selectedText: string;
  textOffset: number;
  updatedAt: number;
};

export function groupOverlayAnchors(anchors: OverlayAnchor[]): Record<string, OverlayAnchor[]> {
  return anchors.reduce<Record<string, OverlayAnchor[]>>((groups, anchor) => {
    (groups[anchor.sourceMessageId] ??= []).push(anchor);
    return groups;
  }, {});
}

export function findOverlayAnchorAtOffset(anchors: OverlayAnchor[], offset: number): OverlayAnchor | undefined {
  return anchors.find((anchor) => (
    offset >= anchor.textOffset
    && offset < anchor.textOffset + anchor.selectedText.length
  ));
}
