import { NextResponse } from "next/server";

// Render (or reuse) an animated clip. The spec is passed straight through to
// the teacher service, which validates it — including the expression, which a
// model wrote and which is checked against a whitelist there rather than
// evaluated. Nothing here needs to understand maths.
//
// A 400 means the spec was rejected (unsafe or malformed) and is worth
// surfacing; anything else degrades to "no clip", because a lesson missing an
// animation is still a lesson.
const TEACHER_URL = process.env.TEACHER_URL ?? "http://127.0.0.1:8900";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  try {
    const res = await fetch(`${TEACHER_URL}/performance/clip`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      // Cold render of a fresh spec is ~1s; the ceiling is for a queue behind
      // the service's single render lock.
      signal: AbortSignal.timeout(120_000),
    });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch {
    return NextResponse.json({ error: "teacher service unreachable" }, { status: 503 });
  }
}
