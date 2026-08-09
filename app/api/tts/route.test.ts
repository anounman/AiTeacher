import { test } from "node:test";
import assert from "node:assert/strict";
import { POST } from "./route";
import { EXPRESSION_PROFILES } from "@/lib/teach/expression";

type UpstreamCall = { url: string; body: Record<string, unknown> };

async function post(
  requestBody: Record<string, unknown>,
): Promise<{ response: Response; calls: UpstreamCall[] }> {
  const calls: UpstreamCall[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { "Content-Type": "audio/mpeg" },
    });
  }) as typeof fetch;

  try {
    const request = new Request("http://localhost/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });
    return { response: await POST(request), calls };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("legacy TTS requests retain the existing Kokoro payload", async () => {
  const { response, calls } = await post({ text: "  Hello class.  " });
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]!.body, {
    model: "kokoro",
    voice: "af_bella",
    input: "Hello class.",
    speed: 1,
    response_format: "mp3",
  });
});

test("expression and rate map only to fields supported by Kokoro-FastAPI", async () => {
  const { response, calls } = await post({
    text: "Excellent work!",
    expression: "encouraging",
    rate: 0.95,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(calls[0]!.body, {
    model: "kokoro",
    voice: "af_bella",
    input: "Excellent work!",
    speed: 0.95,
    response_format: "mp3",
    volume_multiplier: EXPRESSION_PROFILES.encouraging.volume,
  });
  assert.equal("expression" in calls[0]!.body, false);
  assert.equal("instructions" in calls[0]!.body, false);
});

test("an expression without an explicit rate uses its stable profile", async () => {
  const { response, calls } = await post({
    text: "Take your time.",
    expression: "reassuring",
  });
  assert.equal(response.status, 200);
  assert.equal(calls[0]!.body.speed, EXPRESSION_PROFILES.reassuring.rate);
  assert.equal(calls[0]!.body.volume_multiplier, EXPRESSION_PROFILES.reassuring.volume);
});

test("the legacy absolute speed field remains supported", async () => {
  const { response, calls } = await post({ text: "Hello", voice: "af_sky", speed: 1.2 });
  assert.equal(response.status, 200);
  assert.equal(calls[0]!.body.voice, "af_sky");
  assert.equal(calls[0]!.body.speed, 1.2);
});

test("invalid expression and rate are rejected before contacting Kokoro", async () => {
  const badExpression = await post({ text: "Hello", expression: "angry" });
  assert.equal(badExpression.response.status, 400);
  assert.equal(badExpression.calls.length, 0);

  const badRate = await post({ text: "Hello", rate: 99 });
  assert.equal(badRate.response.status, 400);
  assert.equal(badRate.calls.length, 0);
});
