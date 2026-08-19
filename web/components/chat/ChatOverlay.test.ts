import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const source = readFileSync(resolve(process.cwd(), "components/chat/ChatOverlay.tsx"), "utf8");

test("overlay sends on Enter but keeps Shift+Enter for a newline", () => {
  assert.match(source, /onKeyDown=\{\(event\) => \{/);
  assert.match(source, /event\.key === "Enter" && !event\.shiftKey && !event\.nativeEvent\.isComposing/);
  assert.match(source, /event\.preventDefault\(\);/);
  assert.match(source, /void submitDraft\(\);/);
});

test("overlay presents the selected passage and keyboard hint clearly", () => {
  assert.match(source, /SELECTED PASSAGE/);
  assert.match(source, /Enter to send/);
  assert.match(source, /Shift\+Enter for a new line/);
});

test("overlay prioritizes a tall, uncluttered response viewport", () => {
  assert.match(source, /h-\[min\(96dvh,72rem\)\]/);
  assert.match(source, /h-\[96dvh\] w-full rounded-t/);
  assert.match(source, /shrink-0.*border-b.*px-5 py-2\.5/);
  assert.match(source, /max-h-12 overflow-y-auto/);
  assert.match(source, /flex-1 overflow-y-auto.*px-5 py-3/);
  assert.match(source, /border-t.*px-5 py-2\.5/);
  assert.match(source, /rows=\{1\}/);
});
