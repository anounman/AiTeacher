import assert from "node:assert/strict";
import test from "node:test";
import { artifactEntryId, extractNativeArtifactEntries } from "./entries";

const calloutPayload = JSON.stringify({
  schema: "studygpt.artifact",
  version: 1,
  kind: "callout",
  data: { label: "Idea", body: "Cache the result", tone: "idea" },
});

const tablePayload = JSON.stringify({
  schema: "studygpt.artifact",
  version: 1,
  kind: "table",
  title: "Selection pushdown",
  data: { columns: ["Rule"], rows: [["Push σ down"]] },
});

// The renderer (components/Markdown.tsx) routes fences whose language is
// `artifact` or `artifact-html`. The extractor parses that same fence shape.
function fence(lang: string, payload: string): string {
  return "```" + lang + "\n" + payload + "\n```";
}

const twoNativeArtifacts =
  fence("artifact", calloutPayload) + "\n" + fence("artifact", tablePayload);

const legacyAndInvalid =
  fence("artifact-html", "<div>Interactive</div>") +
  "\n" +
  fence("artifact", "{invalid json") +
  "\n" +
  fence("artifact", "<p>plain html</p>");

const validInvalidValid =
  fence("artifact", calloutPayload) +
  "\n" +
  fence("artifact", "{broken") +
  "\n" +
  fence("artifact", tablePayload);

test("creates distinct stable ids for two native artifact fences in one message", () => {
  const entries = extractNativeArtifactEntries("m1", twoNativeArtifacts);
  assert.deepEqual(
    entries.map((entry) => entry.id),
    ["m1:artifact:0", "m1:artifact:1"],
  );
});

test("excludes legacy HTML and malformed native artifact fences", () => {
  assert.deepEqual(extractNativeArtifactEntries("m1", legacyAndInvalid), []);
});

test("ordinals are positional — valid, invalid, valid yields 0 and 2", () => {
  const entries = extractNativeArtifactEntries("m1", validInvalidValid);
  assert.deepEqual(
    entries.map((entry) => entry.id),
    ["m1:artifact:0", "m1:artifact:2"],
  );
  assert.deepEqual(
    entries.map((entry) => entry.ordinal),
    [0, 2],
  );
});

test("entries are in fence order with source, artifact, and messageId", () => {
  const entries = extractNativeArtifactEntries("m1", twoNativeArtifacts);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].artifact.kind, "callout");
  assert.equal(entries[1].artifact.kind, "table");
  assert.equal(entries[0].source, calloutPayload);
  assert.equal(entries[1].source, tablePayload);
  assert.equal(entries[0].messageId, "m1");
});

test("artifactEntryId formats messageId with ordinal", () => {
  assert.equal(artifactEntryId("m9", 3), "m9:artifact:3");
});

test("returns no entries for a message with no artifact fences", () => {
  assert.deepEqual(
    extractNativeArtifactEntries("m1", "just text\n```mermaid\nflowchart\n```"),
    [],
  );
});