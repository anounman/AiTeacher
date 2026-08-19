import assert from "node:assert/strict";
import test from "node:test";
import { withRouteHandler } from "./withRouteHandler";

test("happy path: returns the handler's response unchanged", async () => {
  const wrapped = withRouteHandler<{ id: string }>(async ({ params }) =>
    Response.json({ ok: true, id: params.id }, { status: 200 }),
  );

  const res = await wrapped(new Request("http://localhost/x"), {
    params: Promise.resolve({ id: "abc" }),
  });

  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, id: "abc" });
});

test("handler throws: returns a sanitized 500 with no internal detail", async () => {
  const wrapped = withRouteHandler<{ id: string }>(async () => {
    throw new Error("AI_RetryError: weekly usage limit exceeded");
  });

  const res = await wrapped(new Request("http://localhost/x"), {
    params: Promise.resolve({ id: "abc" }),
  });

  assert.equal(res.status, 500);
  const body = await res.json();
  assert.deepEqual(body, { error: "Internal error" });
  // The thrown error message must NEVER reach the client.
  assert.equal(
    JSON.stringify(body).includes("weekly usage limit"),
    false,
    "response body must not contain the original error message",
  );
});

test("generates a requestId and passes it to the handler", async () => {
  let seen: string | undefined;
  const wrapped = withRouteHandler<undefined>(async ({ requestId }) => {
    seen = requestId;
    return Response.json({ ok: true });
  });

  await wrapped(new Request("http://localhost/x"), {
    params: Promise.resolve(undefined),
  });

  assert.ok(typeof seen === "string" && seen.length > 0, "requestId is a non-empty string");
  // UUID shape: 8-4-4-4-12 hex.
  assert.match(seen!, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});

test("awaits the params Promise and passes the resolved value through", async () => {
  let resolveParams: ((v: { id: string }) => void) | undefined;
  const params = new Promise<{ id: string }>((resolve) => {
    resolveParams = resolve;
  });

  let received: { id: string } | undefined;
  const wrapped = withRouteHandler<{ id: string }>(async ({ params: p }) => {
    received = p;
    return Response.json({ ok: true });
  });

  const done = wrapped(new Request("http://localhost/x"), { params });
  resolveParams?.({ id: "resolved-id" });
  await done;

  assert.deepEqual(received, { id: "resolved-id" });
});

test("a rejected params Promise still yields a sanitized 500", async () => {
  const wrapped = withRouteHandler<{ id: string }>(async () => Response.json({ ok: true }));

  const res = await wrapped(new Request("http://localhost/x"), {
    params: Promise.reject(new Error("bad param: secret-value")),
  });

  assert.equal(res.status, 500);
  const body = await res.json();
  assert.deepEqual(body, { error: "Internal error" });
  assert.equal(
    JSON.stringify(body).includes("secret-value"),
    false,
    "param rejection must not leak its message",
  );
});