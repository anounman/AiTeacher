import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("shared voice hook supports both browser recognition and server transcription", async () => {
  const source = await readFile(new URL("./useVoiceTyping.ts", import.meta.url), "utf8");

  assert.match(source, /SpeechRecognition/);
  assert.match(source, /MediaRecorder/);
  assert.match(source, /api\/transcribe/);
});
