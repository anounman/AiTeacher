import { test } from "node:test";
import assert from "node:assert/strict";
import { produceDoc } from "./repair";
import type { ChatMessage, CompleteOptions, CompleteResult, LLMClient } from "./decompose";

/** A fake client that returns a scripted sequence of outputs. */
function fakeClient(outputs: Array<{ text: string; truncated?: boolean }>): LLMClient {
  let i = 0;
  return {
    async complete(_msgs: ChatMessage[], _opts?: CompleteOptions): Promise<CompleteResult> {
      const o = outputs[Math.min(i++, outputs.length - 1)];
      return { text: o.text, truncated: o.truncated ?? false };
    },
  };
}

const validDocJson = JSON.stringify({
  title: "Quicksort",
  summary: "Partition and recurse.",
  diagramType: "flow",
  nodes: [{ id: "a", label: "pivot" }, { id: "b", label: "partition" }],
  edges: [{ from: "a", to: "b" }],
});

test("valid first attempt -> no repair", async () => {
  const r = await produceDoc("quicksort", fakeClient([{ text: validDocJson }]));
  assert.equal(r.repaired, false);
  assert.equal(r.fellBack, false);
  assert.equal(r.attempts, 1);
  assert.equal(r.doc.title, "Quicksort");
});

test("garbage then valid -> repaired", async () => {
  const r = await produceDoc("quicksort", fakeClient([{ text: "I think... " }, { text: validDocJson }]));
  assert.equal(r.repaired, true);
  assert.equal(r.fellBack, false);
  assert.equal(r.attempts, 2);
});

test("always garbage -> fallback doc, never throws", async () => {
  const r = await produceDoc("quicksort", fakeClient([{ text: "nope" }]), { maxRepairs: 1 });
  assert.equal(r.fellBack, true);
  assert.equal(r.doc.nodes.length, 1);
});

test("truncated empty output -> fallback with truncated flag", async () => {
  const r = await produceDoc("quicksort", fakeClient([{ text: "", truncated: true }]));
  assert.equal(r.fellBack, true);
  assert.equal(r.truncated, true);
});

test("near-valid (one bad edge) is coerced without extra model call", async () => {
  const near = JSON.stringify({
    title: "X",
    summary: "s",
    diagramType: "hierarchy",
    nodes: [{ id: "a", label: "one" }, { id: "b", label: "two" }],
    edges: [{ from: "a", to: "ghost" }],
  });
  const r = await produceDoc("x", fakeClient([{ text: near }]));
  assert.equal(r.fellBack, false);
  assert.equal(r.doc.diagramType, "mindmap"); // relaxed by coerce
  assert.equal(r.doc.edges.length, 0); // bad edge dropped
});