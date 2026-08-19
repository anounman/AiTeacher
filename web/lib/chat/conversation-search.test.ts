import assert from "node:assert/strict";
import test from "node:test";
import { rankConversationSearch } from "./conversation-search";

const conversations = [
  { id: "exact", title: "Eigenvalues" },
  { id: "prefix", title: "Eigenvalues revision" },
  { id: "message", title: "Linear algebra" },
  { id: "plain", title: "Databases" },
];

const messages = [
  {
    id: "message-match",
    conversationId: "message",
    role: "assistant" as const,
    content: "Eigenvalues describe the directions a transformation stretches.",
  },
  {
    id: "later-match",
    conversationId: "exact",
    role: "assistant" as const,
    content: "A later explanation also mentions eigenvalues.",
  },
  {
    id: "special-characters",
    conversationId: "plain",
    role: "user" as const,
    content: "Can we cover C++ and C# together?",
  },
];

test("ranks exact and prefix title matches before message text matches", () => {
  const results = rankConversationSearch(conversations, messages, "EIGENVALUES");

  assert.deepEqual(results.map((result) => result.conversationId), ["exact", "prefix", "message"]);
  assert.equal(results[0]?.match, "title");
  assert.equal(results[2]?.messageId, "message-match");
});

test("returns a compact, whitespace-normalized snippet around a message match", () => {
  const results = rankConversationSearch(conversations, messages, "directions");

  assert.equal(results.length, 1);
  assert.equal(results[0]?.snippet, "Eigenvalues describe the directions a transformation stretches.");
});

test("treats query characters as plain text and ignores empty queries", () => {
  assert.deepEqual(rankConversationSearch(conversations, messages, "C++"), [
    {
      conversationId: "plain",
      conversationTitle: "Databases",
      messageId: "special-characters",
      match: "message",
      snippet: "Can we cover C++ and C# together?",
    },
  ]);
  assert.deepEqual(rankConversationSearch(conversations, messages, "   "), []);
});
