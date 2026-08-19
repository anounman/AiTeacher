import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("owns focused source state and supplies it to chat messages and the evidence dialog", async () => {
  const source = await readFile(new URL("./page.tsx", import.meta.url), "utf8");

  assert.match(source, /import \{ EvidenceDialog \} from "@\/components\/chat\/EvidenceDialog"/);
  assert.match(source, /const \[focusedSource, setFocusedSource\] = useState<SourceEntry \| null>\(null\)/);
  assert.match(source, /onOpenSource=\{setFocusedSource\}/);
  assert.match(source, /<EvidenceDialog source=\{focusedSource\} onOpenChange=\{setFocusedSource\} \/>/);
});
