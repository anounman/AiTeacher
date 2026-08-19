import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("answer engine does not import persistence writers", async () => {
  const source = await readFile(new URL("./answer-engine.ts", import.meta.url), "utf8");

  assert.equal(/\b(addMessage|upsertMessage|setMessageSources|setMessageTokens|updateConversationTitle|deleteMessage|deleteMessagesAfter)\b/.test(source), false);
});
