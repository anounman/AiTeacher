import { NextResponse } from "next/server";

// The teaching agent (teacher/app/agents/teach.py), reachable from the app
// origin. It returns a complete lesson in the existing wire format — spoken
// prose alternating with ```board fences — so the board, cue planner and
// transcript consume it unchanged.
//
// Not yet wired into /api/chat: swapping the tutor a student actually talks to
// is gated on the scorecard, so the comparison is a measurement rather than an
// opinion. Until then this route is how the agent is exercised.
const TEACHER_URL = process.env.TEACHER_URL ?? "http://127.0.0.1:8900";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  try {
    const res = await fetch(`${TEACHER_URL}/agents/teach`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      // A lesson is a full reasoning turn; the cloud reason slot takes tens of
      // seconds and occasionally minutes on a long one.
      signal: AbortSignal.timeout(6 * 60_000),
    });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch {
    return NextResponse.json({ error: "teacher service unreachable" }, { status: 503 });
  }
}
