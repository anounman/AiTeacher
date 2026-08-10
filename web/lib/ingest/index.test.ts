import { test } from "node:test";
import assert from "node:assert/strict";
import { chunkPages } from "./index";

test("page chunking never crosses a PDF page boundary", () => {
  const chunks = chunkPages([
    { page: 4, text: "PAGE FOUR ONLY. ".repeat(80) },
    { page: 5, text: "PAGE FIVE ONLY. ".repeat(80) },
  ]);
  assert.ok(chunks.some((chunk) => chunk.loc.page === 4));
  assert.ok(chunks.some((chunk) => chunk.loc.page === 5));
  for (const chunk of chunks) {
    assert.equal(chunk.text.includes("PAGE FOUR") && chunk.text.includes("PAGE FIVE"), false);
    assert.equal(chunk.loc.page === 4, chunk.text.includes("PAGE FOUR"));
  }
});
