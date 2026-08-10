import { test } from "node:test";
import assert from "node:assert/strict";
import type { TeachEvent } from "./protocol";
import { planLessonTimeline } from "./timeline-client";
import { buildLessonTimeline } from "./timeline";

const speak = (text: string): TeachEvent => ({ kind: "speak", text });
const draw = (markup: string): TeachEvent => ({
  kind: "draw",
  action: { type: "write", markup, color: "ink" },
});

const EVENTS = [speak("First point."), draw("a"), draw("b")];

function withFetch<T>(impl: typeof fetch, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return run().finally(() => {
    globalThis.fetch = original;
  });
}

test("server cue indices rehydrate into the real events", async () => {
  const beats = await withFetch(
    async () =>
      new Response(
        JSON.stringify({
          beats: [
            {
              from: 0,
              to: 3,
              estimatedDurationMs: 850,
              speech: [{ eventIndex: 0, atMs: 0, estimatedDurationMs: 850 }],
              draws: [
                { eventIndex: 1, atMs: 68 },
                { eventIndex: 2, atMs: 68 },
              ],
            },
          ],
        }),
        { status: 200 },
      ),
    () => planLessonTimeline(EVENTS),
  );

  assert.equal(beats.length, 1);
  assert.equal(beats[0]!.speech[0]!.event.text, "First point.");
  assert.equal(beats[0]!.draws[1]!.event.action.type, "write");
  assert.equal(beats[0]!.draws[1]!.atMs, 68);
});

test("an unreachable service plans locally rather than failing the lesson", async () => {
  const beats = await withFetch(
    async () => {
      throw new Error("ECONNREFUSED");
    },
    () => planLessonTimeline(EVENTS),
  );
  assert.deepEqual(beats, buildLessonTimeline(EVENTS));
});

test("a malformed response falls back too", async () => {
  const beats = await withFetch(
    async () => new Response(JSON.stringify({ oops: true }), { status: 200 }),
    () => planLessonTimeline(EVENTS),
  );
  assert.deepEqual(beats, buildLessonTimeline(EVENTS));
});

test("only the event kind is sent — lesson markup never leaves the browser for planning", async () => {
  let sent: unknown;
  await withFetch(
    async (_url, init) => {
      sent = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ beats: [] }), { status: 200 });
    },
    () => planLessonTimeline(EVENTS, 1),
  );
  assert.deepEqual(sent, {
    events: [{ kind: "speak" }, { kind: "draw" }, { kind: "draw" }],
    startAt: 1,
  });
});
