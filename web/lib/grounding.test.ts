import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeSourceMarkers } from "./grounding";
import type { SourceEntry } from "@/lib/db/schema";

const source: SourceEntry = {
  sourceId: "src_allowed",
  chunkId: "allowed",
  materialId: "m1",
  title: "Notes",
  snippet: "Evidence",
  ordinal: 0,
};

test("source marker sanitizer keeps retrieved markers and strips invented ones", () => {
  assert.equal(
    sanitizeSourceMarkers("True. [S:src_allowed] False. [S:src_made_up]", [source]),
    "True. [S:src_allowed] False.",
  );
});

test("source marker sanitizer adds a visible reviewed-source trail when model omitted markers", () => {
  assert.equal(
    sanitizeSourceMarkers("A grounded answer without a marker.", [source]),
    "A grounded answer without a marker.\n\nSources reviewed: [S:src_allowed]",
  );
});
