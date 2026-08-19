import assert from "node:assert/strict";
import test from "node:test";
import { prefixThroughAssistantMessage, type PrefixMessage } from "./message-prefix";

const messages: PrefixMessage[] = [
  { id: "u1", role: "user" },
  { id: "a1", role: "assistant" },
  { id: "u2", role: "user" },
  { id: "a2", role: "assistant" },
  { id: "u3", role: "user" },
];

test("prefixThroughAssistantMessage returns the ordered prefix through its assistant source", () => {
  assert.deepEqual(
    prefixThroughAssistantMessage(messages, "a2")?.map((message) => message.id),
    ["u1", "a1", "u2", "a2"],
  );
});

test("prefixThroughAssistantMessage rejects missing and non-assistant sources", () => {
  assert.equal(prefixThroughAssistantMessage(messages, "missing"), null);
  assert.equal(prefixThroughAssistantMessage(messages, "u2"), null);
});
