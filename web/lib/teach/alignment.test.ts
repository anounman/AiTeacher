import { test } from "node:test";
import assert from "node:assert/strict";
import { alignWriteToSpeech, verbalizeWord } from "./alignment";

test("verbalizeWord expands board notation into spoken words", () => {
  assert.deepEqual(verbalizeWord("x^2"), ["x", "squared"]);
  assert.deepEqual(verbalizeWord("∫"), ["integral"]);
  assert.deepEqual(verbalizeWord("u·v"), ["u", "times", "v"]);
  assert.deepEqual(verbalizeWord("="), ["equals"]);
});

test("written words edge to the spot where the voice says them", () => {
  const speech = [
    { eventIndex: 4, text: "The formula is u times v minus the integral of v du." },
  ];
  const cues = alignWriteToSpeech("u v = uv - ∫ v du", speech);
  assert.ok(cues.length >= 4, `expected a dense graph, got ${cues.length}`);
  const first = cues[0]!;
  assert.equal(first.word, 0);
  assert.equal(first.eventIndex, 4);
  assert.equal(speech[0]!.text.slice(first.charIndex, first.charIndex + 1), "u");
  // Monotonic: the pen never rewinds through the narration.
  for (let i = 1; i < cues.length; i++) {
    const prev = cues[i - 1]!;
    const cur = cues[i]!;
    assert.ok(
      cur.eventIndex > prev.eventIndex ||
        (cur.eventIndex === prev.eventIndex && cur.charIndex > prev.charIndex),
    );
  }
});

test("spoken digits match written numbers and vice versa", () => {
  const cues = alignWriteToSpeech("b^2 - 4 a c", [
    { eventIndex: 0, text: "b squared minus four a c." },
  ]);
  const four = cues.find((c) => c.word === 2);
  assert.ok(four, "the written 4 matched the spoken four");
});

test("multi-digit numbers and sign aliases match narration", () => {
  const cues = alignWriteToSpeech("25 - 24 = 1", [
    { eventIndex: 0, text: "Twenty-five minus twenty-four is one." },
  ]);
  assert.ok(cues.length >= 3, `expected 25, 24 and 1 to match, got ${cues.length}`);
  const negCues = alignWriteToSpeech("(-5)² = 25", [
    { eventIndex: 0, text: "Negative five squared is twenty five." },
  ]);
  assert.ok(negCues.some((c) => c.word === 0), "board minus matched spoken negative");
});

test("mathwriter layout tokens are voiced as structure, not read as tags", () => {
  const cues = alignWriteToSpeech("x = [F]5 ± [R]1[/R]|2[/F]", [
    { eventIndex: 0, text: "x equals five plus or minus square root of one over two." },
  ]);
  assert.ok(cues.length >= 3, `fraction/root markup matched, got ${cues.length}`);
});

test("a sparse graph is dropped so reveal falls back to pacing", () => {
  const cues = alignWriteToSpeech("∮ E dA = Q/ε₀", [
    { eventIndex: 0, text: "Now something completely unrelated happens here." },
  ]);
  assert.deepEqual(cues, []);
});

test("matching spans multiple sentences in narration order", () => {
  const cues = alignWriteToSpeech("u = x dv = dx", [
    { eventIndex: 1, text: "Pick u equals x." },
    { eventIndex: 2, text: "Then dv equals dx." },
  ]);
  const events = [...new Set(cues.map((c) => c.eventIndex))];
  assert.deepEqual(events, [1, 2]);
});
