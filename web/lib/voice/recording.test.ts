import test from "node:test";
import assert from "node:assert/strict";
import {
  audioUploadName,
  microphoneErrorMessage,
  preferredRecorderMimeType,
} from "./recording";

test("selects the first recorder format supported by the browser", () => {
  assert.equal(
    preferredRecorderMimeType((mime) => mime === "audio/mp4"),
    "audio/mp4",
  );
  assert.equal(preferredRecorderMimeType(() => false), "");
});

test("uses an upload extension that matches Safari and Chromium audio", () => {
  assert.equal(audioUploadName("audio/mp4;codecs=mp4a.40.2"), "speech.m4a");
  assert.equal(audioUploadName("audio/webm;codecs=opus"), "speech.webm");
});

test("turns microphone failures into actionable messages", () => {
  assert.match(microphoneErrorMessage({ name: "NotAllowedError" }), /allow Microphone/i);
  assert.match(microphoneErrorMessage({ name: "NotReadableError" }), /another app/i);
});
