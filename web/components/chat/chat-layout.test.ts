import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("chat page renders a sibling context rail without replacing the centered chat content", () => {
  const page = readFileSync("app/(app)/page.tsx", "utf8");

  assert.match(page, /ConversationContextPanel/);
  assert.match(page, /buildConversationContext\(messages\)/);
  assert.match(page, /id=\{`message-\$\{m\.id\}`\}/);
  assert.match(page, /window\.setTimeout\(\(\) => setContextOpen\(true\), 0\)/);
  assert.match(page, /chat-content/);
});
