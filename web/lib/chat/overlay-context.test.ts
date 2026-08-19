import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOverlayHistory,
  createSelectionFocusMessage,
  normalizeSelectedText,
  type OverlayContextTurn,
} from "./overlay-context";

const earlierUser: OverlayContextTurn = { id: "u1", role: "user", content: "older question that can be removed" };
const earlierAnswer: OverlayContextTurn = { id: "a1", role: "assistant", content: "older answer that can be removed" };
const sourceUser: OverlayContextTurn = { id: "u2", role: "user", content: "Explain conflict graphs" };
const sourceAnswer: OverlayContextTurn = { id: "a2", role: "assistant", content: "A conflict graph has one node per transaction." };

test("buildOverlayHistory keeps the source pair and latest overlay question within budget", () => {
  const history = buildOverlayHistory(
    [earlierUser, earlierAnswer, sourceUser, sourceAnswer],
    sourceAnswer.id!,
    [{ role: "assistant", content: "Temporary first answer" }, { role: "user", content: "Why is that useful?" }],
    140,
  );

  assert.deepEqual(
    history.map((turn) => turn.content),
    [sourceUser.content, sourceAnswer.content, "Temporary first answer", "Why is that useful?"],
  );
});

test("normalizeSelectedText rejects blank text and caps a valid selection", () => {
  assert.equal(normalizeSelectedText("  \n\t "), null);
  assert.equal(normalizeSelectedText("  notation  "), "notation");
  assert.equal(normalizeSelectedText("x".repeat(4_100))?.length, 4_000);
});

test("createSelectionFocusMessage keeps selected text out of system instructions", () => {
  assert.deepEqual(createSelectionFocusMessage("T1 → T2"), {
    role: "user",
    content: "Selected passage from the answer being discussed:\n<selected_text>\nT1 → T2\n</selected_text>",
  });
});
