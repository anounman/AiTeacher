import assert from "node:assert/strict";
import test from "node:test";
import * as overlayThreads from "./overlay-threads";
import { groupOverlayAnchors, type OverlayAnchor } from "./overlay-threads";

const anchors: OverlayAnchor[] = [
  { id: "o1", sourceMessageId: "a1", selectedText: "T1 → T2", textOffset: 14, updatedAt: 20 },
  { id: "o2", sourceMessageId: "a1", selectedText: "acyclic", textOffset: 56, updatedAt: 10 },
  { id: "o3", sourceMessageId: "a2", selectedText: "serial schedule", textOffset: 8, updatedAt: 30 },
];

test("groupOverlayAnchors groups saved discussions by their source answer", () => {
  assert.deepEqual(groupOverlayAnchors(anchors), {
    a1: [anchors[0], anchors[1]],
    a2: [anchors[2]],
  });
});

test("findOverlayAnchorAtOffset opens only the saved discussion under the clicked text", () => {
  const findOverlayAnchorAtOffset = (overlayThreads as typeof overlayThreads & {
    findOverlayAnchorAtOffset?: (items: OverlayAnchor[], offset: number) => OverlayAnchor | undefined;
  }).findOverlayAnchorAtOffset;
  const answerAnchors = anchors.filter((anchor) => anchor.sourceMessageId === "a1");

  assert.equal(typeof findOverlayAnchorAtOffset, "function");
  assert.equal(findOverlayAnchorAtOffset?.(answerAnchors, 14)?.id, "o1");
  assert.equal(findOverlayAnchorAtOffset?.(answerAnchors, 20)?.id, "o1");
  assert.equal(findOverlayAnchorAtOffset?.(answerAnchors, 21), undefined);
  assert.equal(findOverlayAnchorAtOffset?.(answerAnchors, 56)?.id, "o2");
});
