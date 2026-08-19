import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("saved overlay hook streams by durable overlay id instead of sending browser-only history", async () => {
  const source = await readFile(new URL("./use-overlay-chat.ts", import.meta.url), "utf8");

  assert.match(source, /overlayId/);
  assert.match(source, /api\/chat\/overlay/);
  assert.doesNotMatch(source, /selectedText: snapshot/);
});
