import { NextResponse } from "next/server";

// Proxy to the teacher service's cue planner. The browser cannot reach the
// service directly — on an iPad the app is opened over Tailscale, where
// 127.0.0.1 is the iPad — so every teacher call goes through the app origin.
//
// A failure here is not an error the learner should see: the client falls back
// to its local planner, which produces the identical plan.
const TEACHER_URL = process.env.TEACHER_URL ?? "http://127.0.0.1:8900";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  try {
    const res = await fetch(`${TEACHER_URL}/performance/timeline`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5_000),
    });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch {
    return NextResponse.json({ error: "teacher service unreachable" }, { status: 503 });
  }
}
