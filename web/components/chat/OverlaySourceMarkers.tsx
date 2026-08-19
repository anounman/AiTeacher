"use client";

import { useId, useLayoutEffect, useRef } from "react";
import { ChevronDown, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";
import { findOverlayAnchorAtOffset, type OverlayAnchor } from "@/lib/chat/overlay-threads";

const HIGHLIGHT_NAME = "study-overlay-anchor";
const STYLE_ID = "study-overlay-anchor-style";
const registrations = new Map<string, Range[]>();

type HighlightRegistry = {
  set(name: string, highlight: unknown): void;
  delete(name: string): void;
};

type CaretPoint = {
  node: Node;
  offset: number;
};

function refreshHighlights() {
  const registry = (globalThis.CSS as typeof CSS & { highlights?: HighlightRegistry }).highlights;
  const HighlightConstructor = (globalThis as typeof globalThis & { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
  if (!registry || !HighlightConstructor) return;
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `::highlight(${HIGHLIGHT_NAME}) { background: color-mix(in oklab, var(--rule) 22%, transparent); text-decoration: underline 2px solid color-mix(in oklab, var(--rule) 72%, transparent); text-underline-offset: 0.18em; }`;
    document.head.append(style);
  }
  const ranges = [...registrations.values()].flat();
  if (ranges.length === 0) registry.delete(HIGHLIGHT_NAME);
  else registry.set(HIGHLIGHT_NAME, new HighlightConstructor(...ranges));
}

function rangeForAnchor(root: HTMLElement, anchor: OverlayAnchor): Range | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Array<{ node: Text; start: number; end: number }> = [];
  let length = 0;
  let current = walker.nextNode();
  while (current) {
    const text = current.textContent ?? "";
    nodes.push({ node: current as Text, start: length, end: length + text.length });
    length += text.length;
    current = walker.nextNode();
  }
  const start = anchor.textOffset;
  const end = start + anchor.selectedText.length;
  const first = nodes.find((entry) => start >= entry.start && start <= entry.end);
  const last = [...nodes].reverse().find((entry) => end >= entry.start && end <= entry.end);
  if (!first || !last || end > length) return null;
  const range = document.createRange();
  range.setStart(first.node, start - first.start);
  range.setEnd(last.node, end - last.start);
  return range;
}

function caretPointFromEvent(event: React.MouseEvent<HTMLDivElement>): CaretPoint | null {
  const documentWithCaret = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const position = documentWithCaret.caretPositionFromPoint?.(event.clientX, event.clientY);
  if (position) return { node: position.offsetNode, offset: position.offset };
  const range = documentWithCaret.caretRangeFromPoint?.(event.clientX, event.clientY);
  return range ? { node: range.startContainer, offset: range.startOffset } : null;
}

function textOffsetAtCaret(root: HTMLElement, caret: CaretPoint): number | null {
  if (!root.contains(caret.node)) return null;
  const range = document.createRange();
  range.selectNodeContents(root);
  try {
    range.setEnd(caret.node, caret.offset);
  } catch {
    return null;
  }
  return range.toString().length;
}

export function OverlaySourceMarkers({
  anchors,
  onOpen,
  children,
}: {
  anchors: OverlayAnchor[];
  onOpen: (anchor: OverlayAnchor) => void;
  children: React.ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const registrationId = useId();

  const handleMarkerClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as Element | null;
    if (event.button !== 0 || target?.closest("button, a, input, textarea, select, [contenteditable='true']")) return;
    if (!window.getSelection()?.isCollapsed) return;
    const root = rootRef.current;
    if (!root || anchors.length === 0) return;
    const caret = caretPointFromEvent(event);
    if (!caret) return;
    const offset = textOffsetAtCaret(root, caret);
    if (offset === null) return;
    const anchor = findOverlayAnchorAtOffset(anchors, offset);
    if (!anchor) return;
    event.preventDefault();
    onOpen(anchor);
  };

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || anchors.length === 0) return;
    const frame = requestAnimationFrame(() => {
      const ranges = anchors.flatMap((anchor) => {
        const range = rangeForAnchor(root, anchor);
        return range ? [range] : [];
      });
      registrations.set(registrationId, ranges);
      refreshHighlights();
    });
    return () => {
      cancelAnimationFrame(frame);
      registrations.delete(registrationId);
      refreshHighlights();
    };
  }, [anchors, registrationId]);

  return (
    <div ref={rootRef} className="relative" onClick={handleMarkerClick}>
      {children}
      {anchors.length > 0 && (
        <div className="absolute -right-1 -top-1 flex items-center gap-1">
          {anchors.length === 1 ? (
            <Button type="button" size="sm" variant="secondary" onClick={() => onOpen(anchors[0])} className="h-7 rounded-full px-2.5 text-[10px]">
              <MessageCircle size={12} />
              discussion
            </Button>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" size="sm" variant="secondary" className="h-7 rounded-full px-2.5 text-[10px]">
                  <MessageCircle size={12} />
                  {anchors.length} discussions
                  <ChevronDown size={12} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-[min(19rem,calc(100vw-2rem))]">
                <p className="mono px-2.5 pb-1 pt-0.5 text-[10px] tracking-wide text-content-faint">SAVED DISCUSSIONS</p>
                {anchors.map((anchor, index) => (
                  <DropdownMenuItem key={anchor.id} onSelect={() => onOpen(anchor)} className="flex-col items-start gap-0.5">
                    <span className="mono text-[10px] tracking-wide text-content-faint">discussion {index + 1}</span>
                    <span className="w-full truncate text-[12px] text-content-muted">{anchor.selectedText}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}
    </div>
  );
}
