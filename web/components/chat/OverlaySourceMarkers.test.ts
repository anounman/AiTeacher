import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const source = readFileSync(resolve(process.cwd(), "components/chat/OverlaySourceMarkers.tsx"), "utf8");

test("multiple saved discussions render a picker with one action per anchor", () => {
  assert.match(source, /DropdownMenuContent/);
  assert.match(source, /anchors\.map\(\(anchor, index\)/);
  assert.match(source, /onSelect=\{\(\) => onOpen\(anchor\)\}/);
});

test("underlined saved text reopens its linked discussion directly", () => {
  assert.match(source, /caretPositionFromPoint/);
  assert.match(source, /caretRangeFromPoint/);
  assert.match(source, /findOverlayAnchorAtOffset/);
  assert.match(source, /onClick=\{handleMarkerClick\}/);
});
