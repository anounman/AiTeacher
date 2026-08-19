import assert from "node:assert/strict";
import test from "node:test";
import { consumeSse } from "./sse";

function streamFrom(chunks: string[]) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

test("consumeSse joins fragmented events and resolves after done", async () => {
  const events: string[] = [];
  const response = new Response(
    streamFrom([
      'data: {"type":"text",',
      '"delta":"hello"}\n\n',
      'data: {"type":"done"}\n\n',
    ]),
  );

  await consumeSse(response, { onEvent: (event) => events.push(event.type) });

  assert.deepEqual(events, ["text", "done"]);
});

test("consumeSse rejects terminal errors", async () => {
  const response = new Response(
    streamFrom(['data: {"type":"error","message":"provider unavailable"}\n\n']),
  );

  await assert.rejects(
    () => consumeSse(response),
    /provider unavailable/,
  );
});

test("consumeSse rejects an incomplete stream without done", async () => {
  const response = new Response(
    streamFrom(['data: {"type":"text","delta":"partial"}\n\n']),
  );

  await assert.rejects(
    () => consumeSse(response),
    /ended before done/,
  );
});
